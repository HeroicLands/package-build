// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from "vitest";
import { compileRows as compileEncoding } from "../engine/encoding.mjs";
import { encodeWithLanguage } from "../engine/encoding-language.mjs";
const enc = compileEncoding({
    name: "letters",
    fonts: ["first", "second"],
    accepts: ["a-z", "A-Z"],
    separator: " ",
    rows: [
        ["a", "α"],
        ["A", "Α"],
        ["b", "β"],
        ["th", "θ"],
        ["Th", "Θ"],
    ],
    faces: { second: { rows: [["A", "Ꭿ"]] } },
});
const native = (form: string, text: string, extra: any = {}) => ({
    form,
    class: "n",
    gloss: "a word",
    native: [{ enc: "letters", text }],
    ...extra,
});
it("capitalizes lowercase native exceptions by the first row including a multiletter group", () => {
    const lexicon = {
        language: "test",
        data: { words: [native("ab", "αχ"), native("thab", "θχ")] },
    };
    expect(encodeWithLanguage(enc, "ab Ab Thab", { lexicon })).toMatchObject({
        text: "αχ Αχ Θχ",
        findings: [],
    });
    expect(encodeWithLanguage(enc, "Ab", { lexicon, font: "second" })).toMatchObject({
        text: "Ꭿχ",
        findings: [],
    });
});
it("prefers exact cased citations or variants and refuses a capital the rows cannot infer at the word", () => {
    const lexicon = {
        language: "test",
        data: {
            words: [
                native("ab", "αχ"),
                native("Ab", "Ξ"),
                native("thab", "ξ", { variants: ["Thab"] }),
            ],
        },
    };
    expect(encodeWithLanguage(enc, "Ab Thab", { lexicon })).toMatchObject({
        text: "Ξ ξ",
        findings: [],
    });
    const missing = { language: "test", data: { words: [native("ab", "ξ")] } };
    expect(encodeWithLanguage(enc, "a Ab", { lexicon: missing })).toMatchObject({
        text: "",
        findings: [
            { offset: 2, line: 1, column: 3, message: expect.stringMatching(/capitalize.*ab.*Ab/) },
        ],
    });
});

it("reads inferable capitalized native exceptions back without changing authored-case precedence", async () => {
    const { decodeWithLanguage } = await import("../engine/encoding-language.mjs");
    const lexicon = {
        language: "test",
        data: { words: [native("ab", "αχ"), native("thab", "θχ")] },
    };
    for (const form of ["Ab", "Thab"]) {
        const encoded = encodeWithLanguage(enc, form, { lexicon });
        expect(decodeWithLanguage(enc, encoded.text, { lexicon })).toMatchObject({
            text: form,
            findings: [],
        });
    }
    expect(encodeWithLanguage(enc, "AB", { lexicon }).findings).toHaveLength(1);
});
