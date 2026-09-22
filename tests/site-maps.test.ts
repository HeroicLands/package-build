/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A place page carries the map from that place.
 *
 * The site build draws the map from every place that states, or is named in,
 * a border or a route, and writes each drawing into its page: the page becomes
 * a leaf bundle, `from-<shortcode>.svg` sits beside its `index.md`, and the
 * front matter names the file as `map`. A place with no relation, and every
 * page that is not a place, is written flat as before and carries no `map`
 * key. `site.maps: false` draws nothing; GraphViz absent draws nothing and
 * says so once, without failing the build.
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
import { buildSite, gatesFailed, pageDestination } from "../engine/site-build.mjs";
import { findGraphviz } from "../engine/map-graphviz.mjs";
import { SITE_MAP_DIR, inlineSvg } from "../engine/site-maps.mjs";

/** Whether GraphViz is reachable, which the drawing cases need. */
const NEATO = findGraphviz("neato");

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
    // Gamma states no relation and is named in none — and names a map it
    // has no claim to.
    note(
        "Places/Gamma.md",
        `type: place
subType: region
shortcode: gamma
map: from-gamma.svg
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
        stats: { lastModifiedBy: "demobuilder0000" },
        packs: [
            { name: "items", type: "Item" },
            { name: "journals", type: "JournalEntry" },
        ],
        publish: { site: "content", address: { prefix: "kb/" } },
        site: { ...site },
    });
}

const MOUNT = () => path.join(root, "build/hugo/content/kb");

/** The published front matter of one page under the content mount. */
function published(rel: string): Record<string, unknown> {
    return matter(fs.readFileSync(path.join(MOUNT(), rel), "utf8")).data;
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

describe("a page with a map is a leaf bundle; every other page is flat", () => {
    const page = { slug: "place-alpha" };

    it("names `<slug>/index.md` for a page that carries a resource", () => {
        expect(pageDestination(page as never)).toBe("place-alpha.md");
        expect(pageDestination(page as never, { bundle: true })).toBe("place-alpha/index.md");
    });
});

describe.runIf(NEATO)("every related place's page carries the map from it", () => {
    let result: ReturnType<typeof buildSite>;

    beforeAll(() => {
        result = buildSite({ config: config() });
        expect(gatesFailed(result.gates)).toBe(false);
    });

    it("writes the drawing into each related page's bundle and names it in front matter", () => {
        const files = emitted();
        expect(files).toContain("place-alpha/index.md");
        expect(files).toContain("place-alpha/from-alpha.svg");
        expect(files).toContain("place-beta/index.md");
        expect(files).toContain("place-beta/from-beta.svg");
        expect(published("place-alpha/index.md").map).toBe("from-alpha.svg");
        expect(published("place-beta/index.md").map).toBe("from-beta.svg");
    });

    it("keeps each page's address, stated as `/<slug>/`", () => {
        expect(published("place-alpha/index.md").url).toBe("/place-alpha/");
        expect(published("place-alpha/index.md").slug).toBe("place-alpha");
    });

    it("writes a place with no relation, and a being, flat and without a `map` key", () => {
        // Gamma authored one; `map` is derived, so it is dropped.
        const files = emitted();
        expect(files).toContain("place-gamma.md");
        expect(files).toContain("being-ash.md");
        expect(files.filter((f) => f.startsWith("place-gamma/"))).toEqual([]);
        expect(Object.hasOwn(published("place-gamma.md"), "map")).toBe(false);
        expect(Object.hasOwn(published("being-ash.md"), "map")).toBe(false);
        // Nothing else lands in a bundle: the map is the only resource.
        expect(files.filter((f) => f.endsWith(".svg"))).toEqual([
            "place-alpha/from-alpha.svg",
            "place-beta/from-beta.svg",
        ]);
        expect(files.filter((f) => f.endsWith(".dot"))).toEqual([]);
    });

    it("links every place name to its page, composing `<base><slug>/`", () => {
        const svg = fs.readFileSync(path.join(MOUNT(), "place-alpha/from-alpha.svg"), "utf8");
        expect(svg).toContain('href="/demo/place-beta/"');
        expect(svg).toContain('href="/demo/place-alpha/"');
        expect(svg).toContain(">Beta<");
    });

    it("is written for inlining: no external reference, sized by `viewBox`", () => {
        const svg = fs.readFileSync(path.join(MOUNT(), "place-alpha/from-alpha.svg"), "utf8");
        expect(svg.startsWith("<svg")).toBe(true);
        expect(svg).not.toMatch(/<\?xml/);
        expect(svg).not.toMatch(/<!DOCTYPE/);
        expect(svg).not.toMatch(/<!--/);
        expect(svg).not.toMatch(/xlink:/);
        expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg")/);
        expect(svg).toMatch(/^<svg[^>]*\sviewBox="/);
        expect(svg).not.toMatch(/^<svg[^>]*\swidth="/);
        expect(svg).not.toMatch(/^<svg[^>]*\sheight="/);
    });

    it("reports the drawings among its counts, and no warning", () => {
        expect(result.stats?.maps).toBe(2);
        expect(result.mapFindings).toEqual([]);
    });

    it("draws under build/map/site, which the mount never reads", () => {
        expect(SITE_MAP_DIR).toBe("build/map/site");
        expect(fs.existsSync(path.join(root, SITE_MAP_DIR, "from-alpha.svg"))).toBe(true);
    });

    it("draws nothing and names nothing with `site.maps: false`", () => {
        const off = buildSite({ config: config({ maps: false }) });
        expect(gatesFailed(off.gates)).toBe(false);
        const files = emitted();
        expect(files.filter((f) => f.endsWith(".svg"))).toEqual([]);
        expect(files).toContain("place-alpha.md");
        expect(files).toContain("place-beta.md");
        expect(Object.hasOwn(published("place-alpha.md"), "map")).toBe(false);
        expect(off.stats?.maps).toBe(0);
        expect(off.mapFindings).toEqual([]);
    });
});

describe("with GraphViz absent", () => {
    it("says so once, writes every page as it is without maps, and fails nothing", () => {
        const result = buildSite({ config: config(), locate: () => undefined });
        expect(gatesFailed(result.gates)).toBe(false);
        expect(result.mapFindings).toHaveLength(1);
        expect(result.mapFindings[0].severity).toBe("warning");
        expect(result.mapFindings[0].message).toMatch(/GraphViz/);
        expect(result.mapFindings[0].message).toMatch(/site\.maps/);
        expect(result.mapFindings[0].file).toBe(root);
        expect(result.stats?.maps).toBe(0);
        const files = emitted();
        expect(files.filter((f) => f.endsWith(".svg"))).toEqual([]);
        expect(files).toContain("place-alpha.md");
        expect(Object.hasOwn(published("place-alpha.md"), "map")).toBe(false);
        expect(fs.existsSync(path.join(root, SITE_MAP_DIR))).toBe(false);
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
