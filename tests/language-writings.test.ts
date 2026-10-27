// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { compileRows as compileEncoding } from "../engine/encoding.mjs";
import { encodeWithLanguage, decodeWithLanguage } from "../engine/encoding-language.mjs";
import { writingsOf } from "../engine/language-writings.mjs";
/** Signs of Khelathi Zethu Glyphs, at their encoded code points. */
const HEART = "\u{1EABB}"; // 04-018, heart bound with a cord
const POWER = "\u{1EA93}"; // 03-003, open hand with three short rays
const GOD = "\u{1EA91}"; // 03-001, seated god
const SPROUT = "\u{1EB41}"; // 09-017, sprout over silt, sun above
const HOUSE = "\u{1EB66}"; // 11-003, house, roof and door
const INK = "\u{1EBC7}"; // 14-020, ink cake and reed
const MOUTH = "\u{1EA42}"; // 01-003, seated man, hand to mouth
const STROKE = "\u{1EBDF}"; // 16-004, single upright stroke
const STROKES = "\u{1EBE1}"; // 16-006, three strokes
const POINT = "\u{1EBED}"; // 16-018, stroke with a notch

const SIGNS = [HEART, POWER, GOD, SPROUT, HOUSE, INK, MOUTH, STROKE, STROKES, POINT].join("");

/** A face drawing the given characters. */
const face = (slug: string, chars: string) => ({
    slug,
    family: slug,
    class: `hl-${slug}`,
    direction: "ltr",
    features: [],
    draws: new Set(Array.from(chars, (char) => char.codePointAt(0))),
});

/** The `zethu` enc: logographic, its rows only for spaces and points. */
const ZETHU = {
    name: "zethu",
    logographic: true,
    fonts: [{ font: "zethu-glyphs" }],
    rows: [
        [" ", " "],
        [".", POINT],
    ],
};

const WORDS = [
    {
        form: "halzi",
        class: "n",
        field: "Words",
        gloss: "heart",
        native: [{ enc: "zethu", text: HEART }],
    },
    {
        form: "Halzi",
        class: "stem",
        field: "Words",
        gloss: "heart, and the account a heart answers for",
        native: [{ enc: "zethu", text: HEART }],
    },
    {
        form: "lekhau",
        class: "n",
        field: "Words",
        gloss: "sacred power",
        native: [{ enc: "zethu", text: POWER }],
    },
    {
        form: "nelgir",
        class: "n",
        field: "Words",
        gloss: "a god",
        native: [{ enc: "zethu", text: GOD }],
    },
    {
        form: "Nelgir",
        class: "stem",
        field: "Words",
        gloss: "god",
        native: [{ enc: "zethu", text: SPROUT }],
    },
    {
        form: "Gar-",
        class: "stem",
        field: "Words",
        gloss: "house of",
        native: [{ enc: "zethu", text: HOUSE }],
    },
    { form: "lekhunet", class: "n", field: "Words", gloss: "a spell", built: ["lekhau", "-unet"] },
    {
        form: "halzunet",
        class: "n",
        field: "Words",
        gloss: "the account",
        built: ["halzi", "-unet"],
    },
    {
        form: "garhalzunet",
        class: "n",
        field: "Words",
        gloss: "the house of the account",
        built: ["Gar-", "halzunet"],
    },
    {
        form: "lekhel",
        class: "n",
        field: "Words",
        gloss: "a holy word, written its own way",
        built: ["lekhau", "-unet"],
        native: [{ enc: "zethu", text: POWER + MOUTH }],
    },
    {
        form: "qethar",
        class: "v",
        field: "Words",
        gloss: "to tell",
        native: [{ enc: "zethu", text: MOUTH }],
    },
    { form: "zamlu", class: "n", field: "Words", gloss: "music" },
    { form: "zamlet", class: "n", field: "Words", gloss: "a hymn", built: ["zamlu", "-et"] },
];

