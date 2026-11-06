/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * `./note-page` renders one note to the body its site page carries, against
 * records it keeps under `build/` while their inputs are unchanged.
 *
 * The parity fixture is built as `site build` builds it. Each note rendered
 * on its own must then equal the body of its built page: the corpus note
 * holds query fences, inline queries and inline verse, and the lost note an
 * unresolved link. The cache must answer exactly what deriving everything
 * again answers, and must be discarded, at the grain the change reaches,
 * whenever an input changes.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import v8 from "node:v8";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readCanonicalKey } from "../engine/address.mjs";
import { AddressEntries, AddressLink } from "../engine/address-values.mjs";
import { minifyHtml } from "../engine/html-minify.mjs";
import {
    loadForeignIndexes,
    markComplete,
    metadataCacheDir,
    metadataFileName,
} from "../engine/metadata-index.mjs";
import {
    noteCacheDirectory,
    noteTree,
    packValue,
    toolchainFingerprint,
    unpackValue,
} from "../engine/note-cache.mjs";
import { renderNoteFile } from "../engine/note-page.mjs";
import { prepareTreeSqlTables } from "../engine/sql-tables.mjs";
import {
    CORPUS_NOTE,
    FENCED_NOTE,
    LOST_NOTE,
    NAMED_NOTE,
    WORDED_NOTE,
    buildHtmlSite,
    copyFixture,
    fixtureConfig,
} from "./helpers/parity";

let root: string;
let out: string;
let config: any;

beforeAll(async () => {
    root = copyFixture();
    ({ out } = await buildHtmlSite(root));
    config = fixtureConfig(root);
}, 240_000);

afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
});

const OPEN = '<div class="single-body" data-pagefind-body>';
const NAMES = /^\s*<span data-pagefind-weight="\d+" hidden>[^<]*<\/span>\s*/;

/** What follows a built page's body opening, its search names taken off. */
function builtBody(slug: string): string {
    const page = fs.readFileSync(path.join(out, slug, "index.html"), "utf8");
    const at = page.indexOf(OPEN);
    expect(at).toBeGreaterThan(-1);
    return page.slice(at + OPEN.length).replace(NAMES, "");
}

/** That a built page's body is exactly `html`, as the site writer minifies it. */
function expectBody(slug: string, html: string) {
    const expected = minifyHtml(html).trim();
    expect(expected).not.toBe("");
    const body = builtBody(slug);
    expect(body.slice(0, expected.length)).toBe(expected);
    expect(body.slice(expected.length)).toMatch(/^\s*<\/div>/);
}

const slugOf = (note: string) => path.basename(note, ".md");
const notePath = (note: string) => path.join("assets", "content", note);

describe("renderNoteFile", () => {
    it.each([CORPUS_NOTE, LOST_NOTE, FENCED_NOTE, NAMED_NOTE, WORDED_NOTE])(
        "renders %s as the body of its built page, from the cache and without it",
        async (note) => {
            const cached = await renderNoteFile(notePath(note), { root });
            expectBody(slugOf(note), cached.html);
            const derived = await renderNoteFile(notePath(note), { root, cache: false });
            expect(derived.cache).toMatchObject({ tree: "off", tables: "off" });
            expect(derived.html).toBe(cached.html);
            expect(derived.findings).toEqual(cached.findings);
        },
        60_000,
    );

    it("reports what the site build reports, located in the note", async () => {
        const { findings } = await renderNoteFile(notePath(LOST_NOTE), { root });
        expect(findings).toEqual([
            expect.objectContaining({
                file: path.join(root, "assets", "content", LOST_NOTE),
                line: 9,
                column: 13,
                severity: "error",
                message: expect.stringContaining("[[place-nowhere]] resolves to no note"),
            }),
        ]);
    });

    it("hands over the theme's body styles", async () => {
        const { styles } = await renderNoteFile(notePath(LOST_NOTE), { root });
        for (const rule of [".sohl-unresolved-link", ".verse", ".single-content table", "hljs"])
            expect(styles).toContain(rule);
    });

    it("refuses a file that is not a note of the content tree", async () => {
        await expect(renderNoteFile("package-build.config.yaml", { root })).rejects.toThrow(
            /not a note of the content tree/,
        );
    });
});

