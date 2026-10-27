/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A language note's register, tongues, retired forms, scope, sounds, sound
 * changes, elements, roots and cognates are each a relation**, keyed by the
 * language note, in this package's database and in each dependency's schema.
 * The register's notes are derived from the index: every note carrying the
 * name.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectContentIndex, serializeContentIndex } from "../engine/content-index.mjs";
import { openNotesDatabase, runSqlQuery } from "../engine/sql-tables.mjs";
import { registerRows } from "../engine/language-rows.mjs";

/** Write a note into `dir`. */
function write(dir: string, rel: string, text: string) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

/** A note from its frontmatter lines and body. */
const note = (lines: string[], body = "A note.") =>
    ["---", ...lines, "---", "", body, ""].join("\n");

let dir: string;
let db: any;

beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "language-relations-"));
    const own = path.join(dir, "own");
    write(
        own,
        "Skills/Dunhari.md",
        note(
            [
                "shortcode: dunharlng",
                "name: {full: Dunhari Language}",
                "type: skill",
                "subType: language",
                "data:",
                "  tongues:",
                "    - {tag: dunhari, meaning: a Dunhari name, language: skill-dunharlng}",
                "    - {tag: translation, meaning: a name in the language of these pages}",
                "  register:",
                "    - {name: Belgogâr, tongue: dunhari, built: [belg-, -ogâr]}",
                "    - {name: Dunhara, tongue: dunhari}",
                "    - {name: Dunhari Lexicon, tongue: translation}",
                "    - {name: Bondsman, tongue: translation}",
                "    - {name: Nobody, tongue: dunhari}",
                '    - {name: Aldous, kind: given, why: "a short name no element builds"}',
                "  retired:",
                "    - {form: Qadi, instead: Vazhmadêr, why: an Earth word}",
                "    - {form: Khalid, instead: [Kheldûn, Bezdûn], why: an Earth given name}",
                "    - {form: Morwenna, why: an Earth name}",
                "  scope:",
                "    cultures: [dunhariclt]",
                "    addresses: [skill-dunharlng, place-dunharargn, lore-dunhariclt]",
                "    paths: [Places/]",
                "    skip: [place-otherplc]",
                "  sounds:",
                "    letters:",
                "      - {letters: [kh, gh], kind: consonant, like: a rasp, tongue: dunhari}",
                "      - {letters: [â], kind: long vowel, like: father, ipa: aː}",
                "    edges:",
                "      - {edge: closeConsonant, sounds: [n, r]}",
                "      - {edge: syllabic, sounds: any}",
                "      - {edge: openCluster, sounds: []}",
                "    clusters: {max: 2}",
                "    stress: {two: last, longer: final}",
                "    finals:",
                "      - {final: ang, like: father then ng, ipa: aŋ}",
                "    syllables:",
                "      onsets: single",
                "      codas: [b, d]",
                "      finals: any",
                "      vowelPairs: []",
                "      initialVowel: true",
                "      harmony: {back: [a, o], front: [e, ö], neutral: [i], neutralAs: front}",
                "    joining:",
                "      - {first: [a, â], second: [a, â], written: â, example: méga + andáhr}",
                "    joins:",
                "      - {meeting: V+C, rule: double, letters: [p, t], where: between stems}",
                "    marks:",
                "      - {mark: acute, letters: [á, é], kind: stress, limit: one}",
                "    skeleton:",
                "      - {second: [m, n], third: [r], between: u}",
                "      - {second: [l, r], between: ''}",
                "      - {second: any, between: a}",
                "    frames:",
                "      - {frame: bare, shape: K1aK2K3, class: [n], makes: the thing itself, examples: {r-m-k: ramk, d-l-k: dalk}}",
                "    readPast:",
                '      - {written: á, readAs: a, what: "the acute, a stress mark"}',
                '      - {written: "\'", what: the seam}',
                "  soundChanges:",
                "    - name: From Dunhari to Sovidur",
                "      from: skill-dunharlng",
                "      to: skill-sovidurlng",
                "      steps:",
                '        - {step: "1", change: "`p ph` > `—`", where: anywhere}',
                '        - {step: "2", change: "like vowels merge, long"}',
                "    - name: Sovidur loans",
                "      steps:",
                '        - {step: "1", change: "`q` > `k`"}',
                "  elements:",
                "    - {form: arn-, variants: [arnr-], position: opening, sense: an eagle, examples: [Arnthúl, Arnhelm]}",
                "    - {form: áel, sense: first light}",
                "  roots:",
                "    - {root: d-l-k, sense: stone, field: stone}",
                "  cognates:",
                "    - {forms: {skill-dunharlng: zevr, skill-sovidurlng: zever}, proto: zevrâ, gloss: wind}",
                "  callingNames:",
                "    minSyllables: 4",
                "    closings:",
                "      - {form: -u, usual: man}",
                "      - {doubled: true, usual: either}",
            ],
            "## Dunhari Lexicon {#lexicon}\n\nThe words.",
        ),
    );
    write(
        own,
        "Skills/Sovidur.md",
        note([
            "shortcode: sovidurlng",
            "name: {full: Sovidur}",
            "type: skill",
            "subType: language",
            "data:",
            "  register:",
            "    - {name: Bondsman, tongue: translation}",
        ]),
    );
    write(
        own,
        "Lore/Dunhari.md",
        note([
            "shortcode: dunhariclt",
            "name: {full: The Dunhari, en: [Dunhara]}",
            "type: lore",
            "subType: culture",
            "data: {lang: en}",
        ]),
    );
    write(
        own,
        "Folders/Dunhara.md",
        note([
            "shortcode: dunhara",
            "name: {full: Dunhara}",
            "type: folder",
            "data:",
            "  parent: lore",
        ]),
    );
    write(
        own,
        "Places/Dunhara.md",
        note(["shortcode: dunharargn", "name: {full: Dunhara}", "type: place", "subType: region"]),
    );
    write(
        own,
        "Beings/Afrun.md",
        note([
            "shortcode: farazunfrn",
            "name: {full: Farazûn Afrûn, given: Farazûn, clan: Belgogâr}",
            "type: being",
            "subType: character",
            "data:",
            "  culture: lore-dunhariclt",
        ]),
    );
    write(
        own,
        "Affiliations/Cults.md",
        note([
            "shortcode: strmclts",
            "name: {full: The Storm Cults}",
            "type: affiliation",
            "subType: order",
            "data:",
            "  culture: lore-dunhariclt",
            "  governance:",
            "    ranks:",
            "      - {level: 1, title: Belgogâr, description: A rain-caller.}",
            "      - {level: 0, title: Bondsman, description: Bound.}",
        ]),
    );
    write(
        own,
        "Affiliations/Faraway.md",
        note([
            "shortcode: faraway",
            "name: {full: The Faraway Court}",
            "type: affiliation",
            "subType: polity",
            "data:",
            "  governance:",
            "    ranks:",
            "      - {level: 0, title: Bondsman, description: Bound far away.}",
        ]),
    );
    write(
        own,
        "Places/Other.md",
        note(["shortcode: otherplc", "name: {full: Dunhara}", "type: place", "subType: site"]),
    );
    write(
        own,
        "Places/Secret.md",
        note([
            "shortcode: secretplc",
            "name: {full: Dunhara}",
            "type: place",
            "subType: site",
            "tags: [gm]",
        ]),
    );
    write(
        own,
        "Lore/Pronouncing.md",
        note([
            "shortcode: pronouncing",
            "name: {full: Pronouncing}",
            "type: doc",
            "subType: reference",
            "data:",
            "  sounds:",
            "    letters:",
            "      - {letters: [sh], kind: consonant, like: ship, ipa: ʃ}",
            "      - {letters: [ui], kind: vowel pair, like: gooey, ipa: ui, tongue: [skill-dunharlng, sovidurlng]}",
            "    marks:",
            "      - {mark: circumflex, letters: [â], kind: length, limit: any}",
        ]),
    );
    const records = collectContentIndex(own, { contentPackage: "demo", skipDirectories: [] });

    const theirs = path.join(dir, "theirs");
    write(
        theirs,
        "Skills/Elder.md",
        note([
            "shortcode: elderlng",
            "name: {full: Elder}",
            "type: skill",
            "subType: language",
            "data:",
            "  roots:",
            "    - {root: k-r, sense: old}",
        ]),
    );
    const dependency = collectContentIndex(theirs, {
        contentPackage: "elder",
        skipDirectories: [],
    });
    const file = path.join(dir, "elder-metadata.jsonl");
    fs.writeFileSync(file, serializeContentIndex(dependency));
    db = await openNotesDatabase(records, {
        dir: path.join(dir, "db"),
        dependencies: [{ id: "elder", file }],
        audience: "public",
    });
}, 60_000);

