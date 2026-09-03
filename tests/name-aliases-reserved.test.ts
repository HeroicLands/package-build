/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `name.aliases` is **reserved**: kept, and read by nothing (#180).
 *
 * The top-level `aliases:` and the nested `name.aliases:` fed one reader
 * between them — the alias index a bare `[[Alias]]` was looked up in — and that
 * index is gone. Only the top-level field is *retired*, though;
 * `name.aliases` is held for a use that does not exist yet, which makes it the
 * one field in the format that is neither refused nor consulted.
 *
 * A reservation is easy to state and easy to lose: the field would only have to
 * be folded into an index, validated for shape, or made to decide a title for
 * the reservation to be over, and nothing about that would look like a mistake
 * at the time. So the cases here pin the *equivalence* rather than any one
 * rule — a note carrying the field compiles, resolves, and addresses exactly as
 * the same note without it — which stays true however the engine is rewritten
 * and fails the moment anything begins to read it.
 *
 * **What "exactly as if absent" does and does not cover.** Every *derived*
 * artifact is byte-identical: the compiled document, the resolved link markup,
 * the link manifest, the site index, the URL. The field itself still rides
 * through into a page's emitted front matter, because the emitter spreads a
 * note's frontmatter wholesale and names neither `name` nor `aliases` — and
 * removing it there would mean *referencing* it, which is the one thing the
 * reservation forbids. Inert passthrough is the intent; the final case pins
 * that the echo is the only difference anywhere.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "../index.mjs";
import { BasePackCompiler } from "../engine/base-compiler.mjs";
import { buildContentLinkIndex } from "../engine/helpers.mjs";
import { convertWikilinks } from "../engine/wikilinks.mjs";
import { emitLinkManifest } from "../engine/manifest-emit.mjs";
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
    const probe = new Probe({ contentBase: content, dest });
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
        scheme: { prefix: "kb/", landing: "readme" },
    }).pages;
}

describe("a note carrying `name.aliases` compiles exactly as one without it", () => {
    it("emits byte-identical pack documents", async () => {
        const [a, b] = await Promise.all([
            compile(withField, "with"),
            compile(withoutField, "without"),
        ]);
        expect(a).toHaveLength(2);
        expect(a).toEqual(b);
    });

    it("is not refused, and is not counted as a finding", async () => {
        // The companion file pins the refusal itself; this pins that the
        // reserved field never reaches it.
        const dest = path.join(root, "out-refusal");
        fs.mkdirSync(dest, { recursive: true });
        const probe = new Probe({ contentBase: withField, dest });
        await probe.compile();
        expect(probe.errorCount).toBe(0);
        expect(probe.compiledCount).toBe(2);
    });
});

describe("a link into it resolves exactly as if the field were absent", () => {
    it("emits the identical `@UUID` markup in the pack build", () => {
        const render = (content: string) => {
            const index = buildContentLinkIndex(content);
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
            const built = buildSiteIndex(pages);
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
        // The reservation's sharpest edge: were the field folded back into an
        // index, `[[doc-Wolfsbane|…]]` — or a bare `[[Wolfsbane]]` — would
        // start resolving. Neither may.
        const built = buildSiteIndex(sitePages(withField));
        for (const key of ["doc/wolfsbane", "wolfsbane", "rules/wolfsbane", "doc/monkshood"]) {
            expect(built.index.has(key)).toBe(false);
        }
        const index = buildContentLinkIndex(withField);
        expect(index.byShortcode.has("wolfsbane")).toBe(false);
    });
});

describe("it reaches no derived address", () => {
    it("emits a byte-identical link manifest", () => {
        const emit = (dir: string, tag: string) => {
            const out = path.join(root, `manifest-${tag}`);
            emitLinkManifest({
                config: defineConfig({
                    rootDir: path.dirname(path.dirname(dir)),
                    contentPackage: "demo",
                    foundryPackage: "demo-module",
                    packageKind: "modules",
                    stats: { lastModifiedBy: "demobuilder0000" },
                    packs: [{ name: "journals", type: "JournalEntry" }],
                    publish: {
                        site: "content",
                        manifests: { publish: true, consume: false },
                        address: { landing: "readme", prefix: "kb/" },
                    },
                }),
                outDir: out,
            });
            return fs.readFileSync(path.join(out, "demo.json"), "utf8");
        };
        expect(emit(withField, "with")).toBe(emit(withoutField, "without"));
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

describe("the only trace of it anywhere is the note's own verbatim echo", () => {
    it("passes through into emitted front matter and changes nothing else", () => {
        const fmOf = (content: string) => {
            const page = sitePages(content).find((p: any) => p.fm.shortcode === "aconite");
            return pageFrontmatter(page, {});
        };
        const a: any = fmOf(withField);
        const b: any = fmOf(withoutField);

        // The echo, and the whole of it: the field arrives unread and unaltered.
        expect(a.name.aliases).toEqual(["Wolfsbane", "Monkshood"]);
        expect(b.name.aliases).toBeUndefined();

        // Everything else — every key, and `name` once its echo is set aside —
        // is identical. Written as a diff rather than a spot-check so a value
        // newly *derived* from the field would fail here.
        expect({ ...a, name: { ...a.name, aliases: undefined } }).toEqual({
            ...b,
            name: { ...b.name, aliases: undefined },
        });
    });
});
