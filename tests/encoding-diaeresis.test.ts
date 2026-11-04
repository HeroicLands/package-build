/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import {
    compileEncoding,
    encodeText,
    decodeText,
    encodePieces,
    EncodingError,
} from "../engine/encoding.mjs";

const codes = {
    A: "α",
    E: "ε",
    I: "ι",
    O: "ο",
    U: "υ",
    K: "κ",
    R: "ρ",
    M: "μ",
    N: "ν",
    BIG_O: "Ω",
    LIG: "æ",
    STRESS: "\u{E0114}",
};
const plain = { a: "A", e: "E", i: "I", o: "O", u: "U", k: "K", r: "R", m: "M", n: "N" };
const acute = {
    á: ["A", "STRESS"],
    é: ["E", "STRESS"],
    í: ["I", "STRESS"],
    ó: ["O", "STRESS"],
    ú: ["U", "STRESS"],
};
const stress = {
    modifier: "STRESS",
    position: "after-stressed-vowel",
    printing: false,
    effect: "stress-only",
    "changes-sound": false,
    "changes-length": false,
    "vowel-group-position": "first-vowel",
};
const groups = (list: string[]) => ({
    reading: "established",
    "allow-splitting": false,
    "unrecognized-adjacent-vowels": "separate",
    groups: list,
});
const note = (rules: object = {}, mappings: object = { ...plain, ...acute }) => ({
    language: "test",
    font: "test",
    vowels: "aeiou",
    mappings,
    rules: {
        normalization: "NFC",
        matching: "longest-first",
        stress,
        diaeresis: { allowed: true },
        ...rules,
    },
});
const compile = (data: object) => compileEncoding(data, { codes });
const groupMappings = {
    au: "AU",
    ai: "AI",
    ei: "EI",
    oi: "OI",
    ou: "OU",
    aa: "AA",
    ia: "IA",
    aia: "AIA",
    ae: "AE",
    ea: "EA",
    oa: "OA",
    ua: "UA",
};
const groupCodes = Object.fromEntries(
    Object.values(groupMappings).map((name, i) => [name, String.fromCodePoint(0xe200 + i)]),
);
const make = (list: string[], extra: object = {}, rules: object = {}) =>
    compileEncoding(
        note(
            { "vowel-groups": groups(list), ...rules },
            {
                ...plain,
                ...acute,
                ...Object.fromEntries(
                    list
                        .filter((g) => g in groupMappings)
                        .map((g) => [g, groupMappings[g as keyof typeof groupMappings]]),
                ),
                ...extra,
            },
        ),
        { codes: { ...codes, ...groupCodes } },
    );
const roundTrip = (enc: any, roman: string) => decodeText(enc, encodeText(enc, roman));

describe("diaeresis splits mapped vowel groups", () => {
    it("keeps non-group vowels bare and distinguishes a group glyph from separate vowel glyphs", () => {
        const enc = make(["au"]);
        expect(encodeText(enc, "kau")).toBe("κ" + groupCodes.AU);
        expect(encodeText(enc, "kaü")).toBe("καυ");
        expect(roundTrip(enc, "kau")).toBe("kau");
        expect(roundTrip(enc, "kaü")).toBe("kaü");
        for (const word of ["kae", "kio", "kua"]) expect(roundTrip(enc, word)).toBe(word);
    });
    it("restores each vowel and two splits in a word", () => {
        const enc = make(["oa", "ae", "oi", "au"], {}, {});
        for (const word of ["koä", "kaë", "koï", "kaü", "kaükoï"])
            expect(roundTrip(enc, word)).toBe(word);
        const o = make(["ao"], { ao: "LIG" });
        expect(roundTrip(o, "kaö")).toBe("kaö");
    });
    it("preserves row provenance for overlapping and longer groups", () => {
        const enc = make(["ai", "ia", "aia"]);
        for (const word of ["kaia", "kaïa", "kaiä", "kaïä"])
            expect(roundTrip(enc, word)).toBe(word);
        expect(roundTrip(make(["ai", "ia"]), "kaia")).toBe("kaia");
    });
    it("uses declared groups only and keeps canonical aliases conventional", () => {
        const none = compile(note());
        expect(roundTrip(none, "kau kae kii")).toBe("kau kae kii");
        const enc = make(["au"], { c: "K" }, { roundTrip: "canonical" });
        expect(decodeText(enc, encodeText(enc, "caü"))).toBe("kaü");
    });
    it("preserves bare exact input and refuses only newly derived input that loses its split", () => {
        for (const mappings of [
            { ...plain, ...acute },
            { ...plain, ...acute, au: ["A", "U"] },
        ]) {
            const exact = compile(note({ "vowel-groups": groups(["au"]) }, mappings));
            expect(roundTrip(exact, "kau")).toBe("kau");
            expect(() => encodeText(exact, "kaü")).toThrow(/diaeresis|split/i);
            const canonical = compile(
                note({ "vowel-groups": groups(["au"]), roundTrip: "canonical" }, mappings),
            );
            expect(roundTrip(canonical, "kaü")).toBe("kau");
        }
    });
    it("retains authored NFC source offsets and bounded context", () => {
        const enc = make(["au"]);
        const source = "kau kaü kau".normalize("NFD");
        expect(
            encodePieces(enc, source, { start: 4, end: 8 }).map((p: any) => [
                p.from,
                p.start,
                p.end,
            ]),
        ).toEqual([
            ["k", 4, 5],
            ["a", 5, 6],
            ["u\u0308", 6, 8],
        ]);
        expect(decodeText(enc, encodeText(enc, "kaü".normalize("NFD")))).toBe("kaü");
        expect(() =>
            encodeText(compile(note({ "vowel-groups": groups(["au"]) })), "kaü".normalize("NFD")),
        ).toThrow(expect.objectContaining({ offset: 2, column: 3 }));
    });
    it("keeps explicit diaeresis rows, acute placement, capitals and literals", () => {
        const enc = make(["au"], { ë: "LIG", A: "BIG_O", Au: "AA" });
        expect(roundTrip(enc, "kaë")).toBe("kaë");
        expect(roundTrip(enc, "káu")).toBe("káu");
        expect(() => encodeText(enc, "káü")).toThrow(/diaeresis|split/i);
        expect(roundTrip(enc, "Aü")).toBe("Aü");
        expect(roundTrip(enc, "kaü ⟦A U⟧ kaü")).toBe("kaü ⟦A U⟧ kaü");
    });
    it("uses plain vowel contextual rows for a derived vowel", () => {
        const enc = make(
            ["au"],
            {},
            { "contextual-mappings": [{ match: "u", before: "consonant", emit: "BIG_O" }] },
        );
        expect(encodeText(enc, "kaük")).toBe("καΩκ");
        expect(roundTrip(enc, "kaük")).toBe("kaük");
    });
    it("retains explicit permissions and missing-mapping errors", () => {
        const { diaeresis: _, ...rest } = note().rules;
        const enc = compileEncoding({ ...note(), rules: rest }, { codes });
        expect(() => encodeText(enc, "kaü")).toThrow(EncodingError);
        const { u: __, ...other } = plain;
        const { ú: ___, ...stressed } = acute;
        expect(() => encodeText(compile(note({}, { ...other, ...stressed })), "kaü")).toThrow(
            EncodingError,
        );
    });
});
