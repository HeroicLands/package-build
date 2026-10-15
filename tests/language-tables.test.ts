/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A language note states its mutations, cluster groups, vowel partners,
 * affix kinds, name elements by kind, forms older than the rules and its
 * negative particle in frontmatter**, each a relation keyed by the language.
 * The lint holds every entry to its shape and to what it names, one finding
 * per wrong entry, located at the key at fault and read back from the file.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectContentIndex } from "../engine/content-index.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { CLUSTER_USES } from "../engine/language-terms.mjs";
import { AFFIX_GIVEN, AFFIX_KINDS } from "../engine/word-terms.mjs";
import { openNotesDatabase, runSqlQuery } from "../engine/sql-tables.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const roots: string[] = [];
afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const ELDER = [
    "---",
    "shortcode: elderlng",
    "name: {full: Elder}",
    "type: skill",
    "subType: language",
    "data:",
    "  fields:",
    "    - {name: Old words, holds: the words of the elder tongue}",
    "  words:",
    "    - {form: ahi, class: part, field: Old words, gloss: not}",
    "---",
    "",
    "The elder tongue.",
    "",
].join("\n");

/** A language note stating every key this file covers, each entry well formed. */
const VELITH = [
    "---",
    "shortcode: velithlng",
    "name: {full: Velith}",
    "type: skill",
    "subType: language",
    "data:",
    "  family: skill-elderlng",
    "  fields:",
    "    - {name: Grammar words, holds: the particles}",
    "  words:",
    "    - {form: nel, class: n, field: Grammar words, gloss: snow}",
    "  affixes:",
    "    - {form: -ren, front: -rën, gloss: genitive, kind: case, examples: [nuuvaren]}",
    "    - {form: -dhe, front: -dhë, gloss: a man's name, kind: name, given: man}",
    "    - {form: -nto, front: -ntë, gloss: lineage, kind: lineage, barredAfter: [n]}",
    "    - {zero: true, gloss: nominative, kind: case}",
    "    - {form: sa-, gloss: causative, kind: voice}",
    "    - {form: s-, gloss: causative, kind: voice, where: before a stop}",
    "  tongues:",
    "    - {tag: velith, meaning: a Velith name}",
    "  register:",
    "    - {name: Edrak, tongue: velith, built: [edr-, -ak], gloss: the thicket at the bound}",
    "  sounds:",
    "    letters:",
    "      - {letters: [p], kind: stop, place: lips}",
    "      - {letters: [a], kind: vowel, like: father}",
    "    clusters:",
    "      max: 2",
    "      groups:",
    "        - {what: a long liquid, clusters: [ll, nn], use: common}",
    "        - {what: a long stop, clusters: [pp, tt], use: sparing}",
    "    syllables:",
    "      vowelPairs: [ai, ei]",
    "      harmony:",
    "        back: [a, ai]",
    "        front: [y, ë]",
    "        neutral: [e, ei]",
    "        neutralAs: back",
    "        partners: {a: ë, e: ë, y: y}",
    "    mutations:",
    '      - {mutation: wearing, sound: p, becomes: v, example: "pelvai > velvai"}',
    "      - {mutation: wearing, sound: t, becomes: s}",
    "      - {mutation: doubling, sound: th, becomes: tth}",
    "  soundChanges:",
    "    - name: From the elder tongue",
    "      from: skill-elderlng",
    "      takes: accusative",
    "      steps:",
    '        - {step: "1", change: "`p` > `f`"}',
    "  elements:",
    "    - {form: nel, sense: snow, word: nel}",
    "    - {form: -borg, position: closing, sense: a stronghold, kind: place, genitive: -borgar}",
    "  older:",
    "    - {form: Haulonna, gloss: the hearth of the unfallen leaf, layer: Primordial}",
    "    - {form: Nordheim}",
    "  negation: {particle: ahi, mutation: wearing}",
    "  naming:",
    "    shapes:",
    "      - {of: given, syllables: {min: 3, max: 4}}",
    "      - {of: bound, syllables: {min: 2, max: 3}, perVowel: {min: 1.0, max: 3.5}}",
    "      - {of: compound, perVowel: {min: 1.0, max: 5.0}}",
    "    edges:",
    "      - {edge: openConsonant, sounds: [b, d, th], vowel: true}",
    "      - {edge: openCluster, sounds: [br, thr]}",
    "      - {edge: closeConsonant, sounds: [d, g], vowel: true}",
    "      - {edge: closeConsonant, sounds: [kh], of: clan}",
    "    draws:",
    "      - {kind: byname, elements: [byname, place]}",
    "      - {kind: place, elements: [place]}",
    "    heldFrom:",
    "      - {source: the ground alone, takes: stem}",
    "      - {source: a god, takes: godName, clip: first}",
    '      - {source: a founder, takes: givenName, genitive: ["-s", "-a"]}',
    '      - {source: the ting and its law, takes: element, elements: ["ting-", "lög-"]}',
    "    nearName:",
    "      minSyllables: 4",
    "      examples:",
    "        - {near: Anlâ, given: Anlagherhafu}",
    "        - {near: Imhû, given: Imhûgepu}",
    "---",
    "",
    "The tongue of the leaf.",
    "",
].join("\n");

