/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    RENDER_ALIASES,
    findSqlBlocks,
    openNotesDatabase,
    prepareInlineSqlExpressions,
    prepareSqlTables,
    renderSqlTable,
    runSqlQuery,
} from "../engine/sql-tables.mjs";
import { expandContentTables } from "../engine/content-tables.mjs";
import { renderMarkdownExpressions } from "../engine/markdown-expressions.mjs";

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
    it("answers scalar SQL in Markdown through the content index", async () => {
        const body = 'There are {{sql "SELECT COUNT(*) FROM notes"}} notes.';
        const prepared = await prepareInlineSqlExpressions(db, [
            { source: "N.md", markdown: body, frontmatter: {} },
        ]);
        expect(renderMarkdownExpressions(body, { sqlResults: prepared.get("N.md") })).toEqual({
            markdown: "There are 3 notes.",
            findings: [],
        });
    });

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
        const [block] = findSqlBlocks("```sql {allow-empty=true section-level=3}\nSELECT 1\n```\n");

        expect(block.allowEmpty).toBe(true);
        expect(block.sectionLevel).toBe(3);
    });

    it("requires literal Boolean values", () => {
        const [block] = findSqlBlocks("```sql {allow-empty=yes}\nSELECT 1\n```\n");
        expect(block.problems).toContain("allow-empty needs the literal value true or false");
    });

    it("defaults to a level-2 section heading and a required table", () => {
        const [block] = findSqlBlocks("```sql\nSELECT 1\n```\n");

        expect(block.allowEmpty).toBe(false);
        expect(block.sectionLevel).toBe(2);
    });
});

