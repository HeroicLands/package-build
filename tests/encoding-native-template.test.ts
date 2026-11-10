/* Copyright (c) 2026 Tom Rodriguez ("Toasty")
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { compileEncoding, encodeText } from "./helpers/encoding-row-note.js";
import { encodeWithLanguage, decodeWithLanguage } from "../engine/encoding-language.mjs";

const name = "demo-note-doc-signs";
const codes = { FIRST: "\u{1EB57}", SECOND: "\u{1EB58}" };
function template(mappings: Record<string, string> = {}) {
    return compileEncoding(
        {
            language: "khel",
            font: "test-signs",
            mappings,
            rules: { normalization: "NFC", matching: "longest-first" },
        },
        { name, codes },
    );
}
const lexicon = {
    language: "khel",
    data: {
        words: [
            {
                form: "ez",
                class: "part",
                gloss: "first",
                native: [{ enc: name, text: codes.FIRST }],
            },
            {
                form: "elu",
                class: "part",
                gloss: "later",
                native: [{ enc: name, text: codes.FIRST }],
            },
            { form: "ezar", class: "n", gloss: "composed", built: ["ez", "-ar"] },
        ],
        affixes: [{ form: "-ar", native: [{ enc: name, text: codes.SECOND }] }],
    },
};

describe("native lexical writings in actual encoding templates", () => {
    it("writes known words and composed parts in a codes-only script and recovers its first reading", () => {
        const encoding = template();
        for (const [roman, native] of [
            ["ez", codes.FIRST],
            ["ezar", codes.FIRST + codes.SECOND],
        ]) {
            const result = encodeWithLanguage(encoding, roman, { lexicon });
            expect(result.findings).toEqual([]);
            expect(result.text).toBe(native);
            expect(decodeWithLanguage(encoding, native, { lexicon })).toEqual({
                text: roman,
                findings: [],
            });
        }
    });
    it("keeps explicitly authored capitals and refuses unsupported capitalization", () => {
        const encoding = template();
        const capital = {
            language: "khel",
            data: {
                words: [
                    ...lexicon.data.words,
                    { form: "Ez", native: [{ enc: name, text: codes.SECOND }] },
                ],
            },
        };
        expect(encodeWithLanguage(encoding, "Ez", { lexicon: capital })).toMatchObject({
            text: codes.SECOND,
            findings: [],
        });
        expect(encodeWithLanguage(encoding, "Ez", { lexicon })).toMatchObject({
            text: "",
            findings: [{ message: expect.stringContaining("cannot capitalize") }],
        });
    });
    it("reports an unknown Roman word at its input position", () => {
        expect(encodeWithLanguage(template(), "ez\nmissing", { lexicon })).toMatchObject({
            text: "",
            findings: [
                {
                    offset: 3,
                    line: 2,
                    column: 1,
                    message: expect.stringContaining("has no writing"),
                },
            ],
        });
    });
    it("keeps residual source and codage validation outside native substitutions", () => {
        const encoding = template();
        expect(encodeWithLanguage(encoding, "ez ⟦SECOND⟧", { lexicon })).toMatchObject({
            text: `${codes.FIRST} ${encodeText(encoding, "⟦SECOND⟧")}`,
            findings: [],
        });
        expect(encodeWithLanguage(encoding, "ez ☃", { lexicon })).toMatchObject({
            text: "",
            findings: [{ offset: 3, line: 1, column: 4 }],
        });
        for (const text of ["ez ⟦MISSING⟧", "ez ⟦SECOND"]) {
            const result = encodeWithLanguage(encoding, text, { lexicon });
            expect(result.text).toBe("");
            expect(result.findings.length).toBeGreaterThan(0);
            expect(result.findings[0].offset).toBeGreaterThanOrEqual(3);
        }
    });
    it("retains alphabetic spelling validation before native overrides", () => {
        const encoding = template({ a: "FIRST" });
        const restricted = {
            language: "khel",
            data: { words: [{ form: "x", native: [{ enc: name, text: codes.SECOND }] }] },
        };
        expect(encodeWithLanguage(encoding, "a", { lexicon: restricted })).toMatchObject({
            text: codes.FIRST,
            findings: [],
        });
        expect(encodeWithLanguage(encoding, "a\nx", { lexicon: restricted })).toMatchObject({
            text: "",
            findings: [{ offset: 2, line: 2, column: 1 }],
        });
    });
    it("preserves bare encoding refusal and native ambiguity findings", () => {
        const encoding = template();
        expect(() => encodeText(encoding, "ez")).toThrow();
        expect(encodeWithLanguage(encoding, "ez").findings[0].message).toContain("not in");
        const ambiguous = {
            language: "khel",
            data: {
                words: [
                    ...lexicon.data.words,
                    { form: "ez", gloss: "different", native: [{ enc: name, text: codes.SECOND }] },
                ],
            },
        };
        expect(encodeWithLanguage(encoding, "ez", { lexicon: ambiguous })).toMatchObject({
            text: "",
            findings: [{ message: expect.stringContaining("ambiguous writings") }],
        });
    });
});
