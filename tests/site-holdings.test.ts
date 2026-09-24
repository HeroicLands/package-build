/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A place page says what lies within it and who holds it; an affiliation page
 * says what it holds.
 *
 * Both are read off keys the notes already carry — a place's `data.parents`
 * for geography and an affiliation's `data.domains` for tenure — and written
 * as front-matter lists shaped like `related`: `contains` and `held_by` on a
 * place, `holdings` on an affiliation, each absent where empty. The fixture is
 * the one the rule is stated on: a region, two settlements within it, a house
 * holding one of them and a manor in another region, and a polity holding the
 * region. `content-build lint` reports the settlement nobody holds.
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
    checkHeld,
    foreignHoldingsNodes,
    holdingsNode,
    holdingsPages,
} from "../engine/holdings.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { loadForeignIndexes } from "../engine/metadata-index.mjs";

/* ---------------------------------------------------------------------- */
/*  Fixtures                                                              */
/* ---------------------------------------------------------------------- */

/**
 * A place note. `type:` is the file's line 2, which is where the tenure
 * finding is located.
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

/** An affiliation note, holding what its `domains` name. */
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
 * - `rgn`, a region, holds the settlements `ham` and `mill` and the feature
 *   `river`; `far` is a second region holding the structure `manor`.
 * - The house `house` holds `ham` and `manor` — two places, two regions.
 * - The polity `crown` holds `rgn`; the sub-polity `duchy` is its vassal and
 *   holds nothing.
 * - Nobody holds `mill`, which is the tenure gap the lint reports; nobody
 *   holds `river` either, and a feature is exempt.
 * - `mill` authors a `contains:` of its own, which is replaced.
 */
