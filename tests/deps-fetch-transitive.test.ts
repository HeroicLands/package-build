/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **`deps fetch` acquires the content index of every module reachable through
 * the requirement edges a fetched package publishes**, so an item a note names
 * in a module reached only through another module resolves from an empty cache
 * with no declaration beyond the direct requirement. A game system is never
 * followed.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
    collectContentIndex,
    indexRecordsFor,
    serializeContentIndex,
} from "../engine/content-index.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { fetchAllMetadata, fetchMetadata } from "../engine/foreign-catalog.mjs";
import { metadataFileName } from "../engine/metadata-index.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const HOST = "https://example.invalid";
const manifestUrl = (id: string) => `${HOST}/${id}/module.json`;
const indexUrl = (id: string) => `${HOST}/${id}/${metadataFileName(id)}`;

let root: string;
let counter = 0;

function write(file: string, text: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

const noteText = (fm: object) => `---\n${YAML.stringify(fm)}---\n\nProse that fills the page.\n`;

const rope = {
    type: "miscgear",
    shortcode: "rope",
    name: { full: "rope" },
    data: { kind: "miscgear" },
};
const lore = { type: "lore", subType: "law", shortcode: "oath", name: { full: "Oath" } };

/** What a package publishes: its notes, the modules it requires, and its manifest's edges. */
interface Published {
    notes: object[];
    modules: string[];
    edges: Array<{ id: string; type: string }>;
}

/** A published package graph: modone -> modtwo -> sohl, with modtwo -> modone closing a cycle. */
const graph: Record<string, Published> = {
    modone: {
        notes: [lore],
        modules: ["modtwo"],
        edges: [
            { id: "modtwo", type: "module" },
            { id: "sohl", type: "system" },
        ],
    },
    modtwo: {
        notes: [rope],
        modules: ["modone", "sohl"],
        edges: [
            { id: "modone", type: "module" },
            { id: "sohl", type: "system" },
        ],
    },
    sohl: { notes: [lore], modules: ["viasystem"], edges: [{ id: "viasystem", type: "module" }] },
    viasystem: { notes: [rope], modules: [], edges: [] },
};

/** The response body a URL serves, or undefined for an unknown one. */
function serve(url: string): BodyInit | undefined {
    for (const [id, pkg] of Object.entries(graph)) {
        if (url === manifestUrl(id)) {
            return JSON.stringify({
                id,
                version: "1.0.0",
                flags: { metadataUrl: indexUrl(id) },
                relationships: {
                    requires: pkg.edges.map((edge) => ({
                        ...edge,
                        manifest: manifestUrl(edge.id),
                    })),
                },
            });
        }
        if (url === indexUrl(id)) {
            const tree = path.join(root, "published", id);
            pkg.notes.forEach((fm, at) => write(path.join(tree, `${at}.md`), noteText(fm)));
            return serializeContentIndex(
                collectContentIndex(tree, {
                    contentPackage: id,
                    skipDirectories: [],
                    requiredModules: pkg.modules,
                }),
            );
        }
    }
    return undefined;
}

/** Stub `fetch` with the graph and record the URLs requested. */
function stubFetch() {
    const requested: string[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
            requested.push(url);
            const body = serve(url);
            return body === undefined ?
                    new Response("missing", { status: 404, statusText: "missing" })
                :   new Response(body);
        }),
    );
    return requested;
}

/** A package requiring `modone` and declaring only `sohl` beside it. */
function demoConfig(dir: string) {
    return configFromData(
        {
            contentPackage: "demo",
            packageKind: "modules",
            compatibility: { minimum: "14", verified: "14.367" },
            stats: { lastModifiedBy: "itementries00000" },
            packs: [{ name: "journals", type: "JournalEntry", default: true }],
            relationships: {
                systems: [
                    {
                        id: "sohl",
                        manifest: manifestUrl("sohl"),
                        compatibility: { minimum: "0.8.2", verified: "1.0.0" },
                    },
                ],
                requires: [{ id: "modone", manifest: manifestUrl("modone"), type: "module" }],
            },
        },
        path.join(dir, "package-build.config.yaml"),
    );
}

/** The `model` findings from linting a being that lists `address`. */
function modelFindings(config: ReturnType<typeof configFromData>, address: string) {
    const content = path.join(root, `tree-${(counter += 1)}`);
    write(
        path.join(content, "subject.md"),
        noteText({
            type: "being",
            subType: "creature",
            shortcode: "subject",
            name: { full: "Subject" },
            data: { items: [{ model: address }] },
        }),
    );
    const parsed = new Map();
    const records = indexRecordsFor({ contentBase: content, config, parsed });
    const index = buildLinkIndex(content, { config, records, parsed });
    const { findings } = lintFrontmatter(index, {
        schemas: NOTE_SCHEMAS,
        vocabulary: NOTE_VOCABULARY,
    });
    return findings.map((finding: any) => finding.message).filter((m: string) => /model/.test(m));
}

beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "deps-fetch-transitive-")));
});

afterEach(() => vi.unstubAllGlobals());
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("`deps fetch` follows required modules", () => {
    it("resolves a module's item after a fetch from an empty cache, with no declaration", async () => {
        const dir = path.join(root, "resolve");
        write(path.join(dir, "package.json"), JSON.stringify({ name: "demo", version: "1.0.0" }));
        const config = demoConfig(dir);
        stubFetch();
        await fetchAllMetadata(config);
        expect(modelFindings(config, "modtwo-note-miscgear-rope")).toEqual([]);
    });

    it("reports the remedy for an item of a module that is not fetched", async () => {
        const dir = path.join(root, "cold");
        write(path.join(dir, "package.json"), JSON.stringify({ name: "demo", version: "1.0.0" }));
        const config = demoConfig(dir);
        stubFetch();
        for (const id of ["modone", "sohl"]) {
            await fetchMetadata(config, { id, manifest: manifestUrl(id), verified: "1.0.0" });
        }
        const lines = modelFindings(config, "modtwo-note-miscgear-rope");
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/package-build deps fetch/);
    });

    it("never fetches a system reached through a module, and ends a cycle", async () => {
        const dir = path.join(root, "controls");
        write(path.join(dir, "package.json"), JSON.stringify({ name: "demo", version: "1.0.0" }));
        const requested = stubFetch();
        const count = await fetchAllMetadata(demoConfig(dir));
        // `sohl` is declared, so it is fetched once; `viasystem` is reachable only through it.
        expect(requested.filter((url) => url === manifestUrl("sohl"))).toHaveLength(1);
        expect(requested.some((url) => url.includes("viasystem"))).toBe(false);
        expect(requested.filter((url) => url === indexUrl("modone"))).toHaveLength(1);
        expect(requested.filter((url) => url === indexUrl("modtwo"))).toHaveLength(1);
        expect(count).toBe(3);
    });

    it("does not download an index that is already cached", async () => {
        const dir = path.join(root, "cached");
        write(path.join(dir, "package.json"), JSON.stringify({ name: "demo", version: "1.0.0" }));
        const config = demoConfig(dir);
        stubFetch();
        await fetchAllMetadata(config);
        const requested = stubFetch();
        await fetchAllMetadata(config);
        expect(requested.some((url) => url.endsWith("-metadata.jsonl"))).toBe(false);
    });
});