afterAll(async () => {
    await db?.close();
    fs.rmSync(dir, { recursive: true, force: true });
});

const DUNHARI = "demo-note-skill-dunharlng";

/** The rows of a query, positions as plain numbers. */
async function rows(sql: string) {
    const result = await runSqlQuery(db, sql);
    return result.rows.map((row: any) =>
        Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
                key,
                typeof value === "bigint" ? Number(value) : value,
            ]),
        ),
    );
}

describe("the `register` relation", () => {
    it("holds one row per name, its pieces spelt out", async () => {
        expect(
            await rows(
                `SELECT position, name, tongue, built, built_text FROM register WHERE language = '${DUNHARI}' ORDER BY position`,
            ),
        ).toEqual([
            {
                position: 0,
                name: "Belgogâr",
                tongue: "dunhari",
                built: ["belg-", "-ogâr"],
                built_text: "belg- + -ogâr",
            },
            { position: 1, name: "Dunhara", tongue: "dunhari", built: null, built_text: null },
            {
                position: 2,
                name: "Dunhari Lexicon",
                tongue: "translation",
                built: null,
                built_text: null,
            },
            { position: 3, name: "Bondsman", tongue: "translation", built: null, built_text: null },
            { position: 4, name: "Nobody", tongue: "dunhari", built: null, built_text: null },
            { position: 5, name: "Aldous", tongue: null, built: null, built_text: null },
        ]);
        expect(
            await rows(
                `SELECT kind, why FROM register WHERE language = '${DUNHARI}' AND position = 5`,
            ),
        ).toEqual([{ kind: "given", why: "a short name no element builds" }]);
    });

    it("joins each name to the notes in scope carrying it, as a name, a listed form, a name part, a title or an anchor, and never a folder", async () => {
        expect(
            await rows(
                `SELECT name, notes FROM register WHERE language = '${DUNHARI}' ORDER BY position`,
            ),
        ).toEqual([
            {
                name: "Belgogâr",
                notes: ["demo-note-affiliation-strmclts", "demo-note-being-farazunfrn"],
            },
            { name: "Dunhara", notes: ["demo-note-lore-dunhariclt", "demo-note-place-dunharargn"] },
            { name: "Dunhari Lexicon", notes: ["demo-note-skill-dunharlng#lexicon"] },
            { name: "Bondsman", notes: ["demo-note-affiliation-strmclts"] },
            { name: "Nobody", notes: null },
            { name: "Aldous", notes: null },
        ]);
    });
});

