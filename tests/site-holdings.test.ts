/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import matter from "gray-matter";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "../index.mjs";
import { buildSite, gatesFailed } from "../engine/site-build.mjs";
import {
    HOLDINGS_KEYS,
    foreignHoldingsNodes,
    holdingsNode,
    holdingsPages,
} from "../engine/holdings.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { parseAddress } from "../engine/address.mjs";
import { loadForeignIndexes } from "../engine/metadata-index.mjs";

/* ---------------------------------------------------------------------- */
/*  Fixtures                                                              */
/* ---------------------------------------------------------------------- */

/**
 * A place note with optional additional data fields.
 */
function place(
    shortcode: string,
    name: string,
    subType: string,
    { parents = [], extra = "" }: { parents?: string[]; extra?: string } = {},
): string {
    return [
        "---",
        "type: place",
        `subType: ${subType}`,
        `shortcode: ${shortcode}`,
        "name:",
        `    full: ${name}`,
        "data:",
        `    parents: [${parents.join(", ")}]`,
        ...(extra ? [extra] : []),
        "---",
        "",
        "Prose.",
        "",
    ].join("\n");
}

/** An affiliation note. */
function affiliation(
    shortcode: string,
    name: string,
    subType: string,
    { domains, parents = [] }: { domains?: string[]; parents?: string[] } = {},
): string {
    return [
        "---",
        "type: affiliation",
        `subType: ${subType}`,
        `shortcode: ${shortcode}`,
        "name:",
        `    full: ${name}`,
        "data:",
        `    parents: [${parents.join(", ")}]`,
        ...(domains ? [`    domains: [${domains.join(", ")}]`] : []),
        "---",
        "",
        "Prose.",
        "",
    ].join("\n");
}

/**
 * The fixture the rule is stated on, as `{ relPath: contents }`.
 *
 * - `rgn`, a region, contains the settlements `ham` and `mill` and the feature
 *   `river`; `far` is a second region containing the structure `manor`.
 * - The house `house` governs `ham` and `manor` — two places, two regions.
 * - The polity `crown` governs `rgn`; the sub-polity `duchy` is its vassal and
 *   governs nothing directly.
 * - Nobody governs `mill` or `river`; government does not follow geography.
 * - `mill` authors a `contains:` of its own, which is replaced.
 */
const FIXTURE: Record<string, string> = {
    "Regions/Rgn.md": place("rgn", "The Region", "region", { extra: "    government: crown" }),
    "Regions/Far.md": place("far", "The Far Region", "region"),
    "Regions/Ham.md": place("ham", "Ham", "settlement", { parents: ["rgn"] }),
    "Regions/Mill.md": place("mill", "Mill", "settlement", {
        parents: ["rgn"],
        extra: "contains:\n    - authored",
    }),
    "Regions/River.md": place("river", "The River", "feature", { parents: ["rgn"] }),
    "Regions/Manor.md": place("manor", "The Manor", "structure", {
        parents: ["far"],
        extra: "    government: house",
    }),
    "Houses/House.md": affiliation("house", "The House", "lineage", {
        parents: ["crown"],
    }),
    "Houses/Crown.md": affiliation("crown", "The Crown", "polity"),
    "Houses/Duchy.md": affiliation("duchy", "The Duchy", "polity", { parents: ["crown"] }),
    "Lore/Silence.md": [
        "---",
        "type: lore",
        "subType: folk",
        "shortcode: silence",
        "name:",
        "    full: Silence",
        "---",
        "",
        "Prose.",
        "",
    ].join("\n"),
};

/** Write the fixture as a content tree under `root/assets/content`. */
function writeTree(root: string, files: Record<string, string>): string {
    const base = path.join(root, "assets/content");
    for (const [rel, body] of Object.entries(files)) {
        const abs = path.join(base, ...rel.split("/"));
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, body, "utf8");
    }
    return base;
}

/** An entry as the page lists it. */
const entry = (title: string, url: string, type: string, subType: string) => ({
    title,
    url,
    type,
    subType,
});

