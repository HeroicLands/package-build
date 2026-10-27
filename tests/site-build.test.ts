/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Publishing a content tree as a website.
 *
 * The two consumer scripts this replaces had **no test between them**: every
 * integrity check was an inline `process.exit`, which cannot be driven from a
 * test at all. So the cases here are weighted towards the gates — each one is
 * made to fire, and each is asserted to *report* rather than to kill the
 * process.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { readMatter } from "../engine/note-matter.mjs";
import { builtPages } from "./helpers/built-pages";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "../index.mjs";
import {
    buildSite,
    collectContentPages,
    gatesFailed,
    pageFrontmatter,
    resolveSitePass,
    siteGates,
} from "../engine/site-build.mjs";

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
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-site-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sandbox", version: "1.0.0" }),
    );
    fs.mkdirSync(path.join(root, "build/cache/metadata"), { recursive: true });

    // Every package publishes exactly one homepage, so a sandbox that
    // builds a site has to carry one.
    note("homepage.md", "type: homepage\nshortcode: root", "The module, in its own words.\n");
    note(
        "Gear/Dagger.md",
        `type: weapongear
shortcode: dagger
id: aaaaaaaaaaaaaaaa
name:
    full: Dagger`,
        "A blade. See [[weapongear-dagger|itself]].\n",
    );
    note(
        "Rules/Combat.md",
        `type: doc
subType: rules
shortcode: combat
name:
    full: Combat`,
    );
    note(
        "Rules/README.md",
        `type: doc
subType: rules
shortcode: rulesidx
name:
    full: The Rules`,
    );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function configFor(site: Record<string, unknown> = {}) {
    return defineConfig({
        rootDir: root,
        contentPackage: "demo",
        foundryPackage: "demo",
        packageKind: "modules",
        compatibility: { minimum: "14.359" },
        stats: {
            lastModifiedBy: "demobuilder0000",
        },
        packs: [
            { name: "items", type: "Item" },
            { name: "journals", type: "JournalEntry" },
        ],
        publish: { address: { prefix: "kb/" } },
        site: { ...site },
    });
}

const ctx = {
    packages: new Set(["demo"]),
    // The package every note in the tree belongs to. Read from the
    // configuration, never from a note.
    contentPackage: "demo",
    skipDirectories: [],
    // Where the package is served, and where its content tree mounts inside
    // it. A page is addressed by neither: its address is package-wide.
    base: "/demo/",
    mount: "/demo/kb/",
    scheme: { prefix: "kb/" },
};

describe("a page's address comes from the shared scheme", () => {
    it("publishes every page at its address, whatever the file is called", () => {
        const { pages } = collectContentPages(path.join(root, "assets/content"), ctx);
        const byName = Object.fromEntries(pages.map((p) => [p.name, p.url]));
        // `(type, shortcode)`, at the package root: an address is a
        // package-wide identity and takes no content mount.
        expect(byName.Dagger).toBe("/demo/weapongear-dagger/");
        expect(byName.Combat).toBe("/demo/doc-combat/");
        // A `README.md` used to address the section it sat in. There is no
        // section, so it is an ordinary page.
        expect(byName["The Rules"]).toBe("/demo/doc-rulesidx/");
    });

    it("takes nothing from a name, so a rename moves no URL", () => {
        const file = path.join(root, "assets/content/Gear/Dagger.md");
        const original = fs.readFileSync(file, "utf8");
        const url = () => {
            const { pages } = collectContentPages(path.join(root, "assets/content"), ctx);
            return pages.find((p) => p.fm.shortcode === "dagger")!.url;
        };
        const before = url();
        try {
            fs.writeFileSync(file, original.replace("full: Dagger", "full: Poignard"));
            expect(url()).toBe(before);
        } finally {
            fs.writeFileSync(file, original);
        }
    });

    it("publishes every note in the tree, under the configured package", () => {
        // Nothing is selected by frontmatter any more: the tree holds one
        // package's notes and `package:` is retired, so a page's package is
        // the configuration's.
        const { pages } = collectContentPages(path.join(root, "assets/content"), ctx);
        const content = pages.filter((p) => p.kind === "content");
        expect(content.map((p) => p.name)).toContain("Dagger");
        expect(content.every((p) => p.pkg === "demo")).toBe(true);
    });
});

