/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * A site is written as HTML with no other renderer: every page through the
 * layouts, the listings derived from the pages, `404.html`, `sitemap.xml`,
 * the theme's files and, where the site asks for them, its tag pages, its
 * Atom feed, a sitemap index and `robots.txt`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { siteOrder, siteTree, writeSite } from "../engine/site-render.mjs";

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "site-render-")));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

const read = (out: string, file: string) => fs.readFileSync(path.join(out, file), "utf8");

/** A root site with a blog, a projects section with its own page, and tags. */
function rootSite(extra: object = {}) {
    return {
        title: "Heroic Demo",
        baseURL: "https://www.example.org/",
        params: {
            description: "The root.",
            author: "Ann Author",
            notfound: {
                links: [
                    { title: "Home", url: "/", text: "From the top." },
                    { title: "Nowhere", url: "/nowhere/", text: "Not published." },
                ],
            },
        },
        menu: [{ name: "Blog", url: "https://www.example.org/blog/", children: [] }],
        year: 2026,
        tagPages: true,
        feed: { section: "blog", title: "Heroic Demo: the blog" },
        sitemaps: ["https://www.example.org/demo/sitemap.xml"],
        ...extra,
    };
}

function rootPages() {
    const post = (slug: string, title: string, date: string, tags: string[]) => ({
        kind: "page",
        section: "blog",
        title,
        url: `/blog/${slug}/`,
        date,
        params: { type: "doc", subType: "post", tags },
        content: `<p>${title}  is   written    here.</p>\n<!-- a comment -->\n<pre>  kept   as   is</pre>`,
    });
    return [
        { kind: "home", title: "Heroic Demo", url: "/", params: {}, content: "<p>Home.</p>" },
        post("first", "First Post", "2026-01-05", ["News"]),
        post("second", "Second Post", "2026-03-09", ["News", "Roads"]),
        {
            kind: "section",
            section: "projects",
            title: "Our Projects",
            url: "/projects/",
            params: {},
            content: '<p>See <a href="/projects/alpha/">Alpha</a>.</p>',
        },
        {
            kind: "page",
            section: "projects",
            title: "Alpha",
            url: "/projects/alpha/",
            params: { tags: ["Roads"] },
            content: "<p>Alpha.</p>",
        },
        {
            kind: "page",
            section: "projects",
            title: "Beta",
            url: "/projects/beta/",
            params: { weight: 1 },
            content: "<p>Beta.</p>",
        },
        {
            kind: "page",
            section: "",
            title: "License",
            url: "/license/",
            params: {},
            content: "<p>The licence.</p>",
        },
    ];
}

describe("the order of a section's pages", () => {
    it("is by weight, unweighted last, then newest first, then by title, then by address", () => {
        const pages = [
            { title: "b", url: "/b/" },
            { title: "a", url: "/z/" },
            { title: "a", url: "/y/" },
            { title: "old", url: "/old/", date: "2020-01-01" },
            { title: "new", url: "/new/", date: "2024-01-01" },
            { title: "heavy", url: "/heavy/", weight: 2 },
            { title: "light", url: "/light/", weight: 1 },
        ];
        expect(siteOrder(pages).map((p) => p.url)).toEqual([
            "/light/",
            "/heavy/",
            "/new/",
            "/old/",
            "/y/",
            "/z/",
            "/b/",
        ]);
    });

    it("sorts an apostrophe typed straight before one typed curly, and both before a letter", () => {
        const titles = ["Ne’ Ki", "Neb", "Ne'ok"];
        expect(
            siteOrder(titles.map((title) => ({ title, url: title }))).map((p) => p.title),
        ).toEqual(["Ne'ok", "Ne’ Ki", "Neb"]);
    });
});

