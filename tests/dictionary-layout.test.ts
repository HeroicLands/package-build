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
        "A culture's common words",
        PROVENZIA_PAGE,
        "glossary",
        "SELECT * FROM terms WHERE owner = 'demo-note-lore-provnzclt' AND common",
    ],
    [
        "A culture's glossary",
        PROVENZIA_PAGE,
        "glossary",
        "SELECT * REPLACE ((owner = 'demo-note-lore-provnzclt' AND common) AS common) " +
            "FROM terms WHERE owner = 'demo-note-lore-provnzclt' OR " +
            "(list_contains(cultures, 'demo-note-lore-provnzclt') AND " +
            "(list_contains(origins, 'rank') OR list_contains(origins, 'office')))",
    ],
    [
        "An affiliation's glossary",
        WATCH_PAGE,
        "glossary",
        "SELECT * FROM terms WHERE owner = 'demo-note-affiliation-watch'",
    ],
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
        await expect(parts.join("\n")).toMatchFileSnapshot(EXPECTED);
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

    it("print only the key where the fence sets key=only", async () => {
        for (const [title, page, layout, query] of SECTIONS) {
            const [keyed] = await render(fence(query, `layout=${layout}`), page);
            const [only] = await render(fence(query, `layout=${layout} key=only`), page);
            const [first] = keyed.markdown.split("\n\n");
            expect(only.reason, title).toBeUndefined();
            expect(only.markdown, title).toBe(first.startsWith("**Key:**") ? first : "");
        }
        const [head] = await render(
            fence(SECTIONS[1][3], "layout=dictionary key=only"),
            SECTIONS[1][1] as object,
        );
        expect(head.markdown).toMatch(/^\*\*Key:\*\* .*\.$/);
        expect(head.markdown).not.toContain("\n");
    });

    it("refuse a key that is not true, false or only", () => {
        const [block] = findSqlBlocks(fence("SELECT 1", "layout=dictionary key=no"));
        expect(block.problems).toEqual(["key needs the literal value true, false or only"]);
        expect(findSqlBlocks(fence("SELECT 1", "layout=dictionary"))[0].showKey).toBe(true);
        expect(findSqlBlocks(fence("SELECT 1", "layout=glossary key=only"))[0].showKey).toBe(
            "only",
        );
    });

    it("refuse any key on a fence set as a table", () => {
        for (const value of ["true", "false", "only"]) {
            const [block] = findSqlBlocks(fence("SELECT 1", `key=${value}`));
            expect(block.problems, value).toEqual([
                "key sets a dictionary's or a glossary's key, and this fence's layout is `table`",
            ]);
        }
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
