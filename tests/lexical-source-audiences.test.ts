/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCompileCorpus } from "../engine/compile-corpus.mjs";
import { expandContentTables } from "../engine/content-tables.mjs";
import { foundryIdentities } from "../engine/foundry-entries.mjs";
import { insertLexicalSections, lexicalSectionsFor } from "../engine/lexical-sections.mjs";
import { isGmNote } from "../engine/note-vocabulary.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import { prepareTreeSqlTables } from "../engine/sql-tables.mjs";
import { encodeAddresses } from "../engine/address-values.mjs";

let root: string;
let config: any;
let corpus: any;
let publicTables: any;
const word = (form: string, gloss: string) => ({ form, class: "n", field: "Court", gloss });
const file = (name: string) => path.join(config.paths.content, `${name}.md`);
const expanded = (name: string, tables = corpus.sqlTables) =>
    expandContentTables(corpus.parsed.get(file(name)).body, { sqlTables: tables.get(file(name)) })
        .markdown;

beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lexical-source-audiences-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "demo", version: "1.0.0" }),
    );
    config = configFromData(
        {
            contentPackage: "demo",
            packageKind: "modules",
            compatibility: { minimum: "14", verified: "14.367" },
            stats: { lastModifiedBy: "sourceaudience00" },
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
    const language = (shortcode: string, data: object, gm = false) => ({
        type: "skill",
        subType: "language",
        shortcode,
        name: { full: shortcode },
        ...(gm ? { tags: ["gm"] } : {}),
        data: { fields: [{ name: "Court", holds: "Court words." }], ...data },
    });
    const notes = {
        Grand: language("grand", { words: [word("ancestor", "a public elder")] }),
        Hidden: language(
            "hidden",
            {
                family: "skill-grand",
                words: [word("ancestor", "SECRET replacement"), word("privateonly", "SECRET word")],
            },
            true,
        ),
        Daughter: language("daughter", {
            family: "skill-hidden",
            words: [word("local", "a local word")],
        }),
        Gmdaughter: language(
            "gmdaughter",
            { family: "skill-hidden", words: [word("local", "a local word")] },
            true,
        ),
        Openuse: {
            type: "lore",
            subType: "history",
            shortcode: "openuse",
            name: { full: "Open use" },
        },
        Gmuse: {
            type: "lore",
            subType: "history",
            shortcode: "gmuse",
            name: { full: "SECRET use" },
            tags: ["gm"],
        },
        Custom: { type: "lore", subType: "history", shortcode: "custom", name: { full: "Custom" } },
    };
    for (const [name, fm] of Object.entries(notes)) {
        const body =
            name.endsWith("use") ? "The _ancestor_ knows the _local_ word."
            : name === "Custom" ?
                "```sql {layout=dictionary}\nSELECT * FROM dictionary WHERE language = 'demo-note-skill-daughter'\n```"
            :   "Authored prose.";
        fs.writeFileSync(file(name), `---\n${YAML.stringify(fm)}---\n\n${body}\n`);
    }
    corpus = await buildCompileCorpus({
        contentBase: config.paths.content,
        skipDirectories: [],
        config,
        router: foundryIdentities(config).packRouter,
    });
    publicTables = await prepareTreeSqlTables(config.paths.content, {
        config,
        records: corpus.records,
        parsed: corpus.parsed,
        audience: "public",
        foreignIndex: new Map(),
    });
}, 60_000);

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("automatic lexical sections use their source audience", () => {
    it("keeps a public source's inherited providers and usage public in the actual complete Foundry corpus", () => {
        expect(corpus.problems).toEqual([]);
        const body = expanded("Daughter");
        expect(body).toContain("A public elder.");
        expect(body).toContain("[[demo-note-lore-openuse|Open use]]");
        expect(body).not.toContain("SECRET");
        expect(body).not.toContain("privateonly");
        expect(body).not.toContain("demo-note-lore-gmuse");
    });

    it("retains the complete providers and usage on a GM source", () => {
        const body = expanded("Gmdaughter");
        expect(body).toContain("SECRET replacement.");
        expect(body).toContain("**privateonly**");
        expect(body).toContain("[[demo-note-lore-gmuse|SECRET use]]");
    });

    it("agrees with the publisher projection and the public preparation used by site and book", () => {
        const sections = lexicalSectionsFor(
            corpus.records.filter((record: any) => !isGmNote(record)),
            corpus.records,
        );
        const projected = insertLexicalSections(
            corpus.parsed.get(file("Daughter")).body,
            sections.get("demo-note-skill-daughter"),
        ).markdown;
        expect(expanded("Daughter")).toBe(projected);
        expect(expanded("Daughter", publicTables)).toBe(projected);
    });

    it("preserves the requested complete audience of an explicit custom SQL dictionary", () => {
        expect(corpus.sqlTables.get(file("Custom"))[0].markdown).toContain("SECRET replacement.");
        expect(corpus.sqlTables.get(file("Custom"))[0].markdown).toContain("**privateonly**");
    });

    it("keeps an unknown derived citation as plain text without inventing a link or refusal", () => {
        const complete = encodeAddresses(corpus.records);
        const daughter = complete.find(
            (record: any) => record.shortcode === "daughter" && !record.documents,
        );
        daughter.citations
            .find((citation: any) => citation.form === "local")
            .notes.push("demo-note-lore-missing");
        const sections = lexicalSectionsFor(
            complete.filter((record: any) => !isGmNote(record)),
            complete,
        );
        const tables: any = [];
        tables.lexical = sections.get("demo-note-skill-daughter");
        const result = expandContentTables("Authored prose.", { sqlTables: tables });
        expect(result.errors).toEqual([]);
        expect(result.markdown).toContain("demo-note-lore-missing");
        expect(result.markdown).not.toContain("[[demo-note-lore-missing");
        expect(result.markdown).toContain("[[demo-note-lore-openuse|Open use]]");
    });
});