/** Lint a tree holding the elder tongue and the given notes. */
function lint(notes: Record<string, string>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "language-tables-"));
    roots.push(root);
    for (const [rel, text] of Object.entries({ "Skills/Elder.md": ELDER, ...notes })) {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
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
        ...lintFrontmatter(index, { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY }).findings,
    ];
    const files = new Set(Object.keys(notes).map((rel) => path.join(root, rel)));
    return findings.filter((finding) => files.has(finding.file));
}

/** The text at a finding's position, read from the note it was raised on. */
function at(text: string, finding: { line?: number; column?: number }) {
    expect(finding.line, "a finding is located on its line").toBeTypeOf("number");
    expect(finding.column, "a finding is located on its column").toBeTypeOf("number");
    return text.split("\n")[finding.line! - 1].slice(finding.column! - 1);
}

/** Exactly one finding, of the given severity, saying `message`, located at `where`. */
function one(text: string, message: RegExp, where: string, severity = "error") {
    const findings = lint({ "Skills/Velith.md": text });
    expect(findings, JSON.stringify(findings)).toHaveLength(1);
    const [finding] = findings;
    expect(finding.severity).toBe(severity);
    expect(finding.message).toMatch(message);
    expect(at(text, finding).startsWith(where), `located at ${where}`).toBe(true);
}

/** `VELITH` with one passage replaced, the replacement required to apply. */
function edit(from: string, to: string) {
    expect(VELITH, `the note holds ${from}`).toContain(from);
    return VELITH.replace(from, to);
}

describe("the keys beside the letters and the words", () => {
    it("accept every key, each entry well formed", () => {
        expect(lint({ "Skills/Velith.md": VELITH })).toEqual([]);
    });

    it("close their vocabularies to the labels the setting's tables use", () => {
        expect(CLUSTER_USES).toEqual(["common", "sparing"]);
        expect(AFFIX_KINDS).toEqual([
            "case",
            "derivation",
            "tense",
            "aspect",
            "mood",
            "voice",
            "name",
            "lineage",
        ]);
        expect(AFFIX_GIVEN).toEqual(["man", "woman", "either"]);
    });

    it("refuse the forms older than the rules, the negation and the naming on a skill of another subType, at the key", () => {
        const text = [
            "---",
            "shortcode: riding",
            "name: {full: Riding}",
            "type: skill",
            "subType: physical",
            "data:",
            "  older:",
            "    - {form: Haulonna}",
            "  negation: {particle: ahi}",
            "  naming:",
            "    nearName: {minSyllables: 4}",
            "---",
            "",
            "A skill.",
            "",
        ].join("\n");
        const findings = [...lint({ "Skills/Riding.md": text })].sort(
            (a: any, b: any) => a.line - b.line,
        );
        expect(findings.map((finding: any) => at(text, finding).split(":")[0])).toEqual([
            "older",
            "negation",
            "naming",
        ]);
        for (const finding of findings) expect(finding.message).toMatch(/describes a language/);
    });
});

