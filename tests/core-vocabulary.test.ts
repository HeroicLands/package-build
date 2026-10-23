/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A setting's core vocabulary is data.** A `doc` note states the concept
 * list in `data.concepts`; a language note says it must cover the list with
 * `data.core: true`; a word serves a concept with `data.words[].concept`. The
 * lint refuses a concept no list declares, with the near miss, and the
 * `core` report lists what each covering language has no word for, reading a
 * parent language's words as the daughter's own.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { collectContentIndex } from "../engine/content-index.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { coreReport, coreReportText } from "../engine/core-report.mjs";
import { encodeAddresses } from "../engine/address-values.mjs";
import { dictionaryAndTermRows } from "../engine/dictionary-rows.mjs";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { WORD_KEYS } from "../engine/word-terms.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const roots: string[] = [];
afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

/** The concept list: eight concepts in three groups. */
const CONCEPTS = [
    "---",
    "shortcode: coreconcepts",
    "name: {full: Core concepts}",
    "type: doc",
    "subType: reference",
    "data:",
    "  concepts:",
    "    - {id: see-verb, gloss: to see, group: senses}",
    "    - {id: smell-noun, gloss: a smell; a scent, group: senses}",
    "    - {id: taste-noun, gloss: a taste, group: senses}",
    "    - {id: head, gloss: the head, group: body}",
    "    - {id: knee, gloss: the knee, group: body}",
    "    - {id: red, gloss: the colour red, group: colours}",
    "    - {id: green, gloss: the colour green, group: colours}",
    "    - {id: mother, gloss: a mother, group: kinship}",
    "---",
    "",
    "The concepts a human language covers.",
    "",
].join("\n");

/** A language note: `extra` lines under `data:` and `words` as flow rows. */
function language(shortcode: string, name: string, extra: string[], words: string[]) {
    return [
        "---",
        `shortcode: ${shortcode}`,
        `name: {full: ${name}}`,
        "type: skill",
        "subType: language",
        "data:",
        "  fields:",
        "    - {name: Life, holds: Everyday words.}",
        ...extra,
        "  words:",
        ...words.map((row) => `    - ${row}`),
        "---",
        "",
        "A tongue.",
        "",
    ].join("\n");
}

const ELDER = language(
    "elderlng",
    "Elder",
    [],
    [
        "{form: oma, class: n, field: Life, gloss: a mother, concept: mother}",
        "{form: kep, class: n, field: Life, gloss: the head, concept: head}",
        "{form: rud, class: n, field: Life, gloss: red and ruddy, concept: [red, green]}",
        "{form: tul, class: n, field: Life, gloss: a hearth}",
    ],
);

const YOUNGER = language(
    "youngerlng",
    "Younger",
    ["  core: true", "  family: skill-elderlng"],
    [
        "{form: veda, class: n, field: Life, gloss: a sight, concept: see-verb}",
        "{form: skal, class: n, field: Life, gloss: a smell, concept: smell-noun}",
    ],
);

const LONELY = language("lonelylng", "Lonely", ["  core: true"], []);

/** The findings of a tree, and its index records. */
function tree(notes: Record<string, string>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "core-vocabulary-"));
    roots.push(root);
    for (const [rel, text] of Object.entries(notes)) {
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
    return { findings, records, root };
}

const FULL = {
    "Docs/Concepts.md": CONCEPTS,
    "Skills/Elder.md": ELDER,
    "Skills/Younger.md": YOUNGER,
};

/** The text at a finding's position. */
function at(text: string, finding: { line?: number; column?: number }) {
    expect(finding.line, "a finding is located on its line").toBeTypeOf("number");
    expect(finding.column, "a finding is located on its column").toBeTypeOf("number");
    return text.split("\n")[finding.line! - 1].slice(finding.column! - 1);
}

describe("the core vocabulary's keys", () => {
    it("are declared: concepts on doc, core on skill, concept on a word", () => {
        expect(dataFields("doc").map((field: { name: string }) => field.name)).toContain(
            "concepts",
        );
        expect(dataFields("skill").map((field: { name: string }) => field.name)).toContain("core");
        expect(WORD_KEYS).toContain("concept");
    });

    it("lint clean on a consistent tree", () => {
        expect(tree(FULL).findings).toEqual([]);
    });
});

