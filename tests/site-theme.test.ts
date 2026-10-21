/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The site layouts: what they draw, what they leave out, and the addresses they
 * resolve.
 *
 * A section with nothing to show is not drawn. The check in
 * `tests/helpers/empty-shells.ts` reads each finished page for an element that
 * holds only whitespace or only its heading, and every layout is drawn here from
 * data that is complete and from data that is not. A layout broken on purpose
 * proves the check can fail.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { highlightRules, siteCodeStylesheet } from "../engine/content-styles.mjs";
import { bannerUrl } from "../engine/site-theme-banner.mjs";
import {
    LAYOUTS,
    SITE_THEME_DIR,
    createSiteTheme,
    neighbours,
    pageHeadings,
    siteThemeAssets,
    tableOfContents,
} from "../engine/site-theme.mjs";
import { cdnUrl, relUrl, safeUrl, siteUrl, tagUrl } from "../engine/site-theme-urls.mjs";
import { describeShell, emptyShells } from "./helpers/empty-shells";

/** A site that configures everything a layout can draw from. */
const FULL = {
    title: "The Site",
    baseURL: "https://www.heroiclands.org/demo/",
    year: 2026,
    feed: { title: "The Site", url: "/demo/blog/atom.xml", section: "blog" },
    params: {
        description: "A site.",
        cdnBaseURL: "https://cdn.example.org",
        search: true,
        scriptFonts: "fonts/a.css",
        brand: {
            logo: "images/logo.webp",
            licenseURL: "https://www.heroiclands.org/license/",
            discordURL: "https://discord.example.org/x",
        },
        home: {
            heroimage: "images/banners/home.webp",
            herotitle: "Welcome",
            herotagline: "Start here.",
            headings: [{ title: "Play", class: "play" }],
            cards: [{ title: "Rules", url: "/demo/rules/", text: "The rules.", image: "a.webp" }],
        },
        notfound: { links: [{ title: "Home", url: "/", text: "From the top." }] },
    },
    menu: [
        { name: "Home", url: "https://www.heroiclands.org/" },
        {
            name: "More",
            url: "https://www.heroiclands.org/more/",
            children: [{ name: "A", url: "/a/" }],
        },
    ],
};

/** A site that configures nothing. */
const BARE = {
    title: "Bare",
    baseURL: "https://example.org/",
    year: 2026,
    feed: { title: "Bare", url: "/blog/atom.xml", section: "blog" },
};

const box = (sections: object[], extra: object = {}) => ({
    id: "note",
    kind: "note",
    title: "Profile",
    sections,
    ...extra,
});

