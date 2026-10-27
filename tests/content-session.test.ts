/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import * as engine from "../engine/index.mjs";
import * as indexReader from "../engine/content-index.mjs";
import * as alerts from "../engine/content-alerts.mjs";
import * as spans from "../engine/content-spans.mjs";
import * as blockScans from "../engine/content-blocks.mjs";
import * as sqlPreparations from "../engine/sql-tables.mjs";
import { auditLinks, buildLinkIndex } from "../engine/content-links.mjs";
import { prepareContentIndex, emitContentIndex } from "../engine/content-index.mjs";
import { lintContentCharset } from "../engine/content-charset.mjs";
import { lintContentHtml } from "../engine/content-html.mjs";
import { lintPathCharset } from "../engine/path-charset.mjs";
import { generatePacksJson } from "../engine/generate.mjs";
import { prepareLinkSqlTables, prepareTreeSqlTables } from "../engine/sql-tables.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import { fileURLToPath } from "node:url";
import { checkScriptFonts, copyScriptFonts, facesUsed } from "../engine/script-font-delivery.mjs";
import { resolveScriptFonts } from "../engine/script-fonts.mjs";
import { walkMarkdownTree } from "../engine/helpers.mjs";
import { fixture, note, outputBytes, write } from "./content-session-fixture.js";

const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function repo(size = 8, pkg?: string) {
    const result = fixture(size, pkg);
    roots.push(result.root);
    return result;
}
function factory() {
    const create = (engine as any).contentSession?.createContentSession;
    expect(create, "the four actual operations need the shared session factory").toBeTypeOf(
        "function",
    );
    return create;
}
function freeze(value: any): any {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) freeze(child);
    return Object.freeze(value);
}
function observe(files: Map<string, string>) {
    const reads: string[] = [];
    const parses: string[] = [];
    const read = fs.readFileSync;
    const parse = YAML.parse;
    const payloads = new Map(
        [...files].map(([file, raw]) => [raw.match(/^---\n([\s\S]*?)\n---/)![1], file]),
    );
    const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation((...args: any[]) => {
        if (files.has(String(args[0]))) reads.push(String(args[0]));
        return read(...(args as Parameters<typeof fs.readFileSync>));
    });
    const parseSpy = vi.spyOn(YAML, "parse").mockImplementation((text: any, ...args: any[]) => {
        if (payloads.has(text)) parses.push(payloads.get(text)!);
        return parse(text, ...args);
    });
    return {
        reads,
        parses,
        stop: () => {
            readSpy.mockRestore();
            parseSpy.mockRestore();
        },
    };
}
function auditView(index: ReturnType<typeof buildLinkIndex>) {
    return {
        notes: index.notes,
        anchors: index.notes.map((note) => [note.rel, [...index.anchors.get(note)]]),
        events: index.notes.map((note) => [note.rel, [...index.eventAnchorsOf.get(note)]]),
        audit: auditLinks(index),
    };
}