describe("a word's concept", () => {
    it("refuses an id the list does not declare, at the key, with the near miss", () => {
        const text = ELDER.replace("concept: mother", "concept: mothr");
        const { findings } = tree({ ...FULL, "Skills/Elder.md": text });
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toBe("`mothr` is not a core concept; did you mean `mother`?");
        expect(at(text, findings[0]).startsWith("mothr")).toBe(true);
    });

    it("names no near miss where nothing is near", () => {
        const text = ELDER.replace("concept: mother", "concept: zebra");
        const { findings } = tree({ ...FULL, "Skills/Elder.md": text });
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toBe("`zebra` is not a core concept");
    });

    it("checks each id of a list on its own column", () => {
        const text = ELDER.replace("concept: [red, green]", "concept: [red, gren]");
        const { findings } = tree({ ...FULL, "Skills/Elder.md": text });
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/`gren` is not a core concept; did you mean `green`/);
        expect(at(text, findings[0]).startsWith("gren")).toBe(true);
    });

    it("refuses an id stated twice in one word", () => {
        const text = ELDER.replace("concept: [red, green]", "concept: [red, red]");
        const { findings } = tree({ ...FULL, "Skills/Elder.md": text });
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/`red` is stated twice/);
    });

    it("refuses a concept where no note states a list", () => {
        const { findings } = tree({ "Skills/Elder.md": ELDER });
        expect(findings.length).toBeGreaterThan(0);
        for (const finding of findings) {
            expect(finding.severity).toBe("error");
            expect(finding.message).toMatch(/no note states `data.concepts`/);
        }
    });

    it("refuses a value that is neither an id nor a list of them", () => {
        const text = ELDER.replace("concept: mother", "concept: {id: mother}");
        const { findings } = tree({ ...FULL, "Skills/Elder.md": text });
        expect(findings.length).toBeGreaterThan(0);
        expect(findings[0].severity).toBe("error");
    });
});

describe("the concept list", () => {
    it("refuses an id that is not lowercase letters, digits and hyphens, at the id", () => {
        const text = CONCEPTS.replace("id: knee,", "id: Knee_2,");
        const { findings } = tree({ ...FULL, "Docs/Concepts.md": text });
        const ours = findings.filter((finding: any) => /Knee_2/.test(finding.message));
        expect(ours).toHaveLength(1);
        expect(ours[0].severity).toBe("error");
        expect(at(text, ours[0]).startsWith("Knee_2")).toBe(true);
    });

    it("refuses an id stated twice, at the second", () => {
        const text = CONCEPTS.replace("id: knee,", "id: head,");
        const { findings } = tree({ ...FULL, "Docs/Concepts.md": text });
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/`head` is stated twice/);
        expect(at(text, findings[0]).startsWith("head, gloss: the knee")).toBe(true);
    });

    it("refuses an id another note's list also states", () => {
        const other = CONCEPTS.replace("coreconcepts", "moreconcepts");
        const { findings } = tree({ ...FULL, "Docs/More.md": other });
        expect(findings.length).toBeGreaterThan(0);
        expect(findings[0].message).toMatch(/is also stated by/);
    });

    it("refuses an entry with no gloss or group, or a blank one", () => {
        const noGloss = CONCEPTS.replace(
            "{id: red, gloss: the colour red, group: colours}",
            "{id: red, group: colours}",
        );
        expect(tree({ ...FULL, "Docs/Concepts.md": noGloss }).findings).not.toEqual([]);
        const blank = CONCEPTS.replace("group: colours}", 'group: ""}');
        expect(tree({ ...FULL, "Docs/Concepts.md": blank }).findings).not.toEqual([]);
    });

    it("is refused on a type that does not declare it", () => {
        const text = ELDER.replace(
            "  fields:",
            "  concepts:\n    - {id: a, gloss: b, group: c}\n  fields:",
        );
        const { findings } = tree({ ...FULL, "Skills/Elder.md": text });
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(at(text, findings[0]).startsWith("concepts")).toBe(true);
    });
});