const FIXTURE: Record<string, string> = {
    "Regions/Rgn.md": place("rgn", "The Region", "region"),
    "Regions/Far.md": place("far", "The Far Region", "region"),
    "Regions/Ham.md": place("ham", "Ham", "settlement", { parents: ["rgn"] }),
    "Regions/Mill.md": place("mill", "Mill", "settlement", {
        parents: ["rgn"],
        extra: "contains:\n    - authored",
    }),
    "Regions/River.md": place("river", "The River", "feature", { parents: ["rgn"] }),
    "Regions/Manor.md": place("manor", "The Manor", "structure", { parents: ["far"] }),
    "Houses/House.md": affiliation("house", "The House", "lineage", {
        domains: ["ham", "manor"],
        parents: ["crown"],
    }),
    "Houses/Crown.md": affiliation("crown", "The Crown", "polity", { domains: ["rgn"] }),
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
/*  The site build writes the three lists                                 */
/* ---------------------------------------------------------------------- */

describe("the site build writes `contains`, `held_by` and `holdings`", () => {
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
            "homepage.md": "---\ntype: homepage\nshortcode: root\ntitle: The Demo\n---\n\nHome.\n",
        });
        const config = defineConfig({
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
        });
        const result = buildSite({ config });
        expect(gatesFailed(result.gates)).toBe(false);
        expect(result.wikiErrors).toEqual([]);
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it("lists on a region every place whose `parents` names it, by subType then title", () => {
        expect(published("kb/place-rgn.md").contains).toEqual([river, ham, mill]);
        expect(published("kb/place-far.md").contains).toEqual([manor]);
    });

    it("lists on a house every place its `domains` names, across two regions", () => {
        expect(published("kb/affiliation-house.md").holdings).toEqual([ham, manor]);
    });

    it("names on a manor the house that holds it", () => {
        expect(published("kb/place-manor.md").held_by).toEqual([house]);
        expect(published("kb/place-ham.md").held_by).toEqual([house]);
    });

    it("never expands `domains`: the polity holding the region holds nothing within it", () => {
        expect(published("kb/affiliation-crown.md").holdings).toEqual([rgn]);
        expect(published("kb/place-rgn.md").held_by).toEqual([crown]);
        expect(published("kb/place-ham.md").held_by).toEqual([house]);
        expect(published("kb/place-mill.md")).not.toHaveProperty("held_by");
    });

    it("shapes every entry as `{ title, url, type, subType }`", () => {
        const page = published("kb/affiliation-house.md") as { holdings: object[] };
        for (const e of page.holdings) {
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
        expect(published("kb/place-manor.md")).not.toHaveProperty("holdings");
        expect(published("kb/affiliation-house.md")).not.toHaveProperty("contains");
        expect(published("kb/affiliation-house.md")).not.toHaveProperty("held_by");
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
    const node = (
        shortcode: string,
        type: "place" | "affiliation",
        subType: string,
        {
            parents = [],
            domains = [],
            url = `/demo/${type}-${shortcode}/`,
            title = shortcode,
        }: { parents?: string[]; domains?: string[]; url?: string; title?: string } = {},
    ) => ({ shortcode, type, subType, title, url, parents, domains });

    it("sorts `contains` and `holdings` by subType then title, and `held_by` by title", () => {
        const pages = holdingsPages([
            node("r", "place", "region", { title: "R" }),
            node("b", "place", "settlement", { parents: ["r"], title: "B" }),
            node("a", "place", "settlement", { parents: ["r"], title: "A" }),
            node("f", "place", "feature", { parents: ["r"], title: "Z" }),
            node("y", "affiliation", "polity", { domains: ["r"], title: "Y" }),
            node("x", "affiliation", "lineage", { domains: ["r", "b", "a"], title: "X" }),
        ]);
        expect(pages.get("/demo/place-r/")?.contains.map((e) => e.title)).toEqual(["Z", "A", "B"]);
        expect(pages.get("/demo/place-r/")?.held_by.map((e) => e.title)).toEqual(["X", "Y"]);
        expect(pages.get("/demo/affiliation-x/")?.holdings.map((e) => e.title)).toEqual([
            "R",
            "A",
            "B",
        ]);
    });

    it("reads a parent or a domain written as a bare shortcode, an address or a wikilink", () => {
        const pages = holdingsPages([
            node("r", "place", "region"),
            node("a", "place", "settlement", { parents: ["r"] }),
            node("b", "place", "settlement", { parents: ["place-r"] }),
            node("c", "place", "settlement", { parents: ["[[place-r|The Region]]"] }),
            node("x", "affiliation", "polity", { domains: ["R", "[[place-a]]", "place-b"] }),
        ]);
        expect(pages.get("/demo/place-r/")?.contains.map((e) => e.title)).toEqual(["a", "b", "c"]);
        expect(pages.get("/demo/affiliation-x/")?.holdings.map((e) => e.title)).toEqual([
            "r",
            "a",
            "b",
        ]);
    });

    it("lists a place once however many times one note names it, and a name nothing declares not at all", () => {
        const pages = holdingsPages([
            node("r", "place", "region"),
            node("x", "affiliation", "polity", { domains: ["r", "r", "nowhere"] }),
        ]);
        expect(pages.get("/demo/affiliation-x/")?.holdings.map((e) => e.title)).toEqual(["r"]);
        expect(pages.get("/demo/place-r/")?.held_by.map((e) => e.title)).toEqual(["x"]);
    });

    // A URL gates where a list is *written*, never whether a node may appear
    // in someone else's. A stub is a place somebody has not written yet, and
    // it belongs in its region's `contains` whether or not it has a page.
    it("lists a node with no page, as an entry with no url", () => {
        const pages = holdingsPages([
            node("r", "place", "region"),
            node("a", "place", "settlement", { parents: ["r"], url: "" }),
            node("lone", "place", "site"),
        ]);
        expect(pages.get("/demo/place-r/")?.contains).toEqual([
            { title: "a", type: "place", subType: "settlement" },
        ]);
        // No page to write a list on, and nothing on any list.
        expect(pages.has("")).toBe(false);
        expect(pages.has("/demo/place-lone/")).toBe(false);
        expect(pages.size).toBe(1);
    });

    it("names a holder with no page on what it holds, and writes it no list of its own", () => {
        const pages = holdingsPages([
            node("r", "place", "region"),
            node("x", "affiliation", "polity", { domains: ["r"], url: "" }),
        ]);
        expect(pages.get("/demo/place-r/")?.held_by).toEqual([
            { title: "x", type: "affiliation", subType: "polity" },
        ]);
        expect(pages.size).toBe(1);
    });

    it("keeps the first node declaring a shortcode, so a local note shadows a fetched one", () => {
        const pages = holdingsPages([
            node("r", "place", "region", { title: "Mine" }),
            node("r", "place", "region", { title: "Theirs", url: "/other/place-r/" }),
            node("x", "affiliation", "polity", { domains: ["r"] }),
        ]);
        expect(pages.get("/demo/affiliation-x/")?.holdings.map((e) => e.title)).toEqual(["Mine"]);
        expect(pages.has("/other/place-r/")).toBe(false);
    });

    it("omits `subType` from an entry whose note has none", () => {
        const pages = holdingsPages([
            { ...node("r", "place", "region"), subType: undefined },
            node("x", "affiliation", "polity", { domains: ["r"] }),
        ]);
        expect(pages.get("/demo/affiliation-x/")?.holdings).toEqual([
            { title: "r", url: "/demo/place-r/", type: "place" },
        ]);
    });
});

describe("holdingsNode", () => {
    it("reads a place or an affiliation, and nothing else", () => {
        expect(
            holdingsNode(
                { type: "place", subType: "region", shortcode: "R", data: { parents: ["w"] } },
                { title: "R", url: "/demo/place-r/" },
            ),
        ).toEqual({
            shortcode: "r",
            type: "place",
            subType: "region",
            title: "R",
            url: "/demo/place-r/",
            parents: ["w"],
            domains: [],
        });
        expect(
            holdingsNode(
                { type: "affiliation", subType: "polity", shortcode: "x", data: { domains: "r" } },
                { title: "X", url: "/demo/affiliation-x/" },
            )?.domains,
        ).toEqual(["r"]);
        expect(holdingsNode({ type: "lore", shortcode: "l" }, { title: "L", url: "/l/" })).toBe(
            null,
        );
        expect(holdingsNode({ type: "place" }, { title: "L", url: "/l/" })).toBe(null);
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
            data: { parents: ["rgn"] },
            address: { slug: "place-abroad", canonical: "thalorna-none-place-abroad" },
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
    it("carries an affiliation's `domains` through the fetched index", () => {
        const { config, cache } = foreignCache();
        try {
            const { index } = loadForeignIndexes(config as never, ["demo"]);
            expect(index.get("thalorna-sohl-affiliation-empire")?.domains).toEqual([
                "mill",
                "abroad",
            ]);
            expect(index.get("thalorna-none-place-abroad")?.parents).toEqual(["rgn"]);
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
                        data: { parents: ["rgn"] },
                    },
                    { title: "Mill", url: mill.url },
                )!,
                ...foreignHoldingsNodes(index),
            ]);
            expect(pages.get(rgn.url)?.contains).toEqual([abroad, mill]);
            expect(pages.get(mill.url)?.held_by).toEqual([empire]);
            expect(pages.get(empire.url)?.holdings).toEqual([abroad, mill]);
        } finally {
            fs.rmSync(cache, { recursive: true, force: true });
        }
    });
});

