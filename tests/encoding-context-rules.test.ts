/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
    compileEncoding,
    encodeText,
    decodeText,
    validateSource,
    EncodingError,
} from "../engine/encoding.mjs";
const codes = { A: "α", B: "β", K: "κ", S: "σ", BEFORE: "γ", FINAL: "δ", INITIAL: "ε", LINE: "ζ" };
const note = (rules: object = {}, mappings: object = { a: "A", b: "B", k: "K", s: "S" }) => ({
    language: "test",
    font: "test",
    vowels: "a",
    mappings,
    rules: { normalization: "NFC", matching: "longest-first", ...rules },
});
const compile = (data = note()) => compileEncoding(data, { codes });
describe("authored contextual encoding rules", () => {
    it("executes before-consonant and word positions through the shared row semantics", () => {
        const enc = compile(
            note({
                "contextual-mappings": [
                    { match: "k", before: "consonant", emit: "BEFORE" },
                    { match: "k", at: "end", emit: "FINAL" },
                    { match: "k", at: "start", emit: "INITIAL" },
                ],
            }),
        );
        for (const [source, native] of [
            ["kb", "γβ"],
            ["ka", "εα"],
            ["akb", "αγβ"],
            ["ak", "αδ"],
            ["aka", "ακα"],
            ["ak!", "αδ\u{E0103}"],
        ]) {
            expect(encodeText(enc, source)).toBe(native);
            expect(decodeText(enc, native)).toBe(source);
        }
    });
    it("combines position and following-letter conditions instead of matching either alone", () => {
        const enc = compile(
            note({
                "contextual-mappings": [
                    { match: "k", at: "start", before: "consonant", emit: "INITIAL" },
                ],
            }),
        );
        expect(encodeText(enc, "kb ka akb")).toBe("εβ κα ακβ");
    });
    it("recognizes line start after slash or newline and keeps word spaces", () => {
        const enc = compile(
            note({ "contextual-mappings": [{ match: "k", at: "line-start", emit: "LINE" }] }),
        );
        expect(encodeText(enc, "ka/ka\nka")).toBe("ζα\u{E010C}ζα\u{E010C}ζα");
        expect(encodeText(enc, "a ka")).toBe("α κα");
    });
    it("rejects duplicate conditions but accepts distinct conditions for one source", () => {
        const row = { match: "k", before: "consonant", at: "start", emit: "BEFORE" };
        expect(() =>
            compile(note({ "contextual-mappings": [row, { ...row, emit: "FINAL" }] })),
        ).toThrow(expect.objectContaining({ key: "rules.contextual-mappings.1.match" }));
        const enc = compile(
            note({
                "contextual-mappings": [
                    { match: "k", before: "vowel", emit: "BEFORE" },
                    { match: "k", before: "consonant", emit: "BEFORE" },
                ],
            }),
        );
        expect(decodeText(enc, encodeText(enc, "ka kb"))).toBe("ka kb");
    });
    it("keeps contextual inverse refusal strict in exact encodings", () => {
        const enc = compile(
            note({ "contextual-mappings": [{ match: "k", before: "consonant", emit: "BEFORE" }] }),
        );
        expect(() => decodeText(enc, "γα")).toThrow(EncodingError);
        expect(decodeText(enc, "γβ")).toBe("kb");
    });
    it.each([
        { match: "k", emit: "K" },
        { match: "k", before: "end", emit: "K" },
        { match: "k", at: "middle", emit: "K" },
        { match: "k", at: "end", emit: "K", unknown: true },
    ])("rejects unsupported or absent context conditions %j", (row) => {
        expect(() => compile(note({ "contextual-mappings": [row] }))).toThrow(EncodingError);
    });
});
describe("explicit canonical round trips", () => {
    it("keeps exact default integrity and permits conventional aliases only when declared", () => {
        const mappings = { k: "K", q: "K", a: [] };
        expect(() => compile(note({}, mappings))).toThrow(EncodingError);
        const enc = compile(note({ roundTrip: "canonical" }, mappings));
        expect(encodeText(enc, "ka qa")).toBe("κ κ");
        expect(decodeText(enc, "κ κ")).toBe("k k");
        expect(encodeText(enc, "a")).toBe("");
        expect(decodeText(enc, "")).toBe("");
    });
    it("permits zero output only for canonical mappings and conditional emissions", () => {
        const rules = {
            roundTrip: "canonical",
            "contextual-mappings": [{ match: "s", at: "end", emit: [] }],
        };
        const enc = compile(note(rules, { a: "A", s: "S", "-": [] }));
        expect(encodeText(enc, "as a-sa")).toBe("α ασα");
        expect(decodeText(enc, "α ασα")).toBe("a asa");
        expect(() =>
            compile(note({ ...rules, roundTrip: "exact" }, { a: "A", s: "S", "-": [] })),
        ).toThrow(EncodingError);
    });
    it("returns first authored conventional readings when deleted markers hide the original context", () => {
        const enc = compile(
            note(
                {
                    roundTrip: "canonical",
                    "contextual-mappings": [{ match: "k", before: "consonant", emit: "K" }],
                },
                { a: "A", k: "K", q: "K" },
            ),
        );
        expect(decodeText(enc, "κα")).toBe("ka");
        expect(encodeText(enc, "qa")).toBe("κα");
    });
    it("retains exact concatenation checks, canonical longest-native matching and strict literals", () => {
        const mappings = { a: "A", b: "B", k: ["A", "B"] };
        expect(() => compile(note({}, mappings))).toThrow(/ambiguous|uniquely/i);
        const enc = compile(note({ roundTrip: "canonical" }, mappings));
        expect(decodeText(enc, "αβ")).toBe("k");
        expect(decodeText(enc, encodeText(enc, "⟦A U+1F600⟧"))).toBe("⟦A U+1F600⟧");
        expect(() => encodeText(enc, "⟦U+D800⟧")).toThrow(EncodingError);
        expect(() => validateSource(enc, "x")).toThrow(EncodingError);
    });
    it("does not relax Aelwythi character, case, vowel or reserved-control rules", () => {
        const read = (name: string) =>
            JSON.parse(
                fs.readFileSync(
                    new URL(`./fixtures/encoding-notes/${name}.json`, import.meta.url),
                    "utf8",
                ),
            );
        const data = read("aelwythi-semaron"),
            table = read("semaron-codes");
        data.rules.roundTrip = "canonical";
        const enc = compileEncoding(data, { codes: table });
        for (const source of ["CH", "aí", "ë", "à"])
            expect(() => encodeText(enc, source)).toThrow(EncodingError);
        expect(() =>
            compileEncoding(
                { ...data, mappings: { ...data.mappings, b: "STRESS" } },
                { codes: table },
            ),
        ).toThrow(EncodingError);
        expect(() =>
            compileEncoding(
                { ...data, mappings: { ...data.mappings, b: "LITERAL" } },
                { codes: { ...table, LITERAL: "\u{E0112}" } },
            ),
        ).toThrow(EncodingError);
    });
    it("rejects unknown round-trip modes", () => {
        expect(() => compile(note({ roundTrip: "approximate" }))).toThrow(
            expect.objectContaining({ key: "rules.roundTrip" }),
        );
    });
});

