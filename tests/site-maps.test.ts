/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A place page carries the map from that place in its **From here** section.
 *
 * The site build draws the map from every place that states, or is named in,
 * a border or a route, and sets each drawing inline in the place's generated
 * **From here** section, so its place names stay links. Every page is one flat
 * file, and no drawing is written beside one. A place with no relation, and
 * every page that is not a place, is given no section. `site.maps: false`
 * draws nothing and gives no place the section.
 *
 * The fixture is a homepage, two places that border each other, a third with
 * no relation, and a being.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import matter from "gray-matter";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "../index.mjs";
import { buildSite, gatesFailed } from "../engine/site-build.mjs";
import { SITE_MAP_DIR, inlineSvg } from "../engine/site-maps.mjs";
import { prepareTreeSqlTables } from "../engine/sql-tables.mjs";

let root: string;

function note(rel: string, frontmatter: string, body = "Prose.\n") {
    const file = path.join(root, "assets/content", rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `---\n${frontmatter.trim()}\n---\n\n${body}`);
    return file;
}

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-site-maps-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sandbox", version: "1.0.0" }),
    );
    fs.mkdirSync(path.join(root, "build/cache/metadata"), { recursive: true });
    note("homepage.md", "type: homepage\nshortcode: root\ntitle: The Demo", "Front.\n");
    // Alpha and Beta border each other, and each says so.
    note(
        "Places/Alpha.md",
        `type: place
subType: region
shortcode: alpha
name:
    full: Alpha
data:
    borders:
        - { to: beta, bearing: E }`,
        "West of [[place-beta|Beta]].\n",
    );
    note(
        "Places/Beta.md",
        `type: place
subType: region
shortcode: beta
name:
    full: Beta
data:
    borders:
        - { to: alpha, bearing: W }`,
        "East of [[place-alpha|Alpha]].\n",
    );
    // Gamma states no relation and is named in none.
    note(
        "Places/Gamma.md",
        `type: place
subType: region
shortcode: gamma
name:
    full: Gamma`,
        "Alone.\n",
    );
    note(
        "Beings/Ash.md",
        `type: being
shortcode: ash
name:
    full: Ash`,
        "Lives in [[place-alpha|Alpha]].\n",
    );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function config(site: Record<string, unknown> = {}) {
    return defineConfig({
        rootDir: root,
        contentPackage: "demo",
        foundryPackage: "demo",
        packageKind: "modules",
        compatibility: { minimum: "14.359" },
        stats: { lastModifiedBy: "demobuilder0000" },
        packs: [
            { name: "items", type: "Item" },
            { name: "journals", type: "JournalEntry" },
        ],
        publish: { address: { prefix: "kb/" } },
        site: { ...site },
    });
}

const MOUNT = () => path.join(root, "build/hugo/content/kb");

/** The published front matter of one page under the content mount. */
function published(rel: string): Record<string, unknown> {
    return matter(fs.readFileSync(path.join(MOUNT(), rel), "utf8")).data;
}

/** The published body of one page under the content mount. */
function body(rel: string): string {
    return matter(fs.readFileSync(path.join(MOUNT(), rel), "utf8")).content;
}

/** Build the site, its generated sections prepared as the command prepares them. */
async function build(site: Record<string, unknown> = {}) {
    const resolved = config(site);
    const sqlTables = await prepareTreeSqlTables(resolved.paths.content, {
        config: resolved,
        skipDirectories: resolved.skipDirectories,
        audience: "public",
    });
    return buildSite({ config: resolved, sqlTables });
}

/** Every emitted file below the mount, POSIX-separated and sorted. */
function emitted(): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, e.name);
            if (e.isDirectory()) walk(full);
            else out.push(path.relative(MOUNT(), full).split(path.sep).join("/"));
        }
    };
    walk(MOUNT());
    return out.sort();
}

describe("`site.maps`", () => {
    it("is on unless the configuration says otherwise", () => {
        expect(config().site.maps).toBe(true);
        expect(config({ maps: false }).site.maps).toBe(false);
    });

    it("refuses anything but a boolean", () => {
        expect(() => config({ maps: "yes" })).toThrow(/`site\.maps` must be a boolean/);
    });
});