/* ---------------------------------------------------------------------- */
/*  The lint reports unheld land                                          */
/* ---------------------------------------------------------------------- */

type Finding = { file: string; line?: number; column?: number; severity: string; message: string };

/** Lint a tree and keep the tenure findings. */
function lintTenure(
    files: Record<string, string>,
    config?: Record<string, unknown>,
): { findings: Finding[]; root: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-holdings-lint-"));
    const base = writeTree(root, files);
    const index = buildLinkIndex(base, { skipDirectories: [], ...(config ? { config } : {}) });
    const { findings } = lintFrontmatter(index, {
        schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS } as never,
        vocabulary: NOTE_VOCABULARY,
    });
    return {
        root,
        findings: (findings as Finding[]).filter((f) => f.message.includes("unheld land")),
    };
}

describe("`content-build lint` reports unheld land", () => {
    it("warns once, at the `type:` line of the settlement no `domains` names", () => {
        const { findings, root } = lintTenure(FIXTURE);
        try {
            expect(findings).toHaveLength(1);
            const [f] = findings;
            expect(f.file).toBe(path.join(root, "assets/content/Regions/Mill.md"));
            expect(f.severity).toBe("warning");
            expect(f.line).toBe(2);
            expect(f.column).toBe(1);
            expect(f.message).toMatch(/^unheld land/);
            expect(f.message).toContain('"mill"');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("exempts a region and a feature, and holds a site and a structure to it", () => {
        const { findings, root } = lintTenure({
            "Rgn.md": place("rgn", "Rgn", "region"),
            "World.md": place("wld", "Wld", "world"),
            "River.md": place("river", "River", "feature", { parents: ["rgn"] }),
            "Henge.md": place("henge", "Henge", "site", { parents: ["rgn"] }),
            "Keep.md": place("keep", "Keep", "structure", { parents: ["rgn"] }),
        });
        try {
            expect(findings.map((f) => path.basename(f.file)).sort()).toEqual([
                "Henge.md",
                "Keep.md",
            ]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("counts a dependency's `domains` as tenure", () => {
        const { config, cache } = foreignCache();
        const { findings, root } = lintTenure(
            {
                "Rgn.md": place("rgn", "Rgn", "region"),
                "Mill.md": place("mill", "Mill", "settlement", { parents: ["rgn"] }),
                "Ham.md": place("ham", "Ham", "settlement", { parents: ["rgn"] }),
            },
            config as Record<string, unknown>,
        );
        try {
            expect(findings.map((f) => path.basename(f.file))).toEqual(["Ham.md"]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
            fs.rmSync(cache, { recursive: true, force: true });
        }
    });

    it("runs as part of the check the place vocabulary declares", () => {
        // A type declares one whole-note check, and `place` asks two questions
        // — who holds this land, and what a body states about itself — so the
        // declaration composes them rather than either swallowing the other.
        const unheld = {
            file: "Ham.md",
            raw: "---\ntype: place\nsubType: settlement\nshortcode: ham\n---\n",
            fm: { type: "place", subType: "settlement", shortcode: "ham" },
            type: "place",
        };
        const index = { notes: [unheld] };
        expect(NOTE_VOCABULARY.place.check?.(unheld, { index })).toEqual(
            checkHeld(unheld, { index }),
        );
        expect(checkHeld(unheld, { index })).toHaveLength(1);
    });
});
