/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **The `dictionary` and `terms` relations are each a datafile of JSON Lines**,
 * written beside the content index: sorted, keys sorted at every depth, and
 * byte-identical between two builds of an unchanged tree.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectContentIndex, emitContentIndex } from "../engine/content-index.mjs";
import { openNotesDatabase, runSqlQuery } from "../engine/sql-tables.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TREE = path.join(HERE, "fixtures", "dictionary", "tree");

let dir: string;
const config = () =>
    ({
        paths: { content: TREE, contentIndex: path.join(dir, "out") },
        contentPackage: "demo",
        skipDirectories: [],
        packs: [{ name: "items", type: "Item" }],
    }) as any;

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dictionary-datafile-"));
});

afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

/** Every key of a value, at every depth, in the order the text holds them. */
function keyOrders(value: unknown, out: string[][] = []): string[][] {
    if (Array.isArray(value)) value.forEach((item) => keyOrders(item, out));
    else if (value && typeof value === "object") {
        out.push(Object.keys(value));
        Object.values(value).forEach((item) => keyOrders(item, out));
    }
    return out;
}

/** Rows of a datafile, and the key each one is sorted by. */
function read(file: string, key: (row: any) => string[]) {
    const rows = fs
        .readFileSync(file, "utf8")
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line));
    return { rows, order: rows.map(key) };
}

const lexical = (a: string[], b: string[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
};

const FILES = [
    {
        relation: "dictionary",
        name: "demo-dictionary.jsonl",
        key: (row: any) => [row.language ?? "", row.name_sort, row.name],
    },
    {
        relation: "terms",
        name: "demo-terms.jsonl",
        key: (row: any) => [row.owner, row.name_sort, row.name],
    },
] as const;

describe("the datafiles", () => {
    it("are written beside the index, one per relation", () => {
        const result = emitContentIndex({ config: config() });
        for (const { relation, name } of FILES) {
            const written = (result as any)[relation];
            expect(written.file).toBe(path.join(dir, "out", name));
            expect(fs.existsSync(written.file)).toBe(true);
            expect(written.rows).toBeGreaterThan(0);
        }
    });

    it("are byte-identical over two builds", () => {
        const first = emitContentIndex({ config: config() });
        const before = FILES.map(({ relation }) =>
            fs.readFileSync((first as any)[relation].file, "utf8"),
        );
        const second = emitContentIndex({ config: config() });
        const after = FILES.map(({ relation }) =>
            fs.readFileSync((second as any)[relation].file, "utf8"),
        );
        expect(after).toEqual(before);
        for (const text of before) expect(text.endsWith("\n")).toBe(true);
    });

    it("hold each relation's rows, sorted, with every key sorted", async () => {
        const result = emitContentIndex({ config: config() });
        const db = await openNotesDatabase(
            collectContentIndex(TREE, { contentPackage: "demo", skipDirectories: [] }),
            { dir: path.join(dir, "db") },
        );
        try {
            for (const { relation, key } of FILES) {
                const { rows, order } = read((result as any)[relation].file, key);
                expect(rows).toHaveLength((result as any)[relation].rows);
                expect(order).toEqual([...order].sort(lexical));
                for (const keys of rows.flatMap((row) => keyOrders(row)))
                    expect(keys).toEqual([...keys].sort());
                const counted = await runSqlQuery(db, `SELECT count(*) AS n FROM ${relation}`);
                expect(Number(counted.rows[0].n), relation).toBe(rows.length);
            }
        } finally {
            await db.close();
        }
    });
});
