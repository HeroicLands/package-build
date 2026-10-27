// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from "vitest";
import { compileRows as compileEncoding } from "../engine/encoding.mjs";
import { encodeWithLanguage, decodeWithLanguage } from "../engine/encoding-language.mjs";
const enc = compileEncoding({
    name: "letters",
    fonts: ["face"],
    accepts: ["a-z", ".", ","],
    separator: " ",
    rows: [..."loram.,"].map((char) => [char, char]),
    codes: [["SIGN", "λ"]],
});
const word = (form: string, text: string, variants: string[] = []) => ({
    form,
    class: "n",
    gloss: form,
    variants,
    native: [{ enc: "letters", text }],
});
it("honors longest complete authored native phrases and variants without entering codage", () => {
    const lexicon = {
        language: "test",
        data: {
            words: [word("lor", "ξ"), word("lor ram", "λ", ["lor, ram"]), word("lor ram lor", "ψ")],
        },
    };
    const result = encodeWithLanguage(enc, "lor ram lor. lor, ram. lor ram. ⟦SIGN⟧", { lexicon });
    expect(result.findings).toEqual([]);
    expect(
        result.pieces
            .filter((piece) => piece.native)
            .map((piece) => [piece.from, piece.start, piece.end]),
    ).toEqual([
        ["lor ram lor", 0, 11],
        ["lor, ram", 13, 21],
        ["lor ram", 23, 30],
    ]);
    expect(result.text.startsWith("ψ. λ. λ.")).toBe(true);
    expect(decodeWithLanguage(enc, "λ", { lexicon })).toMatchObject({
        text: "lor ram",
        findings: [],
    });
});
it("does not match a native phrase inside a longer word or cross a literal boundary", () => {
    const lexicon = { language: "test", data: { words: [word("lor ram", "λ")] } };
    const result = encodeWithLanguage(enc, "lor rama lor ⟦SIGN⟧ ram", { lexicon });
    expect(result.findings).toEqual([]);
    expect(result.pieces.some((piece) => piece.native)).toBe(false);
});
it("treats defined whitespace runs as equivalent in native phrases while retaining source offsets", () => {
    const lexicon = { language: "test", data: { words: [word("lor ram", "λ")] } };
    for (const gap of [" ", "\t\n", "\r\n", "\u00A0\u2003"]) {
        const source = `a lor${gap}ram.`;
        const result = encodeWithLanguage(enc, source, { lexicon });
        expect(result.findings).toEqual([]);
        expect(result.text).toBe("a λ.");
        expect(result.pieces.find((piece) => piece.native)).toMatchObject({
            from: `lor${gap}ram`,
            start: 2,
            end: 8 + gap.length,
        });
    }
});
it("does not let an unwritten registered phrase shadow a written component", () => {
    const lexicon = {
        language: "test",
        data: { words: [word("lor", "λ")], register: [{ name: "lor ram" }] },
    };
    expect(encodeWithLanguage(enc, "lor ram", { lexicon })).toMatchObject({
        text: "λ ram",
        findings: [],
    });
});
