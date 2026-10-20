/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **The `runs` and `maps` relations.** One row per marked span, div and poetry
 * fence, and one per row of a mapping note. Their values are strings, never
 * keys, so two notes writing one language tag in different case are two rows,
 * and a map's `A` and `a` are two rows, rather than two struct keys DuckDB
 * cannot tell apart.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";

import { collectContentIndex, serializeContentIndex } from "../engine/content-index.mjs";
import { authoredFrontmatter } from "../engine/index-records.mjs";
import { RUN_COLUMNS, runsRows } from "../engine/run-rows.mjs";
import { openNotesDatabase } from "../engine/sql-tables.mjs";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const COLUMNS = [
    { column_name: "owner", column_type: "VARCHAR" },
    { column_name: "kind", column_type: "VARCHAR" },
    { column_name: "lang", column_type: "VARCHAR" },
    { column_name: "tag", column_type: "VARCHAR" },
    { column_name: "font", column_type: "VARCHAR" },
    { column_name: "map", column_type: "VARCHAR" },
    { column_name: "line", column_type: "BIGINT" },
    { column_name: "column", column_type: "BIGINT" },
];

const LANGUAGES = Object.freeze({ vyl: Object.freeze({ tag: "art-x-vyl" }) });

function write(file: string, frontmatter: object, body: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `---\n${YAML.stringify(frontmatter)}---\n\n${body}\n`);
}

/**
 * A tree whose notes write the same tags in different case: `en-GB` beside
 * `en-gb`, and `La` beside `la`, across two notes and within one.
 */
function tree(contentPackage = "demo") {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runs-index-")));
    roots.push(root);
    const content = path.join(root, contentPackage);
    write(
        path.join(content, "Vylari.md"),
        { type: "skill", subType: "language", shortcode: "vylari", name: { full: "Vylari" } },
        "The tongue of the Vylari, written in their own spelling and in Semaron.",
    );
    write(
        path.join(content, "Upper.md"),
        { type: "lore", subType: "history", shortcode: "upper", name: { full: "Upper" } },
        [
            "The colour is [colour]{lang=en-GB}, and the motto [Ad Astra]{lang=La}.",
            "",
            "::: {lang=vyl font=Semaron-Kuriale}",
            "Zaron tholmeza.",
            ":::",
        ].join("\n"),
    );
    write(
        path.join(content, "Lower.md"),
        { type: "lore", subType: "history", shortcode: "lower", name: { full: "Lower" } },
        [
            "The colour is [colour]{lang=en-gb}, and the motto [ad astra]{lang=la}.",
            "",
            "```poetry {form=epic lang=vyl font=semaron-kuriale map=vyl-semaron}",
            "Zaron tholmeza.",
            "```",
        ].join("\n"),
    );
    write(
        path.join(content, "Hidden.md"),
        {
            type: "lore",
            subType: "history",
            shortcode: "hidden",
            name: { full: "Hidden" },
            tags: ["gm"],
        },
        "The keeper says [Daimela]{lang=vyl} to the watch, and nothing more than that.",
    );
    return collectContentIndex(content, {
        contentPackage,
        skipDirectories: [],
        languages: LANGUAGES,
    });
}

function rows(contentPackage: string, audience = "all") {
    const owner = (shortcode: string) => `${contentPackage}-note-lore-${shortcode}`;
    return [
        ...(audience === "all" ?
            [
                {
                    owner: owner("hidden"),
                    kind: "span",
                    lang: "vyl",
                    tag: "art-x-vyl",
                    font: null,
                    map: null,
                    line: 11n,
                    column: 17n,
                },
            ]
        :   []),
        {
            owner: owner("lower"),
            kind: "span",
            lang: "en-gb",
            tag: "en-gb",
            font: null,
            map: null,
            line: 9n,
            column: 15n,
        },
        {
            owner: owner("lower"),
            kind: "span",
            lang: "la",
            tag: "la",
            font: null,
            map: null,
            line: 9n,
            column: 51n,
        },
        {
            owner: owner("lower"),
            kind: "poetry",
            lang: "vyl",
            tag: "art-x-vyl",
            font: "semaron-kuriale",
            map: "vyl-semaron",
            line: 11n,
            column: 1n,
        },
        {
            owner: owner("upper"),
            kind: "span",
            lang: "en-GB",
            tag: "en-GB",
            font: null,
            map: null,
            line: 9n,
            column: 15n,
        },
        {
            owner: owner("upper"),
            kind: "span",
            lang: "La",
            tag: "La",
            font: null,
            map: null,
            line: 9n,
            column: 51n,
        },
        {
            owner: owner("upper"),
            kind: "block",
            lang: "vyl",
            tag: "art-x-vyl",
            font: "Semaron-Kuriale",
            map: null,
            line: 11n,
            column: 1n,
        },
    ];
}

