/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A root site, built end to end by `package-build site build`.
 *
 * `tests/fixtures/root-site/` is served at its origin's root (`site.base: /`).
 * It has a homepage, a blog of three `doc/post` notes introduced by an
 * authored section page, a second authored section, a project page and a
 * licence page; it writes tag pages, feeds its blog, and names a package site
 * in its sitemap index and its merged search. Everything asserted here is read
 * back from the files the command wrote.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cacheNavigation, fixtureConfig } from "./helpers/parity";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "root-site");
const CLI = path.join(HERE, "..", "bin", "package-build.mjs");

let scratch: string;
let out: string;
let run: ReturnType<typeof spawnSync>;

/** A written file, as text. */
const read = (rel: string) => fs.readFileSync(path.join(out, rel), "utf8");

/** Every `href` a page links, in order. */
const hrefs = (html: string) => [...html.matchAll(/href="?([^"\s>]+)"?/g)].map((m) => m[1]);

/** The visible text of an element's opening class, with its contents, collapsed. */
const textOf = (html: string) =>
    html
        .replace(/<script[\s\S]*?<\/script>/g, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ");

beforeAll(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "root-site-")));
    fs.cpSync(FIXTURE, scratch, { recursive: true });
    cacheNavigation(fixtureConfig(scratch));
    run = spawnSync(process.execPath, [CLI, "site", "build"], {
        cwd: scratch,
        encoding: "utf8",
        env: { ...process.env, PACKAGE_BUILD_CONFIG: "" },
    });
    out = path.join(scratch, "build", "site");
}, 240_000);

