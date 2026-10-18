/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import * as contentIndex from "../engine/content-index.mjs";
import { buildCompileCorpus } from "../engine/compile-corpus.mjs";
import { expandContentTables } from "../engine/content-tables.mjs";
import { scanFigures } from "../engine/content-figures.mjs";
import { fetchMetadataFromPath } from "../engine/foreign-catalog.mjs";
import {
    buildContentLinkIndex,
    parseMarkdownFile,
    renderFoundryMarkdown,
} from "../engine/helpers.mjs";
import { journalPageId, splitPages } from "../engine/journals.mjs";
import { renderMarkdownExpressions } from "../engine/markdown-expressions.mjs";
import { loadForeignIndexes } from "../engine/metadata-index.mjs";
import { foundryIdentities } from "../engine/foundry-entries.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import { buildSiteIndex, figureIndexKeys, wikiContext } from "../engine/site-index.mjs";
import { renderSitePage } from "../engine/site-build.mjs";
import { prepareTreeSqlTables } from "../engine/sql-tables.mjs";
import { resolveWebWikilinks } from "../engine/web-wikilinks.mjs";
import { convertWikilinks } from "../engine/wikilinks.mjs";
import { subprocessTimeout } from "./subprocess-timeout.js";

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(PACKAGE_ROOT, "bin/package-build.mjs");
const scalarQuery =
    "SELECT '[the scalar stamp]' || chr(123) || '#scalar-stamp' || chr(125) AS stamp";
const scalar = `{{sql ${JSON.stringify(scalarQuery)}}}`;
const audienceQuery = `SELECT CASE WHEN count(*) > 0 THEN 'Private [stamp]{#hidden-stamp}' ELSE 'Public [stamp]{#public-stamp}' END AS "_section", 'A record.' AS "Entry" FROM notes WHERE shortcode = 'secret'`;
const registerBody = [
    "# Ledger {#ledger}",
    "",
    "The register records its stamped entries.",
    "",
    "```sql",
    `SELECT 'Read [the stamped entry]{#sql-stamp} below' AS "_section", 'A stamped entry.' AS "Entry"`,
    "```",
    "",
    scalar,
    "",
    "```sql",
    audienceQuery,
    "```",
].join("\n");
let root: string;
let publisher: ReturnType<typeof configure>;
let leaf: ReturnType<typeof configure>;
let published: any[];
let fetchedBytes: string;
let publishedBytes: string;
let foreign: ReturnType<typeof loadForeignIndexes>;

