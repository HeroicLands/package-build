/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { compileEncoding, encodeText, validateSource, EncodingError } from "../engine/encoding.mjs";
const read = (name: string) =>
    JSON.parse(
        fs.readFileSync(new URL(`./fixtures/encoding-notes/${name}.json`, import.meta.url), "utf8"),
    );
const codes = read("semaron-codes");
const template = () => read("aelwythi-semaron");
const compile = (data = template()) => compileEncoding(data, { codes });
describe("Roman source validation independent of native row coverage", () => {
    it("allows declared words in codage-only notes without inventing ordinary rows", () => {
        const enc = compileEncoding(
            {
                language: "test",
                font: "test",
                accepts: ["a"],
                mappings: {},
                rules: { normalization: "NFC", matching: "longest-first" },
            },
            { codes: { GLYPH: "𞰀" } },
        );
        expect(validateSource(enc, "a")).toBeUndefined();
        expect(validateSource(enc, "⟦GLYPH U+1F600⟧")).toBeUndefined();
        expect(() => encodeText(enc, "a")).toThrow(EncodingError);
        expect(() => validateSource(enc, "a\nx")).toThrow(
            expect.objectContaining({ offset: 2, line: 2, column: 1 }),
        );
    });
    it("preserves NFC source offsets and bounded checks", () => {
        const enc = compile();
        expect(validateSource(enc, "a\u0301b")).toBeUndefined();
        expect(validateSource(enc, "😀a\u0301b", { start: 2 })).toBeUndefined();
        expect(() => validateSource(enc, "a\u0301b", { start: 1 })).toThrow(
            expect.objectContaining({ offset: 1, column: 2 }),
        );
        expect(() => validateSource(enc, "😀\nCH", { start: 3 })).toThrow(
            expect.objectContaining({ offset: 3, line: 2, column: 1 }),
        );
    });
    it("enforces declared case and vowel rules even when row coverage is absent", () => {
        const data = template();
        data.accepts.push("ä", "à");
        // The same declarations also govern source authored with a native writing.
        const enc = compile(data);
        for (const [text, offset, message] of [
            ["CH", 0, /group/],
            ["aí", 1, /first vowel/],
            ["a\u0308", 0, /Diaeresis/],
            ["à", 0, /Grave/],
        ] as const)
            expect(() => validateSource(enc, text)).toThrow(
                expect.objectContaining({ offset, message: expect.stringMatching(message) }),
            );
        expect(validateSource(enc, "tsH")).toBeUndefined();
        expect(() => encodeText(enc, "tsH")).not.toThrow();
    });
    it("parses literal spans strictly instead of treating their payload as Roman", () => {
        const enc = compile();
        expect(validateSource(enc, "⟦ANKRON_MIN U+1F600⟧")).toBeUndefined();
        for (const text of ["⟦MISSING⟧", "⟦U+D800⟧", "⟦U+110000⟧", "⟦ANKRON_MIN"])
            expect(() => validateSource(enc, text)).toThrow(EncodingError);
        expect(() => validateSource(enc, "a\n⟦U+D800⟧")).toThrow(
            expect.objectContaining({ offset: 3, line: 2, column: 2 }),
        );
    });
    it("requires every constituent character to be accepted and respects shared indentation", () => {
        const enc = compileEncoding(
            {
                language: "test",
                font: "test",
                accepts: ["a"],
                mappings: { ab: "GLYPH" },
                rules: { normalization: "NFC", matching: "longest-first" },
            },
            { codes: { GLYPH: "𞰀" } },
        );
        expect(() => validateSource(enc, "ab")).toThrow(
            expect.objectContaining({ offset: 1, column: 2 }),
        );
        expect(() => encodeText(enc, "ab")).toThrow(
            expect.objectContaining({ offset: 1, column: 2 }),
        );
        expect(validateSource(compile(), "^^a\n^a")).toBeUndefined();
        expect(() => validateSource(compile(), "a^")).toThrow(
            expect.objectContaining({ offset: 1, column: 2 }),
        );
    });
    it("checks vowel stress across an unrelated multiletter mapping boundary", () => {
        const data = template();
        data.mappings.ba = "LONG_ANKRON_MIN";
        const enc = compile(data);
        expect(() => validateSource(enc, "baí")).toThrow(
            expect.objectContaining({
                offset: 2,
                column: 3,
                message: expect.stringMatching(/first vowel/),
            }),
        );
        expect(() => encodeText(enc, "baí")).toThrow(
            expect.objectContaining({ offset: 2, column: 3 }),
        );
    });
});
