/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The package homepage: an authored page at `/<contentPackage>/` (#51), and the
 * publishing mode that makes it the floor rather than an extra (#55).
 *
 * The licensing assertion is the reason most of these exist. `sohl-kethira-basic`
 * (Keléstia's Fan Material Guidelines) and `harn-adventures` (HârnFanon under
 * Lythia's terms) publish a homepage and **no other page**, and the failure mode
 * is silent — a `site:` block added later ships licensed content with nobody
 * noticing. So "exactly one page" is asserted against a tree deliberately full
 * of content notes, not left to configuration.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "../index.mjs";
import type { ContentBuildConfigInput } from "../content-config.mjs";
import { SITE_MODES, publishesContentPages } from "../content-config.mjs";
import * as homepageModule from "../engine/homepage.mjs";
import {
    HOMEPAGE_SHORTCODE,
    HOMEPAGE_TYPE,
    homepageDestination,
    homepageTitle,
    isHomepage,
} from "../engine/homepage.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { buildSite, collectContentPages } from "../engine/site-build.mjs";
import { manifestContext, emitLinkManifest } from "../engine/manifest-emit.mjs";

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

/** Every emitted file below a directory, POSIX-separated and sorted. */
function emitted(dir: string): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
        if (!fs.existsSync(d)) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, e.name);
            if (e.isDirectory()) walk(full);
            else out.push(path.relative(dir, full).split(path.sep).join("/"));
        }
    };
    walk(dir);
    return out.sort();
}

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-home-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sandbox", version: "1.0.0" }),
    );
    fs.mkdirSync(path.join(root, "assets/manifests"), { recursive: true });

    note(
        "homepage.md",
        `type: ${HOMEPAGE_TYPE}
shortcode: ${HOMEPAGE_SHORTCODE}
name:
    full: The Demo Module`,
        "The module, in the author's own words.\n",
    );
    note(
        "Gear/Dagger.md",
        `type: weapongear
shortcode: dagger
name:
    full: Dagger`,
    );
    note(
        "Rules/Combat.md",
        `type: doc
subType: rules
shortcode: combat
name:
    full: Combat`,
    );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function configFor(
    overrides: Partial<ContentBuildConfigInput> = {},
): ReturnType<typeof defineConfig> {
    return defineConfig({
        rootDir: root,
        contentPackage: "demo",
        foundryPackage: "demo",
        packageKind: "modules",
        stats: {
            lastModifiedBy: "demobuilder0000",
        },
        packs: [{ name: "items", type: "Item" }],
        packageBuild: { manifest: { title: "The Demo Module" } },
        site: { out: "out" },
        publish: {
            site: "content",
            manifests: { publish: true, consume: true },
            address: { prefix: "kb/" },
        },
        ...overrides,
    } as ContentBuildConfigInput);
}

