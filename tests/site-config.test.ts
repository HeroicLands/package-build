/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The generated Hugo configuration.
 *
 * `content-build site` writes the whole Hugo source tree under `build/hugo/`,
 * `hugo.toml` included. Every value in that file is either derived from a
 * source the repository already states, an organisation constant, or the
 * navigation `deps fetch` cached — so the cases here are weighted towards the
 * guards: that nothing the generator writes can also be authored, that a cold
 * cache is refused by name, and that the file Hugo reads holds what the
 * sources say.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";

import { defineConfig, DERIVED_HUGO_KEYS } from "../content-config.mjs";
import { buildSite } from "../engine/site-build.mjs";
import {
    BRAND,
    DEPLOY_ROOT,
    DISABLE_KINDS,
    HUGO_CONTENT,
    HUGO_SOURCE,
    LOCALE,
    NAVIGATION_FILE,
    NAVIGATION_URL,
    THEME,
    THEME_PACKAGE,
    fetchNavigation,
    generateHugoConfig,
    hugoConfig,
    hugoToml,
    menuEntries,
    navigationCacheDir,
    readCachedNavigation,
    resolveThemesDir,
    writeHugoConfig,
} from "../engine/site-config.mjs";

let root: string;

/** The path from `build/hugo/` up to a scope installed in the fixture root. */
const THEMES_DIR = ["..", "..", "node_modules", "@heroiclands"].join("/");

/** The navigation heroiclands-site publishes, in the shape `nav.json` states. */
const NAVIGATION = [
    { name: "Home", url: "https://www.heroiclands.org/" },
    { name: "Song of Heroic Lands", url: "https://www.heroiclands.org/sohl/" },
    { name: "HârnMaster 3", url: "https://www.heroiclands.org/hm3/" },
    { name: "Thalorna", url: "https://www.heroiclands.org/thalorna/" },
    {
        name: "Other Modules",
        url: "https://www.heroiclands.org/projects/modules/",
        children: [
            { name: "HârnMaster Kethira Basic", url: "https://www.heroiclands.org/kethira/" },
            {
                name: "Thalorna Alternative Art",
                url: "https://www.heroiclands.org/thalornaaltart/",
            },
        ],
    },
    { name: "License", url: "https://www.heroiclands.org/license/" },
];

function write(rel: string, text: string) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
}

/** Cache the navigation the way `deps fetch` does: the file, then the stamp. */
function cacheNavigation(config: any, navigation: unknown = NAVIGATION) {
    const dir = navigationCacheDir(config);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, NAVIGATION_FILE), JSON.stringify(navigation));
    fs.writeFileSync(path.join(dir, ".complete"), "");
}

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-hugo-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({
            name: "demo",
            version: "1.0.0",
            description: "A demonstration module.",
            homepage: "https://www.heroiclands.org/demo/",
            author: "Ann Author <ann@example.org>",
        }),
    );
    // The theme, installed where `npm ci` puts it. Only its presence is read.
    write(`node_modules/${THEME_PACKAGE}/theme.toml`, 'name = "Heroic Lands"\n');
    write(
        "assets/content/homepage.md",
        "---\ntype: homepage\nshortcode: root\n---\n\nThe module, in its own words.\n",
    );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** A configuration with every source the generator reads. */
function configFor(overrides: Record<string, unknown> = {}, site: Record<string, unknown> = {}) {
    return defineConfig({
        rootDir: root,
        contentPackage: "demo",
        foundryPackage: "demo",
        packageKind: "modules",
        homepage: "https://www.heroiclands.org/demo/",
        author: { name: "Ann Author" },
        stats: { lastModifiedBy: "demobuilder0000" },
        packs: [{ name: "items", type: "Item" }],
        packageBuild: { manifest: { title: "The Demo Module" } },
        publish: { site: "homepage", address: { prefix: "" } },
        site: {
            assets: "https://cdn.example.org",
            description: "A demonstration module.",
            ...site,
        },
        ...overrides,
    } as any);
}

