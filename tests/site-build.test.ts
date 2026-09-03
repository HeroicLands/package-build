/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Publishing a content tree as a website (#63).
 *
 * The two consumer scripts this replaces had **no test between them**: every
 * integrity check was an inline `process.exit`, which cannot be driven from a
 * test at all. So the cases here are weighted towards the gates — each one is
 * made to fire, and each is asserted to *report* rather than to kill the
 * process.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "../index.mjs";
import {
    buildSite,
    collectContentPages,
    collectTreePages,
    gatesFailed,
    pageDestination,
    pageFrontmatter,
    pluralTitle,
    resolveOutputRoot,
    resolveSitePass,
    siteGates,
    walkSiteTree,
    writeSectionLandings,
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
    fs.mkdirSync(path.join(root, "assets/manifests"), { recursive: true });

    // Every package publishes exactly one homepage (#52), so a sandbox that
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

    write("docs/README.md", `---\nsubType: dev-docs\n---\n\n# Developer Documentation\n\nIntro.\n`);
    write(
        "docs/how-to/testing.md",
        `---\nsubType: dev-docs\n---\n\n# Testing\n\nSee [architecture](../concepts/arch.md) and [the source](../../src/x.ts).\n`,
    );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function configFor(site: Record<string, unknown> = {}) {
    return defineConfig({
        rootDir: root,
        contentPackage: "demo",
        foundryPackage: "demo",
        packageKind: "modules",
        stats: {
            lastModifiedBy: "demobuilder0000",
        },
        packs: [
            { name: "items", type: "Item" },
            { name: "journals", type: "JournalEntry" },
        ],
        publish: {
            site: "content",
            manifests: { publish: true, consume: true },
            address: { prefix: "kb/" },
        },
        site: { out: "out", ...site },
    });
}

const ctx = {
    packages: new Set(["demo"]),
    // The package every note in the tree belongs to. Read from the
    // configuration, never from a note (#56).
    contentPackage: "demo",
    skipDirectories: [],
    // Where the package is served, and where its content tree mounts inside
    // it. A page is addressed by the first; a section landing by the second.
    base: "/demo/",
    mount: "/demo/kb/",
    scheme: { prefix: "kb/", landing: "readme" },
};

describe("the walk is ordered, because the index depends on it", () => {
    it("is depth-first in directory order, not reversed", () => {
        const files = walkSiteTree(path.join(root, "assets/content")).map((f) =>
            path.relative(path.join(root, "assets/content"), f),
        );
        // `walkMarkdownTree` yields this tree reversed, and a bare `[[Name]]`
        // resolves first-writer-wins — so reversing the walk silently changes
        // which page an ambiguous name resolves to.
        expect(files[0]).toBe(path.join("Gear", "Dagger.md"));
        expect(files).toEqual([...files].sort());
    });

    it("skips the directories the configuration names", () => {
        write("assets/content/Templates/T.md", "---\ntype: doc\n---\n");
        const all = walkSiteTree(path.join(root, "assets/content"));
        const kept = walkSiteTree(path.join(root, "assets/content"), ["Templates"]);
        expect(all.length - kept.length).toBe(1);
        fs.rmSync(path.join(root, "assets/content/Templates"), {
            recursive: true,
        });
    });
});

describe("a page's address comes from the shared scheme", () => {
    it("publishes a page at its address, and a landing at its section", () => {
        const { pages } = collectContentPages(path.join(root, "assets/content"), ctx);
        const byName = Object.fromEntries(pages.map((p) => [p.name, p.url]));
        // `(type, shortcode)`, at the package root: an address is a
        // package-wide identity and takes no content mount (#181).
        expect(byName.Dagger).toBe("/demo/weapongear-dagger/");
        expect(byName.Combat).toBe("/demo/doc-combat/");
        // A README addresses the section it *is*, which does sit under the
        // mount — so the section landings and their layouts are untouched.
        expect(byName["The Rules"]).toBe("/demo/kb/rules/");
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
        // the configuration's (#56).
        const { pages } = collectContentPages(path.join(root, "assets/content"), ctx);
        const content = pages.filter((p) => p.kind === "content");
        expect(content.map((p) => p.name)).toContain("Dagger");
        expect(content.every((p) => p.pkg === "demo")).toBe(true);
    });

    it("preserves an extra tree's source layout below its section", () => {
        const tree = {
            from: path.join(root, "docs"),
            rel: "docs",
            section: "dev-docs",
            route: "/demo/kb/dev-docs/",
        };
        const { pages } = collectTreePages(tree, ctx);
        const byName = Object.fromEntries(pages.map((p) => [p.name, p.url]));
        expect(byName.Testing).toBe("/demo/kb/dev-docs/how-to/testing/");
        expect(byName["Developer Documentation"]).toBe("/demo/kb/dev-docs/");
    });

    it("takes a tree page's name from its H1, and strips it from the body", () => {
        const tree = {
            from: path.join(root, "docs"),
            rel: "docs",
            section: "dev-docs",
            route: "/demo/kb/dev-docs/",
        };
        const page = collectTreePages(tree, ctx).pages.find((p) => p.name === "Testing")!;
        // The title renders the heading, so leaving it in the body would show
        // it twice.
        expect(page.body).not.toMatch(/^#\s+Testing/m);
    });
});

describe("every gate reports; none exits", () => {
    const base = () => collectContentPages(path.join(root, "assets/content"), ctx);

    it("passes a clean tree, and yields an index", () => {
        const gates = siteGates(base().pages, base(), {
            manifestDir: path.join(root, "assets/manifests"),
        });
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

    it("catches a note with no section to be filed under", () => {
        // The URL no longer names the section, but Hugo still reads a page's
        // section from its directory — so a note with none has nowhere to go.
        note(
            "Rules/Homeless.md",
            `type: doc
shortcode: homeless
name:
    full: Homeless`,
        );
        const got = collectContentPages(path.join(root, "assets/content"), ctx);
        expect(got.addressFindings.length).toBe(1);
        expect(got.addressFindings[0].reason).toMatch(/no section/);
        fs.rmSync(path.join(root, "assets/content/Rules/Homeless.md"));
    });

    it("has no collision gate, because two addresses cannot collide", () => {
        // Two notes of one type sharing a *name* used to claim one URL and had
        // to be caught; `(type, shortcode)` is unique within a package by rule,
        // so the URL is unique by construction and the gate is gone (#181).
        note(
            "Gear/Dagger2.md",
            `type: weapongear
shortcode: dagger2
name:
    full: Dagger`,
        );
        const got = base();
        const gates = siteGates(got.pages, got, {
            manifestDir: path.join(root, "assets/manifests"),
        });
        expect("collisions" in gates).toBe(false);
        expect(gatesFailed(gates)).toBe(false);
        const urls = got.pages.filter((p) => p.kind === "content").map((p) => p.url);
        expect(new Set(urls).size).toBe(urls.length);
        fs.rmSync(path.join(root, "assets/content/Gear/Dagger2.md"));
    });

    it("catches an unusable vendored manifest", () => {
        const dir = path.join(root, "bad-manifests");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "elsewhere.json"), "{ not json");
        const got = base();
        const gates = siteGates(got.pages, got, { manifestDir: dir });
        expect(gates.staleManifests.length).toBe(1);
        expect(gatesFailed(gates)).toBe(true);
        fs.rmSync(dir, { recursive: true });
    });
});

describe("what a page publishes with", () => {
    const page = {
        kind: "content",
        fm: { type: "weapongear", aliases: ["a", "b"], custom: 1 },
        pkg: "demo",
        name: "Dagger",
        slug: "weapongear-dagger",
        url: "/demo/weapongear-dagger/",
        sec: "weapongear",
        folder: "Gear",
        isReadme: false,
    };

    it("carries the package the build derived", () => {
        // #65: no note declares `package:` — it is retired (#56) — so a page
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

    it("drops an authored `aliases`", () => {
        // The field is retired and refused at compile (#180), so this is a
        // guard rather than a live path: Hugo reads `aliases` as URL redirects,
        // so passing one through would publish a redirect stub at each name.
        const data = pageFrontmatter(page as never, {});
        expect(data.aliases).toBeUndefined();
        expect(data.custom).toBe(1);
    });

    it("supplies the title Hugo needs, from the note's name", () => {
        expect(pageFrontmatter(page as never, {}).title).toBe("Dagger");
    });

    it("titles a section landing from its configured metadata", () => {
        const data = pageFrontmatter({ ...page, isReadme: true, sec: "rules" } as never, {
            readmeSections: { rules: { title: "Rules", banner: "r.webp" } },
        });
        expect(data.title).toBe("Rules");
        expect(data.banner).toBe("r.webp");
    });

    it("omits a banner rather than writing `undefined`", () => {
        // `banner: undefined` is not a value YAML can carry.
        const data = pageFrontmatter({ ...page, isReadme: true, sec: "credits" } as never, {
            readmeSections: { credits: { title: "Credits" } },
        });
        expect("banner" in data).toBe(false);
    });

    it("routes a README to `_index.md` and a page to its address", () => {
        expect(pageDestination(page as never)).toBe(
            path.join("weapongear", "weapongear-dagger.md"),
        );
        expect(pageDestination({ ...page, isReadme: true } as never)).toBe(
            path.join("weapongear", "_index.md"),
        );
    });

    it("keeps writing into the section directory, whatever the URL says", () => {
        // Hugo derives a page's section from its path, not from its URL — the
        // section landings, `.CurrentSection` and per-section layout lookup all
        // depend on it — so the file stays in `<sec>/` and the page states its
        // address instead (#181).
        expect(path.dirname(pageDestination(page as never))).toBe("weapongear");
        expect(pageFrontmatter(page as never, {}).url).toBe("/demo/weapongear-dagger/");
    });
});

describe("section landings", () => {
    it("writes a titled landing for each declared section", () => {
        const out = fs.mkdtempSync(path.join(os.tmpdir(), "cb-land-"));
        writeSectionLandings(out, {
            sections: { being: { title: "Beings", banner: "b.webp" } },
            landing: { title: "Knowledgebase", type: "knowledgebase" },
        });
        expect(fs.readFileSync(path.join(out, "being/_index.md"), "utf8")).toContain(
            "title: Beings",
        );
        expect(fs.readFileSync(path.join(out, "_index.md"), "utf8")).toContain(
            "type: knowledgebase",
        );
        fs.rmSync(out, { recursive: true });
    });

    it("backfills a section that no note and no configuration supplies", () => {
        // Hugo generates a section page automatically only for a *top-level*
        // content directory. Mounted a level down, a directory without an
        // `_index.md` is not a section at all: its URL 404s while every page
        // inside it publishes normally.
        const out = fs.mkdtempSync(path.join(os.tmpdir(), "cb-land-"));
        fs.mkdirSync(path.join(out, "macro"), { recursive: true });
        writeSectionLandings(out, { sectionTitle: pluralTitle });
        expect(fs.readFileSync(path.join(out, "macro/_index.md"), "utf8")).toContain(
            "title: Macros",
        );
        fs.rmSync(out, { recursive: true });
    });

    it("pluralises in English, not Hugo's inflector", () => {
        expect(pluralTitle("macro")).toBe("Macros"); // not "Macroes"
        expect(pluralTitle("class")).toBe("Classes");
        expect(pluralTitle("ability")).toBe("Abilities");
        expect(pluralTitle("dev-docs")).toBe("Dev Docses");
    });
});

describe("the output root is refused unless it is safe to delete", () => {
    // Not hypothetical: an unset `site.out` resolved to the repository root and
    // the wipe deleted the working tree, on a configuration that simply had no
    // `site` section yet. Both failing shapes are ordinary, so neither is left
    // to care.
    it("refuses an unset output, which resolves to the repository root", () => {
        expect(() => resolveOutputRoot("/repo", "")).toThrow(/not set/);
        expect(() => resolveOutputRoot("/repo", undefined as never)).toThrow(/not set/);
    });

    it("refuses the repository root itself", () => {
        expect(() => resolveOutputRoot("/repo", ".")).toThrow(/not inside/);
    });

    it("refuses a path that climbs out of the repository", () => {
        expect(() => resolveOutputRoot("/repo", "../elsewhere")).toThrow(/not inside/);
        expect(() => resolveOutputRoot("/repo", "/tmp/x")).toThrow(/not inside/);
    });

    it("accepts an ordinary build directory", () => {
        expect(resolveOutputRoot("/repo", "kb/content")).toBe(path.join("/repo", "kb/content"));
    });

    it("stops the whole build rather than wiping anything", () => {
        const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "cb-safe-"));
        fs.writeFileSync(path.join(sandbox, "precious.txt"), "keep me");
        fs.writeFileSync(
            path.join(sandbox, "package.json"),
            JSON.stringify({ name: "s", version: "1.0.0" }),
        );
        const config = defineConfig({
            rootDir: sandbox,
            contentPackage: "demo",
            foundryPackage: "demo",
            packageKind: "modules",
            stats: {
                lastModifiedBy: "demobuilder0000",
            },
            packs: [{ name: "items", type: "Item" }],
            publish: { site: "content" },
        });
        expect(() => buildSite({ config })).toThrow(/not set/);
        expect(fs.existsSync(path.join(sandbox, "precious.txt"))).toBe(true);
        fs.rmSync(sandbox, { recursive: true, force: true });
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
    it("writes the tree, its landings, and reports its counts", () => {
        const result = buildSite({ config: configFor() });
        expect(gatesFailed(result.gates)).toBe(false);
        expect(result.stats).not.toBeNull();
        const out = path.join(root, "out/kb");
        expect(fs.existsSync(path.join(out, "weapongear/weapongear-dagger.md"))).toBe(true);
        expect(fs.existsSync(path.join(out, "rules/_index.md"))).toBe(true);
        expect(result.wikiErrors).toEqual([]);
    });

    it("resolves a wikilink to the page's published address", () => {
        buildSite({ config: configFor() });
        const page = fs.readFileSync(
            path.join(root, "out/kb/weapongear/weapongear-dagger.md"),
            "utf8",
        );
        // Both the resolved wikilink and the page's own stated address.
        expect(page).toContain("/demo/weapongear-dagger/");
        expect(page).toMatch(/^url: \/demo\/weapongear-dagger\/$/m);
    });

    it("writes the derived package into a swept note's page", () => {
        // #65: end to end, because the defect is that the value the collect
        // pass already resolved never reaches the file on disk.
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
            const page = fs.readFileSync(
                path.join(root, "out/kb/weapongear/weapongear-sling.md"),
                "utf8",
            );
            expect(page).toMatch(/^package: demo$/m);
        } finally {
            fs.rmSync(path.join(root, "assets/content/Gear/Sling.md"));
        }
    });

    it("stops before writing when a gate fires", () => {
        note(
            "Gear/Dagger3.md",
            `type: weapongear
shortcode: dagger3
name:
    full: Dagger
summary: "see [[weapongear-dagger]]"`,
        );
        const out = path.join(root, "out");
        fs.rmSync(out, { recursive: true, force: true });
        const result = buildSite({ config: configFor() });
        expect(gatesFailed(result.gates)).toBe(true);
        expect(result.stats).toBeNull();
        expect(fs.existsSync(path.join(out, "kb"))).toBe(false);
        fs.rmSync(path.join(root, "assets/content/Gear/Dagger3.md"));
    });
});
