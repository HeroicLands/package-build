/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    metadataFileName,
    metadataRelationships,
    metadataCacheDir,
    cachedMetadataFiles,
    loadForeignIndexes,
    newestVersionDir,
} from "../engine/metadata-index.mjs";

const LATEST = "https://github.com/HeroicLands/sohl/releases/latest/download/system.json";

describe("naming the published index", () => {
    it("is the content package's name, suffixed", () => {
        expect(metadataFileName("sohl")).toBe("sohl-metadata.jsonl");
        expect(metadataFileName("thalorna")).toBe("thalorna-metadata.jsonl");
    });
});

describe("which dependencies an index is fetched for", () => {
    const withRelationships = (relationships: unknown) => ({ relationships }) as never;

    // The whole point of the dependency set: `itemCatalog` says a dependency
    // supplies *items*, which is a different edge from citing its *addresses*.
    // `harn-ensemble` cites no address and references 324,016 items; a package
    // can equally cite addresses and need no items. Gating the index on the
    // catalogue flag would serve neither.
    it("takes every declared dependency, flagged or not", () => {
        const config = withRelationships({
            systems: [
                { id: "sohl", manifest: LATEST, itemCatalog: true },
                { id: "hm3", manifest: LATEST },
            ],
        });
        expect(metadataRelationships(config).map((r) => r.id)).toEqual(["sohl", "hm3"]);
    });

    it("covers modules as well as systems", () => {
        const config = withRelationships({
            systems: [{ id: "sohl", manifest: LATEST }],
            requires: [{ id: "thalorna", manifest: LATEST }],
        });
        expect(
            metadataRelationships(config)
                .map((r) => r.id)
                .sort(),
        ).toEqual(["sohl", "thalorna"]);
    });

    // You may cite what you depend on. `recommends` and `conflicts` are not
    // dependencies — a build that resolved through them would emit a link into
    // a package it does not require, which is a defect in the citing note.
    it("ignores kinds that are not dependencies", () => {
        const config = withRelationships({
            systems: [{ id: "sohl", manifest: LATEST }],
            recommends: [{ id: "nice-to-have", manifest: LATEST }],
            conflicts: [{ id: "rival", manifest: LATEST }],
        });
        expect(metadataRelationships(config).map((r) => r.id)).toEqual(["sohl"]);
    });

    it("carries the verified version through, so the fetch can pin", () => {
        const config = withRelationships({
            systems: [{ id: "sohl", manifest: LATEST, compatibility: { verified: "0.8.2" } }],
        });
        expect(metadataRelationships(config)[0].verified).toBe("0.8.2");
    });

    it("asks for nothing when a package depends on nothing", () => {
        // `sohl` is the base: a system depending on a module is backwards.
        expect(metadataRelationships({ relationships: {} } as never)).toEqual([]);
        expect(metadataRelationships({} as never)).toEqual([]);
    });
});

describe("reading the metadata cache", () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-metadata-"));
    });
    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    const config = (cache: string) =>
        ({
            paths: { metadataCache: cache },
            relationships: { systems: [{ id: "sohl", manifest: LATEST }] },
        }) as never;

    /** A cached dependency, complete unless told otherwise. */
    function cache(id: string, version: string, body: string, { complete = true } = {}) {
        const dir = path.join(root, `${id}@${version}`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, metadataFileName(id)), body);
        if (complete) fs.writeFileSync(path.join(dir, ".complete"), "");
        return dir;
    }

    it("fails on a cold cache, naming the command that fills it", () => {
        // A compile must never reach the network: a build that downloads
        // silently is not reproducible and fails strangely offline.
        expect(() => cachedMetadataFiles(config(root))).toThrow(/content-build deps fetch/);
    });

    it("ignores a half-finished fetch", () => {
        // No stamp: a partial index resolves some addresses and fails others
        // for no visible reason, which is worse than resolving none.
        cache("sohl", "0.8.2", "{}\n", { complete: false });
        expect(() => cachedMetadataFiles(config(root))).toThrow(/content-build deps fetch/);
    });

    it("returns the cached index of a complete fetch", () => {
        cache("sohl", "0.8.2", '{"address":{"canonical":"sohl-none-doc-gear"}}\n');
        const files = cachedMetadataFiles(config(root));
        expect(files).toHaveLength(1);
        expect(path.basename(files[0])).toBe("sohl-metadata.jsonl");
    });

    it("uses the newest cached version when several are present", () => {
        cache("sohl", "0.8.2", "old\n");
        cache("sohl", "0.8.10", "new\n");
        const files = cachedMetadataFiles(config(root));
        expect(files).toHaveLength(1);
        expect(fs.readFileSync(files[0], "utf8")).toBe("new\n");
    });

    it("asks for nothing when a package depends on nothing", () => {
        expect(
            cachedMetadataFiles({ paths: { metadataCache: root }, relationships: {} } as never),
        ).toEqual([]);
    });
});

