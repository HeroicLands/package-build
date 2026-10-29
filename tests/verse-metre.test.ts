/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * **A verse div declares its metre, and the build counts its beats.** The
 * language states its stress rule as data, a `doc` note declares the metre, and
 * a div with `scan=` and `lang=` is warned at each line that cannot scan.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { collectContentIndex } from "../engine/content-index.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

import { scanVerse } from "../engine/content-verse.mjs";
import { runContext, scanRuns } from "../engine/content-scripts.mjs";
import {
    lineBeats,
    metreBooksFromRecords,
    metresFromRecords,
    nucleiOf,
    stressIndex,
} from "../engine/verse-metre.mjs";

const PAIRS = ["ai", "au", "oi", "aa", "ii", "uu"];
const RULE = { two: "first", longer: "penultimate", mark: "acute" };

const language = (stress: object | undefined, extra: object = {}) => ({
    type: "skill",
    subType: "language",
    shortcode: "vylarilng",
    name: { full: "Vylari" },
    address: { canonical: "demo-note-skill-vylarilng" },
    data: {
        roman: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZáéíóú.,-",
        sounds: { stress, syllables: { vowelPairs: PAIRS } },
        words: [
            { form: "zar", class: "n", gloss: "an oath" },
            { form: "lon", class: "v", gloss: "to go" },
            { form: "mal", class: "adj", gloss: "bad" },
            { form: "tri", class: "num", gloss: "three" },
            { form: "ul", class: "part", gloss: "and" },
            { form: "pra", class: "part", gloss: "before" },
            { form: "ir", class: "conj", gloss: "or" },
            { form: "ol", class: "n", gloss: "a hand" },
            { form: "ol", class: "part", gloss: "of" },
            { form: "zaros", class: "n", gloss: "an oath-giver" },
            { form: "alatha", class: "n", gloss: "a hill" },
            { form: "malkothoi", class: "n", gloss: "stones" },
            { form: "ulthalonar", class: "n", gloss: "a long road" },
        ],
        ...extra,
    },
});

const metres = {
    type: "doc",
    subType: "reference",
    shortcode: "metres",
    address: { canonical: "demo-note-doc-metres" },
    data: {
        metres: [
            { name: "hexameter", beats: 6, kind: "accentual" },
            { name: "trimeter", beats: 3, kind: "accentual" },
        ],
    },
};

const config = {
    contentPackage: "demo",
    languages: {
        vyl: { tag: "art-x-vyl", note: "skill-vylarilng" },
        bare: { tag: "art-x-bare", note: "skill-barelng" },
    },
};

const bare = {
    ...language(undefined),
    shortcode: "barelng",
    address: { canonical: "demo-note-skill-barelng" },
};

const ctx = runContext(config, [language(RULE), bare, metres]);

const fence = (attrs: string, ...lines: string[]) =>
    ["::: {.verse " + attrs + "}", ...lines, ":::"].join("\n");

/** Every warning of a source, as `line:column: message`. */
const warnings = (source: string) =>
    scanRuns(source, ctx).warnings.map(
        (w: { line: number; column: number; message: string }) =>
            `${w.line}:${w.column}: ${w.message}`,
    );

const errors = (source: string) =>
    scanRuns(source, ctx).errors.map(
        (w: { line: number; column: number; message: string }) =>
            `${w.line}:${w.column}: ${w.message}`,
    );

const book = (rule: object | undefined = RULE) =>
    metreBooksFromRecords([language(rule)], config).get("vyl");

