/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A page emitted by a site build renders through the theme this package ships.
 *
 * The theme's partials and the site build hold one contract between them: the
 * build writes a page's front matter, and `hugo-theme/layouts/` reads it. Both
 * halves live here, so the contract is checkable rather than a matter of two
 * repositories agreeing.
 *
 * **Both sides are derived, and the contract between them is declared once.**
 * `themeReads()` scrapes every `.Params.<name>` out of the shipped partials;
 * `emittedKeys()` runs a real site build over a fixture package and collects
 * the front matter it wrote. {@link CONTRACT} names the keys that appear in
 * both, and the case asserts set equality in both directions — so a key the
 * build stops writing, and a key the partials stop reading, each turn this
 * red. Neither list is maintained by hand; the declared set is the tripwire
 * between them.
 *
 * Some params a partial reads are not the build's to write: `series` and
 * `category` belong to a hand-authored blog post or documentation page, and
 * `brand`, `cdnBaseURL`, `home`, `notfound`, `search` and `draftNotice` are a
 * consumer's site configuration. Those are excluded by derivation rather than
 * by name — the site params come from the generated configuration's own
 * `params` block.
 *
 * The render cases drive a real Hugo and stand down without one.
 * `tests/hugo-available.test.ts` is the case that refuses, so a runner with no
 * Hugo fails there rather than reporting a green suite that rendered nothing.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import matter from "gray-matter";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "../index.mjs";
import { buildSite, gatesFailed } from "../engine/site-build.mjs";
import {
    HUGO_CONTENT,
    HUGO_SOURCE,
    NAVIGATION_FILE,
    THEME,
    navigationCacheDir,
    resolveThemesDir,
    writeHugoConfig,
} from "../engine/site-config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LAYOUTS = path.join(ROOT, "hugo-theme", "layouts");

/** Whether a Hugo answers, which the render cases need. */
const HAS_HUGO = spawnSync("hugo", ["version"], { encoding: "utf8" }).status === 0;

/**
 * The keys a site build writes that the theme's partials read.
 *
 * Declared so that a change on either side is a failure rather than a silently
 * smaller intersection. Adding a key here without the build writing it fails,
 * and so does removing one the partials still read.
 */
const CONTRACT = [
    "contains",
    "data",
    "description",
    "held_by",
    "holdings",
    "infoboxes",
    "map",
    "package",
    "related",
    "subType",
    "tags",
    "type",
] as const;

/** Every `.Params.<name>` the shipped partials read. */
function themeReads(): Set<string> {
    const found = new Set<string>();
    const walk = (dir: string): string[] =>
        fs
            .readdirSync(dir, { withFileTypes: true })
            .flatMap((e) =>
                e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
            );
    for (const file of walk(LAYOUTS)) {
        const body = fs.readFileSync(file, "utf8");
        for (const m of body.matchAll(/\.Params\.([A-Za-z_][A-Za-z0-9_]*)/g)) found.add(m[1]);
    }
    return found;
}

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
/** Every front-matter key the fixture's build emitted, across all its pages. */
let emitted: Set<string>;
/** The emitted page of the region, which carries the graph keys. */
let regionPage: Record<string, unknown>;