describe("choosing the newest of several cached versions", () => {
    /*
     * Shared by both version-keyed caches under `build/cache` — the content
     * index here and the item catalogue in `foreign-catalog.mjs`. Written
     * twice it was got wrong once: the catalogue sorted the directory names as
     * strings, which reports nothing, because every cached version is a
     * complete, stamped, valid artifact and the older one resolves fine.
     */
    const dirs = (...versions: string[]) => versions.map((v) => `/repo/build/cache/sohl@${v}`);

    it("compares segments numerically, not as strings", () => {
        // The bug: `"0.8.10" < "0.8.2"` as strings.
        expect(newestVersionDir(dirs("0.8.2", "0.8.10"))).toBe("/repo/build/cache/sohl@0.8.10");
        expect(newestVersionDir(dirs("0.8.10", "0.8.2"))).toBe("/repo/build/cache/sohl@0.8.10");
    });

    it("compares every segment that way, not only the last", () => {
        expect(newestVersionDir(dirs("0.9.0", "0.10.0"))).toBe("/repo/build/cache/sohl@0.10.0");
        expect(newestVersionDir(dirs("2.0.0", "10.0.0"))).toBe("/repo/build/cache/sohl@10.0.0");
    });

    it("orders more than two, whatever order they are listed in", () => {
        expect(newestVersionDir(dirs("0.8.10", "0.8.9", "0.8.2", "0.8.11"))).toBe(
            "/repo/build/cache/sohl@0.8.11",
        );
    });

    it("returns the only one when a single version is cached", () => {
        expect(newestVersionDir(dirs("0.8.2"))).toBe("/repo/build/cache/sohl@0.8.2");
    });
});

describe("where a dependency's index is cached", () => {
    it("is keyed by version, so a bump is a miss rather than an overwrite", () => {
        const config = { paths: { metadataCache: "/repo/build/cache/metadata" } } as never;
        expect(metadataCacheDir(config, "sohl", "0.8.2")).toBe(
            path.join("/repo/build/cache/metadata", "sohl@0.8.2"),
        );
    });
});