/** Pages the layouts are drawn from, complete and not. */
const PAGES: Record<string, object> = {
    "a page with a title only": {
        kind: "page",
        title: "Bare",
        url: "/demo/bare/",
        params: {},
        content: "",
    },
    "a page whose boxes hold nothing": {
        kind: "page",
        title: "Hollow",
        url: "/demo/hollow/",
        params: {
            infoboxes: [
                box([
                    { id: "a", layout: "rows", rows: [] },
                    { id: "b", layout: "list", entries: [] },
                ]),
                box([], { kind: "system", id: "sys" }),
                box([{ id: "c", layout: "mystery" }]),
                box([{ id: "d", layout: "runin", groups: [{ label: "G", entries: [] }] }]),
                box([
                    {
                        id: "e",
                        layout: "rows",
                        rows: [{ label: "Empty", kind: "text", value: "" }],
                    },
                ]),
            ],
            related: { seeAlso: [], backlinks: [], mentions: [] },
            tags: ["draft"],
        },
        content: "",
    },
    "a draft page with no other content": {
        kind: "page",
        title: "Draft",
        url: "/demo/draft/",
        params: { tags: ["Draft"], type: "lore" },
        content: "  \n",
    },
    "a page that has everything": {
        kind: "page",
        title: "Everything",
        url: "/demo/everything/",
        params: {
            type: "being",
            subType: "npc",
            package: "demo",
            description: "All of it.",
            date: "2024-03-02",
            tags: ["a", "b", "draft"],
            infoboxes: [
                box([
                    {
                        id: "profile",
                        label: "Basics",
                        layout: "rows",
                        rows: [
                            { label: "Name", kind: "text", value: "Everything" },
                            { label: "Count", kind: "number", value: 1234567 },
                            { label: "Zero", kind: "number", value: 0 },
                            {
                                label: "Home",
                                kind: "link",
                                value: { text: "Home", url: "/demo/home/" },
                            },
                            { label: "Tongues", kind: "list", value: ["One", "Two"] },
                        ],
                    },
                    { id: "attrs", layout: "grid", cells: [{ label: "STR", value: 12 }] },
                    {
                        id: "skills",
                        layout: "runin",
                        groups: [
                            { label: "Combat", entries: [{ text: "Sword", url: "/demo/sword/" }] },
                        ],
                    },
                    { id: "gifts", layout: "list", entries: [{ text: "Flight" }] },
                ]),
                box([], { kind: "system", id: "sys", statement: "Not available" }),
            ],
            related: {
                seeAlso: [{ title: "Other", url: "/demo/other/", gloss: "the other" }],
                mentions: [{ title: "M", url: "/demo/m/", type: "lore" }],
                backlinks: [{ title: "B", url: "/demo/b/", type: "place" }],
            },
        },
        content: [
            '<h2 id="a">A</h2><p>x</p><h2 id="b">B</h2><h3 id="b1">B1</h3>',
            '<h2 id="c">C</h2><h2 id="d">D</h2>',
        ].join(""),
        siblings: [
            { url: "/demo/z/", title: "Z", type: "being" },
            { url: "/demo/everything/", title: "Everything", type: "being" },
            { url: "/demo/a/", title: "A", type: "being" },
        ],
    },
    "a homepage note with a body": {
        kind: "home",
        title: "Home",
        url: "/demo/",
        params: { type: "homepage" },
        content: "<p>Welcome.</p>",
    },
    "a homepage note with no body": {
        kind: "home",
        title: "Home",
        url: "/demo/",
        params: { type: "homepage" },
        content: "",
    },
    "a home page of cards": { kind: "home", title: "Home", url: "/demo/", params: {}, content: "" },
    "a section with a body and members": {
        kind: "section",
        section: "rules",
        title: "Rules",
        url: "/demo/rules/",
        params: {},
        content: '<p><a href="/demo/rules/one/">One</a></p>',
        members: [
            { url: "/demo/rules/one/", title: "One", content: "<p>One.</p>" },
            { url: "/demo/rules/two/", title: "Two", description: "Second", content: "" },
        ],
    },
    "a section with a body that reaches every member": {
        kind: "section",
        section: "rules",
        title: "Rules",
        url: "/demo/rules/",
        params: {},
        content: '<p><a href="/demo/rules/one/">One</a></p>',
        members: [{ url: "/demo/rules/one/", title: "One", content: "" }],
    },
    "a section with nothing in it": {
        kind: "section",
        section: "rules",
        title: "Rules",
        url: "/demo/rules/",
        params: {},
        content: "",
        members: [],
    },
    "a taxonomy": {
        kind: "taxonomy",
        title: "Tags",
        url: "/demo/tags/",
        params: {},
        content: "",
        members: [{ url: "/demo/tags/a/", title: "A", count: 0 }],
    },
    "a blog with no posts": {
        kind: "section",
        section: "blog",
        title: "Blog",
        url: "/demo/blog/",
        params: {},
        content: "",
    },
    "a post with nothing but a title": {
        kind: "page",
        title: "Post",
        url: "/demo/blog/post/",
        params: { type: "doc", subType: "post" },
        content: "",
    },
    "a post with a series": {
        kind: "page",
        title: "Post",
        url: "/demo/blog/post/",
        params: { type: "doc", subType: "post", series: "Intro", tags: ["news"] },
        date: "2025-01-15",
        content: "<p>Post.</p>",
    },
    "a page-not-found page": { kind: "404", title: "404", url: "/demo/404.html", params: {} },
};

const POSTS = [
    {
        url: "/demo/blog/post/",
        title: "Post",
        section: "blog",
        type: "doc",
        subType: "post",
        date: "2025-01-15",
        content: "<p>Words.</p>",
    },
];

