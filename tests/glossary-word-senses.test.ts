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
import YAML from "yaml";

import { collectAnchors } from "../engine/anchors.mjs";
import { collectContentIndex } from "../engine/content-index.mjs";
import { buildLinkIndex, auditLinks } from "../engine/content-links.mjs";
import { expandContentTables } from "../engine/content-tables.mjs";
import {
    DICTIONARY_COLUMNS,
    TERM_COLUMNS,
    dictionaryAndTermRows,
} from "../engine/dictionary-rows.mjs";
import { COMMON_MARK, renderDictionary, renderGlossary } from "../engine/dictionary-layout.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import { prepareTreeSqlTables, openNotesDatabase, runSqlQuery } from "../engine/sql-tables.mjs";
import { WORD_CLASS_BASES, abbreviateWordClass, parseWordClass } from "../engine/word-classes.mjs";

const address = (type: string, shortcode: string) => `demo-note-${type}-${shortcode}`;
const LANGUAGE = address("skill", "tongue");
const CULTURE = address("lore", "folk");
const ORDER = address("affiliation", "order");
const FIELD = "Court";
const bases = WORD_CLASS_BASES.filter((base) => base.glossary);
const word = (form: string, gloss: string | string[], extra = {}) => ({
    form,
    gloss,
    class: "n",
    field: FIELD,
    ...extra,
});
const note = (type: string, shortcode: string, data: object, subType?: string) => ({
    package: "demo",
    type,
    ...(subType ? { subType } : {}),
    shortcode,
    name: { full: shortcode },
    data,
});
const authored = [
    note(
        "skill",
        "grand",
        { words: [word("ancestor", ["the public first", "the public elder"])] },
        "language",
    ),
    {
        ...note(
            "skill",
            "hidden",
            {
                family: address("skill", "grand"),
                words: [word("ancestor", "SECRET definition"), word("privateonly", "SECRET word")],
            },
            "language",
        ),
        tags: ["gm"],
    },
    note(
        "skill",
        "tongue",
        {
            abbreviation: "Tng.",
            family: address("skill", "hidden"),
            fields: [{ name: FIELD, holds: "Court vocabulary." }],
            words: [
                word("zethu", ["writing", "a scribe"], {
                    pronunciation: "ZE-thu",
                    name_sort: "zetu",
                }),
                word("Zethu", "an inscription"),
                word("zéthu", "a letter"),
                ...bases.map((base) =>
                    word(`form-${base.token}`, `sense-${base.token}`, { class: base.token }),
                ),
            ],
        },
        "language",
    ),
    note(
        "lore",
        "folk",
        {
            lang: "tongue",
            glossary: [
                { name: "zethu", common: true, pronunciation: "ze-THU", name_sort: "scribal" },
                { name: "Zethu", common: true },
                { name: "zéthu", common: true },
                { name: "ancestor", common: true },
                { name: "Subject", common: true },
                { name: "meet a scribe", definition: "to settle a debt", common: true },
                ...bases.map((base) => ({ name: `form-${base.token}`, common: true })),
            ],
        },
        "culture",
    ),
    note(
        "affiliation",
        "order",
        {
            culture: CULTURE,
            lang: "tongue",
            glossary: [{ name: "zethu", definition: "a clerk sworn to the order" }],
            governance: {
                ranks: [
                    { level: 0, title: "Outcast", description: "An outcast." },
                    { level: 1, title: "Subject", description: "Owes the order service." },
                    { level: 2, title: "High Warden", description: "Leads the order." },
                ],
            },
        },
        "order",
    ),
];
/**
 * The notes as the content index records them: each with the language it
 * derives, and the language note with the code `languages:` gives it.
 */
const LANGUAGES = { tongue: { tag: "art-x-tongue", note: "skill-tongue" } };
const records: any[] = authored.map((record) => ({
    ...record,
    lang: (record.data as { lang?: string }).lang ?? "en",
    ...(record.shortcode === "tongue" ? { languageCode: "tongue" } : {}),
}));
const visible = records.filter((record) => !record.tags?.includes("gm"));
const rows = () => dictionaryAndTermRows(visible, records);
const own = (terms: any[], owner: string, name: string) =>
    terms.find((row) => row.owner === owner && row.name === name);

