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
    pinnedManifestUrl,
    itemCatalogRelationships,
    foreignItemCatalogDirs,
    fetchCatalogFromPath,
} from "../engine/foreign-catalog.mjs";
import { defineConfig } from "../index.mjs";
import { Actors } from "../sohl/actors.mjs";

const LATEST =
    "https://github.com/HeroicLands/Song-of-Heroic-Lands-FoundryVTT/releases/latest/download/system.json";

describe("pinning a dependency's manifest (#82)", () => {
    /*
     * A consumer publishes `releases/latest/…` because that is the right thing
     * for Foundry to follow. It is the wrong thing to *build* against: the
     * artifact behind it changes when somebody else cuts a release, so the
     * build names no particular dependency.
     */
    it("rewrites a floating latest URL to the declared verified version", () => {
        const { url, pinned } = pinnedManifestUrl(LATEST, "0.8.2");
        expect(pinned).toBe(true);
        expect(url).toBe(
            "https://github.com/HeroicLands/Song-of-Heroic-Lands-FoundryVTT/releases/download/v0.8.2/system.json",
        );
    });

    it("does not double the v prefix when the version carries one", () => {
        expect(pinnedManifestUrl(LATEST, "v0.8.2").url).toContain("/download/v0.8.2/");
        expect(pinnedManifestUrl(LATEST, "v0.8.2").url).not.toContain("vv");
    });

    it("leaves a URL it cannot rewrite alone, and says so", () => {
        // Reported rather than rewritten: `fetchCatalog` checks the version it
        // gets back instead, so an unpinnable URL still cannot float silently.
        const out = pinnedManifestUrl("https://example.invalid/m.json", "1.0.0");
        expect(out).toEqual({
            url: "https://example.invalid/m.json",
            pinned: false,
        });
    });

    it("cannot pin without a declared version", () => {
        expect(pinnedManifestUrl(LATEST, undefined).pinned).toBe(false);
    });
});

describe("which relationships supply an item catalogue", () => {
    /** A config carrying the given relationships block. */
    const withRelationships = (relationships: unknown) =>
        defineConfig({
            rootDir: "/repo",
            contentPackage: "thalorna",
            foundryPackage: "thalorna",
            packageKind: "modules",
            stats: {
                lastModifiedBy: "sohlbuilder00000",
            },
            packs: [{ name: "items", type: "Item" }],
            compatibility: { minimum: "14.359", verified: "14.359" },
            relationships,
        } as never);

    it("takes only the relationships that opted in", () => {
        const config = withRelationships({
            systems: [
                { id: "sohl", manifest: LATEST, itemCatalog: true },
                { id: "other", manifest: LATEST },
            ],
        });
        expect(itemCatalogRelationships(config).map((r) => r.id)).toEqual(["sohl"]);
    });

    it("walks every kind, not just systems", () => {
        // "and some other modules" — a module may supply items too, and
        // rebuilding this for `requires` later is the failure worth avoiding.
        const config = withRelationships({
            systems: [{ id: "sohl", manifest: LATEST, itemCatalog: true }],
            requires: [{ id: "kethira", manifest: LATEST, itemCatalog: true }],
        });
        expect(
            itemCatalogRelationships(config)
                .map((r) => r.id)
                .sort(),
        ).toEqual(["kethira", "sohl"]);
    });

    it("carries the verified version through, so the fetch can pin", () => {
        const config = withRelationships({
            systems: [
                {
                    id: "sohl",
                    manifest: LATEST,
                    itemCatalog: true,
                    compatibility: { minimum: "0.8.0", verified: "0.8.2" },
                },
            ],
        });
        expect(itemCatalogRelationships(config)[0]?.verified).toBe("0.8.2");
    });

    it("refuses `itemCatalog: true` with nothing to fetch", () => {
        expect(() => withRelationships({ systems: [{ id: "sohl", itemCatalog: true }] })).toThrow(
            /manifest/,
        );
    });

    it("refuses a non-boolean", () => {
        expect(() =>
            withRelationships({
                systems: [{ id: "sohl", manifest: LATEST, itemCatalog: "yes" }],
            }),
        ).toThrow(/true or false/);
    });
});

describe("reading the catalogue cache", () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-foreign-"));
    });
    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    const config = (cache: string) => ({
        paths: { foreignCache: cache },
        relationships: {
            systems: [{ id: "sohl", manifest: LATEST, itemCatalog: true }],
        },
    });

    it("fails on a cold cache, naming the command that fills it", () => {
        // A compile must never reach the network: a build that downloads
        // silently is not reproducible and fails strangely offline.
        expect(() => foreignItemCatalogDirs(config(root))).toThrow(/content-build deps fetch/);
    });

    it("ignores a half-finished fetch", () => {
        // No stamp: the fetch died partway, and a partial catalogue would
        // resolve some addresses and fail others for no visible reason.
        fs.mkdirSync(path.join(root, "sohl@0.8.2", "items", "items"), {
            recursive: true,
        });
        expect(() => foreignItemCatalogDirs(config(root))).toThrow(/deps fetch/);
    });

    it("returns each extracted pack directory of a complete cache", () => {
        const dir = path.join(root, "sohl@0.8.2");
        fs.mkdirSync(path.join(dir, "items", "items"), { recursive: true });
        fs.mkdirSync(path.join(dir, "items", "extras"), { recursive: true });
        fs.writeFileSync(path.join(dir, ".complete"), "0.8.2\n");
        expect(foreignItemCatalogDirs(config(root)).sort()).toEqual([
            path.join(dir, "items", "extras"),
            path.join(dir, "items", "items"),
        ]);
    });

    it("uses the newest cached version when several are present", () => {
        for (const v of ["0.8.1", "0.8.2"]) {
            const dir = path.join(root, `sohl@${v}`);
            fs.mkdirSync(path.join(dir, "items", "items"), { recursive: true });
            fs.writeFileSync(path.join(dir, ".complete"), `${v}\n`);
        }
        expect(foreignItemCatalogDirs(config(root))).toEqual([
            path.join(root, "sohl@0.8.2", "items", "items"),
        ]);
    });

    it("asks for nothing when no relationship opted in", () => {
        expect(
            foreignItemCatalogDirs({
                paths: { foreignCache: root },
                relationships: { systems: [{ id: "sohl", manifest: LATEST }] },
            }),
        ).toEqual([]);
    });
});

