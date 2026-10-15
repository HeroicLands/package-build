/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A word's citations are derived from prose**: every note whose body marks
 * the word in italics cites it, matched by its form or a declared variant with
 * diacritics and case set aside. An italic word that spells no word cites
 * nothing, a language note's own body cites nothing, and the index carries the
 * citing Addresses, which the `words` and `dictionary` relations read.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectContentIndex } from "../engine/content-index.mjs";
import { foldForm, markedUses } from "../engine/word-citations.mjs";
import { openNotesDatabase, runSqlQuery } from "../engine/sql-tables.mjs";

/** Write a note into `dir`. */
function write(dir: string, rel: string, text: string) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

/** A lore note whose body is `body`. */
const lore = (shortcode: string, body: string, tags = "") =>
    [
        "---",
        `shortcode: ${shortcode}`,
        `name: {full: ${shortcode}}`,
        "type: lore",
        "subType: history",
        ...(tags ? [`tags: ${tags}`] : []),
        "---",
        "",
        body,
        "",
    ].join("\n");

describe("a marked use", () => {
    it("is the text of an italic span, in either spelling of italics", () => {
        expect(markedUses("The _vazhmadêr_ and the *gholvabûn* sit; **bold** is not.")).toEqual([
            "vazhmadêr",
            "gholvabûn",
        ]);
    });

    it("is not a span holding a link or code, nor anything in a code fence", () => {
        const body = [
            "A _[[place-x|Qarvel]]_ link, an _`code`_ span and _a [link](x) here_.",
            "",
            "```text",
            "_zevrogâr_",
            "```",
        ].join("\n");
        expect(markedUses(body)).toEqual([]);
    });

    it("folds case and diacritics to match", () => {
        expect(foldForm("Vazhmadêr")).toBe(foldForm("vazhmader"));
        expect(foldForm("Ghavûlâvad")).toBe("ghavulavad");
    });
});

let dir: string;
let records: any[];
let db: any;

const OWN = "demo-note-skill-dunharlng";

beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "word-citations-"));
    write(
        dir,
        "Skills/Dunhari.md",
        [
            "---",
            "shortcode: dunharlng",
            "name: {full: Dunhari}",
            "type: skill",
            "subType: language",
            "data:",
            "  fields:",
            "    - {name: Court, holds: The court.}",
            "  words:",
            "    - {form: vazhmadêr, class: n, field: Court, gloss: a judge}",
            "    - {form: anlaghu, variants: [anlagh], class: n, field: Court, gloss: [life, a lifetime]}",
            "    - {form: gholvabûn, class: n, field: Court, gloss: a chamberlain}",
            "    - {form: belg-, class: stem, field: Court, gloss: to call rain}",
            "    - {form: Dunhari, class: name, field: Court, gloss: the tongue's own name}",
            "---",
            "",
            "Its own _vazhmadêr_ and _gholvabûn_ are its subject, not citations.",
            "",
        ].join("\n"),
    );
    write(dir, "Lore/ByForm.md", lore("byform", "The _vazhmadêr_ judges."));
    write(dir, "Lore/ByVariant.md", lore("byvariant", "Life, the _anlagh_ of a house."));
    write(dir, "Lore/ByCase.md", lore("bycase", "The *Vazhmader* of Amradad."));
    write(dir, "Lore/Unmarked.md", lore("unmarked", "The gholvabûn keeps the door, unmarked."));
    write(dir, "Lore/Unmatched.md", lore("unmatched", "A _qadi_ is no word of the tongue."));
    write(dir, "Lore/Secret.md", lore("secret", "The _gholvabûn_ in secret.", "[gm]"));
    write(
        dir,
        "Lore/Named.md",
        "---\nshortcode: named\nname: {full: Vazhmader}\ntype: lore\nsubType: history\n---\n\nA judge.\n",
    );
    write(
        dir,
        "Lore/Longer.md",
        "---\nshortcode: longer\nname: {full: The Vazhmadêr of Amradad, aliases: [Old Gholvabûn]}\ntype: lore\nsubType: history\n---\n\nA longer name.\n",
    );
    write(
        dir,
        "Affiliations/Court.md",
        [
            "---",
            "shortcode: court",
            "name: {full: The Court, aliases: [Gholvabun]}",
            "type: affiliation",
            "subType: polity",
            "data:",
            "  governance:",
            "    ranks:",
            "      - {level: 0, title: Anlagh, description: One who lives.}",
            "---",
            "",
            "A court.",
            "",
        ].join("\n"),
    );
    records = collectContentIndex(dir, { contentPackage: "demo", skipDirectories: [] });
    db = await openNotesDatabase(records, { dir: path.join(dir, "db"), audience: "public" });
}, 60_000);

