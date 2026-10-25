/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A mapped run's words are words of its language.** In a run with `lang=`
 * naming a language with a `note`, and `map=`, every word is a lexicon form, a
 * word of a name in that language's own register under any tongue but
 * `translation`, or a form one machine-readable rule derives from a lexicon
 * form: a `grammar.plural` row, a `grammar.verbs` pattern, or an affix stating
 * `replaces`. Anything else is an error at the word.
 */

import { describe, expect, it } from "vitest";

import { runContext, scanRuns } from "../engine/content-scripts.mjs";

const vylari = {
    type: "skill",
    subType: "language",
    shortcode: "vylarilng",
    name: { full: "Vylari" },
    address: { canonical: "demo-note-skill-vylarilng" },
    data: {
        roman: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZé.,;:'’-–",
        words: [
            { form: "zaron", class: "n", gloss: "an oath" },
            { form: "lonak", class: "n", gloss: "a road" },
            { form: "marendos", class: "n", gloss: "a magistrate" },
            { form: "talotha", class: "n", gloss: "a field" },
            { form: "thelmar", class: "v", gloss: "to keep" },
            { form: "k'aralzon", class: "n", gloss: "the kept fire" },
        ],
        grammar: {
            plural: [
                { ending: "os", becomes: "oi" },
                { ending: "", becomes: "s" },
            ],
            verbs: {
                persons: {
                    I: "o",
                    you: "as",
                    heShe: "at",
                    we: "amos",
                    youAll: "atis",
                    they: "ant",
                },
            },
        },
        affixes: [
            { form: "-enna", gloss: "a farm of it", replaces: "vowel" },
            { form: "-ara", gloss: "a town of it", attaches: "replaces the final vowel" },
        ],
        register: [
            { name: "Revothar Baremzator", tongue: "vylari" },
            { name: "The Arcane Order", tongue: "translation" },
            { name: "Epistémion", tongue: "other:helonic" },
        ],
    },
};

const dunhari = {
    type: "skill",
    subType: "language",
    shortcode: "dunharilng",
    name: { full: "Dunhari" },
    address: { canonical: "demo-note-skill-dunharilng" },
    data: {
        roman: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-",
        words: [],
        register: [{ name: "Arzen-Thalor", tongue: "dunhari" }],
    },
};

const mapping = {
    type: "doc",
    subType: "reference",
    shortcode: "mapm",
    address: { canonical: "demo-note-doc-mapm" },
    data: { map: { name: "m", rows: [["th", "þ"]] } },
};

const config = {
    contentPackage: "demo",
    languages: {
        vyl: { tag: "art-x-vyl", note: "skill-vylarilng" },
        dun: { tag: "art-x-dun", note: "skill-dunharilng" },
        khel: { tag: "art-x-khel" },
    },
};

const ctx = runContext(config, [vylari, dunhari, mapping]);

/** Every finding of a source, as `line:column: message`. */
const findings = (source: string) =>
    scanRuns(source, ctx).errors.map(
        (error: { line: number; column: number; message: string }) =>
            `${error.line}:${error.column}: ${error.message}`,
    );

/** The finding for an unknown word of a language, Vylari unless named. */
const unknown = (word: string, language = "vyl") =>
    `\`${word}\` is not a word of the \`${language}\` lexicon, a registered name, or a regular form of ` +
    "one; coin it in the lexicon (or register the name) first";