function write(file: string, text: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

function note(fm: Record<string, unknown>, body = "Written prose.") {
    return `---\n${YAML.stringify(fm)}---\n\n${body}\n`;
}

function configure(name: string, extra: Record<string, unknown> = {}) {
    const dir = path.join(root, name);
    write(path.join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
    const data = {
        contentPackage: name,
        packageKind: "modules",
        compatibility: { minimum: "14", verified: "14.367" },
        stats: { lastModifiedBy: "publishproof0000" },
        skipDirectories: [],
        packs: [{ name: "journals", type: "JournalEntry", default: true }],
        publish: {},
        ...extra,
    };
    const file = path.join(dir, "package-build.config.yaml");
    write(file, YAML.stringify(data));
    return { dir, file, config: configFromData(data, file) };
}

function run(repo: ReturnType<typeof configure>, ...args: string[]) {
    const result = spawnSync(process.execPath, [CLI, ...args], {
        cwd: repo.dir,
        env: { ...process.env, PACKAGE_BUILD_CONFIG: repo.file },
        encoding: "utf8",
    });
    return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function recordFor(records: any[], shortcode: string, documentation = false) {
    return records.find(
        (record) => record.shortcode === shortcode && !!record.documents === documentation,
    );
}

function normalized(records: any[]) {
    return JSON.parse(JSON.stringify(records));
}

function parse(file: string) {
    return fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);
}

function snapshot(value: unknown): string {
    return JSON.stringify(value, (_key, entry) =>
        entry instanceof Map ? [...entry]
        : typeof entry === "bigint" ? entry.toString()
        : entry,
    );
}

function freeze(value: any, seen = new Set()) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (value instanceof Map) {
        for (const [key, entry] of value) {
            freeze(key, seen);
            freeze(entry, seen);
        }
        for (const name of ["set", "delete", "clear"])
            Object.defineProperty(value, name, {
                value: () => {
                    throw new Error("Frozen publication input");
                },
            });
    } else for (const entry of Object.values(value)) freeze(entry, seen);
    Object.freeze(value);
}

async function prepare(repo = publisher): Promise<any> {
    expect((contentIndex as any).prepareContentIndex).toBeTypeOf("function");
    return (contentIndex as any).prepareContentIndex({ config: repo.config });
}

function emit(repo: ReturnType<typeof configure>, publication: any, outDir: string) {
    return contentIndex.emitContentIndex({ config: repo.config, publication, outDir } as any);
}

beforeAll(async () => {
    fs.mkdirSync(path.join(PACKAGE_ROOT, "nogit"), { recursive: true });
    root = fs.mkdtempSync(path.join(PACKAGE_ROOT, "nogit", "prepared-publication-"));
    publisher = configure("pub", {
        itemBuilders: ["sohl"],
        systems: { sohl: { compatibility: { verified: "0.9.0" } } },
        packs: [
            { name: "items", type: "Item", system: "sohl", default: true },
            { name: "journals", type: "JournalEntry", default: true },
        ],
    });
    const content = publisher.config.paths.content;
    write(
        path.join(content, "Register.md"),
        note(
            {
                type: "lore",
                subType: "history",
                shortcode: "register",
                name: { full: "Register" },
                data: {
                    events: [{ id: "founding", when: "1", summary: "The register is founded." }],
                },
            },
            registerBody,
        ),
    );
    write(
        path.join(content, "Craft.md"),
        note(
            {
                type: "skill",
                subType: "craft",
                shortcode: "craft",
                name: { full: "Craft" },
                sohl: { subType: "craft" },
            },
            `# Method {#method}\n\n${scalar}`,
        ),
    );
    write(
        path.join(content, "Secret.md"),
        note({
            type: "lore",
            subType: "history",
            shortcode: "secret",
            name: { full: "Secret" },
            tags: ["gm"],
        }),
    );
    for (const [shortcode, data] of [
        ["plain", {}],
        ["unpacked", { pack: "none" }],
    ] as const)
        write(
            path.join(content, `${shortcode}.md`),
            note({ type: "lore", subType: "history", shortcode, data }),
        );
    write(
        path.join(content, "WebSection.md"),
        note(
            { type: "lore", subType: "history", shortcode: "websection", data: { pack: "none" } },
            "# A real section {#real}\n\nWritten prose.",
        ),
    );
    write(
        path.join(content, "Tongue.md"),
        note(
            {
                type: "skill",
                subType: "language",
                shortcode: "tongue",
                data: {
                    fields: [{ name: "Court", holds: "Court words." }],
                    words: [{ form: "zethu", class: "n", field: "Court", gloss: "writing" }],
                },
            },
            "",
        ),
    );
    write(
        path.join(content, "GmRegister.md"),
        note(
            {
                type: "lore",
                subType: "history",
                shortcode: "gmregister",
                name: { full: "GM Register" },
                tags: ["gm"],
            },
            `# Private register {#private}\n\n\`\`\`sql\n${audienceQuery}\n\`\`\``,
        ),
    );
    const result = run(publisher, "content-index");
    expect(result.status, result.output).toBe(0);
    const metadata = path.join(publisher.config.paths.contentIndex, "pub-metadata.jsonl");
    publishedBytes = fs.readFileSync(metadata, "utf8");
    published = parse(metadata);
    const artifact = path.join(root, "artifact");
    write(
        path.join(artifact, "module.json"),
        JSON.stringify({
            id: "pub",
            version: "1.0.0",
            flags: { metadataUrl: "https://example.invalid/pub-metadata.jsonl" },
        }),
    );
    fs.copyFileSync(metadata, path.join(artifact, "pub-metadata.jsonl"));
    leaf = configure("leaf", {
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
    });
    const fetched = await fetchMetadataFromPath(leaf.config, { id: "pub" }, artifact);
    fetchedBytes = fs.readFileSync(fetched, "utf8");
    foreign = loadForeignIndexes(leaf.config, new Set(["leaf"]), {
        pub: "https://example.invalid/pub/",
    });
}, subprocessTimeout(1));

afterAll(() => root && fs.rmSync(root, { recursive: true, force: true }));

describe("prepared content-index publication", () => {
    it("publishes real SQL-section and scalar span targets through the publisher CLI", () => {
        expect(fetchedBytes).toBe(publishedBytes);
        const record = recordFor(published, "register");
        for (const slug of ["sql-stamp", "scalar-stamp", "public-stamp"])
            expect(record.anchors).toEqual(
                expect.arrayContaining([expect.objectContaining({ slug, kind: "prose" })]),
            );
        const hit = foreign.index.get("pub-note-lore-register");
        expect(hit?.anchors?.["sql-stamp"]).toMatch(/JournalEntryPage\.[A-Za-z0-9]+$/);
        expect(hit?.anchors?.["scalar-stamp"]).toMatch(/JournalEntryPage\.[A-Za-z0-9]+$/);
        const craft = foreign.index.get("pub-note-skill-craft");
        expect(craft?.anchors?.["scalar-stamp"]).toMatch(/JournalEntryPage\.[A-Za-z0-9]+$/);
    });

    it(
        "makes actual fetched foreign web, Foundry and links consumers accept both emitted spans",
        () => {
            const body =
                "Read [[pub-note-lore-register#sql-stamp|the SQL stamp]] and [[pub-note-lore-register#scalar-stamp|the scalar stamp]].";
            write(
                path.join(leaf.config.paths.content, "Reader.md"),
                note({ type: "doc", shortcode: "reader" }, body),
            );
            const records = contentIndex.indexRecordsFor({
                config: leaf.config,
                contentBase: leaf.config.paths.content,
                skipDirectories: [],
            });
            const foundry = convertWikilinks(body, {
                type: "doc",
                id: "reader",
                index: buildContentLinkIndex(leaf.config.paths.content, undefined, {
                    config: leaf.config,
                    records,
                }),
            });
            const errors: any[] = [];
            const site = buildSiteIndex([], { package: "leaf", foreignIndex: foreign.index });
            const web = resolveWebWikilinks(body, {
                ...wikiContext(site, { errors, foreignIndex: foreign.index }),
                contentPackage: "leaf",
            });
            const result = run(leaf, "links");
            expect(
                { foundry: foundry.unresolved, web: errors, links: result },
                JSON.stringify({
                    cli: result,
                    target: foreign.index.get("pub-note-lore-register"),
                    web,
                }),
            ).toMatchObject({ foundry: [], web: [], links: { status: 0 } });
            expect(web).toContain("/lore-register/#sql-stamp");
            expect(web).toContain("/lore-register/#scalar-stamp");
        },
        subprocessTimeout(1),
    );

    it(
        "continues to refuse a missing foreign prose section",
        () => {
            write(
                path.join(leaf.config.paths.content, "Reader.md"),
                note(
                    { type: "doc", shortcode: "reader" },
                    "Read [[pub-note-lore-register#absent|an absent section]].",
                ),
            );
            const result = run(leaf, "links");
            expect(result.status, result.output).toBe(1);
            expect(result.output).toMatch(/Reader\.md:\d+:\d+: error:.*no section "#absent"/);
        },
        subprocessTimeout(1),
    );

    it(
        "refuses missing foreign sections on plain targets with zero prose anchors",
        () => {
            for (const shortcode of ["plain", "unpacked"]) {
                const target = `pub-note-lore-${shortcode}`;
                expect(recordFor(published, shortcode).anchors).toEqual([]);
                const body = `Read [[${target}#absent|an absent section]].`;
                write(
                    path.join(leaf.config.paths.content, "Reader.md"),
                    note({ type: "doc", shortcode: "reader" }, body),
                );
                const records = contentIndex.indexRecordsFor({ config: leaf.config });
                const foundry = convertWikilinks(body, {
                    type: "doc",
                    id: "reader",
                    index: buildContentLinkIndex(leaf.config.paths.content, undefined, {
                        config: leaf.config,
                        records,
                    }),
                });
                const errors: any[] = [];
                const site = buildSiteIndex([], { package: "leaf", foreignIndex: foreign.index });
                const web = resolveWebWikilinks(body, {
                    ...wikiContext(site, { errors, foreignIndex: foreign.index }),
                    contentPackage: "leaf",
                });
                expect(foundry.unresolved).toEqual([
                    expect.objectContaining({ reason: "unknown-anchor", anchor: "absent" }),
                ]);
                expect(errors, `${target}: ${web}`).toEqual([
                    expect.objectContaining({ reason: "unknown-anchor", anchor: "absent" }),
                ]);
                const checked = run(leaf, "links");
                expect(checked.status, checked.output).toBe(1);
            }
        },
        subprocessTimeout(1),
    );

    it("accepts an actually published prose anchor on a web-only note", () => {
        const errors: any[] = [];
        const site = buildSiteIndex([], { package: "leaf", foreignIndex: foreign.index });
        const web = resolveWebWikilinks("[[pub-note-lore-websection#real|the real section]]", {
            ...wikiContext(site, { errors, foreignIndex: foreign.index }),
            contentPackage: "leaf",
        });
        expect(errors).toEqual([]);
        expect(web).toContain("/lore-websection/#real");
    });

    it("accepts a declared SQL target on the public surface and refuses its absent native target", () => {
        const body = "Read [[pub-note-lore-register#public-stamp|the public stamp]].";
        write(
            path.join(leaf.config.paths.content, "Reader.md"),
            note({ type: "doc", shortcode: "reader" }, body),
        );
        const records = contentIndex.indexRecordsFor({ config: leaf.config });
        const native = convertWikilinks(body, {
            type: "doc",
            id: "reader",
            index: buildContentLinkIndex(leaf.config.paths.content, undefined, {
                config: leaf.config,
                records,
            }),
        });
        expect(native.unresolved).toEqual([
            expect.objectContaining({ reason: "unknown-anchor", anchor: "public-stamp" }),
        ]);
        const errors: any[] = [];
        const site = buildSiteIndex([], { package: "leaf", foreignIndex: foreign.index });
        const web = resolveWebWikilinks(body, {
            ...wikiContext(site, { errors, foreignIndex: foreign.index }),
            contentPackage: "leaf",
        });
        expect(errors, web).toEqual([]);
        expect(web).toContain("/lore-register/#public-stamp");
        const checked = run(leaf, "links");
        expect(checked.status, checked.output).toBe(0);
    });

    it("addresses readable documentation anchors to the NOTE journal in emitted JSON", () => {
        const documentation = recordFor(published, "craft", true);
        const item = recordFor(published, "craft");
        const ownAddress = { address: "pub-sohl-skill-craft", anchor: null, anchorKind: null };
        const docAddress = { address: "pub-note-skill-craft", anchor: null, anchorKind: null };
        expect(item.address.canonical).toEqual(ownAddress);
        expect(item.documentation).toEqual(docAddress);
        expect(documentation.address.canonical).toEqual(docAddress);
        expect(documentation.documents).toEqual(ownAddress);
        expect(
            documentation.anchors.find((anchor: any) => anchor.slug === "method").link,
        ).toMatchObject({ address: "pub-note-skill-craft", anchor: "method", anchorKind: "prose" });
        expect(item.anchors.find((anchor: any) => anchor.slug === "method").link.address).toBe(
            "pub-sohl-skill-craft",
        );
        const language = recordFor(published, "tongue", true);
        expect(language.anchors).toEqual(
            expect.arrayContaining([expect.objectContaining({ slug: "dictionary" })]),
        );
        expect(
            language.anchors.every(
                (anchor: any) => anchor.link.address === "pub-note-skill-tongue",
            ),
        ).toBe(true);
    });

    it("matches published own and documentation mappings to actual expanded journal targets", async () => {
        const records = contentIndex.indexRecordsFor({
            config: publisher.config,
            contentBase: publisher.config.paths.content,
            skipDirectories: [],
        });
        const tables = await prepareTreeSqlTables(publisher.config.paths.content, {
            config: publisher.config,
            records,
            audience: "public",
            foreignIndex: new Map(),
        });
        const mappings: Array<{ slug: string; actual: string | undefined; expected: string }> = [];
        for (const [filename, body, address] of [
            ["Register.md", registerBody, "pub-note-lore-register"],
            ["Craft.md", `# Method {#method}\n\n${scalar}`, "pub-note-skill-craft"],
        ]) {
            const source = path.join(publisher.config.paths.content, filename);
            const expanded = expandContentTables(body, { source, sqlTables: tables?.get(source) });
            const rendered = renderMarkdownExpressions(expanded.markdown, {
                sqlResults: tables?.inline?.get(source),
                file: source,
            });
            expect(rendered.findings).toEqual([]);
            const html = renderFoundryMarkdown(rendered.markdown);
            const hit = foreign.index.get(address);
            const parsed = parseMarkdownFile(source);
            const page = {
                kind: "content",
                fm: parsed.frontmatter,
                file: source,
                pkg: "pub",
                body: parsed.body,
                bodyLine: parsed.bodyLine,
                name: parsed.frontmatter.name.full,
                slug: address.replace("pub-note-", ""),
                base: filename,
                relPath: filename,
            };
            const siteIndex = buildSiteIndex([page], { package: "pub" });
            const site = renderSitePage(page, {
                index: siteIndex.index,
                foreign: { index: new Map() },
                universe: new Map(),
                config: publisher.config,
                sqlTables: tables,
            });
            const entryUuid = hit?.uuid?.match(/^(.*\.JournalEntry\.([^.]+))/);
            const pages = splitPages(rendered.markdown);
            const slugs =
                filename === "Register.md" ? ["sql-stamp", "scalar-stamp"] : ["scalar-stamp"];
            for (const slug of slugs) {
                expect(html).toContain(`id="${slug}"`);
                expect(site.body).toContain(`id="${slug}"`);
                const containing = pages.find((page) =>
                    renderFoundryMarkdown(page.markdown).includes(`id="${slug}"`),
                );
                expect(containing).toBeTruthy();
                expect(entryUuid).toBeTruthy();
                mappings.push({
                    slug,
                    actual: hit?.anchors?.[slug],
                    expected: `${entryUuid?.[1]}.JournalEntryPage.${journalPageId(entryUuid?.[2], containing)}`,
                });
            }
        }
        for (const mapping of mappings)
            expect(mapping.actual, JSON.stringify(mappings)).toBe(mapping.expected);
    });

    it("refuses unprepared dynamic publication before creating or replacing any output", () => {
        for (const existing of [false, true]) {
            const outDir = path.join(root, existing ? "existing-output" : "fresh-output");
            const names = ["metadata", "dictionary", "terms"].map((kind) => `pub-${kind}.jsonl`);
            if (existing)
                for (const name of names) write(path.join(outDir, name), `keep ${name}\n`);
            expect(() =>
                contentIndex.emitContentIndex({ config: publisher.config, outDir }),
            ).toThrow(/prepareContentIndex/);
            if (existing)
                for (const name of names)
                    expect(fs.readFileSync(path.join(outDir, name), "utf8")).toBe(`keep ${name}\n`);
            else expect(fs.existsSync(outDir)).toBe(false);
        }
    });

    it("keeps the synchronous exporter available for a simple authored tree", () => {
        const simple = configure("simple");
        write(
            path.join(simple.config.paths.content, "Guide.md"),
            note({ type: "doc", shortcode: "guide" }, "# Guide {#guide}\n\nWritten prose."),
        );
        const result = contentIndex.emitContentIndex({ config: simple.config });
        expect(result).not.toBeInstanceOf(Promise);
        expect(parse(result.file)[0].anchors).toEqual(
            expect.arrayContaining([expect.objectContaining({ slug: "guide" })]),
        );
    });

    it("keeps pure frontmatter lexical sections synchronous", () => {
        const lexical = configure("lexical");
        fs.mkdirSync(lexical.config.paths.content, { recursive: true });
        fs.copyFileSync(
            path.join(publisher.config.paths.content, "Tongue.md"),
            path.join(lexical.config.paths.content, "Tongue.md"),
        );
        const result = contentIndex.emitContentIndex({ config: lexical.config });
        expect(result).not.toBeInstanceOf(Promise);
        const record = recordFor(parse(result.file), "tongue");
        expect(record.anchors).toEqual(
            expect.arrayContaining([expect.objectContaining({ slug: "dictionary" })]),
        );
    });

    // Preparing a whole corpus is CPU-bound and slows with whatever else the
    // runner is doing; the budget absorbs a loaded CI runner.
    it("prepares a mixed corpus while retaining unaddressable scaffolding without page identities", async () => {
        const repo = configure("scaffolding");
        const sources = {
            "Working.md": "# Working notes\n\nUnaddressed vault scaffolding.",
            "Named.md": note({ name: { full: "Working notes" } }),
            "Template.md": note({ type: "doc", name: { full: "Template" } }),
        };
        for (const [filename, source] of Object.entries(sources))
            write(path.join(repo.config.paths.content, filename), source);
        write(
            path.join(repo.config.paths.content, "Guide.md"),
            note({ type: "doc", shortcode: "guide" }, scalar),
        );
        const original = contentIndex.indexRecordsFor({ config: repo.config });
        const publication = await prepare(repo);
        const records = parse(emit(repo, publication).file);
        for (const filename of Object.keys(sources)) {
            const file = path.join(repo.config.paths.content, filename);
            expect(publication.parsed.has(file)).toBe(true);
            expect(publication.expandedBodies.has(file)).toBe(true);
            expect(publication.foundryBodies.has(file)).toBe(true);
            const record = records.find((one) => one.file?.path === filename);
            const source = original.find((one) => one.file?.path === filename);
            expect(record).toEqual(JSON.parse(contentIndex.serializeContentIndex([source])));
            expect(record).toMatchObject({ address: null, foundry: null });
            expect(record.documentation).toBeNull();
            expect(record.documents).toBeUndefined();
        }
        expect(recordFor(records, "guide").anchors).toEqual(
            expect.arrayContaining([expect.objectContaining({ slug: "scalar-stamp" })]),
        );
        const cli = run(repo, "content-index");
        expect(cli.status, cli.output).toBe(0);
        write(
            path.join(repo.config.paths.content, "Named.md"),
            note({ name: { full: "Working notes" } }, "{{missingField}}"),
        );
        await expect(prepare(repo)).rejects.toThrow(
            /Named\.md:\d+:\d+: error: Markdown expression/,
        );
    }, 30_000);

    it("prepares cross-note figure references with the site's canonical and bare address context", async () => {
        const repo = configure("figures", { site: { base: "/reference/" } });
        const targets = ["skill-craft", "figures-note-skill-craft", "figures-sohl-skill-craft"];
        write(
            path.join(repo.config.paths.content, "Craft.md"),
            note(
                { type: "skill", subType: "craft", shortcode: "craft", name: { full: "Craft" } },
                ":@ A stamped listing. {#stamp}\n\n```js\n1\n```",
            ),
        );
        write(
            path.join(repo.config.paths.content, "Guide.md"),
            note(
                { type: "doc", shortcode: "guide", data: { pack: "none" } },
                targets
                    .map((target) => `The craft listing is {{ref "${target}#stamp"}}.`)
                    .join("\n\n"),
            ),
        );
        const records = contentIndex.indexRecordsFor({ config: repo.config });
        const pages = ["Craft.md", "Guide.md"].map((filename) => {
            const file = path.join(repo.config.paths.content, filename);
            const parsed = parseMarkdownFile(file);
            const slug = `${parsed.frontmatter.type}-${parsed.frontmatter.shortcode}`;
            return {
                kind: "content",
                ...parsed,
                fm: parsed.frontmatter,
                file,
                pkg: "figures",
                slug,
                url: `/reference/${slug}/`,
                relPath: filename,
            };
        });
        const index = buildSiteIndex(pages, { package: "figures", records });
        const figures = new Map(
            scanFigures(pages[0].body).figures.map((figure) => [figure.id, figure]),
        );
        const figuresByAddress = new Map(
            [...figureIndexKeys("figures", "skill", "craft")].map((key) => [key, figures]),
        );
        const rendered = renderSitePage(pages[1], {
            index,
            foreign: { index: new Map() },
            universe: new Map(),
            config: repo.config,
            figuresByAddress,
        });
        expect(rendered.expressionErrors).toEqual([]);
        expect(rendered.body.match(/\[Code 1\]\(\/reference\/skill-craft\/#stamp\)/g)).toHaveLength(
            3,
        );
        const publication = await prepare(repo);
        expect(publication.expandedBodies.get(pages[1].file).markdown.trim()).toBe(
            rendered.body.trim(),
        );
    });

    it("prepares complete audience-specific bodies and preserves the complete source corpus", async () => {
        const publication = await prepare();
        expect(publication.records).toEqual(
            expect.arrayContaining([expect.objectContaining({ shortcode: "secret" })]),
        );
        const source = path.join(publisher.config.paths.content, "Register.md");
        const privateSource = path.join(publisher.config.paths.content, "GmRegister.md");
        expect(publication.parsed.has(source)).toBe(true);
        expect(publication.expandedBodies.get(source).markdown).toContain("{#public-stamp}");
        expect(publication.expandedBodies.get(source).markdown).not.toContain("{#hidden-stamp}");
        expect(publication.expandedBodies.get(source).markdown).toContain("{#scalar-stamp}");
        expect(publication.expandedBodies.get(privateSource).markdown).toContain("{#hidden-stamp}");
    });

    it("publishes only declared native targets using the actual ALL corpus's containing pages", async () => {
        const repo = configure("native", {
            packs: [
                { name: "journals", type: "JournalEntry", default: true },
                { name: "gm-journals", type: "JournalEntry", private: true },
            ],
        });
        const headingQuery = `SELECT CASE WHEN count(*) > 0 THEN 'SECRET section {#secret-page}' ELSE 'Public section {#public-page}' END AS "_section", 'A record.' AS "Entry" FROM notes WHERE shortcode = 'secret'`;
        const body = `# Introduction {#intro}\n\n\`\`\`sql\n${headingQuery}\n\`\`\`\n\nRead [the shared stamp]{#shared-stamp} below.\n\n\`\`\`sql\n${audienceQuery}\n\`\`\``;
        for (const [shortcode, gm] of [
            ["register", false],
            ["gmregister", true],
        ] as const)
            write(
                path.join(repo.config.paths.content, `${shortcode}.md`),
                note(
                    {
                        type: "doc",
                        shortcode,
                        name: { full: shortcode },
                        ...(gm ? { tags: ["gm"], data: { pack: "gm-journals" } } : {}),
                    },
                    body,
                ),
            );
        write(
            path.join(repo.config.paths.content, "Secret.md"),
            note({ type: "doc", shortcode: "secret", tags: ["gm"], data: { pack: "gm-journals" } }),
        );
        const corpus = await buildCompileCorpus({
            config: repo.config,
            contentBase: repo.config.paths.content,
            skipDirectories: [],
            router: foundryIdentities(repo.config).packRouter,
        });
        expect(corpus.problems).toEqual([]);
        const source = path.join(repo.config.paths.content, "register.md");
        const actual = expandContentTables(body, {
            source,
            sqlTables: corpus.sqlTables?.get(source),
        });
        expect(actual.errors).toEqual([]);
        expect(actual.markdown).toContain("{#secret-page}");
        expect(actual.markdown).toContain("{#hidden-stamp}");
        expect(renderFoundryMarkdown(actual.markdown)).toContain('id="shared-stamp"');
        const publication = await prepare(repo);
        const sourceBody = publication.expandedBodies.get(source).markdown;
        expect(sourceBody).toContain("{#public-page}");
        expect(sourceBody).toContain("{#public-stamp}");
        const records = parse(emit(repo, publication).file);
        const record = recordFor(records, "register");
        const declared = record.anchors.map((one: any) => one.slug);
        expect(declared).toEqual(
            expect.arrayContaining(["public-page", "public-stamp", "shared-stamp"]),
        );
        const native = record.foundry.note;
        expect(native.anchors["public-stamp"]).toBeUndefined();
        expect(native.anchors["public-page"]).toBeUndefined();
        expect(native.anchors["hidden-stamp"]).toBeUndefined();
        expect(native.anchors["secret-page"]).toBeUndefined();
        const containing = splitPages(actual.markdown).find((page) =>
            renderFoundryMarkdown(page.markdown).includes('id="shared-stamp"'),
        );
        const publicContaining = splitPages(sourceBody).find((page) =>
            renderFoundryMarkdown(page.markdown).includes('id="shared-stamp"'),
        );
        expect(containing).toBeTruthy();
        const entryId = native.uuid.split(".").at(-1);
        const page = journalPageId(entryId, containing);
        expect(page).not.toBe(journalPageId(entryId, publicContaining));
        expect(native.anchors["shared-stamp"]).toBe(`${native.uuid}.JournalEntryPage.${page}`);
        expect(native.anchors.$lead).toBeTruthy();
        expect(JSON.stringify(record)).not.toMatch(/SECRET|secret-page|hidden-stamp/);
        const privateRecord = recordFor(records, "gmregister");
        expect(privateRecord.anchors).toEqual(
            expect.arrayContaining([expect.objectContaining({ slug: "hidden-stamp" })]),
        );
        expect(privateRecord.foundry.note.anchors["hidden-stamp"]).toBeTruthy();
        expect(publication.foundryBodies.get(source).markdown).toBe(actual.markdown);
    });

    it("projects frozen supplied records and bodies without changing them", async () => {
        const publication = await prepare();
        const inputs = [
            publication.records,
            publication.parsed,
            publication.expandedBodies,
            publication.foundryBodies,
        ];
        const before = snapshot(inputs);
        for (const input of inputs) freeze(input);
        const result = emit(publisher, publication, path.join(root, "frozen-output"));
        expect(result).not.toBeInstanceOf(Promise);
        expect(snapshot(inputs)).toBe(before);
        expect(recordFor(parse(result.file), "register").anchors).toEqual(
            expect.arrayContaining([expect.objectContaining({ slug: "scalar-stamp" })]),
        );
    });

    it("preserves authored anchor/event source positions and generated source mappings", async () => {
        const original = normalized(
            contentIndex.indexRecordsFor({
                config: publisher.config,
                contentBase: publisher.config.paths.content,
                skipDirectories: [],
            }),
        );
        const publication = await prepare();
        const result = emit(publisher, publication, path.join(root, "positions-output"));
        const record = recordFor(parse(result.file), "register");
        const prior = recordFor(original, "register");
        for (const slug of ["ledger", "founding"]) {
            const before = prior.anchors.find((anchor: any) => anchor.slug === slug);
            expect(record.anchors.find((anchor: any) => anchor.slug === slug)).toMatchObject({
                slug,
                line: before.line,
                kind: before.kind,
            });
        }
        const source = path.join(publisher.config.paths.content, "Register.md");
        const body = publication.expandedBodies.get(source);
        const at = body.markdown
            .split("\n")
            .findIndex((line: string) => line.startsWith("# Ledger"));
        const authored = publication.parsed
            .get(source)
            .body.split("\n")
            .findIndex((line: string) => line.startsWith("# Ledger"));
        expect(body.lineMap[at]).toEqual({ line: authored, generated: false });
    });

    it("refuses incomplete or differently bound preparation before any write", async () => {
        const publication = await prepare();
        const incomplete = { ...publication, expandedBodies: new Map(publication.expandedBodies) };
        incomplete.expandedBodies.delete(path.join(publisher.config.paths.content, "Register.md"));
        const outDir = path.join(root, "incomplete-output");
        expect(() => emit(publisher, incomplete, outDir)).toThrow(/prepareContentIndex/);
        expect(fs.existsSync(outDir)).toBe(false);
        const nativeIncomplete = {
            ...publication,
            foundryBodies: new Map(publication.foundryBodies),
        };
        nativeIncomplete.foundryBodies.delete(
            path.join(publisher.config.paths.content, "Register.md"),
        );
        expect(() => emit(publisher, nativeIncomplete, outDir)).toThrow(/prepareContentIndex/);
        expect(fs.existsSync(outDir)).toBe(false);
        const other = configure("other");
        write(
            path.join(other.config.paths.content, "Guide.md"),
            note({ type: "doc", shortcode: "guide" }, scalar),
        );
        expect(() => emit(other, publication, outDir)).toThrow(/prepareContentIndex/);
        expect(fs.existsSync(outDir)).toBe(false);
    });

    it("produces byte-identical metadata and relation files from repeated preparation", async () => {
        const first = emit(publisher, await prepare(), path.join(root, "repeat-first"));
        const second = emit(publisher, await prepare(), path.join(root, "repeat-second"));
        for (const kind of ["metadata", "dictionary", "terms"]) {
            const filename = `pub-${kind}.jsonl`;
            expect(fs.readFileSync(path.join(path.dirname(first.file), filename), "utf8")).toBe(
                fs.readFileSync(path.join(path.dirname(second.file), filename), "utf8"),
            );
        }
    });

    it("refuses failed SQL preparation before publishing any relation", async () => {
        const broken = configure("broken");
        write(
            path.join(broken.config.paths.content, "Broken.md"),
            note(
                { type: "doc", shortcode: "broken" },
                "```sql\nSELECT no_such_column FROM notes\n```",
            ),
        );
        await expect(prepare(broken)).rejects.toThrow(/Broken\.md|no_such_column/);
        expect(fs.existsSync(broken.config.paths.contentIndex)).toBe(false);
    });
});
