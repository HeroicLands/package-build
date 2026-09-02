/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";

import { lintNote, lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY, dataFields, subTypes } from "../engine/note-vocabulary.mjs";
import { positionOfFrontmatterPath } from "../engine/diagnostics.mjs";
import { pageFrontmatter } from "../engine/site-build.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

/**
 * A note as the link index hands one over, with a real frontmatter fence so a
 * finding can be located in it.
 */
const note = (type: string, fm: Record<string, unknown> = {}) => {
    const body = { type, ...fm };
    const lines: string[] = [];
    const emit = (obj: Record<string, unknown>, indent: string) => {
        for (const [key, value] of Object.entries(obj)) {
            if (value !== null && typeof value === "object" && !Array.isArray(value)) {
                lines.push(`${indent}${key}:`);
                emit(value as Record<string, unknown>, `${indent}    `);
            } else {
                lines.push(`${indent}${key}: ${JSON.stringify(value)}`);
            }
        }
    };
    emit(body, "");
    return {
        file: `/tree/${type}.md`,
        type,
        raw: `---\n${lines.join("\n")}\n---\n`,
        fm: body,
    };
};

const messages = (findings: Array<{ message: string }>) =>
    findings.map((f) => f.message).join("\n");

const opts = { schemas: NOTE_SCHEMAS as any, vocabulary: NOTE_VOCABULARY };

describe("the `data:` container is closed (#128)", () => {
    it("accepts every key the type declares", () => {
        const findings = lintNote(
            note("weapongear", {
                data: { weight: 4, value: 20, quality: 0, durability: 12 },
            }),
            opts,
        );
        expect(findings).toEqual([]);
    });

    it("reports an unknown `data:` key and suggests the near miss", () => {
        const findings = lintNote(note("weapongear", { data: { wieght: 4 } }), opts);
        expect(messages(findings)).toContain("`data:` property declared by weapongear");
        expect(messages(findings)).toContain('Did you mean "weight"?');
    });

    it("does not guess when nothing is close", () => {
        const findings = lintNote(note("weapongear", { data: { elephant: 1 } }), opts);
        expect(messages(findings)).toContain("`data:` property declared by weapongear");
        expect(messages(findings)).not.toContain("Did you mean");
    });

    it("locates the offending key at its own line and column", () => {
        const subject = note("weapongear", { data: { wieght: 4 } });
        const findings = lintNote(subject, opts);
        // `---`, `type:`, `data:`, then the key — file line 4, indented four.
        expect(findings[0]).toMatchObject({ line: 4, column: 5 });
    });

    it("draws the suggestion from that type's own vocabulary, not another's", () => {
        // `transmission` is an affliction's, and no weapon has one; the guess
        // must come from the weapon's list or not be made at all.
        const findings = lintNote(note("weapongear", { data: { transmision: "airborne" } }), opts);
        expect(messages(findings)).not.toContain('Did you mean "transmission"');
    });

    it("reports a value whose shape the type does not allow", () => {
        const findings = lintNote(note("weapongear", { data: { weight: "heavy" } }), opts);
        expect(messages(findings)).toContain("`data.weight` should");
    });

    it("refuses a `data:` that is not a map at all", () => {
        const findings = lintNote(note("weapongear", { data: ["weight", 4] }), opts);
        expect(messages(findings)).toContain("`data:` must be a map");
    });

    it("accepts an emptied map, which the property editor writes as a list", () => {
        expect(lintNote(note("weapongear", { data: [] }), opts)).toEqual([]);
    });

    it("checks a type whose vocabulary is empty just as strictly", () => {
        const findings = lintNote(note("doc", { data: { weight: 4 } }), opts);
        expect(messages(findings)).toContain("`data:` property declared by doc");
    });

    it("makes no claim when no vocabulary is supplied", () => {
        expect(
            lintNote(note("weapongear", { data: { wieght: 4 } }), { schemas: NOTE_SCHEMAS as any }),
        ).toEqual([]);
    });

    it("reaches a nested key through its declared root", () => {
        expect(
            lintNote(
                note("mystery", {
                    sohl: { subType: "boon" },
                    data: { charges: { value: 2, max: 3 } },
                }),
                opts,
            ),
        ).toEqual([]);
        const findings = lintNote(
            note("mystery", { sohl: { subType: "boon" }, data: { charges: { value: "lots" } } }),
            opts,
        );
        expect(messages(findings)).toContain("`data.charges.value` should");
    });
});

