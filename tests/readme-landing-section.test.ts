/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { lintFrontmatter, lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { declaredSections } from "../content-config.mjs";
import { CONFIG_BASENAME, configFromData } from "../engine/pack-config.mjs";
import { loadContentFormat } from "../engine/content-format.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

/**
 * A note as the link index hands one over, with a real frontmatter fence so a
 * finding can be located in it. `file` decides whether the note is a `README`,
 * exactly as the site build reads it.
 */
const note = (file: string, fm: Record<string, unknown>) => {
    const body = { ...fm };
    const lines = Object.entries(body).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
    return {
        file,
        type: String(body.type ?? ""),
        raw: `---\n${lines.join("\n")}\n---\n`,
        fm: body,
    };
};

const messages = (findings: Array<{ message: string }>) =>
    findings.map((f) => f.message).join("\n");

/** The item sections a `landing: readme` repository declares, as `sohl` does. */
const SECTIONS = ["rules", "user-guide", "weapongear", "armorgear", "affliction"];

/** Every content type the specification declares — the sections that exist. */
const TYPES = [...loadContentFormat().types.keys()];

const opts = {
    schemas: NOTE_SCHEMAS as any,
    vocabulary: NOTE_VOCABULARY,
    landing: "readme",
    types: TYPES,
    sections: SECTIONS,
};

describe("a README landing's `subType` is an address, not a genre (#197)", () => {
    it("accepts a README whose subType names a configured section", () => {
        const findings = lintNote(
            note("/tree/Weapons/README.md", {
                type: "doc",
                subType: "weapongear",
                shortcode: "weapons",
            }),
            opts,
        );
        expect(findings).toEqual([]);
    });

    it("still accepts a README whose subType is one of the type's own genres", () => {
        // `sohl` files its credits under `reference`, which is a doc genre and
        // not a section it configures. Widening the set may not narrow it.
        const findings = lintNote(
            note("/tree/Credits/README.md", {
                type: "doc",
                subType: "reference",
                shortcode: "credits",
            }),
            opts,
        );
        expect(findings).toEqual([]);
    });

    it("refuses a README whose subType names no configured section", () => {
        const findings = lintNote(
            note("/tree/Weapons/README.md", {
                type: "doc",
                subType: "weapongeer",
                shortcode: "weapons",
            }),
            opts,
        );
        expect(findings).toHaveLength(1);
        expect(messages(findings)).toContain("weapongeer");
        // Names what is configured, so the author can act without reading source.
        expect(messages(findings)).toContain("site.sections");
        expect(messages(findings)).toContain("weapongear");
        expect(messages(findings)).toContain('Did you mean "weapongear"?');
    });

    it("locates the finding in the file, so the diagnostic is compiler-parseable", () => {
        const findings = lintNote(
            note("/tree/Weapons/README.md", {
                type: "doc",
                subType: "weapongeer",
                shortcode: "weapons",
            }),
            opts,
        );
        // `---`, `type:`, then `subType:` — file line 3, column 1.
        expect(findings[0]).toMatchObject({
            file: "/tree/Weapons/README.md",
            line: 3,
            column: 1,
            severity: "error",
        });
    });

    it("keeps the genre check for a `doc` that is not a README", () => {
        const findings = lintNote(
            note("/tree/Weapons/Dagger_Notes.md", {
                type: "doc",
                subType: "weapongear",
                shortcode: "dagnotes",
            }),
            opts,
        );
        expect(messages(findings)).toContain("is not one of the subtypes doc declares");
    });

    it("leaves a type whose section is its own name alone", () => {
        // A `weapongear` note routes to the `weapongear` section whatever its
        // subType says, so its subType is a sub-kind and stays closed — even in
        // a README.
        const findings = lintNote(
            note("/tree/Skills/README.md", { type: "skill", subType: "nosuchkind" }),
            opts,
        );
        expect(messages(findings)).toContain("is not one of the subtypes skill declares");
    });

    it("accepts an item-section README in a package that configures no sections", () => {
        // The case that escaped #198: `sohl-thalorna` has no `site:` block at
        // all, so nothing is configured — and every one of its landings names a
        // content type, which is a section by construction (#200).
        for (const subType of ["scenario", "affiliation", "being", "lore", "mysticalability"]) {
            const findings = lintNote(
                note("/tree/Section/README.md", { type: "doc", subType, shortcode: "sec" }),
                { ...opts, sections: [] },
            );
            expect(findings, subType).toEqual([]);
        }
    });

    it("accepts a section whose type the specification declares but no schema does", () => {
        // `lore`, `place` and `scenario` are in `docs/content-format.md` and not
        // in `NOTE_SCHEMAS`. A landing's `subType` is an address, so it is
        // checked against what the format declares; whether a *note* of that
        // type can have its fields checked is a different question, answered
        // elsewhere and reported on the notes themselves.
        for (const subType of ["lore", "place", "scenario"]) {
            expect(TYPES, subType).toContain(subType);
            expect(Object.keys(NOTE_SCHEMAS), subType).not.toContain(subType);
            const findings = lintNote(
                note("/tree/Section/README.md", { type: "doc", subType, shortcode: "sec" }),
                { ...opts, sections: [] },
            );
            expect(findings, subType).toEqual([]);
        }
    });

    it("refuses a typo with no configuration to fall back on, naming both sets", () => {
        const findings = lintNote(
            note("/tree/Mystical_Abilities/README.md", {
                type: "doc",
                subType: "mysticalabilty",
                shortcode: "ma",
            }),
            { ...opts, sections: [] },
        );
        expect(findings).toHaveLength(1);
        const text = messages(findings);
        expect(text).toContain("content type");
        expect(text).toContain("rules, user-guide, reference");
        // The near miss is drawn from the union, so a mistyped *type* is caught
        // by the same suggestion a mistyped genre would be.
        expect(text).toContain('Did you mean "mysticalability"?');
        // No configured sections, so no clause claiming any are configured.
        expect(text).not.toContain("site.sections");
    });

    it("names all three sources when the repository configures sections too", () => {
        const findings = lintNote(
            note("/tree/Weapons/README.md", {
                type: "doc",
                subType: "weapongeer",
                shortcode: "weapons",
            }),
            opts,
        );
        const text = messages(findings);
        expect(text).toContain("content type");
        expect(text).toContain("rules, user-guide, reference");
        expect(text).toContain("site.sections");
        expect(text).toContain('Did you mean "weapongear"?');
    });

    it("refuses a landing that names no section at all, however it is configured", () => {
        // The guard is the point of the widening: three open-ish sets still do
        // not accept a word that is in none of them.
        for (const sections of [[], SECTIONS]) {
            const findings = lintNote(
                note("/tree/Odds/README.md", { type: "doc", subType: "sundry", shortcode: "odds" }),
                { ...opts, sections },
            );
            expect(findings, JSON.stringify(sections)).toHaveLength(1);
        }
    });

    it("carries the sections through `lintFrontmatter`", () => {
        const index = {
            notes: [
                note("/tree/Weapons/README.md", {
                    type: "doc",
                    subType: "weapongear",
                    shortcode: "weapons",
                }),
                note("/tree/Armor/README.md", {
                    type: "doc",
                    subType: "armourgear",
                    shortcode: "armor",
                }),
                // A section this repository does not configure, so only the
                // type list can accept it — which is how the plumbing of
                // `types` is proved rather than masked by `sections`.
                note("/tree/Characters/README.md", {
                    type: "doc",
                    subType: "being",
                    shortcode: "chars",
                }),
            ],
            resolve: () => ({}),
            manifestHit: () => null,
        } as any;
        const r = lintFrontmatter(index, opts as any);
        expect(r.findings).toHaveLength(1);
        expect(messages(r.findings)).toContain("armourgear");
    });
});

/** The smallest data configuration that resolves, with the given `site` block. */
function resolveWith(site?: Record<string, unknown>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-197-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sohl", version: "1.2.3" }),
        "utf8",
    );
    return configFromData(
        {
            contentPackage: "sohl",
            packageKind: "systems",
            compatibility: { minimum: "14.359" },
            stats: { lastModifiedBy: "sohlbuilder00000" },
            packs: [{ name: "items", type: "Item" }],
            ...(site ? { site } : {}),
        },
        path.join(root, `${CONFIG_BASENAME}.yaml`),
    );
}

describe("declaredSections — the sections a repository names (#197)", () => {
    it("reads both section maps, once each and in declaration order", () => {
        const config = resolveWith({
            out: "kb/content",
            sections: { being: { title: "Beings" }, rules: { title: "Rules" } },
            readmeSections: { rules: { title: "Rules" }, weapongear: { title: "Weapons" } },
        });
        expect(declaredSections(config)).toEqual(["being", "rules", "weapongear"]);
    });

    it("answers with nothing for a repository that declares no site", () => {
        expect(declaredSections(resolveWith())).toEqual([]);
    });
});