describe("one invocation owns the shared content session", () => {
    it.each([8, 16])(
        "reads/parses %i actual sources once across all four target preparations",
        async (size) => {
            const input = repo(size);
            const create = factory();
            const work = observe(input.files);
            const derive = vi.spyOn(indexReader, "indexRecordsFor");
            const scannerSpies = [
                vi.spyOn(blockScans, "scanBlocks"),
                vi.spyOn(alerts, "scanAlerts"),
                vi.spyOn(spans, "scanSpans"),
            ];
            const sqlSpy = vi.spyOn(sqlPreparations, "prepareTreeSqlTables");
            const session = await create({ config: input.config });
            try {
                freeze(session.records);
                for (const source of session.parsed.values()) freeze(source);
                await session.prepare(["compile", "links", "lint", "index"]);
                await session.publication();
                await session.compileCorpus();
                await session.audit("lint");
                await session.audit("links");
                await session.prepare(["index", "lint", "links", "compile"]);
                emitContentIndex({
                    config: input.config,
                    publication: await session.publication(),
                });
                expect(await generatePacksJson({ config: input.config, session } as any)).toBe(0);
                expect(work.reads.sort()).toEqual([...input.files.keys()].sort());
                expect(work.parses.sort()).toEqual([...input.files.keys()].sort());
                expect(derive).toHaveBeenCalledTimes(1);
                expect(session.records.length).toBeGreaterThanOrEqual(size);
                expect(session.parsed.size).toBe(size);
                expect(sqlSpy.mock.calls.map(([, options]) => options?.audience).sort()).toEqual([
                    "all",
                    "public",
                ]);
                const timing = session.timings.snapshot();
                expect(timing.stages["source capture"]).toBeGreaterThan(0);
                expect(timing.stages["index derivation"]).toBeGreaterThan(0);
                expect(timing.stages["sql:all"]).toBeGreaterThan(0);
                expect(timing.stages["sql:public"]).toBeGreaterThan(0);
                expect(timing.hits["sql:all"]).toBeGreaterThan(0);
                expect(
                    Object.values(timing.stages).reduce((sum: number, ms: any) => sum + ms, 0),
                ).toBeCloseTo(timing.totalMs, 5);

                for (const body of new Set(
                    [...session.parsed.values()].map((source: any) => source.body),
                )) {
                    for (const scan of scannerSpies)
                        expect(scan.mock.calls.filter(([text]) => text === body)).toHaveLength(1);
                }
            } finally {
                work.stop();
                session.dispose();
            }
        },
    );

    it("uses the captured raw source and parsed frontmatter for font delivery", async () => {
        const input = repo();
        const declared = YAML.parse(fs.readFileSync(input.configFile, "utf8"));
        declared.languages = { en: { tag: "en" } };
        write(input.configFile, YAML.stringify(declared));
        input.config = configFromData(declared, input.configFile);
        const encoding = path.join(input.config.paths.content, "Encoding.md");
        const raw = note({
            type: "doc",
            subType: "reference",
            shortcode: "testenc",
            name: { full: "English codage" },
            data: {
                language: "en",
                font: "teng-chou",
                accepts: ["a-z"],
                mappings: {},
                rules: { normalization: "NFC", matching: "longest-first" },
            },
        });
        write(encoding, raw);
        input.files.set(encoding, raw);
        fs.cpSync(
            fileURLToPath(new URL("./fixtures/script-fonts/fonts", import.meta.url)),
            path.join(input.root, "node_modules/@heroiclands/fonts"),
            { recursive: true },
        );
        const work = observe(input.files);
        const session = await factory()({ config: input.config });
        try {
            const installed = resolveScriptFonts(input.root)!;
            expect([...facesUsed(input.config, installed, session)]).toEqual(["teng-chou"]);
            expect(checkScriptFonts(input.config, session)).toEqual([]);
            expect(
                copyScriptFonts(
                    input.config,
                    path.join(input.root, "build/fonts"),
                    ["woff2"],
                    session,
                ),
            ).toBeGreaterThan(0);
            expect(work.reads.sort()).toEqual([...input.files.keys()].sort());
            expect(work.parses.sort()).toEqual([...input.files.keys()].sort());
        } finally {
            work.stop();
            session.dispose();
        }
    });

    it("reuses actual authored scanner results and keeps distinct text projections", async () => {
        const input = repo();
        const session = await factory()({ config: input.config });
        try {
            const text = session.parsed.get([...input.files.keys()][0]).body;
            const alertScan = vi.spyOn(alerts, "scanAlerts");
            const spanScan = vi.spyOn(spans, "scanSpans");
            const first = session.syntax(text);
            const alertCount = alertScan.mock.calls.length;
            const spanCount = spanScan.mock.calls.length;
            for (let n = 0; n < 10; n++) expect(session.syntax(text)).toEqual(first);
            expect(alertScan).toHaveBeenCalledTimes(alertCount);
            expect(spanScan).toHaveBeenCalledTimes(spanCount);
            expect(first.alerts.blocks).toHaveLength(1);
            expect(first.spans.spans.some((span: any) => span.id === "inline")).toBe(true);
            const other = session.syntax("\n" + text);
            expect(other.alerts.blocks[0].start).toBe(first.alerts.blocks[0].start + 1);
            expect(
                other.spans.spans.find((span: any) => span.id === "inline").start,
            ).toBeGreaterThan(first.spans.spans.find((span: any) => span.id === "inline").start);
            expect(spanScan.mock.calls.length).toBeGreaterThan(spanCount);
        } finally {
            session.dispose();
        }
    });

    it("keeps the public walk's rendered descriptions unless explicitly omitted", async () => {
        const input = repo();
        const session = await factory()({ config: input.config });
        const options = { skipDirectories: input.config.skipDirectories };
        try {
            const expected = [...walkMarkdownTree(input.config.paths.content, options)];
            const captured = [
                ...walkMarkdownTree(input.config.paths.content, {
                    ...options,
                    sources: session.inventory.indexSources,
                }),
            ];
            expect(captured).toEqual(expected);
            expect(captured.some((source) => source.description.includes("<p>"))).toBe(true);
            for (const sources of [undefined, session.inventory.indexSources]) {
                const unrendered = [
                    ...walkMarkdownTree(input.config.paths.content, {
                        ...options,
                        sources,
                        renderDescription: false,
                    }),
                ];
                expect(unrendered.every((source) => source.description === "")).toBe(true);
                expect(unrendered.map(({ description, ...source }) => source)).toEqual(
                    expected.map(({ description, ...source }) => source),
                );
            }
        } finally {
            session.dispose();
        }
    });

    it("preserves actual publication, audit, native generation and immutable source inputs", async () => {
        const input = repo();
        const expectedPublication = await prepareContentIndex({ config: input.config });
        const records = expectedPublication.records;
        const parsed = expectedPublication.parsed;
        const expectedTables = await prepareLinkSqlTables(input.config.paths.content, {
            config: input.config,
            records,
            parsed,
        });
        const expectedAudit = buildLinkIndex(input.config.paths.content, {
            config: input.config,
            records,
            parsed,
            sqlTables: expectedTables,
        });
        const expectedOut = path.join(input.root, "expected-index");
        emitContentIndex({
            config: input.config,
            publication: expectedPublication,
            outDir: expectedOut,
        });
        const dictionary = fs.readFileSync(
            path.join(expectedOut, `${input.config.contentPackage}-dictionary.jsonl`),
            "utf8",
        );
        const terms = fs.readFileSync(
            path.join(expectedOut, `${input.config.contentPackage}-terms.jsonl`),
            "utf8",
        );
        expect(dictionary).toContain('"men"');
        expect(dictionary).toContain('"stone"');
        expect(terms).toContain('"men"');
        expect(terms).toContain("a stone raised to mark a meeting");
        expect(terms).toContain(`${input.config.contentPackage}-note-lore-folk`);
        expect(await generatePacksJson({ config: input.config })).toBe(0);
        const expectedPacks = outputBytes(input.config.paths.packJson);
        const session = await factory()({ config: input.config });
        try {
            const before = structuredClone({
                records: session.records,
                parsed: [...session.parsed],
            });
            await session.prepare(["compile", "index", "links", "lint"]);
            const publication = await session.publication();
            const actualOut = path.join(input.root, "actual-index");
            emitContentIndex({ config: input.config, publication, outDir: actualOut });
            expect(outputBytes(actualOut)).toEqual(outputBytes(expectedOut));
            expect(auditView(await session.audit("links"))).toEqual(auditView(expectedAudit));
            expect(await generatePacksJson({ config: input.config, session } as any)).toBe(0);
            expect(outputBytes(input.config.paths.packJson)).toEqual(expectedPacks);
            expect({ records: session.records, parsed: [...session.parsed] }).toEqual(before);
            expect(publication.expandedBodies.get([...input.files.keys()][0]).markdown).toContain(
                "Public",
            );
            expect(publication.foundryBodies.get([...input.files.keys()][0]).markdown).toContain(
                "Private",
            );
        } finally {
            session.dispose();
        }
    });

    it("preserves physical malformed/unindexed checks and refuses writers before outputs", async () => {
        const input = repo();
        const content = input.config.paths.content;
        write(
            path.join(content, "Malformed.md"),
            "---\ntype: doc\nbroken: [ }\n---\n\nə <b>text</b>\n",
        );
        write(path.join(content, "Untyped.md"), "ə <b>text</b>\n");
        write(path.join(content, "Bad.yaml"), "broken: [ }\n# ə\n");
        write(path.join(content, "Páth.txt"), "An unindexed file.\n");
        const existing = path.join(input.config.paths.contentIndex, "keep.txt");
        write(existing, "Keep this output.\n");
        const session = await factory()({ config: input.config });
        try {
            expect(lintContentCharset(content, { sources: session.sources } as any)).toEqual(
                lintContentCharset(content, { skipDirectories: input.config.skipDirectories }),
            );
            expect(lintContentHtml(content, { sources: session.sources } as any)).toEqual(
                lintContentHtml(content, { skipDirectories: input.config.skipDirectories }),
            );
            const pathOptions = {
                contentBase: content,
                assetsBase: input.config.paths.assets,
                skipDirectories: input.config.skipDirectories,
            };
            expect(
                lintPathCharset({ ...pathOptions, inventory: session.inventory } as any),
            ).toEqual(lintPathCharset(pathOptions));
            await expect(session.prepare(["index", "compile"])).rejects.toThrow();
            expect(fs.readFileSync(existing, "utf8")).toBe("Keep this output.\n");
            expect(fs.readdirSync(input.config.paths.contentIndex)).toEqual(["keep.txt"]);
            expect(fs.existsSync(input.config.paths.packJson)).toBe(false);
            expect(
                (await session.audit("links")).notes.some((note: any) => note.rel === "Note0.md"),
            ).toBe(true);
        } finally {
            session.dispose();
        }
    });

    it("preserves the index reader's failure when a selected Markdown source cannot be read", async () => {
        const input = repo();
        const file = [...input.files.keys()][0];
        const read = fs.readFileSync;
        vi.spyOn(fs, "readFileSync").mockImplementation((...args: any[]) => {
            if (String(args[0]) === file)
                throw Object.assign(new Error(`EIO: synthetic read failure, open '${file}'`), {
                    code: "EIO",
                });
            return read(...(args as Parameters<typeof fs.readFileSync>));
        });
        expect(() => indexReader.indexRecordsFor({ config: input.config })).toThrow(/EIO/);
        await expect(factory()({ config: input.config })).rejects.toThrow(/EIO/);
        expect(fs.existsSync(input.config.paths.contentIndex)).toBe(false);
        expect(fs.existsSync(input.config.paths.packJson)).toBe(false);
    });

    it("keeps index file selection separate from raw-checker skips", async () => {
        const input = repo();
        const content = input.config.paths.content;
        write(
            path.join(content, "Cache.md"),
            note(
                { type: "lore", subType: "history", shortcode: "cache" },
                "ə <b>Skipped only by raw checks.</b>",
            ),
        );
        write(
            path.join(content, "Ignored/Hidden.md"),
            note({ type: "lore", subType: "history", shortcode: "hidden" }),
        );
        const skipDirectories = ["Templates", "Ignored", "Cache.md"];
        const expected = indexReader.indexRecordsFor({ config: input.config, skipDirectories });
        const session = await factory()({ config: input.config, skipDirectories });
        try {
            expect(session.records).toEqual(expected);
            expect(session.parsed.has(path.join(content, "Cache.md"))).toBe(true);
            expect(session.parsed.has(path.join(content, "Ignored/Hidden.md"))).toBe(false);
            expect(
                lintContentCharset(content, { sources: session.sources, skipDirectories } as any),
            ).toEqual(lintContentCharset(content, { skipDirectories }));
        } finally {
            session.dispose();
        }
    });

    it.each(["equal", "nested"])(
        "preserves physical path order and scope with %s asset roots",
        async (overlap) => {
            const input = repo();
            const assets = input.config.paths.assets;
            const images = path.join(assets, "images");
            const contentBase = overlap === "equal" ? images : assets;
            const skipDirectories = ["images"];
            write(path.join(images, "Páth.png"), "picture");
            write(path.join(images, "Album/Pícture.png"), "picture");
            write(path.join(assets, "other/Námé.txt"), "text");
            const options = { contentBase, assetsBase: assets, skipDirectories };
            const expected = lintPathCharset(options);
            expect(expected.findings.some((finding) => finding.file.endsWith("Páth.png"))).toBe(
                true,
            );
            const session = await factory()({ config: input.config, ...options });
            try {
                expect(
                    lintPathCharset({ ...options, inventory: session.inventory } as any),
                ).toEqual(expected);
            } finally {
                session.dispose();
            }
        },
    );

    it("reports selected read failures in the original index traversal order", async () => {
        const input = repo();
        const content = input.config.paths.content;
        const unreadable = [path.join(content, "A/First.md"), path.join(content, "Z/Last.md")];
        for (const file of unreadable)
            write(file, note({ type: "doc", shortcode: path.basename(file, ".md") }));
        const read = fs.readFileSync;
        vi.spyOn(fs, "readFileSync").mockImplementation((...args: any[]) => {
            if (unreadable.includes(String(args[0])))
                throw Object.assign(new Error(`EIO: ${String(args[0])}`), { code: "EIO" });
            return read(...(args as Parameters<typeof fs.readFileSync>));
        });
        expect(() => indexReader.indexRecordsFor({ config: input.config })).toThrow(unreadable[1]);
        await expect(factory()({ config: input.config })).rejects.toThrow(unreadable[1]);
    });

    it("retains data-only dictionaries, folders, drafts and stub resolution in read-only views", async () => {
        const input = repo();
        const content = input.config.paths.content;
        write(
            path.join(content, "Language.md"),
            note(
                {
                    type: "skill",
                    subType: "language",
                    shortcode: "tongue",
                    name: { full: "Tongue" },
                    data: {
                        fields: [{ name: "Nature", holds: "Natural things." }],
                        words: [{ form: "men", class: "n", field: "Nature", gloss: "stone" }],
                    },
                },
                "",
            ),
        );
        write(
            path.join(content, "Folder/_index.md"),
            note({ type: "folder", shortcode: "group", name: { full: "Group" } }),
        );
        write(
            path.join(content, "Draft.md"),
            note({ type: "lore", subType: "history", shortcode: "draft", tags: ["draft"] }),
        );
        write(
            path.join(content, "Stub.md"),
            note({ type: "lore", subType: "history", shortcode: "stub" }, ""),
        );
        const session = await factory()({ config: input.config });
        try {
            freeze(session.records);
            await session.prepare(["links", "lint"]);
            const index = await session.audit("links");
            expect(index.stubAt("lore-stub")?.rel).toBe("Stub.md");
            expect(index.resolveAddress("lore-stub")).toBeUndefined();
            expect(index.resolveAddress("folder-group")?.rel).toBe("Folder/_index.md");
            expect(index.resolveAddress("lore-draft")?.fm.tags).toEqual(["draft"]);
            const languageFile = path.join(content, "Language.md");
            expect(session.parsed.get(languageFile).body).toBe("");
            expect((await session.linkTables()).get(languageFile).lexical[0].result.rows).toEqual([
                expect.objectContaining({
                    name: "men",
                    field: "Nature",
                    senses: [{ text: "stone", bodies: [] }],
                }),
            ]);
            await expect(session.prepare(["compile"])).rejects.toThrow(/preparation/i);
            expect(fs.existsSync(input.config.paths.packJson)).toBe(false);
        } finally {
            session.dispose();
        }
    });

    it("binds contexts and observes edits/new scopes in fresh independent sessions", async () => {
        const input = repo(8, "first");
        const other = repo(8, "second");
        const create = factory();
        const [first, isolated] = await Promise.all([
            create({ config: input.config }),
            create({ config: other.config }),
        ]);
        const file = [...input.files.keys()][0];
        write(file, note({ type: "doc", shortcode: "edited", name: { full: "Edited" } }));
        const fresh = await create({ config: input.config });
        const expanded = await create({ config: input.config, skipDirectories: [] });
        try {
            expect(first.parsed.get(file).raw).toBe(input.files.get(file));
            expect(fresh.parsed.get(file).frontmatter.shortcode).toBe("edited");
            expect(isolated.records.every((record: any) => record.package === "second")).toBe(true);
            expect(
                first.parsed.has(path.join(input.config.paths.content, "Templates/Skipped.md")),
            ).toBe(false);
            expect(
                expanded.parsed.has(path.join(input.config.paths.content, "Templates/Skipped.md")),
            ).toBe(true);
            expect(expanded.records.some((record: any) => record.shortcode === "skipped")).toBe(
                true,
            );
            expect(() => first.assertContext({ config: other.config })).toThrow(
                /context|configuration|session/i,
            );
            expect(() =>
                first.assertContext({
                    config: input.config,
                    contentBase: other.config.paths.content,
                }),
            ).toThrow(/context|root|session/i);
            expect(() =>
                first.assertContext({ config: input.config, skipDirectories: [] }),
            ).toThrow(/context|scope|session/i);
        } finally {
            first.dispose();
            fresh.dispose();
            expanded.dispose();
            isolated.dispose();
        }
        await expect(first.publication()).rejects.toThrow(/disposed/i);
    });

    it("captures dependency SQL schemas anew for a fresh resolved configuration", async () => {
        const input = repo();
        const sourceFile = [...input.files.keys()][0];
        write(
            sourceFile,
            note(
                { type: "lore", subType: "history", shortcode: "dependency" },
                "```sql\nSELECT name.full AS Release FROM source.notes\n```",
            ),
        );
        const dependency = (version: string, label: string) => {
            const dir = path.join(input.config.paths.metadataCache, `source@${version}`);
            write(
                path.join(dir, "source-metadata.jsonl"),
                JSON.stringify({
                    package: "source",
                    type: "lore",
                    subType: "history",
                    shortcode: "guide",
                    name: { full: label },
                    address: { slug: "lore-guide", canonical: "source-note-lore-guide" },
                    anchors: [],
                    foundry: null,
                    documentation: null,
                }) + "\n",
            );
            write(path.join(dir, ".complete"), "");
            return configFromData(
                {
                    ...YAML.parse(fs.readFileSync(input.configFile, "utf8")),
                    relationships: {
                        requires: [
                            {
                                id: "source",
                                manifest: `https://example.invalid/${version}/module.json`,
                                compatibility: { verified: version },
                            },
                        ],
                    },
                },
                input.configFile,
            );
        };
        const firstConfig = dependency("1.0.0", "First release");
        const first = await factory()({ config: firstConfig });
        const firstTables = await first.sqlTables("all");
        const nextConfig = dependency("2.0.0", "Second release");
        const second = await factory()({ config: nextConfig });
        try {
            expect(first.foreign.index.get("source-note-lore-guide").name).toBe("First release");
            expect(second.foreign.index.get("source-note-lore-guide").name).toBe("Second release");
            expect(firstTables.get(sourceFile)[0].markdown).toContain("First release");
            expect(firstTables.get(sourceFile)[0].markdown).not.toContain("Second release");
            expect((await second.sqlTables("all")).get(sourceFile)[0].markdown).toContain(
                "Second release",
            );
            expect(await first.sqlTables("all")).toBe(firstTables);
            expect(await second.sqlTables("all")).not.toBe(firstTables);
            expect(() => first.assertContext({ config: nextConfig })).toThrow(
                /context|configuration|session/i,
            );
        } finally {
            first.dispose();
            second.dispose();
        }
    });
});