const LANGUAGE_DATA = {
    roman: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-",
    fields: [{ name: "Words", holds: "words" }],
    affixes: [
        { form: "-unet", gloss: "a thing made of", native: [{ enc: "zethu", text: INK }] },
        { form: "-et", gloss: "a song of" },
    ],
    grammar: {
        plural: [{ ending: "", becomes: "im" }],
        verbs: {
            persons: { I: "en", you: "et", heShe: "", we: "enu", youAll: "etu", they: "ar" },
        },
        native: [
            { ending: "plural", enc: "zethu", text: STROKES },
            { ending: "I", enc: "zethu", text: STROKE },
        ],
    },
    words: WORDS,
};

const encoding = compileEncoding({
    name: "zethu",
    fonts: ["zethu-glyphs"],
    accepts: [".", "{", "}"],
    separator: " ",
    rows: [
        [".", POINT],
        ["{", "\u{E0110}"],
        ["}", "\u{E0111}"],
    ],
    codes: [],
});
const lexicon = { language: "khel", data: LANGUAGE_DATA };
const write = (text: string, data: any = LANGUAGE_DATA) =>
    encodeWithLanguage(encoding, text, { lexicon: { language: "khel", data } });
describe("native writings under every encoding", () => {
    it("uses own writings before parts, then nested parts, affixes and joining hyphens", () => {
        for (const [form, native] of [
            ["halzi", HEART],
            ["lekhunet", POWER + INK],
            ["halzunet", HEART + INK],
            ["garhalzunet", HOUSE + HEART + INK],
            ["lekhel", POWER + MOUTH],
            ["halzi-lekhau", HEART + POWER],
        ])
            expect(write(form)).toMatchObject({ text: native, findings: [] });
    });
    it("composes stated plural and six-person verb endings without manufacturing missing writings", () => {
        expect(write("nelgirim")).toMatchObject({ text: GOD + STROKES, findings: [] });
        expect(write("qetharen")).toMatchObject({ text: MOUTH + STROKE, findings: [] });
        for (const form of ["zamlu", "zamlet", "qetharet"])
            expect(write(form).findings).toHaveLength(1);
    });
    it("uses exact case before folded candidates and reports genuine different-sense ambiguity", () => {
        expect(write("nelgir").text).toBe(GOD);
        expect(write("Nelgir").text).toBe(SPROUT);
        const data = {
            ...LANGUAGE_DATA,
            words: [
                ...WORDS,
                {
                    form: "halzi",
                    class: "n",
                    gloss: "other",
                    native: [{ enc: "zethu", text: POWER }],
                },
            ],
        };
        expect(write("halzi", data).findings[0].message).toMatch(/heart.*other/);
    });
    it("refuses recursive and missing parts, while complete own text breaks a recursion", () => {
        const words = [
            { form: "a", class: "n", gloss: "a", built: ["b"] },
            { form: "b", class: "n", gloss: "b", built: ["a"] },
        ];
        expect(write("a", { words }).findings).toHaveLength(1);
        const data = {
            words: [words[0], { ...words[1], native: [{ enc: "zethu", text: HEART }] }],
        };
        expect(write("a", data)).toMatchObject({ text: HEART, findings: [] });
    });
    it("prefers per-face native text, preserves first-listed reverse ties and longest composed writing", () => {
        const data = {
            ...LANGUAGE_DATA,
            words: [
                {
                    ...WORDS[0],
                    native: [
                        { enc: "zethu", font: "zethu-glyphs", text: POWER },
                        { enc: "zethu", text: HEART },
                    ],
                },
                ...WORDS.slice(1),
            ],
        };
        expect(write("halzi", data).text).toBe(POWER);
        expect(decodeWithLanguage(encoding, HEART, { lexicon }).text).toBe("halzi");
        expect(decodeWithLanguage(encoding, HOUSE + HEART + INK, { lexicon }).text).toBe(
            "garhalzunet",
        );
    });
});