describe("a register with no scope", () => {
    it("joins each name to every note of the package carrying it", async () => {
        expect(
            await rows(
                "SELECT name, notes FROM register WHERE language = 'demo-note-skill-sovidurlng'",
            ),
        ).toEqual([
            {
                name: "Bondsman",
                notes: ["demo-note-affiliation-faraway", "demo-note-affiliation-strmclts"],
            },
        ]);
    });
});

describe("the lists beside the register", () => {
    it("hold retired forms, `instead` always a list", async () => {
        expect(await rows("SELECT form, instead, why FROM retired ORDER BY position")).toEqual([
            { form: "Qadi", instead: ["Vazhmadêr"], why: "an Earth word" },
            { form: "Khalid", instead: ["Kheldûn", "Bezdûn"], why: "an Earth given name" },
            { form: "Morwenna", instead: null, why: "an Earth name" },
        ]);
    });

    it("hold tongues, a tongue's language as `tongue_language`", async () => {
        expect(
            await rows("SELECT language, tag, tongue_language FROM tongues ORDER BY position"),
        ).toEqual([
            { language: DUNHARI, tag: "dunhari", tongue_language: DUNHARI },
            { language: DUNHARI, tag: "translation", tongue_language: null },
        ]);
    });

    it("hold the scope, one row per value under its kind", async () => {
        expect(await rows("SELECT kind, value FROM scope")).toEqual([
            { kind: "cultures", value: "demo-note-lore-dunhariclt" },
            { kind: "addresses", value: DUNHARI },
            { kind: "addresses", value: "demo-note-place-dunharargn" },
            { kind: "addresses", value: "demo-note-lore-dunhariclt" },
            { kind: "paths", value: "Places/" },
            { kind: "skip", value: "demo-note-place-otherplc" },
        ]);
    });
});