/** The generated configuration for a fixture, as a plain object. */
function generated(
    site: Record<string, unknown> = {},
    overrides: Record<string, unknown> = {},
    hasTags = false,
) {
    return hugoConfig({
        config: configFor(overrides, site),
        navigation: NAVIGATION,
        themesDir: THEMES_DIR,
        hasTags,
    });
}

/** Every leaf of a nested object as its dotted path. */
function leafPaths(value: unknown, prefix = ""): string[] {
    if (Array.isArray(value)) {
        // An array is a leaf as far as authorship goes: the guard names the
        // array's own key, never an element inside it.
        return [prefix];
    }
    if (typeof value === "object" && value !== null) {
        return Object.entries(value).flatMap(([key, inner]) =>
            leafPaths(inner, prefix ? `${prefix}.${key}` : key),
        );
    }
    return [prefix];
}

/** Whether a dotted path, or any ancestor of it, is a derived key. */
function isDerived(dotted: string): boolean {
    const parts = dotted.split(".");
    return parts.some((_, i) => parts.slice(0, i + 1).join(".") in DERIVED_HUGO_KEYS);
}

describe("everything the generator writes is a key `site.hugo` may not author", () => {
    it("names the keys the design derives, so the guard is not vacuous", () => {
        for (const key of [
            "baseURL",
            "title",
            "publishDir",
            "contentDir",
            "themesDir",
            "theme",
            "disableKinds",
            "taxonomies",
            "outputs",
            "params.description",
            "params.author",
            "params.cdnBaseURL",
            "params.brand",
            "menu",
        ]) {
            expect(DERIVED_HUGO_KEYS, key).toHaveProperty(key);
        }
    });

    it("every top-level and nested key in the generated TOML is under a derived key", () => {
        // Read back out of the TOML rather than off the object, so the test
        // covers what Hugo reads. A key the generator writes without a guard
        // entry could otherwise be authored in `site.hugo` and silently
        // overwritten — the drift `DERIVED_MANIFEST_KEYS` exists to prevent.
        const parsed = parseToml(
            hugoToml(
                generated(
                    {
                        list: { shortcodes: true },
                        notfound: { tagline: "No page at", sitenoun: "module" },
                    },
                    {},
                    // Tagged, so `taxonomies` and `outputs` are also emitted
                    // and their leaves must be covered by the guard too.
                    true,
                ),
            ),
        );
        const paths = leafPaths(parsed);
        expect(paths.length).toBeGreaterThan(10);
        const unguarded = paths.filter((dotted) => !isDerived(dotted));
        expect(unguarded).toEqual([]);
    });

    it("refuses `site.hugo.disableKinds`, `.taxonomies` and `.outputs`, naming the derivation", () => {
        for (const key of ["disableKinds", "taxonomies", "outputs"]) {
            expect(() => configFor({}, { hugo: { [key]: [] } })).toThrow(
                new RegExp(
                    `\`site\\.hugo\\.${key}\` is derived from whether any note in the tree ` +
                        "carries `tags:`, which the site walk discovers and must not be declared",
                ),
            );
        }
    });

    it("refuses `site.hugo.baseURL`, naming `package.json` `homepage`", () => {
        expect(() => configFor({}, { hugo: { baseURL: "https://example.org/" } })).toThrow(
            /`site\.hugo\.baseURL` is derived from package\.json `homepage` and must not be declared/,
        );
    });

    it("refuses a nested derived key, naming its source", () => {
        expect(() => configFor({}, { hugo: { params: { brand: { logo: "x" } } } })).toThrow(
            /`site\.hugo\.params\.brand` is derived from/,
        );
        expect(() =>
            configFor({}, { hugo: { markup: { goldmark: { renderer: { unsafe: false } } } } }),
        ).toThrow(/`site\.hugo\.markup\.goldmark\.renderer\.unsafe` is derived from/);
    });

    it("accepts the key nobody anticipated, and merges it last", () => {
        const config = configFor(
            {},
            { hugo: { markup: { goldmark: { extensions: { linkify: false } } } } },
        );
        expect(config.site.hugo).toEqual({
            markup: { goldmark: { extensions: { linkify: false } } },
        });
        const out = generated({
            hugo: { markup: { goldmark: { extensions: { linkify: false } } } },
        });
        // Deep-merged: the toolchain's own renderer setting survives beside it.
        expect(out.markup).toEqual({
            goldmark: { renderer: { unsafe: true }, extensions: { linkify: false } },
        });
    });

    it("refuses `site.out`, naming the fixed location", () => {
        expect(() => configFor({}, { out: "site/content" })).toThrow(
            new RegExp(`\`site\\.out\` is retired.*\`${HUGO_CONTENT}\``),
        );
    });
});

