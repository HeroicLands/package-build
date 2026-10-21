/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The layouts draw every kind of page.
 *
 * `tests/fixtures/site-theme/` is a small site that uses every part of the
 * theme at once: a home page of cards, sections of pages, a blog, a note with
 * every infobox layout, a contents list, tags, a draft notice, related pages,
 * raw definition lists, banners of each kind, and a page-not-found page with
 * links. Its notes are rendered by the shared renderer and drawn by the
 * layouts, and the pages are read as a reader sees them.
 */

import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { createRenderer } from "../engine/content-render.mjs";
import { readMatter } from "../engine/note-matter.mjs";
import { createSiteTheme } from "../engine/site-theme.mjs";
import { describeShell, emptyShells } from "./helpers/empty-shells";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "site-theme");
const renderer = createRenderer("web");

interface Fixture {
    kind: string;
    section?: string;
    title: string;
    url: string;
    params: Record<string, any>;
    date?: unknown;
    content: string;
    siblings?: Array<Record<string, unknown>>;
    members?: Array<Record<string, unknown>>;
}

/** The newest first, then by title: the order a reader walks a section. */
function walkOrder<T extends { title: string; date?: unknown }>(pages: T[]): T[] {
    const time = (page: T) => (page.date ? new Date(String(page.date)).getTime() : 0);
    return [...pages].sort((a, b) => time(b) - time(a) || (a.title < b.title ? -1 : 1));
}

/** The fixture's notes as the page data the layouts are given. */
function fixturePages(): Fixture[] {
    const read = (file: string) => {
        const { data, content } = readMatter(
            fs.readFileSync(path.join(FIXTURE, "content", file), "utf8"),
        );
        return { data, html: renderer.render(content) };
    };
    const files = fs
        .readdirSync(path.join(FIXTURE, "content"), { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(".md"));
    const regular: Fixture[] = files
        .filter((file) => !file.endsWith("_index.md"))
        .map((file) => {
            const { data, html } = read(file);
            return {
                kind: "page",
                section: file.split("/")[0],
                title: String(data.title),
                url: `/${file.replace(/\.md$/, "")}/`,
                params: data,
                date: data.date,
                content: html,
            };
        });
    const sections = [...new Set(regular.map((page) => page.section!))];
    const inSection = (section: string) =>
        walkOrder(regular.filter((page) => page.section === section));
    for (const page of regular)
        page.siblings = inSection(page.section!).map((entry) => ({
            url: entry.url,
            title: entry.title,
            type: entry.params.type,
            subType: entry.params.subType,
            category: entry.params.category,
        }));
    const pages: Fixture[] = [...regular];
    for (const section of sections) {
        const index = `${section}/_index.md`;
        const has = files.includes(index);
        const { data, html } = has ? read(index) : { data: {}, html: "" };
        pages.push({
            kind: "section",
            section,
            title: has ? String(data.title) : section,
            url: `/${section}/`,
            params: data,
            content: html,
            members: inSection(section).map((entry) => ({
                url: entry.url,
                title: entry.title,
                description: entry.params.description,
                content: entry.content,
            })),
        });
    }
    pages.push({
        kind: "home",
        title: "Features",
        url: "/",
        params: {},
        content: read("_index.md").html,
    });
    return pages;
}

describe("the layouts draw every kind of page", () => {
    const site = JSON.parse(fs.readFileSync(path.join(FIXTURE, "site.json"), "utf8"));
    let pages: Fixture[];
    let theme: ReturnType<typeof createSiteTheme>;
    let drawn: Map<string, string>;

    const draw = (extra: Record<string, unknown> = {}) => {
        const made = createSiteTheme({
            site: {
                ...site,
                year: 2026,
                pages: pages
                    .filter((page) => page.kind === "page")
                    .map((page) => ({
                        ...page,
                        type: page.params.type,
                        subType: page.params.subType,
                    })),
                feed: { title: "Feed", url: "/blog/atom.xml", section: "blog" },
                ...extra,
            },
        });
        const out = new Map<string, string>();
        for (const page of pages) out.set(page.url, made.render(page as never));
        out.set(
            "/404.html",
            made.render({ kind: "404", title: "404 Page not found", url: "/404.html", params: {} }),
        );
        return { theme: made, out };
    };

    beforeAll(() => {
        pages = fixturePages();
        ({ theme, out: drawn } = draw({ tagPages: true }));
    });

    it("draws every note, section, the home page and the page-not-found page", () => {
        expect([...drawn.keys()].sort()).toEqual(
            [
                "/",
                "/404.html",
                "/blog/",
                "/blog/post-one/",
                "/blog/post-two/",
                "/notes/",
                "/notes/note-a/",
                "/notes/note-b/",
                "/notes/note-c/",
                "/notes/note-d/",
                "/notes/note-e/",
                "/notes/note-f/",
                "/projects/",
                "/projects/alpha/",
                "/projects/beta/",
                "/projects/gamma/",
            ].sort(),
        );
        for (const [url, html] of drawn) expect(html, url).toContain("</html>");
    });

    it("draws no empty shell", () => {
        const shells = [...drawn].flatMap(([url, html]) =>
            emptyShells(html).map((shell) => `${url} ${describeShell(shell)}`),
        );
        expect(shells).toEqual([]);
    });

    it("draws a system box only when it has something to say", () => {
        const note = drawn.get("/notes/note-a/")!;
        expect(note).toContain("Not available");
        expect(note).not.toMatch(/HarnMaster\s*<\/h\d>\s*<\/div>/);
    });

    it("names a banner it does not hold, once each", () => {
        const named = theme.findings
            .map((finding) => /no banner named "([^"]+)"/.exec(finding.message)?.[1])
            .filter(Boolean);
        expect(new Set(named).size).toBe(named.length);
    });

    it("names the infobox layout it cannot draw", () => {
        const messages = theme.findings.map((finding) => finding.message).join("\n");
        expect(messages).toContain('section layout "mystery"');
    });

    it("groups a definition list written as HTML into rows", () => {
        const html = drawn.get("/notes/note-a/")!;
        const list = /<dl class="dictionary">[^]*?<\/dl>/.exec(html)?.[0];
        expect(list).toContain("<dt>Raw</dt>");
        expect(list).toMatch(/<div>\s*<dt>Raw<\/dt>\s*<dd><p>Raw definition<\/p><\/dd>\s*<\/div>/);
        expect(list).toMatch(/<div>\s*<dt>Second<\/dt>\s*<dd>Another<\/dd>\s*<\/div>/);
    });

    it("links a tag to its page only where the site writes one", () => {
        const note = drawn.get("/notes/note-a/")!;
        expect(note).toContain('href="/tags/alpha/"');
        const without = draw({ tagPages: false }).out.get("/notes/note-a/")!;
        expect(without).not.toMatch(/href="\/tags\//);
        expect(without).toContain("two words");
    });
});