const rgn = entry("The Region", "/demo/place-rgn/", "place", "region");
const far = entry("The Far Region", "/demo/place-far/", "place", "region");
const ham = entry("Ham", "/demo/place-ham/", "place", "settlement");
const mill = entry("Mill", "/demo/place-mill/", "place", "settlement");
const river = entry("The River", "/demo/place-river/", "place", "feature");
const manor = entry("The Manor", "/demo/place-manor/", "place", "structure");
const house = entry("The House", "/demo/affiliation-house/", "affiliation", "lineage");
const crown = entry("The Crown", "/demo/affiliation-crown/", "affiliation", "polity");

/* ---------------------------------------------------------------------- */
/*  The site build writes containment and government lists                                 */
/* ---------------------------------------------------------------------- */

describe("the site build writes `contains`, `governed_by` and `governed_places`", () => {
    let root: string;

    /** The published front matter of one page under the content mount. */
    const published = (rel: string): Record<string, unknown> =>
        matter(fs.readFileSync(path.join(root, "build/hugo/content", rel), "utf8")).data;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-holdings-"));
        fs.writeFileSync(
            path.join(root, "package.json"),
            JSON.stringify({ name: "sandbox", version: "1.0.0" }),
        );
        fs.mkdirSync(path.join(root, "build/cache/metadata"), { recursive: true });
        writeTree(root, {
            ...FIXTURE,
            "Regions/Ham.md": place("ham", "Ham", "settlement", {
                parents: ["rgn"],
                extra: "    government: house",
            }),
            "Regions/Mill.md": place("mill", "Mill", "settlement", {
                parents: ["rgn"],
                extra: "    government: null",
            }),
            "homepage.md": "---\ntype: homepage\nshortcode: root\ntitle: The Demo\n---\n\nHome.\n",
        });
        const config = defineConfig({
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
        });
        const result = buildSite({ config });
        expect(gatesFailed(result.gates)).toBe(false);
        expect(result.wikiErrors).toEqual([]);
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it("preserves explicit anarchy, linked government and omitted government on site pages", () => {
        expect((published("kb/place-mill.md").data as any).government).toBeNull();
        expect((published("kb/place-ham.md").data as any).government).toBe(
            "demo-note-affiliation-house",
        );
        expect(published("kb/place-river.md").data).not.toHaveProperty("government");
    });

    it("lists on a region every place whose `parents` names it, by subType then title", () => {
        expect(published("kb/place-rgn.md").contains).toEqual([river, ham, mill]);
        expect(published("kb/place-far.md").contains).toEqual([manor]);
    });

    it("lists on a house every place naming it as government, across two regions", () => {
        expect(published("kb/affiliation-house.md").governed_places).toEqual([ham, manor]);
    });

    it("names on a manor its stated governing house", () => {
        expect(published("kb/place-manor.md").governed_by).toEqual([house]);
        expect(published("kb/place-ham.md").governed_by).toEqual([house]);
    });

    it("never inherits government from a region or affiliation hierarchy", () => {
        expect(published("kb/affiliation-crown.md").governed_places).toEqual([rgn]);
        expect(published("kb/place-rgn.md").governed_by).toEqual([crown]);
        expect(published("kb/place-ham.md").governed_by).toEqual([house]);
        expect(published("kb/place-mill.md")).not.toHaveProperty("governed_by");
    });

    it("shapes every entry as `{ title, url, type, subType }`", () => {
        const page = published("kb/affiliation-house.md") as { governed_places: object[] };
        for (const e of page.governed_places) {
            expect(Object.keys(e).sort()).toEqual(["subType", "title", "type", "url"]);
        }
    });

    it("writes no key on a page with nothing to say, and replaces an authored one", () => {
        for (const key of HOLDINGS_KEYS) {
            expect(published("kb/place-mill.md")).not.toHaveProperty(key);
            expect(published("kb/lore-silence.md")).not.toHaveProperty(key);
            expect(published("kb/affiliation-duchy.md")).not.toHaveProperty(key);
        }
        // A place holding nothing within it and held by nobody carries only
        // the key it has something for.
        expect(published("kb/place-manor.md")).not.toHaveProperty("contains");
        expect(published("kb/place-manor.md")).not.toHaveProperty("governed_places");
        expect(published("kb/affiliation-house.md")).not.toHaveProperty("contains");
        expect(published("kb/affiliation-house.md")).not.toHaveProperty("governed_by");
    });

    it("composes `<base><slug>/` on every entry, where the page itself states `/<slug>/`", () => {
        const page = published("kb/place-rgn.md") as { url: string; contains: { url: string }[] };
        expect(page.url).toBe("/place-rgn/");
        for (const e of page.contains) expect(e.url).toMatch(/^\/demo\/place-[a-z]+\/$/);
    });
});