describe("a layout draws no section around nothing", () => {
    for (const [siteName, site] of [
        ["configured", FULL],
        ["bare", BARE],
    ] as const)
        for (const [name, page] of Object.entries(PAGES))
            // A home page with no note and no configuration has nothing to draw; the
            // layout says so in a finding.
            it.skipIf(site === BARE && name === "a home page of cards")(
                `${name}, on a ${siteName} site`,
                () => {
                    const theme = createSiteTheme({ site: { ...site, pages: POSTS } });
                    const html = theme.render(page);
                    expect(emptyShells(html).map(describeShell)).toEqual([]);
                },
            );

    it("draws every layout", () => {
        const drawn = new Set(
            Object.values(PAGES).map((page) => createSiteTheme({ site: FULL }).layoutFor(page)),
        );
        expect([...drawn].sort()).toEqual([...LAYOUTS].filter((name) => name !== "base").sort());
    });
});

describe("the empty-shell check fails on a layout that draws a section around nothing", () => {
    /** The shipped theme, copied with one change. */
    const broken = (file: string, from: string, to: string) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-broken-"));
        fs.cpSync(SITE_THEME_DIR, dir, { recursive: true });
        const target = path.join(dir, file);
        const source = fs.readFileSync(target, "utf8");
        expect(source, `${file} does not hold the text this proof removes`).toContain(from);
        fs.writeFileSync(target, source.replace(from, to));
        return dir;
    };
    const page = PAGES["a page with a title only"];
    const withBody = { ...(PAGES["a page with a title only"] as object), content: "<p>Text.</p>" };

    it("is quiet on the shipped layouts", () => {
        const theme = createSiteTheme({ site: FULL });
        expect(emptyShells(theme.render(withBody))).toEqual([]);
    });

    it("names the navigation drawn with no links in it", () => {
        const dir = broken(
            "partials/page-body.hbs",
            "{{#if nav}}\n    {{> nav-links nav}}\n    {{/if}}",
            "{{> nav-links nav}}",
        );
        const html = createSiteTheme({ site: FULL, dir }).render(withBody);
        expect(emptyShells(html).map((shell) => `${shell.tag}.${shell.classes}`)).toEqual([
            "nav.single-nav",
        ]);
    });

    it("names the related block drawn with only its heading", () => {
        const dir = broken(
            "partials/page-body.hbs",
            "{{#if related}}\n    {{> related related}}\n    {{/if}}",
            "{{> related related}}",
        );
        const html = createSiteTheme({ site: FULL, dir }).render(withBody);
        expect(emptyShells(html).map((shell) => `${shell.tag}.${shell.classes}`)).toContain(
            "section.related",
        );
    });

    it("names the menu drawn with no entries", () => {
        const dir = broken(
            "partials/header.hbs",
            "{{#if hasMenu}}\n      <nav",
            "{{#if true}}\n      <nav",
        );
        const html = createSiteTheme({ site: { ...FULL, menu: [] }, dir }).render(page as object);
        expect(emptyShells(html).map((shell) => `${shell.tag}.${shell.classes}`)).toContain(
            "nav.site-nav",
        );
    });
});