describe("the stress rule", () => {
    const place = (word: string, rule: object = RULE, pairs: string[] = PAIRS) =>
        stressIndex(word, rule, pairs);

    it("counts syllables by vowel groups, a pair of the language's own as one", () => {
        expect(nucleiOf("alathas", PAIRS)).toEqual(["a", "a", "a"]);
        expect(nucleiOf("talothoi", PAIRS)).toEqual(["a", "o", "oi"]);
        expect(nucleiOf("talothoi", [])).toEqual(["a", "o", "o", "i"]);
        expect(nucleiOf("kaan", PAIRS)).toEqual(["aa"]);
        expect(nucleiOf("yormalis", PAIRS)).toEqual(["o", "a", "i"]);
        expect(nucleiOf("k'aralzon", PAIRS)).toEqual(["a", "a", "o"]);
    });

    it("stresses the first or last syllable of a word of two", () => {
        expect(place("zaros", { ...RULE, two: "first" })).toBe(0);
        expect(place("zaros", { ...RULE, two: "last" })).toBe(1);
    });

    it("stresses the rule's syllable of a longer word", () => {
        expect(place("alathas", { ...RULE, longer: "antepenultimate" })).toBe(0);
        expect(place("alathas", { ...RULE, longer: "penultimate" })).toBe(1);
        expect(place("alathas", { ...RULE, longer: "final" })).toBe(2);
        expect(place("ulthalonar", { ...RULE, longer: "antepenultimate" })).toBe(1);
        expect(place("ulthalonar", { ...RULE, longer: "penultimate" })).toBe(2);
        expect(place("alathas", { ...RULE, longer: "first" })).toBe(0);
        expect(place("ulthalonar", { ...RULE, longer: "first" })).toBe(0);
    });

    it("stresses the only syllable of a word of one", () => {
        expect(place("zar")).toBe(0);
    });

    it("moves the stress to the syllable the rule's mark sits on", () => {
        expect(place("alathás")).toBe(2);
        expect(place("álatha")).toBe(0);
        expect(place("alátha")).toBe(1);
        expect(place("zarós")).toBe(1);
        expect(place("malkothoí")).toBe(2);
    });

    it("takes no stress from a mark the rule does not name", () => {
        expect(place("alathás", { two: "first", longer: "penultimate" })).toBe(1);
        expect(place("alathà")).toBe(1);
    });

    it("counts a diphthong as one syllable when placing the stress", () => {
        expect(place("malkothoi")).toBe(1);
        expect(place("malkothoi", RULE, [])).toBe(2);
    });
});

describe("a metre's declaration", () => {
    it("is read from the metres of a doc note, by name", () => {
        expect([...metresFromRecords([metres]).keys()]).toEqual(["hexameter", "trimeter"]);
        expect(metresFromRecords([metres]).get("hexameter")).toEqual({
            name: "hexameter",
            beats: 6,
            kind: "accentual",
        });
    });
});

describe("the beats of a line", () => {
    const beats = (line: string) => {
        const { min, max } = lineBeats(line, book());
        return [min, max];
    };

    it("gives a word of two or more syllables one beat", () => {
        expect(beats("zaros")).toEqual([1, 1]);
        expect(beats("alatha")).toEqual([1, 1]);
    });

    it("gives a one-syllable noun, verb, adjective or numeral a beat", () => {
        expect(beats("zar")).toEqual([1, 1]);
        expect(beats("lon")).toEqual([1, 1]);
        expect(beats("mal")).toEqual([1, 1]);
        expect(beats("tri")).toEqual([1, 1]);
    });

    it("gives a one-syllable particle, preposition or conjunction none", () => {
        expect(beats("ul")).toEqual([0, 0]);
        expect(beats("pra")).toEqual([0, 0]);
        expect(beats("ir")).toEqual([0, 0]);
    });

    it("lets a word of four or more syllables take a second beat", () => {
        expect(beats("ulthalonar")).toEqual([1, 2]);
        expect(beats("malkothoi")).toEqual([1, 1]);
        expect(beats("ulthalonar zaros")).toEqual([2, 3]);
    });

    it("takes no second beat where the stress is already on the first syllable", () => {
        const stressed = lineBeats("últhalonar", book());
        expect([stressed.min, stressed.max]).toEqual([1, 1]);
    });

    it("counts a one-syllable word the lexicon is not read for as a content word", () => {
        expect(beats("qux")).toEqual([1, 1]);
    });

    it("counts a word whose entries differ in class as a beat that may be left out", () => {
        expect(beats("ol")).toEqual([0, 1]);
    });

    it("reads a derived form by the class of its word", () => {
        const derived = language(RULE, {
            grammar: { plural: [{ ending: "", becomes: "s" }] },
        });
        const derivedBook = metreBooksFromRecords([derived], config).get("vyl");
        expect([...(derivedBook?.classes.get("zars") ?? [])]).toEqual(["n"]);
    });

    it("inherits family word classes and derives forms with the child's rules", () => {
        const child = {
            ...language(RULE, {
                family: "skill-vylarilng",
                words: [{ form: "ul", class: "n", gloss: "an ember" }],
                grammar: { plural: [{ ending: "", becomes: "en" }] },
            }),
            shortcode: "childlng",
            address: { canonical: "demo-note-skill-childlng" },
        };
        const inheritedConfig = {
            ...config,
            languages: { child: { tag: "art-x-child", note: "skill-childlng" } },
        };
        const inherited = metreBooksFromRecords([child, language(RULE)], inheritedConfig).get(
            "child",
        );
        expect(lineBeats("pra ir", inherited)).toEqual({ min: 0, max: 0 });
        expect(lineBeats("ul", inherited)).toEqual({ min: 1, max: 1 });
        expect([...(inherited?.classes.get("zaren") ?? [])]).toEqual(["n"]);
        expect(inherited?.classes.has("zars")).toBe(false);
    });

    it.each(["sa", "ol"])(
        "keeps every nearest-generation class of the local or inherited homograph %s",
        (homograph) => {
            const ancestor = {
                ...language(RULE, {
                    words: [
                        { form: "sa", class: "adj" },
                        { form: "ol", class: "v" },
                        { form: "ir", class: "conj" },
                    ],
                }),
                shortcode: "rootlng",
                address: { canonical: "demo-note-skill-rootlng" },
            };
            const parent = language(RULE, {
                family: "skill-rootlng",
                words: [
                    { form: "sa", class: "v" },
                    { form: "ol", class: "n" },
                    { form: "ol", class: "part" },
                ],
            });
            const child = {
                ...language(RULE, {
                    family: "skill-vylarilng",
                    words: [
                        { form: "sa", class: "n" },
                        { form: "sa", class: "part" },
                    ],
                    grammar: { plural: [{ ending: "", becomes: "s" }] },
                }),
                shortcode: "childlng",
                address: { canonical: "demo-note-skill-childlng" },
            };
            const familyConfig = {
                ...config,
                languages: { child: { tag: "art-x-child", note: "skill-childlng" } },
            };
            const inherited = metreBooksFromRecords([ancestor, child, parent], familyConfig).get(
                "child",
            );
            expect([...inherited.classes.get(homograph)]).toEqual(["n", "part"]);
            expect(lineBeats(homograph, inherited)).toEqual({ min: 0, max: 1 });
            expect([...inherited.classes.get("ir")]).toEqual(["conj"]);
            expect(lineBeats("ir", inherited)).toEqual({ min: 0, max: 0 });
            for (const form of ["sas", "ols"])
                expect([...inherited.classes.get(form)]).toEqual(["n"]);
        },
    );

    it("reads each part of a compound and ignores the caesura it is not written with", () => {
        expect(beats("zar-zaros ul")).toEqual([2, 2]);
    });
});

