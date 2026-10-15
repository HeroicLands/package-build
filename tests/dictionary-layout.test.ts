/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **`layout=dictionary` sets words and `layout=glossary` sets terms**: a key of
 * the abbreviations used, letter headings, and one paragraph per entry. The
 * Markdown for each kind of section the fixture holds is checked in as
 * `fixtures/dictionary/expected.md`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { renderAddress } from "../engine/address.mjs";
import { collectContentIndex } from "../engine/content-index.mjs";
import { findSqlBlocks, openNotesDatabase, prepareSqlTables } from "../engine/sql-tables.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TREE = path.join(HERE, "fixtures", "dictionary", "tree");
const EXPECTED = path.join(HERE, "fixtures", "dictionary", "expected.md");

const LANGUAGE_PAGE = (shortcode: string) => ({ type: "skill", subType: "language", shortcode });
const PROVENZIA_PAGE = {
    type: "lore",
    subType: "culture",
    shortcode: "provnzclt",
    data: { language: "skill-provnzlng" },
};
const WATCH_PAGE = { type: "affiliation", shortcode: "watch", data: { culture: "lore-nordclt" } };
const SETTING_PAGE = { type: "doc", shortcode: "tongues" };

/** The sections the expected file holds: a title, the page's frontmatter, and one fence. */
const SECTIONS: Array<[string, object, string, string]> = [
    [
        "A language's dictionary, inherited words included",
        LANGUAGE_PAGE("byzarlng"),
        "dictionary",
        "SELECT * FROM dictionary WHERE language = 'demo-note-skill-byzarlng'",
    ],
    [
        "A language's dictionary, with borrowed and built words",
        LANGUAGE_PAGE("provnzlng"),
        "dictionary",
        "SELECT * FROM dictionary WHERE language = 'demo-note-skill-provnzlng'",
    ],
    [
        "A language's common words on its culture's page",
        PROVENZIA_PAGE,
        "dictionary",
        "SELECT * FROM dictionary WHERE language = 'demo-note-skill-provnzlng' AND common",
    ],
    [
        "Dictionary of the Tongues",
        SETTING_PAGE,
        "dictionary",
        "SELECT * EXCLUDE (common) FROM dictionary WHERE depth = 0",
    ],
    [
        "A culture's glossary",
        PROVENZIA_PAGE,
        "glossary",
        "SELECT * FROM terms WHERE list_contains(cultures, 'demo-note-lore-provnzclt')",
    ],
    [
        "An affiliation's glossary",
        WATCH_PAGE,
        "glossary",
        "SELECT * FROM terms WHERE owner = 'demo-note-affiliation-watch'",
    ],
    ["Glossary", SETTING_PAGE, "glossary", "SELECT * EXCLUDE (common) FROM terms"],
];

const fence = (query: string, attributes: string) =>
    ["```sql {" + attributes + "}", query, "```"].join("\n");

let dir: string;
let db: any;

beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dictionary-layout-"));
    const records = collectContentIndex(TREE, { contentPackage: "demo", skipDirectories: [] });
    db = await openNotesDatabase(records, { dir: path.join(dir, "db"), audience: "public" });
}, 60_000);

afterAll(async () => {
    await db?.close();
    fs.rmSync(dir, { recursive: true, force: true });
});

/** Run one body's fences on a page, as a build does. */
async function render(markdown: string, frontmatter: object = SETTING_PAGE) {
    const prepared = await prepareSqlTables(db, [{ source: "note.md", markdown, frontmatter }], {
        // A being's page is not published here, so its citation prints as text.
        linkable: (ref: any) => renderAddress(ref) !== "demo-note-being-aran",
    });
    return prepared.get("note.md")!;
}

describe("layout=dictionary and layout=glossary", () => {
    it("render each kind of section as the expected Markdown", async () => {
        const parts: string[] = [];
        for (const [title, page, layout, query] of SECTIONS) {
            const [result] = await render(fence(query, `layout=${layout} section-level=3`), page);
            expect(result.reason, title).toBeUndefined();
            parts.push(`## ${title}`, "", result.markdown, "");
        }
        expect(parts.join("\n")).toBe(fs.readFileSync(EXPECTED, "utf8"));
    });

    it("leave out the key where the fence sets key=false, and print it otherwise", async () => {
        for (const [title, page, layout, query] of SECTIONS) {
            const [keyed] = await render(fence(query, `layout=${layout}`), page);
            const [bare] = await render(fence(query, `layout=${layout} key=false`), page);
            const [explicit] = await render(fence(query, `layout=${layout} key=true`), page);
            expect(explicit.markdown, title).toBe(keyed.markdown);
            expect(bare.markdown, title).not.toContain("**Key:**");
            const [first, ...rest] = keyed.markdown.split("\n\n");
            expect(bare.markdown, title).toBe(
                first.startsWith("**Key:**") ? rest.join("\n\n") : keyed.markdown,
            );
        }
        const [withKey] = await render(
            fence(SECTIONS[1][3], "layout=dictionary"),
            SECTIONS[1][1] as object,
        );
        expect(withKey.markdown).toContain("**Key:**");
    });

    it("refuse a key that is neither true nor false", () => {
        const [block] = findSqlBlocks(fence("SELECT 1", "layout=dictionary key=no"));
        expect(block.problems).toEqual(["key needs the literal value true or false"]);
        expect(findSqlBlocks(fence("SELECT 1", "layout=dictionary"))[0].showKey).toBe(true);
    });

    it("refuse a result missing a required column, and name it", async () => {
        const [dictionary] = await render(
            fence("SELECT name, senses FROM dictionary", "layout=dictionary"),
        );
        expect(dictionary.reason).toMatch(/layout=dictionary needs the column "usage"/);
        const [glossary] = await render(fence("SELECT name, usage FROM terms", "layout=glossary"));
        expect(glossary.reason).toMatch(/layout=glossary needs the column "senses"/);
    });

    it("are not the default, and a layout nobody declares is refused", () => {
        const [plain, unknown] = findSqlBlocks(
            [fence("SELECT 1", "layout=table"), "", fence("SELECT 1", "layout=grid")].join("\n"),
        );
        expect(plain.layout).toBe("table");
        expect(plain.problems).toEqual([]);
        expect(unknown.problems).toEqual([
            "layout is `table`, `dictionary` or `glossary`, not `grid`",
        ]);
        expect(findSqlBlocks(fence("SELECT 1", "allow-empty=true"))[0].layout).toBe("table");
    });
});
