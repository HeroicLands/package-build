/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **Words and terms are two relations.** `dictionary` is one row per word per
 * language it is listed under, inherited words included; `terms` is one row
 * per term per note that owns it — a culture's or an affiliation's glossary
 * entry, a rank, an office. Any query chooses what a page shows. The fixture
 * tree under `fixtures/dictionary/tree` holds one case of every rule.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectContentIndex } from "../engine/content-index.mjs";
import { DICTIONARY_COLUMNS, TERM_COLUMNS } from "../engine/dictionary-rows.mjs";
import { openNotesDatabase, runSqlQuery } from "../engine/sql-tables.mjs";
import { DICTIONARY_LANGUAGES } from "./helpers/dictionary-languages";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TREE = path.join(HERE, "fixtures", "dictionary", "tree");

const at = (type: string, shortcode: string) => `demo-note-${type}-${shortcode}`;
const PROVENZIA = at("lore", "provnzclt");
const NORDHEIM = at("lore", "nordclt");
const KINGDOM = at("affiliation", "kingdom");
const DUCHY = at("affiliation", "duchy");
const GUARD = at("affiliation", "guard");
const CHURCH = at("affiliation", "church");
const WATCH = at("affiliation", "watch");
const PROVENZAL = at("skill", "provnzlng");
const LITURGIC = at("skill", "litrglng");
const HELONIC = at("skill", "helonclng");
const BYZARIAN = at("skill", "byzarlng");
const NORDMAL = at("skill", "nordmlng");
const ELDER = at("skill", "elderlng");

let dir: string;
let db: any;
let records: any[];

/** Rows of a query, a BigInt `depth` read as a number. */
async function rows(sql: string, database = db) {
    const result = await runSqlQuery(database, sql);
    return result.rows.map((row: any) =>
        "depth" in row ? { ...row, depth: row.depth === null ? null : Number(row.depth) } : row,
    );
}

/** Rows of a query by `name`, each name once. */
async function byName(sql: string, database = db) {
    return new Map((await rows(sql, database)).map((row: any) => [`${row.name}`, row]));
}

/** Rows of a query by `owner` and `name`. */
async function byOwner(sql: string) {
    return new Map((await rows(sql)).map((row: any) => [`${row.owner} ${row.name}`, row]));
}

beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dictionary-relation-"));
    records = collectContentIndex(TREE, {
        contentPackage: "demo",
        skipDirectories: [],
        languages: DICTIONARY_LANGUAGES,
    });
    db = await openNotesDatabase(records, { dir: path.join(dir, "db") });
}, 60_000);