describe("a site's pages", () => {
    it("derive a page for every section and, with tagPages, every tag", () => {
        const tree = siteTree(rootSite(), rootPages());
        expect(tree.map((page: any) => `${page.kind} ${page.url}`)).toEqual([
            "home /",
            "page /blog/first/",
            "page /blog/second/",
            "page /projects/alpha/",
            "page /projects/beta/",
            "page /license/",
            "section /blog/",
            "section /projects/",
            "taxonomy /tags/",
            "term /tags/news/",
            "term /tags/roads/",
        ]);
        const projects: any = tree.find((page: any) => page.url === "/projects/");
        expect(projects.title).toBe("Our Projects");
        expect(projects.members.map((m: any) => m.url)).toEqual([
            "/projects/beta/",
            "/projects/alpha/",
        ]);
        const blog: any = tree.find((page: any) => page.url === "/blog/");
        expect(blog.title).toBe("Blog");
        expect(blog.members.map((m: any) => m.url)).toEqual(["/blog/second/", "/blog/first/"]);
    });

    it("walk their own section in that order", () => {
        const tree = siteTree(rootSite(), rootPages());
        const first: any = tree.find((page: any) => page.url === "/blog/first/");
        expect(first.siblings.map((s: any) => s.url)).toEqual(["/blog/second/", "/blog/first/"]);
    });

    it("leave the tags without pages unless the site asks for them", () => {
        const tree = siteTree(rootSite({ tagPages: false }), rootPages());
        expect(tree.some((page: any) => page.url.startsWith("/tags/"))).toBe(false);
    });
});

describe("writing a site", () => {
    let out: string;
    let result: any;
    beforeAll(() => {
        out = path.join(scratch, "root");
        fs.mkdirSync(out, { recursive: true });
        fs.writeFileSync(path.join(out, "stale.html"), "left by an earlier build");
        result = writeSite({ site: rootSite(), pages: rootPages(), out });
    });

    it("writes every page, the page-not-found page and the theme's files, and nothing stale", () => {
        for (const file of [
            "index.html",
            "blog/index.html",
            "blog/first/index.html",
            "projects/index.html",
            "tags/index.html",
            "tags/roads/index.html",
            "license/index.html",
            "404.html",
            "css/style.css",
            "css/sohl-icons.css",
            "css/code.css",
            "js/inline-spoilers.js",
        ])
            expect(fs.existsSync(path.join(out, file)), file).toBe(true);
        expect(fs.existsSync(path.join(out, "stale.html"))).toBe(false);
        expect(result.pages).toContain("/tags/news/");
    });

    it("lists a section's pages its own body does not reach", () => {
        const projects = read(out, "projects/index.html");
        expect(projects).toContain("<h1>Our Projects</h1>");
        expect(projects).toContain('href="/projects/beta/"');
        expect(projects).toContain("Orphaned Pages");
    });

    it("links a tag to its page, and lists a tag's pages there", () => {
        expect(read(out, "blog/second/index.html")).toContain('href="/tags/roads/" class="tag"');
        const roads = read(out, "tags/roads/index.html");
        expect(roads).toContain('href="/blog/second/"');
        expect(roads).toContain('href="/projects/alpha/"');
    });

    it("leaves out a page-not-found link to a page the site does not publish, and says where it is set", () => {
        const notFound = read(out, "404.html");
        expect(notFound).toContain('href="/"');
        expect(notFound).not.toContain("/nowhere/");
        expect(result.findings.filter((f: any) => f.param)).toEqual([
            expect.objectContaining({
                severity: "warning",
                param: ["notfound", "links", 1, "url"],
                message: expect.stringContaining("/nowhere/"),
            }),
        ]);
    });

    it("minifies each page and keeps preformatted text as written", () => {
        const page = read(out, "blog/first/index.html");
        expect(page).toContain("First Post is written here.");
        expect(page).not.toContain("a comment");
        expect(page).toContain("<pre>  kept   as   is</pre>");
        expect(page).not.toContain("is   written");
    });

    it("writes a sitemap of every page by its full address", () => {
        const sitemap = read(out, "sitemap.xml");
        expect(sitemap).toContain("<loc>https://www.example.org/</loc>");
        expect(sitemap).toContain("<loc>https://www.example.org/tags/roads/</loc>");
        expect(sitemap).toContain(
            "<loc>https://www.example.org/blog/second/</loc>\n    <lastmod>2026-03-09T00:00:00Z</lastmod>",
        );
        expect(sitemap).not.toContain("404");
    });

    it("writes the blog's Atom feed, newest post first, and links it from every page", () => {
        const feed = read(out, "blog/atom.xml");
        expect(feed).toContain("<title>Heroic Demo: the blog</title>");
        expect(feed).toContain(
            '<link rel="self" type="application/atom+xml" href="https://www.example.org/blog/atom.xml"/>',
        );
        expect(feed).toContain("<updated>2026-03-09T00:00:00Z</updated>");
        expect(feed).toContain("<author><name>Ann Author</name></author>");
        expect(feed.indexOf("Second Post")).toBeLessThan(feed.indexOf("First Post"));
        expect(feed).toContain("<id>https://www.example.org/blog/first/</id>");
        expect(feed).toContain('<content type="html">&lt;p&gt;First Post');
        expect(read(out, "license/index.html")).toContain(
            '<link rel="alternate" type="application/atom+xml" title="Heroic Demo: the blog" href="/blog/atom.xml">',
        );
    });

    it("writes a sitemap index and robots.txt naming every site's sitemap", () => {
        expect(read(out, "sitemap-index.xml")).toBe(
            [
                '<?xml version="1.0" encoding="utf-8"?>',
                '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
                "  <sitemap>\n    <loc>https://www.example.org/sitemap.xml</loc>\n  </sitemap>",
                "  <sitemap>\n    <loc>https://www.example.org/demo/sitemap.xml</loc>\n  </sitemap>",
                "</sitemapindex>",
                "",
            ].join("\n"),
        );
        expect(read(out, "robots.txt")).toBe(
            [
                "User-agent: *",
                "Allow: /",
                "",
                "Sitemap: https://www.example.org/sitemap-index.xml",
                "Sitemap: https://www.example.org/sitemap.xml",
                "Sitemap: https://www.example.org/demo/sitemap.xml",
                "",
            ].join("\n"),
        );
    });

    it("draws only the pages it is asked to draw again", () => {
        const pages = rootPages().map((page: any) =>
            page.url === "/license/" ? { ...page, content: "<p>A new licence.</p>" } : page,
        );
        const before = read(out, "blog/first/index.html");
        fs.writeFileSync(path.join(out, "blog/first/index.html"), "untouched");
        const again = writeSite({ site: rootSite(), pages, out, only: new Set(["/license/"]) });
        expect(again.files).toEqual([path.join(out, "license", "index.html")]);
        expect(read(out, "license/index.html")).toContain("A new licence.");
        expect(read(out, "blog/first/index.html")).toBe("untouched");
        fs.writeFileSync(path.join(out, "blog/first/index.html"), before);
    });
});

