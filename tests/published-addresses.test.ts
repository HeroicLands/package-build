/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **The published index writes every Address as `{ address, anchor,
 * anchorKind }`, and the SQL tables read each one back as the string an author
 * writes.** The fixture names every Address position the vocabulary declares,
 * each written in full; the emitted records are then walked, so a position the
 * writer misses is found by what it left behind rather than by a list of
 * fields kept here.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import { describe, expect, it } from "vitest";

import { readCanonicalKey } from "../engine/address.mjs";
import { PUBLISHED_ADDRESS_KEYS } from "../engine/address-values.mjs";
import { collectContentIndex, serializeContentIndex } from "../engine/content-index.mjs";
import { addressPositions } from "../engine/note-addresses.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { openNotesDatabase, runSqlQuery } from "../engine/sql-tables.mjs";

const PACKAGE = "demo";

/** Write a note whose frontmatter is `fm` into `dir`. */
function write(dir: string, rel: string, fm: object, body = "Prose.\n") {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `---\n${YAML.stringify(fm)}---\n\n${body}`);
}

/** Parse an emitted index. */
function published(records: object[]) {
    return serializeContentIndex(records as any)
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

/**
 * Every place in a record a published Address breaks the form: a map carrying
 * `address` that is not exactly the published Address, or a string that reads
 * as a canonical Address, with or without an anchor, left unwritten.
 */
function violations(value: unknown, at: string[] = []): string[] {
    if (typeof value === "string") {
        const [address] = value.split("#");
        const tuple = readCanonicalKey(address);
        return tuple && (tuple as any).package === PACKAGE ? [`${at.join(".")}: ${value}`] : [];
    }
    if (Array.isArray(value))
        return value.flatMap((entry, i) => violations(entry, [...at, String(i)]));
    if (!value || typeof value !== "object") return [];
    const out: string[] = [];
    if (typeof (value as any).address === "string") {
        const keys = Object.keys(value).sort();
        if (JSON.stringify(keys) !== JSON.stringify([...PUBLISHED_ADDRESS_KEYS].sort()))
            out.push(`${at.join(".")}: keys ${keys.join(", ")}`);
        if (!readCanonicalKey((value as any).address))
            out.push(`${at.join(".")}: ${(value as any).address} is not canonical`);
        return out;
    }
    for (const [key, entry] of Object.entries(value)) {
        // A map keyed by Address keeps string keys; its keys are not values.
        out.push(...violations(entry, [...at, key]));
    }
    return out;
}

/** A note of `type` naming every Address position it declares, each in full. */
function specimen(type: string) {
    const fm: any = { type, shortcode: `every${type}`, name: { full: `Every ${type}` } };
    let named = 0;
    for (const p of addressPositions({ type })) {
        if (p.path[0] !== "data" || p.shape === "keys" || p.shape === "keys-or-list") continue;
        const target = (p as any).type ?? (p as any).accepts?.[0] ?? "lore";
        const anchor = (p as any).anchors ? "#sample" : "";
        const text = `${PACKAGE}-note-${target}-sample${anchor}`;
        let owner = fm;
        p.path.forEach((part, index) => {
            const key = part === "*" ? 0 : part;
            const last = index === p.path.length - 1;
            if (last) {
                owner[key] =
                    p.shape === "list" ? [text]
                    : p.shape === "scalar-or-map" ? text
                    : text;
            } else {
                const next = p.path[index + 1] === "*" ? [] : {};
                owner[key] = owner[key] ?? next;
                if (p.path[index + 1] === "*" && owner[key].length === 0) owner[key].push({});
                owner = p.path[index + 1] === "*" ? owner[key] : owner[key];
            }
        });
        named++;
    }
    return { fm, named };
}

describe("the published index writes every Address as an object", () => {
    it("leaves no Address of any declared position as a string, and none malformed", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "published-addresses-"));
        try {
            let named = 0;
            for (const type of Object.keys(NOTE_VOCABULARY)) {
                const one = specimen(type);
                if (!one.named) continue;
                named += one.named;
                write(dir, `${type}.md`, one.fm, "# Overview {#overview}\n\nProse.\n");
            }
            expect(named).toBeGreaterThan(30);
            const records = published(
                collectContentIndex(dir, { contentPackage: PACKAGE, skipDirectories: [] }),
            );
            expect(records.length).toBeGreaterThan(5);
            const found = records.flatMap((record) =>
                violations(record, [record.file?.path ?? "?"]),
            );
            expect(found).toEqual([]);
            const objects = JSON.stringify(records).match(/"anchorKind"/g) ?? [];
            expect(objects.length).toBeGreaterThan(named);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("the SQL tables present every Address as a string", () => {
    it("matches a fence comparing Address strings against a dependency's published index", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "published-sql-"));
        try {
            const tree = path.join(dir, "content");
            write(tree, "Council.md", {
                type: "affiliation",
                subType: "polity",
                shortcode: "council",
                name: { full: "Council" },
            });
            write(tree, "Region.md", {
                type: "place",
                subType: "region",
                shortcode: "region",
                name: { full: "Region" },
            });
            write(tree, "Town.md", {
                type: "place",
                subType: "settlement",
                shortcode: "town",
                name: { full: "Town" },
                data: { parents: ["region"], government: "affiliation-council" },
            });
            const file = path.join(dir, `${PACKAGE}-metadata.jsonl`);
            fs.writeFileSync(
                file,
                serializeContentIndex(
                    collectContentIndex(tree, { contentPackage: PACKAGE, skipDirectories: [] }),
                ),
            );
            const town = JSON.parse(
                fs
                    .readFileSync(file, "utf8")
                    .split("\n")
                    .find((line) => line.includes('"shortcode":"town"')) as string,
            );
            expect(town.data.government).toEqual({
                address: "demo-note-affiliation-council",
                anchor: null,
                anchorKind: null,
            });

            const db = await openNotesDatabase([], {
                dir: path.join(dir, "db"),
                dependencies: [{ id: PACKAGE, file }],
            });
            try {
                const parents = await runSqlQuery(
                    db,
                    `SELECT shortcode FROM ${PACKAGE}.notes WHERE list_contains(data.parents, 'demo-note-place-region')`,
                );
                expect(parents.rows.map((row: any) => row.shortcode)).toEqual(["town"]);
                const governed = await runSqlQuery(
                    db,
                    `SELECT shortcode FROM ${PACKAGE}.notes WHERE data.government = 'demo-note-affiliation-council'`,
                );
                expect(governed.rows.map((row: any) => row.shortcode)).toEqual(["town"]);
                const canonical = await runSqlQuery(
                    db,
                    `SELECT address.canonical AS c FROM ${PACKAGE}.notes WHERE shortcode = 'town'`,
                );
                expect(canonical.rows[0].c).toBe("demo-note-place-town");
            } finally {
                await db.close();
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
