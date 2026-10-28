/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { compileEncoding, encodeText, decodeText } from "../engine/encoding.mjs";
const compile = (mappings: object, codes: Record<string, string> = { A: "0", B: "1" }) =>
    compileEncoding(
        {
            language: "test",
            font: "test",
            mappings,
            rules: { normalization: "NFC", matching: "longest-first" },
        },
        { codes },
    );
describe("lossless encoding output integrity", () => {
    it("refuses an output sequence that also spells different input characters", () => {
        expect(() => compile({ a: "A", b: "B", k: ["A", "B"] })).toThrow(
            expect.objectContaining({
                key: "mappings.k",
                message: expect.stringMatching(/ambiguous|uniquely/i),
            }),
        );
    });
    it("allows prefix modifiers that cannot stand alone", () => {
        const enc = compile({ a: "A", á: ["A", "STRESS"] }, { A: "0", STRESS: "\u{E0114}" });
        for (const text of ["aá", "áa", "áá", "aa"])
            expect(decodeText(enc, encodeText(enc, text))).toBe(text);
    });
    it("terminates on uniquely decodable residual cycles and decodes past a greedy dead end", () => {
        const enc = compile({ a: "A", b: ["A", "B"], k: ["B", "B"] });
        for (const text of ["ak", "bk", "kkk", "akbkak"])
            expect(decodeText(enc, encodeText(enc, text))).toBe(text);
    });
    it("refuses an ambiguity reached only after several residual steps", () => {
        expect(() => compile({ a: "A", b: ["A", "B"], k: ["B", "A"] })).toThrow(
            /ambiguous|uniquely/i,
        );
    });
    it("uses the font producer's exact code-name alphabet", () => {
        const enc = compile({ a: "1", b: "_A" }, { "1": "0", _A: "1" });
        expect(decodeText(enc, encodeText(enc, "ab⟦1 _A⟧"))).toBe("ab⟦1 _A⟧");
        expect(() => compile({ a: "BAD-CODE" }, { "BAD-CODE": "0" })).toThrow(
            expect.objectContaining({ key: "options.codes.BAD-CODE" }),
        );
    });
    it("allows only provably identical source and output compositions", () => {
        const enc = compile({ a: "A", b: "B", ab: ["A", "B"] });
        expect(decodeText(enc, encodeText(enc, "abab"))).toBe("abab");
        expect(() => compile({ a: "A", b: "B", ak: ["A", "B"] })).toThrow(/ambiguous|uniquely/i);
    });

    it("decodes a passage larger than a stream chunk without recursive suffix copies", () => {
        const enc = compile({ a: "A", b: ["A", "B"], k: ["B", "B"] });
        const text = "ak".repeat(35_000);
        expect(decodeText(enc, encodeText(enc, text))).toBe(text);
    });
    it("includes ordinary whitespace in output integrity and reserves structural controls", () => {
        expect(() => compile({ a: "A", b: ["A", "SPACE"] }, { A: "0", SPACE: " " })).toThrow(
            expect.objectContaining({ key: "mappings.b" }),
        );
        expect(() => compile({ a: "STANZA" }, { STANZA: "\u{E010D}" })).toThrow(
            expect.objectContaining({ key: "mappings.a" }),
        );
        expect(() => compile({ a: "SLASH" }, { SLASH: "\u{E010F}" })).toThrow(
            expect.objectContaining({ key: "mappings.a" }),
        );
    });
    it("locates the unsupported scalar after a valid nonprefix sequence", () => {
        const enc = compile({ a: "A", b: ["A", "B"], k: ["B", "B"] });
        expect(() => decodeText(enc, "0112")).toThrow(
            expect.objectContaining({ offset: 3, line: 1, column: 4 }),
        );
        const astral = compile({ a: "A", b: ["A", "B"], k: ["B", "B"] }, { A: "😀", B: "😁" });
        expect(() => decodeText(astral, "😀😁😁😂")).toThrow(
            expect.objectContaining({ offset: 6, line: 1, column: 4 }),
        );
        const literal = encodeText(enc, "⟦A⟧");
        expect(() => decodeText(enc, literal + "2")).toThrow(
            expect.objectContaining({ offset: literal.length, line: 1, column: 4 }),
        );
    });
});