describe("the generated configuration", () => {
    it("derives every value from a source the repository already states", () => {
        const out = generated();
        expect(out.baseURL).toBe("https://www.heroiclands.org/demo/");
        expect(out.title).toBe("The Demo Module");
        expect(out.locale).toBe(LOCALE);
        expect(out.publishDir).toBe("../site/demo");
        expect(out.themesDir).toBe(THEMES_DIR);
        expect(out.theme).toBe(THEME);
        expect(out.contentDir).toBe("content");
        expect(out.params.description).toBe("A demonstration module.");
        expect(out.params.author).toBe("Ann Author");
        expect(out.params.cdnBaseURL).toBe("https://cdn.example.org");
        expect(out.params.brand).toEqual(BRAND);
        expect(out.params.list).toEqual({ shortcodes: false });
        expect(out.params).not.toHaveProperty("notfound");
    });

    it("disables taxonomy, term and RSS for a site with no tagged note", () => {
        expect(DISABLE_KINDS).toEqual(["taxonomy", "term", "RSS"]);
        expect(generated().disableKinds).toEqual([...DISABLE_KINDS]);
        expect(
            generated({}, { publish: { site: "content", address: { prefix: "kb/" } } })
                .disableKinds,
        ).toEqual([...DISABLE_KINDS]);
    });

    it("leaves taxonomy and term enabled for a site with at least one tagged note", () => {
        const out = generated({}, {}, true);
        expect(out.disableKinds).toEqual(["RSS"]);
        expect(out.taxonomies).toEqual({ tag: "tags" });
        expect(out.outputs).toEqual({ taxonomy: ["HTML"], term: ["HTML"] });
    });

    it("passes the renderer the raw HTML the toolchain emits", () => {
        // `<figure>` and `<span class="sohl-unresolved-link">` are written into
        // pages by the toolchain itself, so this is its requirement, not a
        // consumer's choice.
        expect(generated().markup).toEqual({ goldmark: { renderer: { unsafe: true } } });
    });

    it("emits neither `[taxonomies]` nor `[outputs]` for a site with no tagged note", () => {
        const out = generated();
        expect(out).not.toHaveProperty("taxonomies");
        expect(out).not.toHaveProperty("outputs");
    });

    it("writes `site.notfound` and `site.list` through", () => {
        const out = generated({
            list: { shortcodes: true },
            notfound: {
                tagline: "This module has one page, and it is not at",
                sitenoun: "module",
                heroimage: "images/banners/tapestry.webp",
                links: [{ title: "Home", url: "/", text: "From the top." }],
            },
        });
        expect(out.params.list).toEqual({ shortcodes: true });
        expect(out.params.notfound).toEqual({
            tagline: "This module has one page, and it is not at",
            sitenoun: "module",
            heroimage: "images/banners/tapestry.webp",
            links: [{ title: "Home", url: "/", text: "From the top." }],
        });
    });

    it("leaves an absent optional value off rather than writing an empty one", () => {
        const out = hugoConfig({
            config: configFor({ author: undefined }, { assets: undefined }),
            navigation: NAVIGATION,
            themesDir: THEMES_DIR,
        });
        expect(out.params).not.toHaveProperty("author");
        expect(out.params).not.toHaveProperty("cdnBaseURL");
        const toml = hugoToml(out);
        expect(toml).not.toMatch(/author|cdnBaseURL/);
    });

    it("fails through `checkHomepage` before anything is written", () => {
        expect(() =>
            hugoConfig({
                config: configFor({ homepage: undefined }),
                navigation: NAVIGATION,
                themesDir: "x",
            }),
        ).toThrow(/`homepage` is not declared in `package\.json`/);
        expect(() =>
            hugoConfig({
                config: configFor({ homepage: "https://www.heroiclands.org/demo" }),
                navigation: NAVIGATION,
                themesDir: "x",
            }),
        ).toThrow(
            /`homepage` is `https:\/\/www\.heroiclands\.org\/demo`, but `contentPackage` is `demo`/,
        );
    });

    it("requires the manifest title the site's title reads from", () => {
        expect(() =>
            hugoConfig({
                config: configFor({ packageBuild: {} }),
                navigation: NAVIGATION,
                themesDir: "x",
            }),
        ).toThrow(/`packageBuild\.manifest\.title` is not declared/);
    });

    // `site.description` writes the site's `<meta name="description">` — every
    // site build needs one, the way it needs a title.
    it("requires `site.description`, the site's own pitch", () => {
        expect(() =>
            hugoConfig({
                config: configFor({}, { description: undefined }),
                navigation: NAVIGATION,
                themesDir: "x",
            }),
        ).toThrow(/`site\.description` is not declared/);
    });

    it("writes `params.description` from `site.description`, not `package.json`", () => {
        const out = generated({ description: "A different pitch entirely." });
        expect(out.params.description).toBe("A different pitch entirely.");
    });

    it("serialises to TOML Hugo reads, with the menu as a table array", () => {
        const toml = hugoToml(generated());
        expect(toml).toMatch(/^baseURL = "https:\/\/www\.heroiclands\.org\/demo\/"$/m);
        expect(toml).toMatch(/^\[\[menu\.main\]\]$/m);
        expect(toml).toMatch(/^\[params\.brand\]$/m);
        expect(parseToml(toml)).toEqual(generated());
    });
});

