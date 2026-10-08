/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **`events` is one row per `data.events` entry**, across every type that
 * carries events, in this package's database and in each dependency's schema.
 * The expected count is derived from the records themselves, so a type the
 * view misses is found by the count it leaves short.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectContentIndex, serializeContentIndex } from "../engine/content-index.mjs";
import { EVENT_ENTRY_KEYS } from "../engine/note-events.mjs";
import { EVENTS_FIELD, NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { openNotesDatabase, prepareSqlTables, runSqlQuery } from "../engine/sql-tables.mjs";

/** Write a note whose frontmatter is `fm` into `dir`. */
function write(dir: string, rel: string, fm: object, body = "Prose.\n") {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `---\n${YAML.stringify(fm)}---\n\n${body}`);
}

/** The number of event entries a set of index records carries. */
const entryCount = (records: any[]) =>
    records.reduce(
        (sum, record) => sum + (Array.isArray(record.data?.events) ? record.data.events.length : 0),
        0,
    );

let dir: string;
let local: any[];
let dependency: any[];
let db: any;

beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sql-events-"));
    const own = path.join(dir, "own");
    write(own, "Founding.md", {
        type: "lore",
        shortcode: "founding",
        name: { full: "The Founding" },
        data: { events: [{ when: 100, kind: "founding", summary: "The city is founded." }] },
    });
    write(own, "Ironfells.md", {
        type: "place",
        subType: "settlement",
        shortcode: "ironfells",
        name: { full: "Ironfells" },
        data: {
            events: [
                { id: "raising", when: 120, kind: "raising", summary: "Ironfells is raised." },
                {
                    id: "sack",
                    when: "~280",
                    until: 281,
                    kind: "siege",
                    depth: "region",
                    summary: "Ironfells is sacked.",
                    names: [{ name: "The Burning", by: "place-ironfells" }],
                    where: { locus: ["ironfells"] },
                    who: [{ ref: "affiliation-council", role: "victim" }],
                    follows: [{ event: "place-ironfells#raising", how: "enabled" }],
                },
            ],
        },
    });
    write(own, "Council.md", {
        type: "affiliation",
        subType: "polity",
        shortcode: "council",
        name: { full: "Council" },
        data: {
            events: [{ id: "founding", when: 150, kind: "founding", summary: "The council sits." }],
        },
    });
    write(own, "Secret.md", {
        type: "lore",
        shortcode: "secret",
        name: { full: "Secret" },
        tags: ["gm"],
        data: { events: [{ when: 90, kind: "law", summary: "A law nobody tells of." }] },
    });
    write(own, "Aldric.md", {
        type: "being",
        subType: "npc",
        shortcode: "aldric",
        name: { full: "Aldric" },
    });

    const theirs = path.join(dir, "theirs");
    write(theirs, "Elder.md", {
        type: "place",
        subType: "settlement",
        shortcode: "elder",
        name: { full: "Elder" },
        data: { events: [{ id: "first", when: 50, kind: "raising", summary: "Elder rises." }] },
    });

    local = collectContentIndex(own, { contentPackage: "demo", skipDirectories: [] });
    dependency = collectContentIndex(theirs, { contentPackage: "elder", skipDirectories: [] });
    const file = path.join(dir, "elder-metadata.jsonl");
    fs.writeFileSync(file, serializeContentIndex(dependency));
    db = await openNotesDatabase(local, {
        dir: path.join(dir, "db"),
        dependencies: [{ id: "elder", file }],
    });
}, 60_000);

