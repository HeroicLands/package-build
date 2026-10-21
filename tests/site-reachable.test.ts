/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * What a reader can find is what the homepage leads to.
 *
 * `tests/fixtures/reach-site/` has a homepage that links Alpha, Alpha links
 * Bravo, Charlie is linked by nothing, and Delta is linked only from Charlie.
 * Every note is written as a page; the sitemap and the search index cover the
 * pages reachable from the homepage, and nothing else.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { internalLinks, pruneGenerated, reachablePages } from "../engine/site-reach.mjs";
import { cacheNavigation, fixtureConfig } from "./helpers/parity";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "reach-site");
const CLI = path.join(HERE, "..", "bin", "package-build.mjs");

/** A built copy of the fixture: where it is, the site it wrote and the build's result. */
type Built = { scratch: string; site: string; run: ReturnType<typeof spawnSync> };

const made: string[] = [];

/** Build a copy of the fixture, after `edit` has changed the copy. */
function build(edit: (scratch: string) => void = () => {}): Built {
    const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "reach-site-")));
    made.push(scratch);
    fs.cpSync(FIXTURE, scratch, { recursive: true });
    edit(scratch);
    cacheNavigation(fixtureConfig(scratch));
    const run = spawnSync(process.execPath, [CLI, "site", "build"], {
        cwd: scratch,
        encoding: "utf8",
        env: { ...process.env, PACKAGE_BUILD_CONFIG: "" },
    });
    return { scratch, site: path.join(scratch, "build", "site", "reachdemo"), run };
}

/** Every href a written page links, in order. */
const linksOf = (site: string, slug: string) =>
    [
        ...fs
            .readFileSync(path.join(site, slug, "index.html"), "utf8")
            .matchAll(/<a\b[^>]*?\shref="?([^"\s>]+)/g),
    ].map((m) => m[1]);

/** Every page address a sitemap lists, without the origin. */
const sitemapPaths = (xml: string) =>
    [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => new URL(m[1]).pathname).sort();

/** Every page address the search index holds, with the site's base put back. */
function indexedPaths(dir: string): string[] {
    const fragments = path.join(dir, "pagefind", "fragment");
    return fs
        .readdirSync(fragments)
        .map((f) => gunzipSync(fs.readFileSync(path.join(fragments, f))).toString("utf8"))
        .map((text) => `/reachdemo${/"url":"([^"]*)"/.exec(text)?.[1] ?? ""}`)
        .sort();
}

let main: Built;
let queried: Built;

beforeAll(() => {
    main = build();
    // A query on a linked page that selects Charlie's tag.
    queried = build((scratch) => {
        const file = path.join(scratch, "assets", "content", "alpha.md");
        fs.appendFileSync(file, '\n```pagelist {tag="featured"}\n```\n');
    });
}, 240_000);