describe("explicit accent permissions", () => {
    const mappings = { e: "A", ë: "B", è: "S" };
    it("allows declared accents explicitly or by omission without adding mappings", () => {
        for (const rules of [
            {},
            { diaeresis: { allowed: true }, "grave-accent": { allowed: true } },
        ]) {
            const enc = compile(note(rules, mappings));
            expect(encodeText(enc, "ëè")).toBe("βσ");
            expect(decodeText(enc, "βσ")).toBe("ëè");
        }
        expect(() => encodeText(compile(note({}, { e: "A" })), "ë")).toThrow(EncodingError);
        expect(() =>
            encodeText(compile(note({ "grave-accent": { allowed: true } }, { e: "A" })), "è"),
        ).toThrow(EncodingError);
        expect(encodeText(compile(note({ diaeresis: { allowed: true } }, { e: "A" })), "ë")).toBe(
            "α",
        );
    });
    it("forbids false declarations and rejects nonboolean permission values", () => {
        for (const key of ["diaeresis", "grave-accent"]) {
            expect(() => compile(note({ [key]: { allowed: false } }, mappings))).toThrow(
                EncodingError,
            );
            expect(() => compile(note({ [key]: { allowed: "yes" } }, mappings))).toThrow(
                expect.objectContaining({ key: `rules.${key}.allowed` }),
            );
        }
    });
});

