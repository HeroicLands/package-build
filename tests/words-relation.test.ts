/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **`words` is one row per word of a language note, and `glossary` one per
 * culture or affiliation glossary entry**, in this package's database and in
 * each dependency's schema. The index carries `data.words` whole, its
 * Addresses canonical, and every consumer reads the words from there.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectContentIndex, serializeContentIndex } from "../engine/content-index.mjs";
import { AFFIX_KEYS, FIELD_KEYS, GLOSSARY_ENTRY_KEYS, WORD_KEYS } from "../engine/word-terms.mjs";
import { openNotesDatabase, prepareSqlTables, runSqlQuery } from "../engine/sql-tables.mjs";

/** Write a note into `dir`. */
function write(dir: string, rel: string, text: string) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

const language = (shortcode: string, name: string, data: string[] = [], tags = "") =>
    [
        "---",
        `shortcode: ${shortcode}`,
        `name: {full: ${name}}`,
        "type: skill",
        "subType: language",
        ...(tags ? [`tags: ${tags}`] : []),
        ...(data.length ? ["data:", ...data.map((line) => `  ${line}`)] : []),
        "---",
        "A tongue.",
        "",
    ].join("\n");

/** The number of words a set of index records carries. */
const wordCount = (records: any[]) =>
    records.reduce(
        (sum, record) =>
            sum +
            (record.type === "skill" && Array.isArray(record.data?.words) ?
                record.data.words.length
            :   0),
        0,
    );

let dir: string;
let local: any[];
let dependency: any[];
let db: any;

beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "words-relation-"));
    const own = path.join(dir, "own");
    write(
        own,
        "Skills/Osket.md",
        language("osketlng", "Ösket", [
            "fields:",
            "  - {name: The road, holds: The crossings.}",
            "affixes:",
            "  - {form: -wugh, gloss: cord, attaches: replaces a closing vowel, replaces: vowel, front: -wügh, examples: [ghaukwugh, ghaukwugh-two], tones: L}",
            "words:",
            "  - {form: ghauk, class: n, field: The road, gloss: a road held by descent}",
            "  - {form: göich, class: n, field: The road, gloss: the hearth, source: {kind: borrowed, language: skill-vedyarlng, form: göch}}",
            "  - {form: ghaukwugh, class: n, field: The road, gloss: the guide-cord, built: [ghauk, -wugh, -zz]}",
        ]),
    );
    write(
        own,
        "Skills/Helonic.md",
        language("helonclng", "Helonic", [
            "fields:",
            "  - {name: Sea, holds: The sea.}",
            "words:",
            "  - {form: thalass, class: n, field: Sea, gloss: the sea}",
        ]),
    );
    write(
        own,
        "Skills/Byzarian.md",
        language("byzarlng", "Byzarian", [
            "fields:",
            "  - {name: Sea, holds: The sea.}",
            "words:",
            "  - {form: kyma, class: n, field: Sea, gloss: a wave}",
        ]),
    );
    write(own, "Skills/Vedyari.md", language("vedyarlng", "Vedyari"));
    write(
        own,
        "Skills/Secret.md",
        language(
            "secretlng",
            "Secret",
            [
                "fields:",
                "  - {name: Hidden, holds: Hidden things.}",
                "affixes:",
                "  - {form: -qq, gloss: hidden}",
                "words:",
                "  - {form: qöl, class: n, field: Hidden, gloss: a hidden road}",
            ],
            "[gm]",
        ),
    );
    write(
        own,
        "Lore/Road.md",
        "---\nshortcode: road\nname: {full: The Road}\ntype: lore\nsubType: history\n---\nA road, the _ghauk_ of the clans.\n",
    );
    write(
        own,
        "Lore/Osket.md",
        [
            "---",
            "shortcode: osketclt",
            "name: {full: The Ösket}",
            "type: lore",
            "subType: culture",
            "data:",
            "  language: skill-osketlng",
            "  glossary:",
            "    - {name: ghauk, common: true}",
            '    - {name: blood-field, name_sort: bloodfield, definition: "torn ground", pronunciation: BLUD-feeld}',
            "---",
            "A people.",
            "",
        ].join("\n"),
    );
    write(
        own,
        "Affiliations/Wardens.md",
        [
            "---",
            "shortcode: wardens",
            "name: {full: The Wardens}",
            "type: affiliation",
            "subType: order",
            "data:",
            "  culture: lore-osketclt",
            "  glossary:",
            "    - {name: gate-oath, definition: the oath sworn at the gate}",
            "  governance:",
            "    ranks:",
            "      - {level: 0, title: Outcast, description: Cast out.}",
            "---",
            "An order.",
            "",
        ].join("\n"),
    );

    const theirs = path.join(dir, "theirs");
    write(
        theirs,
        "Skills/Elder.md",
        language("elderlng", "Elder", [
            "fields:",
            "  - {name: Old, holds: Old things.}",
            "affixes:",
            "  - {form: -ar, gloss: elder}",
            "words:",
            "  - {form: ur, class: n, field: Old, gloss: the first}",
        ]),
    );

    local = collectContentIndex(own, { contentPackage: "demo", skipDirectories: [] });
    dependency = collectContentIndex(theirs, { contentPackage: "elder", skipDirectories: [] });
    const file = path.join(dir, "elder-metadata.jsonl");
    fs.writeFileSync(file, serializeContentIndex(dependency));
    db = await openNotesDatabase(local, {
        dir: path.join(dir, "db"),
        dependencies: [{ id: "elder", file }],
    });
}, 60_000);