describe("the addresses a layout writes", () => {
    const site = {
        baseURL: "https://www.heroiclands.org/demo/",
        params: { cdnBaseURL: "https://cdn.example.org/" },
    };

    it("puts a path under the site's base path, whatever its leading slashes", () => {
        expect(relUrl(site, "css/style.css")).toBe("/demo/css/style.css");
        expect(relUrl(site, "/css/style.css")).toBe("/demo/css/style.css");
        expect(relUrl(site, "")).toBe("/demo/");
        expect(relUrl({ baseURL: "https://example.org" }, "a/")).toBe("/a/");
    });

    it("resolves an asset against the asset host, or against the site when there is none", () => {
        expect(cdnUrl(site, "images/a.webp")).toBe("https://cdn.example.org/images/a.webp");
        expect(cdnUrl(site, "https://other.example.org/a.webp")).toBe(
            "https://other.example.org/a.webp",
        );
        expect(cdnUrl(site, "//other.example.org/a.webp")).toBe("//other.example.org/a.webp");
        expect(cdnUrl({ baseURL: site.baseURL }, "images/a.webp")).toBe("/demo/images/a.webp");
    });

    it("leaves an absolute link, a fragment and a query as written, and mounts a path", () => {
        expect(siteUrl(site, "https://x.org/")).toBe("https://x.org/");
        expect(siteUrl(site, "#top")).toBe("#top");
        expect(siteUrl(site, "?q=1")).toBe("?q=1");
        expect(siteUrl(site, "/rules/")).toBe("/demo/rules/");
        expect(siteUrl(site, "")).toBe("/demo/");
    });

    it("refuses a link whose scheme could run script", () => {
        for (const bad of [
            "javascript:alert(1)",
            " JaVaScRiPt:alert(1)",
            "java\nscript:x",
            "data:text/html,x",
            "vbscript:x",
        ])
            expect(safeUrl(bad), bad).toBe("#");
        expect(safeUrl("https://example.org/a")).toBe("https://example.org/a");
        expect(safeUrl("/a/b/")).toBe("/a/b/");
    });

    it("writes a tag's page address from the tag", () => {
        expect(tagUrl(site, "Two Words")).toBe("/demo/tags/two-words/");
    });

    it("writes no address of its own", () => {
        const names = fs
            .readdirSync(SITE_THEME_DIR, { recursive: true, encoding: "utf8" })
            .filter((file) => file.endsWith(".hbs"))
            .map((file) => [file, fs.readFileSync(path.join(SITE_THEME_DIR, file), "utf8")]);
        // The third-party hosts the layouts name are the fonts, the icon set and the licence badge.
        const allowed =
            /fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com|creativecommons\.org|licensebuttons\.net|www\.w3\.org/;
        for (const [file, source] of names) {
            const hosts = [...String(source).matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]);
            expect(
                hosts.filter((host) => !allowed.test(host)),
                String(file),
            ).toEqual([]);
        }
    });
});

