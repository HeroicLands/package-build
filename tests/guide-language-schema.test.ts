/* SPDX-License-Identifier: GPL-3.0-or-later */

import fs from "node:fs";
import { parse, stringify } from "yaml";
import { describe, expect, it } from "vitest";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { checkLanguageData, checkGuideSounds } from "../engine/language-data.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import {
    HARMONY_FIELDS,
    SKELETON_FIELDS,
    SYLLABLE_FIELDS,
    EDGE_KINDS,
} from "../engine/language-terms.mjs";
import { LANGUAGE_RELATIONS, finalRows, markRows } from "../engine/language-rows.mjs";

const guide = parse(
    fs
        .readFileSync(
            new URL("./fixtures/sound-guides/Pronouncing_Thalorna.md", import.meta.url),
            "utf8",
        )
        .split("---")[1],
);
const guideSpellings = guide.data.sounds.letters.flatMap((row: any) =>
    row.letters.map((spelling: string) => ({ spelling, vowel: row.kind.includes("vowel") })),
);
function note(sounds: object, type = "skill") {
    const fm = {
        type,
        ...(type === "skill" ? { subType: "language" } : {}),
        shortcode: "test",
        name: { full: "Test" },
        data: { sounds },
    };
    return { file: "test.md", fm, raw: `---\n${stringify(fm)}---\n` };
}
const lint = (value: ReturnType<typeof note>) =>
    lintNote(value, { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY });
const singleFields = [
    ...HARMONY_FIELDS.filter((field) => field.kind === "list").map((field) => ({
        path: `syllables.harmony.${field.name}`,
        sounds: (value: string) => ({
            syllables: { harmony: { back: [], front: [], [field.name]: [value] } },
        }),
    })),
    ...SKELETON_FIELDS.filter((field) => field.shape.startsWith("a vowel")).map((field) => ({
        path: `skeleton[0].${field.name}`,
        sounds: (value: string) => ({ skeleton: [{ second: "any", [field.name]: value }] }),
    })),
];
const sequenceFields = [
    ...SYLLABLE_FIELDS.filter((field) => field.shape === "a list of vowel pairs").map((field) => ({
        path: `syllables.${field.name}`,
        sounds: (value: string) => ({ syllables: { [field.name]: [value] } }),
    })),
    ...EDGE_KINDS.filter((edge) => edge === "vowelPair").map((edge) => ({
        path: "edges[0].sounds",
        sounds: (value: string) => ({ edges: [{ edge, sounds: [value] }] }),
    })),
];