describe("letters", () => {
    it("accept a row that states its kind and place and nothing of how it sounds", () => {
        expect(
            lint({
                "Skills/Velith.md": edit(
                    "{letters: [a], kind: vowel, like: father}",
                    "{letters: [a], kind: vowel}",
                ),
            }),
        ).toEqual([]);
    });
});

describe("mutations", () => {
    it("refuse a sound stated twice in one mutation, at the second", () => {
        one(
            edit("{mutation: wearing, sound: t,", "{mutation: wearing, sound: p,"),
            /the sound `p` stands twice in the mutation `wearing`, first at `data\.sounds\.mutations\[0\]`/,
            "p, becomes: s",
        );
    });

    it("keep one sound apart in two mutations", () => {
        expect(
            lint({
                "Skills/Velith.md": edit(
                    "{mutation: doubling, sound: th,",
                    "{mutation: doubling, sound: p,",
                ),
            }),
        ).toEqual([]);
    });

    it("refuse a row with nothing it becomes, at the row", () => {
        one(
            edit("{mutation: wearing, sound: t, becomes: s}", "{mutation: wearing, sound: t}"),
            /`data\.sounds\.mutations\[1\]` must state `becomes`/,
            "{mutation: wearing, sound: t}",
        );
    });
});

describe("cluster groups", () => {
    it("refuse a use outside the closed list, at the value", () => {
        one(
            edit("use: sparing}", "use: rare}"),
            /`data\.sounds\.clusters\.groups\[1\]\.use` should be `common` or `sparing`/,
            "rare",
        );
    });

    it("refuse a cluster stated in two groups, at the second", () => {
        one(
            edit("clusters: [pp, tt]", "clusters: [pp, nn]"),
            /the cluster `nn` stands twice, first in `data\.sounds\.clusters\.groups\[0\]`/,
            "nn]",
        );
    });

    it("refuse an `innerCluster` edge beside them, at the edge", () => {
        const text = edit(
            "    clusters:\n",
            "    edges:\n      - {edge: innerCluster, sounds: [ll]}\n    clusters:\n",
        );
        one(
            text,
            /`data\.sounds\.clusters\.groups` states the clusters inside a word, so no `innerCluster` edge does/,
            "innerCluster",
        );
    });
});

describe("vowel partners", () => {
    it("refuse a key that is no vowel of the harmony, at the key", () => {
        one(
            edit("partners: {a: ë,", "partners: {o: ë,"),
            /`o` is not a vowel of `data\.sounds\.syllables\.harmony`/,
            "o: ë",
        );
    });

    it("refuse a partner that is no front vowel, at the value", () => {
        one(
            edit("e: ë, y: y}", "e: a, y: y}"),
            /the partner `a` of `e` is not one of the harmony's `front` vowels/,
            "a, y: y}",
        );
    });
});

describe("affixes", () => {
    it("refuse a kind outside the closed list, at the value", () => {
        one(edit("kind: lineage,", "kind: clan,"), /`data\.affixes\[2\]\.kind` should be/, "clan");
    });

    it("refuse a `given` on an affix of another kind, at the key", () => {
        one(
            edit("gloss: lineage, kind: lineage,", "gloss: lineage, kind: lineage, given: either,"),
            /`given` says who a given name belongs to, and `data\.affixes\[2\]` is of kind `lineage`/,
            "given",
        );
    });

    it("refuse a `given` on an affix that states no kind, at the key", () => {
        one(
            edit("kind: name, given: man}", "given: man}"),
            /`data\.affixes\[1\]` is of no kind/,
            "given",
        );
    });

    it("refuse a `given` outside the closed list, at the value", () => {
        one(
            edit("given: man}", "given: boy}"),
            /`data\.affixes\[1\]\.given` should be `man` or `woman` or `either`/,
            "boy",
        );
    });
});

