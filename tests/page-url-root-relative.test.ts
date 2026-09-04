/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A page's stated `url:` is **site-root relative**; every href is **site
 * absolute** (#217).
 *
 * The two used to be one value. `site.base` is correctly where the package is
 * served — the prefix on every `href` this build writes into a page body, and
 * the base a link-manifest `path` is measured against — and it was also written
 * verbatim into each page's Hugo `url:` front matter. Hugo reads `url` as
 * relative to the site root, and for every consumer that exists the Hugo site's
 * root already *is* the package base, so the prefix was written twice and every
 * content page published one package segment too deep
 * (`/sohl/sohl/doc-rulesintro/`).
 *
 * These cases pin the split, from both ends: what a page states about itself,
 * and what everything that points *at* a page composes.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "../index.mjs";
import { buildSite, collectContentPages, pageFrontmatter } from "../engine/site-build.mjs";
import { homepageFrontmatter } from "../engine/homepage.mjs";
import { buildSiteIndex } from "../engine/site-index.mjs";
import { buildManifest } from "../engine/kb-manifest.mjs";

let root: string;

function write(rel: string, text: string) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
}

function note(rel: string, frontmatter: string, body = "Prose.\n") {
    return write(path.join("assets/content", rel), `---\n${frontmatter.trim()}\n---\n\n${body}`);
}

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-pageurl-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sandbox", version: "1.0.0" }),
    );
    fs.mkdirSync(path.join(root, "assets/manifests"), { recursive: true });

    note("homepage.md", "type: homepage\nshortcode: root", "The module, in its own words.\n");
    note(
        "Gear/Dagger.md",
        `type: weapongear
shortcode: dagger
name:
    full: Dagger`,
        "A blade.\n",
    );
    note(
        "Rules/Combat.md",
        `type: doc
subType: rules
shortcode: combat
name:
    full: Combat`,
        "Fighting, with a [[weapongear-dagger|dagger]].\n",
    );

    write("docs/README.md", `---\nsubType: dev-docs\n---\n\n# Developer Documentation\n\nIntro.\n`);
    write("docs/how-to/testing.md", `---\nsubType: dev-docs\n---\n\n# Testing\n\nProse.\n`);
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function configFor(site: Record<string, unknown> = {}) {
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
        publish: {
            site: "content",
            manifests: { publish: true, consume: true },
            address: { prefix: "kb/" },
        },
        site: {
            out: "out",
            sections: { rules: { title: "The Rules" } },
            trees: [{ from: "docs", section: "dev-docs" }],
            ...site,
        },
    });
}

const ctx = {
    packages: new Set(["demo"]),
    contentPackage: "demo",
    skipDirectories: [],
    base: "/demo/",
    mount: "/demo/kb/",
    scheme: { prefix: "kb/" },
};

/** The emitted page for an address, under a build's output mount. */
function page(out: string, slug: string) {
    return fs.readFileSync(path.join(root, out, "kb", `${slug}.md`), "utf8");
}

describe("a page states its address relative to the site root", () => {
    it("writes `url: /<slug>/`, whatever base the package is served at", () => {
        // The whole defect: this used to be `page.url`, which already carried
        // the package base, and Hugo prefixes the base again.
        const data = pageFrontmatter(
            {
                kind: "content",
                fm: { type: "weapongear" },
                pkg: "demo",
                name: "Dagger",
                slug: "weapongear-dagger",
                url: "/demo/weapongear-dagger/",
                folder: "Gear",
            } as never,
            {},
        );
        expect(data.url).toBe("/weapongear-dagger/");
        // `slug` still rides alongside it — it is the last segment of the
        // address and Hugo's own key for one.
        expect(data.slug).toBe("weapongear-dagger");
    });

    it("states the homepage's address the same way", () => {
        const data = homepageFrontmatter(
            { type: "homepage", shortcode: "root" },
            { contentPackage: "demo", title: "The Demo Module" },
        );
        expect(data.url).toBe("/homepage-root/");
    });
});

