/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { indexRecordsFor } from "../engine/content-index.mjs";
import { encodeAddresses } from "../engine/address-values.mjs";
import YAML from "yaml";
import { configFromData } from "../engine/pack-config.mjs";
import {
    openNotesDatabase,
    prepareLinkSqlTables,
    prepareTreeSqlTables,
    runSqlQuery,
} from "../engine/sql-tables.mjs";
import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";

const CLI = path.resolve(__dirname, "../bin/package-build.mjs");
const DICTIONARY =
    "```sql {layout=dictionary key=false}\nSELECT * FROM dictionary WHERE language = 'demo-note-skill-tongue'\n```\n";
let root: string;
let content: string;
const note = (shortcode: string, body: string, tags = "") =>
    `---\nname: {full: ${shortcode}}\nshortcode: ${shortcode}\ntype: lore\nsubType: history\n${tags ? `tags: [${tags}]\n` : ""}---\n\n${body}\n`;
function write(file: string, text: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "dictionary-audience-"));
    content = path.join(root, "assets/content");
    write(path.join(root, "package.json"), JSON.stringify({ name: "demo", version: "1.0.0" }));
    write(
        path.join(root, "package-build.config.yaml"),
        `contentPackage: demo
packageKind: modules
compatibility: {minimum: "14.359", verified: "14.359"}
stats: {lastModifiedBy: preflightbuild00}
packs: [{name: journals, type: JournalEntry, default: true}]
publish: {}
pdf: {books: [{id: core, title: Demo, document: book.yaml}]}
`,
    );
    write(
        path.join(content, "Language.md"),
        `---
name: {full: Tongue}
shortcode: tongue
type: skill
subType: language
data:
  fields: [{name: Court, holds: The court.}]
  words: [{form: mira, class: n, field: Court, gloss: a judge}]
---

${DICTIONARY}`,
    );
    write(path.join(content, "Secret.md"), note("secret", "The _mira_ knows.", "gm"));
    write(path.join(content, "Open.md"), note("open", "A _mira_ serves."));
    write(path.join(content, "GmDictionary.md"), note("gmdictionary", DICTIONARY, "gm"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function corpus() {
    const config = configFromData(
        YAML.parse(fs.readFileSync(path.join(root, "package-build.config.yaml"), "utf8")),
        path.join(root, "package-build.config.yaml"),
    );
    const parsed = new Map();
    const records = indexRecordsFor({ contentBase: content, config, skipDirectories: [], parsed });
    return { config, parsed, records };
}
function links() {
    const result = spawnSync(process.execPath, [CLI, "links"], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml") },
    });
    return { status: result.status, output: result.stdout + result.stderr };
}
describe("dictionary citation audiences", () => {
    it(
        "checks public dictionary citations without rejecting a GM note's marked use",
        () => {
            const result = links();
            expect(result.status, result.output).toBe(0);
            expect(result.output).not.toContain("GM-only note from a player-facing note");
        },
        SUBPROCESS_TEST_TIMEOUT,
    );
    it(
        "still rejects authored public links to hidden and unknown notes",
        () => {
            write(
                path.join(content, "Authored.md"),
                note("authored", "[[lore-secret|Secret]] and [[lore-missing|Missing]]."),
            );
            const result = links();
            expect(result.status, result.output).toBe(1);
            expect(result.output).toContain("GM-only note from a player-facing note");
            expect(result.output).toContain("lore-missing");
        },
        SUBPROCESS_TEST_TIMEOUT,
    );
    it("prepares public output without hidden citation labels and keeps complete raw citations", async () => {
        const options = corpus();
        const before = encodeAddresses(
            options.records.find((record: any) => record.shortcode === "tongue").citations,
        );
        const publicTables: any = await prepareTreeSqlTables(content, {
            ...options,
            audience: "public",
        });
        const markdown = publicTables.get(path.join(content, "Language.md"))[0].markdown;
        expect(markdown).toContain("demo-note-lore-open");
        expect(markdown).not.toContain("secret");
        expect(publicTables.has(path.join(content, "GmDictionary.md"))).toBe(false);
        expect(
            encodeAddresses(
                options.records.find((record: any) => record.shortcode === "tongue").citations,
            ),
        ).toEqual(before);
        expect(before[0].notes).toContain("demo-note-lore-secret");
        const gmTables: any = await prepareTreeSqlTables(content, { ...options, audience: "all" });
        expect(gmTables.get(path.join(content, "GmDictionary.md"))[0].markdown).toContain(
            "[[demo-note-lore-secret|",
        );
    });
    it("keeps identical queries separate for public and GM source audiences", async () => {
        const prepared: any = await prepareLinkSqlTables(content, corpus());
        expect(prepared.get(path.join(content, "Language.md"))[0].markdown).not.toContain("secret");
        expect(prepared.get(path.join(content, "GmDictionary.md"))[0].markdown).toContain(
            "[[demo-note-lore-secret|",
        );
    });
    it("prepares inline-only queries in each source's audience", async () => {
        const query = "SELECT count(*) FROM notes";
        const body = `Count: {{sql "${query}"}}.`;
        write(path.join(content, "Language.md"), note("inlinepublic", body));
        write(path.join(content, "GmDictionary.md"), note("inlinegm", body, "gm"));
        const prepared: any = await prepareLinkSqlTables(content, corpus());
        expect(prepared?.inline?.get(path.join(content, "Language.md"))?.get(query)).toEqual({
            value: 2n,
        });
        expect(prepared?.inline?.get(path.join(content, "GmDictionary.md"))?.get(query)).toEqual({
            value: 4n,
        });
    });
    it("retains unknown citations in public rows without pretending they resolve", async () => {
        const options = corpus();
        const { records } = options;
        records
            .find((record: any) => record.shortcode === "tongue")
            .citations[0].notes.push("demo-note-lore-missing");
        const db = await openNotesDatabase(records, { audience: "public" });
        try {
            const result = await runSqlQuery(db, "SELECT attested FROM words WHERE form = 'mira'");
            expect(result.rows[0].attested).toEqual([
                "demo-note-lore-open",
                "demo-note-lore-missing",
            ]);
        } finally {
            await db.close();
        }
        const prepared: any = await prepareTreeSqlTables(content, {
            ...options,
            audience: "public",
        });
        const markdown = prepared.get(path.join(content, "Language.md"))[0].markdown;
        expect(markdown).toContain("demo-note-lore-missing");
        expect(markdown).not.toContain("[[demo-note-lore-missing");
    });
});
