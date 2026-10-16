/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indexRecordsFor } from "../engine/content-index.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import { openNotesDatabase, prepareTreeSqlTables, runSqlQuery } from "../engine/sql-tables.mjs";

const DAUGHTER = "demo-note-skill-daughter";
const GRANDPARENT = "demo-note-skill-grand";
const HIDDEN = "demo-note-skill-hidden";
const table =
    "```sql\nSELECT name, depth FROM dictionary WHERE language = 'demo-note-skill-daughter' ORDER BY name\n```";
const dictionary = (name: string) =>
    [
        "```sql {layout=dictionary key=false}",
        `SELECT * FROM dictionary WHERE language = '${DAUGHTER}' AND name = '${name}'`,
        "```",
    ].join("\n");
const language = (shortcode: string, data: string[], body = "A tongue.", gm = false) =>
    [
        "---",
        `shortcode: ${shortcode}`,
        `name: {full: ${shortcode}}`,
        "type: skill",
        "subType: language",
        ...(gm ? ["tags: [gm]"] : []),
        "data:",
        "  fields: [{name: Court, holds: Court words.}]",
        ...data.map((line) => `  ${line}`),
        "---",
        "",
        body,
        "",
    ].join("\n");

let root: string;
let content: string;
let daughter: string;
let config: ReturnType<typeof configFromData>;
beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "dictionary-ancestor-audience-"));
    content = path.join(root, "content");
    fs.mkdirSync(content);
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "demo", version: "1.0.0" }),
    );
    config = configFromData(
        {
            contentPackage: "demo",
            packageKind: "modules",
            compatibility: { minimum: "14.359", verified: "14.359" },
            stats: { lastModifiedBy: "preflightbuild00" },
            packs: [{ name: "journals", type: "JournalEntry", default: true }],
            publish: {},
        },
        path.join(root, "package-build.config.yaml"),
    );
    fs.writeFileSync(
        path.join(content, "Grand.md"),
        language("grand", [
            "abbreviation: Public.",
            "words: [{form: same, class: n, field: Court, gloss: public grandparent sense}]",
        ]),
    );
    fs.writeFileSync(
        path.join(content, "Hidden.md"),
        language(
            "hidden",
            [
                "abbreviation: SECRET.",
                "family: skill-grand",
                "words:",
                "  - {form: same, class: n, field: Court, gloss: SECRET parent sense}",
                "  - {form: privateonly, class: n, field: Court, gloss: SECRET private sense}",
                "affixes: [{form: -ending, gloss: an inherited ending}]",
                "elements: [{form: root, sense: an inherited element}]",
            ],
            "A hidden tongue.",
            true,
        ),
    );
    daughter = path.join(content, "Daughter.md");
    fs.writeFileSync(
        daughter,
        language(
            "daughter",
            [
                "family: skill-hidden",
                "words: [{form: joined, class: n, field: Court, gloss: a visible word, built: [root, -ending]}]",
            ],
            [table, dictionary("same"), dictionary("joined")].join("\n\n"),
        ),
    );
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("dictionary providers through a hidden ancestor", () => {
    it("prepares public SQL and dictionary prose from the visible grandparent's definition", async () => {
        const prepared: any = await prepareTreeSqlTables(content, {
            config,
            audience: "public",
            foreignIndex: new Map(),
            skipDirectories: [],
        });
        const tables = prepared.get(daughter);
        expect(tables).toHaveLength(3);
        expect(tables.every((one: any) => one.reason === undefined)).toBe(true);
        expect.soft(tables[0].markdown).toContain("| same | 2 |");
        expect.soft(tables[0].markdown).not.toContain("privateonly");
        expect.soft(tables[1].markdown).toContain("[Public. *_same_] Public grandparent sense.");
        expect.soft(tables.map((one: any) => one.markdown).join("\n")).not.toContain("SECRET");
    });

    it("selects the nearest parent definition and private inherited words for the complete audience", async () => {
        const prepared: any = await prepareTreeSqlTables(content, {
            config,
            audience: "all",
            foreignIndex: new Map(),
            skipDirectories: [],
        });
        const tables = prepared.get(daughter);
        expect(tables.every((one: any) => one.reason === undefined)).toBe(true);
        expect(tables[0].markdown).toContain("| same | 1 |");
        expect(tables[0].markdown).toContain("| privateonly | 1 |");
        expect(tables[1].markdown).toContain("[SECRET. *_same_] SECRET parent sense.");
    });

    it("retains hidden morphology context without using hidden words as public definition providers", async () => {
        const records = indexRecordsFor({ contentBase: content, config, skipDirectories: [] });
        const db = await openNotesDatabase(records, { audience: "public" });
        try {
            const result = await runSqlQuery(
                db,
                `SELECT name, depth, etymology FROM dictionary WHERE language = '${DAUGHTER}' ORDER BY name`,
            );
            expect(result.rows.map((row: any) => row.name)).toEqual(["joined", "same"]);
            expect(result.rows[1]).toMatchObject({
                depth: 2n,
                etymology: { kind: "inherited", language: GRANDPARENT },
            });
            const parts = [
                { form: "root", gloss: "an inherited element" },
                { form: "-ending", gloss: "an inherited ending" },
            ];
            expect(result.rows[0].etymology.parts).toEqual(parts);
            const words = await runSqlQuery(
                db,
                `SELECT built_parts FROM words WHERE language = '${DAUGHTER}'`,
            );
            expect(words.rows[0].built_parts).toEqual(parts);
            const lineage = await runSqlQuery(
                db,
                `SELECT ancestor FROM language_lineage WHERE language = '${DAUGHTER}' ORDER BY depth`,
            );
            expect(lineage.rows.map((row: any) => row.ancestor)).toEqual([
                DAUGHTER,
                HIDDEN,
                GRANDPARENT,
            ]);
        } finally {
            await db.close();
        }
        const prepared: any = await prepareTreeSqlTables(content, {
            config,
            audience: "public",
            foreignIndex: new Map(),
            skipDirectories: [],
        });
        const rendered = prepared.get(daughter)[2].markdown;
        expect(rendered).toContain("an inherited element");
        expect(rendered).toContain("an inherited ending");
    });
});
