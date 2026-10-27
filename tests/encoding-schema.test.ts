// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { compileRows as compileEncoding } from "../engine/encoding.mjs";
import { checkLexiconNatives, nativeRows, lexiconEntries } from "../engine/encoding-lexicon.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
const encoding = compileEncoding({
    name: "letters",
    fonts: ["first", "second"],
    accepts: ["a"],
    separator: " ",
    rows: [["a", "A"]],
});
const encodings = new Map([[encoding.name, encoding]]);
const fm = (data: any) => ({
    type: "skill",
    subType: "language",
    shortcode: "test",
    name: { full: "Test" },
    data,
});
const note = (value: any) => ({
    file: "language.md",
    fm: value,
    raw: `---\n${YAML.stringify(value)}---\n`,
});
describe("encoding declarations and language native data", () => {
    it("refuses data.map, data.writtenIn and native.map through ordinary unknown-key checks", () => {
        for (const value of [
            {
                type: "doc",
                shortcode: "old",
                name: { full: "Old" },
                data: { map: { name: "old", rows: [["a", "A"]] } },
            },
            fm({ writtenIn: { map: "letters", font: "first" } }),
            fm({
                words: [
                    {
                        form: "a",
                        class: "n",
                        gloss: "one",
                        field: "Words",
                        native: [{ map: "letters", text: "A" }],
                    },
                ],
            }),
        ]) {
            const errors = lintNote(note(value), {
                schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
                vocabulary: NOTE_VOCABULARY,
            });
            expect(
                errors.some(
                    (e: any) =>
                        /map|writtenIn/.test(e.message) &&
                        /unknown|not (a|an)|unrecognized|does not|not declared|key/i.test(
                            e.message,
                        ),
                ),
            ).toBe(true);
        }
    });
    it("permits native affixes and endings under an ordinary encoding, while checking duplicate slots, faces and source positions", () => {
        const good = note(
            fm({
                affixes: [{ form: "-a", native: [{ enc: "letters", text: "A" }] }],
                grammar: { native: [{ ending: "plural", enc: "letters", text: "A" }] },
            }),
        );
        expect(checkLexiconNatives(good, { encodings })).toEqual([]);
        const bad = note(
            fm({
                words: [
                    {
                        form: "a",
                        native: [
                            { enc: "missing", text: "A" },
                            { enc: "letters", font: "absent", text: "A" },
                            { enc: "letters", text: "A" },
                            { enc: "letters", text: "B" },
                        ],
                    },
                ],
            }),
        );
        const errors = checkLexiconNatives(bad, { encodings });
        expect(errors).toHaveLength(4);
        expect(
            errors.every((e: any) => e.file === "language.md" && e.line > 1 && e.column > 0),
        ).toBe(true);
    });
    it("projects authored native rows with an enc column, preserving same-spelling senses and case", () => {
        const record = {
            ...fm({
                words: [
                    { form: "a", native: [{ enc: "letters", text: "A" }] },
                    { form: "A", native: [{ enc: "letters", font: "second", text: "B" }] },
                ],
            }),
            package: "demo",
            system: "note",
        };
        expect(nativeRows([record]).map((r: any) => [r.form, r.enc, r.font, r.text])).toEqual([
            ["a", "letters", null, "A"],
            ["A", "letters", "second", "B"],
        ]);
    });
});