describe("prepareTreeSqlTables with only", () => {
    it("answers one note exactly as the whole tree's preparation does, and no other", async () => {
        const file = path.join(config.paths.content, CORPUS_NOTE);
        const whole = await prepareTreeSqlTables(config.paths.content, {
            config,
            audience: "public",
        });
        const one = await prepareTreeSqlTables(config.paths.content, {
            config,
            audience: "public",
            only: file,
        });
        expect([...one!.keys()]).toEqual([file]);
        expect(whole!.size).toBeGreaterThan(1);
        const own = (prepared: any) => ({
            ...prepared.get(file),
            rows: [...prepared.get(file)],
            inline: prepared.inline?.get(file),
            pageLists: prepared.pageLists?.get(file),
        });
        expect(own(one)).toEqual(own(whole));
    }, 60_000);
});

describe("packValue", () => {
    it("restores Addresses, links, Address maps, containers and sharing exactly", () => {
        const tuple = readCanonicalKey("parity-note-lore-corpus");
        const shared = { tuple, list: [1, undefined, "x"] };
        const tagged = Object.assign([1, 2], { anchors: ["a"] });
        const map = Object.assign(new Map([[tuple, shared]]), { inline: new Map([["k", 1]]) });
        const value = {
            tuple,
            link: new AddressLink(tuple, "words", "prose"),
            entries: new AddressEntries([{ target: tuple, value: "v", sourceKey: "corpus" }]),
            shared,
            again: shared,
            tagged,
            map,
            set: new Set(["s"]),
            date: new Date(0),
            missing: undefined,
            bare: Object.assign(Object.create(null), { a: 1 }),
            lookalike: { "\u0000pb": "address", key: "not-an-address" },
        };
        const back: any = unpackValue(packValue(value));
        expect(isDeepStrictEqual(back, value)).toBe(true);
        expect(back.again).toBe(back.shared);
        expect(back.link).toBeInstanceOf(AddressLink);
        expect(back.entries).toBeInstanceOf(AddressEntries);
        expect(readCanonicalKey(back.tuple)).toBe(back.tuple);
        expect(back.lookalike).toEqual({ "\u0000pb": "address", key: "not-an-address" });
    });

    it("refuses a function rather than dropping it", () => {
        expect(() => packValue({ run: () => 1 })).toThrow(/cannot be cached/);
    });
});