describe("every gate reports; none exits", () => {
    const base = () => collectContentPages(path.join(root, "assets/content"), ctx);

    /**
     * A configuration pointing at a metadata cache, declaring the dependencies
     * it is expected to hold. Both halves matter: a build resolves only through
     * packages it declared it depends on, and a declared dependency with no
     * cached index is a hard error naming `deps fetch`.
     */
    const cacheConfig = (cache = path.join(root, "build/cache/metadata"), ids: string[] = []) => ({
        paths: { metadataCache: cache },
        relationships: {
            requires: ids.map((id) => ({ id, manifest: "https://x/y.json" })),
        },
    });

    it("passes a clean tree, and yields an index", () => {
        const gates = siteGates(base().pages, base(), { config: cacheConfig() });
        expect(gatesFailed(gates)).toBe(false);
        expect(gates.index).not.toBeNull();
    });

    it("catches a wikilink authored in frontmatter", () => {
        note(
            "Gear/Linky.md",
            `type: weapongear
shortcode: linky
name:
    full: Linky
summary: "see [[weapongear-dagger]]"`,
        );
        const got = collectContentPages(path.join(root, "assets/content"), ctx);
        expect(got.fmLinkFindings.length).toBe(1);
        // Frontmatter is copied to the page verbatim, so the link would reach
        // the reader as literal brackets.
        expect(got.fmLinkFindings[0].link).toContain("weapongear-dagger");
        fs.rmSync(path.join(root, "assets/content/Gear/Linky.md"));
    });

    it("catches a note with no shortcode to be addressed by", () => {
        note(
            "Gear/Blank.md",
            `type: weapongear
name:
    full: Blank`,
        );
        const got = collectContentPages(path.join(root, "assets/content"), ctx);
        expect(got.addressFindings.length).toBe(1);
        expect(got.addressFindings[0].reason).toMatch(/no shortcode/);
        fs.rmSync(path.join(root, "assets/content/Gear/Blank.md"));
    });

    it("has no section gate, because a page is filed nowhere", () => {
        // A `doc` with no subtype must not be refused for having no section, since
        // the section was the directory the file went into. Pages emit flat,
        // so there is nothing left for it to lack.
        note(
            "Rules/Homeless.md",
            `type: doc
shortcode: homeless
name:
    full: Homeless`,
        );
        const got = collectContentPages(path.join(root, "assets/content"), ctx);
        expect(got.addressFindings).toEqual([]);
        expect(got.pages.map((p) => p.url)).toContain("/demo/doc-homeless/");
        fs.rmSync(path.join(root, "assets/content/Rules/Homeless.md"));
    });

    it("has no collision gate, because two addresses cannot collide", () => {
        // Two notes of one type sharing a *name* used to claim one URL and had
        // to be caught; `(type, shortcode)` is unique within a package by rule,
        // so the URL is unique by construction and the gate is gone.
        note(
            "Gear/Dagger2.md",
            `type: weapongear
shortcode: dagger2
name:
    full: Dagger`,
        );
        const got = base();
        const gates = siteGates(got.pages, got, { config: cacheConfig() });
        expect("collisions" in gates).toBe(false);
        expect(gatesFailed(gates)).toBe(false);
        const urls = got.pages.filter((p) => p.kind === "content").map((p) => p.url);
        expect(new Set(urls).size).toBe(urls.length);
        fs.rmSync(path.join(root, "assets/content/Gear/Dagger2.md"));
    });

    it("catches an unusable fetched index", () => {
        const cache = path.join(root, "bad-cache");
        const dir = path.join(cache, "elsewhere@0.1.0");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "elsewhere-metadata.jsonl"), "{ not json\n");
        fs.writeFileSync(path.join(dir, ".complete"), "");
        const got = base();
        const gates = siteGates(got.pages, got, { config: cacheConfig(cache, ["elsewhere"]) });
        expect(gates.staleManifests.length).toBe(1);
        expect(gatesFailed(gates)).toBe(true);
        fs.rmSync(cache, { recursive: true });
    });
});

