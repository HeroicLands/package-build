/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { DuckDBInstance } from "@duckdb/node-api";

import { defineConfig } from "../content-config.mjs";
import { CONFIG_BASENAME, configFromData } from "../engine/pack-config.mjs";
import { noteFile } from "../engine/content-index.mjs";
import {
    createConfiguredNotesDatabaseScope,
    openConfiguredNotesDatabase,
    prepareTreeSqlTables,
} from "../engine/sql-tables.mjs";

afterEach(() => vi.restoreAllMocks());

function minimal(overrides: Record<string, unknown> = {}) {
    return {
        rootDir: "/repo",
        contentPackage: "acme",
        foundryPackage: "acme",
        packageKind: "systems",
        compatibility: { minimum: "14.359" },
        stats: { lastModifiedBy: "acmebuilder0000" },
        packs: [{ name: "items", type: "Item" }],
        ...overrides,
    };
}

describe("sql.memoryLimit", () => {
    it("defaults to 2 GB", () => {
        expect(defineConfig(minimal()).sql).toEqual({ memoryLimit: "2 GB" });
        expect(defineConfig(minimal({ sql: {} })).sql).toEqual({ memoryLimit: "2 GB" });
    });

    it.each(["6 GB", "512MiB", "1.5 gb", "  3 TB "])("accepts %j", (value) => {
        expect(defineConfig(minimal({ sql: { memoryLimit: value } })).sql.memoryLimit).toBe(
            value.trim(),
        );
    });

    it.each(["lots", "6", "GB", "-2 GB", "2 gigabytes", "", 6, null])("refuses %j", (value) => {
        expect(() => defineConfig(minimal({ sql: { memoryLimit: value } }))).toThrow(
            /`sql\.memoryLimit` must be/,
        );
    });

    it.each(["0 GB", "0.0 MiB", "999 KB", "0.1 MB", "1 B", "1000 B", "10 KiB"])(
        "refuses %j as below the smallest size DuckDB can run in",
        (value) => {
            expect(() => defineConfig(minimal({ sql: { memoryLimit: value } }))).toThrow(
                /`sql\.memoryLimit` must be (at least 1 MB|a size)/,
            );
        },
    );

    it("refuses a size DuckDB's parser cannot represent", () => {
        expect(() => defineConfig(minimal({ sql: { memoryLimit: "20000000 TB" } }))).toThrow(
            /`sql\.memoryLimit` must be below 2\^64 bytes/,
        );
    });

    it.each(["1 PB", "10%", "+1 GB", "1,5 GB", "1e3 MB", ".5 GB", "5. GB", "1 M"])(
        "refuses %j, a form outside the documented sizes",
        (value) => {
            expect(() => defineConfig(minimal({ sql: { memoryLimit: value } }))).toThrow(
                /`sql\.memoryLimit` must be a size/,
            );
        },
    );

    it.each(["1 MB", "1.5 GB", "1 gib", "2 TiB", "18446744 TB"])(
        "accepts %j, which DuckDB accepts too",
        async (value) => {
            expect(defineConfig(minimal({ sql: { memoryLimit: value } })).sql.memoryLimit).toBe(
                value,
            );
            const instance = await DuckDBInstance.create(":memory:", { memory_limit: value });
            const connection = await instance.connect();
            try {
                await connection.run("CREATE TABLE t AS SELECT range AS a FROM range(100)");
            } finally {
                connection.closeSync();
                instance.closeSync();
            }
        },
    );

    it.each(["20000000 TB", "1 PB", "1 PiB", "10%", "+1 GB", "1,5 GB"])(
        "agrees with DuckDB that %j is unusable",
        async (value) => {
            await expect(
                DuckDBInstance.create(":memory:", { memory_limit: value }).then(async (i) => {
                    const c = await i.connect();
                    try {
                        await c.run("CREATE TABLE t AS SELECT range AS a FROM range(100)");
                    } finally {
                        c.closeSync();
                        i.closeSync();
                    }
                }),
            ).rejects.toThrow();
            expect(() => defineConfig(minimal({ sql: { memoryLimit: value } }))).toThrow(
                /`sql\.memoryLimit` must be/,
            );
        },
    );

    it.each(["lots", "0 GB", "1 B"])("locates %j at its line and column in the file", (value) => {
        const text = [
            "contentPackage: sohl",
            "packageKind: systems",
            "compatibility:",
            '    minimum: "14.359"',
            "stats:",
            "    lastModifiedBy: sohlbuilder00000",
            "packs:",
            "    - name: items",
            "      type: Item",
            "sql:",
            `    memoryLimit: ${JSON.stringify(value)}`,
            "",
        ].join("\n");
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sql-config-")));
        fs.writeFileSync(
            path.join(root, "package.json"),
            JSON.stringify({ name: "sohl", version: "1.2.3" }),
        );
        const file = path.join(root, CONFIG_BASENAME + ".yaml");
        fs.writeFileSync(file, text);
        let message = "";
        try {
            configFromData(YAML.parse(text), file);
        } catch (err) {
            message = (err as Error).message;
        }
        const at = /^(.+):(\d+):(\d+): error: .*`sql\.memoryLimit`/.exec(message);
        expect(at, message).not.toBeNull();
        expect(at![1]).toBe(file);
        const line = text.split("\n")[Number(at![2]) - 1];
        expect(line.slice(Number(at![3]) - 1)).toContain("memoryLimit");
    });

    it("refuses an unknown key and a non-object section", () => {
        expect(() => defineConfig(minimal({ sql: { threads: 2 } }))).toThrow(
            /`sql\.threads` is not a recognized option/,
        );
        expect(() => defineConfig(minimal({ sql: "6 GB" }))).toThrow(/`sql` must be an object/);
    });
});

