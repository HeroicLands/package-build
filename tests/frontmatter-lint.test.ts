/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";

import {
    UNIVERSAL_KEYS,
    lintFrontmatter,
    lintNote,
    matchesKind,
} from "../engine/frontmatter-lint.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { ITEM_FIELDS } from "../sohl/item-fields.mjs";
import { authoredFields } from "../engine/field-spec.mjs";
import { MAP_TYPES, PACK_BY_TYPE, RETIRED_TYPES } from "../engine/ids.mjs";

/** A note as the link index hands one over. */
const note = (type: string, sohl: object = {}, extra: object = {}) => ({
    file: `/tree/${type}.md`,
    type,
    raw: `---\ntype: ${type}\n---\n`,
    fm: { type, ...extra, sohl },
});

/** An index that resolves exactly the addresses it is given. */
const indexOf = (...addresses: string[]) => ({
    notes: [],
    resolve: (_n: unknown, target: string) => (addresses.includes(target) ? {} : undefined),
    manifestHit: () => null,
});

const messages = (findings: Array<{ message: string }>) =>
    findings.map((f) => f.message).join("\n");

describe("matchesKind (#19)", () => {
    it("accepts a number however YAML spelled it, and rejects a word", () => {
        expect(matchesKind(12, "number")).toBe(true);
        // Quoted scalars are how a number arrives from several editors.
        expect(matchesKind("12", "number")).toBe(true);
        expect(matchesKind("heavy", "number")).toBe(false);
        expect(matchesKind("", "number")).toBe(false);
    });

    it("treats an emptied map as a map", () => {
        // Obsidian's property editor serialises a cleared map as `[]` (#8), and
        // that means the same thing `{}` does.
        expect(matchesKind({}, "map")).toBe(true);
        expect(matchesKind([], "map")).toBe(true);
        expect(matchesKind([1], "map")).toBe(false);
    });

    it("makes no claim about a field that declares no kind", () => {
        expect(matchesKind("anything", undefined as any)).toBe(true);
    });
});

describe("the five failure classes (#19)", () => {
    const schemas = {
        skill: [
            {
                name: "subType",
                required: true,
                shape: "string",
                describe: "Which family of skill it is.",
            },
            {
                name: "masteryLevelBase",
                kind: "number",
                shape: "number",
                describe: "Mastery before any modifier.",
            },
            {
                name: "parentSkillCode",
                ref: "skill",
                describe: "The skill this one specialises.",
            },
        ],
    } as any;

    it("names the replacement for a retired type", () => {
        const [type, replacement] = Object.entries(RETIRED_TYPES)[0];
        const findings = lintNote(note(type), { schemas });
        expect(messages(findings)).toContain(`"${replacement}"`);
    });

    it("reports a type no schema declares", () => {
        const findings = lintNote(note("sandwich"), { schemas });
        expect(messages(findings)).toContain("no schema is declared");
    });

    it("reports a missing required property", () => {
        const findings = lintNote(note("skill", {}), { schemas });
        expect(messages(findings)).toContain("must declare `sohl.subType`");
    });

    it("reports a wrong value shape", () => {
        const findings = lintNote(note("skill", { subType: "craft", masteryLevelBase: "heavy" }), {
            schemas,
        });
        expect(messages(findings)).toContain("`sohl.masteryLevelBase` should");
    });

    it("reports an unknown property and suggests the near miss", () => {
        const findings = lintNote(note("skill", { subType: "craft", masterylevelBase: 3 }), {
            schemas,
        });
        // The whole reason the silence mattered: a misspelling is discarded at
        // compile with no warning (#3).
        expect(messages(findings)).toContain("is not a property of a skill");
        expect(messages(findings)).toContain('Did you mean "masteryLevelBase"');
    });

    it("does not guess when nothing is close", () => {
        const findings = lintNote(note("skill", { subType: "craft", elephant: 1 }), { schemas });
        expect(messages(findings)).not.toContain("Did you mean");
    });

    it("reports a reference that lands nowhere, and accepts one that lands", () => {
        const live = lintNote(note("skill", { subType: "craft", parentSkillCode: "swrd" }), {
            schemas,
            index: indexOf("skill-swrd"),
        });
        expect(live).toEqual([]);

        const dead = lintNote(note("skill", { subType: "craft", parentSkillCode: "nope" }), {
            schemas,
            index: indexOf("skill-swrd"),
        });
        expect(messages(dead)).toContain("no note or vendored manifest");
    });

    it("skips the reference check when it has no index to check against", () => {
        // Reporting every reference as dead because nothing was loaded to
        // resolve it would be worse than not checking.
        const findings = lintNote(note("skill", { subType: "craft", parentSkillCode: "nope" }), {
            schemas,
        });
        expect(findings).toEqual([]);
    });

    it("reports nothing for a correct note", () => {
        expect(
            lintNote(note("skill", { subType: "craft", masteryLevelBase: 30 }), {
                schemas,
            }),
        ).toEqual([]);
    });

    it("reports a retired top-level `package:`, at its own position", () => {
        // The lint is where an author meets the whole list at once; the compile
        // refuses one note at a time (#56). Reported whatever it says — the
        // value is the repository's `contentPackage` and no note restates it.
        const declaring = {
            file: "/tree/skill.md",
            type: "skill",
            raw: `---\ntype: skill\npackage: sohl\n---\n`,
            fm: { type: "skill", package: "sohl", sohl: { subType: "craft" } },
        };
        const findings = lintNote(declaring, { schemas });
        expect(messages(findings)).toContain("retired");
        expect(messages(findings)).toContain("contentPackage");
        expect(findings[0]).toMatchObject({ line: 3, column: 1 });
    });
});