describe("the sound relations", () => {
    it("hold letters, `letters` and `tongue` lists", async () => {
        expect(
            await rows(
                `SELECT letters, kind, "like", ipa, tongue FROM letters WHERE language = '${DUNHARI}' ORDER BY position`,
            ),
        ).toEqual([
            {
                letters: ["kh", "gh"],
                kind: "consonant",
                like: "a rasp",
                ipa: null,
                tongue: ["dunhari"],
            },
            { letters: ["â"], kind: "long vowel", like: "father", ipa: "aː", tongue: null },
        ]);
    });

    it("hold a spelling guide's letters and marks, keyed by the guide", async () => {
        const GUIDE = "demo-note-doc-pronouncing";
        expect(
            await rows(
                `SELECT letters, ipa, tongue FROM letters WHERE language = '${GUIDE}' ORDER BY position`,
            ),
        ).toEqual([
            { letters: ["sh"], ipa: "ʃ", tongue: null },
            { letters: ["ui"], ipa: "ui", tongue: ["skill-dunharlng", "sovidurlng"] },
        ]);
        expect(
            await rows(`SELECT mark, letters, kind FROM marks WHERE language = '${GUIDE}'`),
        ).toEqual([{ mark: "circumflex", letters: ["â"], kind: "length" }]);
    });

    it("hold edges, `any` a list of one and none an empty list", async () => {
        expect(await rows("SELECT edge, sounds FROM edges ORDER BY position")).toEqual([
            { edge: "closeConsonant", sounds: ["n", "r"] },
            { edge: "syllabic", sounds: ["any"] },
            { edge: "openCluster", sounds: [] },
        ]);
    });

    it("hold the cluster limit, one row per language stating it", async () => {
        expect(await rows("SELECT language, max FROM clusters")).toEqual([
            { language: DUNHARI, max: 2 },
        ]);
    });

    it("hold spellings read past", async () => {
        expect(await rows("SELECT written, readAs, what FROM read_past ORDER BY position")).toEqual(
            [
                { written: "á", readAs: "a", what: "the acute, a stress mark" },
                { written: "'", readAs: null, what: "the seam" },
            ],
        );
    });

    it("hold one row per step of each sound-change set, `where` read quoted", async () => {
        expect(
            await rows(
                'SELECT position, name, from_language, to_language, step_position, step, change, "where" ' +
                    "FROM sound_changes ORDER BY position, step_position",
            ),
        ).toEqual([
            {
                position: 0,
                name: "From Dunhari to Sovidur",
                from_language: DUNHARI,
                to_language: "demo-note-skill-sovidurlng",
                step_position: 0,
                step: "1",
                change: "`p ph` > `—`",
                where: "anywhere",
            },
            {
                position: 0,
                name: "From Dunhari to Sovidur",
                from_language: DUNHARI,
                to_language: "demo-note-skill-sovidurlng",
                step_position: 1,
                step: "2",
                change: "like vowels merge, long",
                where: null,
            },
            {
                position: 1,
                name: "Sovidur loans",
                from_language: null,
                to_language: null,
                step_position: 0,
                step: "1",
                change: "`q` > `k`",
                where: null,
            },
        ]);
    });

    it("hold the stress rule and the finals", async () => {
        expect(await rows("SELECT language, two, longer, mark FROM stress")).toEqual([
            { language: DUNHARI, two: "last", longer: "final", mark: null },
        ]);
        expect(await rows('SELECT final, "like", ipa FROM finals')).toEqual([
            { final: "ang", like: "father then ng", ipa: "aŋ" },
        ]);
    });

    it("hold the syllable rules as one row, `any` a list of one and harmony in columns", async () => {
        expect(await rows("SELECT * EXCLUDE (language) FROM syllables")).toEqual([
            {
                onsets: "single",
                codas: ["b", "d"],
                finals: ["any"],
                doubled: null,
                vowelPairs: [],
                initialVowel: true,
                finalVowel: true,
                neverInitial: null,
                signature: null,
                harmony_back: ["a", "o"],
                harmony_front: ["e", "ö"],
                harmony_neutral: ["i"],
                harmony_neutralAs: "front",
                harmony_partners: null,
            },
        ]);
    });

    it("hold joining, joins and marks", async () => {
        expect(await rows("SELECT first, second, written, example FROM joining")).toEqual([
            { first: ["a", "â"], second: ["a", "â"], written: "â", example: "méga + andáhr" },
        ]);
        expect(await rows('SELECT meeting, rule, letters, "where" FROM joins')).toEqual([
            { meeting: "V+C", rule: "double", letters: ["p", "t"], where: "between stems" },
        ]);
        expect(
            await rows(
                `SELECT mark, letters, kind, "limit" FROM marks WHERE language = '${DUNHARI}'`,
            ),
        ).toEqual([{ mark: "acute", letters: ["á", "é"], kind: "stress", limit: "one" }]);
    });

    it("hold the skeleton vowel and the frames, a frame's examples by root", async () => {
        expect(await rows("SELECT second, third, between FROM skeleton ORDER BY position")).toEqual(
            [
                { second: ["m", "n"], third: ["r"], between: "u" },
                { second: ["l", "r"], third: null, between: "" },
                { second: ["any"], third: null, between: "a" },
            ],
        );
        expect(
            await rows(
                "SELECT frame, shape, class, makes, list_filter(examples, e -> e.root = 'd-l-k')[1].form AS dlk FROM frames",
            ),
        ).toEqual([
            {
                frame: "bare",
                shape: "K1aK2K3",
                class: ["n"],
                makes: "the thing itself",
                dlk: "dalk",
            },
        ]);
    });
});

