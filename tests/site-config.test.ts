/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * What a site build reads from the configuration.
 *
 * The site's address, title and parameters come from a source the repository
 * already states, an organisation constant, or the navigation `deps fetch`
 * cached — so the cases here are weighted towards the guards: that a missing
 * source is refused by name, that a cold cache is refused by name, and that
 * the settings hold what the sources say.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "../content-config.mjs";
import {
    BRAND,
    DEPLOY_ROOT,
    NAVIGATION_FILE,
    NAVIGATION_URL,
    fetchNavigation,
    navigationCacheDir,
    readCachedNavigation,
    siteSettings,
} from "../engine/site-config.mjs";

let root: string;

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
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-site-config-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({
            name: "demo",
            version: "1.0.0",
            description: "A demonstration module.",
            homepage: "https://www.heroiclands.org/demo/",
        }),
    );
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
        compatibility: { minimum: "14.359" },
        homepage: "https://www.heroiclands.org/demo/",
        authors: [{ name: "Ann Author" }],
        stats: { lastModifiedBy: "demobuilder0000" },
        packs: [{ name: "items", type: "Item" }],
        packageBuild: { manifest: { title: "The Demo Module" } },
        publish: { address: { prefix: "" } },
        site: {
            assets: "https://cdn.example.org",
            description: "A demonstration module.",
            ...site,
        },
        ...overrides,
    } as any);
}

/** The settings for a fixture. */
function settings(site: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
    return siteSettings({ config: configFor(overrides, site) });
}

describe("the site settings", () => {
    it("derive every value from a source the repository already states", () => {
        const out = settings();
        expect(out.baseURL).toBe("https://www.heroiclands.org/demo/");
        expect(out.title).toBe("The Demo Module");
        expect(out.params.description).toBe("A demonstration module.");
        expect(out.params.author).toBe("Ann Author");
        expect(out.params.cdnBaseURL).toBe("https://cdn.example.org");
        expect(out.params.brand).toEqual(BRAND);
        expect(out.params).not.toHaveProperty("notfound");
    });

    it("write `site.notfound` through", () => {
        const out = settings({
            notfound: {
                tagline: "This module has one page, and it is not at",
                sitenoun: "module",
                heroimage: "images/banners/tapestry.webp",
                links: [{ title: "Home", url: "/", text: "From the top." }],
            },
        });
        expect(out.params.notfound).toEqual({
            tagline: "This module has one page, and it is not at",
            sitenoun: "module",
            heroimage: "images/banners/tapestry.webp",
            links: [{ title: "Home", url: "/", text: "From the top." }],
        });
    });

    it("leave an absent optional value off rather than writing an empty one", () => {
        // `assets` and `description` are required — see the guards below —
        // so the byline is the only value left that is genuinely optional.
        const out = settings({}, { authors: undefined });
        expect(out.params).not.toHaveProperty("author");
    });

    it("fail through `checkHomepage` before anything is composed", () => {
        expect(() => settings({}, { homepage: undefined })).toThrow(
            /`homepage` is not declared in `package\.json`/,
        );
        expect(() => settings({}, { homepage: "https://www.heroiclands.org/demo" })).toThrow(
            /`homepage` is `https:\/\/www\.heroiclands\.org\/demo`, but `contentPackage` is `demo`/,
        );
    });

    it("require a site or manifest title", () => {
        expect(() => settings({}, { packageBuild: {} })).toThrow(
            /declare `site\.title` or `packageBuild\.manifest\.title`/,
        );
    });

    it("use the site's own title for a documentation package", () => {
        expect(settings({ title: "A Documentation Site" }, { packageBuild: {} }).title).toBe(
            "A Documentation Site",
        );
    });

    // `site.description` writes the site's `<meta name="description">` — every
    // site build needs one, the way it needs a title.
    it("require `site.description`, the site's own pitch", () => {
        expect(() => settings({ description: undefined })).toThrow(
            /`site\.description` is not declared/,
        );
    });

    it("write `params.description` from `site.description`, not `package.json`", () => {
        expect(settings({ description: "A different pitch entirely." }).params.description).toBe(
            "A different pitch entirely.",
        );
    });

    it("require `site.assets`, the host the theme resolves every relative asset against", () => {
        expect(() => settings({ assets: undefined })).toThrow(/`site\.assets` is not declared/);
    });
});

describe("the navigation is whatever the cache says", () => {
    it("is the one address package-build carries for it", () => {
        expect(NAVIGATION_URL).toBe("https://www.heroiclands.org/nav.json");
    });

    it("reads the cache only, and a cold cache names `deps fetch`", () => {
        const config = configFor();
        fs.rmSync(navigationCacheDir(config), { recursive: true, force: true });
        expect(() => readCachedNavigation(config)).toThrow(
            /navigation has not been fetched\. Run `package-build deps fetch` first/,
        );
    });

    it("treats a half-finished fetch as cold", () => {
        const config = configFor();
        cacheNavigation(config);
        fs.rmSync(path.join(navigationCacheDir(config), ".complete"));
        expect(() => readCachedNavigation(config)).toThrow(/Run `package-build deps fetch` first/);
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
        expect(() => readCachedNavigation(config)).toThrow(/Run `package-build deps fetch` first/);
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

describe("the deployment root", () => {
    it("is under build/", () => {
        expect(DEPLOY_ROOT).toBe("build/site");
    });
});

describe("`site.notfound` is validated", () => {
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
});
