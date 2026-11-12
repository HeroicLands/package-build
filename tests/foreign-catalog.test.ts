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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClassicLevel } from "classic-level";
import { zipSync } from "fflate";

import {
    pinnedManifestUrl,
    itemCatalogRelationships,
    foreignItemCatalogDirs,
    fetchCatalogFromPath,
    fetchCatalog,
    itemPackManifest,
    fetchAllMetadata,
    fetchAllCatalogs,
} from "../engine/foreign-catalog.mjs";
import { defineConfig } from "../index.mjs";
import { Actors } from "../sohl/actors.mjs";

const LATEST =
    "https://github.com/HeroicLands/Song-of-Heroic-Lands-FoundryVTT/releases/latest/download/system.json";

describe("pinning a dependency's manifest", () => {
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

    it("retains the build mirror without publishing it to Foundry", async () => {
        const { publishedRelationships } = await import("../manifest.mjs");
        const config = withRelationships({
            systems: [
                {
                    id: "sohl",
                    manifest: LATEST,
                    buildManifest: "https://forge.test/v1/system.json",
                    compatibility: { verified: "1" },
                    itemCatalog: true,
                },
            ],
        });
        expect(itemCatalogRelationships(config)[0].buildManifest).toBe(
            "https://forge.test/v1/system.json",
        );
        expect(publishedRelationships(config.relationships).systems[0]).not.toHaveProperty(
            "buildManifest",
        );
        expect(() =>
            withRelationships({
                systems: [
                    {
                        id: "sohl",
                        manifest: LATEST,
                        buildManifest: "https://forge.test/system.json",
                    },
                ],
            }),
        ).toThrow(/verified/);
    });

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

describe("declaring a relationship as a Foundry dependency only", () => {
    /** A config carrying the given relationships block. */
    const withRelationships = (relationships: unknown) =>
        defineConfig({
            rootDir: "/repo",
            contentPackage: "modpkg",
            foundryPackage: "modpkg",
            packageKind: "modules",
            stats: {
                lastModifiedBy: "sohlbuilder00000",
            },
            packs: [{ name: "items", type: "Item" }],
            compatibility: { minimum: "14.359", verified: "14.359" },
            relationships,
        } as never);

    // A module that `requires` thalorna so Foundry installs the base module,
    // and its content tree links nowhere — there is nothing for `deps fetch`
    // to fetch and no index to resolve a wikilink against.
    it("accepts `contentIndex: false` on its own", () => {
        const config = withRelationships({
            requires: [{ id: "thalorna", manifest: LATEST, contentIndex: false }],
        });
        expect(config.relationships.requires[0].contentIndex).toBe(false);
    });

    it("defaults to true, so an ordinary dependency is unaffected", () => {
        const config = withRelationships({ requires: [{ id: "thalorna", manifest: LATEST }] });
        expect(config.relationships.requires[0].contentIndex).toBeUndefined();
    });

    it("refuses a non-boolean", () => {
        expect(() =>
            withRelationships({
                requires: [{ id: "thalorna", manifest: LATEST, contentIndex: "no" }],
            }),
        ).toThrow(/true or false/);
    });

    // A catalogue is fetched from the same index `contentIndex: false` says
    // there is none of, so the two cannot be declared on one relationship.
    it("refuses `itemCatalog: true` on the same entry", () => {
        expect(() =>
            withRelationships({
                requires: [
                    { id: "thalorna", manifest: LATEST, itemCatalog: true, contentIndex: false },
                ],
            }),
        ).toThrow(/itemCatalog: true/);
    });

    it("lists `contentIndex` among the recognised relationship keys", () => {
        // Asserted against the key list a real unrecognised-key error reports,
        // not against hand-typed message text — so a renamed or removed key
        // fails this rather than going unnoticed.
        expect(() =>
            withRelationships({ requires: [{ id: "thalorna", __unrecognised__: true }] }),
        ).toThrow(/contentIndex/);
    });

    describe("`deps fetch` fetches nothing for it", () => {
        let root: string;

        beforeEach(() => {
            root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-no-index-"));
        });
        afterEach(() => {
            fs.rmSync(root, { recursive: true, force: true });
        });

        it("succeeds with no cache directory for it", async () => {
            const config = withRelationships({
                requires: [{ id: "thalorna", manifest: LATEST, contentIndex: false }],
            });
            const withPaths = {
                ...config,
                paths: { metadataCache: path.join(root, "metadata"), foreignCache: root },
            };
            await expect(fetchAllMetadata(withPaths)).resolves.toBe(0);
            await expect(fetchAllCatalogs(withPaths)).resolves.toBe(0);
            expect(fs.existsSync(path.join(root, "metadata"))).toBe(false);
            expect(fs.readdirSync(root)).toEqual([]);
        });
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

    /**
     * A complete cache: the extracted packs, what each one is, and the stamp.
     *
     * `packs` names each pack and the system it was published for, as the
     * dependency's own manifest declared it; `null` is a pack that
     * declares none.
     */
    const cache = (version: string, packs: Record<string, string | null>) => {
        const dir = path.join(root, `sohl@${version}`);
        for (const name of Object.keys(packs)) {
            fs.mkdirSync(path.join(dir, "items", name), { recursive: true });
        }
        // Written through the producer rather than hand-shaped, so these cases
        // read what a fetch actually writes.
        fs.writeFileSync(
            path.join(dir, "item-packs.json"),
            JSON.stringify(
                itemPackManifest(
                    Object.entries(packs).map(([name, system]) => ({
                        name,
                        type: "Item",
                        ...(system === null ? {} : { system }),
                    })),
                ),
            ),
        );
        fs.writeFileSync(path.join(dir, ".complete"), `${version}\n`);
        return dir;
    };

    it("fails on a cold cache, naming the command that fills it", () => {
        // A compile must never reach the network: a build that downloads
        // silently is not reproducible and fails strangely offline.
        expect(() => foreignItemCatalogDirs(config(root))).toThrow(/package-build deps fetch/);
    });

    it("ignores a half-finished fetch", () => {
        // No stamp: the fetch died partway, and a partial catalogue would
        // resolve some addresses and fail others for no visible reason.
        fs.mkdirSync(path.join(root, "sohl@0.8.2", "items", "items"), {
            recursive: true,
        });
        expect(() => foreignItemCatalogDirs(config(root))).toThrow(/deps fetch/);
    });

    it("records a pack declaring no system as neutral rather than dropping it", () => {
        // Foundry requires `system` on an Item pack, so this is a malformed
        // manifest rather than a case with a meaning — and a neutral pack is
        // read by every system rather than by none, which is the safe way to
        // be wrong about it.
        expect(
            itemPackManifest([
                { name: "items-hm3", type: "Item", system: "hm3" },
                { name: "odd", type: "Item" },
            ]),
        ).toEqual([
            { name: "items-hm3", system: "hm3" },
            { name: "odd", system: null },
        ]);
    });

    it("refuses a cache that does not say what its packs are", () => {
        // Stamped, but written before the pack manifest existed. Reading every
        // pack would resolve an `hm3` reference against a `sohl` document, and
        // reading none would fail a build that worked — so it is incomplete,
        // and the command that refills it is the one already named.
        const dir = path.join(root, "sohl@0.8.2");
        fs.mkdirSync(path.join(dir, "items", "items"), { recursive: true });
        fs.writeFileSync(path.join(dir, ".complete"), "0.8.2\n");
        expect(() => foreignItemCatalogDirs(config(root))).toThrow(/deps fetch/);
    });

    it("reads only the asked-for system's packs, and the neutral ones", () => {
        // `skill:awar` is a real address in both vocabularies and means two
        // different documents. The local half of the catalogue is already
        // scoped by pack system; unscoped here, this dependency would answer
        // an `hm3` lookup with whatever its `sohl` pack holds.
        const dir = cache("0.8.2", {
            "items-sohl": "sohl",
            "items-hm3": "hm3",
            "items-shared": null,
        });
        expect(
            foreignItemCatalogDirs(config(root), "hm3")
                .map((e) => e.dir)
                .sort(),
        ).toEqual([path.join(dir, "items", "items-hm3"), path.join(dir, "items", "items-shared")]);
    });

    it("reads every pack when no system is asked for, which is every single-system build", () => {
        const dir = cache("0.8.2", { "items-sohl": "sohl", "items-hm3": "hm3" });
        expect(
            foreignItemCatalogDirs(config(root))
                .map((e) => e.dir)
                .sort(),
        ).toEqual([path.join(dir, "items", "items-hm3"), path.join(dir, "items", "items-sohl")]);
    });

    it("returns each extracted pack directory of a complete cache", () => {
        const dir = cache("0.8.2", { items: "sohl", extras: "sohl" });
        // Each entry carries the package that published it: a being's
        // `model:` names the package its template comes from, and that cannot
        // be recovered from the path.
        expect(
            foreignItemCatalogDirs(config(root))
                .map((e) => e.dir)
                .sort(),
        ).toEqual([path.join(dir, "items", "extras"), path.join(dir, "items", "items")]);
        expect(foreignItemCatalogDirs(config(root)).map((e) => e.package)).toEqual([
            "sohl",
            "sohl",
        ]);
    });

    it("uses the newest cached version when several are present", () => {
        for (const v of ["0.8.1", "0.8.2"]) cache(v, { items: "sohl" });
        expect(foreignItemCatalogDirs(config(root)).map((e) => e.dir)).toEqual([
            path.join(root, "sohl@0.8.2", "items", "items"),
        ]);
    });

    it("compares version segments numerically, so 0.8.10 beats 0.8.2", () => {
        // A plain string sort puts `0.8.10` before `0.8.2`, and the build
        // would then resolve its embedded item references against the older
        // catalogue with nothing to report it: both caches are complete and
        // stamped, and the wrong one is a perfectly valid catalogue.
        for (const v of ["0.8.2", "0.8.10"]) cache(v, { items: "sohl" });
        expect(foreignItemCatalogDirs(config(root)).map((e) => e.dir)).toEqual([
            path.join(root, "sohl@0.8.10", "items", "items"),
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
            skipDirectories: [],
            contentBase: path.join(dir, "content"),
            dest: path.join(dir, "out"),
            itemsSourceDirs: [path.join(dir, "items")],
            foreignSourceDirs: [path.join(dir, "foreign")],
        });
        expect(compiler.foreignSourceDirs).toEqual([path.join(dir, "foreign")]);
    });

    it("defaults to none, so a repository needing no catalogue is unaffected", () => {
        const compiler = new Actors({
            skipDirectories: [],
            contentBase: path.join(dir, "content"),
            dest: path.join(dir, "out"),
            itemsSourceDirs: [path.join(dir, "items")],
        });
        expect(compiler.foreignSourceDirs).toEqual([]);
    });
});

describe("dependency download retries", () => {
    let root: string;
    const rel = { id: "example", manifest: "https://example.test/manifest", verified: "1" };
    const manifest = { version: "1", download: "https://example.test/archive" };
    const response = (status: number) => new Response("", { status, statusText: "failure" });

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-retry-"));
        vi.useFakeTimers();
        vi.spyOn(Math, "random").mockReturnValue(0);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        fs.rmSync(root, { recursive: true, force: true });
    });
    const run = () => fetchCatalog({ paths: { foreignCache: root } }, rel);
    const settle = async (promise: Promise<unknown>) => {
        const result = promise.then(
            () => undefined,
            (error) => error,
        );
        await vi.runAllTimersAsync();
        return result;
    };

    it("recovers transient failures and publishes a complete catalogue", async () => {
        vi.useRealTimers();
        const pack = path.join(root, "fixture-pack");
        const db = new ClassicLevel(pack);
        await db.open();
        await db.close();
        const files: Record<string, Uint8Array> = {};
        for (const file of fs.readdirSync(pack)) {
            files[`packs/items/${file}`] = fs.readFileSync(path.join(pack, file));
        }
        const archive = zipSync(files);
        vi.useFakeTimers();
        const cancel = vi.fn().mockResolvedValue(undefined);
        const transient = { ok: false, status: 503, statusText: "failure", body: { cancel } };
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(transient)
            .mockResolvedValueOnce(
                Response.json({
                    ...manifest,
                    packs: [{ name: "items", type: "Item", path: "packs/items" }],
                }),
            )
            .mockResolvedValueOnce(transient)
            .mockResolvedValueOnce({
                ok: true,
                arrayBuffer: () => Promise.reject(new Error("body")),
            })
            .mockResolvedValueOnce(new Response(archive));
        vi.stubGlobal("fetch", fetcher);
        const result = run();
        await vi.runAllTimersAsync();
        vi.useRealTimers();
        const dir = await result;
        expect(fetcher).toHaveBeenCalledTimes(5);
        expect(cancel).toHaveBeenCalledTimes(2);
        expect(dir).toBe(path.join(root, "example@1"));
        expect(fs.existsSync(path.join(dir, ".complete"))).toBe(true);
        expect(fs.existsSync(path.join(dir, "items", "items"))).toBe(true);
    });

    it("reports the final server response after bounded attempts", async () => {
        const fetcher = vi.fn().mockResolvedValue(response(504));
        vi.stubGlobal("fetch", fetcher);
        const error = await settle(run());
        expect(fetcher).toHaveBeenCalledTimes(5);
        expect(String(error)).toContain("HTTP 504 failure");
    });

    it("does not retry a client error", async () => {
        const fetcher = vi.fn().mockResolvedValue(response(404));
        vi.stubGlobal("fetch", fetcher);
        const error = await settle(run());
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(String(error)).toContain("HTTP 404 failure");
    });

    it("retries archive server errors but stops at a client error", async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(Response.json(manifest))
            .mockResolvedValueOnce(response(503))
            .mockResolvedValueOnce(response(404));
        vi.stubGlobal("fetch", fetcher);
        const error = await settle(run());
        expect(fetcher).toHaveBeenCalledTimes(3);
        expect(String(error)).toContain("HTTP 404 failure");
        expect(fs.existsSync(path.join(root, "example@1", ".complete"))).toBe(false);
    });

    it("backs off exponentially between attempts", async () => {
        const times: number[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(() => {
                times.push(Date.now());
                return Promise.resolve(response(503));
            }),
        );
        await settle(run());
        expect(times.map((time) => time - times[0])).toEqual([0, 1000, 3000, 7000, 15000]);
    });

    it("adds bounded jitter to each backoff", async () => {
        vi.mocked(Math.random).mockReturnValue(0.5);
        const times: number[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(() => {
                times.push(Date.now());
                return Promise.resolve(response(503));
            }),
        );
        await settle(run());
        expect(times.map((time) => time - times[0])).toEqual([0, 1125, 3250, 7375, 15500]);
    });

    it("times out hanging requests and preserves the final abort cause", async () => {
        const causes: Error[] = [];
        const fetcher = vi.fn(
            (_url, { signal }) =>
                new Promise((_resolve, reject) => {
                    signal.addEventListener("abort", () => {
                        const cause = new Error("request aborted");
                        causes.push(cause);
                        reject(cause);
                    });
                }),
        );
        vi.stubGlobal("fetch", fetcher);
        const start = Date.now();
        const error = await settle(run());
        expect(fetcher).toHaveBeenCalledTimes(5);
        expect(Date.now() - start).toBe(315000);
        expect(error.cause).toBe(causes[4]);
        expect(error.message).toContain(rel.manifest);
    });

    it("retries metadata server failures with the same timeout", async () => {
        const { fetchMetadata } = await import("../engine/foreign-catalog.mjs");
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(
                Response.json({
                    version: "1",
                    flags: { metadataUrl: "https://example.test/index.jsonl" },
                }),
            )
            .mockResolvedValue(response(503));
        vi.stubGlobal("fetch", fetcher);
        const error = await settle(fetchMetadata({ paths: { metadataCache: root } }, rel));
        expect(fetcher).toHaveBeenCalledTimes(6);
        expect(String(error)).toContain("index.jsonl: HTTP 503");
        expect(fetcher.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
    });

    it("times out a hanging archive body read", async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(Response.json(manifest))
            .mockImplementation((_url, { signal }) =>
                Promise.resolve({
                    ok: true,
                    arrayBuffer: () =>
                        new Promise((_resolve, reject) => {
                            signal.addEventListener("abort", () =>
                                reject(new Error("body aborted")),
                            );
                        }),
                }),
            );
        vi.stubGlobal("fetch", fetcher);
        const error = await settle(run());
        expect(fetcher).toHaveBeenCalledTimes(6);
        expect(error.cause.message).toBe("body aborted");
        expect(error.message).toContain(`${manifest.download}: body aborted`);
        expect(fs.existsSync(path.join(root, "example@1", ".complete"))).toBe(false);
    });

    it("retains the final network error and leaves no complete cache", async () => {
        const cause = new Error("last connection failed");
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(Response.json(manifest))
            .mockRejectedValue(cause);
        vi.stubGlobal("fetch", fetcher);
        const error = await settle(run());
        expect(fetcher).toHaveBeenCalledTimes(6);
        expect(error.cause).toBe(cause);
        expect(error.message).toContain(`${manifest.download}: ${cause.message}`);
        expect(fs.existsSync(path.join(root, "example@1", ".complete"))).toBe(false);
    });
});

describe("mirrored dependency releases", () => {
    it("keeps asset names within the original release directory", async () => {
        const { mirroredAssetUrl } = await import("../engine/foreign-catalog.mjs");
        const original = "https://public.test/releases/v1/system.json";
        const mirror = "https://forge.test/releases/v1/system.json";
        expect(
            mirroredAssetUrl("https://public.test/releases/v1/system.zip", original, mirror),
        ).toBe("https://forge.test/releases/v1/system.zip");
        for (const asset of [
            "https://other.test/releases/v1/system.zip",
            "https://public.test/releases/v2/system.zip",
            "https://public.test/releases/v1/nested/system.zip",
            "https://public.test/releases/v1/%2fsecret",
            "https://public.test/releases/v1/system.zip?token=x",
        ])
            expect(() => mirroredAssetUrl(asset, original, mirror)).toThrow(/not beside/);
    });

    it("fetches exact metadata bytes from the mirror and reports a missing asset", async () => {
        const http = await import("node:http");
        const { fetchMetadata } = await import("../engine/foreign-catalog.mjs");
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-"));
        const bytes = Buffer.from([0, 255, 10, 65]);
        const pack = path.join(root, "source-pack");
        const db = new ClassicLevel(pack);
        await db.open();
        await db.close();
        const entries: Record<string, Uint8Array> = {};
        for (const name of fs.readdirSync(pack))
            entries[`packs/items/${name}`] = fs.readFileSync(path.join(pack, name));
        const archive = zipSync(entries);
        const requests: string[] = [];
        const token = (await import("node:crypto")).randomBytes(32).toString("hex");
        const tokenFile = path.join(root, "token");
        fs.writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
        vi.stubEnv("PACKAGE_BUILD_FORGE_TOKEN_FILE", tokenFile);
        let authorized = true;
        let missing = false;
        const server = http.createServer((req, res) => {
            authorized &&= req.headers.authorization === `token ${token}`;
            requests.push(req.url!);
            if (req.url === "/mirror/system.json") {
                res.end(
                    JSON.stringify({
                        version: "1",
                        download: "https://public.test/release/system.zip",
                        packs: [{ name: "items", type: "Item", path: "packs/items" }],
                        flags: { metadataUrl: "https://public.test/release/index.jsonl" },
                    }),
                );
            } else if (!missing && req.url === "/mirror/index.jsonl") res.end(bytes);
            else if (!missing && req.url === "/mirror/system.zip") res.end(archive);
            else {
                res.statusCode = 404;
                res.end("missing");
            }
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        try {
            const address = server.address();
            if (!address || typeof address === "string") throw new Error("server address missing");
            const rel = {
                id: "example",
                manifest: "https://public.test/release/system.json",
                buildManifest: `http://127.0.0.1:${address.port}/mirror/system.json`,
                verified: "1",
            };
            const config = { paths: { metadataCache: root } };
            const file = await fetchMetadata(config, rel);
            expect(fs.readFileSync(file)).toEqual(bytes);
            expect(requests).toEqual(["/mirror/system.json", "/mirror/index.jsonl"]);
            const catalog = await fetchCatalog(
                { paths: { foreignCache: path.join(root, "catalog") } },
                rel,
            );
            expect(fs.existsSync(path.join(catalog, ".complete"))).toBe(true);
            expect(requests.slice(-2)).toEqual(["/mirror/system.json", "/mirror/system.zip"]);
            expect(authorized).toBe(true);
            missing = true;
            await expect(
                fetchMetadata({ paths: { metadataCache: path.join(root, "cold") } }, rel),
            ).rejects.toThrow(/index\.jsonl: HTTP 404/);
        } finally {
            await new Promise<void>((resolve, reject) =>
                server.close((err) => (err ? reject(err) : resolve())),
            );
            vi.unstubAllEnvs();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
    it("refuses a token on non-loopback HTTP before any request", async () => {
        const { fetchMetadata } = await import("../engine/foreign-catalog.mjs");
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-transport-"));
        const tokenFile = path.join(root, "token");
        fs.writeFileSync(tokenFile, (await import("node:crypto")).randomBytes(32).toString("hex"));
        vi.stubEnv("PACKAGE_BUILD_FORGE_TOKEN_FILE", tokenFile);
        const fetcher = vi.fn();
        vi.stubGlobal("fetch", fetcher);
        try {
            await expect(
                fetchMetadata(
                    { paths: { metadataCache: root } },
                    {
                        id: "example",
                        manifest: "https://public.test/system.json",
                        buildManifest: "http://mirror.test/system.json",
                        verified: "1",
                    },
                ),
            ).rejects.toThrow(/example.*PACKAGE_BUILD_FORGE_TOKEN_FILE.*HTTPS/);
            expect(fetcher).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
            vi.unstubAllEnvs();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("refuses cross-origin redirects without sending the token", async () => {
        const http = await import("node:http");
        const { fetchMetadata } = await import("../engine/foreign-catalog.mjs");
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-auth-"));
        const token = (await import("node:crypto")).randomBytes(32).toString("hex");
        const tokenFile = path.join(root, "token");
        fs.writeFileSync(tokenFile, token, { mode: 0o600 });
        vi.stubEnv("PACKAGE_BUILD_FORGE_TOKEN_FILE", tokenFile);
        let received = false;
        const other = http.createServer((_req, res) => {
            received = true;
            res.end();
        });
        await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
        const otherAddress = other.address();
        if (!otherAddress || typeof otherAddress === "string")
            throw new Error("server address missing");
        const server = http.createServer((_req, res) => {
            res.writeHead(302, { location: `http://127.0.0.1:${otherAddress.port}/elsewhere` });
            res.end();
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        try {
            const address = server.address();
            if (!address || typeof address === "string") throw new Error("server address missing");
            const rel = {
                id: "example",
                manifest: "https://public.test/release/system.json",
                buildManifest: `http://127.0.0.1:${address.port}/system.json`,
                verified: "1",
            };
            const config = { paths: { metadataCache: root } };
            await expect(fetchMetadata(config, rel)).rejects.toThrow(/mirror redirect refused/);
            expect(received).toBe(false);
            fs.writeFileSync(tokenFile, `${token}\nsecond`);
            await expect(fetchMetadata(config, rel)).rejects.toThrow(/one non-empty token/);
            fs.writeFileSync(tokenFile, "");
            await expect(fetchMetadata(config, rel)).rejects.toThrow(/one non-empty token/);
            vi.stubEnv("PACKAGE_BUILD_FORGE_TOKEN_FILE", path.join(root, "missing"));
            await expect(fetchMetadata(config, rel)).rejects.toThrow(
                /example.*token file named by PACKAGE_BUILD_FORGE_TOKEN_FILE could not be read/,
            );
        } finally {
            await Promise.all(
                [server, other].map(
                    (srv) =>
                        new Promise<void>((resolve, reject) =>
                            srv.close((err) => (err ? reject(err) : resolve())),
                        ),
                ),
            );
            vi.unstubAllEnvs();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
    it("reports mirror authentication and parse failures without response text", async () => {
        const { fetchMetadata } = await import("../engine/foreign-catalog.mjs");
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-errors-"));
        const token = (await import("node:crypto")).randomBytes(32).toString("hex");
        const tokenFile = path.join(root, "token");
        fs.writeFileSync(tokenFile, token);
        vi.stubEnv("PACKAGE_BUILD_FORGE_TOKEN_FILE", tokenFile);
        const rel = {
            id: "example",
            manifest: "https://public.test/release/system.json",
            buildManifest: "https://mirror.test/release/system.json",
            verified: "1",
        };
        const config = { paths: { metadataCache: root } };
        try {
            const fetcher = vi
                .fn()
                .mockResolvedValueOnce(new Response(token, { status: 401, statusText: token }))
                .mockResolvedValueOnce(new Response(token, { status: 200 }))
                .mockResolvedValueOnce(new Response("", { status: 404 }));
            vi.stubGlobal("fetch", fetcher);
            for (const expected of [/HTTP 401/, /invalid JSON/, /HTTP 404/]) {
                const error = await fetchMetadata(config, rel).then(
                    () => "unexpected success",
                    (err) => String(err),
                );
                expect(error).toMatch(expected);
                expect(error).toContain("example");
                if (expected.source.includes("401"))
                    expect(error).toContain("PACKAGE_BUILD_FORGE_TOKEN_FILE");
                expect(error.includes(token)).toBe(false);
                expect(error).toContain(rel.buildManifest);
            }
            vi.stubEnv("PACKAGE_BUILD_FORGE_TOKEN_FILE", "");
            vi.stubGlobal(
                "fetch",
                vi.fn().mockResolvedValue(
                    new Response("secret response", {
                        status: 404,
                        statusText: "secret response",
                    }),
                ),
            );
            const missing = await fetchMetadata(config, rel).then(
                () => "unexpected success",
                (err) => String(err),
            );
            expect(missing).toMatch(/example.*HTTP 404.*PACKAGE_BUILD_FORGE_TOKEN_FILE/);
            expect(missing).not.toContain("secret response");
            const publicFetch = vi.fn().mockResolvedValue(Response.json({ version: "1" }));
            vi.stubGlobal("fetch", publicFetch);
            await expect(
                fetchMetadata(config, { id: rel.id, manifest: rel.manifest, verified: "1" }),
            ).rejects.toThrow(/metadataUrl/);
            expect(publicFetch.mock.calls[0][1].headers).toBeUndefined();
        } finally {
            vi.unstubAllGlobals();
            vi.unstubAllEnvs();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
    it("follows same-origin redirects and bounds redirect loops", async () => {
        const { fetchMetadata } = await import("../engine/foreign-catalog.mjs");
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-redirect-"));
        const token = (await import("node:crypto")).randomBytes(32).toString("hex");
        const tokenFile = path.join(root, "token");
        fs.writeFileSync(tokenFile, token);
        vi.stubEnv("PACKAGE_BUILD_FORGE_TOKEN_FILE", tokenFile);
        const rel = {
            id: "example",
            manifest: "https://public.test/release/system.json",
            buildManifest: "https://mirror.test/release/system.json",
            verified: "1",
        };
        const config = { paths: { metadataCache: root } };
        try {
            const redirect = () =>
                new Response(null, { status: 302, headers: { location: "/next" } });
            const fetcher = vi
                .fn()
                .mockResolvedValueOnce(redirect())
                .mockResolvedValueOnce(Response.json({ version: "1" }));
            vi.stubGlobal("fetch", fetcher);
            await expect(fetchMetadata(config, rel)).rejects.toThrow(/metadataUrl/);
            expect(fetcher).toHaveBeenCalledTimes(2);
            expect(
                fetcher.mock.calls.every(
                    ([, options]) => options.headers.Authorization === `token ${token}`,
                ),
            ).toBe(true);
            const downgrade = vi.fn().mockResolvedValue(
                new Response(null, {
                    status: 302,
                    headers: { location: "http://mirror.test/release/system.json" },
                }),
            );
            vi.stubGlobal("fetch", downgrade);
            await expect(fetchMetadata(config, rel)).rejects.toThrow(/mirror redirect refused/);
            expect(downgrade).toHaveBeenCalledTimes(1);
            const loop = vi.fn().mockImplementation(async () => redirect());
            vi.stubGlobal("fetch", loop);
            await expect(fetchMetadata(config, rel)).rejects.toThrow(/mirror redirect refused/);
            expect(loop).toHaveBeenCalledTimes(11);
        } finally {
            vi.unstubAllGlobals();
            vi.unstubAllEnvs();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
    it("rejects decoded credential echoes before fields or cache paths are used", async () => {
        const { fetchMetadata } = await import("../engine/foreign-catalog.mjs");
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-echo-"));
        const token = (await import("node:crypto")).randomBytes(32).toString("hex");
        const tokenFile = path.join(root, "private");
        const cache = path.join(root, "cache");
        fs.writeFileSync(tokenFile, token);
        vi.stubEnv("PACKAGE_BUILD_FORGE_TOKEN_FILE", tokenFile);
        const captured: string[] = [];
        for (const name of ["log", "info", "warn", "error"] as const) {
            vi.spyOn(console, name).mockImplementation((...args) =>
                captured.push(args.map(String).join(" ")),
            );
        }
        const rel = {
            id: "example",
            manifest: "https://public.test/release/system.json",
            buildManifest: "https://mirror.test/release/system.json",
            verified: "1",
        };
        const config = { paths: { metadataCache: cache, foreignCache: cache } };
        try {
            const inputs = [
                { version: token },
                { version: "1", flags: { metadataUrl: `https://public.test/release/${token}` } },
                { version: "1", download: `https://public.test/release/${token}` },
                { version: "1", flags: { [token]: "value" } },
            ];
            for (const input of inputs) {
                const escaped = JSON.stringify(input).replace(
                    token,
                    `\\u${token.charCodeAt(0).toString(16).padStart(4, "0")}${token.slice(1)}`,
                );
                vi.stubGlobal(
                    "fetch",
                    vi.fn().mockImplementation(async () => new Response(escaped)),
                );
                for (const action of [fetchMetadata, fetchCatalog]) {
                    const error = await action(config, rel).then(
                        () => "unexpected success",
                        (err) => String(err),
                    );
                    expect(error).toContain("credential in response");
                    expect(error.includes(token)).toBe(false);
                    expect(fs.existsSync(cache)).toBe(false);
                }
            }
            expect(captured.join(" ").includes(token)).toBe(false);
        } finally {
            vi.restoreAllMocks();
            vi.unstubAllGlobals();
            vi.unstubAllEnvs();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("retries a network failure after an authenticated redirect", async () => {
        const { fetchMetadata } = await import("../engine/foreign-catalog.mjs");
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-retry-"));
        const tokenFile = path.join(root, "private");
        fs.writeFileSync(tokenFile, (await import("node:crypto")).randomBytes(32).toString("hex"));
        vi.stubEnv("PACKAGE_BUILD_FORGE_TOKEN_FILE", tokenFile);
        vi.useFakeTimers();
        const rel = {
            id: "example",
            manifest: "https://public.test/release/system.json",
            buildManifest: "https://mirror.test/release/system.json",
            verified: "1",
        };
        try {
            const redirect = new Response(null, { status: 302, headers: { location: "/next" } });
            const fetcher = vi
                .fn()
                .mockResolvedValueOnce(redirect)
                .mockRejectedValueOnce(new Error("network"))
                .mockResolvedValueOnce(
                    Response.json({
                        version: "1",
                        flags: { metadataUrl: "https://public.test/release/index.jsonl" },
                    }),
                )
                .mockResolvedValueOnce(new Response("index"));
            vi.stubGlobal("fetch", fetcher);
            const result = fetchMetadata({ paths: { metadataCache: root } }, rel);
            await vi.runAllTimersAsync();
            expect(fs.readFileSync(await result, "utf8")).toBe("index");
            expect(fetcher).toHaveBeenCalledTimes(4);
        } finally {
            vi.useRealTimers();
            vi.unstubAllGlobals();
            vi.unstubAllEnvs();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
