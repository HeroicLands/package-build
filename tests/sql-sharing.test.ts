/* SPDX-License-Identifier: GPL-3.0-or-later */

import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { createContentSession } from "../engine/content-session.mjs";
import {
    createNotesDatabaseScope,
    openNotesDatabase,
    prepareTreeSqlTables,
} from "../engine/sql-tables.mjs";
import { collectContentIndex } from "../engine/content-index.mjs";
import { DICTIONARY_LANGUAGES } from "./helpers/dictionary-languages.js";
import { configFromData } from "../engine/pack-config.mjs";
import { fixture, note, write } from "./content-session-fixture.js";

afterEach(() => vi.restoreAllMocks());

function rendered(value: unknown) {
    return JSON.stringify(value, (_key, item) =>
        item instanceof Map ? { ...item, entries: [...item] }
        : item instanceof Set ? [...item]
        : typeof item === "bigint" ? String(item)
        : item,
    );
}

it.each([false, true])(
    "shares each entries JSON load with identical audience results (concurrent: %s)",
    async (concurrent) => {
        const input = fixture();
        const dep = path.join(input.config.paths.metadataCache, "source@1.0.0");
        write(path.join(dep, ".complete"), "");
        write(
            path.join(dep, "source-metadata.jsonl"),
            [false, true]
                .map((hidden) =>
                    JSON.stringify({
                        package: "source",
                        type: "lore",
                        subType: "history",
                        shortcode: hidden ? "hidden" : "open",
                        name: { full: hidden ? "Secret" : "Public" },
                        tags: hidden ? ["gm"] : [],
                        address: {
                            canonical: `source-note-lore-${hidden ? "hidden" : "open"}`,
                            slug: `lore-${hidden ? "hidden" : "open"}`,
                        },
                        data: {
                            events: [
                                {
                                    id: "birth",
                                    when: 1,
                                    summary: hidden ? "Secret event" : "Public event",
                                },
                            ],
                        },
                    }),
                )
                .join("\n"),
        );
        const languages = (pkg: string) =>
            [
                {
                    shortcode: "parent",
                    tags: [],
                    data: { words: [{ form: "vela", class: "n", gloss: "Public meaning" }] },
                },
                {
                    shortcode: "hidden",
                    tags: ["gm"],
                    data: {
                        family: `${pkg}-note-skill-parent`,
                        words: [{ form: "vela", class: "n", gloss: "Secret meaning" }],
                    },
                },
                {
                    shortcode: "child",
                    tags: [],
                    data: {
                        family: `${pkg}-note-skill-hidden`,
                        words: [{ form: "tara", class: "n", gloss: "Earth" }],
                    },
                },
            ].map((record) => ({
                ...record,
                package: pkg,
                type: "skill",
                subType: "language",
                name: { full: record.shortcode },
                address: {
                    canonical: `${pkg}-note-skill-${record.shortcode}`,
                    slug: `skill-${record.shortcode}`,
                },
            }));
        for (const { package: pkg, address, ...language } of languages(
            input.config.contentPackage,
        )) {
            write(
                path.join(input.config.paths.content, `${language.shortcode}.md`),
                note(language),
            );
        }
        fs.appendFileSync(
            path.join(dep, "source-metadata.jsonl"),
            "\n" +
                languages("source")
                    .map((r) => JSON.stringify(r))
                    .join("\n"),
        );
        const config = configFromData(
            {
                ...YAML.parse(fs.readFileSync(input.configFile, "utf8")),
                relationships: {
                    requires: [
                        {
                            id: "source",
                            manifest: "https://example.invalid/module.json",
                            compatibility: { verified: "1.0.0" },
                        },
                    ],
                },
            },
            input.configFile,
        );
        const source = [...input.files.keys()][0];
        const queries = [
            "SELECT shortcode FROM main.entries ORDER BY nameSort",
            "SELECT shortcode FROM main.notes ORDER BY nameSort",
            "SELECT shortcode FROM notes ORDER BY nameSort",
            "SELECT shortcode FROM source.entries ORDER BY nameSort",
            "SELECT shortcode FROM source.notes ORDER BY nameSort",
            "SELECT summary FROM source.events ORDER BY summary",
            "SELECT name FROM dictionary ORDER BY name",
            "SELECT name FROM terms ORDER BY name",
            ...[input.config.contentPackage, "source"].map(
                (pkg) =>
                    `SELECT senses[1].text AS Meaning, depth FROM ${pkg === "source" ? "source" : "main"}.dictionary WHERE language = '${pkg}-note-skill-child' AND name = 'vela'`,
            ),
        ];
        write(
            source,
            note(
                {
                    type: "lore",
                    subType: "history",
                    shortcode: "query",
                    data: { events: [{ id: "birth", when: 1, summary: "Public local event" }] },
                },
                queries.map((sql) => `\`\`\`sql\n${sql}\n\`\`\``).join("\n\n"),
            ),
        );
        const session = await createContentSession({ config });
        try {
            const baseline = new Map();
            for (const audience of ["all", "public"] as const)
                baseline.set(
                    audience,
                    await prepareTreeSqlTables(config.paths.content, {
                        config,
                        records: session.records,
                        parsed: session.parsed,
                        foreignIndex: session.foreign.index,
                        audience,
                    }),
                );
            const run = vi.spyOn(DuckDBConnection.prototype, "run");
            const read = vi.spyOn(DuckDBConnection.prototype, "runAndReadAll");
            const create = vi.spyOn(DuckDBInstance, "create");
            const instanceClose = vi.spyOn(DuckDBInstance.prototype, "closeSync");
            const connectionClose = vi.spyOn(DuckDBConnection.prototype, "closeSync");
            if (concurrent)
                await Promise.all([session.sqlTables("public"), session.sqlTables("all")]);
            else {
                await session.sqlTables("all");
                await session.sqlTables("public");
            }
            for (const audience of ["all", "public"] as const)
                expect(rendered(await session.sqlTables(audience))).toEqual(
                    rendered(baseline.get(audience)),
                );
            for (const audience of ["all", "public"] as const) {
                const tables = (await session.sqlTables(audience))!.get(source)!;
                for (const table of tables.slice(queries.length - 2, queries.length)) {
                    expect(table.markdown).toContain(
                        audience === "all" ? "Secret meaning" : "Public meaning",
                    );
                    expect(table.markdown).not.toContain(
                        audience === "all" ? "Public meaning" : "Secret meaning",
                    );
                }
                expect(tables.slice(queries.length - 2, queries.length)).toHaveLength(2);
            }
            const statements = [...run.mock.calls, ...read.mock.calls].map(([sql]) => sql);
            for (const file of ["notes.jsonl", "dependency-source.jsonl"]) {
                const reads = statements.filter(
                    (sql) => /read_json/i.test(sql) && sql.includes(`/${file}'`),
                );
                expect(
                    reads.filter((sql) => /^CREATE TABLE/.test(sql)),
                    file,
                ).toHaveLength(1);
                expect(
                    reads,
                    `${file}: inference must read the materialized table too`,
                ).toHaveLength(1);
            }
            expect(create).toHaveBeenCalledTimes(1);
            expect(instanceClose).not.toHaveBeenCalled();
            expect(connectionClose).not.toHaveBeenCalled();
            session.dispose();
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(instanceClose).toHaveBeenCalledTimes(1);
            expect(connectionClose).toHaveBeenCalledTimes(2);
            session.dispose();
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(instanceClose).toHaveBeenCalledTimes(1);
        } finally {
            session.dispose();
            fs.rmSync(input.root, { recursive: true, force: true });
        }
    },
);