describe("sql.memoryLimit reaches the SQL engine", () => {
    it("prepareTreeSqlTables opens its database with the configured limit", async () => {
        const create = vi.spyOn(DuckDBInstance, "create");
        const content = fs.mkdtempSync(path.join(os.tmpdir(), "sql-config-tree-"));
        try {
            // A note carrying events makes the preparation open a database.
            const record = {
                package: "demo",
                type: "doc",
                shortcode: "chronicle",
                address: { canonical: "demo-note-doc-chronicle", slug: "doc-chronicle" },
                name: { full: "Chronicle" },
                file: { path: "chronicle.md" },
                tags: [],
                data: { events: [{ date: "720.1", title: "An event" }] },
            };
            const file = noteFile(content, record);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, "A chronicle.\n");
            await prepareTreeSqlTables(content, {
                config: { sql: { memoryLimit: "4 GB" } },
                records: [record],
                parsed: new Map([[file, { body: "", frontmatter: {} }]]),
                foreignIndex: new Map(),
            }).catch(() => {});
        } finally {
            fs.rmSync(content, { recursive: true, force: true });
        }
        expect(create).toHaveBeenCalled();
        expect(create.mock.calls[0][1]).toMatchObject({ memory_limit: "4 GB" });
    });

    it("openConfiguredNotesDatabase, which the PDF build calls, applies the configured limit", async () => {
        const db = await openConfiguredNotesDatabase([], { sql: { memoryLimit: "4 GB" } });
        try {
            const result = await db.query("SELECT current_setting('memory_limit') AS budget");
            expect(result.rows).toEqual([{ budget: "3.7 GiB" }]);
        } finally {
            await db.close();
        }
    });

    it("createConfiguredNotesDatabaseScope, which the content session calls, applies the configured limit", async () => {
        const scope = createConfiguredNotesDatabaseScope([], { sql: { memoryLimit: "4 GB" } });
        try {
            const db = await scope.database("all");
            const result = await db.query("SELECT current_setting('memory_limit') AS budget");
            expect(result.rows).toEqual([{ budget: "3.7 GiB" }]);
        } finally {
            await scope.dispose();
        }
    });

    it("both fall back to the default when the configuration has no sql section", async () => {
        const db = await openConfiguredNotesDatabase([], {});
        try {
            const result = await db.query("SELECT current_setting('memory_limit') AS budget");
            expect(result.rows).toEqual([{ budget: "1.8 GiB" }]);
        } finally {
            await db.close();
        }
    });
});
