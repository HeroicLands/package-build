/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeAddresses } from "../engine/address-values.mjs";
import { indexRecordsFor } from "../engine/content-index.mjs";
import { expandContentTables } from "../engine/content-tables.mjs";
import { TERM_COLUMNS, dictionaryAndTermRows } from "../engine/dictionary-rows.mjs";
import { renderGlossary } from "../engine/dictionary-layout.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import { prepareTreeSqlTables } from "../engine/sql-tables.mjs";

const OWNER = "demo-note-lore-provenzia";
const OTHER = "demo-note-affiliation-duchy";
const LANGUAGE = "demo-note-skill-provenzal";
const fence = (query: string) => `\`\`\`sql {layout=glossary}\n${query}\n\`\`\``;
const ownQuery = `SELECT * FROM terms WHERE owner = '${OWNER}' ORDER BY name`;
let root: string;
let records: any[];
let parsed: Map<string, any>;
let prepared: any;
let source: string;
let elsewhere: string;

beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "glossary-owner-labels-"));
    fs.writeFileSync(path.join(root, "package.json"), '{"name":"demo","version":"1.0.0"}');
    const config = configFromData(
        {
            contentPackage: "demo",
            packageKind: "modules",
            compatibility: { minimum: "14", verified: "14.367" },
            stats: { lastModifiedBy: "preflightbuild00" },
            packs: [{ name: "journals", type: "JournalEntry", default: true }],
            languages: { prov: { tag: "art-x-prov", note: "skill-provenzal" } },
        },
        path.join(root, "package-build.config.yaml"),
    );
    fs.mkdirSync(config.paths.content, { recursive: true });
    const write = (name: string, frontmatter: object, body: string) => {
        const file = path.join(config.paths.content, `${name}.md`);
        fs.writeFileSync(file, `---\n${YAML.stringify(frontmatter)}---\n\n${body}\n`);
        return file;
    };
    write(
        "Language",
        {
            type: "skill",
            subType: "language",
            shortcode: "provenzal",
            name: { full: "Provenzal Language" },
            data: {
                abbreviation: "Prov.",
                fields: [{ name: "Love", holds: "Longing and courtship." }],
                words: [{ form: "solmère", class: "n", field: "Love", gloss: "longing" }],
            },
        },
        "The tongue of Provenzia.",
    );
    source = write(
        "Culture",
        {
            type: "lore",
            subType: "culture",
            shortcode: "provenzia",
            name: { full: "Provenzia" },
            data: {
                lang: "prov",
                glossary: [
                    {
                        name: "solmère",
                        common: true,
                        definition: "the ache for a time that is gone",
                    },
                    { name: "blood-field", definition: "ground torn by a battle" },
                    { name: "High Warden" },
                ],
            },
        },
        [
            "## Custom own {#custom-own}",
            fence(ownQuery),
            "## Combined {#combined}",
            fence("SELECT * FROM terms WHERE name = 'blood-field' ORDER BY owner"),
            "## Glossary {#glossary}",
            "An authored introduction.",
        ].join("\n\n"),
    );
    write(
        "Duchy",
        {
            type: "affiliation",
            subType: "polity",
            shortcode: "duchy",
            name: { full: "Duchy of Aubrac" },
            data: {
                culture: "lore-provenzia",
                lang: "prov",
                glossary: [{ name: "blood-field", definition: "ground torn by a battle" }],
                governance: {
                    ranks: [{ level: 1, title: "High Warden", description: "Leads the order." }],
                },
            },
        },
        "An affiliation of Provenzia.",
    );
    elsewhere = write(
        "Elsewhere",
        { type: "doc", shortcode: "elsewhere", name: { full: "Elsewhere" } },
        fence(ownQuery),
    );
    parsed = new Map();
    records = indexRecordsFor({ config, parsed, skipDirectories: [] });
    prepared = await prepareTreeSqlTables(config.paths.content, {
        config,
        records,
        parsed,
        audience: "public",
        foreignIndex: new Map(),
    });
}, 60_000);

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("glossary sense labels on their owner's page", () => {
    it("omits only sole-owner labels in the automatic glossary", () => {
        const result = expandContentTables(parsed.get(source).body, {
            sqlTables: prepared.get(source),
        });
        expect(result.errors).toEqual([]);
        const automatic = result.markdown.slice(result.markdown.indexOf("## Glossary"));
        expect(automatic).toContain(
            "|solmère]]{.lexical-ref}** _n._ The ache for a time that is gone.",
        );
        expect(automatic).toContain("**blood-field** Ground torn by a battle.");
        expect(automatic).not.toContain("(_Provenzia_)");
        expect(automatic).toContain("**High Warden** (_Duchy of Aubrac_) Leads the order.");
        expect(automatic).toContain(`[[${OWNER}|Provenzia]]`);
    });

    it("uses the same omission for custom SQL on the owner page only", () => {
        const own = prepared.get(source)[0];
        const other = prepared.get(elsewhere)[0];
        expect(own.reason).toBeUndefined();
        expect(other.reason).toBeUndefined();
        expect(own.markdown).toContain("**blood-field** Ground torn by a battle.");
        expect(own.markdown).not.toContain("(_Provenzia_)");
        expect(other.markdown).toContain(
            "**blood-field** _Prov._ (_Provenzia_) Ground torn by a battle.",
        );
        expect(other.markdown).toContain("_Prov._ Provenzal Language");
        expect(own.markdown).toContain("(_Duchy of Aubrac_)");
    });

    it("keeps every body when identical senses merge from several owners", () => {
        const combined = prepared.get(source)[1];
        expect(combined.reason).toBeUndefined();
        expect(combined.markdown).toContain(
            "**blood-field** (_Duchy of Aubrac, Provenzia_) Ground torn by a battle.",
        );
    });

    it("retains labels without a page identity or a selected owner column", () => {
        const rows = dictionaryAndTermRows(encodeAddresses(records)).terms.filter(
            (row) => row.owner === OWNER && row.name === "blood-field",
        );
        const labels = (address: string) => (address === OWNER ? "Provenzia" : "Duchy of Aubrac");
        const result = { columns: [...TERM_COLUMNS], rows };
        expect(renderGlossary(result, { labelOf: labels })).toContain("(_Provenzia_)");
        expect(
            renderGlossary(
                {
                    columns: result.columns.filter((column) => column !== "owner"),
                    rows: rows.map(({ owner: _, ...row }) => row),
                },
                { labelOf: labels, pageOwner: OWNER },
            ),
        ).toContain("(_Provenzia_)");
    });

    it("requires each contributing row to own the sole body even when merged first or last", () => {
        const own = dictionaryAndTermRows(encodeAddresses(records)).terms.find(
            (row) => row.owner === OWNER && row.name === "blood-field",
        );
        const foreign = { ...own, owner: OTHER };
        for (const rows of [
            [own, foreign],
            [foreign, own],
        ])
            expect(
                renderGlossary(
                    { columns: [...TERM_COLUMNS], rows },
                    { pageOwner: OWNER, pageLanguage: LANGUAGE, labelOf: () => "Provenzia" },
                ),
            ).toContain("(_Provenzia_)");
    });
});