describe("resolving foreign addresses from cached indexes", () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-foreign-idx-"));
    });
    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    /** One record per line, as the emitted index is. */
    function cacheIndex(id: string, version: string, records: unknown[]) {
        const dir = path.join(root, `${id}@${version}`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            path.join(dir, metadataFileName(id)),
            records.map((r) => JSON.stringify(r)).join("\n") + "\n",
        );
        fs.writeFileSync(path.join(dir, ".complete"), "");
    }

    const config = () =>
        ({
            paths: { metadataCache: root },
            relationships: { systems: [{ id: "thalorna", manifest: LATEST }] },
        }) as never;

    const record = (over: Record<string, unknown> = {}) => ({
        package: "thalorna",
        type: "affiliation",
        shortcode: "aerarimmpr",
        name: { full: "The Aerarium Imperii" },
        address: {
            slug: "affiliation-aerarimmpr",
            canonical: "thalorna-none-affiliation-aerarimmpr",
        },
        anchors: [],
        foundry: null,
        documentation: null,
        ...over,
    });

    it("keys every record by its canonical address", () => {
        cacheIndex("thalorna", "0.1.0", [record()]);
        const { index } = loadForeignIndexes(config(), ["sohl"]);
        expect([...index.keys()]).toEqual(["thalorna-none-affiliation-aerarimmpr"]);
    });

    // The bug that killed the vendored manifest: SoHL's committed copy held
    // 2,101 entries whose address was the old name-derived form, so every link
    // it rendered resolved at build time and 404'd for the reader. A URL
    // derived from the fetched address cannot drift from what the producer
    // publishes.
    it("derives the page URL from the address and the package base", () => {
        cacheIndex("thalorna", "0.1.0", [record()]);
        const { index } = loadForeignIndexes(config(), ["sohl"]);
        expect(index.get("thalorna-none-affiliation-aerarimmpr")!.url).toBe(
            "/thalorna/affiliation-aerarimmpr/",
        );
    });

    it("carries the name and the type a consumer renders with", () => {
        cacheIndex("thalorna", "0.1.0", [record()]);
        const entry = loadForeignIndexes(config(), ["sohl"]).index.get(
            "thalorna-none-affiliation-aerarimmpr",
        )!;
        expect(entry.name).toBe("The Aerarium Imperii");
        expect(entry.type).toBe("affiliation");
        expect(entry.package).toBe("thalorna");
    });

    // A note compiling into two systems' documents holds a block per system,
    // and the key's own system segment says which one this address names.
    it("takes the uuid of the system the address names", () => {
        cacheIndex("thalorna", "0.1.0", [
            record({
                type: "being",
                shortcode: "grod",
                address: { slug: "being-grod", canonical: "thalorna-sohl-being-grod" },
                foundry: {
                    sohl: { uuid: "Compendium.thalorna.actors-sohl.Actor.aaa" },
                    hm3: { uuid: "Compendium.thalorna.actors-hm3.Actor.bbb" },
                },
            }),
        ]);
        const entry = loadForeignIndexes(config(), ["sohl"]).index.get("thalorna-sohl-being-grod")!;
        expect(entry.uuid).toBe("Compendium.thalorna.actors-sohl.Actor.aaa");
    });

    // A package is authoritative in its own addresses and never resolves them
    // through a fetched index — which is also what stops a cycle forming.
    it("ignores a cached index for a package this build publishes", () => {
        cacheIndex("thalorna", "0.1.0", [record()]);
        const { index, packages } = loadForeignIndexes(config(), ["thalorna"]);
        expect(index.size).toBe(0);
        expect(packages.has("thalorna")).toBe(false);
    });

    it("reports an unreadable line rather than failing the load", () => {
        const dir = path.join(root, "thalorna@0.1.0");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, metadataFileName("thalorna")), "{ not json\n");
        fs.writeFileSync(path.join(dir, ".complete"), "");
        const { index, stale } = loadForeignIndexes(config(), ["sohl"]);
        expect(index.size).toBe(0);
        expect(stale[0].package).toBe("thalorna");
    });

    // A pack-only dependency — Foundry addresses and no site, which `kethira`
    // is by licensing — has no base and must stay citable by UUID. Demanding
    // one would make its documents unaddressable from anywhere, which is worse
    // than rendering the prose unlinked.
    it("still resolves a package it has no base for, without a URL", () => {
        cacheIndex("thalorna", "0.1.0", [
            record({ foundry: { none: { uuid: "Compendium.x.items.Item.aaa" } } }),
        ]);
        const { index, stale } = loadForeignIndexes(config(), ["sohl"], {});
        const entry = index.get("thalorna-none-affiliation-aerarimmpr")!;
        expect(stale).toEqual([]);
        expect(entry.url).toBeUndefined();
        expect(entry.uuid).toBe("Compendium.x.items.Item.aaa");
    });

    it("skips a record with no address at all", () => {
        cacheIndex("thalorna", "0.1.0", [record({ address: null })]);
        expect(loadForeignIndexes(config(), ["sohl"]).index.size).toBe(0);
    });
});