/* ---------------------------------------------------------------------- */
/*  The derivation, on its own                                            */
/* ---------------------------------------------------------------------- */

describe("holdingsPages", () => {
    const node = (shortcode: string, type: "place" | "affiliation", opts: any = {}) => ({
        shortcode,
        type,
        subType: type === "place" ? "settlement" : "polity",
        title: shortcode,
        url: `/demo/${type}-${shortcode}/`,
        parents: [],
        package: "demo",
        ...opts,
    });
    it("derives direct government and sorts governed places by subtype and title", () => {
        const pages = holdingsPages([
            node("crown", "affiliation"),
            node("region", "place", { government: "crown", subType: "region" }),
            node("b", "place", { government: "crown", parents: ["region"] }),
            node("a", "place", { government: "affiliation-crown", parents: ["region"] }),
        ]);
        expect(pages.get("/demo/affiliation-crown/")?.governed_places?.map((e) => e.title)).toEqual(
            ["region", "a", "b"],
        );
        expect(pages.get("/demo/place-a/")?.governed_by?.map((e) => e.title)).toEqual(["crown"]);
        expect(pages.get("/demo/place-region/")?.contains?.map((e) => e.title)).toEqual(["a", "b"]);
    });
    it("ignores domains and never inherits government through either hierarchy", () => {
        const pages = holdingsPages([
            node("crown", "affiliation", { domains: ["a"] }),
            node("house", "affiliation", { parents: ["crown"] }),
            node("region", "place", { government: "house" }),
            node("a", "place", { parents: ["region"] }),
        ]);
        expect(pages.get("/demo/place-a/")).toBeUndefined();
        expect(pages.get("/demo/affiliation-crown/")).toBeUndefined();
        expect(pages.get("/demo/affiliation-house/")?.governed_places?.map((e) => e.title)).toEqual(
            ["region"],
        );
    });
    it("keeps same shortcodes in different packages separate for government", () => {
        const foreign = node("crown", "affiliation", {
            package: "other",
            title: "Foreign crown",
            url: "/other/crown/",
        });
        const tuple = parseAddress(
            "other-sohl-affiliation-crown",
            {
                package: "demo",
                system: "sohl",
                type: "affiliation",
                types: new Set(["affiliation"]),
            },
            { declared: true },
        );
        const pages = holdingsPages([
            node("crown", "affiliation"),
            foreign,
            node("a", "place", { government: "crown" }),
            node("b", "place", { government: "other-sohl-affiliation-crown" }),
            node("c", "place", { government: tuple }),
            node("d", "place", { package: "other", government: "crown" }),
        ]);
        expect(pages.get("/demo/affiliation-crown/")?.governed_places?.map((e) => e.title)).toEqual(
            ["a"],
        );
        expect(pages.get("/other/crown/")?.governed_places?.map((e) => e.title)).toEqual([
            "b",
            "c",
            "d",
        ]);
    });
    it("retains the first shortcode's containment while government keeps distinct packages", () => {
        const pages = holdingsPages([
            node("region", "place"),
            node("crown", "affiliation"),
            node("a", "place", { parents: ["region"], government: "crown" }),
            node("a", "place", {
                package: "other",
                url: "/other/a/",
                title: "Foreign A",
                parents: ["region"],
                government: "demo-sohl-affiliation-crown",
            }),
        ]);
        expect(pages.get("/demo/place-region/")?.contains?.map((e) => e.title)).toEqual(["a"]);
        expect(pages.get("/demo/affiliation-crown/")?.governed_places?.map((e) => e.title)).toEqual(
            ["a", "Foreign A"],
        );
    });
    it("normalizes Item and journal references to the same affiliation page", () => {
        const pages = holdingsPages([
            node("crown", "affiliation", { system: "sohl" }),
            node("crown", "affiliation", {
                system: "note",
                title: "duplicate document",
                url: "/duplicate/",
            }),
            node("a", "place", { government: "demo-note-affiliation-crown" }),
            node("b", "place", { government: "demo-sohl-affiliation-crown" }),
        ]);
        expect(pages.get("/demo/affiliation-crown/")?.governed_places?.map((e) => e.title)).toEqual(
            ["a", "b"],
        );
        expect(pages.has("/duplicate/")).toBe(false);
    });
    it("omission, anarchy, unknown references, and invalid types produce no government list", () => {
        const pages = holdingsPages([
            node("crown", "affiliation"),
            node("a", "place"),
            node("b", "place", { government: null }),
            node("c", "place", { government: "missing" }),
            node("d", "place", { government: "place-crown" }),
            node("e", "place", { government: "[[affiliation-crown]]" }),
        ]);
        expect(pages.size).toBe(0);
    });
    it("includes stubs as plain text entries and never writes a list to a missing page", () => {
        const pages = holdingsPages([
            node("crown", "affiliation"),
            node("a", "place", { government: "crown", url: "" }),
            node("house", "affiliation", { url: "" }),
            node("b", "place", { government: "house" }),
        ]);
        expect(pages.get("/demo/affiliation-crown/")?.governed_places).toEqual([
            { title: "a", type: "place", subType: "settlement" },
        ]);
        expect(pages.get("/demo/place-b/")?.governed_by).toEqual([
            { title: "house", type: "affiliation", subType: "polity" },
        ]);
        expect(pages.has("")).toBe(false);
    });
    it("includes supplemental local stub governments without changing containment", () => {
        const pages = holdingsPages(
            [
                node("region", "place"),
                node("crown", "affiliation"),
                node("published", "place", {
                    title: "Published",
                    government: "crown",
                    parents: ["region"],
                }),
                node("understub", "place", { government: "stubhouse" }),
            ],
            {
                governmentNodes: [
                    node("stub", "place", {
                        title: "Stub place",
                        government: "crown",
                        parents: ["region"],
                        url: undefined,
                    }),
                    node("stubhouse", "affiliation", { title: "Stub house", url: undefined }),
                    node("published", "place", {
                        title: "Duplicate record",
                        government: "stubhouse",
                        url: undefined,
                    }),
                ],
            },
        );
        expect(pages.get("/demo/affiliation-crown/")?.governed_places).toEqual([
            {
                title: "Published",
                type: "place",
                subType: "settlement",
                url: "/demo/place-published/",
            },
            { title: "Stub place", type: "place", subType: "settlement" },
        ]);
        expect(pages.get("/demo/place-understub/")?.governed_by).toEqual([
            { title: "Stub house", type: "affiliation", subType: "polity" },
        ]);
        expect(pages.get("/demo/place-region/")?.contains?.map((e) => e.title)).toEqual([
            "Published",
        ]);
        expect(pages.get("/demo/place-published/")?.governed_by?.map((e) => e.title)).toEqual([
            "crown",
        ]);
        expect(pages.has(undefined as never)).toBe(false);
    });
    it("keeps the first full Address declaration and omits absent subtypes", () => {
        const pages = holdingsPages([
            node("crown", "affiliation"),
            node("crown", "affiliation", { title: "duplicate" }),
            node("a", "place", { government: "crown", subType: undefined }),
        ]);
        expect(pages.get("/demo/affiliation-crown/")?.governed_places).toEqual([
            { title: "a", url: "/demo/place-a/", type: "place" },
        ]);
    });
});

