/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { collectContentIndex, serializeContentIndex } from "../engine/content-index.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { expandContentTables } from "../engine/content-tables.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { openNotesDatabase, prepareTreeSqlTables, runSqlQuery } from "../engine/sql-tables.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const roots: string[] = [];
afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

/** A language note with the two distinct shapes of joining form. */
function note(data: string[], body = "The joining forms of name elements and founders.") {
    return [
        "---",
        "shortcode: joininglng",
        "name: {full: Joining Forms}",
        "type: skill",
        "subType: language",
        "data:",
        ...data,
        "---",
        "",
        body,
        "",
    ].join("\n");
}

const DATA = [
    "  elements:",
    "    - {form: -borg, sense: a stronghold, joining: -borgar}",
    '    - {form: -heim, sense: a home, joining: ""}',
    "    - {form: -dal, sense: a valley}",
    "  naming:",
    "    heldFrom:",
    '      - {source: a founder, takes: givenName, joining: ["-s", "-a"]}',
    "      - {source: a god, takes: godName, joining: []}",
    "      - {source: the ground alone, takes: stem}",
];

/** Read a physical source through the same index and frontmatter lint as a note. */
function fixture(raw = note(DATA), contentPackage = "demo") {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "joining-forms-"));
    roots.push(root);
    const file = path.join(root, "Joining.md");
    fs.writeFileSync(file, raw);
    const problems: any[] = [];
    const parsed = new Map();
    const records = collectContentIndex(root, {
        contentPackage,
        skipDirectories: [],
        problems,
        parsed,
    });
    const index = buildLinkIndex(root, { records, parsed, skipDirectories: [] });
    const findings = [
        ...problems,
        ...lintFrontmatter(index, { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY }).findings,
    ];
    return { root, file, records, parsed, findings };
}

/** A literal UTF-16 source position, without normalizing the authored line endings. */
function position(raw: string, value: string, from = 0) {
    const offset = raw.indexOf(value, from);
    expect(offset).toBeGreaterThanOrEqual(0);
    const before = raw.slice(0, offset);
    return { line: before.split("\n").length, column: offset - before.lastIndexOf("\n") };
}

const TYPES = [
    { table_name: "elements", column_name: "joining", data_type: "VARCHAR" },
    { table_name: "held_from", column_name: "joining", data_type: "VARCHAR[]" },
];
const COLUMNS =
    "SELECT table_name, column_name, data_type FROM information_schema.columns " +
    "WHERE table_schema = 'main' AND table_name IN ('elements', 'held_from') " +
    "AND column_name IN ('joining', 'genitive') ORDER BY table_name";

