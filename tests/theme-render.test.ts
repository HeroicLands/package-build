/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A page the site build renders carries what the build assembled for it.
 *
 * A fixture package of a region, a hamlet, a house and a lay is built into a
 * site, and the pages are read back as a reader gets them: the page's own
 * heading, the site chrome, the infobox with its rows, and the generated
 * sections a place, a house and a work are given.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "../index.mjs";
import { NAVIGATION_FILE, navigationCacheDir } from "../engine/site-config.mjs";
import { buildPackageSite } from "../engine/site-render.mjs";

/**
 * A note of the given type, written into the fixture's content tree.
 *
 * `body` carries the prose, because a wikilink in it is what makes the build
 * write `related` on both ends of the link.
 */
function note(lines: string[], body = "Prose."): string {
    return ["---", ...lines, "---", "", body, ""].join("\n");
}

let root: string;
/** The rendered pages of the fixture, by path below the site's directory. */
let html: Map<string, string>;

beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-theme-render-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({
            name: "sandbox",
            version: "1.0.0",
            description: "A demonstration module.",
            homepage: "https://www.heroiclands.org/demo/",
            author: "Ann Author <ann@example.org>",
        }),
    );
    fs.mkdirSync(path.join(root, "build/cache/metadata"), { recursive: true });

    const content = path.join(root, "assets/content");
    const write = (rel: string, body: string) => {
        const file = path.join(content, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, body);
    };

    write("homepage.md", note(["type: homepage", "shortcode: root", "title: The Demo"]));
    write(
        "Places/place-rgn.md",
        note(
            [
                "type: place",
                "subType: region",
                "shortcode: rgn",
                "name:",
                "    full: The Region",
                "tags: [north]",
                "description: A wide region of moor and water.",
                "data:",
                "    parents: []",
                "    seeAlso:",
                "        - { address: affiliation-house, gloss: The ruling house }",
                "        - { address: place-ham }",
                // A stated border is what gives a place a From here section.
                "    borders:",
                "        - { to: ham, bearing: S }",
            ],
            "The moor is held by [[affiliation-house|House Stone]], whose seat lies south.",
        ),
    );
    write(
        "Places/place-ham.md",
        note([
            "type: place",
            "subType: hamlet",
            "shortcode: ham",
            "name:",
            "    full: Little Ham",
            "data:",
            "    parents: [place-rgn]",
            "    government: house",
            "    borders:",
            "        - { to: rgn, bearing: N }",
        ]),
    );
    write(
        "Affiliations/affiliation-house.md",
        note([
            "type: affiliation",
            "subType: house",
            "shortcode: house",
            "name:",
            "    full: House Stone",
            "data:",
            "    parents: []",
        ]),
    );

    write(
        "Lore/lore-hamlay.md",
        note(
            [
                "type: lore",
                "subType: literature",
                "shortcode: hamlay",
                "name:",
                "    full: The Lay of Little Ham",
                "data:",
                "    form: lay",
                "    subjects: [place-ham]",
            ],
            "See [[place-rgn|the region]].",
        ),
    );

    const config = defineConfig({
        rootDir: root,
        contentPackage: "demo",
        foundryPackage: "demo",
        packageKind: "modules",
        compatibility: { minimum: "14.359" },
        homepage: "https://www.heroiclands.org/demo/",
        authors: [{ name: "Ann Author" }],
        packageBuild: { manifest: { title: "The Demo" } },
        stats: { lastModifiedBy: "demobuilder0000" },
        packs: [{ name: "journals", type: "JournalEntry" }],
        publish: { address: { prefix: "kb/" } },
        site: {
            title: "The Demo",
            description: "A demonstration module.",
            assets: "https://cdn.example.org",
        },
    });

    const cache = navigationCacheDir(config);
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(
        path.join(cache, NAVIGATION_FILE),
        JSON.stringify([{ name: "Home", url: "https://www.heroiclands.org/" }]),
    );
    fs.writeFileSync(path.join(cache, ".complete"), "");

    const out = path.join(root, "build", "site", "demo");
    const built = await buildPackageSite({ config, out, year: 2026 });
    expect(built.written, "the site was written").toBeTruthy();
    expect(built.built.wikiErrors).toEqual([]);

    html = new Map();
    for (const file of fs.readdirSync(out, { recursive: true, encoding: "utf8" })) {
        if (file.endsWith(".html"))
            html.set(file.split(path.sep).join("/"), fs.readFileSync(path.join(out, file), "utf8"));
    }
}, 60_000);

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("the site renders a page the build emitted", () => {
    it("renders see-also ahead of inferred connections, once per destination", () => {
        const page = html.get("place-rgn/index.html")!;
        const related = page.slice(page.indexOf('<section class="related"'));
        expect(related).toContain("See also");
        expect(related).toContain("The ruling house");
        expect(related.match(/href="[^\"]*affiliation-house\/"/g)).toHaveLength(1);
        expect(related.indexOf("See also")).toBeLessThan(related.indexOf("The ruling house"));
        expect(related.indexOf("See also")).toBeLessThan(related.indexOf(">Lore</h3>"));
    });

    it("renders the region's own page", () => {
        const page = [...html.keys()].find((k) => k.includes("place-rgn"));
        expect(page, `rendered pages: ${[...html.keys()].join(", ")}`).toBeTruthy();
        const body = html.get(page!)!;
        expect(body).toContain("The Region");
    });

    it("draws the brand chrome the theme owns", () => {
        const page = [...html.keys()].find((k) => k.includes("place-rgn"))!;
        const body = html.get(page)!;
        expect(body).toMatch(/<header|site-header/);
        expect(body).toMatch(/<footer/);
    });

    it("draws the infobox the build assembled, with its own rows", () => {
        const page = [...html.keys()].find((k) => k.includes("place-rgn"))!;
        const body = html.get(page)!;
        // The build decides what a box holds; the partial switches on a
        // section's layout and a value's kind and on nothing else. So the
        // box's own title and a row's label are what prove it was drawn.
        expect(body).toContain("info-box");
        expect(body).toContain("Profile");
        expect(body).toContain("Borders");
    });

    /** The rendered HTML of one generated section, from its heading to the next H1. */
    const section = (key: string, slug: string): string => {
        const page = html.get([...html.keys()].find((k) => k.includes(key))!)!;
        const start = page.indexOf(`<h1 id="${slug}"`);
        if (start < 0) return "";
        const ends = ["<h1 ", '<section class="related"', '<nav class="single-nav"']
            .map((marker) => page.indexOf(marker, start + 1))
            .filter((at) => at > 0);
        return page.slice(start, Math.min(...ends));
    };

    it("sets the drawing the build made in the place's From here section", () => {
        expect(section("place-rgn", "fromhere")).toContain("From here");
        expect(section("place-rgn", "fromhere")).toMatch(
            /<figure class="note-image[^"]*"[^>]*>\s*<svg/,
        );
    });

    it("lists what the region contains in its Within section", () => {
        const within = section("place-rgn", "within");
        expect(within).toContain("Within");
        expect(within).toMatch(/<a href="[^"]*place-ham\/"[^>]*>Little Ham<\/a>/);
    });

    it("renders the governing body and its reverse place list as sections", () => {
        expect(section("place-ham", "governedby")).toMatch(
            /<a href="[^"]*affiliation-house\/"[^>]*>House Stone<\/a> \(house\)/,
        );
        const governed = section("affiliation-house", "governedplaces");
        expect(governed).toContain("Little Ham");
        expect(governed).not.toContain("The Region");
    });

    it("lists the works that name a place in its In song and story section", () => {
        const works = section("place-ham", "insongandstory");
        expect(works).toContain("In song and story");
        expect(works).toMatch(/<a href="[^"]*lore-hamlay\/"[^>]*>The Lay of Little Ham<\/a>/);
        expect(works).toContain("(lay)");
        expect(section("place-rgn", "insongandstory")).toBe("");
    });

    it("draws none of the cards the sections replace", () => {
        const page = html.get([...html.keys()].find((k) => k.includes("place-ham"))!)!;
        expect(page).not.toMatch(/class="(holdings|literature-works|place-map)/);
    });
});
