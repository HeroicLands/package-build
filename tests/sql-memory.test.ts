/* SPDX-License-Identifier: GPL-3.0-or-later */

import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { openNotesDatabase } from "../engine/sql-tables.mjs";

afterEach(() => vi.restoreAllMocks());

function corpus() {
    return Array.from({ length: 80 }, (_, i) => ({
        package: "demo",
        type: "doc",
        shortcode: `note${i}`,
        address: { canonical: `demo-note-doc-note${i}`, slug: `doc-note${i}` },
        name: { full: `Note ${i}` },
        tags: i % 3 === 0 ? ["gm"] : [],
        foundry: {
            note: {
                anchors: Object.fromEntries(
                    Array.from({ length: 80 }, (_, j) => [`anchor${i}_${j}`, `page${i}_${j}`]),
                ),
            },
        },
        data: {
            foundry: "Nested authored fields stay queryable",
            mappings: { a: "lower", A: ["upper"] },
            governance: {
                offices: Object.fromEntries(
                    Array.from({ length: 4 }, (_, j) => [
                        `Office ${i}_${j}`,
                        { description: `Duty ${i}_${j}` },
                    ]),
                ),
            },
        },
    }));
}

// Force the RED run to use the same real DuckDB budget even before the
// production override exists. The separate setting test checks that API.
function fixedBudget() {
    const create = DuckDBInstance.create.bind(DuckDBInstance);
    vi.spyOn(DuckDBInstance, "create").mockImplementation((file, options) =>
        create(file, { ...options, memory_limit: "256 MB" }),
    );
}