describe("the menu is whatever the cached navigation says", () => {
    it("reproduces the navigation entry for entry, children as `parent` entries", () => {
        const entries = menuEntries(NAVIGATION);
        expect(entries).toEqual([
            { name: "Home", url: "https://www.heroiclands.org/", weight: 1 },
            { name: "Song of Heroic Lands", url: "https://www.heroiclands.org/sohl/", weight: 2 },
            { name: "HârnMaster 3", url: "https://www.heroiclands.org/hm3/", weight: 3 },
            { name: "Thalorna", url: "https://www.heroiclands.org/thalorna/", weight: 4 },
            {
                name: "Other Modules",
                url: "https://www.heroiclands.org/projects/modules/",
                weight: 5,
                identifier: "other-modules",
            },
            {
                name: "HârnMaster Kethira Basic",
                url: "https://www.heroiclands.org/kethira/",
                weight: 1,
                parent: "other-modules",
            },
            {
                name: "Thalorna Alternative Art",
                url: "https://www.heroiclands.org/thalornaaltart/",
                weight: 2,
                parent: "other-modules",
            },
            { name: "License", url: "https://www.heroiclands.org/license/", weight: 6 },
        ]);
        expect(generated().menu).toEqual({ main: entries });
    });

    it("is the one address package-build carries for it", () => {
        expect(NAVIGATION_URL).toBe("https://www.heroiclands.org/nav.json");
    });

    it("reads the cache only, and a cold cache names `deps fetch`", () => {
        const config = configFor();
        fs.rmSync(navigationCacheDir(config), { recursive: true, force: true });
        expect(() => readCachedNavigation(config)).toThrow(
            /navigation has not been fetched\. Run `content-build deps fetch` first/,
        );
        expect(() => generateHugoConfig(config)).toThrow(/Run `content-build deps fetch` first/);
    });

    it("treats a half-finished fetch as cold", () => {
        const config = configFor();
        cacheNavigation(config);
        fs.rmSync(path.join(navigationCacheDir(config), ".complete"));
        expect(() => readCachedNavigation(config)).toThrow(/Run `content-build deps fetch` first/);
    });

    it("refuses a cached file that is not a navigation", () => {
        const config = configFor();
        cacheNavigation(config, [{ name: "Home" }]);
        expect(() => readCachedNavigation(config)).toThrow(/\[0\]\.url/);
        cacheNavigation(config, { name: "Home", url: "/" });
        expect(() => readCachedNavigation(config)).toThrow(/must be a list/);
        cacheNavigation(config, [{ name: "Home", url: "/x/", children: [{ name: "Kid" }] }]);
        expect(() => readCachedNavigation(config)).toThrow(/\[0\]\.children\[0\]\.url/);
    });

    it("`fetchNavigation` writes the file and then the stamp", async () => {
        const config = configFor();
        fs.rmSync(navigationCacheDir(config), { recursive: true, force: true });
        const calls: string[] = [];
        const fake = async (url: string) => {
            calls.push(url);
            return new Response(JSON.stringify(NAVIGATION), { status: 200 });
        };
        const file = await fetchNavigation(config, { fetch: fake as any });
        expect(calls).toEqual([NAVIGATION_URL]);
        expect(file).toBe(path.join(navigationCacheDir(config), NAVIGATION_FILE));
        expect(readCachedNavigation(config)).toEqual(NAVIGATION);
    });

    it("`fetchNavigation` leaves no stamp behind a failed download", async () => {
        const config = configFor();
        const fake = async () => new Response("nope", { status: 404, statusText: "Not Found" });
        await expect(fetchNavigation(config, { fetch: fake as any })).rejects.toThrow(/HTTP 404/);
        expect(fs.existsSync(path.join(navigationCacheDir(config), ".complete"))).toBe(false);
        expect(() => readCachedNavigation(config)).toThrow(/Run `content-build deps fetch` first/);
    });

    it("`fetchNavigation` refuses a response that is not a navigation", async () => {
        const config = configFor();
        const fake = async () => new Response(JSON.stringify({ nope: true }), { status: 200 });
        await expect(fetchNavigation(config, { fetch: fake as any })).rejects.toThrow(
            /must be a list/,
        );
        expect(fs.existsSync(path.join(navigationCacheDir(config), ".complete"))).toBe(false);
    });
});