describe("the warning", () => {
    const six = "ul zaros alatha zaros alatha zaros mal";

    it("is silent on a line that has the metre's beats", () => {
        expect(
            warnings(fence("scan=hexameter lang=vyl", "zaros zaros zaros zaros zaros zaros")),
        ).toEqual([]);
    });

    it("says how many beats the line has and how many the metre wants, at the line", () => {
        const source = fence("scan=hexameter lang=vyl", "zaros alatha zaros ul zar/", six);
        expect(warnings(source)).toEqual([
            "2:1: this line has 4 beats; the metre `hexameter` has 6",
        ]);
    });

    it("gives both counts where a second beat would change the line", () => {
        const source = fence("scan=hexameter lang=vyl", "  ulthalonar zaros zaros zaros");
        expect(warnings(source)).toEqual([
            "2:3: this line has 4 beats (5 with secondary beats); the metre `hexameter` has 6",
        ]);
    });

    it("is silent where secondary beats reach the metre's count", () => {
        const source = fence("scan=hexameter lang=vyl", "ulthalonar zaros zaros zaros zaros");
        expect(warnings(source)).toEqual([]);
    });

    it("counts text inside same-language spans and ignores indentation and stanza markers", () => {
        const source = fence(
            "scan=trimeter lang=vyl",
            "[..zaros zaros zaros]{lang=vyl}",
            "",
            "--- {.canto}",
            ".zaros zaros zaros",
        );
        expect(warnings(source)).toEqual([]);
        expect(errors(source)).toEqual([]);
    });

    it("skips speaker and direction labels and counts only verse text beside them", () => {
        const source = fence(
            "scan=trimeter lang=vyl",
            "[zaros]{.speaker}/",
            "[zaros [quietly]{lang=en}]{.direction}/",
            "[zaros]{.speaker} zaros [zaros zaros]{.direction} zaros zaros/",
            "[zaros [zaros]{.speaker} zaros]{lang=vyl} zaros",
        );
        expect(warnings(source)).toEqual([]);
        expect(errors(source)).toEqual([]);
    });

    it("refuses to scan another language with the div's beat rules", () => {
        const source = fence("scan=trimeter lang=vyl", "zaros [a foreign phrase]{lang=en} zaros");
        expect(errors(source)).toContain(
            "2:7: `scan=` counts one language's beats; this verse line contains another language",
        );
        expect(warnings(source)).toEqual([]);
    });

    it("warns at each line that fails, past stanza breaks", () => {
        const source = fence(
            "scan=trimeter lang=vyl",
            "zaros zaros zaros",
            "",
            "zaros zaros/",
            "zaros zaros zaros zaros",
        );
        expect(warnings(source)).toEqual([
            "4:1: this line has 2 beats; the metre `trimeter` has 3",
            "5:1: this line has 4 beats; the metre `trimeter` has 3",
        ]);
    });

    it("is positioned on the file's line when the div sits below other text", () => {
        const source = ["Intro", "", fence("scan=trimeter lang=vyl", "zaros zaros")].join("\n");
        expect(warnings(source)).toEqual([
            "4:1: this line has 2 beats; the metre `trimeter` has 3",
        ]);
    });

    it("runs no check without `scan=`", () => {
        expect(warnings(fence("lang=vyl", "zaros"))).toEqual([]);
        expect(warnings(fence("form=epic", "zaros"))).toEqual([]);
        expect(errors(fence("lang=vyl", "zaros"))).toEqual([]);
    });

    it("refuses `meter=` as an unknown verse attribute", () => {
        expect(
            scanVerse(fence('meter="common metre" lang=vyl', "zaros")).errors.map(
                (e: { line: number; column: number; message: string }) =>
                    `${e.line}:${e.column}: ${e.message}`,
            ),
        ).toEqual(["1:13: meter= is not a verse attribute"]);
    });

    it("refuses `metre=` now that `scan=` names the metre", () => {
        expect(
            scanVerse(fence("metre=hexameter lang=vyl", "zaros")).errors.map(
                (e: { line: number; column: number; message: string }) =>
                    `${e.line}:${e.column}: ${e.message}`,
            ),
        ).toEqual(["1:13: metre= is not a verse attribute"]);
    });

    it("is carried to the page as a plain attribute", async () => {
        const { renderVerse } = await import("../engine/content-verse.mjs");
        const { markdown } = renderVerse(fence("scan=hexameter lang=vyl", "zaros"));
        expect(markdown).toContain('data-scan="hexameter"');
    });
});