describe("elements", () => {
    it("refuse a `word` that is no word of the language or its ancestors, at the value", () => {
        one(
            edit("word: nel}", "word: nelu}"),
            /the word `nelu` of the element `nel` is not a form of this language's words or its ancestors'/,
            "nelu",
        );
    });

    it("refuse a kind outside the closed list, at the value", () => {
        one(
            edit("kind: place, genitive", "kind: clan, genitive"),
            /`data\.elements\[1\]\.kind` should be `byname` or `given` or `place`/,
            "clan",
        );
    });
});

describe("the forms older than the rules", () => {
    it("refuse a form stated twice, at the second", () => {
        one(
            edit("    - {form: Nordheim}", "    - {form: Haulonna}"),
            /the form `Haulonna` stands twice, first at `data\.older\[0\]`/,
            "Haulonna}",
        );
    });

    it("refuse an entry with no form, at the entry", () => {
        one(
            edit("    - {form: Nordheim}", "    - {layer: Primordial}"),
            /`data\.older\[1\]` must state `form`/,
            "{layer: Primordial}",
        );
    });
});

describe("negation", () => {
    it("reads its particle from an ancestor's words", () => {
        expect(lint({ "Skills/Velith.md": VELITH })).toEqual([]);
    });

    it("refuses a particle that is no word of the language or its ancestors, at the value", () => {
        one(
            edit("{particle: ahi,", "{particle: ahu,"),
            /the negative particle `ahu` is not a form of this language's words or its ancestors'/,
            "ahu",
        );
    });

    it("refuses a mutation `data.sounds.mutations` does not name, at the value", () => {
        one(
            edit("mutation: wearing}", "mutation: voicing}"),
            /the mutation `voicing` is not one of `data\.sounds\.mutations`/,
            "voicing}",
        );
    });

    it("refuses a negation with no particle, at the key", () => {
        one(
            edit(
                "  negation: {particle: ahi, mutation: wearing}",
                "  negation: {mutation: wearing}",
            ),
            /`data\.negation` must state `particle`/,
            "negation: {mutation: wearing}",
        );
    });
});

describe("a zero affix", () => {
    it("refuses `zero: true` beside a form, at `zero`", () => {
        one(
            edit("{zero: true, gloss: nominative,", "{form: -a, zero: true, gloss: nominative,"),
            /`data\.affixes\[3\]` states a `form` and `zero: true`; a zero affix states no form/,
            "zero: true",
        );
    });

    it("refuses an affix with neither a form nor `zero: true`, at the entry", () => {
        one(
            edit("{zero: true, gloss: nominative,", "{gloss: nominative,"),
            /`data\.affixes\[3\]` states neither a `form` nor `zero: true`/,
            "{gloss: nominative",
        );
    });

    it("is never read as a built piece", () => {
        const text = edit(
            "    - {form: nel, class: n, field: Grammar words, gloss: snow}",
            "    - {form: nel, class: n, field: Grammar words, gloss: snow}\n" +
                '    - {form: nelen, class: n, field: Grammar words, gloss: snows, built: [nel, ""]}',
        );
        const findings = lint({ "Skills/Velith.md": text });
        expect(findings.map((finding: any) => finding.message)).toEqual([
            expect.stringMatching(/the piece `` of `nelen` matches no word or affix/),
        ]);
    });

    it("refuses a `barredAfter` that is not a list, at the value", () => {
        one(
            edit("barredAfter: [n]}", "barredAfter: n}"),
            /`data\.affixes\[2\]\.barredAfter` should be a list of sounds/,
            "n}",
        );
    });
});