describe("the theme is resolved from where it is installed", () => {
    it("writes the path from `build/hugo/` to the installed scope", () => {
        expect(resolveThemesDir(root)).toBe(THEMES_DIR);
    });

    it("resolves the way Node does, walking up from the consumer root", () => {
        // A worktree without its own `node_modules` resolves the parent's;
        // the generated file says so, because the path is written rather than
        // assumed.
        const nested = path.join(root, "nested", "worktree");
        fs.mkdirSync(nested, { recursive: true });
        expect(resolveThemesDir(nested)).toBe(["..", ".."].join("/") + "/" + THEMES_DIR);
    });

    it("fails naming the package when it is not installed", () => {
        const bare = fs.mkdtempSync(path.join(os.tmpdir(), "cb-notheme-"));
        try {
            expect(() => resolveThemesDir(bare)).toThrow(
                new RegExp(`${THEME_PACKAGE.replace("/", "\\/")} is not installed`),
            );
        } finally {
            fs.rmSync(bare, { recursive: true, force: true });
        }
    });
});

describe("the Hugo source tree lands under build/", () => {
    it("is a sibling of the deployment root, so nothing Hugo reads is published", () => {
        expect(HUGO_SOURCE).toBe("build/hugo");
        expect(HUGO_CONTENT).toBe(`${HUGO_SOURCE}/content`);
        expect(DEPLOY_ROOT).toBe("build/site");
        expect(path.dirname(HUGO_SOURCE)).toBe(path.dirname(DEPLOY_ROOT));
    });

    it("`buildSite` writes the mount at the fixed location", () => {
        const config = configFor();
        const result = buildSite({ config });
        expect(result.stats?.out).toBe(path.join(root, HUGO_CONTENT));
        expect(fs.existsSync(path.join(root, HUGO_CONTENT, "homepage-root.md"))).toBe(true);
    });

    it("`writeHugoConfig` writes `build/hugo/hugo.toml` from the cached navigation", () => {
        const config = configFor();
        cacheNavigation(config);
        const { file } = writeHugoConfig(config);
        expect(file).toBe(path.join(root, HUGO_SOURCE, "hugo.toml"));
        const parsed = parseToml(fs.readFileSync(file, "utf8")) as any;
        expect(parsed.baseURL).toBe("https://www.heroiclands.org/demo/");
        expect(parsed.params.description).toBe("A demonstration module.");
        expect(parsed.params.author).toBe("Ann Author");
        expect(parsed.themesDir).toBe(THEMES_DIR);
        expect(parsed.menu.main.map((e: any) => e.name)).toEqual([
            "Home",
            "Song of Heroic Lands",
            "HârnMaster 3",
            "Thalorna",
            "Other Modules",
            "HârnMaster Kethira Basic",
            "Thalorna Alternative Art",
            "License",
        ]);
        expect(parsed.publishDir).toBe(`../site/demo`);
        expect(path.resolve(root, HUGO_SOURCE, parsed.publishDir)).toBe(
            path.join(root, DEPLOY_ROOT, "demo"),
        );
    });
});

