/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A page declines its hero image with `data.banner: none`.**
 *
 * `none` is the one accepted spelling. It lints clean and reaches the theme as
 * a blank, which the theme reads as "no hero image, and no warning"; any other
 * `data.banner` address that matches no image is a located finding; and `""`
 * stays an error. Proved on a homepage and on a content page, because the two
 * reach Hugo by different routes.
 */

import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import { readMatter } from "../engine/note-matter.mjs";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "../index.mjs";
import { buildSite } from "../engine/site-build.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const HERO_URL = "https://cdn.example.org/demo/images/hero.png";
const roots: string[] = [];
afterAll(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

/** A one-pixel PNG, so the sandbox holds a real image asset. */
const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==",
    "base64",
);

/** A sandbox tree: a homepage, a doc page, and one image asset `hero`. */
function sandbox(banners: { home?: string; page?: string }) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-banner-"));
    roots.push(root);
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sandbox", version: "1.0.0" }),
    );
    const put = (rel: string, text: string | Buffer) => {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    };
    const data = (banner?: string) => (banner === undefined ? "" : `data:\n  banner: ${banner}\n`);
    put(
        "assets/content/homepage.md",
        `---\ntype: homepage\nshortcode: root\n${data(banners.home)}---\n\nFront.\n`,
    );
    put(
        "assets/content/Rules/Combat.md",
        `---\ntype: doc\nsubType: rules\nshortcode: combat\nname:\n  full: Combat\n${data(banners.page)}---\n\nProse.\n`,
    );
    put("assets/images/hero.png", PNG);
    put("assets/images/provenance.yaml", "attribution: A\nlicense: CC0-1.0\nai: false\n");
    return root;
}

function configFor(root: string) {
    return defineConfig({
        rootDir: root,
        contentPackage: "demo",
        foundryPackage: "demo",
        packageKind: "modules",
        compatibility: { minimum: "14.359" },
        stats: { lastModifiedBy: "demobuilder0000" },
        packs: [{ name: "journals", type: "JournalEntry" }],
        publish: { address: { prefix: "kb/" } },
        site: { assets: "https://cdn.example.org/" },
    });
}

/** The `data.banner` Hugo is handed for the homepage and for the doc page. */
function emitted(banners: { home?: string; page?: string }) {
    const root = sandbox(banners);
    buildSite({ config: configFor(root) });
    const read = (rel: string) =>
        readMatter(fs.readFileSync(path.join(root, "build/hugo/content", rel), "utf8")).data;
    return {
        home: read("_index.md"),
        page: read("kb/doc-combat.md"),
    };
}

const bannerFindings = (banners: { home?: string; page?: string }) => {
    const root = sandbox(banners);
    const config = configFor(root);
    const index = buildLinkIndex(path.join(root, "assets/content"), {
        config,
        skipDirectories: [],
    });
    return lintFrontmatter(index, {
        schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
        vocabulary: NOTE_VOCABULARY,
    }).findings.filter((f: any) => /banner/.test(f.message));
};

describe("`data.banner: none` declines the hero image", () => {
    it("lints clean", () => {
        expect(bannerFindings({ home: "none", page: "none" })).toEqual([]);
    });

    it("reaches the theme as a blank on a homepage", () => {
        expect(emitted({ home: "none" }).home.data.banner).toBe("");
    });

    it("reaches the theme as a blank on a content page", () => {
        expect(emitted({ page: "none" }).page.data.banner).toBe("");
    });

    it("emits no address for the sentinel", () => {
        const { home, page } = emitted({ home: "none", page: "none" });
        expect(JSON.stringify(home)).not.toMatch(/none-image-none/);
        expect(JSON.stringify(page)).not.toMatch(/none-image-none/);
    });
});

describe("a `data.banner` address", () => {
    it("that names an image lints clean", () => {
        expect(bannerFindings({ home: "hero", page: "hero" })).toEqual([]);
    });

    it("that names an image resolves to the URL the asset host serves on a content page", () => {
        const { page } = emitted({ page: "hero" });
        expect(page.data.banner).toBe(HERO_URL);
    });

    it("that names an image resolves to the URL the asset host serves on a homepage", () => {
        expect(emitted({ home: "hero" }).home.data.banner).toBe(HERO_URL);
    });

    it("that names no image is a finding at its line and column", () => {
        const found = bannerFindings({ home: "nosuchimage" });
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ severity: "error", line: 5, column: 11 });
        expect(found[0].message).toMatch(/data\.banner/);
        expect(found[0].message).toMatch(/nosuchimage/);
        expect(found[0].message).toMatch(/none/);
    });

    it("that names no image on a content page is a finding too", () => {
        expect(bannerFindings({ page: "nosuchimage" })).toHaveLength(1);
    });
});

describe("a blank `data.banner`", () => {
    it('stays an error: `""` is not a way to decline', () => {
        const found = bannerFindings({ home: '""' });
        expect(found.some((f: any) => f.severity === "error")).toBe(true);
    });
});