describe("keys every type accepts", () => {
    it("allows the universal keys on any type", () => {
        const schemas = { doc: [] } as any;
        const sohl = Object.fromEntries([...UNIVERSAL_KEYS].map((k) => [k, "x"]));
        expect(lintNote(note("doc", sohl), { schemas })).toEqual([]);
    });

    it("includes kbcat, which no compiler reads but the knowledgebase does", () => {
        // The check's calibration depends on this: a note's frontmatter feeds a
        // knowledgebase and a website as well as a pack, so "the vocabulary" is
        // wider than "what the builder emits".
        expect(UNIVERSAL_KEYS.has("kbcat")).toBe(true);
    });
});

describe("NOTE_SCHEMAS covers what the package compiles", () => {
    it("declares every item type and every non-item type", () => {
        for (const type of Object.keys(ITEM_FIELDS)) {
            expect(NOTE_SCHEMAS, type).toHaveProperty(type);
        }
        for (const type of [...Object.keys(PACK_BY_TYPE), ...MAP_TYPES]) {
            expect(NOTE_SCHEMAS, type).toHaveProperty(type);
        }
    });

    it("leaves ITEM_FIELDS untouched — the builder registry holds that identity", () => {
        for (const [type, fields] of Object.entries(ITEM_FIELDS as any)) {
            expect(NOTE_SCHEMAS[type], type).not.toBe(fields);
            // …but every compiled field is still in the schema.
            const declared = new Set(
                authoredFields(NOTE_SCHEMAS[type] as any).map((f: any) => f.name),
            );
            for (const field of authoredFields(fields as any)) {
                expect(declared, `${type}.${(field as any).name}`).toContain((field as any).name);
            }
        }
    });

    it("gives every declared field a name and a description", () => {
        for (const [type, fields] of Object.entries(NOTE_SCHEMAS as any)) {
            for (const field of authoredFields(fields as any)) {
                expect((field as any).name, type).toBeTruthy();
                expect((field as any).describe, `${type}.${(field as any).name}`).toBeTruthy();
            }
        }
    });

    it("points every reference at a type the vocabulary declares", () => {
        for (const [type, fields] of Object.entries(NOTE_SCHEMAS as any)) {
            for (const field of fields as any[]) {
                if (!field.ref) continue;
                expect(NOTE_SCHEMAS, `${type}.${field.name}`).toHaveProperty(field.ref);
            }
        }
    });
});

describe("lintFrontmatter over an index", () => {
    it("reports each note, in path order", () => {
        const index = {
            notes: [note("sandwich"), note("baguette")],
            resolve: () => undefined,
            manifestHit: () => null,
        } as any;
        const r = lintFrontmatter(index, { schemas: NOTE_SCHEMAS });
        expect(r.notes).toBe(2);
        expect(r.findings).toHaveLength(2);
        expect(r.findings[0].file).toContain("baguette");
    });

    it("reports nothing for a tree of correct notes", () => {
        const index = {
            notes: [note("skill", { subType: "craft" })],
            resolve: () => ({}),
            manifestHit: () => null,
        } as any;
        expect(lintFrontmatter(index, { schemas: NOTE_SCHEMAS }).findings).toEqual([]);
    });
});
