/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * **A verb pattern says what its endings replace.** A form is the citation
 * form with the ending added, or, where the pattern states `replaces`, with a
 * closing `replaces` swapped for the ending. A citation form that does not
 * close on `replaces` takes the ending whole. The dictionary's verb table and
 * a mapped run's lexicon check read the rule from the one function.
 */

import { describe, expect, it } from "vitest";

import { verbForm, verbPattern } from "../engine/verb-pattern.mjs";
import { lexiconWords } from "../engine/word-forms.mjs";
import { runContext, scanRuns } from "../engine/content-scripts.mjs";

const PERSONS = { I: "men", you: "zen", heShe: "zor", we: "mar", youAll: "zar", they: "zoi" };

describe("verbForm", () => {
    it("swaps a closing `replaces` for the ending", () => {
        expect(verbForm("lokathen", "zor", "then")).toBe("lokazor");
    });

    it("adds the ending where no `replaces` is stated", () => {
        expect(verbForm("lokathen", "zor")).toBe("lokathenzor");
        expect(verbForm("thelmar", "at", undefined)).toBe("thelmarat");
    });

    it("adds the ending whole to a citation form that does not close on `replaces`", () => {
        expect(verbForm("varos", "zor", "then")).toBe("varoszor");
        expect(verbForm("then", "zor", "then")).toBe("zor");
    });

    it("drops a closing `replaces` for an empty ending, and leaves the form otherwise", () => {
        expect(verbForm("lokathen", "", "then")).toBe("loka");
        expect(verbForm("lokathen", "")).toBe("lokathen");
    });
});

describe("verbPattern", () => {
    it("reads the six endings in presentation order, with what they replace", () => {
        expect(verbPattern({ replaces: "then", persons: PERSONS })).toEqual({
            invariant: false,
            replaces: "then",
            endings: [
                { name: "I", label: "I", ending: "men" },
                { name: "you", label: "you", ending: "zen" },
                { name: "heShe", label: "he/she", ending: "zor" },
                { name: "we", label: "we", ending: "mar" },
                { name: "youAll", label: "you all", ending: "zar" },
                { name: "they", label: "they", ending: "zoi" },
            ],
        });
    });

    it("reads an absent or null `replaces` as none", () => {
        expect(verbPattern({ persons: PERSONS })?.replaces).toBeUndefined();
        expect(verbPattern({ persons: PERSONS, replaces: null, invariant: null })).toMatchObject({
            invariant: false,
            replaces: undefined,
        });
    });

    it("reads an invariant pattern, and nothing from an incomplete one", () => {
        expect(verbPattern({ invariant: true })).toEqual({
            invariant: true,
            replaces: undefined,
            endings: [],
        });
        expect(verbPattern({ persons: { I: "men" } })).toBeUndefined();
        expect(verbPattern(undefined)).toBeUndefined();
    });
});

describe("a mapped run's lexicon reads the pattern", () => {
    const data = (verbs: object) => ({
        words: [
            { form: "lokathen", class: "v", gloss: "to come" },
            { form: "varos", class: "v", gloss: "to keep" },
        ],
        grammar: { verbs },
    });

    it("accepts `lokazor` and not `lokathenzor` where the endings replace `then`", () => {
        const words = lexiconWords(data({ replaces: "then", persons: PERSONS }));
        expect(words.has("lokazor")).toBe(true);
        expect(words.has("lokamen")).toBe(true);
        expect(words.has("lokathenzor")).toBe(false);
        expect(words.has("varoszor")).toBe(true);
    });

    it("adds each ending where the pattern states no `replaces`", () => {
        const words = lexiconWords(data({ persons: PERSONS }));
        expect(words.has("lokathenzor")).toBe(true);
        expect(words.has("lokazor")).toBe(false);
    });
});

describe("a mapped run's words take the pattern's forms", () => {
    const vylari = {
        type: "skill",
        subType: "language",
        shortcode: "vylarilng",
        name: { full: "Vylari" },
        address: { canonical: "demo-note-skill-vylarilng" },
        data: {
            words: [{ form: "lokathen", class: "v", gloss: "to come" }],
            grammar: { verbs: { replaces: "then", persons: PERSONS } },
        },
    };
    const mapping = {
        type: "doc",
        subType: "reference",
        shortcode: "mapm",
        address: { canonical: "demo-note-doc-mapm" },
        data: { map: { name: "m", rows: [["th", "þ"]] } },
    };
    const ctx = runContext(
        {
            contentPackage: "demo",
            languages: { vyl: { tag: "art-x-vyl", note: "skill-vylarilng" } },
        },
        [vylari, mapping],
    );

    it("passes `lokazor` and locates `lokathenzor`", () => {
        const errors = scanRuns("[lokazor lokathen lokathenzor]{lang=vyl map=m}", ctx).errors;
        expect(errors.map((error: any) => `${error.line}:${error.column}`)).toEqual(["1:19"]);
        expect(errors[0].message).toContain("`lokathenzor`");
    });
});