describe("elements, roots and cognates", () => {
    it("hold elements, an element's position as `element_position`", async () => {
        expect(
            await rows(
                "SELECT form, variants, element_position, sense, examples FROM elements ORDER BY position",
            ),
        ).toEqual([
            {
                form: "arn-",
                variants: ["arnr-"],
                element_position: "opening",
                sense: "an eagle",
                examples: ["Arnthúl", "Arnhelm"],
            },
            {
                form: "áel",
                variants: null,
                element_position: null,
                sense: "first light",
                examples: null,
            },
        ]);
    });

    it("hold roots, here and in a dependency's schema", async () => {
        expect(await rows("SELECT root, sense, field FROM roots")).toEqual([
            { root: "d-l-k", sense: "stone", field: "stone" },
        ]);
        expect(await rows("SELECT language, root FROM elder.roots")).toEqual([
            { language: "elder-note-skill-elderlng", root: "k-r" },
        ]);
    });

    it("hold one row per cognate form, keyed by the form's language", async () => {
        expect(
            await rows(
                "SELECT position, gloss, proto, form_language, form FROM cognates ORDER BY form",
            ),
        ).toEqual([
            {
                position: 0,
                gloss: "wind",
                proto: "zevrâ",
                form_language: "demo-note-skill-sovidurlng",
                form: "zever",
            },
            { position: 0, gloss: "wind", proto: "zevrâ", form_language: DUNHARI, form: "zevr" },
        ]);
    });

    it("set a cognate table as a pivot of the forms", async () => {
        expect(
            await rows(
                "SELECT max(form) FILTER (WHERE form_language = 'demo-note-skill-dunharlng') AS dunhari, " +
                    "max(form) FILTER (WHERE form_language = 'demo-note-skill-sovidurlng') AS sovidur, gloss " +
                    "FROM cognates GROUP BY position, gloss ORDER BY position",
            ),
        ).toEqual([{ dunhari: "zevr", sovidur: "zever", gloss: "wind" }]);
    });
});