describe("a mapped run's words", () => {
    it("accepts a lexicon word", () => {
        expect(findings("[zaron qux]{lang=vyl map=m font=serif .nativefont}")).toEqual([
            `1:8: ${unknown("qux")}`,
        ]);
    });

    it("accepts a word of a name in the language's register", () => {
        expect(
            findings("[Revothar Baremzator qux]{lang=vyl map=m font=serif .nativefont}"),
        ).toEqual([`1:22: ${unknown("qux")}`]);
    });

    it("accepts a foreign name the language's own register lists under `other:<tongue>`", () => {
        expect(findings("[Epistémion qux]{lang=vyl map=m font=serif .nativefont}")).toEqual([
            `1:13: ${unknown("qux")}`,
        ]);
    });

    it("refuses a name only another language's register lists", () => {
        expect(findings("[Arzen-Thalor zaron]{lang=vyl map=m font=serif .nativefont}")).toEqual([
            `1:2: ${unknown("Arzen")}`,
            `1:8: ${unknown("Thalor")}`,
        ]);
        expect(findings("[Arzen-Thalor Revothar]{lang=dun map=m font=serif .nativefont}")).toEqual([
            `1:15: ${unknown("Revothar", "dun")}`,
        ]);
    });

    it("does not count a name whose tongue is `translation`", () => {
        expect(findings("[zaron Arcane]{lang=vyl map=m font=serif .nativefont}")).toEqual([
            `1:8: ${unknown("Arcane")}`,
        ]);
    });

    it("accepts a plural a `grammar.plural` row makes", () => {
        expect(findings("[marendoi zarons qux]{lang=vyl map=m font=serif .nativefont}")).toEqual([
            `1:18: ${unknown("qux")}`,
        ]);
    });

    it("accepts a verb form a `grammar.verbs` pattern makes", () => {
        expect(
            findings("[thelmarat thelmarant qux]{lang=vyl map=m font=serif .nativefont}"),
        ).toEqual([`1:23: ${unknown("qux")}`]);
    });

    it("accepts a form an affix stating `replaces` makes", () => {
        expect(
            findings("[talothenna lonakenna qux]{lang=vyl map=m font=serif .nativefont}"),
        ).toEqual([`1:23: ${unknown("qux")}`]);
    });

    it("refuses a form an affix stating no `replaces` makes", () => {
        expect(findings("[talothara talothaara]{lang=vyl map=m font=serif .nativefont}")).toEqual([
            `1:2: ${unknown("talothara")}`,
            `1:12: ${unknown("talothaara")}`,
        ]);
    });

    it("accepts a compound whose parts are known, and locates an unknown part", () => {
        expect(findings("[zaron-lonak zaron–qux]{lang=vyl map=m font=serif .nativefont}")).toEqual([
            `1:20: ${unknown("qux")}`,
        ]);
    });

    it("reads a word with a catch as one word", () => {
        expect(
            findings("[k'aralzon k’aralzon k'qux]{lang=vyl map=m font=serif .nativefont}"),
        ).toEqual([`1:22: ${unknown("k'qux")}`]);
    });

    it("refuses an unknown word at its first character, once per run", () => {
        expect(findings("Said [zaron qux, qux]{lang=vyl map=m font=serif .nativefont}.")).toEqual([
            `1:13: ${unknown("qux")}`,
        ]);
    });

    it("checks the lines of a div and a verse fence at their words", () => {
        expect(
            findings("::: {lang=vyl map=m font=serif .nativefont}\nzaron lonak\nlonak qux\n:::\n"),
        ).toEqual([`3:7: ${unknown("qux")}`]);
        expect(
            findings(
                "```verse {lang=vyl map=m font=serif .nativefont}\nzaron\n  thelmaro quxa\n```\n",
            ),
        ).toEqual([`3:12: ${unknown("quxa")}`]);
    });

    it("folds case", () => {
        expect(
            findings("[ZARON Lonak revothar MARENDOI Qux]{lang=vyl map=m font=serif .nativefont}"),
        ).toEqual([`1:32: ${unknown("Qux")}`]);
    });

    it("checks language-only Roman and explicitly native runs alike", () => {
        expect(findings("[qux]{lang=vyl} [qux]{lang=vyl map=m font=serif .nativefont}")).toEqual([
            `1:2: ${unknown("qux")}`,
            `1:18: ${unknown("qux")}`,
        ]);
    });

    it("does not check a language with no `note`", () => {
        expect(
            findings(
                "[qux]{lang=khel map=m font=serif .nativefont} [qux]{lang=vyl map=m font=serif .nativefont}",
            ),
        ).toEqual([`1:48: ${unknown("qux")}`]);
    });

    it("uses rows without a lexicon for an explicit bare BCP 47 language", () => {
        expect(
            findings(
                "[qux]{map=m lang=und font=serif .nativefont} [qux]{lang=vyl map=m font=serif .nativefont}",
            ),
        ).toEqual([`1:47: ${unknown("qux")}`]);
    });
});

describe("a word's declared variants", () => {
    const variantSpeech = {
        ...vylari,
        data: {
            ...vylari.data,
            words: [
                { form: "zenothatora", class: "n", gloss: "a bell", variants: ["zenothazor"] },
                { form: "thelmar", class: "v", gloss: "to keep", variants: ["thelm"] },
            ],
        },
    };
    const variantCtx = runContext(config, [variantSpeech, dunhari, mapping]);
    const variantFindings = (source: string) =>
        scanRuns(source, variantCtx).errors.map(
            (error: { line: number; column: number; message: string }) =>
                `${error.line}:${error.column}: ${error.message}`,
        );

    it("accepts a variant as written", () => {
        expect(
            variantFindings("[zenothatora zenothazor]{lang=vyl map=m font=serif .nativefont}"),
        ).toEqual([]);
    });

    it("still refuses a near miss of a variant", () => {
        expect(variantFindings("[zenothazir]{lang=vyl map=m font=serif .nativefont}")).toEqual([
            `1:2: ${unknown("zenothazir")}`,
        ]);
    });

    it("gives a variant the forms its word's class takes", () => {
        expect(
            variantFindings("[zenothazors thelmo thelmant]{lang=vyl map=m font=serif .nativefont}"),
        ).toEqual([]);
    });

    it("lists a variant and its derived forms beside its word", async () => {
        const { derivedForms } = await import("../engine/word-forms.mjs");
        const forms = derivedForms(variantSpeech.data).map(
            (one: { form: string; word: { form: string } }) => [one.form, one.word.form],
        );
        expect(forms).toContainEqual(["zenothazor", "zenothatora"]);
        expect(forms).toContainEqual(["zenothazors", "zenothatora"]);
        expect(forms).toContainEqual(["thelmo", "thelmar"]);
    });
});