describe("a `scan=` that cannot mean anything", () => {
    it("is refused when no declared metre has the name", () => {
        expect(errors(fence("scan=hexamter lang=vyl", "zaros"))).toEqual([
            "1:18: `hexamter` is not a declared metre: `scan=` names the `name` of a `data.metres` entry of a `doc` note; did you mean `hexameter`?",
        ]);
    });

    it("is refused without a `lang=`", () => {
        expect(errors(fence("scan=hexameter", "zaros"))).toEqual([
            "1:13: `scan=` counts beats by a language's stress rule: the div needs a `lang=`",
        ]);
    });

    it("is refused for a language that states no stress rule", () => {
        expect(errors(fence("scan=hexameter lang=bare", "zaros"))).toEqual([
            "1:33: the language `bare` states no `data.sounds.stress`, which `scan=` counts beats by",
        ]);
    });

    it("is refused for a language that is only a tag", () => {
        expect(errors(fence("scan=hexameter lang=en", "zaros"))).toEqual([
            "1:33: the language `en` is not a configured language with a `note`, so it has no stress rule for `scan=` to count beats by",
        ]);
    });

    it("does not count a defined footnote label as a word of the verse", () => {
        const source =
            fence("scan=trimeter lang=vyl", "zaros zaros zaros[^zaros]") +
            "\n\n[^zaros]: A translator's note.";
        expect(warnings(source)).toEqual([]);
    });
    it("retains Unicode and CRLF locations after omitting a footnote label", () => {
        const source = (
            fence("scan=trimeter lang=vyl", "😀 zaros[^a] [foreign]{lang=en}") + "\n\n[^a]: A note."
        ).replace(/\n/g, "\r\n");
        expect(errors(source).filter((message) => message.includes("counts one language"))).toEqual(
            [
                "2:13: `scan=` counts one language's beats; this verse line contains another language",
            ],
        );
    });
    it("counts joined source lines as one logical line", () => {
        const source = fence("scan=trimeter lang=vyl", "zaros", "zaros zaros");
        expect(warnings(source)).toEqual([]);
    });
    it("counts several explicit logical lines on one source line", () => {
        const source = fence("scan=trimeter lang=vyl", "zaros zaros/zaros zaros zaros zaros");
        expect(warnings(source)).toEqual([
            "2:1: this line has 2 beats; the metre `trimeter` has 3",
            "2:13: this line has 4 beats; the metre `trimeter` has 3",
        ]);
    });
});