describe("a page", () => {
    const theme = (site: object = FULL) => createSiteTheme({ site });
    const html = (name: string, site: object = FULL) => theme(site).render(PAGES[name]);

    it("escapes what data holds", () => {
        const page = {
            kind: "page",
            title: "<script>alert(1)</script>",
            url: "/demo/x/",
            params: { description: '"><img src=x>' },
            content: "<p>ok</p>",
        };
        const out = theme().render(page);
        expect(out).not.toContain("<script>alert(1)</script>");
        expect(out).not.toContain('"><img src=x>');
        expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    });

    it("never links a javascript address from data", () => {
        const page = {
            kind: "page",
            title: "T",
            url: "/demo/x/",
            params: {
                infoboxes: [
                    box([
                        {
                            id: "a",
                            layout: "rows",
                            rows: [
                                {
                                    label: "L",
                                    kind: "link",
                                    value: { text: "x", url: "javascript:alert(1)" },
                                },
                            ],
                        },
                    ]),
                ],
            },
            content: "<p>ok</p>",
        };
        expect(theme().render(page)).not.toMatch(/javascript:/i);
    });

    it("titles a page with the site's name, and the home page with the name alone", () => {
        expect(html("a page that has everything")).toContain(
            "<title>Everything — The Site</title>",
        );
        expect(html("a homepage note with a body")).toContain("<title>The Site</title>");
    });

    it("states a draft, with the site's sentence when it gives one", () => {
        const out = html("a draft page with no other content");
        expect(out).toContain('class="single single-with-notice"');
        expect(out).toContain("This entry is unfinished.");
        const custom = html("a draft page with no other content", {
            ...FULL,
            params: { ...FULL.params, draftNotice: "Unsettled." },
        });
        expect(custom).toContain("<em>Unsettled.</em>");
    });

    it("leaves the draft tag out of a page's subjects", () => {
        const out = html("a page that has everything");
        expect(out).toContain('class="single-tags"');
        expect(out).not.toMatch(/class="tag">draft/i);
        expect(html("a page whose boxes hold nothing")).not.toContain("single-tags");
    });

    it("links a tag only to a page that exists", () => {
        const page = {
            kind: "page",
            title: "T",
            url: "/demo/t/",
            params: { tags: ["Two Words"] },
            content: "<p>x</p>",
        };
        const without = createSiteTheme({ site: FULL }).render(page);
        expect(without).toContain('<span class="tag">Two Words</span>');
        expect(without).not.toContain("/tags/");
        const withPages = createSiteTheme({ site: { ...FULL, tagPages: true } }).render(page);
        expect(withPages).toContain('<a href="/demo/tags/two-words/" class="tag">Two Words</a>');
    });

    it("prints a number grouped, and a zero as a zero", () => {
        const out = html("a page that has everything");
        expect(out).toContain("<dd>1,234,567</dd>");
        expect(out).toContain("<dd>0</dd>");
    });

    it("has a contents list only past three second-level headings, beside the rail when there is one", () => {
        const out = html("a page that has everything");
        expect(out).toContain('class="single single-with-sidebar single-with-notice"');
        expect(out).toContain('<aside class="toc"');
        expect(out.indexOf('class="toc"')).toBeLessThan(out.indexOf('class="single-content"'));
        const few = {
            ...(PAGES["a page that has everything"] as any),
            params: {},
            content: '<h2 id="a">A</h2><h2 id="b">B</h2>',
        };
        expect(createSiteTheme({ site: FULL }).render(few)).not.toContain('class="toc"');
        const deep = {
            ...few,
            content: '<h2 id="a">A</h2><h3 id="b">B</h3><h3 id="c">C</h3><h3 id="d">D</h3>',
        };
        expect(createSiteTheme({ site: FULL }).render(deep)).not.toContain('class="toc"');
        const many = { ...few, content: "<h2>A</h2><h2>B</h2><h2>C</h2><h2>D</h2>" };
        const below = createSiteTheme({ site: FULL }).render(many);
        expect(below).toContain('class="single single-with-toc"');
        expect(below.indexOf('class="toc"')).toBeGreaterThan(
            below.indexOf('class="single-content"'),
        );
    });

    it("names the page before and after it among its siblings", () => {
        const out = html("a page that has everything");
        expect(out).toContain('class="nav-prev">&larr; A</a>');
        expect(out).toContain('class="nav-next">Z &rarr;</a>');
    });

    it("leaves a menu entry the page is not out of the current state", () => {
        const page = {
            kind: "page",
            title: "T",
            url: "/demo/t/",
            permalink: "https://www.heroiclands.org/",
            params: {},
            content: "<p>x</p>",
        };
        const out = createSiteTheme({ site: FULL }).render(page);
        expect(out).toContain(
            '<a href="https://www.heroiclands.org/" class="nav-link active">Home</a>',
        );
    });

    it("reports a home page that has nothing to draw", () => {
        const bare = createSiteTheme({ site: BARE });
        bare.render(PAGES["a home page of cards"] as object);
        expect(bare.findings.map((finding) => finding.message).join("\n")).toContain(
            "nothing to draw",
        );
    });

    it("names the file a finding is about, when the page knows it", () => {
        const bare = createSiteTheme({ site: BARE });
        bare.render({
            kind: "page",
            title: "T",
            url: "/x/",
            source: "assets/content/Lore/x.md",
            params: { type: "lore" },
            content: "<p>x</p>",
        });
        expect(bare.findings[0]).toMatchObject({
            severity: "warning",
            file: "assets/content/Lore/x.md",
            page: "/x/",
        });
    });

    it("leaves out a page-not-found link to a page the site does not publish", () => {
        const theme = createSiteTheme({
            site: {
                ...FULL,
                params: {
                    ...FULL.params,
                    notfound: {
                        links: [
                            { title: "Kept", url: "/kept/" },
                            { title: "Dead", url: "/character/" },
                            { title: "Away", url: "https://example.org/x" },
                        ],
                    },
                },
                pageExists: (url: string) => url === "/demo/kept/",
            },
        });
        const out = theme.render(PAGES["a page-not-found page"] as object);
        expect(out).toContain("Kept");
        expect(out).toContain("Away");
        expect(out).not.toContain("Dead");
        expect(theme.findings.map((finding) => finding.message).join("\n")).toContain(
            "/demo/character/",
        );
    });

    it("lists only the members no page already links, under a heading", () => {
        const out = html("a section with a body and members");
        expect(out).toContain("Orphaned Pages");
        expect(out).toContain(">Two</a>");
        expect(out).toContain("Second");
        expect(out.match(/page-list-title/g)).toHaveLength(1);
        const reached = html("a section with a body that reaches every member");
        expect(reached).not.toContain("page-list");
        expect(reached).not.toContain("Nothing here yet");
        expect(html("a section with nothing in it")).toContain("Nothing here yet.");
    });

    it("says a blog has no posts, and lists posts newest first", () => {
        expect(html("a blog with no posts")).toContain("No posts yet.");
        const out = createSiteTheme({
            site: {
                ...FULL,
                pages: [
                    {
                        url: "/demo/blog/a/",
                        title: "Older",
                        section: "blog",
                        type: "doc",
                        subType: "post",
                        date: "2024-01-01",
                        content: "<p>a</p>",
                    },
                    {
                        url: "/demo/blog/b/",
                        title: "Newer",
                        section: "blog",
                        type: "doc",
                        subType: "post",
                        date: "2025-01-01",
                        content: `<p>${"word ".repeat(120)}</p>`,
                    },
                ],
            },
        }).render(PAGES["a blog with no posts"] as object);
        expect(out.indexOf("Newer")).toBeLessThan(out.indexOf("Older"));
        expect(out).toContain("January 1, 2025");
        expect(out).toMatch(/word…<\/p>/);
    });
});

