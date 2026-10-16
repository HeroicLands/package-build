/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectContentIndex } from "../engine/content-index.mjs";
import { openNotesDatabase, prepareTreeSqlTables } from "../engine/sql-tables.mjs";

const NOTES = [
    `---
type: place
subType: settlement
shortcode: town
name: { full: Town }
data:
    events:
        - id: raising
          when: 120
          summary: The town is raised.
          where: { locus: [town] }
---

See [[lore-chronicle|the chronicle]].
`,
    `---
type: lore
subType: history
shortcode: chronicle
name: { full: Chronicle }
data:
    subjects: [place-town]
---

See [[place-town|the town]].

\`\`\`sql
SELECT n.name.full AS Local, d.name.full AS Imported
FROM notes n JOIN other.notes d USING (shortcode)
WHERE n.shortcode = 'town'
\`\`\`

\`\`\`sql
SELECT e.summary AS Local, d.summary AS Imported
FROM events e JOIN other.events d USING (address)
WHERE e.note = 'demo-note-place-town'
\`\`\`

There are {{sql "SELECT count(*) FROM entries WHERE shortcode = 'chronicle'"}} chronicles.
`,
];

type Operator = {
    operator_name?: string;
    operator_cardinality?: number;
    extra_info?: Record<string, unknown>;
    children?: Operator[];
};

/** Actual rows emitted by file readers, before downstream filters and joins. */
function sourceRows(plan: Operator): number {
    const fileReader =
        /READ_JSON/i.test(String(plan.operator_name)) ||
        Object.hasOwn(plan.extra_info ?? {}, "Total Files Read");
    if (fileReader) expect(plan.operator_cardinality).toBeTypeOf("number");
    return (
        (fileReader ? plan.operator_cardinality! : 0) +
        (plan.children ?? []).reduce((sum, child) => sum + sourceRows(child), 0)
    );
}

async function profile(db: Awaited<ReturnType<typeof openNotesDatabase>>, sql: string) {
    const result = await db.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`);
    const analyzed = result.rows.find((row: any) => row.explain_key === "analyzed_plan");
    expect(analyzed).toBeDefined();
    const plan = JSON.parse(analyzed.explain_value);
    expect(plan.children.length).toBeGreaterThan(0);
    return sourceRows(plan);
}

async function measure(copies: number) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sql-scaling-"));
    const tree = path.join(dir, "content");
    fs.mkdirSync(tree);
    try {
        for (let copy = 0; copy < copies; copy += 1) {
            for (const [index, seed] of NOTES.entries()) {
                // Shortcodes, frontmatter references, wikilinks and query literals
                // share the same rewrite, so each copy is a separate linked pair.
                const text = seed.replace(/\b(town|chronicle)\b/g, (key) => `${key}${copy}`);
                fs.writeFileSync(path.join(tree, `${copy}-${index}.md`), text);
            }
        }
        const records = collectContentIndex(tree, { contentPackage: "demo", skipDirectories: [] });
        expect(records).toHaveLength(copies * NOTES.length);
        expect(new Set(records.map((record: any) => record.shortcode)).size).toBe(records.length);
        const dependency = path.join(dir, "dependency.jsonl");
        fs.writeFileSync(dependency, records.map((record) => JSON.stringify(record)).join("\n"));
        const db = await openNotesDatabase(records, {
            dir: path.join(dir, "database"),
            dependencies: [{ id: "other", file: dependency }],
        });
        const queries: Array<{ sql: string; sourceRows: number }> = [];
        try {
            // A positive control makes a renamed or missing profiler field fail.
            // operator_rows_scanned is an estimate for JSON; cardinality is the
            // actual reader output, before the SELECT's predicate is applied.
            const literal = dependency.replace(/'/g, "''");
            expect(await profile(db, `SELECT * FROM read_json_auto('${literal}')`)).toBe(
                records.length,
            );
            const observed = {
                ...db,
                async query(sql: string) {
                    // DESCRIBE reports schema and has no execution profile.
                    if (/^DESCRIBE\b/i.test(sql)) return db.query(sql);
                    queries.push({ sql, sourceRows: await profile(db, sql) });
                    return db.query(sql);
                },
            };
            const prepared = await prepareTreeSqlTables(tree, {
                records,
                skipDirectories: [],
                database: observed,
                foreignIndex: new Map(),
            });
            expect(prepared?.size).toBeGreaterThanOrEqual(copies);
            for (const tables of prepared!.values()) {
                for (const table of tables) {
                    expect(table.reason).toBeUndefined();
                    expect(table.rows).toBeGreaterThan(0);
                }
            }
            expect(prepared!.inline.size).toBe(copies);
            for (const values of prepared!.inline.values()) {
                for (const value of values.values()) expect(value).toEqual({ value: 1n });
            }
            expect(queries.filter(({ sql }) => sql.includes("other.notes"))).toHaveLength(copies);
            expect(queries.filter(({ sql }) => sql.includes("other.events"))).toHaveLength(copies);
            return {
                notes: records.length,
                queries: queries.length,
                sourceRowsPerQuery:
                    queries.reduce((sum, query) => sum + query.sourceRows, 0) / queries.length,
                readers: queries.filter((query) => query.sourceRows > 0),
            };
        } finally {
            await db.close();
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe("SQL stage source-file work", () => {
    it("does not grow per query when a linked corpus grows", async () => {
        const small = await measure(4);
        const large = await measure(16);
        expect(large.notes).toBe(small.notes * 4);
        expect(large.queries).toBeGreaterThan(small.queries);
        expect(
            large.sourceRowsPerQuery,
            JSON.stringify([small, large].map(({ readers, ...counts }) => counts)),
        ).toBeLessThanOrEqual(small.sourceRowsPerQuery);
        expect(small.readers).toEqual([]);
        expect(large.readers).toEqual([]);
    });
});