describe("querying the index", () => {
    it("excludes GM notes from public local and dependency SQL relations", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sql-gm-"));
        const dependency = path.join(dir, "dependency.jsonl");
        const local = [
            { type: "lore", shortcode: "open", tags: [], address: { slug: "lore-open" } },
            { type: "lore", shortcode: "near", tags: ["gma"], address: { slug: "lore-near" } },
            ...[["gm"], ["GM"], ["#gm"], [" gm "], "gm", " #GM "].map((tags, i) => ({
                type: "lore",
                shortcode: `secret${i}`,
                tags,
                address: { slug: `lore-secret${i}` },
            })),
        ];
        fs.writeFileSync(dependency, local.map((record) => JSON.stringify(record)).join("\n"));
        const publicDb = await openNotesDatabase(local, {
            dependencies: [{ id: "other", file: dependency }],
            audience: "public",
        });
        try {
            for (const relation of ["notes", "entries", "other.notes", "other.entries"])
                expect(
                    (
                        await runSqlQuery(
                            publicDb,
                            `SELECT shortcode FROM ${relation} ORDER BY shortcode`,
                        )
                    ).rows,
                ).toEqual([{ shortcode: "near" }, { shortcode: "open" }]);
        } finally {
            await publicDb.close();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("retains hidden-only fields in public local and dependency schemas", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sql-gm-schema-"));
        const dependency = path.join(dir, "dependency.jsonl");
        const records = [
            {
                package: "demo",
                type: "lore",
                subType: "culture",
                shortcode: "open",
                name: { full: "Open" },
                address: "demo-note-lore-open",
                data: { glossary: [{ name: "a title", definition: "A public title." }] },
            },
            {
                package: "demo",
                type: "lore",
                subType: "history",
                shortcode: "secret",
                name: { full: "Secret" },
                address: "demo-note-lore-secret",
                tags: [" #GM "],
                data: { events: [{ id: "hidden", when: 1, summary: "A hidden event." }] },
            },
        ];
        fs.writeFileSync(dependency, records.map((record) => JSON.stringify(record)).join("\n"));
        const db = await openNotesDatabase(records, {
            dependencies: [{ id: "other", file: dependency }],
            audience: "public",
        });
        try {
            for (const relation of ["entries", "notes", "other.entries", "other.notes"]) {
                expect(
                    (await runSqlQuery(db, `SELECT shortcode, data.events FROM ${relation}`)).rows,
                ).toEqual([{ shortcode: "open", events: null }]);
                expect(
                    (
                        await runSqlQuery(
                            db,
                            `SELECT shortcode FROM ${relation} WHERE data.events IS NOT NULL`,
                        )
                    ).rows,
                ).toEqual([]);
                expect(
                    (await runSqlQuery(db, `SELECT * FROM ${relation}`)).columns.toSorted(),
                ).toEqual([
                    "address",
                    "data",
                    "name",
                    "package",
                    "shortcode",
                    "state",
                    "subType",
                    "tags",
                    "type",
                ]);
            }
        } finally {
            await db.close();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("retains queryable columns when every local and dependency note is GM-only", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sql-gm-only-"));
        const dependency = path.join(dir, "dependency.jsonl");
        const records = [
            { type: "lore", shortcode: "secret", tags: ["GM"], name: { full: "Secret" } },
        ];
        fs.writeFileSync(dependency, records.map((record) => JSON.stringify(record)).join("\n"));
        const db = await openNotesDatabase(records, {
            dependencies: [{ id: "other", file: dependency }],
            audience: "public",
        });
        try {
            for (const relation of ["entries", "notes", "other.entries", "other.notes"])
                expect(
                    (await runSqlQuery(db, `SELECT shortcode, name.full FROM ${relation}`)).rows,
                ).toEqual([]);
        } finally {
            await db.close();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

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
        expect(result.rows[0][RENDER_ALIASES.ref]).toEqual({
            package: "sohl",
            system: "note",
            type: "skill",
            shortcode: "clmb",
        });
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

        expect(md).toContain("[[sohl-note-skill-clmb\\|Climbing]]");
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
        // The near-identical blocks `Rules/Gear.md` would otherwise need are one
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

    it("keys each result by its note, then by the directive's ordinal", async () => {
        const prepared = await prepareSqlTables(db, [{ source: "N.md", markdown: body }]);

        expect(prepared.get("N.md")?.[0]?.rows).toBe(1);
    });

    it("asks a query written in several notes once, and gives each note its own result", async () => {
        const asked: string[] = [];
        const counting = {
            ...db,
            query: (sql: string) => {
                asked.push(sql);
                return db.query(sql);
            },
        };
        const sources = ["A.md", "B.md", "C.md"].map((source) => ({ source, markdown: body }));
        const prepared = await prepareSqlTables(counting, sources);
        const solo = await prepareSqlTables(db, [{ source: "A.md", markdown: body }]);

        expect(asked).toHaveLength(1);
        for (const { source } of sources)
            expect(prepared.get(source)?.[0]?.markdown).toBe(solo.get("A.md")?.[0]?.markdown);
    });

    it("records a failing query rather than throwing it", async () => {
        const prepared = await prepareSqlTables(db, [
            { source: "N.md", markdown: "```sql\nSELECT nope FROM notes\n```\n" },
        ]);

        expect(prepared.get("N.md")?.[0]?.reason).toMatch(/nope/i);
    });

    it("refuses a key on a fence set as a table, at the fence line", async () => {
        for (const value of ["true", "false", "only"]) {
            const text = `Intro.\n\n\`\`\`sql {key=${value}}\nSELECT name.full AS "Name" FROM notes\n\`\`\`\n`;
            const prepared = await prepareSqlTables(db, [{ source: "N.md", markdown: text }]);
            const { errors } = expandContentTables(text, {
                source: "N.md",
                sqlTables: prepared.get("N.md"),
            });
            expect(errors, value).toHaveLength(1);
            expect(errors[0]).toMatchObject({
                source: "N.md",
                line: 2,
                column: 1,
                reason: "key sets a dictionary's or a glossary's key, and this fence's layout is `table`",
            });
        }
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
        expect(await errs(dead.replace("```sql", "```sql {allow-empty=true}"))).toEqual([]);
    });

    it("renders the header and rule for a result selecting nothing", async () => {
        // The finding is the point, not withholding the output. A heading with
        // an empty table under it says the query ran and matched nothing; a
        // heading with nothing under it reads as a page that failed to build.
        const dead =
            "```sql {allow-empty=true}\nSELECT name.full AS \"Name\" FROM notes WHERE type = 'creature'\n```\n";
        const prepared = await prepareSqlTables(db, [{ source: "N.md", markdown: dead }]);
        const { markdown, errors } = expandContentTables(dead, {
            source: "N.md",
            sqlTables: prepared.get("N.md"),
        });

        expect(errors).toEqual([]);
        expect(markdown).toContain("| Name |");
        expect(markdown).toContain("| --- |");
    });

    it("renders a header per selected column when nothing is selected", () => {
        expect(renderSqlTable({ columns: ["Name", "Cost"], rows: [] })).toBe(
            "| Name | Cost |\n| --- | --- |",
        );
    });

    it("finds each of a note's directives by its ordinal, not its line", async () => {
        // The passes disagree about a body: `walkMarkdownTree` trims it, while
        // the link checker strips the frontmatter fence and keeps the newlines
        // after it. Keyed by line, the same directive would be looked up at two
        // different positions and silently miss.
        const two =
            "```sql\nSELECT name.full AS \"Name\" FROM notes WHERE type = 'skill'\n```\n\n" +
            "```sql\nSELECT name.full AS \"Name\" FROM notes WHERE type = 'miscgear'\n```\n";
        const prepared = await prepareSqlTables(db, [{ source: "N.md", markdown: two }]);

        expect(prepared.get("N.md")).toHaveLength(2);
        expect(prepared.get("N.md")?.[0]?.rows).toBe(1);
        expect(prepared.get("N.md")?.[1]?.rows).toBe(2);

        // The same note, shifted down: prepared from the trimmed body, expanded
        // from an untrimmed one, and still correct.
        const { markdown, errors } = expandContentTables(`\n\n${two}`, {
            source: "N.md",
            sqlTables: prepared.get("N.md"),
        });
        expect(errors).toEqual([]);
        expect(markdown).toContain("Climbing");
        expect(markdown).toContain("Bowl, ceramic");
    });

    it("reports a directive this pass was given no results for", () => {
        const { errors, markdown } = expandContentTables(body, { source: "N.md" });

        expect(errors[0].reason).toMatch(/was not prepared/);
        // Left verbatim, so the failure is visible in the output too.
        expect(markdown).toContain("```sql");
    });
});

describe("unsupported table language", () => {
    it("reports a located error", () => {
        const body = "```dataview\nTABLE name.full\n```\n";
        const { errors, warnings } = expandContentTables(body, { source: "N.md" });
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ source: "N.md", line: 0, column: 1 });
        expect(warnings).toEqual([]);
    });
});