afterAll(async () => {
    await db?.close();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("the `events` relation", () => {
    it("draws on every type that declares `events`", () => {
        const carrying = Object.entries(NOTE_VOCABULARY)
            .filter(([, spec]: [string, any]) => (spec.data ?? []).includes(EVENTS_FIELD))
            .map(([type]) => type)
            .sort();
        const fixture = [...new Set(local.filter((r) => r.data?.events).map((r) => r.type))].sort();
        expect(fixture).toEqual(carrying);
    });

    it("holds one row per event entry in this package", async () => {
        const result = await runSqlQuery(db, "SELECT count(*) AS n FROM events");
        expect(Number(result.rows[0].n)).toBe(entryCount(local));
    });

    it("holds one row per event entry in a dependency's schema", async () => {
        const result = await runSqlQuery(db, "SELECT count(*) AS n FROM elder.events");
        expect(Number(result.rows[0].n)).toBe(entryCount(dependency));
        expect(entryCount(dependency)).toBeGreaterThan(0);
    });

    it("leaves out a GM note's events on a public surface", async () => {
        const pub = await openNotesDatabase(local, {
            dir: path.join(dir, "db-public"),
            audience: "public",
        });
        try {
            const result = await runSqlQuery(pub, "SELECT count(*) AS n FROM events");
            expect(Number(result.rows[0].n)).toBe(entryCount(local) - 1);
        } finally {
            await pub.close();
        }
    });

    it("orders by date without reparsing one", async () => {
        const result = await runSqlQuery(
            db,
            "SELECT address, whenYear FROM events ORDER BY whenSort, address",
        );
        expect(result.rows.map((row: any) => row.address)).toEqual([
            "demo-note-lore-secret",
            "demo-note-lore-founding",
            "demo-note-place-ironfells#raising",
            "demo-sohl-affiliation-council#founding",
            "demo-note-place-ironfells#sack",
        ]);
        expect(result.rows.map((row: any) => Number(row.whenYear))).toEqual([
            90, 100, 120, 150, 280,
        ]);
    });

    it("orders a dependency's events with this package's", async () => {
        const result = await runSqlQuery(
            db,
            "SELECT address FROM (SELECT * FROM events UNION ALL BY NAME SELECT * FROM elder.events) " +
                "ORDER BY whenSort LIMIT 2",
        );
        expect(result.rows.map((row: any) => row.address)).toEqual([
            "elder-note-place-elder#first",
            "demo-note-lore-secret",
        ]);
    });

    it("carries the owning note, the id and every event key as its own column", async () => {
        const result = await runSqlQuery(db, "SELECT * FROM events WHERE id = 'sack'");
        expect(result.columns).toEqual(
            expect.arrayContaining([
                "note",
                "address",
                ...EVENT_ENTRY_KEYS,
                "whenSort",
                "whenYear",
                "untilSort",
                "untilYear",
            ]),
        );
        const sack = result.rows[0];
        expect(sack.note).toBe("demo-note-place-ironfells");
        expect(sack.address).toBe("demo-note-place-ironfells#sack");
        expect(sack.when).toBe("~280");
        expect(sack.until).toBe("281");
        expect(Number(sack.untilYear)).toBe(281);
        expect(sack.kind).toBe("siege");
        expect(sack.names).toEqual([{ name: "The Burning", by: "demo-note-place-ironfells" }]);
        expect(sack.where).toEqual({ locus: ["demo-note-place-ironfells"] });
        expect(sack.follows).toEqual([
            { event: "demo-note-place-ironfells#raising", how: "enabled" },
        ]);
    });

    it("answers a key no event writes as NULL rather than failing to bind", async () => {
        const result = await runSqlQuery(
            db,
            "SELECT count(*) AS n FROM events WHERE stated IS NULL AND accounts IS NULL",
        );
        expect(Number(result.rows[0].n)).toBe(entryCount(local));
    });

    it("renders a fence over events in date order", async () => {
        const body = [
            "```sql",
            'SELECT summary AS "Summary", "when" AS "When" FROM events ORDER BY whenSort',
            "```",
            "",
        ].join("\n");
        const prepared = await prepareSqlTables(db, [
            { source: "Chronicle.md", markdown: body, frontmatter: {} },
        ]);
        const [table] = prepared.get("Chronicle.md") as any;
        expect(table.reason).toBeUndefined();
        const rows = String(table.markdown)
            .split("\n")
            .filter((line) => /^\| [^-]/.test(line) && !line.startsWith("| Summary"));
        expect(rows.map((line) => line.split("|")[1].trim())).toEqual([
            "A law nobody tells of.",
            "The city is founded.",
            "Ironfells is raised.",
            "The council sits.",
            "Ironfells is sacked.",
        ]);
    });
});

describe("an empty corpus", () => {
    it("still has an `events` relation, with its columns", async () => {
        const empty = await openNotesDatabase([], { dir: path.join(dir, "db-empty") });
        try {
            const result = await runSqlQuery(
                empty,
                "SELECT note, address, id, kind, whenSort FROM events",
            );
            expect(result.rows).toEqual([]);
        } finally {
            await empty.close();
        }
    });
});