describe("`type: homepage` is note format, so it lives in the engine (#51)", () => {
    it("is declared by the engine's own schema registry", () => {
        // Not `sohl/note-schemas.mjs`: the `engine/` ÷ `sohl/` line is
        // note-format knowledge vs. game-system knowledge, and a homepage
        // carries no `system` block and mirrors no item builder. A type
        // declared in the SoHL registry would also be unreachable from
        // `HarnMaster-3-FoundryVTT`, which declares no `itemBuilders` at all.
        expect(ENGINE_NOTE_SCHEMAS).toHaveProperty(HOMEPAGE_TYPE);
    });

    it("lints clean against the engine schemas alone, with no item registry", () => {
        const findings = lintNote(
            {
                fm: { type: HOMEPAGE_TYPE, shortcode: HOMEPAGE_SHORTCODE, title: "Kethira Basic" },
                file: "assets/content/homepage.md",
                raw: `---\ntype: homepage\nshortcode: ${HOMEPAGE_SHORTCODE}\n---\n`,
            },
            { schemas: ENGINE_NOTE_SCHEMAS },
        );
        expect(findings).toEqual([]);
    });

    it("recognises a homepage note by its type", () => {
        expect(isHomepage({ type: HOMEPAGE_TYPE })).toBe(true);
        expect(isHomepage({ type: "doc" })).toBe(false);
        expect(isHomepage(undefined)).toBe(false);
    });

    it("defaults its title to the manifest's, and yields to an authored one", () => {
        const config = configFor();
        expect(homepageTitle({ type: HOMEPAGE_TYPE }, config)).toBe("The Demo Module");
        expect(homepageTitle({ type: HOMEPAGE_TYPE, title: "Kethira" }, config)).toBe("Kethira");
    });

    it("is collected by its own walk, not as a content page", () => {
        const { pages } = collectContentPages(path.join(root, "assets/content"), {
            packages: new Set(["demo"]),
            contentPackage: "demo",
            skipDirectories: [],
            base: "/demo/",
            mount: "/demo/kb/",
            scheme: { prefix: "kb/", landing: "readme" },
        });
        expect(pages.map((p) => p.name)).not.toContain("homepage");
        expect(pages.every((p) => p.kind === "content")).toBe(true);
    });

    it("publishes at its own address, like every other note (#182)", () => {
        const config = configFor();
        buildSite({ config });
        // `/demo/homepage-root/` — the note's address — written at the root of
        // the configured `site.out`, one level above the `kb/` content mount.
        // The package's own `/demo/` is a redirect a consumer authors, not a
        // page this build writes.
        expect(fs.existsSync(path.join(root, "out/_index.md"))).toBe(false);
        const dest = path.join(
            root,
            `out/${homepageDestination({ type: HOMEPAGE_TYPE, shortcode: HOMEPAGE_SHORTCODE })}`,
        );
        expect(fs.existsSync(dest)).toBe(true);
        const page = fs.readFileSync(dest, "utf8");
        expect(page).toMatch(/^title: The Demo Module$/m);
        expect(page).toMatch(/^package: demo$/m);
        expect(page).toMatch(/^url: \/demo\/homepage-root\/$/m);
        expect(page).toMatch(/^slug: homepage-root$/m);
        expect(page).toContain("The module, in the author's own words.");
    });

    it("no longer has a fixed destination of its own", () => {
        // `HOMEPAGE_DESTINATION` named `_index.md`, and it was the whole reason
        // a `shortcode` was refused: the computed address named a page nothing
        // wrote. With the address published, there is nothing left for a fixed
        // destination to be.
        expect(homepageModule).not.toHaveProperty("HOMEPAGE_DESTINATION");
        expect(homepageDestination({ type: HOMEPAGE_TYPE, shortcode: "front" })).toBe(
            "homepage-front.md",
        );
    });

    it("resolves `[[homepage-root|Text]]` to the page it publishes", () => {
        // The whole point of giving the landing an address: it is citable like
        // any other note, and the address the citation computes is the one the
        // build writes. Indexed but not rendered — a homepage takes no part in
        // the content pipeline, so this asserts the index holds it.
        note(
            "Rules/Welcome.md",
            `type: doc
subType: rules
shortcode: welcome
name:
    full: Welcome`,
            "Start at [[homepage-root|the module's front page]].\n",
        );
        const config = configFor({ site: { out: "out-links" } });
        const result = buildSite({ config });
        expect(result.wikiErrors).toEqual([]);
        const page = fs.readFileSync(path.join(root, "out-links/kb/rules/doc-welcome.md"), "utf8");
        expect(page).toContain("(/demo/homepage-root/)");
        expect(page).toContain("the module's front page");
    });

    it("compiles into no compendium document, so it is absent from the manifest", () => {
        const config = configFor();
        const outDir = path.join(root, "manifest-out");
        const { entries } = emitLinkManifest({ config, outDir });
        expect(entries).toBeGreaterThan(0);
        const written = JSON.parse(fs.readFileSync(path.join(outDir, "demo.json"), "utf8"));
        const keys = Object.keys(written.entries ?? written);
        expect(keys.some((k) => k.includes(HOMEPAGE_TYPE))).toBe(false);
    });
});

describe("`publish.site` distinguishes homepage-only from content (#55)", () => {
    it("offers exactly two modes, with homepage-only the floor", () => {
        expect(SITE_MODES).toEqual(["homepage", "content"]);
    });

    it("defaults to homepage-only, so no value means no web presence", () => {
        const config = defineConfig({
            rootDir: "/repo",
            contentPackage: "demo",
            foundryPackage: "demo",
            packageKind: "modules",
            stats: {
                lastModifiedBy: "demobuilder0000",
            },
            packs: [{ name: "items", type: "Item" }],
        } as ContentBuildConfigInput);
        expect(config.publish.site).toBe("homepage");
        expect(publishesContentPages(config)).toBe(false);
    });

    it("refuses the retired boolean, naming what to write instead", () => {
        const base = {
            rootDir: "/repo",
            contentPackage: "demo",
            foundryPackage: "demo",
            packageKind: "modules",
            stats: {
                lastModifiedBy: "demobuilder0000",
            },
            packs: [{ name: "items", type: "Item" }],
        };
        // `true` and `false` are both refused rather than mapped: the reading
        // `false` invited — "this package has no web presence" — is the belief
        // the message exists to correct, and a value silently reinterpreted
        // reads to its author as though it still means what it said.
        expect(() =>
            defineConfig({
                ...base,
                publish: { site: true },
            } as unknown as ContentBuildConfigInput),
        ).toThrow(/content/);
        expect(() =>
            defineConfig({
                ...base,
                publish: { site: false },
            } as unknown as ContentBuildConfigInput),
        ).toThrow(/homepage/);
        expect(() =>
            defineConfig({
                ...base,
                publish: { site: "everything" },
            } as unknown as ContentBuildConfigInput),
        ).toThrow(/publish\.site/);
    });

    it("records a web address on manifest entries only in content mode", () => {
        expect(manifestContext(configFor()).web).toBe(true);
        expect(manifestContext(configFor({ publish: { site: "homepage" } })).web).toBe(false);
    });
});

