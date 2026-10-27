/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { encodingContext } from "./helpers/encoding.js";

/**
 * **Agreement and participles are two optional rules a language states in
 * `data.grammar`, and the mapped-run word check accepts the forms they
 * give.** `agreement` names the word classes that agree and the endings they
 * swap among, each of which also takes the noun plural; `participles` names
 * the closing letters a verb drops to give its root and the suffixes that
 * attach to it, and a participle closing on an agreement ending agrees.
 * Nothing else is accepted, the `lexicon` command lists exactly what the check
 * derives, and a malformed value is a finding at its key.
 */

import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { scanRuns } from "../engine/content-scripts.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { lexiconEntries } from "../engine/encoding-lexicon.mjs";
import { foldWord, lexiconWords } from "../engine/word-forms.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const AGREEMENT = { classes: ["adj", "pron"], endings: ["os", "a", "on"] };
const PARTICIPLES = { root: ["athen", "ethen"], affixes: ["-andar", "-thos"] };

const WORDS = [
    { form: "alathos", class: "pron", field: "Grammar", gloss: "he, that one" },
    { form: "holimos", class: "adj", field: "Grammar", gloss: "first" },
    { form: "ethlen", class: "adj", field: "Grammar", gloss: "bright" },
    { form: "marendos", class: "n m", field: "Grammar", gloss: "a magistrate" },
    { form: "dokathen", class: "v", field: "Grammar", gloss: "to say" },
    { form: "kerethen", class: "v", field: "Grammar", gloss: "to hold" },
    { form: "solkatora", class: "v", field: "Grammar", gloss: "to follow" },
];

const AFFIXES = [
    { form: "-andar", gloss: "doing it", replaces: "vowel" },
    { form: "-thos", gloss: "done" },
    { form: "an-", gloss: "the reverse of it" },
];

