/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `name.aliases` contributes to the note infobox but not to an address.
 * A note carrying aliases keeps the same compiled document, link resolution,
 * link manifest, site index, and URL as a note without them. The site page
 * carries the aliases in frontmatter so its infobox can display them.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "../index.mjs";
import { BasePackCompiler } from "../engine/base-compiler.mjs";
import { indexRecordsFor } from "../engine/content-index.mjs";
import { buildContentLinkIndex } from "../engine/helpers.mjs";
import { convertWikilinks } from "../engine/wikilinks.mjs";
import { emitContentIndex } from "../engine/content-index.mjs";
import { metadataFileName } from "../engine/metadata-index.mjs";
import { collectContentPages, pageFrontmatter } from "../engine/site-build.mjs";
import { buildSiteIndex, wikiContext } from "../engine/site-index.mjs";
import { resolveWebWikilinks } from "../engine/web-wikilinks.mjs";

let root: string;

/**
 * A repository-shaped sandbox holding two notes, one citing the other.
 *
 * The cited note is the one that carries — or does not carry — the reserved
 * field, so the field is in play on both sides of a link as well as on the note
 * that declares it.
 */
function makeTree(withAliases: boolean): string {
    const dir = path.join(root, withAliases ? "with" : "without");
    const content = path.join(dir, "assets/content");
    fs.mkdirSync(path.join(content, "Rules"), { recursive: true });
    fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "sandbox", version: "1.0.0" }),
    );

    const aliases = withAliases ? "    aliases:\n        - Wolfsbane\n        - Monkshood\n" : "";
    fs.writeFileSync(
        path.join(content, "Rules/Aconite.md"),
        `---
type: doc
subType: rules
shortcode: aconite
id: aaaaaaaaaaaaaaaa
name:
    full: Aconite
${aliases}---

Lead prose.

## Onset {#onset}

How it takes hold.
`,
    );
    fs.writeFileSync(
        path.join(content, "Rules/Shock.md"),
        `---
type: doc
subType: rules
shortcode: shock
id: bbbbbbbbbbbbbbbb
name:
    full: Shock
---

Worse than [[doc-aconite|Aconite]], and see [[doc-aconite#onset|its onset]].
`,
    );
    return content;
}

let withField: string;
let withoutField: string;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "name-aliases-"));
    withField = makeTree(true);
    withoutField = makeTree(false);
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** The smallest consumer-shaped pass: it claims `doc` notes and writes them. */
class Probe extends BasePackCompiler {
    static override id = "probes";
    static override label = "probe";

    override selects(fm: any): boolean {
        return fm.type === "doc";
    }

    override buildEntry(fm: any, markdown: string): any {
        return {
            name: fm.name.full,
            _id: fm.id,
            body: markdown,
            folder: this.folderResolver(null),
            _key: `!probes!${fm.id}`,
        };
    }
}

/** Compile a tree and return every emitted document, ordered. */
async function compile(content: string, tag: string): Promise<unknown[]> {
    const dest = path.join(root, `out-${tag}`);
    fs.mkdirSync(dest, { recursive: true });
    const probe = new Probe({ skipDirectories: [], contentBase: content, dest });
    await probe.compile();
    expect(probe.errorCount).toBe(0);
    return fs
        .readdirSync(dest)
        .sort()
        .map((f) => JSON.parse(fs.readFileSync(path.join(dest, f), "utf8")));
}

/** The site pages a tree publishes, address-derived. */
function sitePages(content: string) {
    return collectContentPages(content, {
        packages: new Set(["demo"]),
        contentPackage: "demo",
        skipDirectories: [],
        base: "/demo/",
        mount: "/demo/kb/",
        scheme: { prefix: "kb/" },
    }).pages;
}

describe("a note carrying `name.aliases` keeps the same document identity", () => {
    it("emits byte-identical pack documents", async () => {
        const [a, b] = await Promise.all([
            compile(withField, "with"),
            compile(withoutField, "without"),
        ]);
        expect(a).toHaveLength(2);
        expect(a).toEqual(b);
    });

    it("is not refused, and is not counted as a finding", async () => {
        // Alternate names belong in the name map and pass content validation.
        const dest = path.join(root, "out-refusal");
        fs.mkdirSync(dest, { recursive: true });
        const probe = new Probe({ skipDirectories: [], contentBase: withField, dest });
        await probe.compile();
        expect(probe.errorCount).toBe(0);
        expect(probe.compiledCount).toBe(2);
    });
});