afterAll(async () => {
    await db?.close();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("the index record of a language note", () => {
    it("carries data.words whole, in order", () => {
        const record = local.find((r) => r.shortcode === "osketlng");
        expect(record.data.words.map((word: any) => word.form)).toEqual([
            "ghauk",
            "göich",
            "ghaukwugh",
        ]);
        expect(record.data.words[2].built).toEqual(["ghauk", "-wugh", "-zz"]);
    });

    it("publishes each Address in it canonical", () => {
        const line = serializeContentIndex(local)
            .split("\n")
            .find((text) => text.includes('"osketlng"'))!;
        const record = JSON.parse(line);
        expect(record.citations).toEqual([{ form: "ghauk", notes: ["demo-note-lore-road"] }]);
        expect(record.data.words[1].source.language).toEqual({
            address: "demo-note-skill-vedyarlng",
            anchor: null,
            anchorKind: null,
        });
    });
});

describe("the `affixes` and `fields` relations", () => {
    it("hold one row per affix, keyed by the language note, with every key a column", async () => {
        const result = await runSqlQuery(
            db,
            "SELECT * FROM affixes WHERE language = 'demo-note-skill-osketlng'",
        );
        expect(result.columns).toEqual(["language", "position", ...AFFIX_KEYS, "written"]);
        expect(result.rows).toHaveLength(1);
        const [row] = result.rows;
        expect(Number(row.position)).toBe(0);
        expect({ ...row, position: 0 }).toEqual({
            language: "demo-note-skill-osketlng",
            position: 0,
            form: "-wugh",
            zero: null,
            kind: null,
            given: null,
            where: null,
            gloss: "cord",
            attaches: "replaces a closing vowel",
            replaces: "vowel",
            lengthens: null,
            front: "-wügh",
            examples: ["ghaukwugh", "ghaukwugh-two"],
            barredAfter: null,
            tones: "L",
            written: "-wugh",
        });
    });

    it("leave a key an entry does not state NULL", async () => {
        const result = await runSqlQuery(db, "SELECT * FROM elder.affixes");
        expect(result.rows).toHaveLength(1);
        const [row] = result.rows;
        expect({ ...row, position: Number(row.position) }).toEqual({
            language: "elder-note-skill-elderlng",
            position: 0,
            form: "-ar",
            zero: null,
            kind: null,
            given: null,
            where: null,
            gloss: "elder",
            attaches: null,
            replaces: null,
            lengthens: null,
            front: null,
            examples: null,
            barredAfter: null,
            tones: null,
            written: "-ar",
        });
    });

    it("hold one row per field, with the language and the position", async () => {
        const result = await runSqlQuery(
            db,
            "SELECT * FROM fields WHERE language <> 'demo-note-skill-secretlng' ORDER BY language",
        );
        expect(result.columns).toEqual(["language", "position", ...FIELD_KEYS]);
        expect(result.rows.map((row: any) => ({ ...row, position: Number(row.position) }))).toEqual(
            [
                {
                    language: "demo-note-skill-byzarlng",
                    position: 0,
                    name: "Sea",
                    holds: "The sea.",
                },
                {
                    language: "demo-note-skill-helonclng",
                    position: 0,
                    name: "Sea",
                    holds: "The sea.",
                },
                {
                    language: "demo-note-skill-osketlng",
                    position: 0,
                    name: "The road",
                    holds: "The crossings.",
                },
            ],
        );
    });

    it("leave a GM note's rows out of a public surface", async () => {
        const dbPublic = await openNotesDatabase(local, {
            dir: path.join(dir, "db-public"),
            audience: "public",
        });
        try {
            const forms = await runSqlQuery(dbPublic, "SELECT form FROM affixes");
            expect(forms.rows).toEqual([{ form: "-wugh" }]);
            const names = await runSqlQuery(
                dbPublic,
                "SELECT name FROM fields WHERE name = 'Hidden'",
            );
            expect(names.rows).toEqual([]);
        } finally {
            await dbPublic.close();
        }
    });

    it("hold a GM note's rows on a private one", async () => {
        const result = await runSqlQuery(db, "SELECT form FROM affixes ORDER BY form");
        expect(result.rows).toEqual([{ form: "-qq" }, { form: "-wugh" }]);
    });
});

describe("the `words` relation", () => {
    it("holds one row per word in this package", async () => {
        const result = await runSqlQuery(db, "SELECT count(*) AS n FROM words");
        expect(Number(result.rows[0].n)).toBe(wordCount(local));
        expect(wordCount(local)).toBe(6);
    });

    it("holds one row per word in a dependency's schema", async () => {
        const result = await runSqlQuery(db, "SELECT form, language FROM elder.words");
        expect(result.rows).toEqual([{ form: "ur", language: "elder-note-skill-elderlng" }]);
    });

    it("carries the language, the position and every word key as its own column", async () => {
        const result = await runSqlQuery(db, "SELECT * FROM words WHERE form = 'göich'");
        expect(result.columns).toEqual(
            expect.arrayContaining([
                "language",
                "position",
                ...WORD_KEYS,
                "built_text",
                "built_parts",
                "senses",
                "attested",
            ]),
        );
        const row = result.rows[0];
        expect(row.language).toBe("demo-note-skill-osketlng");
        expect(Number(row.position)).toBe(1);
        expect(row.source).toEqual({
            kind: "borrowed",
            language: "demo-note-skill-vedyarlng",
            form: "göch",
        });
        expect(row.name_sort).toBe("göich");
    });

    it("keys each row by the language note that states it", async () => {
        const result = await runSqlQuery(
            db,
            "SELECT form, language FROM words WHERE form IN ('thalass', 'kyma') ORDER BY form",
        );
        expect(result.rows).toEqual([
            { form: "kyma", language: "demo-note-skill-byzarlng" },
            { form: "thalass", language: "demo-note-skill-helonclng" },
        ]);
    });

    it("spells out what a word is built from, glossing each piece it can", async () => {
        const result = await runSqlQuery(
            db,
            "SELECT built_text, built_parts FROM words WHERE form = 'ghaukwugh'",
        );
        expect(result.rows[0].built_text).toBe("ghauk + -wugh + -zz");
        expect(result.rows[0].built_parts).toEqual([
            { form: "ghauk", gloss: "a road held by descent" },
            { form: "-wugh", gloss: "cord" },
            { form: "-zz", gloss: null },
        ]);
    });

    it("filters on a citing note's Address as an author writes it", async () => {
        const result = await runSqlQuery(
            db,
            "SELECT form FROM words WHERE list_contains(attested, 'demo-note-lore-road')",
        );
        expect(result.rows).toEqual([{ form: "ghauk" }]);
    });

    it("answers a key no word writes as NULL rather than failing to bind", async () => {
        const result = await runSqlQuery(
            db,
            "SELECT count(*) AS n FROM words WHERE tones IS NULL AND pronunciation IS NULL AND frame IS NULL",
        );
        expect(Number(result.rows[0].n)).toBe(wordCount(local));
    });

    it("leaves out a GM language's words on a public surface", async () => {
        const pub = await openNotesDatabase(local, {
            dir: path.join(dir, "db-public"),
            audience: "public",
        });
        try {
            const result = await runSqlQuery(pub, "SELECT count(*) AS n FROM words");
            expect(Number(result.rows[0].n)).toBe(wordCount(local) - 1);
        } finally {
            await pub.close();
        }
    });

    it("renders a fence over words in the note's order", async () => {
        const body = [
            "```sql",
            'SELECT form AS "Form", gloss AS "Gloss" FROM words WHERE language = \'demo-note-skill-osketlng\' ORDER BY position',
            "```",
            "",
        ].join("\n");
        const prepared = await prepareSqlTables(db, [
            { source: "Words.md", markdown: body, frontmatter: {} },
        ]);
        const [table] = prepared.get("Words.md") as any;
        expect(table.reason).toBeUndefined();
        expect(String(table.markdown)).toMatch(/ghauk[\s\S]*göich[\s\S]*ghaukwugh/);
    });
});

describe("the `glossary` relation", () => {
    it("holds one row per culture and affiliation glossary entry, defaults filled", async () => {
        const result = await runSqlQuery(db, "SELECT * FROM glossary ORDER BY note, position");
        expect(result.columns).toEqual(
            expect.arrayContaining(["note", "position", ...GLOSSARY_ENTRY_KEYS]),
        );
        expect(result.rows.map((row: any) => ({ ...row, position: Number(row.position) }))).toEqual(
            [
                {
                    note: "demo-note-affiliation-wardens",
                    position: 0,
                    name: "gate-oath",
                    name_sort: "gate-oath",
                    common: false,
                    definition: "the oath sworn at the gate",
                    pronunciation: null,
                    language: "demo-note-skill-osketlng",
                },
                {
                    note: "demo-note-lore-osketclt",
                    position: 0,
                    name: "ghauk",
                    name_sort: "ghauk",
                    common: true,
                    definition: null,
                    pronunciation: null,
                    language: "demo-note-skill-osketlng",
                },
                {
                    note: "demo-note-lore-osketclt",
                    position: 1,
                    name: "blood-field",
                    name_sort: "bloodfield",
                    common: false,
                    definition: "torn ground",
                    pronunciation: "BLUD-feeld",
                    language: "demo-note-skill-osketlng",
                },
            ],
        );
    });

    it("exists in a dependency's schema, empty where it states none", async () => {
        const result = await runSqlQuery(db, "SELECT count(*) AS n FROM elder.glossary");
        expect(Number(result.rows[0].n)).toBe(0);
    });
});

describe("a language with many words", () => {
    it("reads as one relation beside every other record's shape", async () => {
        const big = path.join(dir, "big");
        write(
            big,
            "Lore/Road.md",
            "---\nshortcode: road\nname: {full: The Road}\ntype: lore\nsubType: history\n---\nA road.\n",
        );
        const rows = Array.from(
            { length: 1200 },
            (_, i) =>
                `  - {form: w${i}, class: ${i % 3 ? "n" : "v"}, field: All, gloss: word ${i}${i % 5 ? "" : ", source: {kind: coined}"}}`,
        );
        write(
            big,
            "Skills/Big.md",
            language("biglng", "Big", [
                "fields:",
                "  - {name: All, holds: Everything.}",
                "words:",
                ...rows,
            ]),
        );
        const records = collectContentIndex(big, { contentPackage: "big", skipDirectories: [] });
        const large = await openNotesDatabase(records, { dir: path.join(dir, "db-big") });
        try {
            const notes = await runSqlQuery(
                large,
                "SELECT len(data.words) AS n FROM notes WHERE shortcode = 'biglng'",
            );
            expect(Number(notes.rows[0].n)).toBe(1200);
            const words = await runSqlQuery(large, "SELECT count(*) AS n FROM words");
            expect(Number(words.rows[0].n)).toBe(1200);
        } finally {
            await large.close();
        }
    });
});

describe("an empty corpus", () => {
    it("still has `words` and `glossary` relations, with their columns", async () => {
        const empty = await openNotesDatabase([], { dir: path.join(dir, "db-empty") });
        try {
            const words = await runSqlQuery(
                empty,
                "SELECT language, position, form, built_text FROM words",
            );
            expect(words.rows).toEqual([]);
            const glossary = await runSqlQuery(
                empty,
                "SELECT note, name, common, language FROM glossary",
            );
            expect(glossary.rows).toEqual([]);
        } finally {
            await empty.close();
        }
    });
});
