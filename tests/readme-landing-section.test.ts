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

const opts = {
    schemas: NOTE_SCHEMAS as any,
    vocabulary: NOTE_VOCABULARY,
    landing: "readme",
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

    it("checks the genre list under a landing rule other than `readme`", () => {
        const findings = lintNote(
            note("/tree/Weapons/README.md", {
                type: "doc",
                subType: "weapongear",
                shortcode: "weapons",
            }),
            { ...opts, landing: "collection" },
        );
        expect(messages(findings)).toContain("is not one of the subtypes doc declares");
    });

    it("reports exactly as before when the repository configures no sections", () => {
        const findings = lintNote(
            note("/tree/Weapons/README.md", {
                type: "doc",
                subType: "weapongear",
                shortcode: "weapons",
            }),
            { ...opts, sections: [] },
        );
        expect(messages(findings)).toContain(
            '`subType` "weapongear" is not one of the subtypes doc declares ' +
                "(rules, user-guide, reference)",
        );
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
