/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { formatDiagnostic } from "../engine/diagnostics.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import * as vocabularyModule from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

/**
 * A being's gender, frame and appearance take their words from one closed
 * vocabulary, and `appearance.extra_features` stays free text.
 *
 * The fields are named here and their words read from the declaration, so a
 * word added to the vocabulary is covered without an edit. Every assertion
 * goes through the frontmatter lint, the check an author meets.
 */
const CLOSED_FIELDS = [
    "gender",
    "frame",
    "appearance.eye_color",
    "appearance.hair_color",
    "appearance.skin_color",
    "appearance.complexion",
] as const;

const { NOTE_VOCABULARY } = vocabularyModule;
const LOOK = ((vocabularyModule as Record<string, unknown>).BEING_LOOK_VOCABULARY ?? {}) as Record<
    string,
    ReadonlyArray<{ value: string; label: string; describe: string }>
>;

const file = "assets/content/Beings/Someone.md";

/** The frontmatter lines a field's value takes, below `data:`. */
function fieldLines(field: string, value: unknown): string[] {
    const [head, leaf] = field.split(".");
    const scalar = (v: unknown) => (typeof v === "string" ? JSON.stringify(v) : String(v));
    const rendered =
        Array.isArray(value) ?
            [`${leaf ?? head}:`, ...value.map((entry) => `    - ${scalar(entry)}`)]
        :   [`${leaf ?? head}: ${scalar(value)}`];
    if (!leaf) return rendered.map((line) => `    ${line}`);
    return ["    appearance:", ...rendered.map((line) => `        ${line}`)];
}

/** A creature stating one field, written as an author would. */
function being(field: string, value: unknown) {
    const lines = [
        "---",
        "shortcode: someone",
        'name: { full: "Someone" }',
        "type: being",
        "subType: creature",
        "data:",
        ...fieldLines(field, value),
        "---",
        "",
        "Someone stands in the road and looks at the travellers as they pass by the inn door.",
        "",
    ];
    const raw = lines.join("\n");
    const fm = YAML.parse(raw.split("---\n")[1]);
    return { file, raw, type: "being", fm };
}

/** The findings that name one field. */
function findingsOn(field: string, value: unknown) {
    const label = `data.${field}`;
    return lintNote(being(field, value), {
        schemas: NOTE_SCHEMAS,
        vocabulary: NOTE_VOCABULARY,
    } as any).filter((finding: { message: string }) => finding.message.includes(label));
}

/** The 1-based line and column of the `index`-th value line of a field. */
function valueAt(note: { raw: string }, field: string, index?: number) {
    const leaf = field.split(".").at(-1) as string;
    const lines = note.raw.split("\n");
    const keyLine = lines.findIndex((line) => line.trimStart().startsWith(`${leaf}:`));
    if (index === undefined) {
        const column = lines[keyLine].indexOf(`${leaf}:`) + `${leaf}: `.length + 1;
        return { line: keyLine + 1, column };
    }
    const line = keyLine + 1 + index;
    return { line: line + 1, column: lines[line].indexOf("- ") + 3 };
}

describe("a being's look takes its words from a closed vocabulary", () => {
    it("declares a described word list for every closed field", () => {
        expect(Object.keys(LOOK).sort()).toEqual([...CLOSED_FIELDS].sort());
        for (const field of CLOSED_FIELDS) {
            const words = LOOK[field] ?? [];
            expect(words.length, field).toBeGreaterThan(0);
            for (const word of words) {
                expect(word.value, field).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
                expect(word.label.trim(), `${field} ${word.value}`).toBeTruthy();
                expect(word.describe.trim(), `${field} ${word.value}`).toBeTruthy();
            }
        }
    });

    for (const field of CLOSED_FIELDS) {
        describe(`data.${field}`, () => {
            it("accepts every word of its vocabulary", () => {
                for (const { value } of LOOK[field] ?? []) {
                    expect(findingsOn(field, value), value).toEqual([]);
                }
            });

            it("refuses a word outside it, naming every allowed word", () => {
                const note = being(field, "turquoise");
                const findings = findingsOn(field, "turquoise");
                expect(findings).toHaveLength(1);
                const at = valueAt(note, field);
                expect(formatDiagnostic(findings[0])).toMatch(
                    new RegExp(`^${file}:${at.line}:${at.column}: error: `),
                );
                expect(findings[0].message).toContain('"turquoise"');
                for (const { value } of LOOK[field] ?? []) {
                    expect(findings[0].message).toContain(`\`${value}\``);
                }
            });

            it("refuses an empty value, which is no word", () => {
                expect(findingsOn(field, "")).toHaveLength(1);
            });

            it("refuses a near-miss spelling of a word", () => {
                const first = LOOK[field]?.[0]?.value ?? "word";
                const spelt = first.toUpperCase();
                const findings = findingsOn(field, spelt);
                expect(findings).toHaveLength(1);
                expect(findings[0].message).toContain(JSON.stringify(spelt));
            });
        });
    }

    it("reads a complexion list word by word, refusing the stray at its own entry", () => {
        const words = (LOOK["appearance.complexion"] ?? []).map(({ value }) => value);
        expect(findingsOn("appearance.complexion", words)).toEqual([]);

        const value = [words[0] ?? "clear", "attractive"];
        const note = being("appearance.complexion", value);
        const findings = findingsOn("appearance.complexion", value);
        expect(findings).toHaveLength(1);
        const at = valueAt(note, "appearance.complexion", 1);
        expect(formatDiagnostic(findings[0])).toMatch(
            new RegExp(`^${file}:${at.line}:${at.column}: error: `),
        );
        expect(findings[0].message).toContain("data.appearance.complexion[1]");
        expect(findings[0].message).toContain('"attractive"');
    });

    it("accepts the owner's added words", () => {
        const added: Array<[string, string]> = [
            ["appearance.skin_color", "dark"],
            ["appearance.skin_color", "swarthy"],
            ["appearance.hair_color", "strawberry_blond"],
            ["appearance.eye_color", "black"],
        ];
        for (const [field, value] of added) {
            expect(
                (LOOK[field] ?? []).some((word) => word.value === value),
                `${field} ${value}`,
            ).toBe(true);
            expect(findingsOn(field, value), `${field} ${value}`).toEqual([]);
        }
    });

    it("spells grey the British way, and suggests it for gray", () => {
        for (const field of ["appearance.eye_color", "appearance.hair_color"]) {
            expect(findingsOn(field, "grey"), field).toEqual([]);
            const findings = findingsOn(field, "gray");
            expect(findings, field).toHaveLength(1);
            expect(findings[0].message).toContain('Did you mean "grey"?');
        }
        for (const value of ["greying_black", "greying_brown"]) {
            expect(findingsOn("appearance.hair_color", value), value).toEqual([]);
        }
        const graying = findingsOn("appearance.hair_color", "graying_brown");
        expect(graying).toHaveLength(1);
        expect(graying[0].message).toContain('Did you mean "greying_brown"?');
    });

    it("leaves extra_features free text", () => {
        const features = ["a burn scar across the left hand", "turquoise", "Walks with a limp"];
        expect(findingsOn("appearance.extra_features", features)).toEqual([]);
    });
});