describe("what a page publishes with", () => {
    const page = {
        kind: "content",
        fm: { type: "weapongear", custom: 1 },
        pkg: "demo",
        name: "Dagger",
        slug: "weapongear-dagger",
        url: "/demo/weapongear-dagger/",
        sec: "weapongear",
        folder: "Gear",
        isReadme: false,
    };

    it("carries the package the build derived", () => {
        // No note declares `package:` — it is retired — so a page
        // that published only what the note carried would no longer be
        // self-describing. The theme's breadcrumb partial reads
        // `.Params.package` to build the middle crumb, which degrades from a
        // linked section label to a bare type slug without it.
        expect(pageFrontmatter(page as never, {}).package).toBe("demo");
    });

    it("overwrites a stale authored value with the derived one", () => {
        // The compile refuses a note declaring the field, so this is defence
        // rather than a live path: whatever a note says, the page publishes
        // the package the build derived.
        const stale = { ...page, fm: { ...page.fm, package: "elsewhere" } };
        expect(pageFrontmatter(stale as never, {}).package).toBe("demo");
    });

    it("supplies the title, from the note's name", () => {
        expect(pageFrontmatter(page as never, {}).title).toBe("Dagger");
    });

    it("states a content page's whole address, relative to the package root", () => {
        // See `tests/page-url-root-relative.test.ts`.
        expect(pageFrontmatter(page as never, {}).url).toBe("/weapongear-dagger/");
    });
});

describe("the consumer's own passes are named, not imported", () => {
    it("resolves a known bundle", () => {
        const pass = resolveSitePass("sohlKb", { repoRoot: root });
        expect(typeof pass.beforeLinks).toBe("function");
    });

    it("names what it accepts when a configuration asks for something else", () => {
        expect(() => resolveSitePass("nope", { repoRoot: root })).toThrow(/unknown site pass/);
    });

    it("is absent by default, so a package needs no pass at all", () => {
        expect(resolveSitePass("", {})).toEqual({});
    });
});