describe("a page's contents list", () => {
    it("reads the second- and third-level headings, with their ids", () => {
        expect(
            pageHeadings(
                '<h1 id="t">T</h1><h2 id="a">A <em>b</em></h2><h3>C</h3><h4 id="d">D</h4>',
            ),
        ).toEqual([
            { level: 2, id: "a", text: "A b" },
            { level: 3, id: "", text: "C" },
        ]);
    });

    it("nests a third-level heading under the second-level one before it", () => {
        const toc = tableOfContents([
            { level: 2, id: "a", text: "A" },
            { level: 3, id: "a1", text: "A1" },
            { level: 2, id: "b", text: "B" },
        ]);
        expect(toc).toBe(
            [
                '<nav id="TableOfContents">',
                "  <ul>",
                '    <li><a href="#a">A</a>',
                "      <ul>",
                '        <li><a href="#a1">A1</a></li>',
                "      </ul>",
                "    </li>",
                '    <li><a href="#b">B</a>',
                "    </li>",
                "  </ul>",
                "</nav>",
            ].join("\n"),
        );
    });

    it("lists a heading with no id without a link", () => {
        expect(tableOfContents([{ level: 2, id: "", text: "A & B" }])).toContain("<li>A &amp; B");
    });
});

describe("the pages beside a page", () => {
    const siblings = [
        { url: "/1/", title: "1", type: "lore" },
        { url: "/2/", title: "2", type: "place" },
        { url: "/3/", title: "3", type: "lore" },
        { url: "/4/", title: "4", type: "doc", subType: "guide" },
        { url: "/5/", title: "5", type: "doc", subType: "reference" },
    ];
    const at = (url: string, type: string, subType?: string) => ({
        url,
        params: { type, subType },
        siblings,
    });

    it("are the ones of its own catalog where a section holds several", () => {
        expect(neighbours(at("/1/", "lore"))).toEqual({ prev: siblings[2], next: undefined });
        expect(neighbours(at("/3/", "lore"))).toEqual({ prev: undefined, next: siblings[0] });
    });

    it("are a doc's own subtype", () => {
        expect(neighbours(at("/4/", "doc", "guide"))).toEqual({ prev: undefined, next: undefined });
    });

    it("are every sibling where the section holds one catalog or the page has none", () => {
        const same = [siblings[0], siblings[2]];
        expect(neighbours({ url: "/1/", params: { type: "lore" }, siblings: same })).toEqual({
            prev: same[1],
            next: undefined,
        });
        expect(neighbours({ url: "/2/", params: {}, siblings })).toEqual({
            prev: siblings[2],
            next: siblings[0],
        });
        expect(neighbours({ url: "/9/", params: {}, siblings })).toEqual({});
    });
});