afterAll(() => {
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

describe("package-build site build, for a root site", () => {
    it("succeeds, writing the site at the deployed root", () => {
        expect(run.stderr).toBe("");
        expect(run.status).toBe(0);
        expect(fs.existsSync(path.join(out, "index.html"))).toBe(true);
        expect(fs.existsSync(path.join(out, "rootdemo"))).toBe(false);
    });

    it("writes every page, each section page at its section", () => {
        for (const page of [
            "index.html",
            "blog/index.html",
            "projects/index.html",
            "doc-firstlantern/index.html",
            "doc-secondlantern/index.html",
            "doc-thirdlantern/index.html",
            "doc-roadproject/index.html",
            "doc-license/index.html",
            "tags/index.html",
            "tags/news/index.html",
            "tags/roads/index.html",
            "404.html",
        ])
            expect(fs.existsSync(path.join(out, page)), page).toBe(true);
        expect(fs.existsSync(path.join(out, "doc-blog"))).toBe(false);
        expect(fs.existsSync(path.join(out, "doc-projects"))).toBe(false);
    });

    it("resolves a link to a section's page at the section", () => {
        expect(hrefs(read("doc-roadproject/index.html"))).toContain("/blog/");
        expect(hrefs(read("doc-secondlantern/index.html"))).toContain("/doc-roadproject/");
    });

    it("draws an authored section page with its title and body", () => {
        const projects = read("projects/index.html");
        expect(projects).toContain("<title>Projects — Heroic Demo</title>");
        expect(textOf(projects)).toContain("Every project has a page of its own");
    });

    it("lists the blog's posts newest first under its authored introduction", () => {
        const blog = read("blog/index.html");
        expect(blog).toContain("<title>Blog — Heroic Demo</title>");
        expect(textOf(blog)).toContain("Occasional notes on the lanterns");
        const listed = [...blog.matchAll(/class="?blog-list-title"? href="?([^"\s>]+)/g)].map(
            (m) => m[1],
        );
        expect(listed).toEqual(["/doc-secondlantern/", "/doc-thirdlantern/", "/doc-firstlantern/"]);
    });

    it("draws a post with its date, its tags and its author for the search", () => {
        const post = read("doc-secondlantern/index.html");
        expect(post).toContain("blog-meta");
        expect(post).toMatch(/datetime="?2026-03-09/);
        expect(hrefs(post)).toEqual(expect.arrayContaining(["/tags/news/", "/tags/roads/"]));
        expect(post).toMatch(/data-pagefind-filter="?author"?[^>]*>Bo Writer</);
        expect(post).toMatch(/data-pagefind-sort="?date"?[^>]*>2026-03-09</);
    });

    it("gives a post that names no author the site's byline", () => {
        expect(read("doc-thirdlantern/index.html")).toMatch(
            /data-pagefind-filter="?author"?[^>]*>Cy Editor</,
        );
    });

    it("feeds the blog's posts as Atom, newest first, and links the feed", () => {
        const feed = read("blog/atom.xml");
        const entries = [...feed.matchAll(/<entry>[\s\S]*?<\/entry>/g)].map((m) => m[0]);
        expect(entries.map((e) => /<title[^>]*>([^<]*)</.exec(e)?.[1])).toEqual([
            "Second Lantern",
            "Third Lantern",
            "First Lantern",
        ]);
        expect(entries[0]).toContain('href="https://www.example.org/doc-secondlantern/"');
        expect(entries[0]).toContain("<name>Bo Writer</name>");
        expect(entries[1]).toContain("<name>Cy Editor</name>");
        expect(feed).toContain('href="https://www.example.org/blog/atom.xml"');
        expect(read("index.html")).toMatch(
            /type="?application\/atom\+xml"?[^>]*href="?\/blog\/atom\.xml/,
        );
    });

    it("writes a page for every tag, and an index of them", () => {
        const tags = textOf(read("tags/index.html"));
        expect(tags).toMatch(/news\s*2/);
        expect(tags).toMatch(/roads\s*3/);
        expect(hrefs(read("tags/news/index.html"))).toEqual(
            expect.arrayContaining(["/doc-firstlantern/", "/doc-secondlantern/"]),
        );
        expect(hrefs(read("tags/roads/index.html"))).toEqual(
            expect.arrayContaining(["/doc-roadproject/", "/doc-thirdlantern/"]),
        );
    });

    it("names its own sitemap and each package site's in a sitemap index and robots.txt", () => {
        const index = read("sitemap-index.xml");
        expect([...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])).toEqual([
            "https://www.example.org/sitemap.xml",
            "https://www.example.org/searchdemo/sitemap.xml",
        ]);
        const robots = read("robots.txt");
        for (const loc of [
            "https://www.example.org/sitemap-index.xml",
            "https://www.example.org/sitemap.xml",
            "https://www.example.org/searchdemo/sitemap.xml",
        ])
            expect(robots).toContain(`Sitemap: ${loc}`);
    });

    it("lists every page in its own sitemap", () => {
        const locs = [...read("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
        expect(locs).toEqual(
            expect.arrayContaining([
                "https://www.example.org/",
                "https://www.example.org/blog/",
                "https://www.example.org/projects/",
                "https://www.example.org/doc-firstlantern/",
                "https://www.example.org/tags/news/",
            ]),
        );
        expect(locs.some((loc) => loc.includes("doc-blog"))).toBe(false);
    });

    it("tells its search to read the package site's index beside its own", () => {
        expect(read("index.html")).toContain(
            '"mergeIndex":[{"bundlePath":"/searchdemo/pagefind/"}]',
        );
        expect(fs.existsSync(path.join(out, "pagefind", "pagefind.js"))).toBe(true);
    });

    it("writes `_headers` at the deployed root", () => {
        expect(read("_headers")).toContain("X-Robots-Tag: noindex");
    });
});

describe("a section whose page no note is", () => {
    it("fails the build, located at its value in the configuration", () => {
        const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "root-site-gate-")));
        try {
            fs.cpSync(FIXTURE, dir, { recursive: true });
            const file = path.join(dir, "package-build.config.yaml");
            const text = fs
                .readFileSync(file, "utf8")
                .replace("        projects: doc-projects\n", "        projects: doc-plans\n");
            fs.writeFileSync(file, text);
            cacheNavigation(fixtureConfig(dir));
            const failed = spawnSync(process.execPath, [CLI, "site", "build"], {
                cwd: dir,
                encoding: "utf8",
                env: { ...process.env, PACKAGE_BUILD_CONFIG: "" },
            });
            expect(failed.status).toBe(1);
            const lines = text.split("\n");
            const line = lines.findIndex((l) => l.includes("projects: doc-plans")) + 1;
            const column = lines[line - 1].indexOf("doc-plans") + 1;
            expect(failed.stderr).toContain(
                `package-build.config.yaml:${line}:${column}: error: \`site.sections.projects\` is ` +
                    "`doc-plans`, and no note in the content tree has that address, so the " +
                    "section has no page to publish at `/projects/`",
            );
            expect(fs.existsSync(path.join(dir, "build", "site", "index.html"))).toBe(false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }, 120_000);
});
