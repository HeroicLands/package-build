/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A being says when it was born, when it died, and how old it is.
 *
 * `born` and `died` are declared, `age` is optional and accepts the estimate
 * spelling, and the infobox calls the first of them Born. A `birthday` key in
 * `data:` is an ordinary unrecognised key.
 */

import { describe, it, expect } from "vitest";

import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { NOTE_FIELD_PRESENTATION, noteInfobox, overlayFor } from "../engine/infobox.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

/** A note as the link index hands one over, with a real frontmatter fence. */
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

const opts = { schemas: NOTE_SCHEMAS as any, vocabulary: NOTE_VOCABULARY };

/** The `data:` field names a type declares, first segment only. */
const declaredData = (type: string): string[] =>
    (dataFields(type, NOTE_VOCABULARY) ?? []).map((f: any) => f.name.split(".")[0]);

const rowLabels = (box: any): string[] =>
    box.sections.flatMap((section: any) => section.rows.map((row: any) => row.label));

const rowFor = (box: any, label: string) =>
    box.sections.flatMap((section: any) => section.rows).find((row: any) => row.label === label);

describe("a being's dates", () => {
    const being = declaredData("being");

    it("declares `born` and `died`", () => {
        expect(being).toContain("born");
        expect(being).toContain("died");
    });

    it("declares `age`, and does not require it", () => {
        const age = (dataFields("being", NOTE_VOCABULARY) ?? []).find((f: any) => f.name === "age");
        expect(age).toBeDefined();
        expect((age as any).required).toBeFalsy();
        expect(lintNote(note("being", { data: { born: "689.169" } }), opts)).toEqual([]);
    });

    it("accepts an age written as a number and as an estimate", () => {
        expect(lintNote(note("being", { data: { age: 34 } }), opts)).toEqual([]);
        expect(lintNote(note("being", { data: { age: "~34" } }), opts)).toEqual([]);
    });

    it("accepts `unknown` in either date", () => {
        const findings = lintNote(
            note("being", { data: { born: "unknown", died: "unknown" } }),
            opts,
        );
        expect(findings).toEqual([]);
    });

    it("locates malformed birth and death dates on their own keys", () => {
        for (const field of ["born", "died"]) {
            const findings = lintNote(note("being", { data: { [field]: "not-a-date" } }), opts);
            expect(findings).toHaveLength(1);
            expect(findings[0]).toMatchObject({
                file: "/tree/being.md",
                line: 4,
                severity: "error",
            });
            expect(findings[0].message).toContain(`data.${field}`);
        }
    });

    it("calls the row Born, and the one beside it Died", () => {
        const box = noteInfobox({
            type: "being",
            data: { born: "689/6/19", died: "753/2/1" },
        });
        expect(rowLabels(box)).toContain("Born");
        expect(rowLabels(box)).toContain("Died");
        expect(rowFor(box, "Born").value).toBe("689/6/19");
        expect(rowFor(box, "Died").value).toBe("753/2/1");
    });

    it("puts the age in the appearance clause, estimate mark and all", () => {
        const box = noteInfobox({ type: "being", data: { age: "~34" } });
        expect(rowFor(box, "Appearance").value).toContain("Age ~34");
    });
});

describe("a `birthday` key in `data:`", () => {
    it("is an unrecognised key on a being, at its own line", () => {
        const findings = lintNote(note("being", { data: { birthday: "689/6/19" } }), opts);
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ severity: "error", line: 4, column: 5 });
        expect(findings[0].message).toContain("is not a `data:` property declared by being");
    });
});