describe("`site.list` and `site.notfound` are validated", () => {
    it("`site.list.shortcodes` is a boolean, default false", () => {
        expect(configFor().site.list).toEqual({ shortcodes: false });
        expect(configFor({}, { list: { shortcodes: true } }).site.list).toEqual({
            shortcodes: true,
        });
        expect(() => configFor({}, { list: { shortcodes: "yes" } })).toThrow(
            /`site\.list\.shortcodes` must be a boolean/,
        );
        expect(() => configFor({}, { list: { nope: true } })).toThrow(
            /`site\.list\.nope` is not a recognized option/,
        );
    });

    it("`site.notfound` requires its wording and checks its links", () => {
        expect(configFor().site.notfound).toBeNull();
        expect(() => configFor({}, { notfound: { tagline: "x" } })).toThrow(
            /`site\.notfound\.sitenoun` must be a non-empty string/,
        );
        expect(() => configFor({}, { notfound: { sitenoun: "x" } })).toThrow(
            /`site\.notfound\.tagline` must be a non-empty string/,
        );
        expect(() =>
            configFor({}, { notfound: { tagline: "x", sitenoun: "y", links: [{ title: "t" }] } }),
        ).toThrow(/`site\.notfound\.links\[0\]\.url` must be a non-empty string/);
        expect(() =>
            configFor({}, { notfound: { tagline: "x", sitenoun: "y", links: {} } }),
        ).toThrow(/`site\.notfound\.links` must be a list/);
        expect(() =>
            configFor({}, { notfound: { tagline: "x", sitenoun: "y", extra: 1 } }),
        ).toThrow(/`site\.notfound\.extra` is not a recognized option/);
        const nf = configFor(
            {},
            {
                notfound: {
                    tagline: "x",
                    sitenoun: "y",
                    links: [{ title: "t", url: "/", text: "why" }],
                },
            },
        ).site.notfound;
        expect(nf).toEqual({
            tagline: "x",
            sitenoun: "y",
            links: [{ title: "t", url: "/", text: "why" }],
        });
    });

    it("`site.hugo` must be a mapping", () => {
        expect(() => configFor({}, { hugo: "markup" })).toThrow(/`site\.hugo` must be a mapping/);
    });
});