describe("language definitions obey the shared guide", () => {
    it.each([
        { readPast: [{ written: "a", what: "silent letter" }] },
        { readPast: [{ written: "y", readAs: "i", what: "vowel reading" }] },
        { marks: [{ mark: "grave", letters: ["à"], kind: "stress", limit: "any" }] },
        { finals: [{ final: "ang", like: "ee" }] },
        { finals: [{ final: "ang", like: "ee", ipa: "i" }] },
        { finals: [{ final: "ang", ipa: "i" }] },
        { edges: [{ edge: "syllabic", sounds: ["y"] }] },
    ])("refuses independent readings through the public note validator: %j", (sounds) => {
        expect(lint(note(sounds)).some((finding: any) => finding.severity === "error")).toBe(true);
    });

    for (const validate of [lint, checkLanguageData]) {
        it(`${validate.name} classifies every guide spelling at each declared vowel field`, () => {
            expect(singleFields.map((field) => field.path)).toEqual([
                "syllables.harmony.back",
                "syllables.harmony.front",
                "syllables.harmony.neutral",
                "skeleton[0].between",
            ]);
            expect(sequenceFields).toHaveLength(2);
            for (const field of [...singleFields, ...sequenceFields])
                for (const { spelling, vowel } of guideSpellings) {
                    const findings = validate(note(field.sounds(spelling)));
                    expect(findings.length === 0, `${field.path}: ${spelling}`).toBe(vowel);
                }
        });
        it(`${validate.name} distinguishes whole vowels from vowel sequences`, () => {
            for (const field of singleFields)
                for (const value of ["ia", "a-", "a ", "", "🙂"])
                    if (value || !field.path.startsWith("skeleton"))
                        expect(
                            validate(note(field.sounds(value))).length,
                            `${field.path}: ${value}`,
                        ).toBeGreaterThan(0);
            for (const field of sequenceFields) {
                for (const value of ["iy", "uy", "ia", "aa", "aï"])
                    expect(validate(note(field.sounds(value))), `${field.path}: ${value}`).toEqual(
                        [],
                    );
                for (const value of ["y", "iya", "a-y", "", "a "])
                    expect(
                        validate(note(field.sounds(value))).length,
                        `${field.path}: ${value}`,
                    ).toBeGreaterThan(0);
            }
        });
        it(`${validate.name} applies vowel-pair rules to name edges`, () => {
            for (const value of ["y", "ia", "iy", "uy"]) {
                const valueNote = note({});
                (valueNote.fm.data as any).naming = {
                    edges: [{ edge: "vowelPair", sounds: [value] }],
                };
                valueNote.raw = `---\n${stringify(valueNote.fm)}---\n`;
                expect(validate(valueNote).length === 0, value).toBe(value !== "y");
            }
        });
        it(`${validate.name} checks harmony partners as guide vowels and set members`, () => {
            for (const harmony of [
                { back: ["a"], front: ["y"], partners: { a: "y" } },
                { back: ["y"], front: ["i"], partners: { y: "i" } },
                { back: ["a"], front: ["i"], partners: { u: "i" } },
                { back: ["a"], front: ["i"], partners: { a: "e" } },
            ])
                expect(validate(note({ syllables: { harmony } })).length).toBeGreaterThan(0);
            expect(
                validate(
                    note({
                        syllables: {
                            harmony: { back: ["uy"], front: ["iy"], partners: { uy: "iy" } },
                        },
                    }),
                ),
            ).toEqual([]);
        });
        it(`${validate.name} preserves written endings, consonantal y and empty constraints`, () => {
            expect(
                validate(
                    note({
                        letters: ["a", "y"],
                        finals: [{ final: "ay" }],
                        edges: [
                            { edge: "vowelPair", sounds: "any" },
                            { edge: "glide", sounds: ["y"] },
                        ],
                        syllables: {
                            codas: ["y"],
                            finals: "any",
                            doubled: ["yy"],
                            neverInitial: ["y"],
                            signature: ["y"],
                            vowelPairs: [],
                            harmony: { back: [], front: [], neutral: [] },
                        },
                        skeleton: [{ second: ["y"], third: "any", between: "" }],
                        joins: [{ meeting: "V+V", rule: "insert", letters: ["y"] }],
                    }),
                ),
            ).toEqual([]);
            expect(validate(note({ edges: [{ edge: "vowelPair", sounds: [] }] }))).toEqual([]);
        });
    }
    it("keeps authoritative guide mark declarations and exports only guide marks", () => {
        const sounds = { marks: [{ mark: "acute", letters: ["á"], kind: "stress", limit: "one" }] };
        expect(lint(note(sounds, "doc"))).toEqual([]);
        expect(checkGuideSounds(note(sounds, "doc"))).toEqual([]);
        const records = ["doc", "skill"].map((type) => ({
            ...note(sounds, type).fm,
            package: "demo",
        }));
        expect(markRows(records)).toHaveLength(1);
        expect(markRows(records)[0]).toMatchObject({ language: "demo-note-doc-test" });
    });
    it("exports written finals without independent readings", () => {
        expect(LANGUAGE_RELATIONS.map(([name]) => name)).not.toContain("read_past");
        expect(
            finalRows([
                {
                    ...note({ finals: [{ final: "ang", like: "ee", ipa: "i" }] }).fm,
                    package: "demo",
                },
            ]),
        ).toEqual([{ language: "demo-note-skill-test", position: 0, final: "ang" }]);
    });
});
