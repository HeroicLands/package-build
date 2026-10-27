/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
    compileEncoding,
    encodeText,
    encodePieces,
    decodeText,
    EncodingError,
} from "../engine/encoding.mjs";
const read = (file: string) =>
    JSON.parse(
        fs.readFileSync(new URL(`./fixtures/encoding-notes/${file}.json`, import.meta.url), "utf8"),
    );
const data = () => read("aelwythi-semaron");
const codes = read("semaron-codes");
const compile = (value = data()) =>
    compileEncoding(value, { codes, name: "thalorna-note-doc-aelwsemaronenc" });
describe("executable encoding note template", () => {
    it("compiles the Aelwythi mapping and rules with externally supplied font codes", () => {
        const enc = compile();
        expect(enc.name).toBe("thalorna-note-doc-aelwsemaronenc");
        expect(enc.language).toBe("aelw");
        expect(enc.fonts).toEqual(["semaron-kuriale"]);
        const text = "Chány nyb Nyá ai Ái";
        expect(decodeText(enc, encodeText(enc, text))).toBe(text);
        expect(encodeText(enc, "nya")).toBe(codes.NYELIS_MIN + codes.ANKRON_MIN);
        expect(encodeText(enc, "nyb")).toBe(
            codes.NELAMIS_MIN + codes.YALZEMIS_MIN + codes.BRUTHEKA_MIN,
        );
        expect(encodeText(enc, "á")).toBe(codes.ANKRON_MIN + codes.STRESS);
        expect(() =>
            decodeText(enc, codes.ANKRON_MIN + codes.NYELIS_MIN + codes.BRUTHEKA_MIN),
        ).toThrow(expect.objectContaining({ offset: 2, line: 1, column: 2 }));
    });
    it("normalizes NFC while retaining UTF-16 piece offsets and code-point diagnostics", () => {
        const enc = compile();
        expect(
            encodePieces(enc, "a\u0301b").map(({ from, to, start, end }) => ({
                from,
                to,
                start,
                end,
            })),
        ).toEqual([
            { from: "a\u0301", to: codes.ANKRON_MIN + codes.STRESS, start: 0, end: 2 },
            { from: "b", to: codes.BRUTHEKA_MIN, start: 2, end: 3 },
        ]);
        expect(() => encodeText(enc, "a\u0301\n😀x")).toThrow(
            expect.objectContaining({ offset: 3, line: 2, column: 1 }),
        );
    });
    it.each(["CH", "cH", "nYa", "NYa", "aí", "a\u0308", "à", "c", "x"])(
        "refuses forbidden spelling %s",
        (text) => {
            expect(() => encodeText(compile(), text)).toThrow(EncodingError);
        },
    );
    it("uses shared punctuation and font codes inside literal markers", () => {
        const enc = compile();
        for (const text of ["^a‼/^^A!", "⟦CHEROLA_MIN U+1F600⟧"])
            expect(decodeText(enc, encodeText(enc, text))).toBe(text);
        expect(encodeText(enc, ".")).toBe(codes.POINT);
        expect(() => encodeText(enc, "a^")).toThrow(EncodingError);
    });
    it.each([
        ["rows", []],
        ["extends", "standard"],
        ["codage", codes],
        ["name", "inline"],
    ])("rejects non-template top-level key %s", (key, value) => {
        expect(() => compile({ ...data(), [key]: value })).toThrow(
            expect.objectContaining({ key }),
        );
    });
    it("rejects unknown nested rule keys and unsupported values instead of ignoring them", () => {
        for (const [key, value] of [
            ["extra", true],
            ["normalization", "NFD"],
            ["matching", "first"],
        ]) {
            const note = data();
            note.rules[key as string] = value;
            expect(() => compile(note)).toThrow(expect.objectContaining({ key: `rules.${key}` }));
        }
        const note = data();
        note.rules.stress.typo = true;
        expect(() => compile(note)).toThrow(expect.objectContaining({ key: "rules.stress.typo" }));
    });
    it("refuses missing codes, raw mapping outputs and inconsistent stress or vowel declarations", () => {
        const missing = data();
        missing.mappings.a = "MISSING";
        expect(() => compile(missing)).toThrow(expect.objectContaining({ key: "mappings.a" }));
        const raw = data();
        raw.mappings.a = codes.ANKRON_MIN;
        expect(() => compile(raw)).toThrow(expect.objectContaining({ key: "mappings.a" }));
        const stress = data();
        stress.mappings.á = "ANKRON_MIN";
        expect(() => compile(stress)).toThrow(expect.objectContaining({ key: "mappings.á" }));
        const vowel = data();
        vowel.vowels += "y";
        expect(() => compile(vowel)).toThrow(expect.objectContaining({ key: "rules.y" }));
    });
    it("supports codage-only notes without invented roman mappings", () => {
        const enc = compileEncoding(
            {
                language: "zet",
                font: "zethu",
                mappings: {},
                rules: { normalization: "NFC", matching: "longest-first" },
            },
            { codes: { BLOOD_FIELD: "𞰀" } },
        );
        expect(decodeText(enc, encodeText(enc, "⟦BLOOD_FIELD U+1F600⟧‼"))).toBe(
            "⟦BLOOD_FIELD U+1F600⟧‼",
        );
        expect(() => encodeText(enc, "a")).toThrow(EncodingError);
    });
    it("keeps bounds and normalization correct for combining sequences and Hangul", () => {
        const enc = compile();
        expect(encodePieces(enc, "a\u0301b", { start: 2 })).toMatchObject([
            { from: "b", start: 2, end: 3 },
        ]);
        expect(() => encodePieces(enc, "a\u0301b", { start: 1 })).toThrow(
            expect.objectContaining({ offset: 1, column: 2 }),
        );
        const hangul = compileEncoding(
            {
                language: "test",
                font: "test",
                mappings: { 가: "LETTER" },
                rules: { normalization: "NFC", matching: "longest-first" },
            },
            { codes: { LETTER: "𞰀" } },
        );
        expect(encodePieces(hangul, "가")).toMatchObject([
            { from: "가", to: "𞰀", start: 0, end: 2 },
        ]);
        expect(() => encodeText(enc, "⟦U+1F600⟧aí")).toThrow(
            expect.objectContaining({ offset: 10, column: 11 }),
        );
    });
    it("refuses empty or malformed code sequences and reports authored mapping keys", () => {
        for (const output of [[], ["ANKRON_MIN", null], "", ["MISSING"]]) {
            const note = data();
            note.mappings.a = output;
            expect(() => compile(note)).toThrow(expect.objectContaining({ key: "mappings.a" }));
        }
        for (const from of [" ", "a b", "⟦", "a\u0301"]) {
            const note = data();
            note.mappings[from] = "ANKRON_MIN";
            expect(() => compile(note)).toThrow(
                expect.objectContaining({ key: `mappings.${from}` }),
            );
        }
        const duplicate = data();
        duplicate.mappings.k = "ANKRON_MIN";
        expect(() => compile(duplicate)).toThrow(expect.objectContaining({ key: "mappings.k" }));
    });
    it("checks every nested rule block and contextual code reference", () => {
        for (const key of ["case", "stress", "vowel-groups", "diaeresis", "grave-accent", "y"]) {
            const note = data();
            note.rules[key].unknown = true;
            expect(() => compile(note)).toThrow(
                expect.objectContaining({ key: `rules.${key}.unknown` }),
            );
        }
        for (const [name, value] of [
            ["before", "consonant"],
            ["emit", "MISSING"],
            ["extra", true],
        ]) {
            const note = data();
            note.rules["contextual-mappings"][0][name as string] = value;
            expect(() => compile(note)).toThrow(
                expect.objectContaining({ key: `rules.contextual-mappings.0.${name}` }),
            );
        }
        const note = data();
        delete note.rules["vowel-groups"].groups;
        expect(() => compile(note)).toThrow(
            expect.objectContaining({ key: "rules.vowel-groups.groups" }),
        );
        expect(() => compileEncoding(data())).toThrow(
            expect.objectContaining({ key: "options.codes" }),
        );
    });
    it("does not mutate note data or the supplied code table", () => {
        const note = data(),
            before = JSON.stringify(note),
            table = JSON.stringify(codes);
        const enc = compile(note);
        expect(encodeText(enc, "á")).toBe(codes.ANKRON_MIN + codes.STRESS);
        expect(JSON.stringify(note)).toBe(before);
        expect(JSON.stringify(codes)).toBe(table);
    });
    it("applies the same source and output restrictions to contextual mappings", () => {
        for (const match of [" ", "⟦", "ë", "à"]) {
            const note = data();
            note.rules["contextual-mappings"][0].match = match;
            expect(() => compile(note)).toThrow(
                expect.objectContaining({ key: "rules.contextual-mappings.0.match" }),
            );
        }
        for (const emit of ["STRESS", "LITERAL_OPEN"]) {
            const note = data();
            note.rules["contextual-mappings"][0].emit = emit;
            expect(() =>
                compileEncoding(note, { codes: { ...codes, LITERAL_OPEN: "\u{E0112}" } }),
            ).toThrow(expect.objectContaining({ key: "rules.contextual-mappings.0.emit" }));
        }
    });
});