describe("dictionary words in an owner's glossary", () => {
    it("derives every row shape from its declared relation columns, with common on terms only", () => {
        const result = rows();
        expect(DICTIONARY_COLUMNS).not.toContain("common");
        expect(TERM_COLUMNS).toContain("common");
        expect(TERM_COLUMNS).toContain("class");
        expect(TERM_COLUMNS).toContain("word");
        for (const [relation, columns] of [
            [result.dictionary, DICTIONARY_COLUMNS],
            [result.terms, TERM_COLUMNS],
        ] as const)
            for (const row of relation)
                expect(Object.keys(row).sort()).toEqual([...columns].sort());
    });

    it("carries all of a named word's senses, grammar and entry link for every dictionary class", () => {
        const { dictionary, terms } = rows();
        for (const base of bases) {
            const term = own(terms, CULTURE, `form-${base.token}`);
            const provider = dictionary.find(
                (row) => row.language === LANGUAGE && row.name === term?.name,
            );
            expect(term, base.token).toMatchObject({
                class: base.token,
                senses: provider?.senses,
                common: true,
                origins: ["glossary"],
            });
            expect(term?.word, base.token).toMatch(new RegExp(`^${LANGUAGE}#`));
            const markdown = renderGlossary(
                { columns: [...TERM_COLUMNS], rows: [term] },
                { pageLanguage: LANGUAGE },
            );
            expect(markdown).toContain(`_${abbreviateWordClass(parseWordClass(base.token))}_`);
        }
        expect(own(terms, CULTURE, "zethu")).toMatchObject({
            class: "n",
            senses: [
                { text: "writing", bodies: [] },
                { text: "a scribe", bodies: [] },
            ],
            pronunciation: "ze-THU",
            name_sort: "scribal",
        });
        expect(own(terms, CULTURE, "Zethu").name_sort).toBe("Zethu");
    });

    it("keeps contextual definitions, phrases and common choices on their owning glossary", () => {
        const { dictionary, terms } = rows();
        const contextual = own(terms, ORDER, "zethu");
        expect(contextual).toMatchObject({
            class: "n",
            common: false,
            name_sort: "zetu",
            pronunciation: "ZE-thu",
            senses: [{ text: "a clerk sworn to the order", bodies: [ORDER] }],
        });
        expect(contextual.word).toBe(own(terms, CULTURE, "zethu").word);
        expect(own(terms, CULTURE, "meet a scribe")).toMatchObject({
            class: null,
            word: null,
            senses: [{ text: "to settle a debt", bodies: [CULTURE] }],
        });
        expect(
            dictionary.find((row) => row.language === LANGUAGE && row.name === "zethu"),
        ).toMatchObject({
            name_sort: "zetu",
            pronunciation: "ZE-thu",
            senses: [
                { text: "writing", bodies: [] },
                { text: "a scribe", bodies: [] },
            ],
        });
        expect(dictionary.every((row) => !Object.hasOwn(row, "common"))).toBe(true);
        expect(terms.filter((row) => row.owner === ORDER).some((row) => row.name === "Zethu")).toBe(
            false,
        );
    });

    it("keeps exact word identities distinct and uses visible definition providers through hidden ancestors", () => {
        const { terms } = rows();
        const entries = ["zethu", "Zethu", "zéthu"].map((name) => own(terms, CULTURE, name));
        expect(entries.every((entry) => typeof entry?.word === "string")).toBe(true);
        expect(new Set(entries.map((entry) => entry.word)).size).toBe(entries.length);
        expect(own(terms, CULTURE, "ancestor").senses).toEqual([
            { text: "the public first", bodies: [] },
            { text: "the public elder", bodies: [] },
        ]);
        expect(JSON.stringify(terms)).not.toContain("SECRET");
    });

    it("admits named one-word ranks without giving their affiliation its culture's common mark", () => {
        const { terms } = rows();
        expect(own(terms, ORDER, "Subject")).toMatchObject({
            common: false,
            senses: [{ text: "Owes the order service.", bodies: [ORDER] }],
        });
        expect(own(terms, CULTURE, "Subject")).toMatchObject({
            common: true,
            senses: [{ text: "Owes the order service.", bodies: [ORDER] }],
        });
        expect(own(terms, ORDER, "High Warden")).toBeDefined();
        expect(own(terms, ORDER, "Outcast")).toBeUndefined();
    });

    it("combines a named dictionary word with its owner's rank and office in source order", () => {
        const changed: any[] = structuredClone(visible);
        changed
            .find((record) => record.shortcode === "tongue")
            .data.words.push(word("High Warden", ["an elder", "Leads the order."]));
        const order = changed.find((record) => record.shortcode === "order");
        order.data.governance.offices = { "High Warden": "Keeps the seal." };
        order.data.glossary.push({ name: "High Warden", common: true });
        const term = own(dictionaryAndTermRows(changed).terms, ORDER, "High Warden");
        expect(term).toMatchObject({
            class: "n",
            common: true,
            origins: ["glossary", "office", "rank"],
            senses: [
                { text: "an elder", bodies: [] },
                { text: "Leads the order.", bodies: [ORDER] },
                { text: "Keeps the seal.", bodies: [ORDER] },
            ],
        });
        expect(term.word).toMatch(new RegExp(`^${LANGUAGE}#`));
        order.data.glossary.at(-1).definition = "the keeper of the order's law";
        expect(own(dictionaryAndTermRows(changed).terms, ORDER, "High Warden").senses).toEqual([
            { text: "the keeper of the order's law", bodies: [ORDER] },
        ]);
    });

    it("keeps two owners' sort and pronunciation overrides independent of each other and the word", () => {
        const changed: any[] = structuredClone(visible);
        Object.assign(changed.find((record) => record.shortcode === "order").data.glossary[0], {
            name_sort: "clerk",
            pronunciation: "ZEH-thoo",
        });
        const { dictionary, terms } = dictionaryAndTermRows(changed);
        expect(own(terms, CULTURE, "zethu")).toMatchObject({
            name_sort: "scribal",
            pronunciation: "ze-THU",
            common: true,
        });
        expect(own(terms, ORDER, "zethu")).toMatchObject({
            name_sort: "clerk",
            pronunciation: "ZEH-thoo",
            common: false,
        });
        expect(
            dictionary.find((row) => row.language === LANGUAGE && row.name === "zethu"),
        ).toMatchObject({ name_sort: "zetu", pronunciation: "ZE-thu" });
    });

    it("prints common only in glossary marks and keys, including a query supplying a common alias", () => {
        const { dictionary, terms } = rows();
        const provider = dictionary.find(
            (row) => row.language === LANGUAGE && row.name === "zethu",
        );
        const result = {
            columns: [...DICTIONARY_COLUMNS, "common"],
            rows: [{ ...provider, common: true }],
        };
        for (const showKey of [true, false, "only"] as const) {
            const markdown = renderDictionary(result, { showKey });
            expect(markdown).not.toContain(COMMON_MARK);
            expect(markdown).not.toContain("a common word");
        }
        const glossary = renderGlossary({
            columns: [...TERM_COLUMNS],
            rows: [own(terms, CULTURE, "zethu")],
        });
        expect(glossary).toContain(`${COMMON_MARK} **[[`);
        expect(glossary).toContain("**1** Writing. **2** A scribe.");
        expect(glossary).toContain("a common word");
    });
});