describe("shared word separators and canonical alias selection", () => {
    it("preserves internal dividers as shared spaces and removes only authored edge markers", () => {
        const enc = compile(
            note(
                {
                    roundTrip: "canonical",
                    "word-separators": ["-"],
                    "contextual-mappings": [
                        { match: "-", at: "start", emit: [] },
                        { match: "-", at: "end", emit: [] },
                    ],
                },
                { a: "A", b: "B" },
            ),
        );
        expect(encodeText(enc, "-a-b-")).toBe("α β");
        expect(decodeText(enc, "α β")).toBe("a b");
        const separatorOnly = compile(
            note({ roundTrip: "canonical", "word-separators": ["-"] }, { a: "A" }),
        );
        expect(encodeText(separatorOnly, "a-a")).toBe("α α");
        expect(() => compile(note({ "word-separators": ["-"] }, { a: "A" }))).toThrow(
            EncodingError,
        );
    });
    it("refuses separator conflicts, duplicates and syntax delimiters", () => {
        expect(() =>
            compile(note({ roundTrip: "canonical", "word-separators": ["-"] }, { "-": "K" })),
        ).toThrow(expect.objectContaining({ key: "rules.word-separators.0" }));
        for (const source of [
            "",
            " ",
            "a b",
            "⟦",
            "⟧",
            "^",
            "/",
            "{",
            "}",
            ".",
            "\u{E0112}",
            "\u0000",
        ])
            expect(() =>
                compile(note({ roundTrip: "canonical", "word-separators": [source] })),
            ).toThrow(expect.objectContaining({ key: "rules.word-separators.0" }));
        expect(() =>
            compile(note({ roundTrip: "canonical", "word-separators": ["-", "-"] })),
        ).toThrow(expect.objectContaining({ key: "rules.word-separators.1" }));
    });
    it("prefers an applicable authored alias for the visible decoded suffix", () => {
        const enc = compile(
            note(
                {
                    roundTrip: "canonical",
                    "contextual-mappings": [{ match: "c", before: "vowel", emit: "K" }],
                },
                { a: "A", b: "B", k: "K" },
            ),
        );
        expect(decodeText(enc, encodeText(enc, "ca kb"))).toBe("ca kb");
    });
    it("falls back to the authored reading when an inherent vowel erased its condition", () => {
        const enc = compile(
            note(
                {
                    roundTrip: "canonical",
                    "contextual-mappings": [{ match: "k", before: "vowel", emit: "INITIAL" }],
                },
                { a: [], b: "B", k: "K" },
            ),
        );
        expect(encodeText(enc, "kab")).toBe("εβ");
        expect(decodeText(enc, "εβ")).toBe("kb");
    });
});