describe("buildSite end to end", () => {
    it("does not publish a GM-tagged note", () => {
        const file = note(
            "Rules/Secret.md",
            "type: doc\nsubType: concept\nshortcode: secret\nname: { full: Secret }\ntags: [gm]",
            "GM material.\n",
        );
        try {
            const result = buildSite({ config: configFor() });
            expect(gatesFailed(result.gates)).toBe(false);
            expect(builtPages(result)).not.toHaveProperty(["doc-secret.md"]);
        } finally {
            fs.rmSync(file);
        }
    });

    it("publishes a being without injecting system frontmatter", () => {
        const file = note(
            "Beings/Njorven.md",
            "shortcode: njorven\nname: { full: Njörven }\ntype: being",
        );
        try {
            const result = buildSite({ config: configFor() });
            expect(gatesFailed(result.gates)).toBe(false);
            const published = readMatter(builtPages(result)["being-njorven.md"]);
            expect(Object.hasOwn(published.data, "sohl")).toBe(false);
            expect(published.data.infoboxes).toEqual(expect.any(Array));
        } finally {
            fs.rmSync(file);
        }
    });

    it("expands Markdown expressions from frontmatter and prepared SQL", () => {
        const file = note(
            "Rules/Expressions.md",
            "type: doc\nsubType: rules\nshortcode: expressions\nname:\n    full: Expressions",
            '{{name.full}} counts {{sql "SELECT 7 AS n"}} things.\n',
        );
        const prepared = new Map() as any;
        prepared.inline = new Map([[file, new Map([["SELECT 7 AS n", { value: 7 }]])]]);
        try {
            const result = buildSite({ config: configFor(), sqlTables: prepared });
            expect(result.expressionErrors).toEqual([]);
            const page = builtPages(result)["doc-expressions.md"];
            expect(page).toContain("Expressions counts 7 things.");
        } finally {
            fs.rmSync(file);
        }
    });

    it("resolves a cross-note {{ref}}, as a link to the target's own page and number", () => {
        const targetFile = note(
            "Rules/Target.md",
            "type: doc\nsubType: rules\nshortcode: target\nname:\n    full: Target",
            [":@ The great beast. {#thorn}", "", "```text", "alpha", "```"].join("\n") + "\n",
        );
        const citingFile = note(
            "Rules/Citing.md",
            "type: doc\nsubType: rules\nshortcode: citing\nname:\n    full: Citing",
            'See {{ref "doc-target#thorn"}}, in full as {{ref "doc-target#thorn" form="full"}}.\n',
        );
        try {
            const result = buildSite({ config: configFor() });
            expect(result.expressionErrors).toEqual([]);
            const page = builtPages(result)["doc-citing.md"];
            expect(page).toContain("[Code 1](/demo/doc-target/#thorn)");
            expect(page).toContain("[Code 1: The great beast.](/demo/doc-target/#thorn)");
        } finally {
            fs.rmSync(targetFile);
            fs.rmSync(citingFile);
        }
    });

    it("refuses a {{ref}} naming a note that does not exist", () => {
        const file = note(
            "Rules/NoSuchTarget.md",
            "type: doc\nsubType: rules\nshortcode: nosuchtarget\nname:\n    full: No Such Target",
            'See {{ref "doc-nowhere#thorn"}}.\n',
        );
        try {
            const result = buildSite({ config: configFor() });
            expect(result.expressionErrors).toEqual([
                expect.objectContaining({
                    message: expect.stringContaining("names no note this build resolves"),
                }),
            ]);
        } finally {
            fs.rmSync(file);
        }
    });

    it("publishes secret passages as expandable prose and locates malformed fences", () => {
        const file = note(
            "Rules/Secrets.md",
            "type: doc\nsubType: settingguide\nshortcode: secrets\nname:\n    full: Secrets",
            "Before.\n\n:::secret\nA **hidden** clue.\n:::\n",
        );
        try {
            const result = buildSite({ config: configFor() });
            const page = builtPages(result)["doc-secrets.md"];
            expect(result.secretErrors).toEqual([]);
            expect(page).toContain('<details class="secret" data-pagefind-ignore>');
            expect(page).toContain('<summary class="secret">Secret</summary>');
            // Left as Markdown for the renderer, not pre-rendered here — see
            // `engine/content-blocks.mjs`.
            expect(page).toContain("A **hidden** clue.");

            fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("\n:::\n", "\n"));
            const malformed = buildSite({ config: configFor() });
            expect(malformed.secretErrors).toEqual([
                expect.objectContaining({ file, line: 11, column: 1 }),
            ]);
        } finally {
            fs.rmSync(file, { force: true });
        }
    });

    it("refuses an inline image embed the lint already refuses", () => {
        // `lintContentImages` reports this exact shape — an image sharing its
        // paragraph with prose — so a site build run on its own must refuse
        // it too, rather than publishing the directive as though it were
        // absent.
        const file = note(
            "Rules/InlineImage.md",
            "type: doc\nsubType: rules\nshortcode: inlineimage\nname:\n    full: Inline Image",
            "A ranger. ![A ranger](ranger.webp) stands watch.\n",
        );
        try {
            const result = buildSite({ config: configFor() });
            expect(result.embedErrors).toEqual([
                expect.objectContaining({
                    file,
                    severity: "error",
                    message: expect.stringContaining("shares its paragraph with other text"),
                }),
            ]);
        } finally {
            fs.rmSync(file, { force: true });
        }
    });

    it("still publishes a picture that stands alone after a leading caption", () => {
        const file = note(
            "Rules/FencedImage.md",
            "type: doc\nsubType: rules\nshortcode: fencedimage\nname:\n    full: Fenced Image",
            [":@ A ranger.", "", "![A ranger](ranger.webp)", ""].join("\n"),
        );
        try {
            const result = buildSite({ config: configFor() });
            expect(result.embedErrors).toEqual([]);
            expect(builtPages(result)).toHaveProperty(["doc-fencedimage.md"]);
        } finally {
            fs.rmSync(file, { force: true });
        }
    });

    it("collects the pages and reports its counts", () => {
        const result = buildSite({ config: configFor() });
        expect(gatesFailed(result.gates)).toBe(false);
        expect(result.stats).not.toBeNull();
        const files = Object.keys(builtPages(result));
        expect(files).toContain("weapongear-dagger.md");
        // A page is named by its address, and no page is filed under a section.
        expect(files.every((name) => !name.includes("/"))).toBe(true);
        expect(result.wikiErrors).toEqual([]);
    });

    it("resolves a wikilink to the page's published address", () => {
        const page = builtPages(buildSite({ config: configFor() }))["weapongear-dagger.md"];
        // Both the resolved wikilink and the page's own stated address — two
        // quantities, and only the link carries the package base.
        expect(page).toContain("](/demo/weapongear-dagger/)");
        expect(page).toMatch(/^url: \/weapongear-dagger\/$/m);
    });

    it("sets the derived package on a swept note's page", () => {
        // End to end, because the value the collect pass resolved has to
        // reach the finished page.
        note(
            "Gear/Sling.md",
            `type: weapongear
shortcode: sling
name:
    full: Sling`,
        );
        try {
            const result = buildSite({ config: configFor() });
            expect(gatesFailed(result.gates)).toBe(false);
            const page = builtPages(result)["weapongear-sling.md"];
            expect(page).toMatch(/^package: demo$/m);
        } finally {
            fs.rmSync(path.join(root, "assets/content/Gear/Sling.md"));
        }
    });

    it("stops before rendering when a gate fires", () => {
        note(
            "Gear/Dagger3.md",
            `type: weapongear
shortcode: dagger3
name:
    full: Dagger
summary: "see [[weapongear-dagger]]"`,
        );
        const result = buildSite({ config: configFor() });
        expect(gatesFailed(result.gates)).toBe(true);
        expect(result.stats).toBeNull();
        expect(result.site).toBeUndefined();
        fs.rmSync(path.join(root, "assets/content/Gear/Dagger3.md"));
    });
});

