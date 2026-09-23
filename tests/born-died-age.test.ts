/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A being says when it was born, when it died, and how old it is.
 *
 * Two things are asserted here, and they fail for different reasons.
 *
 * The **fields** are the ordinary half: `born` and `died` are declared, `age` is
 * optional and accepts the estimate spelling, and the infobox calls the first
 * of them Born.
 *
 * The **retirement** is the half a reviewer cannot check by reading. `data:` is
 * a closed container, so the moment `born` replaces `birthday` every note still
 * on the old spelling earns a hard error naming a key the type does not
 * declare — three thousand of them across four repositories. The guard below is
 * therefore derived: it takes every alias whose current name a type declares
 * under `data:` and asserts, for that type, that the retired spelling is read,
 * is reported once as a rename, and is never reported as unrecognised. A future
 * `data:` rename that adds the table entry and forgets the wiring fails here
 * rather than in a consumer's build.
 */

import { describe, it, expect } from "vitest";

import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { NOTE_FIELD_PRESENTATION, noteInfobox, overlayFor } from "../engine/infobox.mjs";
import { RETIRED_FIELD_ALIASES } from "../engine/retired-fields.mjs";
import { loadContentFormat } from "../engine/content-format.mjs";
import { measureNote } from "../engine/content-format-check.mjs";
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

/** Every `(type, current, retired)` an alias applies to under `data:`. */
const renamedDataFields = (): Array<{ type: string; current: string; retired: string }> => {
    const out: Array<{ type: string; current: string; retired: string }> = [];
    for (const type of Object.keys(NOTE_VOCABULARY)) {
        for (const current of declaredData(type)) {
            const retired = RETIRED_FIELD_ALIASES[current];
            if (retired) out.push({ type, current, retired });
        }
    }
    return out;
};

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
        expect(lintNote(note("being", { data: { born: "689/6/19" } }), opts)).toEqual([]);
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

describe("a `data:` field's retired spelling", () => {
    const renamed = renamedDataFields();

    it("has at least one pair to check, so the guard is not vacuous", () => {
        expect(renamed.length).toBeGreaterThan(0);
        expect(renamed.some((r) => r.current === "born" && r.retired === "birthday")).toBe(true);
    });

    it.each(renamed)("is not an unrecognised key on $type ($retired → $current)", (entry) => {
        const findings = lintNote(note(entry.type, { data: { [entry.retired]: "x" } }), opts);
        const unknown = findings.filter((f: any) =>
            f.message.includes("is not a `data:` property declared by"),
        );
        expect(unknown).toEqual([]);
    });

    it.each(renamed)("is reported once, naming what to write ($retired → $current)", (entry) => {
        const findings = lintNote(note(entry.type, { data: { [entry.retired]: "x" } }), opts);
        const reported = findings.filter(
            (f: any) =>
                f.message.includes(`\`${entry.retired}:\``) &&
                f.message.includes(`\`${entry.current}:\``),
        );
        expect(reported).toHaveLength(1);
        expect(reported[0]).toMatchObject({ severity: "warning" });
    });

    it.each(renamed)("is located at its own line and column ($retired)", (entry) => {
        const subject = note(entry.type, { data: { [entry.retired]: "x" } });
        const findings = lintNote(subject, opts).filter((f: any) =>
            f.message.includes(`\`${entry.retired}:\``),
        );
        // `---`, `type:`, `data:`, then the key — file line 4, indented four.
        expect(findings[0]).toMatchObject({ line: 4, column: 5 });
    });

    it.each(renamed)("reaches the infobox as the current field does ($current)", (entry) => {
        const overlay = overlayFor(NOTE_FIELD_PRESENTATION, entry.type, entry.current);
        if (overlay.withheld) return;
        const current = noteInfobox({ type: entry.type, data: { [entry.current]: "689/6/19" } });
        const retired = noteInfobox({ type: entry.type, data: { [entry.retired]: "689/6/19" } });
        expect(retired).toEqual(current);
    });

    it.each(renamed)("loses to the current spelling where both are written ($current)", (entry) => {
        const overlay = overlayFor(NOTE_FIELD_PRESENTATION, entry.type, entry.current);
        if (overlay.withheld) return;
        const box = noteInfobox({
            type: entry.type,
            data: { [entry.current]: "689/6/19", [entry.retired]: "700/1/1" },
        });
        expect(JSON.stringify(box)).toContain("689/6/19");
        expect(JSON.stringify(box)).not.toContain("700/1/1");
    });

    it.each(renamed)("is measured as the key it becomes, not as a stray ($retired)", (entry) => {
        const format = loadContentFormat();
        const findings = measureNote(
            note(entry.type, { data: { [entry.retired]: "x" } }),
            format,
        ).filter((f: any) => f.class === "unknown-data-key");
        expect(findings).toEqual([]);
    });
});
