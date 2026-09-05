/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import {
    RENDER_ALIASES,
    findSqlBlocks,
    openNotesDatabase,
    prepareSqlTables,
    renderSqlTable,
    runSqlQuery,
} from "../engine/sql-tables.mjs";
import { expandContentTables } from "../engine/content-tables.mjs";

/** A miniature content index: two note types, one with a nested system block. */
const RECORDS = [
    {
        type: "miscgear",
        shortcode: "bowlcer",
        package: "sohl",
        name: { full: "Bowl, ceramic" },
        description: "A ceramic bowl.",
        address: { canonical: "sohl-miscgear-bowlcer", slug: "miscgear-bowlcer" },
        file: {
            path: "Misc_Gear/Cooking/Bowl_ceramic.md",
            folder: "Misc_Gear/Cooking",
            name: "Bowl_ceramic",
        },
        tags: ["cooking"],
        sohl: { kbcat: "cooking", weight: 3, value: 6 },
    },
    {
        type: "miscgear",
        shortcode: "pence",
        package: "sohl",
        name: { full: "Pence" },
        description: "A silver coin.",
        address: { canonical: "sohl-miscgear-pence", slug: "miscgear-pence" },
        file: { path: "Misc_Gear/Cash/Pence.md", folder: "Misc_Gear/Cash", name: "Pence" },
        tags: ["cash"],
        sohl: { kbcat: "cash", weight: 0.0033, value: 1 },
    },
    {
        type: "skill",
        shortcode: "clmb",
        package: "sohl",
        name: { full: "Climbing" },
        description: "Going up.",
        address: { canonical: "sohl-skill-clmb", slug: "skill-clmb" },
        file: { path: "Skills/Climbing.md", folder: "Skills", name: "Climbing" },
        tags: [],
        sohl: { skillBase: "str" },
    },
];

let db: any;
beforeAll(async () => {
    db = await openNotesDatabase(RECORDS);
}, 60_000);
afterAll(async () => {
    await db?.close();
});

describe("finding `sql` directives", () => {
    it("finds a sql fence and leaves every other fence alone", () => {
        const blocks = findSqlBlocks(
            "```sql\nSELECT 1\n```\n\n```js\nconst sql = 1;\n```\n\n```dataview\nTABLE\n```\n",
        );

        expect(blocks).toHaveLength(1);
        expect(blocks[0].query).toBe("SELECT 1");
        expect(blocks[0].line).toBe(0);
    });

    it("does not read a `sql` line inside another fence as a directive", () => {
        // The body of a non-matching fence is skipped wholesale.
        expect(findSqlBlocks("````md\n```sql\nSELECT 1\n```\n````\n")).toHaveLength(0);
    });

    it("reads `allow-empty` and `section-level` off the fence, not the query", () => {
        const [block] = findSqlBlocks("```sql allow-empty section-level=3\nSELECT 1\n```\n");

        expect(block.allowEmpty).toBe(true);
        expect(block.sectionLevel).toBe(3);
    });

    it("defaults to a level-2 section heading and a required table", () => {
        const [block] = findSqlBlocks("```sql\nSELECT 1\n```\n");

        expect(block.allowEmpty).toBe(false);
        expect(block.sectionLevel).toBe(2);
    });
});

describe("querying the index", () => {
    it("reads a nested field exactly as a note authors it", async () => {
        // This is why DuckDB rather than SQLite: `sohl.weight` is struct access,
        // where a column-per-path table would force `"sohl.weight"` in quotes
        // and a JSON column would force `sohl->>'weight'`.
        const result = await runSqlQuery(
            db,
            `SELECT name.full AS "Name", sohl.weight AS "Weight" FROM notes
             WHERE type = 'miscgear' AND sohl.kbcat = 'cooking'`,
        );

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].Name).toBe("Bowl, ceramic");
        expect(Number(result.rows[0].Weight)).toBe(3);
    });

    it("unions the fields of every note type, so a missing block reads NULL", async () => {
        const result = await runSqlQuery(
            db,
            `SELECT name.full AS "Name", sohl.kbcat AS "Cat" FROM notes
             WHERE type = 'skill'`,
        );

        expect(result.rows[0].Cat).toBeNull();
    });

    it("hides underscore-prefixed aliases from the rendered columns", async () => {
        const result = await runSqlQuery(
            db,
            `SELECT address.slug AS _ref, name.full AS "Name" FROM notes WHERE type = 'skill'`,
        );

        expect(result.columns).toEqual(["Name"]);
        expect(result.rows[0][RENDER_ALIASES.ref]).toBe("skill-clmb");
    });
});