const ORDER = 'ORDER BY owner, line, "column"';

describe("the runs relation", () => {
    it("records each note's runs, at their file positions, as a derived key", () => {
        const records = tree();
        const upper = records.find((record) => record.shortcode === "upper")!;
        expect(upper.runs).toEqual([
            {
                kind: "span",
                lang: "en-GB",
                tag: "en-GB",
                font: null,
                map: null,
                line: 9,
                column: 15,
            },
            { kind: "span", lang: "La", tag: "La", font: null, map: null, line: 9, column: 51 },
            {
                kind: "block",
                lang: "vyl",
                tag: "art-x-vyl",
                font: "Semaron-Kuriale",
                map: null,
                line: 11,
                column: 1,
            },
        ]);
        expect(authoredFrontmatter(upper)).not.toHaveProperty("runs");
        expect(records.find((record) => record.shortcode === "vylari")!.runs).toEqual([]);
    });

    it("keeps values that differ only in case as rows, in local, dependency and stub-inclusive relations", async () => {
        const records = tree();
        const root = roots[0];
        const file = path.join(root, "elder-metadata.jsonl");
        fs.writeFileSync(file, serializeContentIndex(tree("elder")));
        const db = await openNotesDatabase(records, {
            dir: path.join(root, "db"),
            dependencies: [{ id: "elder", file }],
        });
        try {
            for (const [relation, contentPackage] of [
                ["runs", "demo"],
                ["elder.runs", "elder"],
                ["__with_stubs.runs", "demo"],
            ]) {
                const schema = await db.query(`DESCRIBE ${relation}`);
                expect(
                    schema.rows.map(({ column_name, column_type }: any) => ({
                        column_name,
                        column_type,
                    })),
                    relation,
                ).toEqual(COLUMNS);
                expect((await db.query(`SELECT * FROM ${relation} ${ORDER}`)).rows).toEqual(
                    rows(contentPackage),
                );
            }
            // The notes themselves still read, with their runs a list of one
            // fixed struct: no value became a key.
            const runsType = (await db.query("DESCRIBE entries")).rows.find(
                (row: any) => row.column_name === "runs",
            ).column_type;
            expect(runsType).toBe(
                'STRUCT("column" BIGINT, font VARCHAR, kind VARCHAR, lang VARCHAR, line BIGINT, "map" VARCHAR, tag VARCHAR)[]',
            );
            expect(
                (
                    await db.query(
                        "SELECT count(*) AS n FROM runs WHERE lower(tag) IN ('en-gb', 'la')",
                    )
                ).rows,
            ).toEqual([{ n: 4n }]);
        } finally {
            await db.close();
        }
    });

    it("leaves out a GM note's runs on a public surface", async () => {
        const records = tree();
        const db = await openNotesDatabase(records, { audience: "public" });
        try {
            expect((await db.query(`SELECT * FROM runs ${ORDER}`)).rows).toEqual(
                rows("demo", "public"),
            );
        } finally {
            await db.close();
        }
    });

    it("has its typed columns when nothing is marked", async () => {
        expect(RUN_COLUMNS).toEqual(COLUMNS.map(({ column_name }) => column_name));
        expect(runsRows([{ address: null, runs: [] }])).toEqual([]);
        const db = await openNotesDatabase([]);
        try {
            const schema = await db.query("DESCRIBE runs");
            expect(
                schema.rows.map(({ column_name, column_type }: any) => ({
                    column_name,
                    column_type,
                })),
            ).toEqual(COLUMNS);
        } finally {
            await db.close();
        }
    });
});