describe("a page's banner", () => {
    const site = {
        baseURL: "https://example.org/",
        params: { cdnBaseURL: "https://cdn.example.org" },
    };
    const data = {
        banners: {
            dir: "images/banners",
            fallback: "default.webp",
            available: ["default", "people", "region", "rules"],
        },
        kinds: {
            categoryTypes: ["doc"],
            kinds: {
                lore: { culture: "people", other: "default" },
                place: { region: "region" },
                homepage: "default",
                skill: "skills",
            },
        },
    };
    const url = (fields: object, reported = new Set<string>(), report?: (finding: any) => void) =>
        bannerUrl(site, fields, { data, reported, report });

    it("is the note's own resolved banner, as given, or nothing when that is blank", () => {
        expect(url({ data: { banner: "https://cdn.example.org/a.webp" }, type: "lore" })).toBe(
            "https://cdn.example.org/a.webp",
        );
        expect(url({ data: { banner: "images/own.webp" }, type: "lore" })).toBe(
            "https://cdn.example.org/images/own.webp",
        );
        expect(url({ data: { banner: "" }, type: "lore" })).toBe("");
        expect(url({ data: { banner: null }, type: "homepage" })).toBe(
            "https://cdn.example.org/images/banners/default.webp",
        );
    });

    it("is declined by none or false, and by nothing else", () => {
        expect(url({ banner: "none", type: "lore" })).toBe("");
        expect(url({ banner: "NONE", type: "lore" })).toBe("");
        expect(url({ banner: false, type: "lore" })).toBe("");
    });

    it("is a hand-authored fragment under images, or a full address", () => {
        expect(url({ banner: "rules.webp" })).toBe("https://cdn.example.org/images/rules.webp");
        expect(url({ banner: "/x/y.webp" })).toBe("https://cdn.example.org/images/x/y.webp");
        expect(url({ banner: "https://other.example.org/a.webp" })).toBe(
            "https://other.example.org/a.webp",
        );
    });

    it("is the default for the page's type and subtype, or its category for a doc", () => {
        expect(url({ type: "lore", subType: "Culture" })).toBe(
            "https://cdn.example.org/images/banners/people.webp",
        );
        expect(url({ type: "place", subType: "region" })).toBe(
            "https://cdn.example.org/images/banners/region.webp",
        );
        expect(url({ type: "doc", category: "rules" })).toBe(
            "https://cdn.example.org/images/banners/rules.webp",
        );
        expect(url({ type: "doc" })).toBe("https://cdn.example.org/images/banners/default.webp");
        expect(url({ subtype: "default" })).toBe(
            "https://cdn.example.org/images/banners/default.webp",
        );
        expect(url({})).toBe("");
    });

    it("falls back, and says so once, when the name is not declared", () => {
        const reported = new Set<string>();
        const findings: any[] = [];
        const draw = (fields: object) => url(fields, reported, (finding) => findings.push(finding));
        expect(draw({ type: "skill", context: "/a/" })).toBe(
            "https://cdn.example.org/images/banners/default.webp",
        );
        expect(draw({ type: "skill", context: "/b/" })).toBe(
            "https://cdn.example.org/images/banners/default.webp",
        );
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ severity: "warning", page: "/a/" });
        expect(findings[0].message).toContain('"skills"');
    });

    it("does not look for an address outside the banner directory", () => {
        expect(url({ banner: "elsewhere/x.webp" })).toBe(
            "https://cdn.example.org/images/elsewhere/x.webp",
        );
    });
});