describe("holdingsNode", () => {
    it("retains government null versus omission and ignores affiliation domains", () => {
        const read = (data: any) =>
            holdingsNode(
                { type: "place", shortcode: "r", data },
                { title: "R", url: "/r/", package: "demo" },
            );
        expect(read({ government: null })).toHaveProperty("government", null);
        expect(read({})).not.toHaveProperty("government");
        const affiliation = holdingsNode(
            { type: "affiliation", shortcode: "x", data: { domains: ["r"] } },
            { title: "X", url: "/x/", package: "demo" },
        );
        expect(affiliation).not.toHaveProperty("domains");
        expect(
            holdingsNode({ type: "lore", shortcode: "l" }, { title: "L", url: "/l/" }),
        ).toBeNull();
        expect(holdingsNode({ type: "place" }, { title: "L", url: "/l/" })).toBeNull();
    });
});

/* ---------------------------------------------------------------------- */
/*  A dependency's places and affiliations take part                      */
/* ---------------------------------------------------------------------- */

/** A fetched index of `thalorna`, holding one region and one polity. */
function foreignCache(): { config: object; cache: string } {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "cb-holdings-cache-"));
    const dir = path.join(cache, "thalorna@0.1.0");
    fs.mkdirSync(dir, { recursive: true });
    const records = [
        {
            package: "thalorna",
            type: "place",
            subType: "region",
            shortcode: "abroad",
            name: { full: "Abroad" },
            data: { parents: ["rgn"], government: null },
            address: { slug: "place-abroad", canonical: "thalorna-note-place-abroad" },
        },
        {
            package: "thalorna",
            type: "affiliation",
            subType: "polity",
            shortcode: "empire",
            name: { full: "The Empire" },
            data: { domains: ["mill", "abroad"] },
            address: {
                slug: "affiliation-empire",
                canonical: "thalorna-sohl-affiliation-empire",
            },
        },
    ];
    records.push(
        {
            package: "thalorna",
            type: "place",
            subType: "site",
            shortcode: "governed",
            name: { full: "Governed" },
            data: { government: "thalorna-sohl-affiliation-empire" },
            address: { slug: "place-governed", canonical: "thalorna-note-place-governed" },
        } as any,
        {
            package: "thalorna",
            type: "place",
            subType: "site",
            shortcode: "ungoverned",
            name: { full: "Ungoverned" },
            data: {},
            address: { slug: "place-ungoverned", canonical: "thalorna-note-place-ungoverned" },
        } as any,
    );
    fs.writeFileSync(
        path.join(dir, "thalorna-metadata.jsonl"),
        records.map((r) => JSON.stringify(r)).join("\n") + "\n",
    );
    fs.writeFileSync(path.join(dir, ".complete"), "");
    return {
        cache,
        config: {
            contentPackage: "demo",
            paths: { metadataCache: cache },
            relationships: { requires: [{ id: "thalorna", manifest: "https://x/y.json" }] },
        },
    };
}