describe("text set in one of the faces", () => {
    it("is kept out of site search", () => {
        const site = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cb-site-faces-")));
        try {
            fs.writeFileSync(
                path.join(site, "package.json"),
                JSON.stringify({ name: "sandbox", version: "1.0.0" }),
            );
            fs.mkdirSync(path.join(site, "build/cache/metadata"), { recursive: true });
            fs.cpSync(
                path.join(import.meta.dirname, "fixtures", "script-fonts", "fonts"),
                path.join(site, "node_modules", "@heroiclands", "fonts"),
                { recursive: true },
            );
            const content = path.join(site, "assets/content");
            fs.mkdirSync(path.join(content, "Rules"), { recursive: true });
            fs.writeFileSync(
                path.join(content, "homepage.md"),
                "---\ntype: homepage\nshortcode: root\n---\n\nThe module.\n",
            );
            fs.writeFileSync(
                path.join(content, "Rules", "Carved.md"),
                "---\ntype: doc\nsubType: rules\nshortcode: carved\nname:\n    full: Carved\n---\n\n" +
                    "Cut as [⟦U+F0239⟧]{lang=und enc=semaron font=semaron-kuriale}.\n",
            );
            fs.writeFileSync(
                path.join(content, "Rules", "Encoding.md"),
                "---\ntype: doc\nsubType: reference\nshortcode: semaron\nname: {full: Test Semaron Encoding}\ndata:\n  language: und\n  font: semaron-kuriale\n  mappings: {k: KALPEZA_MIN}\n  rules: {normalization: NFC, matching: longest-first}\n---\n\nThe selected native writing.\n",
            );
            const result = buildSite({
                config: defineConfig({
                    rootDir: site,
                    contentPackage: "demo",
                    languages: { und: { tag: "und" } },
                    foundryPackage: "demo",
                    packageKind: "modules",
                    compatibility: { minimum: "14.359" },
                    stats: { lastModifiedBy: "demobuilder0000" },
                    packs: [{ name: "journals", type: "JournalEntry" }],
                }),
            });
            const page = builtPages(result)["doc-carved.md"];
            expect(page).toContain("hl-semaron-kuriale");
            expect(page).toContain("data-pagefind-ignore");
        } finally {
            fs.rmSync(site, { recursive: true, force: true });
        }
    });
});