describe("highlighted code", () => {
    it("takes its colours from the content stylesheet, scoped to the page body", () => {
        const css = siteCodeStylesheet();
        expect(css).toContain(".single-body .hljs-keyword");
        expect(css).toContain("--pb-code-keyword");
        expect(css).not.toContain("journal-entry-page");
        expect(css).toContain("color-scheme: dark");
    });

    it("holds each token rule of the stylesheet, and no other", () => {
        const rules = highlightRules(".x");
        const source = fs.readFileSync(
            path.join(SITE_THEME_DIR, "..", "assets/styles/content-base.css"),
            "utf8",
        );
        const named = (text: string) => new Set(text.match(/\.hljs-[a-z_.-]+/g));
        expect(named(rules)).toEqual(named(source));
        expect(rules).not.toMatch(/(^|\n)[^{}]*\{[^}]*\}[^]*\.single-body/);
    });

    it("is one of the files a site writes", () => {
        expect(siteThemeAssets().map((asset) => asset.path)).toEqual(["css/code.css"]);
        expect(siteThemeAssets()[0].content).toBe(siteCodeStylesheet());
    });
});

describe("the theme's partials", () => {
    it("holds one for a copyable address and one for a list of pages", () => {
        const partials = fs.readdirSync(path.join(SITE_THEME_DIR, "partials"));
        expect(partials).toContain("exturl.hbs");
        expect(partials).toContain("page-list.hbs");
    });

    it("holds none for a glyph or a cartouche, which a note's own syntax draws", () => {
        const partials = fs.readdirSync(path.join(SITE_THEME_DIR, "partials"));
        expect(partials).not.toContain("glyph.hbs");
        expect(partials).not.toContain("cartouche.hbs");
    });

    it("draws an address a reader copies", () => {
        const theme = createSiteTheme({ site: FULL });
        expect(theme.partial("exturl", { url: "https://example.org/module.json" })).toBe(
            '<span data-copy="https://example.org/module.json">https://example.org/module.json</span>',
        );
        const out = theme.render({
            kind: "page",
            title: "T",
            url: "/demo/t/",
            params: {},
            content: '<p><span data-copy="https://example.org/x">https://example.org/x</span></p>',
        });
        expect(out).toContain("querySelectorAll('[data-copy]')");
        expect(() => theme.partial("glyph")).toThrow(/no partial named "glyph"/);
    });
});

describe("generated links that lead outside the reachable pages", () => {
    const outside = new Set(["/demo/hidden/"]);
    const site = { ...FULL, visible: (url: string) => !outside.has(url) };
    const page = {
        kind: "page",
        title: "Here",
        url: "/demo/here/",
        params: {
            type: "doc",
            infoboxes: [
                box([
                    {
                        id: "profile",
                        layout: "rows",
                        rows: [
                            {
                                label: "Seat",
                                kind: "link",
                                value: { text: "Hidden Hall", url: "/demo/hidden/" },
                            },
                            {
                                label: "Home",
                                kind: "link",
                                value: { text: "Open Hall", url: "/demo/open/" },
                            },
                        ],
                    },
                ]),
            ],
            related: {
                seeAlso: [
                    { url: "/demo/hidden/", title: "Hidden Hall", gloss: "" },
                    { url: "/demo/open/", title: "Open Hall", gloss: "" },
                ],
                backlinks: [{ url: "/demo/hidden/", title: "Hidden Hall", type: "doc" }],
                mentions: [],
            },
        },
        siblings: [
            { url: "/demo/before/", title: "Before" },
            { url: "/demo/here/", title: "Here" },
            { url: "/demo/hidden/", title: "Hidden Hall" },
            { url: "/demo/after/", title: "After" },
        ],
        content: "<p>Text.</p>",
    };

    it("sets an infobox link as plain text and leaves the Related card and the neighbours without it", () => {
        const html = createSiteTheme({ site }).render(page);
        expect(html).not.toContain('href="/demo/hidden/"');
        expect(html).toContain("Hidden Hall");
        expect(html).toContain('href="/demo/open/"');
        expect(html).toContain('href="/demo/after/"');
        expect(html).toContain('href="/demo/before/"');
    });

    it("draws every generated link where the site sets no `visible`", () => {
        const html = createSiteTheme({ site: FULL }).render(page);
        expect(html).toContain('href="/demo/hidden/"');
    });
});