describe("everything that points at a page keeps the package base", () => {
    it("collects each page's URL site-absolute", () => {
        const { pages } = collectContentPages(path.join(root, "assets/content"), ctx);
        const byName = Object.fromEntries(pages.map((p) => [p.name, p.url]));
        expect(byName.Dagger).toBe("/demo/weapongear-dagger/");
    });

    it("indexes it site-absolute, which is what a resolved wikilink writes", () => {
        const { pages } = collectContentPages(path.join(root, "assets/content"), ctx);
        const index = buildSiteIndex(pages);
        expect(index.index.get("weapongear/dagger")?.url).toBe("/demo/weapongear-dagger/");
        expect(index.index.get("demo-weapongear-dagger")?.url).toBe("/demo/weapongear-dagger/");
    });

    it("measures a link-manifest `path` against that base, and it still strips", () => {
        const { pages } = collectContentPages(path.join(root, "assets/content"), ctx);
        const manifest = buildManifest("demo", pages, "/demo/");
        expect(manifest.entries["demo-weapongear-dagger"].path).toBe("weapongear-dagger/");
    });
});

describe("end to end, the two quantities are written to the same page", () => {
    it("states a root-relative address and links at a based one", () => {
        const result = buildSite({ config: configFor() });
        expect(result.gates.addressErrors).toEqual([]);
        expect(result.wikiErrors).toEqual([]);
        const dagger = page("out", "weapongear-dagger");
        expect(dagger).toMatch(/^url: \/weapongear-dagger\/$/m);
        // Nothing on the page states the doubled address that #217 published.
        expect(dagger).not.toContain("/demo/weapongear-dagger/");
        // The citing page's resolved wikilink is site-absolute.
        expect(page("out", "doc-combat")).toContain("](/demo/weapongear-dagger/)");
    });

    it("applies an explicitly configured `site.base` to hrefs, not to the address", () => {
        // A consumer that *is* mounted somewhere other than
        // `/<contentPackage>/` still says so, and it still reaches every href.
        const result = buildSite({ config: configFor({ out: "out-based", base: "/served/" }) });
        expect(result.wikiErrors).toEqual([]);
        expect(page("out-based", "weapongear-dagger")).toMatch(/^url: \/weapongear-dagger\/$/m);
        expect(page("out-based", "doc-combat")).toContain("](/served/weapongear-dagger/)");
    });

    it('publishes the same address under the consumers\' `site.base: "/"` stopgap', () => {
        // Both publishing consumers took `site.base: "/"` to buy the correct
        // addresses (#1812, #130). With the split in place that setting must
        // not double-correct into a *third* answer: the address is the same
        // one, and only the hrefs are short — the state those PRs already ship.
        const result = buildSite({ config: configFor({ out: "out-stopgap", base: "/" }) });
        expect(result.wikiErrors).toEqual([]);
        expect(page("out-stopgap", "weapongear-dagger")).toMatch(/^url: \/weapongear-dagger\/$/m);
        expect(page("out-stopgap", "doc-combat")).toContain("](/weapongear-dagger/)");
    });

    it("states the homepage's address at the package's site root", () => {
        buildSite({ config: configFor({ out: "out-home" }) });
        const home = fs.readFileSync(path.join(root, "out-home/homepage-root.md"), "utf8");
        expect(home).toMatch(/^url: \/homepage-root\/$/m);
    });

    it("leaves a `trees` page and a section landing addressed by their paths", () => {
        buildSite({ config: configFor({ out: "out-trees" }) });
        // Neither states a `url:` at all: a tree page keeps its source layout
        // below its section and a landing is its directory's `_index.md`, so
        // both take their address from where they are written.
        const tree = fs.readFileSync(
            path.join(root, "out-trees/kb/dev-docs/how-to/testing.md"),
            "utf8",
        );
        expect(tree).not.toMatch(/^url:/m);
        const landing = fs.readFileSync(path.join(root, "out-trees/kb/rules/_index.md"), "utf8");
        expect(landing).not.toMatch(/^url:/m);
    });
});
