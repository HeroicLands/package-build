/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { collectContentIndex, serializeContentIndex } from "../engine/content-index.mjs";
import { foundryIdentities } from "../engine/foundry-entries.mjs";
import { openNotesDatabase } from "../engine/sql-tables.mjs";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function scratch() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "names-tables-"));
    roots.push(root);
    return root;
}

const COLUMNS = [
    { column_name: "owner", column_type: "VARCHAR" },
    { column_name: "name", column_type: "VARCHAR" },
    { column_name: "type", column_type: "VARCHAR" },
    { column_name: "subType", column_type: "VARCHAR" },
    { column_name: "ref", column_type: "VARCHAR" },
    { column_name: "line", column_type: "BIGINT" },
    { column_name: "column", column_type: "BIGINT" },
];

/** Real own/documentation records with synthetic captured occurrence fields. */
function capturedRecords(root: string, contentPackage: string) {
    const tree = path.join(root, contentPackage);
    fs.mkdirSync(tree);
    for (const [file, frontmatter] of [
        ["Open", "type: lore\nshortcode: open\nname: {full: Open}\ntags: [gma]"],
        ["Token", "type: miscgear\nshortcode: token\nname: {full: Token}"],
        ["Hidden", "type: lore\nshortcode: hidden\nname: {full: Hidden}\ntags: [' #GM ' ]"],
        ["Scaffold", "name: {full: Scaffold}"],
    ])
        fs.writeFileSync(path.join(tree, `${file}.md`), `---\n${frontmatter}\n---\n\nProse.\n`);
    const records = collectContentIndex(tree, {
        contentPackage,
        skipDirectories: [],
        manifest: foundryIdentities({
            contentPackage,
            foundryPackage: contentPackage,
            docEntryTypes: new Set(["miscgear"]),
        }),
    });
    expect(records.some((record) => record.documents)).toBe(true);
    expect(records.some((record) => record.address === null)).toBe(true);
    return [
        ...records.map((record) => ({
            ...record,
            names:
                record.shortcode === "open" ?
                    [
                        {
                            name: "Ravenmoor",
                            type: "place",
                            subType: "settlement",
                            ref: null,
                            line: 9,
                            column: 4,
                        },
                        {
                            name: "Aldric Venn",
                            type: "being",
                            subType: null,
                            ref: "being-tomr",
                            line: 12,
                            column: 7,
                        },
                    ]
                : record.shortcode === "token" || record.documents ?
                    [
                        {
                            name: "Silver Coin",
                            type: null,
                            subType: null,
                            ref: null,
                            line: 5,
                            column: 1,
                        },
                    ]
                : record.shortcode === "hidden" ?
                    [
                        {
                            name: "Hidden Hill",
                            type: "place",
                            subType: null,
                            ref: "#hill",
                            line: 8,
                            column: 2,
                        },
                    ]
                :   [
                        {
                            name: "Unwritten Road",
                            type: null,
                            subType: null,
                            ref: null,
                            line: 3,
                            column: 2,
                        },
                    ],
        })),
        {
            package: contentPackage,
            type: "image",
            asset: { path: "images/Token.webp" },
            names: [
                {
                    name: "Asset duplicate",
                    type: null,
                    subType: null,
                    ref: null,
                    line: 1,
                    column: 1,
                },
            ],
        },
    ];
}

function expectedRows(contentPackage: string, audience = "all") {
    return [
        ...(audience === "all" ?
            [
                {
                    owner: `${contentPackage}-note-lore-hidden`,
                    name: "Hidden Hill",
                    type: "place",
                    subType: null,
                    ref: "#hill",
                    line: 8n,
                    column: 2n,
                },
            ]
        :   []),
        {
            owner: `${contentPackage}-note-lore-open`,
            name: "Ravenmoor",
            type: "place",
            subType: "settlement",
            ref: null,
            line: 9n,
            column: 4n,
        },
        {
            owner: `${contentPackage}-note-lore-open`,
            name: "Aldric Venn",
            type: "being",
            subType: null,
            ref: "being-tomr",
            line: 12n,
            column: 7n,
        },
        {
            owner: `${contentPackage}-note-miscgear-token`,
            name: "Silver Coin",
            type: null,
            subType: null,
            ref: null,
            line: 5n,
            column: 1n,
        },
        {
            owner: null,
            name: "Unwritten Road",
            type: null,
            subType: null,
            ref: null,
            line: 3n,
            column: 2n,
        },
    ];
}

