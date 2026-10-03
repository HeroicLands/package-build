/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `assetArchive: true` is the sibling of `itemCatalog: true`: it makes
 * `deps fetch` unpack a dependency's release archive for its asset bytes
 * alone, building no item catalogue from it. Nothing here reaches the
 * network — `global.fetch` is stubbed throughout, and the "archive" is a
 * zip built in memory from a fixture.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { zipSync } from "fflate";
import { compilePack } from "@foundryvtt/foundryvtt-cli";

import { assetArchiveRelationships, fetchAllCatalogs } from "../engine/foreign-catalog.mjs";
import { defineConfig } from "../index.mjs";

const MANIFEST_URL = "https://example.test/thalornaaltart/module.json";
const DOWNLOAD_URL = "https://example.test/thalornaaltart/thalornaaltart.zip";

/** A config carrying the given relationships block. */
const withRelationships = (relationships: unknown) =>
    defineConfig({
        rootDir: "/repo",
        contentPackage: "thalornaaltart",
        foundryPackage: "thalornaaltart",
        packageKind: "modules",
        stats: { lastModifiedBy: "sohlbuilder00000" },
        packs: [{ name: "items", type: "Item" }],
        compatibility: { minimum: "14.359" },
        relationships,
    } as never);

describe("which relationships supply an asset archive", () => {
    it("takes only the relationships that opted in", () => {
        const config = withRelationships({
            requires: [
                { id: "thalornaaltart", manifest: MANIFEST_URL, assetArchive: true },
                { id: "other", manifest: MANIFEST_URL },
            ],
        });
        expect(assetArchiveRelationships(config).map((r) => r.id)).toEqual(["thalornaaltart"]);
    });

    it("accepts the flag as an optional boolean", () => {
        const config = withRelationships({
            requires: [{ id: "thalornaaltart", manifest: MANIFEST_URL }],
        });
        expect(config.relationships.requires[0].assetArchive).toBeUndefined();
    });

    it("refuses a non-boolean", () => {
        expect(() =>
            withRelationships({
                requires: [{ id: "thalornaaltart", manifest: MANIFEST_URL, assetArchive: "yes" }],
            }),
        ).toThrow(/must be true or false/);
    });

    it("refuses `assetArchive: true` with no `manifest`", () => {
        expect(() =>
            withRelationships({ requires: [{ id: "thalornaaltart", assetArchive: true }] }),
        ).toThrow(/needs a `manifest` naming the package to fetch/);
    });

    it("lists `assetArchive` among the recognised relationship keys", () => {
        expect(() =>
            withRelationships({ requires: [{ id: "thalornaaltart", __unrecognised__: true }] }),
        ).toThrow(/assetArchive/);
    });
});

describe("fetching an asset archive", () => {
    let root: string;
    let work: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-asset-archive-"));
        work = fs.mkdtempSync(path.join(os.tmpdir(), "cb-asset-archive-work-"));
    });
    afterEach(() => {
        for (const d of [root, work]) fs.rmSync(d, { recursive: true, force: true });
        vi.unstubAllGlobals();
    });

    /** A `fetch` stub answering exactly the two declared URLs. */
    const stubFetch = (manifest: object, archiveBytes: Uint8Array) => {
        const calls: string[] = [];
        const fn = vi.fn(async (url: string) => {
            calls.push(String(url));
            if (url === MANIFEST_URL) {
                return { ok: true, status: 200, statusText: "OK", json: async () => manifest };
            }
            if (url === DOWNLOAD_URL) {
                return {
                    ok: true,
                    status: 200,
                    statusText: "OK",
                    arrayBuffer: async () => archiveBytes.buffer,
                };
            }
            throw new Error(`unexpected fetch: ${url}`);
        });
        vi.stubGlobal("fetch", fn);
        return { fn, calls };
    };

    const config = (foreignCache: string, relationships: unknown) => ({
        paths: { foreignCache },
        relationships,
    });

    it("unpacks the archive and builds no item catalogue", async () => {
        const archive = zipSync({
            "assets/images/thing.webp": new TextEncoder().encode("fake-image-bytes"),
        });
        const { fn } = stubFetch({ version: "1.0.0", download: DOWNLOAD_URL }, archive);

        const count = await fetchAllCatalogs(
            config(root, {
                requires: [{ id: "thalornaaltart", manifest: MANIFEST_URL, assetArchive: true }],
            }),
        );

        expect(count).toBe(1);
        const dir = path.join(root, "thalornaaltart@1.0.0");
        expect(fs.existsSync(path.join(dir, "package", "assets/images/thing.webp"))).toBe(true);
        // No item catalogue: neither of the two files `extractItemPacks`
        // writes exists, and no `items` directory was created at all.
        expect(fs.existsSync(path.join(dir, "items"))).toBe(false);
        expect(fs.existsSync(path.join(dir, "item-packs.json"))).toBe(false);
        expect(fn.mock.calls.filter(([u]) => u === DOWNLOAD_URL)).toHaveLength(1);
    });

    it("fetches nothing for a relationship declaring neither flag", async () => {
        const { fn } = stubFetch({ version: "1.0.0", download: DOWNLOAD_URL }, zipSync({}));

        const count = await fetchAllCatalogs(
            config(root, { requires: [{ id: "thalornaaltart", manifest: MANIFEST_URL }] }),
        );

        expect(count).toBe(0);
        expect(fn).not.toHaveBeenCalled();
        expect(fs.readdirSync(root)).toEqual([]);
    });

    it("fetches a relationship declaring both flags exactly once", async () => {
        // A real Item pack, compiled the way `extractItemPacks` expects to
        // find one — this is what proves the catalogue half still runs when
        // `assetArchive: true` sits beside `itemCatalog: true`.
        const itemSrc = path.join(work, "item-src");
        fs.mkdirSync(itemSrc, { recursive: true });
        fs.writeFileSync(
            path.join(itemSrc, "Fixture_AAAAAAAAAAAAAAAA.json"),
            JSON.stringify({ _id: "AAAAAAAAAAAAAAAA", name: "Fixture Item", type: "object" }),
        );
        const itemStage = path.join(work, "items-pack");
        await compilePack(itemSrc, itemStage, { recursive: true, log: false });

        const files: Record<string, Uint8Array> = {
            "assets/images/thing.webp": new TextEncoder().encode("fake-image-bytes"),
        };
        for (const name of fs.readdirSync(itemStage)) {
            files[`items/${name}`] = fs.readFileSync(path.join(itemStage, name));
        }
        const archive = zipSync(files);

        const manifest = {
            version: "1.0.0",
            download: DOWNLOAD_URL,
            packs: [{ name: "items", type: "Item", path: "items" }],
        };
        const { fn } = stubFetch(manifest, archive);

        const count = await fetchAllCatalogs(
            config(root, {
                requires: [
                    {
                        id: "thalornaaltart",
                        manifest: MANIFEST_URL,
                        itemCatalog: true,
                        assetArchive: true,
                    },
                ],
            }),
        );

        expect(count).toBe(1);
        expect(fn.mock.calls.filter(([u]) => u === DOWNLOAD_URL)).toHaveLength(1);

        const dir = path.join(root, "thalornaaltart@1.0.0");
        // The catalogue half ran: the item pack and its manifest are there.
        expect(fs.existsSync(path.join(dir, "items", "items"))).toBe(true);
        expect(fs.existsSync(path.join(dir, "item-packs.json"))).toBe(true);
        // The archive half is satisfied by the same unpacked tree.
        expect(fs.existsSync(path.join(dir, "package", "assets/images/thing.webp"))).toBe(true);
    });
});