describe("naming", () => {
    it("refuses a class of name outside the closed list, at the value", () => {
        one(
            edit("{of: compound,", "{of: epithet,"),
            /`data\.naming\.shapes\[2\]\.of` should be/,
            "epithet",
        );
    });

    it("refuses a shape stated twice for one class of name, at the second", () => {
        one(
            edit("{of: compound,", "{of: bound,"),
            /the class of name `bound` has its shape stated twice, first at `data\.naming\.shapes\[1\]`/,
            "bound, perVowel: {min: 1.0, max: 5.0}",
        );
    });

    it("refuses a shape that states neither syllables nor consonants per vowel, at the entry", () => {
        one(
            edit("{of: given, syllables: {min: 3, max: 4}}", "{of: given}"),
            /`data\.naming\.shapes\[0\]` states neither `syllables` nor `perVowel`/,
            "{of: given}",
        );
    });

    it("refuses a range whose least is above its most, at the range", () => {
        one(
            edit("syllables: {min: 3, max: 4}", "syllables: {min: 4, max: 3}"),
            /`data\.naming\.shapes\[0\]\.syllables` runs from 4 to 3; its `min` is above its `max`/,
            "{min: 4, max: 3}",
        );
    });

    it("refuses an edge stated twice for one class of name, at the second", () => {
        one(
            edit(
                "{edge: closeConsonant, sounds: [kh], of: clan}",
                "{edge: closeConsonant, sounds: [kh]}",
            ),
            /the edge `closeConsonant` of `name` stands twice, first at `data\.naming\.edges\[2\]`/,
            "closeConsonant, sounds: [kh]",
        );
    });

    it("keeps an edge of one class of name apart from the same edge of another", () => {
        expect(lint({ "Skills/Velith.md": VELITH })).toEqual([]);
    });

    it("refuses an edge outside the closed list, at the value", () => {
        one(
            edit("{edge: openCluster,", "{edge: openPair,"),
            /`data\.naming\.edges\[1\]\.edge` should be/,
            "openPair",
        );
    });

    it("refuses a kind of name whose draws are stated twice, at the second", () => {
        one(
            edit("{kind: place, elements: [place]}", "{kind: byname, elements: [place]}"),
            /the kind `byname` has its draws stated twice, first at `data\.naming\.draws\[0\]`/,
            "byname, elements: [place]",
        );
    });

    it("refuses an element kind outside the closed list, at the value", () => {
        one(
            edit("elements: [byname, place]}", "elements: [byname, river]}"),
            /`data\.naming\.draws\[0\]\.elements\[1\]` should be/,
            "river",
        );
    });

    it("refuses a held-from row that takes an element and names none, at the row", () => {
        one(
            edit('takes: element, elements: ["ting-", "lög-"]}', "takes: element}"),
            /`data\.naming\.heldFrom\[3\]` takes an `element` and names no `elements`/,
            "{source: the ting and its law",
        );
    });

    it("refuses `elements` on a held-from row that takes no element, at the key", () => {
        one(
            edit(
                "{source: the ground alone, takes: stem}",
                '{source: the ground alone, takes: stem, elements: ["a-"]}',
            ),
            /`elements` lists what a place takes first, and `data\.naming\.heldFrom\[0\]` takes a `stem`/,
            "elements",
        );
    });

    it("refuses a clip or a genitive on a held-from row that takes no name, at the key", () => {
        one(
            edit(
                "{source: the ground alone, takes: stem}",
                "{source: the ground alone, takes: stem, clip: first}",
            ),
            /`clip` shapes a name, and `data\.naming\.heldFrom\[0\]` takes a `stem`/,
            "clip",
        );
    });

    it("refuses a takes outside the closed list, at the value", () => {
        one(
            edit("takes: godName, clip", "takes: godsName, clip"),
            /`data\.naming\.heldFrom\[1\]\.takes` should be/,
            "godsName",
        );
    });

    it("refuses a near name with no fewest syllables, at the key", () => {
        one(
            edit("      minSyllables: 4\n", ""),
            /`data\.naming\.nearName` must state `minSyllables`/,
            "nearName:",
        );
    });
});

