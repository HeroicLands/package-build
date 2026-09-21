/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Every content page carries what links to it and what it links to.
 *
 * The site build resolves every wikilink through the address index, so at the
 * moment it writes a page it holds the whole link graph. These cases pin what
 * it publishes of that graph: the `related` front matter the theme's Related
 * card reads, with the same shape on every page, and absent on a page nothing
 * connects to.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import matter from "gray-matter";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "../index.mjs";
import { buildSite, gatesFailed } from "../engine/site-build.mjs";
import { homepageLinkTargets, relatedPages } from "../engine/related-pages.mjs";

let root: string;

function note(rel: string, frontmatter: string, body = "Prose.\n") {
    const file = path.join(root, "assets/content", rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `---\n${frontmatter.trim()}\n---\n\n${body}`);
    return file;
}

/** A being note, named and addressed, with the body it links from. */
const being = (shortcode: string, name: string, body: string) =>
    note(
        `Beings/${name}.md`,
        `type: being
shortcode: ${shortcode}
name:
    full: ${name}`,
        body,
    );

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-related-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sandbox", version: "1.0.0" }),
    );
    fs.mkdirSync(path.join(root, "build/cache/metadata"), { recursive: true });

    // The homepage links the way a homepage does — markdown, package-relative
    // — twice to one page, and once to somewhere outside the site.
    note(
        "homepage.md",
        "type: homepage\nshortcode: root\ntitle: The Demo",
        "Start with [Ash](being-ash/), or [Ash again](/demo/being-ash/).\n\n" +
            "Elsewhere: [the source](https://example.com/demo).\n",
    );
    // A triangle — Ash → Birch → Cedar → Ash — plus the `doc<type>` form of
    // one edge, a repeat of it, a self-link, and one link out of the triangle
    // to a page of another type.
    being(
        "ash",
        "Ash",
        "Knows [[being-birch|Birch]], whose file is [[docbeing-birch|the same page]], " +
            "and [[being-birch|Birch]] once more. Lives at [[place-glade|the Glade]]. " +
            "Is [[being-ash|Ash]].\n",
    );
    being("birch", "Birch", "Follows [[being-cedar|Cedar]].\n");
    being("cedar", "Cedar", "Follows [[being-ash|Ash]], from [[homepage-root|the front page]].\n");
    note(
        "Places/Glade.md",
        `type: place
shortcode: glade
name:
    full: Glade`,
        "A clearing. Nothing here links out.\n",
    );
    note(
        "Lore/Silence.md",
        `type: lore
shortcode: silence
name:
    full: Silence`,
        "Nothing links here, and this links nowhere.\n",
    );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function config() {
    return defineConfig({
        rootDir: root,
        contentPackage: "demo",
        foundryPackage: "demo",
        packageKind: "modules",
        stats: { lastModifiedBy: "demobuilder0000" },
        packs: [
            { name: "items", type: "Item" },
            { name: "journals", type: "JournalEntry" },
        ],
        publish: { site: "content", address: { prefix: "kb/" } },
    });
}

/** The published front matter of one page under the content mount. */
function published(rel: string): Record<string, unknown> {
    return matter(fs.readFileSync(path.join(root, "build/hugo/content", rel), "utf8")).data;
}

const ash = { title: "Ash", url: "/demo/being-ash/", type: "being" };
const birch = { title: "Birch", url: "/demo/being-birch/", type: "being" };
const cedar = { title: "Cedar", url: "/demo/being-cedar/", type: "being" };
const glade = { title: "Glade", url: "/demo/place-glade/", type: "place" };
const home = { title: "The Demo", url: "/demo/", type: "homepage" };

describe("every page carries what links to it and what it links to", () => {
    beforeAll(() => {
        const result = buildSite({ config: config() });
        expect(gatesFailed(result.gates)).toBe(false);
        expect(result.wikiErrors).toEqual([]);
    });

    it("inverts the triangle, and a `doc<type>` link is a link to the one page", () => {
        // Ash links Birch three ways — short, `docbeing`, and again — and
        // Birch lists Ash once; the self-link is dropped on both sides.
        expect(published("kb/being-ash.md").related).toEqual({
            backlinks: [cedar, home],
            mentions: [birch, glade],
        });
        expect(published("kb/being-birch.md").related).toEqual({
            backlinks: [ash],
            mentions: [cedar],
        });
        expect(published("kb/being-cedar.md").related).toEqual({
            backlinks: [birch],
            mentions: [ash, home],
        });
    });

    it("keeps both lists on a page connected one way only", () => {
        expect(published("kb/place-glade.md").related).toEqual({
            backlinks: [ash],
            mentions: [],
        });
    });

    it("writes no `related` key on a page with no links either way", () => {
        expect(published("kb/lore-silence.md")).not.toHaveProperty("related");
    });

    it("counts the homepage on both sides", () => {
        // Two markdown links to Ash collapse to one mention; the external
        // link names no page of this site.
        expect(published("_index.md").related).toEqual({
            backlinks: [cedar],
            mentions: [ash],
        });
    });

    it("composes `<base><slug>/` on every entry, where the page itself states `/<slug>/`", () => {
        const page = published("kb/being-ash.md");
        expect(page.url).toBe("/being-ash/");
        const related = page.related as { mentions: { url: string }[] };
        for (const entry of related.mentions) {
            expect(entry.url).toMatch(/^\/demo\/[a-z]+-[a-z]+\/$/);
        }
    });
});

describe("relatedPages", () => {
    const entries = new Map(
        [ash, birch, cedar, glade, home].map((entry) => [entry.url, entry] as const),
    );

    it("sorts each list by type, then title, so the theme's grouping is stable", () => {
        const related = relatedPages(
            [
                [glade.url, home.url],
                [glade.url, cedar.url],
                [glade.url, ash.url],
                [glade.url, birch.url],
            ],
            entries,
        );
        expect(related.get(glade.url)?.mentions).toEqual([ash, birch, cedar, home]);
        expect(related.get(home.url)?.backlinks).toEqual([glade]);
    });

    it("collapses a self-link and a repeated link", () => {
        const related = relatedPages(
            [
                [ash.url, ash.url],
                [ash.url, birch.url],
                [ash.url, birch.url],
            ],
            entries,
        );
        expect(related.get(ash.url)).toEqual({ backlinks: [], mentions: [birch] });
        expect(related.get(birch.url)).toEqual({ backlinks: [ash], mentions: [] });
    });

    it("ignores an edge to or from an address that is not a page of this site", () => {
        const related = relatedPages(
            [
                [ash.url, "/other/place-far/"],
                ["/other/place-far/", birch.url],
            ],
            entries,
        );
        expect(related.size).toBe(0);
    });
});

describe("homepageLinkTargets", () => {
    it("resolves a package-relative, a root-relative and an anchored link against the base", () => {
        expect(
            homepageLinkTargets(
                "[a](being-ash/) [b](/demo/being-birch/) [c](./being-cedar/#top) [d](#here)",
                "/demo/",
            ),
        ).toEqual(["/demo/being-ash/", "/demo/being-birch/", "/demo/being-cedar/", "/demo/"]);
    });

    it("names no target for a link that leaves the site", () => {
        expect(
            homepageLinkTargets(
                "[x](https://example.com/demo/being-ash/) [y](mailto:someone@example.com)",
                "/demo/",
            ),
        ).toEqual([]);
    });
});