describe("a doc note's metres", () => {
    const roots: string[] = [];
    afterAll(() => {
        for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    });

    const note = (name: string, body: string, subType = "reference") =>
        `---\nshortcode: ${name}\nname: {full: ${name}}\ntype: doc\nsubType: ${subType}\ndata:\n${body}\n---\nText.\n`;

    /** Lint a tree of notes, returning the findings on the first. */
    function lint(notes: Record<string, string>) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "verse-metre-"));
        roots.push(root);
        for (const [rel, text] of Object.entries(notes)) {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), text);
        }
        const problems: any[] = [];
        const records = collectContentIndex(root, {
            contentPackage: "sohl",
            skipDirectories: [],
            problems,
        });
        const index = buildLinkIndex(root, { records, skipDirectories: [] });
        const findings = [
            ...problems,
            ...lintFrontmatter(index, { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY })
                .findings,
        ];
        const first = path.join(root, Object.keys(notes)[0]);
        return findings
            .filter((finding) => finding.file === first)
            .map((finding) => {
                const text = notes[Object.keys(notes)[0]].split("\n");
                return {
                    message: finding.message as string,
                    at: finding.line ? text[finding.line - 1].slice(finding.column - 1) : "",
                };
            });
    }

    const good = "  metres:\n    - {name: hexameter, beats: 6, kind: accentual}";

    it("are accepted as a list of `{ name, beats, kind }`", () => {
        expect(lint({ "Docs/Metres.md": note("metres", good) })).toEqual([]);
    });

    it("refuse a beat count that is not a whole number above zero, at the value", () => {
        const [finding] = lint({
            "Docs/Metres.md": note("metres", good.replace("beats: 6", "beats: 0")),
        });
        expect(finding.message).toMatch(/`data\.metres\[0\]\.beats`/);
        expect(finding.at.startsWith("0")).toBe(true);
    });

    it("refuse a kind other than accentual, at the value", () => {
        const [finding] = lint({
            "Docs/Metres.md": note("metres", good.replace("accentual", "quantitative")),
        });
        expect(finding.message).toMatch(/`data\.metres\[0\]\.kind` should be `accentual`/);
        expect(finding.at.startsWith("quantitative")).toBe(true);
    });

    it("refuse an entry with no name, beats or kind, at the entry", () => {
        const findings = lint({
            "Docs/Metres.md": note("metres", "  metres:\n    - {name: hexameter}"),
        });
        expect(findings.map((finding) => finding.message).join("\n")).toMatch(
            /`data\.metres\[0\]` must state `beats`[\s\S]*must state `kind`/,
        );
    });

    it("refuse a name another note declares, at the name", () => {
        const [finding] = lint({
            "Docs/Metres.md": note("metres", good),
            "Docs/Other.md": note("other", good),
        });
        expect(finding.message).toMatch(
            /`data\.metres\[0\]\.name` is `hexameter`, which .* also declares/,
        );
        expect(finding.at.startsWith("hexameter")).toBe(true);
    });

    it("refuse a name declared twice in one note, at the second", () => {
        const [finding] = lint({
            "Docs/Metres.md": note(
                "metres",
                `${good}\n    - {name: hexameter, beats: 5, kind: accentual}`,
            ),
        });
        expect(finding.message).toMatch(/`data\.metres\[1\]\.name` is `hexameter`/);
    });

    it("refuse a name that is not lowercase letters, digits and hyphens", () => {
        const [finding] = lint({
            "Docs/Metres.md": note("metres", good.replace("hexameter", "Hexameter")),
        });
        expect(finding.message).toMatch(/`data\.metres\[0\]\.name` is `Hexameter`/);
    });

    it("are refused on a note that is not a doc", () => {
        const text = `---\nshortcode: riding\nname: {full: Riding}\ntype: skill\nsubType: physical\ndata:\n${good}\n---\nText.\n`;
        const [finding] = lint({ "Skills/Riding.md": text });
        expect(finding.message).toMatch(/metres/);
        expect(finding.at.startsWith("metres")).toBe(true);
    });
});

describe("the metre modules", () => {
    it.each(["metre-declaration", "verse-metre", "note-vocabulary"])(
        "load as the first import of a process: %s",
        (name) => {
            const url = new URL(`../engine/${name}.mjs`, import.meta.url).href;
            expect(() =>
                execFileSync(process.execPath, [
                    "--input-type=module",
                    "-e",
                    `await import(${JSON.stringify(url)})`,
                ]),
            ).not.toThrow();
        },
    );
});
