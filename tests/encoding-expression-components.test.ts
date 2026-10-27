/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { compileRows as compileEncoding, encodeText, decodeText } from "../engine/encoding.mjs";
import { encodeWithLanguage, decodeWithLanguage } from "../engine/encoding-language.mjs";
const definition = (name: string) =>
    compileEncoding(
        JSON.parse(
            fs.readFileSync(new URL(`./fixtures/encodings/${name}.json`, import.meta.url), "utf8"),
        ),
    );
const stripMarks = (text: string) => text.replace(/[\u{E0100}-\u{E01EF}]/gu, "");
const word = (form: string, extra: object = {}) => ({ form, class: "n", gloss: form, ...extra });
describe("per-word recovery from authored expressions", () => {
    const enc = definition("qalezu");
    it("recovers unique citation components and preserves marked words in the same passage", () => {
        const lexicon = { language: "qal", data: { words: [word("lor ram")] } };
        const original = encodeWithLanguage(enc, "lor ram", { lexicon });
        expect(original.findings).toEqual([]);
        const unmarked = stripMarks(original.text);
        expect(decodeWithLanguage(enc, unmarked, { lexicon })).toEqual({
            text: "lor ram",
            findings: [],
        });
        expect(
            decodeWithLanguage(enc, stripMarks(encodeText(enc, "ram lor")), { lexicon }),
        ).toEqual({ text: "ram lor", findings: [] });
        const marked = encodeText(enc, "lir");
        expect(decodeWithLanguage(enc, `${unmarked} ${marked}`, { lexicon })).toEqual({
            text: `lor ram ${decodeText(enc, marked)}`,
            findings: [],
        });
    });
    it("keeps an earlier single-word skeleton before a later expression component", () => {
        const lexicon = { language: "qal", data: { words: [word("lar"), word("lor ram")] } };
        expect(
            decodeWithLanguage(enc, stripMarks(encodeText(enc, "lor ram")), { lexicon }),
        ).toEqual({ text: "lar ram", findings: [] });
        const earlierExpression = {
            language: "qal",
            data: { words: [...lexicon.data.words].reverse() },
        };
        expect(
            decodeWithLanguage(enc, stripMarks(encodeText(enc, "lor ram")), {
                lexicon: earlierExpression,
            }),
        ).toEqual({ text: "lor ram", findings: [] });
    });
    it("indexes variant and derived expression components in their authored entry order", () => {
        const lexicon = {
            language: "qal",
            data: {
                words: [word("lor", { variants: ["lar ram"] })],
                grammar: { plural: [{ ending: "", becomes: "s" }] },
            },
        };
        expect(
            decodeWithLanguage(enc, stripMarks(encodeText(enc, "lar rams")), { lexicon }),
        ).toEqual({ text: "lor rams", findings: [] });
    });
    it("does not lend a phrase's whole native text to one of its components", () => {
        const lexicon = {
            language: "qal",
            data: { words: [word("lor ram", { native: [{ enc: "qalezu", text: "𞨂" }] })] },
        };
        expect(decodeWithLanguage(enc, "𞨂", { lexicon })).toEqual({
            text: "lor ram",
            findings: [],
        });
        expect(
            decodeWithLanguage(enc, stripMarks(encodeText(enc, "lor ram")), { lexicon }),
        ).toEqual({ text: "lor ram", findings: [] });
        expect(decodeWithLanguage(enc, stripMarks(encodeText(enc, "lor")), { lexicon })).toEqual({
            text: "lor",
            findings: [],
        });
    });
    it("recognizes visible row case of components without altering marked text", () => {
        const enc = definition("aelwythi-semaron");
        const lexicon = { language: "aelw", data: { words: [word("say well")] } };
        const unmarked = encodeText(enc, "Say well");
        expect(decodeWithLanguage(enc, unmarked, { lexicon })).toEqual({
            text: "Say well",
            findings: [],
        });
        const marked = encodeText(enc, "sáy well");
        expect(decodeWithLanguage(enc, marked, { lexicon })).toEqual({
            text: decodeText(enc, marked),
            findings: [],
        });
    });
});

describe("derived native writing recovery", () => {
    const enc = definition("zethu");
    it.each(["n", "v"])(
        "decodes composed endings without borrowing the %s citation native",
        (wordClass) => {
            const lexicon = {
                language: "zet",
                data: {
                    words: [
                        word("rava", {
                            class: wordClass,
                            variants: ["reva"],
                            native: [{ enc: "zethu", text: "𞰀" }],
                        }),
                    ],
                    grammar: {
                        plural: [{ ending: "", becomes: "n" }],
                        verbs: {
                            persons: {
                                I: "",
                                you: "n",
                                heShe: "n",
                                we: "n",
                                youAll: "n",
                                they: "n",
                            },
                        },
                        native: [
                            { ending: "plural", enc: "zethu", text: "𞰁" },
                            ...["you", "heShe", "we", "youAll", "they"].map((ending) => ({
                                ending,
                                enc: "zethu",
                                text: "𞰁",
                            })),
                            { ending: "I", enc: "zethu", text: "" },
                        ],
                    },
                },
            };
            const encoded = encodeWithLanguage(enc, "ravan", { lexicon });
            expect(encoded.findings).toEqual([]);
            expect(encoded.text).toBe("𞰀𞰁");
            expect(decodeWithLanguage(enc, encoded.text, { lexicon })).toEqual({
                text: "ravan",
                findings: [],
            });
            // Citation, variant and zero-ending aliases keep first-authored authority.
            expect(encodeWithLanguage(enc, "reva", { lexicon }).text).toBe("𞰀");
            expect(decodeWithLanguage(enc, "𞰀", { lexicon })).toEqual({
                text: "rava",
                findings: [],
            });
        },
    );
});