describe("rendering a result", () => {
    const render = async (sql: string, opts = {}) =>
        renderSqlTable(await runSqlQuery(db, sql), opts);

    it("links the first column to the row's own note", async () => {
        const md = await render(
            `SELECT address.slug AS _ref, name.full AS "Name" FROM notes
             WHERE type = 'skill'`,
        );

        expect(md).toContain("[[skill-clmb\\|Climbing]]");
    });

    it("leaves the first column plain when nothing is linkable", async () => {
        const md = await render(
            `SELECT address.slug AS _ref, name.full AS "Name" FROM notes WHERE type = 'skill'`,
            { linkable: () => false },
        );

        expect(md).toContain("| Climbing |");
        expect(md).not.toContain("[[");
    });

    it("splits into a headed table per `_section`, in the query's own order", async () => {
        // The forty near-identical blocks `Rules/Gear.md` used to need are one
        // query: the authored ORDER BY decides the section order too.
        const md = await render(
            `SELECT sohl.kbcat AS _section, name.full AS "Name" FROM notes
             WHERE type = 'miscgear' ORDER BY sohl.kbcat, name.full`,
        );

        expect(md.indexOf("## cash")).toBeLessThan(md.indexOf("## cooking"));
        expect(md).toContain("| Pence |");
        expect(md).toContain("| Bowl, ceramic |");
    });

    it("honours the fence's section level", async () => {
        const md = renderSqlTable(
            await runSqlQuery(
                db,
                `SELECT sohl.kbcat AS _section, name.full AS "Name" FROM notes
                 WHERE type = 'miscgear' ORDER BY sohl.kbcat`,
            ),
            { sectionLevel: 4 },
        );

        expect(md).toContain("#### cash");
    });

    it("right-aligns a column whose every cell is a number", async () => {
        const md = await render(
            `SELECT name.full AS "Name", sohl.value AS "Value" FROM notes
             WHERE type = 'miscgear' ORDER BY name.full`,
        );

        expect(md.split("\n")[1]).toBe("| --- | ---: |");
    });

    it("renders an absent value as an em dash rather than `null`", async () => {
        const md = await render(
            `SELECT name.full AS "Name", sohl.kbcat AS "Cat" FROM notes WHERE type = 'skill'`,
        );

        expect(md).toContain("| Climbing | — |");
    });

    it("joins a list, and refuses a column that resolves to an object", async () => {
        const list = await render(
            `SELECT name.full AS "Name", tags AS "Tags" FROM notes WHERE type = 'miscgear'
             ORDER BY name.full`,
        );
        expect(list).toContain("cooking");

        await expect(
            render(`SELECT name.full AS "Name", sohl AS "Block" FROM notes WHERE type = 'skill'`),
        ).rejects.toThrow(/resolves to an object/);
    });

    it("renders a decimal as a number, not as its DuckDB wrapper", async () => {
        // `ROUND()` yields DECIMAL, which arrives as `{width, scale, value}` —
        // `1.5` as `value: 15n, scale: 1`. Unconverted it reaches a cell as an
        // object and the whole table fails.
        const md = await render(
            `SELECT name.full AS "Name", ROUND(sohl.weight, 2) AS "Weight" FROM notes
             WHERE type = 'miscgear' ORDER BY name.full`,
        );

        expect(md).toContain("| 3 |");
        expect(md).not.toContain("[object Object]");
    });

    it("is byte-identical between runs", async () => {
        const sql = `SELECT sohl.kbcat AS _section, name.full AS "Name" FROM notes
                     WHERE type = 'miscgear' ORDER BY sohl.kbcat, name.full`;

        expect(await render(sql)).toBe(await render(sql));
    });
});

describe("preparing directives ahead of expansion", () => {
    const body = "```sql\nSELECT name.full AS \"Name\" FROM notes WHERE type = 'skill'\n```\n";

    it("keys each result by its note, then by line", async () => {
        const prepared = await prepareSqlTables(db, [{ source: "N.md", markdown: body }]);

        expect(prepared.get("N.md")?.get(0)?.rows).toBe(1);
    });

    it("records a failing query rather than throwing it", async () => {
        const prepared = await prepareSqlTables(db, [
            { source: "N.md", markdown: "```sql\nSELECT nope FROM notes\n```\n" },
        ]);

        expect(prepared.get("N.md")?.get(0)?.reason).toMatch(/nope/i);
    });

    it("splices the rendered table in at the directive's position", async () => {
        const prepared = await prepareSqlTables(db, [{ source: "N.md", markdown: body }]);
        const { markdown, errors } = expandContentTables(body, {
            source: "N.md",
            sqlTables: prepared.get("N.md"),
        });

        expect(errors).toEqual([]);
        expect(markdown).toContain("| Climbing |");
        expect(markdown).not.toContain("```sql");
    });

    it("reports a query selecting nothing, and accepts `allow-empty`", async () => {
        const dead =
            "```sql\nSELECT name.full AS \"Name\" FROM notes WHERE type = 'creature'\n```\n";
        const errs = async (text: string) => {
            const prepared = await prepareSqlTables(db, [{ source: "N.md", markdown: text }]);
            return expandContentTables(text, {
                source: "N.md",
                sqlTables: prepared.get("N.md"),
            }).errors;
        };

        expect(await errs(dead)).toHaveLength(1);
        expect((await errs(dead))[0].reason).toMatch(/selects no notes/);
        expect(await errs(dead.replace("```sql", "```sql allow-empty"))).toEqual([]);
    });

    it("reports a directive this pass was given no results for", () => {
        const { errors, markdown } = expandContentTables(body, { source: "N.md" });

        expect(errors[0].reason).toMatch(/was not prepared/);
        // Left verbatim, so the failure is visible in the output too.
        expect(markdown).toContain("```sql");
    });
});

describe("the retiring language", () => {
    it("still expands, and is reported as a warning rather than an error", () => {
        const body =
            '```dataview\nTABLE WITHOUT ID name.full AS "Name"\nWHERE type = "skill"\n```\n';
        const { errors, warnings } = expandContentTables(body, {
            source: "N.md",
            docs: [{ fm: { type: "skill", shortcode: "clmb", name: { full: "Climbing" } } }],
        });

        expect(errors).toEqual([]);
        expect(warnings).toHaveLength(1);
        expect(warnings[0].reason).toMatch(/#246/);
    });
});