describe("name joining forms", () => {
    it("accepts the scalar and list fields, including empty and absent optional values", () => {
        const source = fixture();
        expect(source.findings).toEqual([]);
        const data = source.parsed.get(source.file).frontmatter.data;
        expect(data.elements.map((row: any) => row.joining)).toEqual(["-borgar", "", undefined]);
        expect(data.naming.heldFrom.map((row: any) => row.joining)).toEqual([
            ["-s", "-a"],
            [],
            undefined,
        ]);
    });

    it.each([
        [
            "element",
            ["  elements:", "    - {form: -borg, sense: a stronghold, joining: [-borgar]}"],
            /`data\.elements\[0\]\.joining` should be the element as written/,
        ],
        [
            "founder",
            [
                "  naming:",
                "    heldFrom:",
                "      - {source: a founder, takes: givenName, joining: -s}",
            ],
            /`data\.naming\.heldFrom\[0\]\.joining` should be a list of endings/,
        ],
    ])("keeps the %s field's existing value shape", (_label, data, message) => {
        const raw = note(data as string[]);
        const source = fixture(raw);
        expect(source.findings).toHaveLength(1);
        expect(source.findings[0]).toMatchObject({
            severity: "error",
            ...position(raw, data[0] === "  elements:" ? "[-borgar]" : "-s}"),
        });
        expect(source.findings[0].message).toMatch(message);
    });

    it("refuses each undeclared genitive key at its ordinary authored key position", () => {
        const raw = note([
            "  elements:",
            "    - form: -borg",
            "      sense: a stronghold",
            "      genitive: -borgar",
            "  naming:",
            "    heldFrom:",
            '      - {source: "🜁 a founder", takes: givenName, genitive: ["-s", "-a"]}',
        ]).replace(/\n/g, "\r\n");
        const source = fixture(raw);
        expect(source.findings).toHaveLength(2);
        const paths = ["data.elements[0]", "data.naming.heldFrom[0]"];
        let from = 0;
        for (const [i, finding] of source.findings.entries()) {
            expect(finding).toMatchObject({
                file: source.file,
                severity: "error",
                ...position(raw, "genitive:", from),
            });
            expect(finding.message).toContain(
                '"genitive" is not a key of `' + paths[i] + "`; it takes only ",
            );
            expect(finding.message).toContain("`joining`");
            from = raw.indexOf("genitive:", from) + "genitive:".length;
        }
    });

    it("keeps the existing name-only shaping rule on the renamed held-from key", () => {
        const raw = note([
            "  naming:",
            "    heldFrom:",
            '      - {source: the ground alone, takes: stem, joining: ["-s"]}',
        ]);
        const source = fixture(raw);
        expect(source.findings).toHaveLength(1);
        expect(source.findings[0]).toMatchObject({
            severity: "error",
            message: "`joining` shapes a name, and `data.naming.heldFrom[0]` takes a `stem`",
            ...position(raw, "joining:"),
        });
    });

    it("exposes both joining columns with unchanged values, order and types locally and from a dependency", async () => {
        const source = fixture();
        const foreign = fixture(note(DATA), "elder");
        const published = path.join(source.root, "elder.jsonl");
        fs.writeFileSync(published, serializeContentIndex(foreign.records));
        const db = await openNotesDatabase(source.records, {
            dir: path.join(source.root, "db"),
            dependencies: [{ id: "elder", file: published }],
        });
        try {
            expect((await runSqlQuery(db, COLUMNS)).rows).toEqual(TYPES);
            expect((await runSqlQuery(db, COLUMNS.replace("'main'", "'elder'"))).rows).toEqual(
                TYPES,
            );
            for (const prefix of ["", "elder."]) {
                expect(
                    (
                        await runSqlQuery(
                            db,
                            `SELECT form, joining FROM ${prefix}elements ORDER BY position`,
                        )
                    ).rows,
                ).toEqual([
                    { form: "-borg", joining: "-borgar" },
                    { form: "-heim", joining: "" },
                    { form: "-dal", joining: null },
                ]);
                expect(
                    (
                        await runSqlQuery(
                            db,
                            `SELECT source, joining FROM ${prefix}held_from ORDER BY position`,
                        )
                    ).rows,
                ).toEqual([
                    { source: "a founder", joining: ["-s", "-a"] },
                    { source: "a god", joining: [] },
                    { source: "the ground alone", joining: null },
                ]);
                await expect(
                    runSqlQuery(db, `SELECT genitive FROM ${prefix}elements`),
                ).rejects.toThrow(/genitive/i);
                await expect(
                    runSqlQuery(db, `SELECT genitive FROM ${prefix}held_from`),
                ).rejects.toThrow(/genitive/i);
            }
        } finally {
            await db.close();
        }
    });

    it("keeps the scalar and list columns typed when both relations are empty", async () => {
        const source = fixture(note([]));
        const db = await openNotesDatabase(source.records, { dir: path.join(source.root, "db") });
        try {
            expect((await runSqlQuery(db, COLUMNS)).rows).toEqual(TYPES);
            expect((await runSqlQuery(db, "SELECT joining FROM elements")).rows).toEqual([]);
            expect((await runSqlQuery(db, "SELECT joining FROM held_from")).rows).toEqual([]);
        } finally {
            await db.close();
        }
    });

    it("expands actual authored SQL fences without changing the forms or surrounding prose", async () => {
        const body = [
            "Before the lists.",
            "",
            "```sql",
            'SELECT form AS "Element", coalesce(joining, \'—\') AS "Joining form" FROM elements ORDER BY position',
            "```",
            "",
            "Between the lists.",
            "",
            "```sql",
            "SELECT source AS \"Source\", coalesce(array_to_string(joining, ' or '), '—') AS \"Joining endings\" FROM held_from ORDER BY position",
            "```",
            "",
            "After the lists.",
        ].join("\n");
        const source = fixture(note(DATA, body));
        const db = await openNotesDatabase(source.records, { dir: path.join(source.root, "db") });
        try {
            const prepared: any = await prepareTreeSqlTables(source.root, {
                records: source.records,
                parsed: source.parsed,
                skipDirectories: [],
                foreignIndex: new Map(),
                database: db,
            });
            const expanded = expandContentTables(source.parsed.get(source.file).body, {
                source: source.file,
                sqlTables: prepared?.get(source.file),
            });
            expect(expanded.errors).toEqual([]);
            expect(expanded.markdown).toBe(
                [
                    "Before the lists.",
                    "",
                    "| Element | Joining form |",
                    "| --- | --- |",
                    "| -borg | -borgar |",
                    "| -heim | — |",
                    "| -dal | — |",
                    "",
                    "Between the lists.",
                    "",
                    "| Source | Joining endings |",
                    "| --- | --- |",
                    "| a founder | -s or -a |",
                    "| a god | — |",
                    "| the ground alone | — |",
                    "",
                    "After the lists.",
                ].join("\n"),
            );
        } finally {
            await db.close();
        }
    });
});