describe("every related place's page carries the map from it", () => {
    let result: ReturnType<typeof buildSite>;

    beforeAll(async () => {
        result = await build();
        expect(gatesFailed(result.gates)).toBe(false);
        expect(result.imageErrors).toEqual([]);
    }, 60_000);

    it("sets the drawing inline in the place's From here section", () => {
        for (const rel of ["place-alpha.md", "place-beta.md"]) {
            const text = body(rel);
            expect(text, rel).toMatch(/^# From here \{#fromhere\}$/m);
            const section = text.slice(text.indexOf("{#fromhere}"));
            expect(section, rel).toMatch(
                /<figure class="note-image note-image-full-width"[^>]*>\n<svg/,
            );
        }
    });

    it("writes every page flat, with nothing beside it and no `map` key", () => {
        const files = emitted();
        expect(files).toContain("place-alpha.md");
        expect(files).toContain("place-gamma.md");
        expect(files).toContain("being-ash.md");
        expect(files.filter((f) => !f.endsWith(".md"))).toEqual([]);
        for (const rel of ["place-alpha.md", "place-gamma.md", "being-ash.md"])
            expect(Object.hasOwn(published(rel), "map"), rel).toBe(false);
    });

    it("keeps each page's address, stated as `/<slug>/`", () => {
        expect(published("place-alpha.md").url).toBe("/place-alpha/");
        expect(published("place-alpha.md").slug).toBe("place-alpha");
    });

    it("gives a place with no relation, and a being, no From here section", () => {
        expect(body("place-gamma.md")).not.toContain("{#fromhere}");
        expect(body("being-ash.md")).not.toContain("{#fromhere}");
    });

    it("links every place name to its page, composing `<base><slug>/`", () => {
        const text = body("place-alpha.md");
        expect(text).toContain('href="/demo/place-beta/"');
        expect(text).toContain('href="/demo/place-alpha/"');
        expect(text).toContain(">Beta<");
    });

    it("sets the drawing for inlining, with no blank line to end its HTML block", () => {
        const text = body("place-alpha.md");
        const figure = text.slice(text.indexOf("<figure"), text.indexOf("</figure>"));
        expect(figure).not.toMatch(/\n\s*\n/);
        expect(figure).not.toMatch(/<\?xml|<!DOCTYPE|<!--|xlink:/);
        expect(figure).toMatch(/<svg[^>]*\sviewBox="/);
    });

    it("reports the drawings among its counts, and no warning", () => {
        expect(result.stats?.maps).toBe(2);
        expect(result.mapFindings).toEqual([]);
    });

    it("draws under build/map/site, which the mount never reads", () => {
        expect(SITE_MAP_DIR).toBe("build/map/site");
        expect(fs.existsSync(path.join(root, SITE_MAP_DIR, "from-alpha.svg"))).toBe(true);
    });

    it("draws nothing and gives no place the section with `site.maps: false`", async () => {
        const off = await build({ maps: false });
        expect(gatesFailed(off.gates)).toBe(false);
        expect(body("place-alpha.md")).not.toContain("{#fromhere}");
        expect(body("place-beta.md")).not.toContain("<svg");
        expect(off.stats?.maps).toBe(0);
        expect(off.mapFindings).toEqual([]);
        expect(fs.existsSync(path.join(root, SITE_MAP_DIR, "from-alpha.svg"))).toBe(false);
    });
});

describe("inlineSvg", () => {
    it("strips the prologue GraphViz writes, and sizes the root by viewBox alone", () => {
        const out = inlineSvg(
            [
                '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
                '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"',
                ' "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">',
                "<!-- Generated by graphviz version 12.0.0 (0) -->",
                "<!-- Title: from_alpha Pages: 1 -->",
                '<svg width="100pt" height="50pt"',
                ' viewBox="0.00 0.00 100.00 50.00" xmlns="http://www.w3.org/2000/svg"',
                ' xmlns:xlink="http://www.w3.org/1999/xlink">',
                '<g><a xlink:href="/demo/place-beta/" xlink:title="beta"><text>Beta</text></a></g>',
                "</svg>",
                "",
            ].join("\n"),
        );
        expect(out).toBe(
            [
                '<svg viewBox="0.00 0.00 100.00 50.00" xmlns="http://www.w3.org/2000/svg">',
                '<g><a href="/demo/place-beta/" title="beta"><text>Beta</text></a></g>',
                "</svg>",
                "",
            ].join("\n"),
        );
    });
});
