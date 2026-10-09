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
import { loadForeignIndexes } from "../engine/metadata-index.mjs";
import { foreignWorksNodes, worksNode, worksPages } from "../engine/literature-works.mjs";
import { prepareTreeSqlTables } from "../engine/sql-tables.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";

const TYPES = new Set(Object.keys(NOTE_VOCABULARY));

/** A note of any type, with its `data` written as flow YAML lines. */
function note(
    type: string,
    subType: string | null,
    shortcode: string,
    name: string,
    data: string[] = [],
): string {
    return [
        "---",
        `type: ${type}`,
        ...(subType ? [`subType: ${subType}`] : []),
        `shortcode: ${shortcode}`,
        "name:",
        `    full: ${name}`,
        ...(data.length ? ["data:", ...data.map((line) => `    ${line}`)] : []),
        "---",
        "",
        "Prose.",
        "",
    ].join("\n");
}

/**
 * - `saga` (an epic) and `elegy` both name the hero; `saga` names it twice.
 * - `saga` names the mountain and itself; `chronicle` names the mountain.
 * - `ballad` is lore of another subtype carrying no `subjects`, so it lists nowhere.
 * - `quiet` is named by no work.
 */
const FIXTURE: Record<string, string> = {
    "People/Hero.md": note("being", "npc", "hero", "Skrildmyl", ["archetypes: [warrior]"]),
    "People/Quiet.md": note("being", "npc", "quiet", "Quiet One", ["archetypes: [warrior]"]),
    "Places/Mountain.md": note("place", "feature", "mountain", "Thrumufjall"),
    "Lore/Saga.md": note("lore", "literature", "saga", "Saga of Skrildmyl", [
        "form: epic",
        "subjects: [being-hero, place-mountain, being-hero, lore-saga]",
    ]),
    "Lore/Elegy.md": note("lore", "literature", "elegy", "An Elegy", ["subjects: [being-hero]"]),
    "Lore/Chronicle.md": note("lore", "literature", "chronicle", "Annals of the Pass", [
        "form: chronicle",
        "subjects: [place-mountain]",
    ]),
    "Lore/Ballad.md": note("lore", "history", "ballad", "The Ballad"),
    "homepage.md": "---\ntype: homepage\nshortcode: root\ntitle: The Demo\n---\n\nHome.\n",
};

describe("the site build sets In song and story on each subject's page", () => {
    let root: string;
    const published = (rel: string) =>
        matter(fs.readFileSync(path.join(root, "build/hugo/content", rel), "utf8"));

    /** A page's In song and story section, heading to the next heading. */
    const section = (rel: string): string => {
        const body = published(rel).content;
        const start = body.indexOf("{#insongandstory}");
        if (start < 0) return "";
        const from = body.lastIndexOf("\n# ", start) + 1;
        const next = body.indexOf("\n# ", start);
        return body.slice(from, next < 0 ? undefined : next).trim();
    };

    beforeAll(async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-works-"));
        fs.writeFileSync(
            path.join(root, "package.json"),
            JSON.stringify({ name: "sandbox", version: "1.0.0" }),
        );
        fs.mkdirSync(path.join(root, "build/cache/metadata"), { recursive: true });
        const base = path.join(root, "assets/content");
        for (const [rel, body] of Object.entries(FIXTURE)) {
            const abs = path.join(base, ...rel.split("/"));
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, body, "utf8");
        }
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
                { name: "actors", type: "Actor" },
            ],
        });
        const sqlTables = await prepareTreeSqlTables(config.paths.content, {
            config,
            skipDirectories: config.skipDirectories,
            audience: "public",
        });
        const result = buildSite({ config, sqlTables });
        expect(gatesFailed(result.gates)).toBe(false);
        expect(result.wikiErrors).toEqual([]);
    }, 60_000);

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it("lists every work naming a subject, once each, sorted by title, with its form", () => {
        expect(section("being-hero.md")).toBe(
            "# In song and story {#insongandstory}\n\n" +
                "- [An Elegy](/demo/lore-elegy/)\n" +
                "- [Saga of Skrildmyl](/demo/lore-saga/) (epic)",
        );
        expect(section("place-mountain.md")).toBe(
            "# In song and story {#insongandstory}\n\n" +
                "- [Annals of the Pass](/demo/lore-chronicle/) (chronicle)\n" +
                "- [Saga of Skrildmyl](/demo/lore-saga/) (epic)",
        );
    });

    it("writes nothing on a page no work names, nor on a work naming itself", () => {
        expect(section("being-quiet.md")).toBe("");
        expect(section("lore-saga.md")).toBe("");
        expect(section("lore-ballad.md")).toBe("");
    });

    it("writes no list into the front matter", () => {
        for (const rel of ["being-hero.md", "place-mountain.md"])
            expect(published(rel).data, rel).not.toHaveProperty("works");
    });
});