describe("the top level stays open (#128)", () => {
    const stray = note("weapongear", {
        description: "A blade of no particular distinction",
        heroImage: "banners/sword.webp",
    });

    it("reports nothing for an unknown top-level key", () => {
        // This is the property that makes the container worth having: the same
        // misspelling is a finding under `data:` and a theme parameter here.
        expect(lintNote(stray, opts)).toEqual([]);
    });

    it("still carries that key onto the published page", () => {
        const emitted = pageFrontmatter(
            { kind: "content", fm: stray.fm, name: "Sword", slug: "sword", sec: "weapons" } as any,
            {} as any,
        );
        expect(emitted.heroImage).toBe("banners/sword.webp");
        expect(emitted.description).toBe("A blade of no particular distinction");
    });
});

describe("`subType` is top level, and only where a type declares one (#128)", () => {
    it("accepts a declared value", () => {
        expect(
            lintNote(note("skill", { subType: "craft", sohl: { subType: "craft" } }), opts),
        ).toEqual([]);
    });

    it("reports a value the type does not declare, and suggests the near miss", () => {
        const findings = lintNote(
            note("skill", { subType: "crafte", sohl: { subType: "crafte" } }),
            opts,
        );
        expect(messages(findings)).toContain("is not one of the subtypes skill declares");
        expect(messages(findings)).toContain('Did you mean "craft"?');
    });

    it("reports `subType` on a type that declares none", () => {
        const findings = lintNote(note("weapongear", { subType: "melee" }), opts);
        expect(messages(findings)).toContain("declares no subtypes");
    });

    it("permits a subType whose values the specification has not yet enumerated", () => {
        // A being's document type is derived from its subType, but the values
        // land with the note-type → subtype map (#79), so nothing here may
        // claim to know them.
        expect(subTypes("being")).toBeNull();
        expect(lintNote(note("being", { subType: "character" }), opts)).toEqual([]);
    });

    it("locates the finding on the `subType` line", () => {
        const subject = note("weapongear", { subType: "melee" });
        expect(lintNote(subject, opts)[0]).toMatchObject({ line: 3, column: 1 });
    });
});

describe("the declared vocabulary (#128)", () => {
    it("declares a data vocabulary for every type the package compiles", () => {
        for (const type of Object.keys(NOTE_SCHEMAS)) {
            expect(NOTE_VOCABULARY, type).toHaveProperty(type);
        }
    });

    it("gives every data field a name and a description", () => {
        for (const [type, entry] of Object.entries(NOTE_VOCABULARY)) {
            for (const field of entry.data) {
                expect(field.name, type).toBeTruthy();
                expect(field.describe, `${type}.${field.name}`).toBeTruthy();
            }
        }
    });

    it("declares no key twice within one type", () => {
        for (const [type, entry] of Object.entries(NOTE_VOCABULARY)) {
            const names = entry.data.map((f) => f.name);
            expect(new Set(names).size, type).toBe(names.length);
        }
    });

    it("declares every subType-bearing item type's values", () => {
        // The eight types whose builders require a `subType` are exactly the
        // ones the specification enumerates values for.
        for (const type of [
            "affiliation",
            "affliction",
            "concoctiongear",
            "mystery",
            "mysticalability",
            "projectilegear",
            "skill",
            "trauma",
        ]) {
            expect(subTypes(type), type).toEqual(expect.any(Array));
        }
    });

    it("declares `templatePriority` on every type that produces a document", () => {
        for (const type of ["being", "skill", "weapongear", "affiliation", "trauma"]) {
            expect(
                dataFields(type).map((f) => f.name),
                type,
            ).toContain("templatePriority");
        }
    });

    it("answers with nothing for a type it does not declare", () => {
        expect(dataFields("sandwich")).toBeUndefined();
        expect(subTypes("sandwich")).toBeUndefined();
    });
});

describe("locating a key inside the frontmatter fence", () => {
    it("addresses a nested key by path, past a same-named key elsewhere", () => {
        const raw = ["---", "weight: 1", "data:", "    weight: 4", "---", ""].join("\n");
        expect(positionOfFrontmatterPath(raw, ["data", "weight"], { key: true })).toEqual({
            line: 4,
            column: 5,
        });
    });

    it("drops the position rather than guessing when there is no fence", () => {
        expect(positionOfFrontmatterPath("no fence here", ["data", "weight"])).toEqual({});
    });
});

describe("lintFrontmatter carries the vocabulary through", () => {
    it("reports the container's findings over a whole index", () => {
        const index = {
            notes: [note("weapongear", { data: { wieght: 4 } })],
            resolve: () => ({}),
            manifestHit: () => null,
        } as any;
        const r = lintFrontmatter(index, { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY });
        expect(messages(r.findings)).toContain('Did you mean "weight"?');
    });
});