afterAll(async () => {
    await db?.close();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("the `dictionary` relation", () => {
    it("has every column it declares", async () => {
        const result = await runSqlQuery(db, "SELECT * FROM dictionary");
        expect(result.columns).toEqual([...DICTIONARY_COLUMNS]);
    });

    it("lists a language's words with the words it inherits, and how far up each is", async () => {
        const byz = await byName(`SELECT * FROM dictionary WHERE language = '${BYZARIAN}'`);
        expect([...byz.keys()].sort()).toEqual(["kyma", "thalass"]);
        expect(byz.get("kyma")).toMatchObject({
            language_tag: "Byz.",
            class: "n",
            pronunciation: "KY-ma",
            depth: 0,
            etymology: null,
            senses: [{ text: "a wave", bodies: [] }],
        });
        expect(byz.get("thalass")).toMatchObject({
            depth: 1,
            etymology: {
                kind: "inherited",
                language: HELONIC,
                language_tag: "Hel.",
                form: "thalass",
            },
            senses: [{ text: "the sea", bodies: [] }],
        });
    });

    it("lists each word once under the language that states it at depth 0", async () => {
        const stated = await rows("SELECT language, name FROM dictionary WHERE depth = 0");
        expect(stated.filter((row: any) => row.name === "thalass")).toEqual([
            { language: HELONIC, name: "thalass" },
        ]);
        expect(stated).toHaveLength(7);
    });

    it("leaves out a name, a stem and a prefix", async () => {
        const all = await byName("SELECT * FROM dictionary");
        for (const name of ["Kyrios", "am"]) expect(all.has(name), name).toBe(false);
    });

    it("carries a word's source, its pieces and its citations", async () => {
        const prov = await byName(`SELECT * FROM dictionary WHERE language = '${PROVENZAL}'`);
        expect([...prov.keys()].sort()).toEqual(["amère", "duc", "solmère"]);
        expect(prov.get("solmère")).toMatchObject({
            usage: [at("lore", "lastshrine"), at("lore", "secretsong")],
            etymology: {
                kind: "borrowed",
                language: at("skill", "elvndrlng"),
                language_tag: "Élav.",
                form: "sólmerë",
            },
        });
        expect(prov.get("amère")!.etymology.parts).toEqual([
            { form: "am-", gloss: "love" },
            { form: "-ère", gloss: "one who" },
        ]);
    });

    it("keeps a culture's glossary choices on its own term", async () => {
        const dictionary = await rows(
            `SELECT name, pronunciation FROM dictionary WHERE language = '${PROVENZAL}' AND name = 'solmère'`,
        );
        expect(dictionary).toEqual([{ name: "solmère", pronunciation: null }]);
        const terms = await byOwner("SELECT * FROM terms");
        expect(terms.get(`${PROVENZIA} solmère`)).toMatchObject({
            common: true,
            class: "n m",
            pronunciation: "sol-MEH-reh",
            senses: [{ text: "longing; the ache for a time that is gone", bodies: [] }],
        });
    });

    it("tags a language that states no abbreviation with its name", async () => {
        const elder = await byName(`SELECT * FROM dictionary WHERE language = '${ELDER}'`);
        expect(elder.get("ur")).toMatchObject({
            language_tag: "Elder Tongue",
            etymology: { kind: "inherited", language: null, form: "hur" },
        });
    });
});

describe("the `terms` relation", () => {
    it("has every column it declares", async () => {
        const result = await runSqlQuery(db, "SELECT * FROM terms");
        expect(result.columns).toEqual([...TERM_COLUMNS]);
    });

    it("is one row per term per owning note", async () => {
        const all = await rows("SELECT owner, name FROM terms");
        expect(all).toHaveLength(23);
        const subjects = all
            .filter((row: any) => row.name === "Subject")
            .map((row: any) => row.owner);
        expect(subjects.sort()).toEqual([DUCHY, KINGDOM, PROVENZIA]);
    });

    it("makes a rank and an office of one title in one body one row", async () => {
        const all = await byOwner("SELECT * FROM terms");
        expect(all.get(`${KINGDOM} Knight-Captain`)).toMatchObject({
            owner_kind: "affiliation",
            language: PROVENZAL,
            language_tag: "Prov.",
            senses: [
                { text: "A knight who leads a company.", bodies: [KINGDOM] },
                { text: "Commands the guard in the field.", bodies: [KINGDOM] },
            ],
            usage: [KINGDOM, at("being", "mara")],
            origins: ["office", "rank"],
            cultures: [PROVENZIA],
        });
    });

    it("cites an office's holders and a rank's members", async () => {
        const all = await byOwner("SELECT * FROM terms");
        expect(all.get(`${KINGDOM} Lord Steward`).usage).toEqual([KINGDOM, at("being", "aran")]);
        expect(all.get(`${KINGDOM} Sworn Knight`).usage).toEqual([KINGDOM, at("being", "aran")]);
    });

    it("replaces an owner's own rank or office with its own definition", async () => {
        const all = await byOwner("SELECT * FROM terms");
        expect(all.get(`${DUCHY} Écuyer Tranchant`)).toMatchObject({
            senses: [{ text: "Carves and serves at the duke's table.", bodies: [DUCHY] }],
            origins: ["glossary", "office"],
        });
    });

    it("gives a culture's definition of another body's rank a row of the culture's own", async () => {
        const all = await byOwner("SELECT * FROM terms");
        expect(all.get(`${PROVENZIA} Sworn Knight`)).toMatchObject({
            owner_kind: "culture",
            language: PROVENZAL,
            senses: [{ text: "a knight bound by oath to a lord", bodies: [PROVENZIA] }],
            usage: [PROVENZIA],
            origins: ["glossary"],
            cultures: [PROVENZIA],
        });
        expect(all.get(`${KINGDOM} Sworn Knight`).senses).toEqual([
            { text: "Holds land of the crown.", bodies: [KINGDOM] },
        ]);
    });

    it("creates a term from a definition that names nothing", async () => {
        const all = await byOwner("SELECT * FROM terms");
        expect(all.get(`${PROVENZIA} blood-field`)).toMatchObject({
            name_sort: "bloodfield",
            letter: "B",
            senses: [{ text: "ground torn by a battle", bodies: [PROVENZIA] }],
        });
        expect(all.get(`${PROVENZIA} 'ostal`).letter).toBe("O");
        expect(all.get(`${DUCHY} Écuyer Tranchant`).letter).toBe("E");
    });

    it("admits a rank its culture names and keeps the common choice on the culture's term", async () => {
        const all = await byOwner("SELECT * FROM terms");
        expect(all.get(`${KINGDOM} Subject`)).toMatchObject({ common: false });
        expect(all.get(`${DUCHY} Subject`)).toMatchObject({ common: false });
        expect(all.get(`${PROVENZIA} Subject`)).toMatchObject({ common: true });
        expect(all.get(`${KINGDOM} Duc`)).toMatchObject({
            senses: [{ text: "A peer of the realm.", bodies: [KINGDOM] }],
        });
        for (const name of ["Outlaw", "Guardsman", "Apostate", "Layman", "Karl", "Watchman"])
            expect(
                [...all.keys()].some((key) => key.endsWith(` ${name}`)),
                name,
            ).toBe(false);
    });

    it("tags a church's terms with the church's own tongue", async () => {
        const all = await byOwner("SELECT * FROM terms");
        expect(all.get(`${CHURCH} Ordained Priest`)).toMatchObject({ language: LITURGIC });
        expect(all.get(`${CHURCH} vigil-oath`)).toMatchObject({
            language: LITURGIC,
            senses: [{ text: "the oath sworn at the night vigil", bodies: [CHURCH] }],
            usage: [CHURCH],
        });
    });

    it("reaches a culture through a parent affiliation, with the body's own terms", async () => {
        const all = await byOwner("SELECT * FROM terms");
        expect(all.get(`${GUARD} Captain of the Guard`).cultures).toEqual([PROVENZIA]);
        expect(all.get(`${WATCH} Watch-Captain`)).toMatchObject({
            language: NORDMAL,
            cultures: [NORDHEIM, PROVENZIA],
        });
        expect(all.get(`${WATCH} watch-fire`).cultures).toEqual([NORDHEIM, PROVENZIA]);
    });

    it("answers a culture's glossary with one list_contains", async () => {
        const names = (
            await rows(`SELECT name FROM terms WHERE list_contains(cultures, '${NORDHEIM}')`)
        )
            .map((row: any) => row.name)
            .sort();
        expect(names).toEqual(["Shield-Bearer", "Watch-Captain", "blood-price", "watch-fire"]);
    });

    it("holds a rank whose body reaches no culture and no language", async () => {
        const all = await byName("SELECT * FROM terms");
        expect(all.get("Road-Warden")).toMatchObject({
            language: null,
            language_tag: null,
            cultures: [],
        });
    });
});

describe("on a public surface", () => {
    it("cites no note withheld from players", async () => {
        const pub = await openNotesDatabase(records, {
            dir: path.join(dir, "db-public"),
            audience: "public",
        });
        try {
            const prov = await byName(
                `SELECT * FROM dictionary WHERE language = '${PROVENZAL}'`,
                pub,
            );
            expect(prov.get("solmère").usage).toEqual([at("lore", "lastshrine")]);
        } finally {
            await pub.close();
        }
    });
});