afterAll(async () => {
    await db?.close();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("the index record of a language note", () => {
    it("carries each cited word's citing notes, and no text", () => {
        const record = records.find((one) => one.shortcode === "dunharlng");
        expect(record.citations).toEqual([
            {
                form: "vazhmadêr",
                notes: ["demo-note-lore-bycase", "demo-note-lore-byform", "demo-note-lore-named"],
            },
            {
                form: "anlaghu",
                notes: ["demo-note-affiliation-court", "demo-note-lore-byvariant"],
            },
            {
                form: "gholvabûn",
                notes: ["demo-note-affiliation-court", "demo-note-lore-secret"],
            },
        ]);
    });

    it("carries no citations where no note cites a word", () => {
        expect(records.find((one) => one.shortcode === "byform").citations).toBeUndefined();
    });
});

describe("the derived citations", () => {
    it("take a note whose full name or alias spells the word whole", async () => {
        const result = await runSqlQuery(db, "SELECT attested FROM words WHERE form = 'vazhmadêr'");
        expect(result.rows[0].attested).toContain("demo-note-lore-named");
        const alias = await runSqlQuery(db, "SELECT attested FROM words WHERE form = 'gholvabûn'");
        expect(alias.rows[0].attested).toContain("demo-note-affiliation-court");
    });

    it("take an affiliation whose rank title spells the word or a variant", async () => {
        const result = await runSqlQuery(db, "SELECT attested FROM words WHERE form = 'anlaghu'");
        expect(result.rows[0].attested).toContain("demo-note-affiliation-court");
    });

    it("never take a word found only inside a longer name", async () => {
        const result = await runSqlQuery(
            db,
            "SELECT form FROM words WHERE list_contains(attested, 'demo-note-lore-longer')",
        );
        expect(result.rows).toEqual([]);
    });

    it("never take a language note's own name for its own word", async () => {
        const result = await runSqlQuery(db, "SELECT attested FROM words WHERE form = 'Dunhari'");
        expect(result.rows[0].attested).toBeNull();
    });

    it("match a use by its form", async () => {
        const result = await runSqlQuery(db, "SELECT attested FROM words WHERE form = 'vazhmadêr'");
        expect(result.rows[0].attested).toContain("demo-note-lore-byform");
    });

    it("match a use by a declared variant", async () => {
        const result = await runSqlQuery(db, "SELECT attested FROM words WHERE form = 'anlaghu'");
        expect(result.rows[0].attested).toContain("demo-note-lore-byvariant");
    });

    it("match a use that differs in case and diacritics", async () => {
        const result = await runSqlQuery(db, "SELECT attested FROM words WHERE form = 'vazhmadêr'");
        expect(result.rows[0].attested).toContain("demo-note-lore-bycase");
    });

    it("never take an unmarked word, nor an italic word that spells no word", async () => {
        const result = await runSqlQuery(
            db,
            "SELECT form FROM words WHERE list_contains(attested, 'demo-note-lore-unmarked') " +
                "OR list_contains(attested, 'demo-note-lore-unmatched')",
        );
        expect(result.rows).toEqual([]);
    });

    it("leave out the language note's own body", async () => {
        const result = await runSqlQuery(
            db,
            `SELECT form FROM words WHERE list_contains(attested, '${OWN}')`,
        );
        expect(result.rows).toEqual([]);
    });

    it("leave out a citing note the audience does not see", async () => {
        const result = await runSqlQuery(db, "SELECT attested FROM words WHERE form = 'gholvabûn'");
        expect(result.rows[0].attested).toEqual(["demo-note-affiliation-court"]);
    });

    it("are a dictionary entry's usage", async () => {
        const result = await runSqlQuery(
            db,
            "SELECT name, usage FROM dictionary ORDER BY name_sort",
        );
        expect(result.rows).toEqual([
            { name: "anlaghu", usage: ["demo-note-affiliation-court", "demo-note-lore-byvariant"] },
            { name: "gholvabûn", usage: ["demo-note-affiliation-court"] },
            {
                name: "vazhmadêr",
                usage: ["demo-note-lore-bycase", "demo-note-lore-byform", "demo-note-lore-named"],
            },
        ]);
    });
});

describe("a gloss of several senses", () => {
    it("is one line of text in `words`, and each sense in `senses`", async () => {
        const result = await runSqlQuery(
            db,
            "SELECT gloss, senses FROM words WHERE form = 'anlaghu'",
        );
        expect(result.rows).toEqual([
            { gloss: "life; a lifetime", senses: ["life", "a lifetime"] },
        ]);
    });

    it("is one dictionary sense per entry", async () => {
        const result = await runSqlQuery(
            db,
            "SELECT senses FROM dictionary WHERE name = 'anlaghu'",
        );
        expect(result.rows[0].senses).toEqual([
            { text: "life", bodies: [] },
            { text: "a lifetime", bodies: [] },
        ]);
    });
});