describe("the authored names SQL relation", () => {
    it("keeps the same seven typed columns in empty local, dependency and stub-inclusive contexts", async () => {
        const root = scratch();
        const file = path.join(root, "elder-metadata.jsonl");
        fs.writeFileSync(file, serializeContentIndex([]));
        const db = await openNotesDatabase([], { dependencies: [{ id: "elder", file }] });
        try {
            for (const relation of ["names", "elder.names", "__with_stubs.names"]) {
                const schema = await db.query(`DESCRIBE ${relation}`);
                expect(
                    schema.rows.map(({ column_name, column_type }) => ({
                        column_name,
                        column_type,
                    })),
                    relation,
                ).toEqual(COLUMNS);
                expect(await db.query(`SELECT * FROM ${relation}`)).toEqual({
                    columnNames: COLUMNS.map(({ column_name }) => column_name),
                    rows: [],
                });
            }
        } finally {
            await db.close();
        }
    });

    it("reads native NOTE owners and exact rows from local and serialized dependency metadata once", async () => {
        const root = scratch();
        const records = capturedRecords(root, "demo");
        const dependency = capturedRecords(root, "elder");
        const file = path.join(root, "elder-metadata.jsonl");
        const metadata = serializeContentIndex(dependency);
        fs.writeFileSync(file, metadata);
        const published = metadata
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line));
        expect(
            published.find((record) => record.type === "miscgear" && !record.documents).address
                .canonical,
        ).toEqual({
            address: "elder-sohl-miscgear-token",
            anchor: null,
            anchorKind: null,
        });
        expect(published.find((record) => record.shortcode === "open").names).toHaveLength(2);
        const work = path.join(root, "database");
        const db = await openNotesDatabase(records, {
            dir: work,
            dependencies: [{ id: "elder", file }],
        });
        try {
            for (const [relation, contentPackage] of [
                ["names", "demo"],
                ["elder.names", "elder"],
                ["__with_stubs.names", "demo"],
            ]) {
                const result = await db.query(
                    `SELECT * FROM ${relation} ORDER BY owner NULLS LAST, line, "column"`,
                );
                expect(result.columnNames).toEqual(COLUMNS.map(({ column_name }) => column_name));
                expect(result.rows).toEqual(expectedRows(contentPackage));
            }
            for (const name of fs.readdirSync(work).filter((name) => name.endsWith("names.jsonl")))
                fs.rmSync(path.join(work, name));
            fs.rmSync(file);
            expect(
                (
                    await db.query(
                        'SELECT * FROM elder.names ORDER BY owner NULLS LAST, line, "column"',
                    )
                ).rows,
            ).toEqual(expectedRows("elder"));
            expect(await db.stubsExcluded("SELECT * FROM names", expectedRows("demo").length)).toBe(
                0,
            );
        } finally {
            await db.close();
        }
    });

    it("applies existing public audience filtering to local, dependency and stub-inclusive rows", async () => {
        const root = scratch();
        const records = capturedRecords(root, "demo");
        const file = path.join(root, "elder-metadata.jsonl");
        fs.writeFileSync(file, serializeContentIndex(capturedRecords(root, "elder")));
        const db = await openNotesDatabase(records, {
            dependencies: [{ id: "elder", file }],
            audience: "public",
        });
        try {
            for (const [relation, contentPackage] of [
                ["names", "demo"],
                ["elder.names", "elder"],
                ["__with_stubs.names", "demo"],
            ])
                expect(
                    (
                        await db.query(
                            `SELECT * FROM ${relation} ORDER BY owner NULLS LAST, line, "column"`,
                        )
                    ).rows,
                ).toEqual(expectedRows(contentPackage, "public"));
        } finally {
            await db.close();
        }
    });

    it("uses VARCHAR for entirely null owners and kinds and BIGINT for source positions", async () => {
        const root = scratch();
        const records = [
            {
                address: null,
                names: [
                    {
                        name: "Élan & the Moon",
                        type: null,
                        subType: null,
                        ref: null,
                        line: 27,
                        column: 14,
                    },
                ],
            },
        ];
        const file = path.join(root, "elder-metadata.jsonl");
        fs.writeFileSync(file, serializeContentIndex(records));
        const db = await openNotesDatabase(records, { dependencies: [{ id: "elder", file }] });
        try {
            for (const relation of ["names", "elder.names", "__with_stubs.names"]) {
                const schema = await db.query(`DESCRIBE ${relation}`);
                expect(
                    schema.rows.map(({ column_name, column_type }) => ({
                        column_name,
                        column_type,
                    })),
                ).toEqual(COLUMNS);
                expect((await db.query(`SELECT * FROM ${relation}`)).rows).toEqual([
                    { owner: null, ...records[0].names[0], line: 27n, column: 14n },
                ]);
            }
        } finally {
            await db.close();
        }
    });

    it("preserves a typed name and owner beyond the JSON inference sample", async () => {
        const untyped = Array.from({ length: 20_500 }, (_, position) => ({
            name: `Unwritten ${position}`,
            type: null,
            subType: null,
            ref: null,
            line: position + 1,
            column: 1,
        }));
        const records = [
            { address: null, names: untyped },
            {
                address: { canonical: "demo-note-lore-late" },
                names: [
                    {
                        name: "Late Ravenmoor",
                        type: "place",
                        subType: "settlement",
                        ref: null,
                        line: 20_501,
                        column: 11,
                    },
                ],
            },
        ];
        const db = await openNotesDatabase(records);
        try {
            expect((await db.query("SELECT count(*) AS n FROM names")).rows).toEqual([
                { n: 20_501n },
            ]);
            expect(
                (await db.query("SELECT * FROM names WHERE name = 'Late Ravenmoor'")).rows,
            ).toEqual([
                {
                    owner: "demo-note-lore-late",
                    name: "Late Ravenmoor",
                    type: "place",
                    subType: "settlement",
                    ref: null,
                    line: 20_501n,
                    column: 11n,
                },
            ]);
            expect(
                (
                    await db.query(
                        "SELECT count(*) AS n FROM names " +
                            'WHERE owner IS NULL AND type IS NULL AND "subType" IS NULL',
                    )
                ).rows,
            ).toEqual([{ n: 20_500n }]);
        } finally {
            await db.close();
        }
    });
});