describe("a link into it resolves exactly as if the field were absent", () => {
    it("emits the identical `@UUID` markup in the pack build", () => {
        const render = (content: string) => {
            const index = buildContentLinkIndex(content, undefined, {
                records: indexRecordsFor({ contentBase: content, skipDirectories: [] }),
            });
            const citing = "Worse than [[doc-aconite|Aconite]], and [[doc-aconite#onset|onset]].";
            return convertWikilinks(citing, {
                type: "doc",
                id: "bbbbbbbbbbbbbbbb",
                index,
            });
        };
        const a = render(withField);
        const b = render(withoutField);
        expect(a.markdown).toBe(b.markdown);
        expect(a.unresolved).toEqual(b.unresolved);
        // Not vacuous: the link really did resolve.
        expect(a.markdown).toContain("@UUID[");
        expect(a.markdown).not.toContain("Wolfsbane");
    });

    it("emits the identical markdown link in the site build", () => {
        const render = (content: string) => {
            const pages = sitePages(content);
            const built = buildSiteIndex(pages, { package: pages[0]?.pkg });
            const citing = pages.find((p: any) => p.fm.shortcode === "shock");
            const errors: object[] = [];
            const out = resolveWebWikilinks(
                citing.body,
                wikiContext(built, { src: citing.rel, type: "doc", errors }),
            );
            return { out: out.trim(), errors };
        };
        const a = render(withField);
        const b = render(withoutField);
        expect(a.errors).toEqual([]);
        expect(a.out).toBe(b.out);
        expect(a.out).toContain("/demo/doc-aconite/");
        expect(a.out).not.toContain("Wolfsbane");
    });

    it("never becomes an address of its own", () => {
        // An alternate name is not an address for an authored link.
        const built = buildSiteIndex(sitePages(withField), { package: "demo" });
        for (const key of ["doc/wolfsbane", "wolfsbane", "rules/wolfsbane", "doc/monkshood"]) {
            expect(built.index.has(key)).toBe(false);
        }
        const index = buildContentLinkIndex(withField, undefined, {
            records: indexRecordsFor({ contentBase: withField, skipDirectories: [] }),
        });
        expect(index.byShortcode.has("wolfsbane")).toBe(false);
    });
});

describe("it reaches no derived address", () => {
    // The index is what every other package resolves this one's addresses
    // through, so an address that moved because of this field would
    // move for every consumer.
    //
    // Addresses rather than bytes: the index carries `name.aliases` verbatim,
    // but the aliases do not affect identity.
    it("derives every address identically", () => {
        const emit = (dir: string, tag: string) => {
            const out = path.join(root, `index-${tag}`);
            emitContentIndex({
                config: defineConfig({
                    rootDir: path.dirname(path.dirname(dir)),
                    contentPackage: "demo",
                    foundryPackage: "demo-module",
                    packageKind: "modules",
                    compatibility: { minimum: "14.359" },
                    stats: { lastModifiedBy: "demobuilder0000" },
                    packs: [{ name: "journals", type: "JournalEntry" }],
                    publish: { address: { prefix: "kb/" } },
                }),
                contentBase: dir,
                outDir: out,
            });
            return (
                fs
                    .readFileSync(path.join(out, metadataFileName("demo")), "utf8")
                    .split("\n")
                    .filter(Boolean)
                    .map((line) => JSON.parse(line))
                    // Every address the record states, and nothing that is merely a
                    // fact about the file: an anchor's `line` moves because the
                    // aliased note has three more frontmatter lines, which is the
                    // echo itself and not a derived address.
                    .map((r) => [
                        r.address?.canonical,
                        r.address?.slug,
                        r.foundry,
                        (r.anchors ?? []).map((a: { link: string }) => a.link),
                    ])
                    .sort()
            );
        };
        expect(emit(withField, "with")).toEqual(emit(withoutField, "without"));
    });

    it("gives every page the same URL, slug, section and title", () => {
        const shape = (content: string) =>
            sitePages(content)
                .map((p: any) => ({
                    url: p.url,
                    slug: p.slug,
                    sec: p.sec,
                    name: p.name,
                    isReadme: p.isReadme,
                }))
                .sort((x: any, y: any) => x.url.localeCompare(y.url));
        expect(shape(withField)).toEqual(shape(withoutField));
    });

    it("builds the identical site index", () => {
        const flat = (content: string) =>
            [...buildSiteIndex(sitePages(content)).index.entries()].sort();
        expect(flat(withField)).toEqual(flat(withoutField));
    });
});

describe("aliases reach the site page", () => {
    it("passes them through into emitted front matter", () => {
        const fmOf = (content: string) => {
            const page = sitePages(content).find((p: any) => p.fm.shortcode === "aconite");
            return pageFrontmatter(page, {});
        };
        const a: any = fmOf(withField);
        const b: any = fmOf(withoutField);

        // The infobox reads this ordered list from the emitted frontmatter.
        expect(a.name.aliases).toEqual(["Wolfsbane", "Monkshood"]);
        expect(b.name.aliases).toBeUndefined();

        // The aliases do not change other page metadata.
        expect({ ...a, name: { ...a.name, aliases: undefined } }).toEqual({
            ...b,
            name: { ...b.name, aliases: undefined },
        });
    });
});
