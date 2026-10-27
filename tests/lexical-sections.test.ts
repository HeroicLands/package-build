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
import { encodeAddresses, readPublishedAddresses } from "../engine/address-values.mjs";
import { collectAnchors } from "../engine/anchors.mjs";
import {
    emitContentIndex,
    indexRecordsFor,
    prepareContentIndex,
} from "../engine/content-index.mjs";
import { buildLinkIndex, auditLinks } from "../engine/content-links.mjs";
import { expandContentTables } from "../engine/content-tables.mjs";
import {
    DICTIONARY_COLUMNS,
    dictionaryAndTermRows,
    dictionaryEntryAnchor,
} from "../engine/dictionary-rows.mjs";
import { renderSpans } from "../engine/content-spans.mjs";
import { fetchMetadataFromPath } from "../engine/foreign-catalog.mjs";
import {
    buildContentLinkIndex,
    parseMarkdownFile,
    renderFoundryMarkdown,
} from "../engine/helpers.mjs";
import { loadForeignIndexes } from "../engine/metadata-index.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import { collectContentPages } from "../engine/site-build.mjs";
import { Journals } from "../engine/journals.mjs";
import {
    LEXICAL_SECTIONS,
    insertLexicalSections,
    lexicalSectionsFor,
} from "../engine/lexical-sections.mjs";
import { isGmNote } from "../engine/note-vocabulary.mjs";
import { WORD_CLASS_BASES } from "../engine/word-classes.mjs";
import { prepareLinkSqlTables, prepareTreeSqlTables } from "../engine/sql-tables.mjs";
import { convertWikilinks } from "../engine/wikilinks.mjs";

const key = (type: string, shortcode: string) => `pub-note-${type}-${shortcode}`;
const word = (form: string, gloss: string, field = "Court") => ({ form, gloss, class: "n", field });
const before = "A loanword line.\n\n### A lower subsection\n\nIts last authored sentence.";
const tongueBody =
    "# Reading\n\n```text\n## Fake {#dictionary}\n```\n\n" +
    `## Lexicon {#lexicon}\n\n${before}\n\n## Later {#later}\n\nLater text.\n\n# Last\n\nLast text.`;
let root: string;
let config: any;
let records: any[];
let prepared: any;
const file = (name: string) => path.join(config.paths.content, `${name}.md`);
const expanded = (name: string) =>
    expandContentTables(parseMarkdownFile(file(name)).body, {
        sqlTables: prepared?.get(file(name)),
        pageLists: prepared?.pageLists?.get(file(name)),
    });

beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lexical-sections-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "pub", version: "1.0.0" }),
    );
    config = configFromData(
        {
            contentPackage: "pub",
            packageKind: "modules",
            compatibility: { minimum: "14", verified: "14.367" },
            stats: { lastModifiedBy: "preflightbuild00" },
            itemBuilders: ["sohl"],
            systems: { sohl: { compatibility: { verified: "0.9.0" } } },
            languages: {
                tongue: { tag: "art-x-tongue", note: "skill-tongue" },
                emptydaughter: { tag: "art-x-emptyd", note: "skill-emptydaughter" },
            },
            packs: [
                { name: "items", type: "Item", system: "sohl", default: true },
                { name: "journals", type: "JournalEntry", default: true },
            ],
        },
        path.join(root, "package-build.config.yaml"),
    );
    fs.mkdirSync(config.paths.content, { recursive: true });
    const write = (
        name: string,
        type: string,
        data: any,
        subType?: string,
        body = "Authored prose.",
    ) =>
        fs.writeFileSync(
            file(name),
            `---\n${YAML.stringify({ type, subType, shortcode: name.toLowerCase(), name: { full: name }, data })}---\n\n${body}\n`,
        );
    write("Parent", "skill", { words: [word("ancestor", "an elder", "Kinship")] }, "language");
    write(
        "Tongue",
        "skill",
        {
            roman: "abcdefghijklmnopqrstuvwxyz",
            family: key("skill", "parent"),
            words: [word("zethu", "a scribe"), word("alpha", "a letter")],
        },
        "language",
        tongueBody,
    );
    write(
        "Emptydaughter",
        "skill",
        { roman: "abcdefghijklmnopqrstuvwxyz", family: key("skill", "parent") },
        "language",
        "",
    );
    write("Empty", "skill", { words: [] }, "language");
    write("Absent", "skill", {}, "language");
    write(
        "Classes",
        "skill",
        {
            words: WORD_CLASS_BASES.filter((base) => !base.glossary).map((base) => ({
                ...word(`form-${base.token}`, `sense-${base.token}`),
                class: base.token,
            })),
        },
        "language",
    );
    write(
        "Folk",
        "lore",
        { lang: "tongue", glossary: [{ name: "zethu", common: true }] },
        "culture",
    );
    write("Otherfolk", "lore", {}, "culture");
    write(
        "Order",
        "affiliation",
        {
            lang: "tongue",
            governance: {
                ranks: [{ level: 1, title: "High Scribe", description: "Leads the scribes." }],
            },
            glossary: [{ name: "zethu" }],
        },
        "order",
    );
    write(
        "Namedrank",
        "affiliation",
        {
            lang: "tongue",
            governance: {
                ranks: [{ level: 1, title: "High Scribe", description: "Leads the scribes." }],
            },
            glossary: [{ name: "High Scribe", common: true }],
        },
        "order",
    );
    write(
        "Daughterfolk",
        "lore",
        { lang: "emptydaughter", glossary: [{ name: "ancestor" }] },
        "culture",
    );
    write(
        "Plainorder",
        "affiliation",
        {
            governance: {
                ranks: [{ level: 1, title: "High Scribe", description: "Leads the scribes." }],
            },
        },
        "order",
    );
    write(
        "Onlydata",
        "lore",
        { glossary: [{ name: "a phrase", definition: "Its meaning." }] },
        "culture",
        "",
    );
    write(
        "Custom",
        "skill",
        { words: [word("custom", "a custom word")] },
        "language",
        "```sql {layout=dictionary}\nSELECT * FROM dictionary WHERE language = 'pub-note-skill-custom'\n```",
    );
    records = indexRecordsFor({ config, skipDirectories: [] });
    prepared = await prepareTreeSqlTables(config.paths.content, {
        config,
        records,
        foreignIndex: new Map(),
    });
}, 60_000);

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("automatic lexical sections", () => {
    it("sets the whole dictionary, with each field, alphabetic letters and one key", () => {
        const text = expanded("Tongue").markdown;
        expect(text).toContain("**zethu**");
        expect(text).toContain("**ancestor**");
        expect(text).toContain("Court");
        expect(text).toContain("Kinship");
        expect(text.match(/\*\*Key:\*\*/g)).toHaveLength(1);
        expect(text.indexOf("**alpha**")).toBeLessThan(text.indexOf("**ancestor**"));
        expect(text.indexOf("**ancestor**")).toBeLessThan(text.indexOf("**zethu**"));
        expect(text).toContain("### A\n");
        const rows = dictionaryAndTermRows(encodeAddresses(records)).dictionary;
        expect(DICTIONARY_COLUMNS).toContain("field");
        for (const row of rows) expect(row.field).toBeTruthy();
    });

    it("fills the real anchored section after its text and before the next peer heading", () => {
        const result = expanded("Tongue");
        const text = result.markdown;
        expect(text.match(/\{#lexicon\}/g)).toHaveLength(1);
        expect(text).not.toContain("# Dictionary {#dictionary}");
        expect(text.indexOf("**alpha**")).toBeGreaterThan(text.indexOf(before));
        expect(text.indexOf("**zethu**")).toBeLessThan(text.indexOf("## Later"));
        expect(text).toContain("## Later {#later}\n\nLater text.\n\n# Last\n\nLast text.");
        const laterLine = text.split("\n").findIndex((line) => line.startsWith("## Later"));
        const sourceLine = parseMarkdownFile(file("Tongue"))
            .body.split("\n")
            .findIndex((line) => line.startsWith("## Later"));
        expect(result.lineMap[laterLine]).toEqual({ line: sourceLine, generated: false });
        expect(collectAnchors(text).filter((anchor) => anchor.slug === "dictionary")).toEqual([]);
    });

    it("keeps a dictionary heading for nonempty own words whose classes produce no dictionary entries", () => {
        const text = expanded("Classes").markdown;
        expect(text).toContain("# Dictionary {#dictionary}");
        expect(text).not.toContain("**form-");
        expect(text).not.toContain("**Key:**");
    });

    it("reuses every declared lexical heading alias outside code", () => {
        const sections = lexicalSectionsFor(records);
        for (const spec of LEXICAL_SECTIONS) {
            const owner = [...sections.values()]
                .flat()
                .find((section) => section.slug === spec.slug && section.result.rows.length)!;
            for (const alias of spec.aliases) {
                const body = `# Intro\n\n\`\`\`markdown\n## Example {#${alias}}\n\`\`\`\n\n## Reused {#${alias}}\n\nAuthored introduction.\n\n### Child\n\nLast authored sentence.\n\n## Next {#next}\n\nTail.`;
                const result = insertLexicalSections(body, [owner]);
                expect(
                    collectAnchors(result.markdown).filter((anchor) => anchor.slug === alias),
                ).toHaveLength(1);
                expect(result.markdown.indexOf("**Key:**")).toBeGreaterThan(
                    result.markdown.indexOf("Last authored sentence."),
                );
                expect(result.markdown.indexOf("**Key:**")).toBeLessThan(
                    result.markdown.indexOf("## Next"),
                );
                expect(result.markdown).not.toContain(`# ${spec.heading} {#${spec.slug}}`);
            }
        }
    });

    it("gates dictionaries on nonempty own words and glossaries on nonempty own entries", () => {
        for (const name of ["Empty", "Absent", "Emptydaughter", "Otherfolk", "Plainorder"])
            expect(expanded(name).markdown).not.toMatch(/\{#(?:dictionary|glossary)\}/);
        expect(expanded("Onlydata").markdown).toContain("# Glossary {#glossary}");
        expect(expanded("Onlydata").markdown).toContain("**a phrase**");
        expect(records.find((record) => record.shortcode === "onlydata")?.address).toBeTruthy();
        const { pages } = collectContentPages(config.paths.content, {
            config,
            records,
            contentPackage: "pub",
            packages: new Set(["pub"]),
            base: "/pub/",
            skipDirectories: [],
        });
        expect(pages.some((page) => page.fm.shortcode === "onlydata")).toBe(true);
        const authored = parseMarkdownFile(file("Onlydata"));
        expect(Journals.prototype.skipNote(authored.frontmatter, authored.body)).toBe(false);
    });

    it("lists only the owner's declared entries, admitting a rank only when named", () => {
        expect(expanded("Folk").markdown).toContain("# Glossary {#glossary}");
        expect(expanded("Folk").markdown).toContain("zethu");
        expect(expanded("Order").markdown).not.toContain("High Scribe");
        expect(expanded("Namedrank").markdown).toContain("**High Scribe**");
    });

    it("puts one canonical target in the automatic dictionary while custom SQL keeps its layout", () => {
        const text = expanded("Custom").markdown;
        const anchor = dictionaryEntryAnchor(key("skill", "custom"), "custom");
        expect(text.match(/\*\*custom\*\*/g)).toHaveLength(2);
        expect(collectAnchors(text).filter((entry) => entry.slug === anchor)).toHaveLength(1);
    });

    it("gives every surface the same target and native journal fragment", () => {
        const text = expanded("Tongue").markdown;
        const anchor = dictionaryEntryAnchor(key("skill", "tongue"), "zethu");
        expect(renderSpans(text).markdown).toContain(`<span id="${anchor}"`);
        expect(renderFoundryMarkdown(text)).toMatch(new RegExp(`<h6\\b[^>]*id="${anchor}"`));
        const target = prepared?.get(file("Tongue"))?.docAnchorUuids?.[anchor];
        expect(target).toMatch(new RegExp(`JournalEntryPage\\.[A-Za-z0-9]+#${anchor}$`));
    });

    it("links inherited words to a visible real dictionary when the resolved language has no own words", () => {
        const rows = dictionaryAndTermRows(encodeAddresses(records));
        const term = rows.terms.find((row) => row.owner === key("lore", "daughterfolk"));
        expect(term?.language).toBe(key("skill", "emptydaughter"));
        const anchor = dictionaryEntryAnchor(key("skill", "parent"), "ancestor");
        expect(term?.word).toBe(`${key("skill", "parent")}#${anchor}`);
        expect(collectAnchors(expanded("Parent").markdown).some((one) => one.slug === anchor)).toBe(
            true,
        );
    });

    it("keeps the visible defining-language target through a hidden ancestor", () => {
        const complete = encodeAddresses(records);
        const daughter = complete.find(
            (record) => record.shortcode === "emptydaughter" && !record.documents,
        );
        daughter.data.family = key("skill", "hidden");
        complete.push({
            package: "pub",
            type: "skill",
            subType: "language",
            shortcode: "hidden",
            tags: ["gm"],
            data: { family: key("skill", "parent"), words: [word("ancestor", "SECRET sense")] },
        });
        const visible = complete.filter((record) => !isGmNote(record));
        const rows = dictionaryAndTermRows(visible, complete);
        const term = rows.terms.find((row) => row.owner === key("lore", "daughterfolk"));
        const anchor = dictionaryEntryAnchor(key("skill", "parent"), "ancestor");
        expect(term).toMatchObject({
            language: key("skill", "emptydaughter"),
            word: `${key("skill", "parent")}#${anchor}`,
            class: "n",
            senses: [{ text: "an elder", bodies: [] }],
        });
        expect(JSON.stringify(rows)).not.toContain("SECRET");
        const sections = lexicalSectionsFor(visible, complete);
        expect(sections.has(key("skill", "emptydaughter"))).toBe(false);
        expect(
            collectAnchors(
                insertLexicalSections("", sections.get(key("skill", "parent"))).markdown,
            ).some((entry) => entry.slug === anchor),
        ).toBe(true);
    });

    it("checks automatic glossary links even without any authored directive", async () => {
        const tables = await prepareLinkSqlTables(config.paths.content, {
            config,
            records,
            foreignIndex: new Map(),
        });
        expect(tables?.get(file("Folk"))).toBeTruthy();
        const index = buildLinkIndex(config.paths.content, { config, records, sqlTables: tables });
        for (const [kind, findings] of Object.entries(auditLinks(index)))
            if (kind !== "usedManifest") expect(findings, kind).toEqual([]);
    });

    it("publishes the actual automatic targets and resolves them after metadata fetch", async () => {
        const publication = await prepareContentIndex({ config });
        const result = emitContentIndex({ publication });
        expect(result).not.toBeInstanceOf(Promise);
        const metadata = fs.readFileSync(result.file, "utf8");
        const published = metadata
            .trim()
            .split("\n")
            .map((line) => encodeAddresses(readPublishedAddresses(JSON.parse(line))));
        const rows = dictionaryAndTermRows(encodeAddresses(records));
        for (const term of rows.terms.filter((row) => row.word)) {
            const [address, anchor] = term.word.split("#");
            const target = published.find((record) => record.address?.canonical === address);
            expect(target?.anchors?.some((one: any) => one.slug === anchor)).toBe(true);
            const authored = records.find(
                (record) => encodeAddresses(record.address?.canonical) === address,
            );
            const actual = expanded(path.basename(authored.file.path, ".md")).markdown;
            expect(collectAnchors(actual).some((one) => one.slug === anchor)).toBe(true);
        }
        const artifact = path.join(root, "artifact");
        fs.mkdirSync(artifact);
        fs.writeFileSync(
            path.join(artifact, "module.json"),
            JSON.stringify({ id: "pub", version: "1.0.0" }),
        );
        fs.copyFileSync(result.file, path.join(artifact, "pub-metadata.jsonl"));
        fs.mkdirSync(path.join(root, "leaf"));
        fs.writeFileSync(
            path.join(root, "leaf", "package.json"),
            JSON.stringify({ name: "leaf", version: "1.0.0" }),
        );
        const consumer = configFromData(
            {
                contentPackage: "leaf",
                packageKind: "modules",
                compatibility: { minimum: "14", verified: "14.367" },
                stats: { lastModifiedBy: "preflightbuild00" },
                packs: [{ name: "journals", type: "JournalEntry", default: true }],
                relationships: {
                    requires: [
                        {
                            id: "pub",
                            type: "module",
                            manifest: "https://example.invalid/module.json",
                            compatibility: { verified: "1.0.0" },
                        },
                    ],
                },
            },
            path.join(root, "leaf", "package-build.config.yaml"),
        );
        await fetchMetadataFromPath(consumer, { id: "pub" }, artifact);
        const foreign = loadForeignIndexes(consumer, ["leaf"]).index;
        const anchor = dictionaryEntryAnchor(key("skill", "tongue"), "zethu");
        const fetched = foreign.get(key("skill", "tongue"));
        expect(fetched?.anchors?.[anchor]).toBeTruthy();
        fs.mkdirSync(consumer.paths.content, { recursive: true });
        const linkIndex = buildContentLinkIndex(consumer.paths.content, undefined, {
            config: consumer,
            records: [],
        });
        const resolved = convertWikilinks(`[[${key("skill", "tongue")}#${anchor}|zethu]]`, {
            type: "doc",
            id: "reader",
            index: linkIndex,
        });
        expect(resolved.unresolved).toEqual([]);
        expect(resolved.markdown).toBe(
            `@UUID[${prepared.get(file("Tongue")).docAnchorUuids[anchor]}]{zethu}`,
        );
    });
});