describe("the relations", () => {
    let dir: string;
    let db: any;
    const LANGUAGE = "demo-note-skill-velithlng";

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "language-tables-db-"));
        const tree = path.join(dir, "tree");
        for (const [rel, text] of Object.entries({
            "Skills/Elder.md": ELDER,
            "Skills/Velith.md": VELITH,
        })) {
            fs.mkdirSync(path.dirname(path.join(tree, rel)), { recursive: true });
            fs.writeFileSync(path.join(tree, rel), text);
        }
        const records = collectContentIndex(tree, { contentPackage: "demo", skipDirectories: [] });
        db = await openNotesDatabase(records, { dir: path.join(dir, "db") });
    }, 60_000);

    afterAll(async () => {
        await db?.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

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

    it("hold one row per mutation entry", async () => {
        expect(await rows("SELECT * FROM mutations ORDER BY position")).toEqual([
            {
                language: LANGUAGE,
                position: 0,
                mutation: "wearing",
                sound: "p",
                becomes: "v",
                example: "pelvai > velvai",
            },
            {
                language: LANGUAGE,
                position: 1,
                mutation: "wearing",
                sound: "t",
                becomes: "s",
                example: null,
            },
            {
                language: LANGUAGE,
                position: 2,
                mutation: "doubling",
                sound: "th",
                becomes: "tth",
                example: null,
            },
        ]);
    });

    it("hold one row per cluster group, its clusters a list", async () => {
        expect(await rows("SELECT * FROM cluster_groups ORDER BY position")).toEqual([
            {
                language: LANGUAGE,
                position: 0,
                what: "a long liquid",
                clusters: ["ll", "nn"],
                use: "common",
            },
            {
                language: LANGUAGE,
                position: 1,
                what: "a long stop",
                clusters: ["pp", "tt"],
                use: "sparing",
            },
        ]);
    });

    it("hold the vowel partners in the syllable row, in the order stated", async () => {
        expect(await rows("SELECT harmony_partners FROM syllables")).toEqual([
            {
                harmony_partners: [
                    { vowel: "a", partner: "ë" },
                    { vowel: "e", partner: "ë" },
                    { vowel: "y", partner: "y" },
                ],
            },
        ]);
    });

    it("set the diphthongs back by harmony set", async () => {
        const sql =
            "SELECT 'back' AS \"set\", list_filter(vowelPairs, p -> list_contains(harmony_back, p)) AS pairs FROM syllables " +
            "UNION ALL SELECT 'neutral', list_filter(vowelPairs, p -> list_contains(harmony_neutral, p)) FROM syllables";
        expect(await rows(sql)).toEqual([
            { set: "back", pairs: ["ai"] },
            { set: "neutral", pairs: ["ei"] },
        ]);
    });

    it("hold a letter's place, and no sound where it states none", async () => {
        expect(
            await rows('SELECT letters, kind, "like", place FROM letters ORDER BY position'),
        ).toEqual([
            { letters: ["p"], kind: "stop", like: null, place: "lips" },
            { letters: ["a"], kind: "vowel", like: "father", place: null },
        ]);
    });

    it("hold an affix's kind, who it is given to and where it stands", async () => {
        expect(
            await rows(
                `SELECT form, front, kind, given, "where" FROM affixes WHERE language = '${LANGUAGE}' ORDER BY position`,
            ),
        ).toEqual([
            { form: "-ren", front: "-rën", kind: "case", given: null, where: null },
            { form: "-dhe", front: "-dhë", kind: "name", given: "man", where: null },
            { form: "-nto", front: "-ntë", kind: "lineage", given: null, where: null },
            { form: null, front: null, kind: "case", given: null, where: null },
            { form: "sa-", front: null, kind: "voice", given: null, where: null },
            { form: "s-", front: null, kind: "voice", given: null, where: "before a stop" },
        ]);
    });

    it("hold an element's kind, word and genitive", async () => {
        expect(
            await rows("SELECT form, kind, word, genitive FROM elements ORDER BY position"),
        ).toEqual([
            { form: "nel", kind: null, word: "nel", genitive: null },
            { form: "-borg", kind: "place", word: null, genitive: "-borgar" },
        ]);
    });

    it("hold a register name's gloss", async () => {
        expect(await rows("SELECT name, gloss FROM register")).toEqual([
            { name: "Edrak", gloss: "the thicket at the bound" },
        ]);
    });

    it("hold the form a sound-change set takes", async () => {
        expect(await rows("SELECT name, takes FROM sound_changes")).toEqual([
            { name: "From the elder tongue", takes: "accusative" },
        ]);
    });

    it("hold one row per form older than the rules", async () => {
        expect(await rows("SELECT * FROM older ORDER BY position")).toEqual([
            {
                language: LANGUAGE,
                position: 0,
                form: "Haulonna",
                gloss: "the hearth of the unfallen leaf",
                layer: "Primordial",
            },
            { language: LANGUAGE, position: 1, form: "Nordheim", gloss: null, layer: null },
        ]);
    });

    it("hold one negation row per language stating it", async () => {
        expect(await rows("SELECT * FROM negation")).toEqual([
            { language: LANGUAGE, particle: "ahi", mutation: "wearing" },
        ]);
    });
});