describe("`data.core`", () => {
    it("is refused on a skill that is no language, at the key", () => {
        const text = [
            "---",
            "shortcode: climb",
            "name: {full: Climb}",
            "type: skill",
            "subType: physical",
            "data:",
            "  core: true",
            "---",
            "",
            "A skill.",
            "",
        ].join("\n");
        const { findings } = tree({ ...FULL, "Skills/Climb.md": text });
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toMatch(/`data.core`.*language/);
        expect(at(text, findings[0]).startsWith("core")).toBe(true);
    });

    it("is refused when it is not true or false", () => {
        const text = YOUNGER.replace("core: true", "core: yes please");
        const { findings } = tree({ ...FULL, "Skills/Younger.md": text });
        expect(findings).toHaveLength(1);
        expect(at(text, findings[0]).startsWith("yes please")).toBe(true);
    });
});

describe("the core report", () => {
    const { records } = tree({ ...FULL, "Skills/Lonely.md": LONELY });

    it("reads a parent's tagged words as the daughter's own", () => {
        const report: any = coreReport(records);
        const younger = report.languages.find((one: any) => one.name === "Younger");
        const missing = younger.missing.flatMap((group: any) =>
            group.concepts.map((c: any) => c.id),
        );
        // Its own: see-verb, smell-noun. The parent's: mother, head, red, green.
        expect(missing).toEqual(["taste-noun", "knee"]);
        expect(younger.covered).toBe(6);
        expect(younger.total).toBe(8);
    });

    it("inherits a multiword expression and each of its recorded concepts", () => {
        const elder = language(
            "elderlng",
            "Elder",
            [],
            [
                '{form: "nelá tor", class: n, field: Life, gloss: [the head, a knee], concept: [head, knee]}',
            ],
        );
        const { records, findings } = tree({ ...FULL, "Skills/Elder.md": elder });
        expect(findings).toEqual([]);
        const report: any = coreReport(records, { language: "younger" });
        expect(report.languages[0].covered).toBe(4);
        const dictionary = dictionaryAndTermRows(
            records.map((record: any) => encodeAddresses(record)),
        ).dictionary;
        expect(
            dictionary.find((row: any) => row.name === "nelá tor" && row.depth === 1)?.senses,
        ).toEqual([
            { text: "the head", bodies: [] },
            { text: "a knee", bodies: [] },
        ]);
    });

    it("counts the nearest expression's concepts when it shadows an ancestor", () => {
        const elder = language(
            "elderlng",
            "Elder",
            [],
            [
                '{form: "nelá tor", class: n, field: Life, gloss: [the head, a knee], concept: [head, knee]}',
                "{form: oma, class: n, field: Life, gloss: a mother, concept: mother}",
            ],
        );
        const middle = language(
            "middlelng",
            "Middle",
            ["  family: skill-elderlng"],
            [
                '{form: "nela\u0301 tor", class: n, field: Life, gloss: a taste, concept: taste-noun}',
            ],
        );
        const younger = language(
            "youngerlng",
            "Younger",
            ["  core: true", "  family: skill-middlelng"],
            ["{form: oma, class: n, field: Life, gloss: a hearth}"],
        );
        const { records, findings } = tree({
            ...FULL,
            "Skills/Elder.md": elder,
            "Skills/Middle.md": middle,
            "Skills/Younger.md": younger,
        });
        expect(findings).toEqual([]);
        const report: any = coreReport(records, { language: "younger" });
        expect(report.languages[0].covered).toBe(1);
        const missing = report.languages[0].missing.flatMap((group: any) =>
            group.concepts.map((concept: any) => concept.id),
        );
        expect(missing).toContain("head");
        expect(missing).toContain("knee");
        expect(missing).toContain("mother");
        const dictionary = dictionaryAndTermRows(
            records.map((record: any) => encodeAddresses(record)),
        ).dictionary;
        expect(
            dictionary.find(
                (row: any) => row.name === "nelá tor" && row.language.endsWith("youngerlng"),
            )?.senses,
        ).toEqual([{ text: "a taste", bodies: [] }]);
    });

    it("keeps distinct spellings and other expressions for a shadowed concept", () => {
        const elder = language(
            "elderlng",
            "Elder",
            [],
            [
                "{form: tor, class: n, field: Life, gloss: the head, concept: head}",
                "{form: Tor, class: n, field: Life, gloss: a knee, concept: knee}",
                '{form: "ne-tor", class: n, field: Life, gloss: a taste, concept: taste-noun}',
                "{form: kep, class: n, field: Life, gloss: the head, concept: head}",
            ],
        );
        const younger = language(
            "youngerlng",
            "Younger",
            ["  core: true", "  family: skill-elderlng"],
            [
                "{form: tor, class: n, field: Life, gloss: a hearth}",
                '{form: "ne tor", class: n, field: Life, gloss: a mother, concept: mother}',
            ],
        );
        const { records, findings } = tree({
            ...FULL,
            "Skills/Elder.md": elder,
            "Skills/Younger.md": younger,
        });
        expect(findings).toEqual([]);
        const report: any = coreReport(records, { language: "younger" });
        expect(report.languages[0].covered).toBe(4);
    });

    it("lists only the languages that state `core: true`, in name order", () => {
        const report: any = coreReport(records);
        expect(report.languages.map((one: any) => one.name)).toEqual(["Lonely", "Younger"]);
    });

    it("lists a language with no words as missing every concept, by group in list order", () => {
        const report: any = coreReport(records, { language: "lonely" });
        expect(report.languages).toHaveLength(1);
        const lonely = report.languages[0];
        expect(lonely.covered).toBe(0);
        expect(lonely.missing.map((group: any) => [group.group, group.concepts.length])).toEqual([
            ["senses", 3],
            ["body", 2],
            ["colours", 2],
            ["kinship", 1],
        ]);
    });

    it("answers a named language that states no `core`, by name, shortcode or address", () => {
        for (const key of ["Elder", "elderlng", "skill-elderlng"]) {
            const report: any = coreReport(records, { language: key });
            expect(report.problem, key).toBeUndefined();
            expect(report.languages.map((one: any) => one.name)).toEqual(["Elder"]);
        }
    });

    it("names the problem for a language that is none, or a tree with no list", () => {
        expect((coreReport(records, { language: "Nowhere" }) as any).problem).toMatch(
            /`Nowhere` is no language note/,
        );
        const bare = tree({ "Skills/Lonely.md": LONELY }).records;
        expect((coreReport(bare) as any).problem).toMatch(/no note states `data.concepts`/);
    });

    it("prints the missing concepts by group with counts", () => {
        const text = coreReportText(coreReport(records, { language: "younger" }) as any);
        expect(text).toBe(
            [
                "Younger (skill-youngerlng): 2 of 8 core concepts have no word",
                "  senses: 1 of 3",
                "    taste-noun\ta taste",
                "  body: 1 of 2",
                "    knee\tthe knee",
                "",
            ].join("\n"),
        );
    });

    it("says so when a language covers the core", () => {
        const full = YOUNGER.replace(
            "  words:\n",
            "  words:\n    - {form: ya, class: n, field: Life, gloss: taste, concept: taste-noun}\n    - {form: yb, class: n, field: Life, gloss: knee, concept: knee}\n",
        );
        const done = tree({ ...FULL, "Skills/Younger.md": full }).records;
        expect(coreReportText(coreReport(done) as any)).toBe(
            "Younger (skill-youngerlng): all 8 core concepts have a word\n",
        );
    });

    it("serialises for an agent, every field a value", () => {
        const report: any = coreReport(records, { language: "younger" });
        expect(JSON.parse(JSON.stringify(report))).toEqual({
            concepts: 8,
            languages: [
                {
                    name: "Younger",
                    language: "skill-youngerlng",
                    core: true,
                    total: 8,
                    covered: 6,
                    missing: [
                        {
                            group: "senses",
                            count: 1,
                            total: 3,
                            concepts: [{ id: "taste-noun", gloss: "a taste" }],
                        },
                        {
                            group: "body",
                            count: 1,
                            total: 2,
                            concepts: [{ id: "knee", gloss: "the knee" }],
                        },
                    ],
                },
            ],
        });
    });
});