describe("calling names", () => {
    it("hold one row per closing, with the fewest syllables", async () => {
        expect(
            await rows(
                "SELECT form, doubled, usual, min_syllables FROM calling_names ORDER BY position",
            ),
        ).toEqual([
            { form: "-u", doubled: false, usual: "man", min_syllables: 4 },
            { form: null, doubled: true, usual: "either", min_syllables: 4 },
        ]);
    });
});

describe("an empty corpus", () => {
    it("still has every language relation, its list columns lists", async () => {
        const empty = await openNotesDatabase([], { dir: path.join(dir, "db-empty") });
        try {
            for (const sql of [
                "SELECT name, notes, built FROM register WHERE len(notes) > 0",
                "SELECT form FROM retired WHERE list_contains(instead, 'x')",
                "SELECT tag, tongue_language FROM tongues",
                "SELECT kind, value FROM scope",
                "SELECT letters FROM letters WHERE list_contains(letters, 'a')",
                "SELECT edge FROM edges WHERE list_contains(sounds, 'n')",
                "SELECT max + 1 AS n FROM clusters",
                "SELECT written, readAs FROM read_past",
                'SELECT name, step_position + 1 AS n, step, "where" FROM sound_changes',
                "SELECT stress FROM stress",
                'SELECT final, "like" FROM finals',
                "SELECT onsets FROM syllables WHERE initialVowel AND list_contains(codas, 'b')",
                "SELECT written FROM joining WHERE list_contains(first, 'a')",
                "SELECT rule FROM joins WHERE list_contains(letters, 'p')",
                "SELECT mark FROM marks WHERE list_contains(letters, 'á')",
                "SELECT between FROM skeleton WHERE list_contains(second, 'l')",
                "SELECT frame, examples[1].form AS f FROM frames WHERE list_contains(class, 'n')",
                "SELECT form FROM calling_names WHERE doubled AND min_syllables > 3",
                "SELECT element_position FROM elements WHERE list_contains(examples, 'x') OR list_contains(variants, 'x')",
                "SELECT root FROM roots",
                "SELECT form_language, form FROM cognates",
            ]) {
                const result = await runSqlQuery(empty, sql);
                expect(result.rows, sql).toEqual([]);
            }
        } finally {
            await empty.close();
        }
    });
});

describe("the register's scope", () => {
    it("is read from the language note, whatever record shares its Address", () => {
        const language = {
            package: "demo",
            type: "skill",
            subType: "language",
            shortcode: "dunharlng",
            name: { full: "Dunhari" },
            data: {
                register: [{ name: "Elder", tongue: "translation" }],
                scope: { addresses: ["demo-note-affiliation-near"] },
            },
        };
        const journal = {
            package: "demo",
            type: "skill",
            shortcode: "dunharlng",
            name: { full: "Dunhari" },
            documents: "demo-sohl-skill-dunharlng",
        };
        const body = (shortcode: string) => ({
            package: "demo",
            type: "affiliation",
            shortcode,
            name: { full: shortcode },
            data: { governance: { ranks: [{ level: 0, title: "Elder" }] } },
        });
        const records = [journal, language, body("near"), body("far")];
        expect(registerRows(records).map((row: any) => row.notes)).toEqual([
            ["demo-note-affiliation-near"],
        ]);
    });
});
