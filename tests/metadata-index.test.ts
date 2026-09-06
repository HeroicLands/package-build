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

    // The whole point of #239's dependency set: `itemCatalog` says a dependency
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

describe("where a dependency's index is cached", () => {
    it("is keyed by version, so a bump is a miss rather than an overwrite", () => {
        const config = { paths: { metadataCache: "/repo/build/cache/metadata" } } as never;
        expect(metadataCacheDir(config, "sohl", "0.8.2")).toBe(
            path.join("/repo/build/cache/metadata", "sohl@0.8.2"),
        );
    });
});