describe("preceding-source contextual conditions", () => {
    const row = (after: unknown, extra = {}) => ({ match: "k", after, emit: "BEFORE", ...extra });
    it("matches literal scalars and categories with contextual precedence and fallback", () => {
        for (const [after, source, native] of [
            ["a", "ak bk k", "αγ βκ κ"],
            ["vowel", "ak bk k", "αγ βκ κ"],
            ["consonant", "ak bk k", "ακ βγ κ"],
        ]) {
            const enc = compile(note({ "contextual-mappings": [row(after)] }));
            expect(encodeText(enc, source)).toBe(native);
            expect(decodeText(enc, native)).toBe(source);
        }
    });
    it("combines all supplied predicates with AND and preserves exact before decoding", () => {
        const enc = compile(
            note({ "contextual-mappings": [row("a", { before: "consonant", at: "end" })] }),
        );
        expect(encodeText(enc, "akb ak bk")).toBe("ακβ ακ βκ");
        const final = compile(note({ "contextual-mappings": [row("a", { at: "end" })] }));
        expect(encodeText(final, "ak akb bk")).toBe("αγ ακβ βκ");
        const both = compile(note({ "contextual-mappings": [row("a", { before: "consonant" })] }));
        expect(encodeText(both, "akb aka bkb")).toBe("αγβ ακα βκβ");
        expect(() => decodeText(both, "αγα")).toThrow(EncodingError);
        // after, like at, governs forward matching only.
        expect(decodeText(both, "βγβ")).toBe("bkb");
    });
    it("uses exact Unicode letters after NFC and diaeresis source projection", () => {
        const data = note({ diaeresis: { allowed: true }, "contextual-mappings": [row("a")] });
        expect(encodeText(compile(data), "a\u0308k")).toBe("αγ");
        expect(encodeText(compile(data), "k!k k\nk")).toBe("κ\u{E0103}κ κ κ");
        const enc = compile({
            ...note({ "contextual-mappings": [row("𐐀")] }, { "𐐀": "A", "𐐨": "B", k: "K" }),
            vowels: undefined,
        });
        expect(encodeText(enc, "𐐀k 𐐨k")).toBe("αγ βκ");
        const accented = compile(note({ "contextual-mappings": [row("é")] }, { é: "A", k: "K" }));
        expect(encodeText(accented, "e\u0301k")).toBe("αγ");
    });
    it("validates after at its own key and includes it in duplicate identity", () => {
        for (const after of ["", "ab", "a\u0301", "!", "1", "\uD800", null, [], true, 1])
            expect(() => compile(note({ "contextual-mappings": [row(after)] }))).toThrow(
                expect.objectContaining({ key: "rules.contextual-mappings.0.after" }),
            );
        for (const after of ["vowel", "consonant"])
            expect(() =>
                compile({ ...note({ "contextual-mappings": [row(after)] }), vowels: undefined }),
            ).toThrow(expect.objectContaining({ key: "rules.contextual-mappings.0.after" }));
        expect(() => compile(note({ "contextual-mappings": [row("a"), row("b")] }))).not.toThrow();
        expect(() => compile(note({ "contextual-mappings": [row("a"), row("a")] }))).toThrow(
            expect.objectContaining({ key: "rules.contextual-mappings.1.match" }),
        );
    });
    it("refuses an undeclared tone predecessor without an unconditional tone fallback", () => {
        const enc = compileEncoding(
            {
                language: "test",
                font: "test",
                vowels: "auâ",
                mappings: { p: "P", a: "A", u: "U" },
                rules: {
                    normalization: "NFC",
                    matching: "longest-first",
                    diaeresis: { allowed: true },
                    "contextual-mappings": [
                        { match: "âa", at: "start", emit: "T" },
                        { match: "âa", after: "consonant", emit: "T" },
                        { match: "âa", after: "u", emit: "T" },
                    ],
                },
            },
            { codes: { P: "\u{F0000}", A: "\u{F0001}", U: "\u{F0002}", T: "\u{F0003}" } },
        );
        for (const [source, native] of [
            ["pâa", "\u{F0000}\u{F0003}"],
            ["puâa", "\u{F0000}\u{F0002}\u{F0003}"],
            ["pâaa", "\u{F0000}\u{F0003}\u{F0001}"],
        ]) {
            expect(() => validateSource(enc, source)).not.toThrow();
            expect(encodeText(enc, source)).toBe(native);
            expect(decodeText(enc, native)).toBe(source);
        }
        // Source validation permits lexicon-authoritative native writings without row coverage.
        expect(() => validateSource(enc, "paâa")).not.toThrow();
        expect(() => encodeText(enc, "paâa")).toThrow(
            expect.objectContaining({ offset: 2, column: 3 }),
        );
        expect(() => encodeText(enc, "pa\u0308âa")).toThrow(
            expect.objectContaining({ offset: 3, column: 4 }),
        );
    });
});