describe("a site served under a path", () => {
    it("writes no sitemap index or robots.txt, which belong at the root of an origin", () => {
        expect(() =>
            writeSite({
                site: rootSite({ baseURL: "https://www.example.org/demo/" }),
                pages: [],
                out: path.join(scratch, "demo"),
            }),
        ).toThrow(/root of an origin/);
    });

    it("writes its pages under its base path", () => {
        const out = path.join(scratch, "demo");
        const {
            sitemaps: _sitemaps,
            feed: _feed,
            ...site
        } = rootSite({
            baseURL: "https://www.example.org/demo/",
            tagPages: false,
        });
        writeSite({
            site,
            pages: [
                { kind: "home", title: "Demo", url: "/demo/", params: {}, content: "<p>Home.</p>" },
                {
                    kind: "page",
                    title: "A Note",
                    url: "/demo/lore-note/",
                    params: { tags: ["roads"] },
                    content: "<p>A note.</p>",
                },
            ],
            out,
        });
        expect(fs.existsSync(path.join(out, "lore-note", "index.html"))).toBe(true);
        expect(read(out, "lore-note/index.html")).toContain('<span class="tag">roads</span>');
        expect(read(out, "sitemap.xml")).toContain(
            "<loc>https://www.example.org/demo/lore-note/</loc>",
        );
        expect(fs.existsSync(path.join(out, "robots.txt"))).toBe(false);
    });
});