beforeAll(() => {
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
                // A stated border is what gives a place a drawing, and so a `map`.
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
            "    domains: [place-ham]",
        ]),
    );

    const config = defineConfig({
        rootDir: root,
        contentPackage: "demo",
        foundryPackage: "demo",
        packageKind: "modules",
        compatibility: { minimum: "14.359" },
        homepage: "https://www.heroiclands.org/demo/",
        author: { name: "Ann Author" },
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

    const result = buildSite({ config });
    expect(gatesFailed(result.gates)).toBe(false);
    expect(result.wikiErrors).toEqual([]);

    const base = path.join(root, HUGO_CONTENT);
    const pages = (function walk(dir: string): string[] {
        return fs
            .readdirSync(dir, { withFileTypes: true })
            .flatMap((e) =>
                e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
            );
    })(base).filter((f) => f.endsWith(".md"));

    emitted = new Set<string>();
    for (const file of pages) {
        const data = matter(fs.readFileSync(file, "utf8")).data;
        for (const key of Object.keys(data)) emitted.add(key);
        if (file.includes("place-rgn")) regionPage = data;
    }

    // `writeHugoConfig` reads the navigation a `deps fetch` caches. The
    // fixture publishes its own, so the build needs no network.
    const cache = navigationCacheDir(config);
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(
        path.join(cache, NAVIGATION_FILE),
        JSON.stringify([{ name: "Home", url: "https://www.heroiclands.org/" }]),
    );
    fs.writeFileSync(path.join(cache, ".complete"), "");

    writeHugoConfig(config);
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("the contract between a site build and the theme it ships with", () => {
    it("emits pages at all, so the sets below are not empty by accident", () => {
        expect(emitted.size).toBeGreaterThan(5);
        expect(themeReads().size).toBeGreaterThan(5);
        expect(regionPage).toBeTruthy();
    });

    it("writes every key the partials read and this package is responsible for", () => {
        const read = themeReads();
        const intersection = [...read].filter((key) => emitted.has(key)).sort();
        expect(intersection).toEqual([...CONTRACT].sort());
    });

    it("names in the contract nothing the partials ignore", () => {
        const read = themeReads();
        for (const key of CONTRACT) expect(read.has(key), `no partial reads ${key}`).toBe(true);
    });

    it("names in the contract nothing the build leaves unwritten", () => {
        for (const key of CONTRACT) {
            expect(emitted.has(key), `the build writes no ${key}`).toBe(true);
        }
    });
});

describe("the theme renders a page the build emitted", () => {
    /** Hugo's rendered output for the fixture, built once. */
    let html: Map<string, string>;

    beforeAll(() => {
        if (!HAS_HUGO) return;
        const source = path.join(root, HUGO_SOURCE);
        const out = path.join(root, "build", "rendered");
        const run = spawnSync(
            "hugo",
            ["--source", source, "--destination", out, "--logLevel", "warn"],
            { encoding: "utf8" },
        );
        expect(run.status, `hugo failed: ${run.stderr ?? ""}`).toBe(0);
        html = new Map();
        const walk = (dir: string): string[] =>
            fs.existsSync(dir) ?
                fs
                    .readdirSync(dir, { withFileTypes: true })
                    .flatMap((e) =>
                        e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
                    )
            :   [];
        for (const file of walk(out).filter((f) => f.endsWith(".html"))) {
            html.set(
                path.relative(out, file).split(path.sep).join("/"),
                fs.readFileSync(file, "utf8"),
            );
        }
    });

    it("finds the theme this package ships, with nothing installed", () => {
        const themesDir = resolveThemesDir(root);
        const layouts = path.resolve(root, HUGO_SOURCE, themesDir, THEME, "layouts");
        expect(fs.existsSync(path.join(layouts, "_default", "single.html"))).toBe(true);
    });

    it.runIf(HAS_HUGO)("renders the region's own page", () => {
        const page = [...html.keys()].find((k) => k.includes("place-rgn"));
        expect(page, `rendered pages: ${[...html.keys()].join(", ")}`).toBeTruthy();
        const body = html.get(page!)!;
        expect(body).toContain("The Region");
    });

    it.runIf(HAS_HUGO)("draws the brand chrome the theme owns", () => {
        const page = [...html.keys()].find((k) => k.includes("place-rgn"))!;
        const body = html.get(page)!;
        expect(body).toMatch(/<header|site-header/);
        expect(body).toMatch(/<footer/);
    });

    it.runIf(HAS_HUGO)("draws the infobox the build assembled, with its own rows", () => {
        const page = [...html.keys()].find((k) => k.includes("place-rgn"))!;
        const body = html.get(page)!;
        // The build decides what a box holds; the partial switches on a
        // section's layout and a value's kind and on nothing else. So the
        // box's own title and a row's label are what prove it was drawn.
        expect(body).toContain("info-box");
        expect(body).toContain("Profile");
        expect(body).toContain("Borders");
    });

    it.runIf(HAS_HUGO)("draws the drawing the build made for the place", () => {
        const page = [...html.keys()].find((k) => k.includes("place-rgn"))!;
        expect(html.get(page)!).toMatch(/<svg|place-map/);
    });

    it.runIf(HAS_HUGO)("lists what the region contains", () => {
        const page = [...html.keys()].find((k) => k.includes("place-rgn"))!;
        const body = html.get(page)!;
        expect(body).toContain("Little Ham");
    });
});