/** A Vylari language record, with the grammar given. */
const vylari = (grammar: object) => ({
    type: "skill",
    subType: "language",
    shortcode: "vylarilng",
    name: { full: "Vylari" },
    address: { canonical: "demo-note-skill-vylarilng" },
    data: {
        roman: "abcdefghijklmnopqrstuvwxyz",
        words: WORDS,
        affixes: AFFIXES,
        grammar: {
            plural: [
                { ending: "os", becomes: "oi" },
                { ending: "on", becomes: "oi" },
                { ending: "a", becomes: "ai" },
            ],
            verbs: {
                replaces: "then",
                persons: {
                    I: "men",
                    you: "zen",
                    heShe: "zor",
                    we: "mar",
                    youAll: "zar",
                    they: "zoi",
                },
            },
            ...grammar,
        },
    },
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

const stated = vylari({ agreement: AGREEMENT, participles: PARTICIPLES });
const withKeys = encodingContext(config, [stated, mapping]);
const withoutKeys = encodingContext(config, [vylari({}), mapping]);

/** The words of a list a context's check refuses. */
const refused = (words: string[], ctx = withKeys) =>
    scanRuns(`[${words.join(" ")}]{lang=vyl enc=m font=semaron-kuriale}`, ctx).errors.map(
        (error: { message: string }) => error.message.match(/^`([^`]+)`/)?.[1],
    );

describe("agreement", () => {
    it("gives an adjective in `-os` its other endings and their plurals", () => {
        expect(refused(["holimos", "holima", "holimon", "holimoi", "holimai"])).toEqual([]);
    });

    it("gives a pronoun the same forms", () => {
        expect(refused(["alathos", "alatha", "alathon", "alathoi", "alathai"])).toEqual([]);
    });

    it("leaves a word of a class it does not name, and an adjective on no ending, alone", () => {
        expect(refused(["marenda", "marendon", "ethla", "ethlos"])).toEqual([
            "marenda",
            "marendon",
            "ethla",
            "ethlos",
        ]);
    });
});

describe("participles", () => {
    it("attach to the root a verb gives by dropping a stated ending", () => {
        expect(refused(["dokandar", "dokthos", "kerandar", "kerthos"])).toEqual([]);
    });

    it("agree when they close on an agreement ending", () => {
        expect(refused(["doktha", "dokthon", "dokthoi", "dokthai", "kerthai"])).toEqual([]);
    });

    it("give nothing for a verb closing on no stated ending", () => {
        expect(refused(["solkandar", "solkthos", "solkatorthos"])).toEqual([
            "solkandar",
            "solkthos",
            "solkatorthos",
        ]);
    });
});

describe("what the rules do not accept", () => {
    it("derive nothing in a language that states neither key", () => {
        const forms = ["holima", "alathai", "dokandar", "dokthos", "doktha", "kerthoi"];
        expect(refused(forms, withoutKeys)).toEqual(forms);
    });

    it("still refuse a near-miss of a derived form", () => {
        const typos = [
            "holimu",
            "holimoa",
            "alathe",
            "dokendar",
            "dokathandar",
            "dokthu",
            "dokthas",
        ];
        expect(refused(typos)).toEqual(typos);
    });
});

describe("`package-build lexicon --derived`", () => {
    const listed = lexiconEntries(withKeys, { lang: "vyl", enc: "m", derived: true });

    it("lists each derived form with the lexicon word it comes from", () => {
        if (!("entries" in listed)) throw new Error(listed.problem);
        const derived = listed.entries.filter((entry: any) => entry.from);
        expect(derived).toContainEqual(
            expect.objectContaining({ form: "holimai", from: "holimos", class: "adj" }),
        );
        expect(derived).toContainEqual(
            expect.objectContaining({ form: "doktha", from: "dokathen", class: "v" }),
        );
        expect(listed.entries.slice(0, WORDS.length).map((entry: any) => entry.form)).toEqual(
            WORDS.map((word) => word.form),
        );
    });

    it("lists exactly what the check accepts of the lexicon", () => {
        if (!("entries" in listed)) throw new Error(listed.problem);
        const forms = listed.entries.map((entry: any) => foldWord(entry.form));
        expect(new Set(forms).size).toBe(forms.length);
        expect(new Set(forms)).toEqual(lexiconWords(stated.data));
    });

    it("lists the lexicon words alone without the flag", () => {
        const plain = lexiconEntries(withKeys, { lang: "vyl", enc: "m" });
        if (!("entries" in plain)) throw new Error(plain.problem);
        expect(plain.entries.map((entry: any) => entry.form)).toEqual(
            WORDS.map((word) => word.form),
        );
        expect(plain.entries.every((entry: any) => !("from" in entry))).toBe(true);
    });
});

/** The error findings of a language note stating the grammar given. */
function lint(grammar: object) {
    const fm = {
        type: "skill",
        subType: "language",
        shortcode: "vylari",
        name: { full: "Vylari" },
        data: {
            classModifiers: ["m"],
            fields: [{ name: "Grammar", holds: "Every word here" }],
            affixes: AFFIXES,
            words: WORDS,
            grammar,
        },
    };
    const raw = `---\n${YAML.stringify(fm)}---\n\nA language.\n`;
    const findings = lintNote({ file: "Vylari.md", type: "skill", raw, fm } as any, {
        vocabulary: NOTE_VOCABULARY,
        schemas: NOTE_SCHEMAS,
    }).filter((finding: any) => finding.severity === "error");
    return { raw, findings };
}

/**
 * The 1-based line of the `n`th line holding `text`, and the column of
 * `value` on it: where a finding about that value points.
 */
function at(raw: string, text: string, n = 0, value = text) {
    const lines = raw.split("\n");
    const hits = lines.flatMap((line, i) => (line.includes(text) ? [i] : []));
    const line = hits[n];
    return { line: line + 1, column: lines[line].indexOf(value) + 1 };
}

describe("the two keys' values", () => {
    it("are accepted as stated", () => {
        expect(lint({ agreement: AGREEMENT, participles: PARTICIPLES }).findings).toEqual([]);
        expect(lint({ agreement: AGREEMENT }).findings).toEqual([]);
        expect(lint({ participles: PARTICIPLES }).findings).toEqual([]);
    });

    const located: Array<[string, object, string, string, number?, string?]> = [
        [
            "an unknown word class",
            { agreement: { classes: ["adjective"], endings: ["os", "a"] } },
            "`data.grammar.agreement.classes[0]` is `adjective`, which is not a word class; did you mean `adj`?",
            "adjective",
        ],
        [
            "a class named twice",
            { agreement: { classes: ["adj", "adj"], endings: ["os", "a"] } },
            "`data.grammar.agreement.classes[1]` names `adj` a second time",
            "- adj",
            1,
            "adj",
        ],
        [
            "no class",
            { agreement: { classes: [], endings: ["os", "a"] } },
            "`data.grammar.agreement.classes` must name at least one word class",
            "classes: []",
            0,
            "[]",
        ],
        [
            "one ending",
            { agreement: { classes: ["adj"], endings: ["os"] } },
            "`data.grammar.agreement.endings` must state at least two endings for a word to agree among",
            "- os",
        ],
        [
            "an ending stated twice",
            { agreement: { classes: ["adj"], endings: ["os", "a", "os"] } },
            "`data.grammar.agreement.endings[2]` states `os` a second time",
            "- os",
            1,
            "os",
        ],
        [
            "an affix the language does not state",
            { participles: { root: ["athen"], affixes: ["-andor"] } },
            "`data.grammar.participles.affixes[0]` is `-andor`, which is not a suffix of `data.affixes`; did you mean `-andar`?",
            "-andor",
        ],
        [
            "a prefix",
            { participles: { root: ["athen"], affixes: ["an-"] } },
            "`data.grammar.participles.affixes[0]` is `an-`, a prefix; a participle is a suffix on the root",
            "an-",
            1,
        ],
        [
            "an empty root ending",
            { participles: { root: [" "], affixes: ["-thos"] } },
            "`data.grammar.participles.root[0]` must name the letters a verb drops to give its root",
            '- " "',
            0,
            '" "',
        ],
        [
            "no root ending",
            { participles: { root: [], affixes: ["-thos"] } },
            "`data.grammar.participles.root` must name at least one ending a verb drops to give its root",
            "root: []",
            0,
            "[]",
        ],
        [
            "no affix",
            { participles: { root: ["athen"], affixes: [] } },
            "`data.grammar.participles.affixes` must name at least one suffix of `data.affixes`",
            "affixes: []",
            0,
            "[]",
        ],
    ];

    it.each(located)("refuse %s at its key", (_name, grammar, message, text, n, value) => {
        const { raw, findings } = lint(grammar);
        const finding = findings.find((one: any) => one.message === message);
        expect(finding, JSON.stringify(findings)).toBeDefined();
        expect({ line: finding.line, column: finding.column }).toEqual(at(raw, text, n, value));
    });

    const shapes: Array<[string, object, string]> = [
        ["an agreement that is no map", { agreement: "os" }, "data.grammar.agreement"],
        ["an agreement with no endings", { agreement: { classes: ["adj"] } }, "endings"],
        ["an agreement with no classes", { agreement: { endings: ["os", "a"] } }, "classes"],
        ["an undeclared agreement key", { agreement: { ...AGREEMENT, cases: ["nom"] } }, "cases"],
        ["participles with no root", { participles: { affixes: ["-thos"] } }, "root"],
        ["participles with no affixes", { participles: { root: ["athen"] } }, "affixes"],
        [
            "an undeclared participles key",
            { participles: { ...PARTICIPLES, tense: "past" } },
            "tense",
        ],
        [
            "a root ending that is no string",
            { participles: { root: [3], affixes: ["-thos"] } },
            "data.grammar.participles.root[0]",
        ],
    ];

    it.each(shapes)("refuse %s by its shape", (_name, grammar, mention) => {
        const { findings } = lint(grammar);
        const finding = findings.find((one: any) => one.message.includes(mention));
        expect(finding, JSON.stringify(findings)).toBeDefined();
        expect(finding.line).toBeGreaterThan(0);
        expect(finding.column).toBeGreaterThan(0);
    });
});