describe("homepage-only publishes exactly one page — the licensing assertion", () => {
    it("emits the homepage and nothing else, from a tree full of content", () => {
        const out = path.join(root, "out-homepage-only");
        const config = configFor({
            site: { out: "out-homepage-only" },
            publish: {
                site: "homepage",
                manifests: { publish: false, consume: true },
                address: { prefix: "kb/" },
            },
        });
        const result = buildSite({ config });

        // Measured, not assumed: the tree holds a weapon and a rules note, and
        // neither may reach the web.
        expect(emitted(out)).toEqual(["homepage-root.md"]);
        expect(result.stats?.homepages).toBe(1);
        expect(result.stats?.content ?? 0).toBe(0);
    });

    it("ignores the content framing entirely, rather than trusting it to be absent", () => {
        // A `site:` block naming sections and extra trees cannot re-open a
        // content surface: homepage-only is a mode, not the absence of
        // configuration.
        write("extra/README.md", "---\nsubType: dev-docs\n---\n\n# Docs\n");
        const out = path.join(root, "out-fenced");
        const config = configFor({
            site: {
                out: "out-fenced",
                sections: { weapongear: { title: "Weapons" } },
                backfillSections: true,
                landing: { title: "Knowledgebase", type: "knowledgebase" },
                trees: [{ from: "extra", section: "dev-docs" }],
            },
            publish: {
                site: "homepage",
                manifests: { publish: false, consume: true },
                address: { prefix: "kb/" },
            },
        });
        buildSite({ config });
        expect(emitted(out)).toEqual(["homepage-root.md"]);
    });

    it("still publishes every content page in content mode", () => {
        const config = configFor({ site: { out: "out-content" } });
        const result = buildSite({ config });
        const files = emitted(path.join(root, "out-content"));
        expect(files).toContain("homepage-root.md");
        // Written into its section directory under the mount; published at
        // its address, `/demo/weapongear-dagger/` (#181).
        expect(files).toContain("kb/weapongear/weapongear-dagger.md");
        expect(result.stats?.homepages).toBe(1);
    });

    it("works in a package that declares no itemBuilders at all", () => {
        // HM3 and every HM3 module: the packaging half of the toolchain only,
        // with a content tree whose single member is the homepage.
        const solo = fs.mkdtempSync(path.join(os.tmpdir(), "cb-hm3-"));
        fs.writeFileSync(
            path.join(solo, "package.json"),
            JSON.stringify({ name: "hm3", version: "1.0.0" }),
        );
        fs.mkdirSync(path.join(solo, "assets/content"), { recursive: true });
        fs.writeFileSync(
            path.join(solo, "assets/content/homepage.md"),
            `---\ntype: ${HOMEPAGE_TYPE}\nshortcode: ${HOMEPAGE_SHORTCODE}\n---\n\nHârnMaster 3 for Foundry VTT.\n`,
        );
        const config = defineConfig({
            rootDir: solo,
            contentPackage: "hm3",
            foundryPackage: "hm3",
            packageKind: "systems",
            stats: {
                lastModifiedBy: "hm3builder000000",
            },
            // HM3 ships committed compendium JSON rather than a compiled tree,
            // so it declares packs and no `itemBuilders` — the shape a type in
            // the SoHL registry would be unreachable from.
            packs: [{ name: "std-skills", type: "Item" }],
            packageBuild: { manifest: { title: "HârnMaster 3" } },
            site: { out: "site" },
        } as ContentBuildConfigInput);

        const result = buildSite({ config });
        expect(emitted(path.join(solo, "site"))).toEqual(["homepage-root.md"]);
        expect(result.stats?.homepages).toBe(1);
        expect(fs.readFileSync(path.join(solo, "site/homepage-root.md"), "utf8")).toMatch(
            /^title: HârnMaster 3$/m,
        );
        fs.rmSync(solo, { recursive: true, force: true });
    });
});