describe("SQL memory projection", () => {
    it("cannot obtain public dictionary rows by filtering the complete relation", async () => {
        const language = (shortcode: string, tags: string[], data: object) => ({
            package: "demo",
            type: "skill",
            subType: "language",
            shortcode,
            address: `demo-note-skill-${shortcode}`,
            name: { full: shortcode },
            tags,
            data,
        });
        const records = [
            language("parent", [], {
                words: [{ form: "vela", class: "n", gloss: "Public meaning" }],
            }),
            language("hidden", ["gm"], {
                family: "demo-note-skill-parent",
                words: [{ form: "vela", class: "n", gloss: "Secret meaning" }],
            }),
            language("child", [], {
                family: "demo-note-skill-hidden",
                words: [{ form: "tara", class: "n", gloss: "Earth" }],
            }),
        ];
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sql-audiences-"));
        const file = path.join(dir, "dependency.jsonl");
        fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n"));
        const all = await openNotesDatabase(records, { dependencies: [{ id: "other", file }] });
        let publicDb;
        try {
            publicDb = await openNotesDatabase(records, {
                audience: "public",
                dependencies: [{ id: "other", file }],
            });
            for (const schema of ["main", "other"]) {
                const sql = `SELECT language, name, senses, depth FROM ${schema}.dictionary
                    WHERE language = 'demo-note-skill-child' AND name = 'vela'`;
                expect((await all.query(sql)).rows).toEqual([
                    {
                        language: "demo-note-skill-child",
                        name: "vela",
                        senses: [{ text: "Secret meaning", bodies: [] }],
                        depth: 1n,
                    },
                ]);
                expect((await publicDb.query(sql)).rows).toEqual([
                    {
                        language: "demo-note-skill-child",
                        name: "vela",
                        senses: [{ text: "Public meaning", bodies: [] }],
                        depth: 2n,
                    },
                ]);
                const entries = `SELECT shortcode FROM ${schema}.entries`;
                expect((await all.query(entries)).rows).toEqual([
                    { shortcode: "parent" },
                    { shortcode: "hidden" },
                    { shortcode: "child" },
                ]);
                expect((await publicDb.query(entries)).rows).toEqual([
                    { shortcode: "parent" },
                    { shortcode: "child" },
                ]);
            }
        } finally {
            await publicDb?.close();
            await all.close();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it.each([
        ["all", "local"],
        ["public", "local"],
        ["all", "dependency"],
        ["public", "dependency"],
    ] as const)(
        "loads thousands of anchors and hundreds of offices for %s %s without changing rows or indexes",
        async (audience, load) => {
            fixedBudget();
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sql-memory-"));
            const records = corpus();
            const before = structuredClone(records);
            const stripped = records.map(({ foundry, ...record }) => record);
            const file = path.join(dir, "dependency.jsonl");
            const published = records.map((record) => JSON.stringify(record)).join("\n");
            fs.writeFileSync(file, published);
            const options = { audience, testMemoryLimit: true };
            let baseline;
            let actual;
            try {
                const strippedFile = path.join(dir, "stripped.jsonl");
                fs.writeFileSync(strippedFile, stripped.map((r) => JSON.stringify(r)).join("\n"));
                baseline = await openNotesDatabase(stripped, {
                    ...options,
                    dependencies: [{ id: "other", file: strippedFile }],
                });
                console.info(`${audience}: baseline without foundry loaded under 256 MB`);
                actual = await openNotesDatabase(load === "dependency" ? stripped : records, {
                    ...options,
                    dependencies: [{ id: "other", file }],
                });
                for (const relation of [
                    "main.entries",
                    "main.notes",
                    "other.entries",
                    "other.notes",
                ]) {
                    const sql = `SELECT * FROM ${relation} ORDER BY shortcode`;
                    expect(await actual.query(sql)).toEqual(await baseline.query(sql));
                }
                const query = `SELECT data.governance.offices['Office 1_0'].description AS duty,
                    data.foundry AS nested, data.mappings AS mappings
                    FROM notes WHERE shortcode = 'note1'`;
                expect((await actual.query(query)).rows).toEqual([
                    {
                        duty: "Duty 1_0",
                        nested: "Nested authored fields stay queryable",
                        mappings: [
                            { from: "a", codes: ["lower"] },
                            { from: "A", codes: ["upper"] },
                        ],
                    },
                ]);
                expect(records).toEqual(before);
                expect(fs.readFileSync(file, "utf8")).toBe(published);
            } finally {
                await actual?.close();
                await baseline?.close();
                fs.rmSync(dir, { recursive: true, force: true });
            }
        },
    );

    it.each([false, true])("sets the explicit memory limit (test override: %s)", async (small) => {
        const db = await openNotesDatabase([], { testMemoryLimit: small });
        try {
            const result = await db.query("SELECT current_setting('memory_limit') AS budget");
            // DuckDB displays decimal GB/MB in binary units.
            expect(result.rows).toEqual([{ budget: small ? "244.1 MiB" : "1.8 GiB" }]);
        } finally {
            await db.close();
        }
    });

    it.each(["local", "dependency"])(
        "names genuine %s load exhaustion and closes resources",
        async (load) => {
            fixedBudget();
            const instanceClose = vi.spyOn(DuckDBInstance.prototype, "closeSync");
            const connectionClose = vi.spyOn(DuckDBConnection.prototype, "closeSync");
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sql-exhaustion-"));
            const records = corpus().map(({ foundry, ...record }) => ({
                ...record,
                data: { payload: foundry.note.anchors },
            }));
            const file = path.join(dir, "dependency.jsonl");
            fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n"));
            try {
                const attempt = openNotesDatabase(load === "local" ? records : [], {
                    dir: path.join(dir, "db"),
                    testMemoryLimit: true,
                    dependencies: load === "dependency" ? [{ id: "other", file }] : [],
                });
                await expect(attempt).rejects.toMatchObject({
                    findings: [
                        expect.objectContaining({
                            code: "sql-memory-limit",
                            severity: "error",
                            message: expect.stringMatching(
                                load === "local" ? /256 MB.*local/ : /256 MB.*other/,
                            ),
                        }),
                    ],
                    cause: expect.objectContaining({
                        message: expect.stringMatching(/out of memory/i),
                    }),
                });
                expect(connectionClose).toHaveBeenCalledTimes(1);
                expect(instanceClose).toHaveBeenCalledTimes(1);
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        },
    );

    it.each(["connect", "settings", "dependency"])(
        "closes resources after a %s initialization failure",
        async (stage) => {
            const instanceClose = vi.spyOn(DuckDBInstance.prototype, "closeSync");
            const connectionClose = vi.spyOn(DuckDBConnection.prototype, "closeSync");
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sql-cleanup-"));
            const file = path.join(dir, "broken.jsonl");
            fs.writeFileSync(file, "{broken");
            if (stage === "connect")
                vi.spyOn(DuckDBInstance.prototype, "connect").mockRejectedValueOnce(
                    new Error("connect failed"),
                );
            if (stage === "settings")
                vi.spyOn(DuckDBConnection.prototype, "run").mockRejectedValueOnce(
                    new Error("settings failed"),
                );
            try {
                await expect(
                    openNotesDatabase([], {
                        dependencies: stage === "dependency" ? [{ id: "other", file }] : [],
                    }),
                ).rejects.toThrow();
                expect(instanceClose).toHaveBeenCalledTimes(1);
                expect(connectionClose).toHaveBeenCalledTimes(stage === "connect" ? 0 : 1);
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        },
    );
});