it("retains every local and dependency relation's previous rows in each connection", async () => {
    const root = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "sql-shared-relations-"));
    const records = collectContentIndex(path.resolve("tests/fixtures/dictionary/tree"), {
        contentPackage: "demo",
        skipDirectories: [],
        languages: DICTIONARY_LANGUAGES,
    });
    const file = path.join(root, "source.jsonl");
    fs.writeFileSync(file, records.map((record) => JSON.stringify(record)).join("\n"));
    const dependencies = [{ id: "source", file }];
    const scope = createNotesDatabaseScope(records, { dependencies });
    try {
        for (const audience of ["public", "all"] as const) {
            const baseline = await openNotesDatabase(records, { dependencies, audience });
            try {
                const db = await scope.database(audience);
                const { rows } = await baseline.query(
                    "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema IN ('main', 'source', '__with_stubs') ORDER BY table_schema, table_name",
                );
                expect(rows.length).toBeGreaterThan(30);
                for (const row of rows) {
                    const sql = `SELECT * FROM "${row.table_schema}"."${row.table_name}"`;
                    expect(await db.query(sql), `${audience} ${sql}`).toEqual(
                        await baseline.query(sql),
                    );
                }
                expect(await db.stubsExcluded("SELECT shortcode FROM notes", 0)).toBe(
                    await baseline.stubsExcluded("SELECT shortcode FROM notes", 0),
                );
                // A stub comparison must leave both qualified and unqualified
                // names on the same audience connection for subsequent queries.
                for (const relation of ["main.entries", "notes", "source.entries", "dictionary"]) {
                    const sql = `SELECT * FROM ${relation}`;
                    expect(await db.query(sql)).toEqual(await baseline.query(sql));
                }
            } finally {
                await baseline.close();
            }
        }
    } finally {
        scope.dispose();
        await Promise.resolve();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

it("releases the shared instance after initialization fails", async () => {
    const closed = vi.spyOn(DuckDBInstance.prototype, "closeSync");
    const connectionClosed = vi.spyOn(DuckDBConnection.prototype, "closeSync");
    vi.spyOn(DuckDBInstance.prototype, "connect").mockRejectedValueOnce(
        new Error("connect failed"),
    );
    const scope = createNotesDatabaseScope([]);
    await expect(scope.database("public")).rejects.toThrow("connect failed");
    expect(closed).toHaveBeenCalledTimes(1);
    expect(connectionClosed).not.toHaveBeenCalled();
    await expect(scope.database("all")).rejects.toThrow(/disposed/);
    scope.dispose();
    expect(closed).toHaveBeenCalledTimes(1);
});

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

it.each([false, true])(
    "drains preparation before releasing native resources (second opening fails: %s)",
    async (secondFails) => {
        const input = fixture(2);
        const source = [...input.files.keys()][0];
        const query = "SELECT 'held preparation' AS Held";
        write(
            source,
            note(
                { type: "lore", subType: "history", shortcode: "query" },
                `\`\`\`sql\n${query}\n\`\`\``,
            ),
        );
        const entered = deferred();
        const release = deferred();
        const read = DuckDBConnection.prototype.runAndReadAll;
        vi.spyOn(DuckDBConnection.prototype, "runAndReadAll").mockImplementation(async function (
            sql,
            ...args
        ) {
            const result = await read.call(this, sql, ...args);
            if (sql === query) {
                entered.resolve();
                await release.promise;
            }
            return result;
        });
        const run = DuckDBConnection.prototype.run;
        if (secondFails)
            vi.spyOn(DuckDBConnection.prototype, "run").mockImplementation(function (sql, ...args) {
                if (sql.startsWith("ATTACH") && sql.includes("__sql_public"))
                    return Promise.reject(new Error("public opening failed"));
                return run.call(this, sql, ...args);
            });
        const closed = vi.spyOn(DuckDBInstance.prototype, "closeSync");
        const connectionClosed = vi.spyOn(DuckDBConnection.prototype, "closeSync");
        const session = await createContentSession({ config: input.config });
        const work = session.sqlTables("all");
        try {
            await entered.promise;
            if (secondFails)
                await expect(session.sqlTables("public")).rejects.toThrow("public opening failed");
            session.dispose();
            session.dispose();
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(closed).not.toHaveBeenCalled();
            expect(connectionClosed).toHaveBeenCalledTimes(secondFails ? 1 : 0);
        } finally {
            release.resolve();
            await work.catch((error) => {
                expect(error.message).toMatch(/disposed/);
            });
            session.dispose();
            // Flush the promise drain, without timing-dependent sleeps.
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(closed).toHaveBeenCalledTimes(1);
            expect(connectionClosed).toHaveBeenCalledTimes(secondFails ? 2 : 1);
            fs.rmSync(input.root, { recursive: true, force: true });
        }
    },
);

it("renders dictionary and glossary labels from only the current audience's entries views", async () => {
    const records = collectContentIndex(path.resolve("tests/fixtures/dictionary/tree"), {
        contentPackage: "demo",
        skipDirectories: [],
        languages: DICTIONARY_LANGUAGES,
    });
    const scope = createNotesDatabaseScope(records);
    const { prepareSqlTables } = await import("../engine/sql-tables.mjs");
    const sources = [
        {
            source: "labels.md",
            markdown: [
                "```sql {layout=dictionary}\nSELECT * FROM dictionary\n```",
                "```sql {layout=glossary}\nSELECT * FROM terms\n```",
            ].join("\n\n"),
        },
    ];
    try {
        for (const audience of ["all", "public"] as const) {
            const baseline = await openNotesDatabase(records, { audience });
            try {
                const previous = await prepareSqlTables(baseline, sources);
                const actual = await prepareSqlTables(await scope.database(audience), sources);
                expect(
                    previous
                        .get("labels.md")!
                        .every((table: any) => !table.reason && table.rows > 0),
                ).toBe(true);
                expect(rendered(actual)).toEqual(rendered(previous));
            } finally {
                await baseline.close();
            }
        }
    } finally {
        scope.dispose();
        await Promise.resolve();
    }
});