describe("filling the cache from a local build (not a release)", () => {
    /*
     * The point of this route: change the system, build it, and see the effect
     * on every consumer before any of it is released. Without it, testing a
     * dependency change against its consumers costs a release round-trip, which
     * turns releasing into a debugging tool rather than a publishing decision.
     */
    let root: string;
    let src: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-local-"));
        src = fs.mkdtempSync(path.join(os.tmpdir(), "cb-src-"));
    });
    afterEach(() => {
        for (const d of [root, src]) fs.rmSync(d, { recursive: true, force: true });
    });

    const config = () => ({ paths: { foreignCache: root } });
    const rel = { id: "sohl", manifest: "unused" };

    it("refuses a path that does not exist", async () => {
        await expect(fetchCatalogFromPath(config(), rel, path.join(src, "nope"))).rejects.toThrow(
            /nothing at/,
        );
    });

    it("refuses a directory holding no manifest", async () => {
        // Without one there is no version to key the cache by and no pack list
        // to extract, so there is nothing to do but say so.
        await expect(fetchCatalogFromPath(config(), rel, src)).rejects.toThrow(
            /system.json or module.json/,
        );
    });

    it("refuses an artifact of a different package", async () => {
        // Pointing --from at the wrong build would otherwise cache one
        // package's items under another's name, and resolve nonsense.
        fs.writeFileSync(
            path.join(src, "system.json"),
            JSON.stringify({ id: "kethira", version: "1.0.0", packs: [] }),
        );
        await expect(fetchCatalogFromPath(config(), rel, src)).rejects.toThrow(
            /is package "kethira", not "sohl"/,
        );
    });

    it("refuses an artifact declaring no version", async () => {
        fs.writeFileSync(path.join(src, "system.json"), JSON.stringify({ id: "sohl", packs: [] }));
        await expect(fetchCatalogFromPath(config(), rel, src)).rejects.toThrow(
            /declares no `version`/,
        );
    });

    it("refuses an artifact shipping no Item packs", async () => {
        fs.writeFileSync(
            path.join(src, "system.json"),
            JSON.stringify({
                id: "sohl",
                version: "0.9.0",
                packs: [
                    {
                        name: "journals",
                        type: "JournalEntry",
                        path: "packs/journals",
                    },
                ],
            }),
        );
        await expect(fetchCatalogFromPath(config(), rel, src)).rejects.toThrow(
            /declares no Item packs/,
        );
    });

    it("finds a manifest nested one level down, as a zip lays it out", async () => {
        // A package zip commonly wraps everything in one directory; the error
        // proves the manifest was found and read, not that the walk gave up.
        const inner = path.join(src, "sohl");
        fs.mkdirSync(inner);
        fs.writeFileSync(
            path.join(inner, "system.json"),
            JSON.stringify({ id: "sohl", version: "0.9.0", packs: [] }),
        );
        await expect(fetchCatalogFromPath(config(), rel, src)).rejects.toThrow(
            /0.9.0: its manifest declares no Item packs/,
        );
    });
});

describe("the catalogue actually reaches the actors pass", () => {
    /*
     * The wiring, not the module. Every other test here exercises
     * `foreign-catalog.mjs` in isolation, and all of them passed while the
     * feature did nothing at all: the compiler destructured
     * `foreignSourceDirs` and never assigned it, so the catalogue was silently
     * dropped and thalorna still reported 26,220 unresolved items. A feature
     * that is wired up wrong looks exactly like a feature that is switched off.
     */
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-wiring-"));
        fs.mkdirSync(path.join(dir, "content"));
        fs.mkdirSync(path.join(dir, "items"));
        fs.mkdirSync(path.join(dir, "foreign"));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("keeps the foreign directories it was constructed with", () => {
        const compiler = new Actors({
            contentBase: path.join(dir, "content"),
            dest: path.join(dir, "out"),
            itemsSourceDirs: [path.join(dir, "items")],
            foreignSourceDirs: [path.join(dir, "foreign")],
        });
        expect(compiler.foreignSourceDirs).toEqual([path.join(dir, "foreign")]);
    });

    it("defaults to none, so a repository needing no catalogue is unaffected", () => {
        const compiler = new Actors({
            contentBase: path.join(dir, "content"),
            dest: path.join(dir, "out"),
            itemsSourceDirs: [path.join(dir, "items")],
        });
        expect(compiler.foreignSourceDirs).toEqual([]);
    });
});
