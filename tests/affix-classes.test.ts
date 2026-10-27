/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { encodingContext } from "./helpers/encoding.js";

/**
 * **A replacing suffix attaches to the word classes its `attachesTo` names**,
 * by their base, and to every class where the affix states none. The mapped-run
 * word check and `package-build lexicon --derived` read the same forms, and a
 * value that names no word class, names one twice or names none is a finding
 * at its key.
 */

import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { scanRuns } from "../engine/content-scripts.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { lexiconEntries } from "../engine/encoding-lexicon.mjs";
import { derivedForms } from "../engine/word-forms.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const WORDS = [
    { form: "zunel", class: "n f", field: "Grammar", gloss: "a keeping" },
    { form: "karalzo", class: "n m", field: "Grammar", gloss: "a house" },
    { form: "alathos", class: "pron", field: "Grammar", gloss: "he, that one" },
    { form: "ethlen", class: "adj", field: "Grammar", gloss: "bright" },
    { form: "dokathen", class: "v", field: "Grammar", gloss: "to say" },
];

const AFFIXES = [
    { form: "-andi", gloss: "the month of it", replaces: "vowel", attachesTo: ["n"] },
    { form: "-ates", gloss: "of the line of it", replaces: "vowel", attachesTo: ["n", "adj"] },
    { form: "-enna", gloss: "a farm of it", replaces: "vowel" },
];

/** A Vylari language record stating the affixes given. */
const vylari = (affixes: object[]) => ({
    type: "skill",
    subType: "language",
    shortcode: "vylarilng",
    name: { full: "Vylari" },
    address: { canonical: "demo-note-skill-vylarilng" },
    data: { roman: "abcdefghijklmnopqrstuvwxyz", words: WORDS, affixes },
});

const mapping = {
    type: "doc",
    subType: "reference",
    shortcode: "mapm",
    address: { canonical: "demo-note-doc-mapm" },
    encodingDefinition: { name: "m", rows: [["th", "þ"]] },
};

const config = {
    contentPackage: "demo",
    languages: { vyl: { tag: "art-x-vyl", note: "skill-vylarilng" } },
};

const ctx = encodingContext(config, [vylari(AFFIXES), mapping]);

/** The words of a list the check refuses. */
const refused = (words: string[]) =>
    scanRuns(`[${words.join(" ")}]{lang=vyl enc=m font=semaron-kuriale}`, ctx).errors.map(
        (error: { message: string }) => error.message.match(/^`([^`]+)`/)?.[1],
    );

describe("a suffix stating `attachesTo`", () => {
    it("attaches to a word of a class it names, whatever the word's modifiers", () => {
        expect(
            refused(["zunelandi", "karalzandi", "zunelates", "karalzates", "ethlenates"]),
        ).toEqual([]);
    });

    it("does not attach to a word of another class", () => {
        expect(refused(["dokathenandi", "alathosandi", "alathosates", "dokathenates"])).toEqual([
            "dokathenandi",
            "alathosandi",
            "alathosates",
            "dokathenates",
        ]);
    });

    it("leaves a suffix that states none attaching to every class", () => {
        expect(refused(["zunelenna", "alathosenna", "ethlenenna", "dokathenenna"])).toEqual([]);
    });

    it("is what `lexicon --derived` lists", () => {
        const listed = lexiconEntries(ctx, { lang: "vyl", enc: "m", derived: true });
        if (!("entries" in listed)) throw new Error(listed.problem);
        const derived = listed.entries.filter((entry: any) => entry.from);
        const pairs = derived.map((entry: any) => `${entry.from}>${entry.form}`);
        expect(pairs).toContain("zunel>zunelandi");
        expect(pairs).not.toContain("dokathen>dokathenandi");
        expect(pairs).not.toContain("alathos>alathosates");
        expect(pairs).toContain("alathos>alathosenna");
    });

    it("derives every class's forms where no affix states the key", () => {
        const open = AFFIXES.map(({ attachesTo, ...affix }) => affix);
        const forms = derivedForms(vylari(open).data).map((one: any) => one.form);
        expect(forms).toEqual(expect.arrayContaining(["dokathenandi", "alathosates"]));
    });
});

/** The error findings of a language note stating the affixes given. */
function lint(affixes: object[]) {
    const fm = {
        type: "skill",
        subType: "language",
        shortcode: "vylari",
        name: { full: "Vylari" },
        data: {
            classModifiers: ["m", "f"],
            fields: [{ name: "Grammar", holds: "Every word here" }],
            affixes,
            words: WORDS,
        },
    };
    const raw = `---\n${YAML.stringify(fm)}---\n\nA language.\n`;
    const findings = lintNote({ file: "Vylari.md", type: "skill", raw, fm } as any, {
        vocabulary: NOTE_VOCABULARY,
        schemas: NOTE_SCHEMAS,
    }).filter((finding: any) => finding.severity === "error");
    return { raw, findings };
}

/** The 1-based line of the `n`th line holding `text`, and the column of `value` on it. */
function at(raw: string, text: string, n = 0, value = text) {
    const lines = raw.split("\n");
    const hits = lines.flatMap((line, i) => (line.includes(text) ? [i] : []));
    const line = hits[n];
    return { line: line + 1, column: lines[line].indexOf(value) + 1 };
}

describe("`attachesTo` values", () => {
    it("are accepted as stated", () => {
        expect(lint(AFFIXES).findings).toEqual([]);
    });

    const affix = (attachesTo: unknown) => [
        { form: "-andi", gloss: "the month of it", replaces: "vowel", attachesTo },
    ];

    const located: Array<[string, unknown, string, string, number?, string?]> = [
        [
            "an unknown word class",
            ["noun"],
            "`data.affixes[0].attachesTo[0]` is `noun`, which is not a word class; did you mean `n`?",
            "noun",
        ],
        [
            "a class with its modifiers",
            ["n f"],
            "`data.affixes[0].attachesTo[0]` is `n f`, which is not a word class",
            "n f",
        ],
        [
            "a class named twice",
            ["n", "n"],
            "`data.affixes[0].attachesTo[1]` names `n` a second time",
            "        - n",
            1,
            "n",
        ],
        [
            "no class",
            [],
            "`data.affixes[0].attachesTo` must name at least one word class",
            "attachesTo: []",
            0,
            "[]",
        ],
    ];

    it.each(located)("refuse %s at its key", (_name, value, message, text, n, shown) => {
        const { raw, findings } = lint(affix(value));
        const finding = findings.find((one: any) => one.message.startsWith(message));
        expect(finding, JSON.stringify(findings)).toBeDefined();
        expect({ line: finding.line, column: finding.column }).toEqual(at(raw, text, n, shown));
    });

    it("refuse a value that is no list", () => {
        const { findings } = lint(affix("n"));
        expect(findings.map((one: any) => one.message)).toEqual([
            expect.stringContaining("`data.affixes[0].attachesTo` should be"),
        ]);
    });
});
