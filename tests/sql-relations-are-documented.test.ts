/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **Every relation the database holds is in the authoring guide's relations
 * table and in the format reference.** The relations are read from the open
 * database, so a relation added to the engine and left undocumented fails here.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectContentIndex } from "../engine/content-index.mjs";
import { openNotesDatabase, runSqlQuery } from "../engine/sql-tables.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const TREE = path.join(HERE, "fixtures", "dictionary", "tree");
const GUIDE = fs.readFileSync(path.join(ROOT, "docs/authoring/links-and-markup.md"), "utf8");
const DETAILS = fs.readFileSync(path.join(ROOT, "docs/reference/format-details.md"), "utf8");

let dir: string;
let db: any;
let relations: string[];

beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "relations-documented-"));
    const records = collectContentIndex(TREE, { contentPackage: "demo", skipDirectories: [] });
    db = await openNotesDatabase(records, { dir: path.join(dir, "db") });
    const result = await runSqlQuery(
        db,
        "SELECT table_name AS name FROM duckdb_tables() WHERE schema_name = 'main' AND NOT internal " +
            "UNION SELECT view_name FROM duckdb_views() WHERE schema_name = 'main' AND NOT internal " +
            "ORDER BY name",
    );
    relations = result.rows.map((row: any) => String(row.name));
}, 60_000);

afterAll(async () => {
    await db?.close();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("the relations a query can read", () => {
    it("include the ones this guard exists to watch", () => {
        expect(relations).toEqual(
            expect.arrayContaining([
                "notes",
                "entries",
                "words",
                "affixes",
                "fields",
                "register",
                "retired",
                "tongues",
                "scope",
                "letters",
                "edges",
                "clusters",
                "stress",
                "finals",
                "syllables",
                "joining",
                "joins",
                "marks",
                "skeleton",
                "frames",
                "calling_names",
                "read_past",
                "sound_changes",
                "elements",
                "roots",
                "cognates",
                "mutations",
                "cluster_groups",
                "older",
                "negation",
                "name_shapes",
                "name_edges",
                "name_draws",
                "held_from",
                "near_names",
            ]),
        );
    });

    it("are each a row of the relations table in the authoring guide", () => {
        const table = GUIDE.slice(
            GUIDE.indexOf("### What a query can read"),
            GUIDE.indexOf("### Sections the build adds"),
        );
        for (const name of relations)
            expect(table, `\`${name}\` is not in the relations table`).toMatch(
                new RegExp(`^\\| \`${name}\` `, "m"),
            );
    });

    it("are each named in the dependency row, apart from the market scale", () => {
        const row = GUIDE.split("\n").find((line) => line.startsWith("| `<package>.notes`"))!;
        for (const name of relations.filter((one) => one !== "market"))
            expect(row, `\`${name}\` is not in the dependency row`).toContain(`\`${name}\``);
    });

    it("are each named in the format reference", () => {
        for (const name of relations)
            expect(DETAILS, `\`${name}\` is not named in the reference`).toContain(`\`${name}\``);
    });
});
