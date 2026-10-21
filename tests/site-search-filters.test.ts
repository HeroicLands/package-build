/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * What a site's pages tell its search reaches Pagefind's index, and the root
 * site's search reads every package site's index beside its own.
 *
 * `tests/fixtures/site-search/` is a small world: a continent, regions two
 * deep, a settlement in each half, a culture, a being with a home in each
 * half and a scenario. It is built as `site build` builds it and indexed with
 * the Pagefind the package installs, and the index is searched with the
 * bundle's own script, as a reader's browser searches it. The root site is
 * `tests/fixtures/root-site/`, built from its configuration the same way, whose
 * search merges the package site's index.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { indexSite } from "../engine/site-root.mjs";
import { buildPackageSite } from "../engine/site-render.mjs";
import { cacheNavigation, fixtureConfig } from "./helpers/parity";
import { loadSearch, results, serveDirectories, type Served } from "./helpers/pagefind";

const FIXTURE = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "fixtures",
    "site-search",
);

/** The root site whose search merges the package site's: see `tests/root-site.test.ts`. */
const ROOT_FIXTURE = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "fixtures",
    "root-site",
);

let scratch: string;
let served: Served;
let pkgOut: string;
let rootOut: string;

beforeAll(async () => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "site-search-")));
    const root = path.join(scratch, "package");
    fs.cpSync(FIXTURE, root, { recursive: true });
    fs.mkdirSync(path.join(root, "build", "cache", "metadata"), { recursive: true });
    const config = fixtureConfig(root);
    cacheNavigation(config);
    pkgOut = path.join(root, "build", "site", "searchdemo");
    const built = await buildPackageSite({ config, out: pkgOut, year: 2026 });
    expect(built.written).toBeTruthy();
    await indexSite({ site: pkgOut, output: path.join(pkgOut, "pagefind") });

    const rootSite = path.join(scratch, "root-site");
    fs.cpSync(ROOT_FIXTURE, rootSite, { recursive: true });
    const rootConfig = fixtureConfig(rootSite);
    cacheNavigation(rootConfig);
    rootOut = path.join(rootSite, "build", "site");
    const rootBuilt = await buildPackageSite({ config: rootConfig, out: rootOut, year: 2026 });
    expect(rootBuilt.written).toBeTruthy();
    await indexSite({ site: rootOut, output: path.join(rootOut, "pagefind") });
    served = await serveDirectories({ "/": rootOut, "/searchdemo/": pkgOut });
}, 240_000);

afterAll(async () => {
    await served?.close();
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

describe("a package site's search", () => {
    let search: any;
    beforeAll(async () => {
        search = await loadSearch(
            path.join(pkgOut, "pagefind"),
            `${served.origin}/searchdemo/pagefind/`,
        );
    });

    it("is offered every filter with every value its notes carry", async () => {
        const filters = await search.filters();
        expect(Object.keys(filters).sort()).toEqual(
            ["continent", "culture", "package", "region", "subtype", "type"].sort(),
        );
        expect(Object.keys(filters.package)).toEqual(["searchdemo"]);
        expect(Object.keys(filters.type).sort()).toEqual(
            ["being", "homepage", "lore", "place", "scenario"].sort(),
        );
        expect(filters.subtype).toMatchObject({ npc: 1, culture: 1, encounter: 1, settlement: 2 });
        expect(filters.culture).toEqual({ "The Marchfolk": 1 });
        expect(Object.keys(filters.continent)).toEqual(["Westland"]);
        expect(Object.keys(filters.region).sort()).toEqual(["Northmarch", "Southreach"]);
    });

    it("finds a place two levels beneath a region under that region and its continent", async () => {
        const [cairn] = (await results(search, "Highcairn")).filter((r: any) =>
            r.url.endsWith("/place-highcairn/"),
        );
        expect(cairn.filters).toMatchObject({ continent: ["Westland"], region: ["Northmarch"] });
        const northmarch = await results(search, null, { filters: { region: "Northmarch" } });
        expect(northmarch.map((r: any) => r.url.replace(/^.*\/searchdemo\//, "")).sort()).toEqual(
            ["being-wanderer/", "place-fells/", "place-highcairn/", "place-northmarch/"].sort(),
        );
    });

    it("finds a being with a home in each region under both, with its culture", async () => {
        const [being] = await results(search, null, { filters: { type: "being" } });
        expect(being.filters).toMatchObject({
            culture: ["The Marchfolk"],
            continent: ["Westland"],
            region: ["Northmarch", "Southreach"],
            subtype: ["npc"],
        });
    });

    it("finds a scenario where it takes place", async () => {
        const [scenario] = await results(search, null, { filters: { type: "scenario" } });
        expect(scenario.filters).toMatchObject({ region: ["Southreach"], continent: ["Westland"] });
    });

    it("ranks a note first for its own name, finds it by an alias, and shows its icon", async () => {
        const [first] = await results(search, "Wanderer");
        expect(first.url).toMatch(/\/being-wanderer\/$/);
        expect(first.meta.title).toBe("Iselde Wanderer");
        expect(first.meta.image).toBe("https://cdn.example.org/searchdemo/images/wanderer.png");
        const [alias] = await results(search, "Grey Walker");
        expect(alias.url).toMatch(/\/being-wanderer\/$/);
        expect(alias.meta.aliases).toBe("The Grey Walker");
        const [cairn] = await results(search, "Cairnhold");
        expect(cairn.url).toMatch(/\/place-highcairn\/$/);
    });

    it("shows a note's banner where it has no icon", async () => {
        const [place] = await results(search, null, { filters: { subtype: "region" } });
        expect(place.meta.image).toMatch(/^https:\/\/cdn\.example\.org\/images\/banners\//);
    });
});

describe("the root site's search", () => {
    let search: any;
    beforeAll(async () => {
        search = await loadSearch(path.join(rootOut, "pagefind"), `${served.origin}/pagefind/`);
        await search.mergeIndex(`${served.origin}/searchdemo/pagefind/`);
    });

    it("is told to read every package site's index by its pages", () => {
        const home = fs.readFileSync(path.join(rootOut, "index.html"), "utf8");
        expect(home).toContain('"mergeIndex":[{"bundlePath":"/searchdemo/pagefind/"}]');
        expect(home).toContain('"showImages":true');
    });

    it("finds the root site's pages and every package site's", async () => {
        const urls = (await results(search, "lantern")).map((r: any) => r.url);
        expect(urls.some((url: string) => url.endsWith("/doc-firstlantern/"))).toBe(true);
        const merged = (await results(search, "Iselde")).map((r: any) => r.url);
        expect(merged.some((url: string) => url.endsWith("/searchdemo/being-wanderer/"))).toBe(
            true,
        );
    });

    it("offers the blog's author and tags filters beside the packages' own", async () => {
        const filters = await search.filters();
        expect(filters.author).toEqual({ "Ann Author": 1, "Bo Writer": 1, "Cy Editor": 1 });
        expect(filters.tags).toEqual({ news: 2, roads: 2 });
        expect(Object.keys(filters.region).sort()).toEqual(["Northmarch", "Southreach"]);
    });

    it("sorts the blog's posts by date", async () => {
        const posts = await results(search, null, {
            filters: { author: { any: ["Ann Author", "Bo Writer", "Cy Editor"] } },
            sort: { date: "desc" },
        });
        expect(posts.map((r: any) => r.meta.title)).toEqual([
            "Second Lantern",
            "Third Lantern",
            "First Lantern",
        ]);
    });
});
