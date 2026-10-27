/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { compileRows as compileEncoding, encodeText, decodeText } from "../engine/encoding.mjs";
import { encodeWithLanguage, decodeWithLanguage } from "../engine/encoding-language.mjs";
const encodings = new URL("./fixtures/encodings/", import.meta.url);
const encoding = (name: string) =>
    compileEncoding(JSON.parse(fs.readFileSync(new URL(`${name}.json`, encodings), "utf8")));
const stripMarks = (text: string) => text.replace(/[\u{E0100}-\u{E01EF}]/gu, "");
const word = (form: string, text?: string, enc = "qalezu") => ({
    form,
    class: "n",
    gloss: form,
    ...(text === undefined ? {} : { native: [{ enc, text }] }),
});
describe("authoritative native decoding boundaries", () => {
    const enc = encoding("qalezu");
    for (const [kind, text] of [
        ["space", "𞨀 𞨁"],
        ["punctuation", "𞨀𞨷𞨁"],
    ])
        it(`reads an own writing across a ${kind} row`, () => {
            const lexicon = { language: "qal", data: { words: [word("lor", text)] } };
            const native = encodeWithLanguage(enc, "lor", { lexicon });
            expect(native.findings).toEqual([]);
            expect(decodeWithLanguage(enc, native.text, { lexicon })).toEqual({
                text: "lor",
                findings: [],
            });
            const passage = encodeWithLanguage(enc, "lor lor", { lexicon });
            expect(decodeWithLanguage(enc, passage.text, { lexicon })).toEqual({
                text: "lor lor",
                findings: [],
            });
        });
    it("recovers a whole-word skeleton before interpreting a shorter native prefix", () => {
        const lexicon = { language: "qal", data: { words: [word("lor", "𞨀𞨁"), word("laram")] } };
        const native = stripMarks(encodeText(enc, "laram"));
        expect(decodeWithLanguage(enc, native, { lexicon })).toEqual({
            text: "laram",
            findings: [],
        });
        const marked = encodeText(enc, "liram");
        expect(decodeWithLanguage(enc, marked, { lexicon })).toEqual({
            text: decodeText(enc, marked),
            findings: [],
        });
    });
    it("keeps an earlier entry's variant before a later citation when skeletons tie", () => {
        const lexicon = {
            language: "qal",
            data: { words: [{ ...word("razan"), variants: ["laram"] }, word("liram")] },
        };
        const raw = stripMarks(encodeText(enc, "laram"));
        expect(decodeWithLanguage(enc, raw, { lexicon })).toEqual({ text: "laram", findings: [] });
    });
    it("preserves the longest cross-boundary writing and first listed tie", () => {
        const lexicon = {
            language: "qal",
            data: { words: [word("lor", "𞨀"), word("lar", "𞨀 𞨁"), word("lir", "𞨀 𞨁")] },
        };
        expect(decodeWithLanguage(enc, "𞨀 𞨁", { lexicon })).toEqual({ text: "lar", findings: [] });
    });
    it("retains no-letter longest segmentation and recovers known signs after unknown signs", () => {
        const enc = encoding("zethu");
        const lexicon = {
            language: "zet",
            data: { words: [word("rava", "𞰀", "zethu"), word("ravan", "𞰀𞰁", "zethu")] },
        };
        expect(decodeWithLanguage(enc, "𞰀𞰁𞰀", { lexicon })).toEqual({
            text: "ravan rava",
            findings: [],
        });
        const result = decodeWithLanguage(enc, "𞰂𞰀", { lexicon });
        expect(result.text).toMatch(/^⟦.+⟧ rava$/u);
        expect(result.findings).toHaveLength(1);
        expect(result.findings[0]).toMatchObject({ offset: 0, line: 1, column: 1 });
    });
});

it("keeps ordinary row case and recovers authored and folded names as whole phrases", () => {
    const enc = encoding("aelwythi-semaron");
    const lexicon = {
        language: "aelw",
        data: {
            words: [word("say", undefined, "aelwythi-semaron")],
            register: [
                { name: "Adwell Gate", tongue: "aelw" },
                { name: "Adwell", tongue: "aelw" },
                { name: "Dunith", tongue: "aelw" },
            ],
        },
    };
    expect(decodeWithLanguage(enc, encodeText(enc, "Say"), { lexicon })).toMatchObject({
        text: "Say",
        findings: [],
    });
    for (const name of ["Adwell", "adwell", "Dunith", "dunith", "Adwell Gate", "adwell gate"]) {
        const native = stripMarks(encodeText(enc, name));
        expect(decodeWithLanguage(enc, native, { lexicon }), name).toMatchObject({
            text: `{${name.toLowerCase()}}`,
            findings: [],
        });
    }
    const marked = encodeText(enc, "Ádwell Gate");
    expect(decodeWithLanguage(enc, marked, { lexicon }).text).toBe(decodeText(enc, marked));
});