describe("a dependency's works list on this package's subject pages", () => {
    function foreignCache() {
        const cache = fs.mkdtempSync(path.join(os.tmpdir(), "cb-works-cache-"));
        const dir = path.join(cache, "thalorna@0.1.0");
        fs.mkdirSync(dir, { recursive: true });
        const records = [
            {
                package: "thalorna",
                type: "lore",
                subType: "literature",
                shortcode: "lay",
                name: { full: "The Northern Lay" },
                data: { form: "lay", subjects: ["demo-note-being-hero"] },
                address: { slug: "lore-lay", canonical: "thalorna-note-lore-lay" },
            },
            {
                package: "thalorna",
                type: "lore",
                subType: "history",
                shortcode: "annals",
                name: { full: "Annals" },
                data: {},
                address: { slug: "lore-annals", canonical: "thalorna-note-lore-annals" },
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

    it("carries a work's subjects and form in the fetched index, and nothing for other lore", () => {
        const { config, cache } = foreignCache();
        try {
            const { index } = loadForeignIndexes(config as never, ["demo"]);
            const lay = index.get("thalorna-note-lore-lay");
            expect(lay?.form).toBe("lay");
            expect(lay?.subjects).toHaveLength(1);
            expect(index.get("thalorna-note-lore-annals")).not.toHaveProperty("subjects");
        } finally {
            fs.rmSync(cache, { recursive: true, force: true });
        }
    });

    it("lists the fetched work on the local subject's page", () => {
        const { config, cache } = foreignCache();
        try {
            const { index } = loadForeignIndexes(config as never, ["demo"]);
            const hero = worksNode(
                { type: "being", subType: "npc", shortcode: "hero" },
                { title: "Skrildmyl", url: "/demo/being-hero/", package: "demo" },
            );
            const lists = worksPages([hero, ...foreignWorksNodes(index)], { types: TYPES });
            expect(lists.get("/demo/being-hero/")).toEqual({
                works: [
                    {
                        title: "The Northern Lay",
                        url: expect.stringContaining("lore-lay"),
                        address: "thalorna-note-lore-lay",
                        form: "lay",
                    },
                ],
            });
        } finally {
            fs.rmSync(cache, { recursive: true, force: true });
        }
    });

    it("lists a work that publishes no page as plain text", () => {
        const hero = worksNode(
            { type: "being", subType: "npc", shortcode: "hero" },
            { title: "Skrildmyl", url: "/demo/being-hero/", package: "demo" },
        );
        const stub = worksNode(
            {
                type: "lore",
                subType: "literature",
                shortcode: "draft",
                data: { subjects: ["being-hero"] },
            },
            { title: "A Draft Lay", package: "demo" },
        );
        expect(worksPages([hero, stub], { types: TYPES }).get("/demo/being-hero/")).toEqual({
            works: [{ title: "A Draft Lay", address: "demo-note-lore-draft" }],
        });
    });
});
