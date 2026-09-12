/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A dependency's index is a schema you can query**.
 *
 * A satellite tabulating what it *depends on* — thalorna listing SoHL's skills —
 * had no way to say so. The proposal was a fence property naming a file
 * (`:db package.jsonl`), which puts a build artifact's path into authored
 * content: rename the artifact and the corpus needs sweeping, which is the
 * coupling #126 is a 4,051-key sweep to undo.
 *
 * Which dataset a query reads is what SQL's `FROM` is for, and the design
 * already draws that line — `_ref` and `_section` are ordinary SQL precisely
 * because they belong in the query, "where an author is already looking". So
 * each declared dependency becomes a **schema**, and its notes are
 * `<package>.notes`.
 *
 * It costs no fetch: every dependency's JSONL is already in the metadata cache
 * at compile time, because resolving addresses across packages needs it.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openNotesDatabase, runSqlQuery } from "../engine/sql-tables.mjs";

/** This package's own notes. */
const OWN = [
    {
        type: "being",
        shortcode: "aldric",
        package: "thalorna",
        name: { full: "Sir Aldric" },
        address: { canonical: "thalorna-being-aldric", slug: "being-aldric" },
        sohl: { kbcat: "knights" },
    },
];

/** A dependency's notes, as its published index carries them. */
const DEP = [
    {
        type: "skill",
        shortcode: "clmb",
        package: "sohl",
        name: { full: "Climbing" },
        address: { canonical: "sohl-skill-clmb", slug: "skill-clmb" },
        sohl: { skillBase: "str" },
    },
    {
        type: "skill",
        shortcode: "swim",
        package: "sohl",
        name: { full: "Swimming" },
        address: { canonical: "sohl-skill-swim", slug: "skill-swim" },
        sohl: { skillBase: "agl" },
    },
];

let dir: string;
let db: any;

beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sql-deps-"));
    const file = path.join(dir, "sohl-metadata.jsonl");
    fs.writeFileSync(file, DEP.map((r) => JSON.stringify(r)).join("\n"));
    db = await openNotesDatabase(OWN, { dir, dependencies: [{ id: "sohl", file }] });
});

afterAll(async () => {
    await db?.close();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("a dependency's notes are queryable as its own schema", () => {
    it("keeps this package's notes at the unqualified `notes`", async () => {
        const result = await runSqlQuery(db, `SELECT name.full AS "Name" FROM notes`);
        expect(result.rows.map((r: any) => r.Name)).toEqual(["Sir Aldric"]);
    });

    it("reads a dependency's notes at `<package>.notes`", async () => {
        const result = await runSqlQuery(
            db,
            `SELECT name.full AS "Name" FROM sohl.notes WHERE type = 'skill' ORDER BY shortcode`,
        );
        expect(result.rows.map((r: any) => r.Name)).toEqual(["Climbing", "Swimming"]);
    });

    it("reads a dependency's nested fields exactly as that package authors them", async () => {
        const result = await runSqlQuery(
            db,
            `SELECT sohl.skillBase AS "Base" FROM sohl.notes WHERE shortcode = 'clmb'`,
        );
        expect(result.rows[0].Base).toBe("str");
    });

    it("joins this package's notes against a dependency's", async () => {
        // The thing the fence property could never have expressed: one query
        // over both datasets.
        const result = await runSqlQuery(
            db,
            `SELECT n.name.full AS "Mine", d.name.full AS "Theirs"
             FROM notes n, sohl.notes d WHERE d.shortcode = 'clmb'`,
        );
        expect(result.rows).toEqual([{ Mine: "Sir Aldric", Theirs: "Climbing" }]);
    });

    it("opens without a dependency, as a package with none does", async () => {
        const solo = await openNotesDatabase(OWN);
        try {
            const result = await runSqlQuery(solo, `SELECT count(*) AS "N" FROM notes`);
            expect(Number(result.rows[0].N)).toBe(1);
        } finally {
            await solo.close();
        }
    });
});