describe("the naming relations", () => {
    let dir: string;
    let db: any;
    const LANGUAGE = "demo-note-skill-velithlng";

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "language-naming-db-"));
        const tree = path.join(dir, "tree");
        for (const [rel, text] of Object.entries({
            "Skills/Elder.md": ELDER,
            "Skills/Velith.md": VELITH,
        })) {
            fs.mkdirSync(path.dirname(path.join(tree, rel)), { recursive: true });
            fs.writeFileSync(path.join(tree, rel), text);
        }
        const records = collectContentIndex(tree, { contentPackage: "demo", skipDirectories: [] });
        db = await openNotesDatabase(records, { dir: path.join(dir, "db") });
    }, 60_000);

    afterAll(async () => {
        await db?.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

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

    it("hold a zero affix with its form NULL and `∅` as written, and a stem's barred close", async () => {
        expect(
            await rows(
                `SELECT form, zero, barredAfter, written AS shown FROM affixes WHERE language = '${LANGUAGE}' AND position >= 2 ORDER BY position`,
            ),
        ).toEqual([
            { form: "-nto", zero: null, barredAfter: ["n"], shown: "-nto" },
            { form: null, zero: true, barredAfter: null, shown: "∅" },
            { form: "sa-", zero: null, barredAfter: null, shown: "sa-" },
            { form: "s-", zero: null, barredAfter: null, shown: "s-" },
        ]);
    });

    it("hold one row per shape, its ranges in columns", async () => {
        expect(await rows("SELECT * FROM name_shapes ORDER BY position")).toEqual([
            {
                language: LANGUAGE,
                position: 0,
                of: "given",
                syllables_min: 3,
                syllables_max: 4,
                per_vowel_min: null,
                per_vowel_max: null,
            },
            {
                language: LANGUAGE,
                position: 1,
                of: "bound",
                syllables_min: 2,
                syllables_max: 3,
                per_vowel_min: 1,
                per_vowel_max: 3.5,
            },
            {
                language: LANGUAGE,
                position: 2,
                of: "compound",
                syllables_min: null,
                syllables_max: null,
                per_vowel_min: 1,
                per_vowel_max: 5,
            },
        ]);
    });

    it("hold a consonants-per-vowel bound as a fraction even where every bound is whole", async () => {
        expect(
            await rows(
                "SELECT DISTINCT typeof(per_vowel_min) AS min, typeof(per_vowel_max) AS max FROM name_shapes",
            ),
        ).toEqual([{ min: "DOUBLE", max: "DOUBLE" }]);
    });

    it("hold one row per name edge, its class `name` where unstated", async () => {
        expect(
            await rows("SELECT edge, sounds, vowel, of FROM name_edges ORDER BY position"),
        ).toEqual([
            { edge: "openConsonant", sounds: ["b", "d", "th"], vowel: true, of: "name" },
            { edge: "openCluster", sounds: ["br", "thr"], vowel: false, of: "name" },
            { edge: "closeConsonant", sounds: ["d", "g"], vowel: true, of: "name" },
            { edge: "closeConsonant", sounds: ["kh"], vowel: false, of: "clan" },
        ]);
    });

    it("hold the element kinds each kind of name draws on", async () => {
        expect(await rows("SELECT kind, elements FROM name_draws ORDER BY position")).toEqual([
            { kind: "byname", elements: ["byname", "place"] },
            { kind: "place", elements: ["place"] },
        ]);
    });

    it("hold one row per held-from source", async () => {
        expect(
            await rows(
                "SELECT source, takes, clip, genitive, elements FROM held_from ORDER BY position",
            ),
        ).toEqual([
            {
                source: "the ground alone",
                takes: "stem",
                clip: null,
                genitive: null,
                elements: null,
            },
            { source: "a god", takes: "godName", clip: "first", genitive: null, elements: null },
            {
                source: "a founder",
                takes: "givenName",
                clip: null,
                genitive: ["-s", "-a"],
                elements: null,
            },
            {
                source: "the ting and its law",
                takes: "element",
                clip: null,
                genitive: null,
                elements: ["ting-", "lög-"],
            },
        ]);
    });

    it("hold one row per near-name example, with the fewest syllables", async () => {
        expect(
            await rows("SELECT near, given, min_syllables FROM near_names ORDER BY position"),
        ).toEqual([
            { near: "Anlâ", given: "Anlagherhafu", min_syllables: 4 },
            { near: "Imhû", given: "Imhûgepu", min_syllables: 4 },
        ]);
    });
});