let root: string;
let content: string;
let config: ReturnType<typeof configFromData>;
let indexed: any[];
let prepared: any;
const dictionaryBody = `\`\`\`sql {layout=dictionary}\nSELECT * FROM dictionary WHERE language = '${LANGUAGE}'\n\`\`\``;
const glossaryBody = `\`\`\`sql {layout=glossary}\nSELECT * FROM terms WHERE owner = '${CULTURE}'\n\`\`\``;

beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "glossary-word-senses-"));
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
            languages: LANGUAGES,
        },
        path.join(root, "package-build.config.yaml"),
    );
    for (const record of authored) {
        const { package: _, ...frontmatter } = record;
        const body =
            record.shortcode === "tongue" ? dictionaryBody
            : record.shortcode === "folk" ? glossaryBody
            : "A note.";
        fs.writeFileSync(
            path.join(content, `${record.shortcode}.md`),
            `---\n${YAML.stringify(frontmatter)}---\n\n${body}\n`,
        );
    }
    indexed = collectContentIndex(content, {
        contentPackage: "demo",
        skipDirectories: [],
        languages: LANGUAGES,
    });
    prepared = await prepareTreeSqlTables(content, {
        config,
        records: indexed,
        audience: "public",
        foreignIndex: new Map(),
        skipDirectories: [],
    });
}, 60_000);

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("dictionary-backed glossary SQL", () => {
    it("selects a culture's own entries and reached governance without another owner's common choices", async () => {
        const changed: any[] = structuredClone(visible);
        changed
            .find((record) => record.shortcode === "tongue")
            .data.words.push(word("only-order", "a word the order chooses"));
        changed
            .find((record) => record.shortcode === "order")
            .data.glossary.push(
                { name: "only-order", common: true },
                { name: "High Warden", common: true },
            );
        const db = await openNotesDatabase(changed);
        try {
            const selected = await runSqlQuery(
                db,
                `
                SELECT * REPLACE ((owner = '${CULTURE}' AND common) AS common)
                FROM terms
                WHERE owner = '${CULTURE}'
                   OR (list_contains(cultures, '${CULTURE}')
                       AND (list_contains(origins, 'rank') OR list_contains(origins, 'office')))
            `,
            );
            expect(selected.rows.some((row) => row.name === "only-order")).toBe(false);
            expect(own(selected.rows, CULTURE, "zethu").common).toBe(true);
            expect(own(selected.rows, ORDER, "High Warden").common).toBe(false);
            const raw = await runSqlQuery(
                db,
                `SELECT common FROM terms WHERE owner = '${ORDER}' AND name = 'High Warden'`,
            );
            expect(raw.rows[0].common).toBe(true);
            const markdown = renderGlossary(selected, { pageLanguage: LANGUAGE });
            expect(markdown).not.toContain("only-order");
            expect(
                markdown.split("\n").find((line) => line.includes("**High Warden**")),
            ).not.toMatch(/^•/);
        } finally {
            await db.close();
        }
    });

    it("keeps class and word columns typed as text in empty and governance-only corpora", async () => {
        for (const corpus of [
            [],
            [
                note("affiliation", "only", {
                    governance: {
                        ranks: [
                            { level: 0, title: "High Warden", description: "Leads the order." },
                        ],
                    },
                }),
            ],
        ]) {
            const db = await openNotesDatabase(corpus);
            try {
                const result = await runSqlQuery(db, "DESCRIBE terms");
                for (const column of ["class", "word"])
                    expect(
                        result.rows.find((row) => row.column_name === column)?.column_type,
                        column,
                    ).toBe("VARCHAR");
            } finally {
                await db.close();
            }
        }
    });

    it("keeps dependency terms typed in empty and governance-only indexes", async () => {
        for (const [position, corpus] of [
            [],
            [
                note("affiliation", "only", {
                    governance: {
                        ranks: [
                            { level: 0, title: "High Warden", description: "Leads the order." },
                        ],
                    },
                }),
            ],
        ].entries()) {
            const file = path.join(root, `dependency-terms-${position}.jsonl`);
            fs.writeFileSync(file, corpus.map((record) => JSON.stringify(record)).join("\n"));
            const db = await openNotesDatabase([], { dependencies: [{ id: "demo", file }] });
            try {
                const result = await runSqlQuery(db, "DESCRIBE demo.terms");
                for (const column of ["class", "word"])
                    expect(
                        result.rows.find((row) => row.column_name === column)?.column_type,
                        column,
                    ).toBe("VARCHAR");
                const selected = await runSqlQuery(db, "SELECT * FROM demo.terms");
                expect(selected.columns).toEqual([...TERM_COLUMNS]);
                expect(selected.rows).toEqual(dictionaryAndTermRows(corpus).terms);
            } finally {
                await db.close();
            }
        }
    });

    it("publishes declared runtime columns and refuses dictionary.common", async () => {
        const db = await openNotesDatabase(indexed, { audience: "public" });
        try {
            for (const [name, columns] of [
                ["dictionary", DICTIONARY_COLUMNS],
                ["terms", TERM_COLUMNS],
            ] as const) {
                const result = await runSqlQuery(db, `SELECT * FROM ${name}`);
                expect(result.columns).toEqual([...columns]);
                for (const row of result.rows) expect(Object.keys(row)).toEqual([...columns]);
            }
            await expect(runSqlQuery(db, "SELECT common FROM dictionary")).rejects.toThrow(
                /common/,
            );
        } finally {
            await db.close();
        }
    });

    it("links every inherited headword to an emitted anchor without false unknown-anchor findings", () => {
        const source = path.join(content, "tongue.md");
        const target = expandContentTables(dictionaryBody, {
            sqlTables: prepared.get(source),
        }).markdown;
        const anchors = new Set(collectAnchors(target).map((anchor) => anchor.slug));
        const dbRows = rows().terms.filter((row) => row.owner === CULTURE && row.word);
        expect(dbRows.length).toBeGreaterThan(0);
        for (const row of dbRows) expect(anchors.has(row.word.split("#")[1]), row.name).toBe(true);
        const rendered = prepared.get(path.join(content, "folk.md"))[0];
        expect(rendered.reason).toBeUndefined();
        expect(rendered.markdown).toContain(`[[${dbRows[0].word}|`);
        const index = buildLinkIndex(content, {
            config,
            records: indexed,
            sqlTables: prepared,
            skipDirectories: [],
        });
        const findings = auditLinks(index);
        expect(findings.deadAnchors).toEqual([]);
        expect(findings.deadAddresses).toEqual([]);
    });
});