describe("the note cache", () => {
    let cacheRoot: string;
    let cacheConfig: any;
    const corpus = () => path.join(cacheConfig.paths.content, CORPUS_NOTE);
    /** The tree and one note's answers, with what the cache did for both. */
    async function tree(options: Record<string, unknown> = {}, only = corpus()): Promise<any> {
        const read: any = await noteTree(cacheConfig, options);
        const { sqlTables, tables } = await read.answers([only]);
        return {
            records: read.records,
            foreign: read.foreign,
            sqlTables,
            cache: { ...read.cache, tables },
        };
    }
    const noteCount = () =>
        fs
            .readdirSync(cacheConfig.paths.content, { recursive: true })
            .filter((name: any) => String(name).endsWith(".md")).length;
    /** Every file under the root but the cache, with its bytes. */
    const outsideCache = () => {
        const cache = noteCacheDirectory(cacheConfig);
        return fs
            .readdirSync(cacheRoot, { recursive: true, withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => path.join(entry.parentPath, entry.name))
            .filter((file) => !file.startsWith(cache + path.sep))
            .sort()
            .map((file) => [file, fs.readFileSync(file, "utf8")]);
    };
    /** That a cached answer is the one deriving everything again gives. */
    async function expectDerivedAgain(answer: any, only = corpus()) {
        const fresh = await tree({ cache: false }, only);
        expect(isDeepStrictEqual(answer.records, fresh.records)).toBe(true);
        expect(isDeepStrictEqual(answer.sqlTables, fresh.sqlTables)).toBe(true);
    }

    beforeAll(() => {
        cacheRoot = copyFixture();
        cacheConfig = fixtureConfig(cacheRoot);
    });

    afterAll(() => {
        if (cacheRoot) fs.rmSync(cacheRoot, { recursive: true, force: true });
    });

    it("derives everything once, then reuses it whole", async () => {
        const before = outsideCache();
        const first = await tree();
        expect(first.cache).toEqual({ tree: "miss", notes: noteCount(), tables: "miss" });
        const second = await tree();
        expect(second.cache).toEqual({ tree: "hit", notes: 0, tables: "hit" });
        await expectDerivedAgain(second);
        expect(outsideCache()).toEqual(before);
        expect(fs.readdirSync(noteCacheDirectory(cacheConfig)).sort()).toEqual([
            "notes.v8",
            "tree.v8",
        ]);
    }, 120_000);

    it("answers another note's queries beside the same records", async () => {
        const other = path.join(cacheConfig.paths.content, FENCED_NOTE);
        const first = await tree({}, other);
        expect(first.cache).toEqual({ tree: "hit", notes: 0, tables: "miss" });
        const second = await tree({}, other);
        expect(second.cache).toEqual({ tree: "hit", notes: 0, tables: "hit" });
        expect((await tree()).cache.tables).toBe("hit");
        // Answers prepared together are each note's own.
        const read: any = await noteTree(cacheConfig, { cache: false });
        const both = (await read.answers([corpus(), other])).sqlTables;
        for (const file of [corpus(), other]) {
            const alone = (await read.answers([file])).sqlTables;
            expect(isDeepStrictEqual(both.get(file), alone.get(file))).toBe(true);
            expect(isDeepStrictEqual(both.inline.get(file), alone.inline.get(file))).toBe(true);
            expect(isDeepStrictEqual(both.pageLists.get(file), alone.pageLists.get(file))).toBe(
                true,
            );
        }
    }, 120_000);

    it("re-derives only a note whose text changed, and answers as a full derivation", async () => {
        const file = path.join(cacheConfig.paths.content, NAMED_NOTE);
        const text = fs.readFileSync(file, "utf8");
        fs.writeFileSync(file, `${text}\nOne more paragraph.\n`);
        const changed = await tree();
        expect(changed.cache).toEqual({ tree: "miss", notes: 1, tables: "miss" });
        await expectDerivedAgain(changed);
        expect((await tree()).cache).toEqual({ tree: "hit", notes: 0, tables: "hit" });
    }, 120_000);

    it("re-derives every note when a note's address changes", async () => {
        const file = path.join(cacheConfig.paths.content, NAMED_NOTE);
        const text = fs.readFileSync(file, "utf8");
        fs.writeFileSync(file, text.replace(/^shortcode: .*$/m, "shortcode: renamed"));
        const renamed = await tree();
        expect(renamed.cache).toEqual({ tree: "miss", notes: noteCount(), tables: "miss" });
        await expectDerivedAgain(renamed);
        fs.writeFileSync(file, text);
    }, 120_000);

    it("re-derives every note when the configuration or the toolchain changes", async () => {
        await tree();
        const file = path.join(cacheRoot, "package-build.config.yaml");
        const text = fs.readFileSync(file, "utf8");
        fs.writeFileSync(file, `${text}\n# changed\n`);
        const reconfigured = await tree();
        expect(reconfigured.cache).toEqual({ tree: "miss", notes: noteCount(), tables: "miss" });
        const retooled = await tree({ toolchain: `${toolchainFingerprint()}-other` });
        expect(retooled.cache).toEqual({ tree: "miss", notes: noteCount(), tables: "miss" });
        await expectDerivedAgain(retooled);
    }, 120_000);

    it("derives again over a corrupt store, and replaces it", async () => {
        await tree();
        const dir = noteCacheDirectory(cacheConfig);
        for (const name of ["notes.v8", "tree.v8"])
            fs.writeFileSync(path.join(dir, name), "not a store");
        const rebuilt = await tree();
        expect(rebuilt.cache).toEqual({ tree: "miss", notes: noteCount(), tables: "miss" });
        await expectDerivedAgain(rebuilt);
        expect((await tree()).cache).toEqual({ tree: "hit", notes: 0, tables: "hit" });
    }, 120_000);
    it("reuses a linked note's answers even where the note's own cannot be kept", async () => {
        const language = path.join(cacheConfig.paths.content, "Skills", "skill-tarvenlng.md");
        const linking = path.join(cacheConfig.paths.content, "Lore", "lore-linking.md");
        fs.writeFileSync(
            linking,
            "---\ntype: lore\nshortcode: linking\nname:\n    full: Linking\n---\n\n" +
                "See [[skill-tarvenlng|the tongue]].\n",
        );
        try {
            const render = (file: string) =>
                renderNoteFile(file, { root: cacheRoot }) as Promise<any>;
            await render(linking);
            const linked = await render(linking);
            expect(linked.cache).toMatchObject({ tree: "hit", tables: "hit" });
            const own = await render(language);
            expect(own.cache).toMatchObject({ tree: "hit", tables: "miss" });
            const uncached: any = await renderNoteFile(language, {
                root: cacheRoot,
                cache: false,
            });
            expect(own.html).toBe(uncached.html);
            expect((await render(linking)).html).toBe(linked.html);
        } finally {
            fs.rmSync(linking);
        }
    }, 120_000);

    /** Rewrite one store in place, its key kept, with `change` applied. */
    function rewriteStore(name: string, change: (store: any) => void) {
        const file = path.join(noteCacheDirectory(cacheConfig), name);
        const store: any = v8.deserialize(fs.readFileSync(file));
        change(store);
        fs.writeFileSync(file, v8.serialize(store));
    }

    it("derives again over a store whose entries unpack to the wrong shape", async () => {
        await tree();
        rewriteStore("tree.v8", (store) => {
            store.records = packValue({});
        });
        const records = await tree();
        expect(records.cache.tree).toBe("miss");
        await expectDerivedAgain(records);

        const rel = path.relative(cacheConfig.paths.content, corpus());
        rewriteStore("tree.v8", (store) => {
            store.tables.set(rel, packValue({}));
        });
        const answers = await tree();
        expect(answers.cache).toEqual({ tree: "hit", notes: 0, tables: "miss" });
        await expectDerivedAgain(answers);

        rewriteStore("notes.v8", (store) => {
            for (const entry of store.notes.values()) {
                entry.records = packValue({ not: "records" });
                entry.bare = packValue(["not a parse"]);
            }
        });
        fs.rmSync(path.join(noteCacheDirectory(cacheConfig), "tree.v8"));
        const notes = await tree();
        expect(notes.cache).toEqual({ tree: "miss", notes: noteCount(), tables: "miss" });
        await expectDerivedAgain(notes);
        expect((await tree()).cache).toEqual({ tree: "hit", notes: 0, tables: "hit" });
    }, 120_000);

    it("derives again over answers and parses whose nested values have the wrong shape", async () => {
        await tree();
        const rel = path.relative(cacheConfig.paths.content, corpus());
        const good = await tree({ cache: false });
        for (const bad of [
            { kind: "note-answers", inline: {} },
            { kind: "note-answers", inline: new Map([["SELECT 7", "seven"]]) },
            { kind: "note-answers", pageLists: {} },
            { kind: "note-answers", pageLists: ["not a list result"] },
            { kind: "note-answers", rows: ["not a table"] },
            { kind: "note-answers", rows: Object.assign([], { anchors: "not anchors" }) },
            { kind: "note-answers", rows: Object.assign([], { generated: 7 }) },
            { kind: "note-answers", rows: [{ rows: 1, markdown: 7 }] },
            { kind: "note-answers", rows: [{ rows: "1", markdown: "| a |" }] },
            { kind: "note-answers", rows: [{ reason: 5 }] },
            { kind: "note-answers", rows: [{ markdown: "| a |", rows: 1, allowEmpty: "no" }] },
            { kind: "note-answers", rows: Object.assign([], { declared: [{ slug: 1 }] }) },
            { kind: "note-answers", pageLists: [{ markdown: 7, pages: 1 }] },
            { kind: "note-answers", pageLists: [{ markdown: "", pages: "x", empty: "" }] },
            { kind: "note-answers", inline: new Map([["SELECT 7", { error: 7 }]]) },
            { kind: "note-answers", rows: [{ reason: "", line: 1, column: 1 }] },
            { kind: "note-answers", pageLists: [{ reason: "" }] },
            { kind: "note-answers", inline: new Map([["SELECT 7", { error: "" }]]) },
        ]) {
            rewriteStore("tree.v8", (store) => {
                store.tables.set(rel, packValue(bad));
            });
            const answered = await tree();
            expect(answered.cache, JSON.stringify(bad)).toEqual({
                tree: "hit",
                notes: 0,
                tables: "miss",
            });
            expect(isDeepStrictEqual(answered.sqlTables, good.sqlTables)).toBe(true);
        }
        rewriteStore("tree.v8", (store) => {
            store.tables = new Map();
            store.parsed = packValue(new Map([[corpus(), { not: "a parse" }]]));
        });
        const reparsed = await tree();
        expect(reparsed.cache).toEqual({ tree: "hit", notes: 0, tables: "miss" });
        expect(isDeepStrictEqual(reparsed.sqlTables, good.sqlTables)).toBe(true);
    }, 120_000);

    it("stores only what was derived from the dependency indexes its key names", async () => {
        const id = "pub";
        const configFile = path.join(cacheRoot, "package-build.config.yaml");
        const text = fs.readFileSync(configFile, "utf8");
        fs.writeFileSync(
            configFile,
            `${text}\nrelationships:\n    requires:\n        - { id: ${id}, manifest: "https://example.invalid/module.json" }\n`,
        );
        cacheConfig = fixtureConfig(cacheRoot);
        const dir = metadataCacheDir(cacheConfig, id, "1.0.0");
        const index = path.join(dir, metadataFileName(id));
        const publish = (name: string) => {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(
                index,
                JSON.stringify({
                    package: id,
                    type: "lore",
                    shortcode: "craft",
                    name: { full: name },
                    address: { canonical: `${id}-note-lore-craft`, slug: "lore-craft" },
                    anchors: [],
                }) + "\n",
            );
            markComplete(dir);
        };
        publish("Old Craft");
        let loads = 0;
        // A fetch that lands while the indexes are being read.
        const loadForeign = (config: any, local: string[]) => {
            loads += 1;
            const read = loadForeignIndexes(config, local);
            if (loads === 1) publish("New Craft");
            return read;
        };
        const name = (read: any) => read.foreign.index.get(`${id}-note-lore-craft`)?.name;
        const raced = await tree({ loadForeign });
        expect(loads).toBe(2);
        expect(name(raced)).toBe("New Craft");
        const again = await tree();
        expect(again.cache.tree).toBe("hit");
        expect(name(again)).toBe("New Craft");
        await expectDerivedAgain(again);
    }, 120_000);
    it("refuses answers prepared while the dependency indexes moved, and stores none", async () => {
        const id = "pub";
        const dir = metadataCacheDir(cacheConfig, id, "1.0.0");
        const index = path.join(dir, metadataFileName(id));
        const bytes = fs.readFileSync(index, "utf8");
        await tree();
        const other = path.join(cacheConfig.paths.content, FENCED_NOTE);
        const rel = path.relative(cacheConfig.paths.content, other);
        let prepared = 0;
        // A fetch that lands while a note's answers are being prepared.
        const prepareTables = async (...args: any[]) => {
            prepared += 1;
            fs.writeFileSync(index, bytes.replace("New Craft", "Newer Craft"));
            return (prepareTreeSqlTables as any)(...args);
        };
        const read: any = await noteTree(cacheConfig, { prepareTables });
        expect(read.cache.tree).toBe("hit");
        await expect(read.answers([other], other)).rejects.toThrow(/changed while/);
        expect(prepared).toBe(1);
        const stored: any = v8.deserialize(
            fs.readFileSync(path.join(noteCacheDirectory(cacheConfig), "tree.v8")),
        );
        expect(stored.tables.has(rel)).toBe(false);
        const after = await tree({}, other);
        expect(after.cache.tree).toBe("miss");
        await expectDerivedAgain(after, other);
    }, 120_000);
});

describe("renderNoteFile when the configuration moves under it", () => {
    let movedRoot: string;

    beforeAll(() => {
        movedRoot = copyFixture();
    });

    afterAll(() => {
        if (movedRoot) fs.rmSync(movedRoot, { recursive: true, force: true });
    });

    it("resolves the configuration again, and answers as a fresh call would", async () => {
        const configFile = path.join(movedRoot, "package-build.config.yaml");
        const moved = path.join(movedRoot, "assets", "moved");
        fs.cpSync(path.join(movedRoot, "assets", "content"), moved, { recursive: true });
        let prepared = 0;
        // The configuration moves the content tree while the first answers
        // are prepared.
        const prepareTables = async (...args: any[]) => {
            prepared += 1;
            if (prepared === 1)
                fs.writeFileSync(
                    configFile,
                    `${fs.readFileSync(configFile, "utf8")}\npaths:\n    content: assets/moved\n`,
                );
            return (prepareTreeSqlTables as any)(...args);
        };
        const note = notePath(CORPUS_NOTE);
        await expect(renderNoteFile(note, { root: movedRoot, prepareTables })).rejects.toThrow(
            /not a note of the content tree/,
        );
        expect(prepared).toBe(1);
        await expect(renderNoteFile(note, { root: movedRoot })).rejects.toThrow(
            /not a note of the content tree/,
        );
        const fresh = await renderNoteFile(path.join("assets", "moved", CORPUS_NOTE), {
            root: movedRoot,
            prepareTables,
        });
        expect(fresh.cache.tree).toBe("miss");
        expect(fresh.findings).toEqual(
            (
                await renderNoteFile(path.join("assets", "moved", CORPUS_NOTE), {
                    root: movedRoot,
                    cache: false,
                })
            ).findings,
        );
    }, 240_000);
});

describe("renderNoteFile against the notes a page links", () => {
    let siteRoot: string;
    const note = (rel: string, frontmatter: string, body: string) => {
        const file = path.join(siteRoot, "assets", "content", rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `---\n${frontmatter.trim()}\n---\n\n${body}`);
        return path.join("assets", "content", rel);
    };

    beforeAll(() => {
        siteRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "note-page-linked-")));
        fs.writeFileSync(
            path.join(siteRoot, "package.json"),
            JSON.stringify({ name: "sandbox", version: "1.0.0" }),
        );
        fs.writeFileSync(
            path.join(siteRoot, "package-build.config.yaml"),
            [
                "contentPackage: demo",
                "packageKind: modules",
                'compatibility: { minimum: "14.359" }',
                "stats: { lastModifiedBy: demobuilder0000 }",
                "packs:",
                "    - { name: journals, type: JournalEntry, default: true }",
                "",
            ].join("\n"),
        );
        fs.mkdirSync(path.join(siteRoot, "build", "cache", "metadata"), { recursive: true });
        note(
            "Places/Alpha.md",
            "type: place\nsubType: region\nshortcode: alpha\nname:\n    full: Alpha\ndata:\n    borders:\n        - { to: beta, bearing: E }",
            "West of [[place-beta|Beta]].\n",
        );
        note(
            "Places/Beta.md",
            "type: place\nsubType: region\nshortcode: beta\nname:\n    full: Beta\ndata:\n    borders:\n        - { to: alpha, bearing: W }",
            "East of [[place-alpha|Alpha]].\n",
        );
        note(
            "Rules/Target.md",
            "type: doc\nsubType: rules\nshortcode: target\nname:\n    full: Target",
            [":@ The great beast. {#thorn}", "", "```text", "alpha", "```"].join("\n") + "\n",
        );
        note(
            "Rules/Citing.md",
            "type: doc\nsubType: rules\nshortcode: citing\nname:\n    full: Citing",
            'See {{ref "doc-target#thorn"}}, and [[place-alpha#fromhere|the map from Alpha]].\n',
        );
    });

    afterAll(() => {
        if (siteRoot) fs.rmSync(siteRoot, { recursive: true, force: true });
    });

    it("sets a place's drawing inline in its From here section", async () => {
        const { html, findings } = await renderNoteFile("assets/content/Places/Alpha.md", {
            root: siteRoot,
        });
        expect(findings).toEqual([]);
        expect(html).toMatch(/<figure class="note-image note-image-full-width"[^>]*>\s*<svg/);
        expect(html).not.toContain("from-alpha.svg");
    }, 120_000);

    it("resolves a cross-note figure and a linked page's generated anchor", async () => {
        const { html, findings, cache } = await renderNoteFile("assets/content/Rules/Citing.md", {
            root: siteRoot,
        });
        expect(findings).toEqual([]);
        expect(html).toContain('href="/demo/doc-target/#thorn"');
        expect(html).toContain("Code 1");
        expect(html).toContain('href="/demo/place-alpha/#fromhere"');
        const again = await renderNoteFile("assets/content/Rules/Citing.md", { root: siteRoot });
        expect(again.html).toBe(html);
        expect(again.cache).toEqual({ ...cache, tree: "hit", notes: 0, tables: "hit" });
    }, 120_000);

    it("hands over the effective body typography and link rules, scoped to the body", async () => {
        const { styles } = await renderNoteFile("assets/content/Rules/Target.md", {
            root: siteRoot,
        });
        expect(styles).toMatch(/\.single-content \{[^}]*font-family: var\(--font-body\)/);
        expect(styles).toMatch(/\.single-content \{[^}]*line-height: 1\.7/);
        expect(styles).toMatch(/\.single-content \{[^}]*color: var\(--text\)/);
        expect(styles).toMatch(/\.single-content a \{[^}]*color: var\(--accent\)/);
        expect(styles).toMatch(/\.single-content a:hover \{[^}]*color: var\(--accent-hover\)/);
        expect(styles).toMatch(/\.single-body a \{[^}]*border-bottom/);
        expect(styles).toMatch(/:root \{[^}]*font-size: 17px/);
        expect(styles).not.toMatch(/(^|\})\s*(body|html|a)\s*\{/);
    }, 120_000);
});
