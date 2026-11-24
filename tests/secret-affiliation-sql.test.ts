/*
 * Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCompileCorpus } from "../engine/compile-corpus.mjs";
import { emitContentIndex, prepareContentIndex } from "../engine/content-index.mjs";
import { expandContentTables } from "../engine/content-tables.mjs";
import { foundryIdentities } from "../engine/foundry-entries.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import { prepareTreeSqlTables } from "../engine/sql-tables.mjs";

let root: string;
let config: any;
let corpus: any;
let publicTables: any;
let allTables: any;
const file = (name: string) => path.join(config.paths.content, `${name}.md`);
const expanded = (name: string, tables: Map<string, any>) =>
    expandContentTables(corpus.parsed.get(file(name)).body, { sqlTables: tables.get(file(name)) })
        .markdown;

beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "secret-affiliation-sql-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "demo", version: "1.0.0" }),
    );
    config = configFromData(
        {
            contentPackage: "demo",
            packageKind: "modules",
            compatibility: { minimum: "14", verified: "14.367" },
            stats: { lastModifiedBy: "secretaffiliat0" },
            itemBuilders: ["sohl"],
            systems: { sohl: { compatibility: { verified: "0.9.0" } } },
            packs: [
                { name: "items", type: "Item", system: "sohl", default: true },
                { name: "journals", type: "JournalEntry", default: true },
                { name: "gm-journals", type: "JournalEntry", private: true },
            ],
        },
        path.join(root, "package-build.config.yaml"),
    );
    fs.mkdirSync(config.paths.content, { recursive: true });
    const notes: Record<string, [object, string]> = {
        Crown: [
            {
                type: "affiliation",
                subType: "polity",
                shortcode: "crown",
                name: { full: "The Crown" },
                data: {
                    glossary: [{ name: "Spymaster" }],
                    governance: {
                        ranks: [{ level: 1, title: "Subject", description: "Of the realm." }],
                        offices: { Spymaster: "Keeps the secrets." },
                    },
                },
            },
            "Authored prose.",
        ],
        Mara: [
            {
                type: "being",
                subType: "npc",
                shortcode: "mara",
                name: { full: "Mara" },
                data: {
                    archetypes: ["Ruler"],
                    affiliations: { crown: { rank: 1, office: "Spymaster", secret: true } },
                },
            },
            "Authored prose.",
        ],
        Report: [
            { type: "lore", subType: "history", shortcode: "report", name: { full: "Report" } },
            "```sql\nSELECT name, usage FROM terms WHERE owner = 'demo-note-affiliation-crown'\n```\n\n" +
                "```sql\nSELECT shortcode, to_json(data) AS body FROM notes WHERE type = 'being'\n```",
        ],
    };
    for (const [name, [fm, body]] of Object.entries(notes))
        fs.writeFileSync(file(name), `---\n${YAML.stringify(fm)}---\n\n${body}\n`);
    corpus = await buildCompileCorpus({
        contentBase: config.paths.content,
        skipDirectories: [],
        config,
        router: foundryIdentities(config).packRouter,
    });
    const tables = (audience: string) =>
        prepareTreeSqlTables(config.paths.content, {
            config,
            records: corpus.records,
            parsed: corpus.parsed,
            audience,
            foreignIndex: new Map(),
        });
    publicTables = await tables("public");
    allTables = await tables("all");
}, 60_000);

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("a secret affiliation in the SQL relations and datafiles", () => {
    it("is not cited by the public terms relation, and is by the complete one", () => {
        expect(expanded("Report", publicTables)).not.toContain("demo-note-being-mara");
        expect(expanded("Report", allTables)).toContain("demo-note-being-mara");
    });

    it("is absent from the public notes relation's affiliations, and kept by the complete one", () => {
        expect(expanded("Report", publicTables)).not.toContain('Spymaster"');
        expect(expanded("Report", allTables)).toContain("secret");
    });

    it("is not cited by the terms datafile beside the published index", async () => {
        const out = path.join(root, "index-out");
        const publication = await prepareContentIndex({
            config,
            contentBase: config.paths.content,
        });
        emitContentIndex({ config, publication, outDir: out });
        const terms = fs.readFileSync(path.join(out, "demo-terms.jsonl"), "utf8");
        expect(terms).toContain("Spymaster");
        expect(terms).not.toContain("demo-note-being-mara");
        expect(fs.readFileSync(path.join(out, "demo-dictionary.jsonl"), "utf8")).not.toContain(
            "demo-note-being-mara",
        );
    });
});