afterAll(() => {
    for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

describe("package-build site build, for a site with an unlinked branch", () => {
    it("succeeds", () => {
        expect(main.run.stderr).toBe("");
        expect(main.run.status).toBe(0);
    });

    it("writes a page for every note, linked or not", () => {
        for (const page of ["alpha", "bravo", "charlie", "delta"])
            expect(fs.existsSync(path.join(main.site, `doc-${page}`, "index.html")), page).toBe(
                true,
            );
        expect(fs.existsSync(path.join(main.site, "404.html"))).toBe(true);
    });

    it("lists the homepage and the pages it leads to in the sitemap, and no other", () => {
        const xml = fs.readFileSync(path.join(main.site, "sitemap.xml"), "utf8");
        expect(sitemapPaths(xml)).toEqual([
            "/reachdemo/",
            "/reachdemo/doc-alpha/",
            "/reachdemo/doc-bravo/",
        ]);
    });

    it("searches the homepage and the pages it leads to, and no other", () => {
        expect(indexedPaths(main.site)).toEqual([
            "/reachdemo/",
            "/reachdemo/doc-alpha/",
            "/reachdemo/doc-bravo/",
        ]);
    });

    it("leaves the 404 page out of the sitemap and the search", () => {
        expect(fs.readFileSync(path.join(main.site, "sitemap.xml"), "utf8")).not.toContain("404");
        expect(indexedPaths(main.site).join()).not.toContain("404");
    });
});

describe("generated link sections never lead outside the reachable pages", () => {
    it("draws a page that shares a relation with an unlinked page, and links neither Charlie nor Delta", () => {
        // Charlie links Alpha, so Alpha's Related card would list Charlie as a
        // backlink; Alpha's see-also names Charlie outright.
        const charlie = fs.readFileSync(path.join(main.site, "doc-charlie", "index.html"), "utf8");
        expect(linksOf(main.site, "doc-charlie")).toContain("/reachdemo/doc-alpha/");
        expect(charlie).toContain("Alpha");
        for (const slug of ["", "doc-alpha", "doc-bravo"]) {
            const links = linksOf(main.site, slug);
            expect(links, slug).not.toContain("/reachdemo/doc-charlie/");
            expect(links, slug).not.toContain("/reachdemo/doc-delta/");
        }
    });

    it("keeps the Related card for the entries inside, and names nothing outside", () => {
        const alpha = fs.readFileSync(path.join(main.site, "doc-alpha", "index.html"), "utf8");
        expect(alpha).toContain('class="related"');
        expect(alpha).not.toContain("Charlie");
        expect(linksOf(main.site, "doc-bravo")).not.toContain("/reachdemo/doc-charlie/");
    });

    it("keeps the links a page's own text writes, whether or not their target is reachable", () => {
        expect(linksOf(main.site, "doc-charlie")).toContain("/reachdemo/doc-delta/");
    });

    it("makes a page reachable when a query on a reachable page selects it", () => {
        const xml = fs.readFileSync(path.join(queried.site, "sitemap.xml"), "utf8");
        expect(queried.run.stderr).toBe("");
        expect(sitemapPaths(xml)).toEqual([
            "/reachdemo/",
            "/reachdemo/doc-alpha/",
            "/reachdemo/doc-bravo/",
            "/reachdemo/doc-charlie/",
            "/reachdemo/doc-delta/",
        ]);
        expect(indexedPaths(queried.site)).toEqual(sitemapPaths(xml));
        expect(linksOf(queried.site, "doc-alpha")).toContain("/reachdemo/doc-charlie/");
        // Delta is linked from Charlie's own text, which a reader now reaches.
    });
});

describe("reachability, read from rendered links", () => {
    const pages: Record<string, string> = {
        "/s/": '<a href="/s/a/">A</a> <a href=https://elsewhere.example/s/z/>out</a>',
        "/s/a/": '<a href="../b/#top">B</a> <link rel="alternate" href="/s/feed.xml">',
        "/s/b/": "<p>end</p>",
        "/s/c/": '<a href="/s/d/">D</a>',
        "/s/d/": "<p>end</p>",
        "/s/z/": "<p>external target is not ours</p>",
    };
    const html = (url: string) => pages[url];

    it("follows relative and absolute links inside the base, and ignores fragments", () => {
        expect(internalLinks(pages["/s/a/"], "/s/a/", "/s/")).toEqual(["/s/b/", "/s/feed.xml"]);
        expect([...reachablePages({ base: "/s/", html })].sort()).toEqual([
            "/s/",
            "/s/a/",
            "/s/b/",
        ]);
    });

    it("counts the pages a linked feed lists as reachable", () => {
        const expand = (target: string) => (target === "/s/feed.xml" ? ["/s/c/"] : []);
        expect([...reachablePages({ base: "/s/", html, expand })].sort()).toEqual([
            "/s/",
            "/s/a/",
            "/s/b/",
            "/s/c/",
            "/s/d/",
        ]);
    });
});

describe("generated sections with the entries outside a set taken out", () => {
    const sections = [
        '<h1 id="within">Within</h1>',
        '<p><strong>Settlements:</strong> <a href="/a/">A</a>, <a href="/c/">C</a>, <a href="/b/">B</a></p>',
        '<p><strong>Sites:</strong> <a href="/c/">C</a></p>',
        '<h1 id="insongandstory">In song and story</h1>',
        "<ul>",
        '<li><a href="/c/">C</a> (lay)</li>',
        '<li><a href="/b/">B</a> (ballad)</li>',
        "</ul>",
        '<h1 id="events">Events</h1>',
        '<table><tbody><tr><td><a href="/c/">C</a></td></tr></tbody></table>',
        '<h1 id="fromhere">From here</h1>',
        "<figure><svg></svg></figure>",
    ].join("\n");
    const outside = (href: string) => href === "/c/";

    it("drops an entry, its separator, and every list, paragraph, table and heading left empty", () => {
        const pruned = pruneGenerated(sections, outside);
        expect(pruned).not.toContain("/c/");
        expect(pruned).toContain(
            '<p><strong>Settlements:</strong> <a href="/a/">A</a>, <a href="/b/">B</a></p>',
        );
        expect(pruned).toContain('<li><a href="/b/">B</a> (ballad)</li>');
        expect(pruned).not.toContain("Sites");
        expect(pruned).not.toContain("Events");
        expect(pruned).toContain("From here");
    });

    it("keeps links to anything that is not outside the set, and returns nothing when nothing is left", () => {
        expect(pruneGenerated(sections, () => false)).toBe(sections);
        expect(
            pruneGenerated('<h1 id="within">Within</h1>\n<p><a href="/c/">C</a></p>', outside),
        ).toBe("");
    });
});
