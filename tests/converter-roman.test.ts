/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { expect, it } from "vitest";
import * as converter from "../convert.mjs";
import { wordBooksFromRecords, unknownWords, unknownWordMessage } from "../engine/run-words.mjs";
import { template, codes, sounds, encodingName } from "./helpers/encoding-note.js";

const lexical = {
    words: [
        { form: "au", class: "n", gloss: "water" },
        { form: "éla", class: "n", gloss: "tree", variants: ["ela"] },
        { form: "k'ar", class: "n", gloss: "stone" },
        { form: "red shore", class: "n", gloss: "shore" },
        { form: "only-whole", class: "n", gloss: "compound" },
        { form: "talotha", class: "n", gloss: "field" },
        { form: "thelmar", class: "v", gloss: "keep" },
    ],
    register: [
        { name: "Mera Venn", tongue: "aelw" },
        { name: "Epistémion", tongue: "other:helonic" },
        { name: "Translated Name", tongue: "translation" },
    ],
    grammar: {
        plural: [{ ending: "", becomes: "s" }],
        verbs: {
            persons: { I: "o", you: "as", heShe: "at", we: "amos", youAll: "atis", they: "ant" },
        },
    },
    affixes: [{ form: "-enna", gloss: "farm", replaces: "vowel" }],
};
const data = {
    format: 2,
    contentPackage: "demo",
    encodings: { [encodingName]: { data: template, codes, sounds } },
    languages: {
        aelw: { name: "Aelwythi", lexicon: { language: "aelw", data: lexical } },
        bare: { name: "Bare" },
    },
};
const check = (...args: any[]) => (converter as any).checkRoman(...args);

it("checks original Roman membership before any lossy conversion", () => {
    expect(check(data, "aelw", "au aaaaaaa")).toMatchObject({
        language: "aelw",
        checked: true,
        findings: [
            {
                kind: "unknown-word",
                severity: "warning",
                word: "aaaaaaa",
                offset: 3,
                line: 1,
                column: 4,
            },
        ],
    });
    expect(check(data, "aelw", "au").findings).toEqual([]);
});

it("flags aaaaaaa although its native output and decoding collide with known au", () => {
    const enc = "demo-note-doc-qalezu";
    const collision = {
        ...data,
        encodings: {
            [enc]: {
                codes: { CATCH: "𞨕" },
                data: {
                    language: "aelw",
                    font: "qalezu-hand",
                    mappings: { a: [], u: [] },
                    rules: {
                        normalization: "NFC",
                        matching: "longest-first",
                        roundTrip: "none",
                        "contextual-mappings": [{ match: "a", at: "start", emit: "CATCH" }],
                    },
                },
            },
        },
        languages: {
            aelw: {
                name: "Aelwythi",
                lexicon: {
                    language: "aelw",
                    data: {
                        words: [
                            {
                                form: "au",
                                class: "stem",
                                gloss: "realm",
                                native: [{ enc, text: "𞨕" }],
                            },
                        ],
                    },
                },
            },
        },
    };
    for (const input of ["aaaaaaa", "au"]) {
        const before = converter.encode(collision, "aelw", input, { enc });
        expect(before).toMatchObject({ text: "𞨕", findings: [] });
        expect(converter.decode(collision, "aelw", before.text, { enc })).toMatchObject({
            text: "[au | a]",
            findings: [],
        });
        expect(check(collision, "aelw", input).findings.map((p: any) => p.word)).toEqual(
            input === "au" ? [] : [input],
        );
        expect(converter.encode(collision, "aelw", input, { enc })).toEqual(before);
    }
});

it("shares the publisher's forms, names, phrases, compounds and repeated-word semantics", () => {
    const note = {
        type: "skill",
        subType: "language",
        shortcode: "aelwlng",
        name: { full: "Aelwythi" },
        address: { canonical: "demo-note-skill-aelwlng" },
        data: lexical,
    };
    const book = wordBooksFromRecords([note], {
        contentPackage: "demo",
        languages: { aelw: { tag: "art-x-aelw", note: "skill-aelwlng" } },
    }).get("aelw")!;
    const source =
        "AU E\u0301LA elas k’ar red shore Mera Venn Epistémion aus talothenna thelmarat only-whole au–missing 123 123x Translated missing MISSING";
    const expected = unknownWords(source, book);
    expect(expected.map((p) => p.word)).toEqual(["missing", "123x", "Translated"]);
    expect(
        check(data, "aelw", source).findings.map(({ word, offset, message }: any) => ({
            word,
            offset,
            message,
        })),
    ).toEqual(expected.map((p) => ({ ...p, message: unknownWordMessage(p.word, "aelw") })));
});

it("masks codage, keeps original UTF-16 offsets and code-point columns, and reads raw text", () => {
    const source = "😀 ⟦IGNORED\nPAYLOAD⟧ au\n𞨕 unknown UNKNOWN ⟦unfinished";
    expect(check(data, "aelw", source).findings).toMatchObject([
        { word: "unknown", offset: source.indexOf("unknown"), line: 3, column: 3 },
    ]);
    expect(
        check(data, "aelw", "au [missing]{.class} `code`").findings.map((p: any) => p.word),
    ).toEqual(["missing", "class", "code"]);
});

it("distinguishes unchecked input and resolves selections exactly as conversion does", () => {
    expect(check(data, null, "missing")).toEqual({ language: null, checked: false, findings: [] });
    expect(check(data, "bare", "missing")).toEqual({
        language: "bare",
        checked: false,
        findings: [],
    });
    expect(check(data, undefined, "au", { enc: encodingName })).toEqual({
        language: "aelw",
        checked: true,
        findings: [],
    });
    for (const enc of [
        "aelwsemaronenc",
        "doc-aelwsemaronenc",
        "doc/aelwsemaronenc",
        "note-doc-aelwsemaronenc",
        encodingName,
    ])
        expect(check(data, null, "au", { enc }).checked).toBe(true);
    expect(() => check(data, "missing", "au")).toThrow(/Unknown language/);
    expect(() => check(data, null, "au", { enc: "missing" })).toThrow(/Unknown encoding document/);
    expect(() => check(data, "bare", "au", { enc: encodingName })).toThrow(/writes aelw.*bare/);
    expect(() => check(data, "aelw", 123)).toThrow(/input must be text/);
    const empty = {
        ...data,
        languages: { aelw: { name: "Empty", lexicon: { language: "aelw", data: {} } } },
    };
    expect(check(empty, "aelw", "missing")).toMatchObject({
        checked: true,
        findings: [{ word: "missing" }],
    });
});