describe("an empty corpus", () => {
    it("still has the new relations, their list columns lists", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "language-tables-empty-"));
        roots.push(dir);
        const db = await openNotesDatabase([], { dir: path.join(dir, "db") });
        try {
            const result = await runSqlQuery(
                db,
                "SELECT DISTINCT table_name, column_name, data_type FROM information_schema.columns " +
                    "WHERE (table_name = 'cluster_groups' AND column_name = 'clusters') " +
                    "OR (table_name = 'syllables' AND column_name = 'harmony_partners') " +
                    "OR (table_name = 'mutations' AND column_name = 'position') " +
                    "OR (table_name = 'older' AND column_name = 'position') " +
                    "OR (table_name = 'negation' AND column_name = 'particle') " +
                    "OR (table_name = 'name_edges' AND column_name = 'sounds') " +
                    "OR (table_name = 'name_shapes' AND column_name = 'per_vowel_min') " +
                    "OR (table_name = 'held_from' AND column_name = 'elements') " +
                    "ORDER BY table_name",
            );
            expect(result.rows).toEqual([
                { table_name: "cluster_groups", column_name: "clusters", data_type: "VARCHAR[]" },
                { table_name: "held_from", column_name: "elements", data_type: "VARCHAR[]" },
                { table_name: "mutations", column_name: "position", data_type: "BIGINT" },
                { table_name: "name_edges", column_name: "sounds", data_type: "VARCHAR[]" },
                { table_name: "name_shapes", column_name: "per_vowel_min", data_type: "DOUBLE" },
                { table_name: "negation", column_name: "particle", data_type: "VARCHAR" },
                { table_name: "older", column_name: "position", data_type: "BIGINT" },
                {
                    table_name: "syllables",
                    column_name: "harmony_partners",
                    data_type: "STRUCT(vowel VARCHAR, partner VARCHAR)[]",
                },
            ]);
        } finally {
            await db.close();
        }
    });
});