describe("a dependency's places and affiliations take part", () => {
    it("keeps explicit government null on fetched places", () => {
        const { config, cache } = foreignCache();
        try {
            const { index } = loadForeignIndexes(config as never, ["demo"]);
            expect(index.get("thalorna-note-place-abroad")).toHaveProperty("government", null);
            expect(index.get("thalorna-note-place-ungoverned")).not.toHaveProperty("government");
            expect(index.get("thalorna-note-place-governed")?.government).toEqual({
                package: "thalorna",
                system: "sohl",
                type: "affiliation",
                shortcode: "empire",
            });
        } finally {
            fs.rmSync(cache, { recursive: true, force: true });
        }
    });

    it("resolves government from local and fetched affiliation indexes", () => {
        const { config, cache } = foreignCache();
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-government-links-"));
        try {
            const base = writeTree(root, {
                ...FIXTURE,
                "Regions/Mill.md": place("mill", "Mill", "settlement", {
                    parents: ["rgn"],
                    extra: "    population: 120\n    government: thalorna-sohl-affiliation-empire",
                }),
                "Regions/Ham.md": place("ham", "Ham", "settlement", {
                    parents: ["rgn"],
                    extra: "    population: 120\n    government: house",
                }),
            });
            const index = buildLinkIndex(base, { skipDirectories: [], config });
            const { findings } = lintFrontmatter(index, {
                schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS } as never,
                vocabulary: NOTE_VOCABULARY,
            });
            expect(findings.filter((f) => f.message.includes("government"))).toEqual([]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
            fs.rmSync(cache, { recursive: true, force: true });
        }
    });

    it("retains fetched government facts and canonical identity while ignoring domains", () => {
        const { config, cache } = foreignCache();
        try {
            const { index } = loadForeignIndexes(config as never, ["demo"]);
            const nodes = foreignHoldingsNodes(index);
            expect(nodes.find((n) => n.shortcode === "abroad")).toHaveProperty("government", null);
            expect(nodes.find((n) => n.shortcode === "ungoverned")).not.toHaveProperty(
                "government",
            );
            expect(nodes.find((n) => n.shortcode === "empire")).toHaveProperty(
                "canonical",
                "thalorna-sohl-affiliation-empire",
            );
            expect(nodes.find((n) => n.shortcode === "empire")).not.toHaveProperty("domains");
        } finally {
            fs.rmSync(cache, { recursive: true, force: true });
        }
    });

    it("reads the fetched entries as nodes, and lists them on local pages", () => {
        const { config, cache } = foreignCache();
        try {
            const { index } = loadForeignIndexes(config as never, ["demo"]);
            const abroad = entry("Abroad", "/thalorna/place-abroad/", "place", "region");
            const empire = entry(
                "The Empire",
                "/thalorna/affiliation-empire/",
                "affiliation",
                "polity",
            );
            const pages = holdingsPages([
                holdingsNode(
                    { type: "place", subType: "region", shortcode: "rgn", data: {} },
                    { title: "The Region", url: rgn.url },
                )!,
                holdingsNode(
                    {
                        type: "place",
                        subType: "settlement",
                        shortcode: "mill",
                        data: { parents: ["rgn"], government: "thalorna-sohl-affiliation-empire" },
                    },
                    { title: "Mill", url: mill.url },
                )!,
                ...foreignHoldingsNodes(index),
            ]);
            expect(pages.get(rgn.url)?.contains).toEqual([abroad, mill]);
            expect(pages.get(mill.url)?.governed_by).toEqual([empire]);
            expect(pages.get(empire.url)?.governed_places).toEqual([
                mill,
                entry("Governed", "/thalorna/place-governed/", "place", "site"),
            ]);
        } finally {
            fs.rmSync(cache, { recursive: true, force: true });
        }
    });
});

describe("government advisories do not depend on holdings", () => {
    it("does not infer government from local or fetched domains", () => {
        const { config, cache } = foreignCache();
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-government-"));
        try {
            const base = writeTree(root, {
                ...FIXTURE,
                "Regions/Mill.md": place("mill", "Mill", "settlement", {
                    parents: ["rgn"],
                    extra: "    population: 120",
                }),
            });
            const index = buildLinkIndex(base, { skipDirectories: [], config });
            const { findings } = lintFrontmatter(index, {
                schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS } as never,
                vocabulary: NOTE_VOCABULARY,
            });
            expect(findings.filter((f) => f.message.includes("unheld land"))).toEqual([]);
            const warnings = findings.filter((f) => f.message.includes("missing government"));
            expect(warnings).toHaveLength(1);
            expect(warnings[0].file).toBe(path.join(base, "Regions/Mill.md"));
            expect(warnings[0].line).toBe(9);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
            fs.rmSync(cache, { recursive: true, force: true });
        }
    });
});
