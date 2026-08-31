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

import { describe, it, expect } from "vitest";
import path from "node:path";
// The package's own entry point and configuration contract.
import { defineConfig } from "../index.mjs";
import type { ContentBuildConfigInput, PackSpec } from "../content-config.mjs";

/** The smallest configuration `defineConfig` accepts. */
function minimal(): ContentBuildConfigInput {
    return {
        rootDir: "/repo",
        contentPackage: "sohl",
        foundryPackage: "sohl",
        packageKind: "systems",
        stats: {
            lastModifiedBy: "sohlbuilder00000",
        },
        packs: [{ name: "items", type: "Item" }],
        compatibility: { minimum: "14.359", verified: "14.359" },
    };
}

describe("defineConfig", () => {
    it("returns a config carrying every field it was given", () => {
        const config = defineConfig({
            ...minimal(),
            packageBuild: {
                assets: [{ from: "assets/icons", to: "assets/icons" }],
            },
            publish: {
                site: "content",
                manifests: { publish: true, consume: false },
            },
        });

        expect(config.contentPackage).toBe("sohl");
        expect(config.foundryPackage).toBe("sohl");
        expect(config.packageKind).toBe("systems");
        // `label` defaults to the pack name and `private` to false; a pack
        // declares no folder file and no companion unless it has one, and is
        // not its type's declared default (a type with one pack needs no
        // declaration to have one — see `engine/pack-router.mjs`).
        expect(config.packs).toEqual([
            {
                name: "items",
                type: "Item",
                label: "items",
                private: false,
                folders: null,
                companions: [],
                mayBeEmpty: false,
                default: false,
                prebuilt: null,
                system: null,
            },
        ]);
        // Passed through uninterpreted: the shape is package-build's, and
        // this validator deliberately does not know it.
        expect(config.packageBuild).toEqual({
            assets: [{ from: "assets/icons", to: "assets/icons" }],
        });
        expect(config.publish).toEqual({
            site: "content",
            manifests: { publish: true, consume: false },
            address: { prefix: "", landing: "readme" },
        });
    });

    it("defaults the reserved section to empty, and publishing to the floor", () => {
        const config = defineConfig(minimal());

        expect(config.packageBuild).toEqual({});
        expect(config.publish).toEqual({
            site: "homepage",
            manifests: { publish: false, consume: false },
            address: { prefix: "", landing: "readme" },
        });
    });

    it("treats the three publishing switches as independent", () => {
        // `kethira` publishes a homepage and no other page, and no manifest at
        // all, while still consuming other packages' (#1385/#1446) — the shape
        // must express exactly that. The site mode and the manifest switches
        // answer different questions: the homepage is one row in a routing
        // table, and a link manifest is the dependency edge that would stop the
        // module being withdrawable (#55).
        const config = defineConfig({
            ...minimal(),
            publish: { manifests: { consume: true } },
        });

        expect(config.publish.site).toBe("homepage");
        expect(config.publish.manifests.publish).toBe(false);
        expect(config.publish.manifests.consume).toBe(true);
    });

    it("freezes the returned config, deeply", () => {
        const config = defineConfig(minimal());

        expect(Object.isFrozen(config)).toBe(true);
        expect(Object.isFrozen(config.publish)).toBe(true);
        expect(Object.isFrozen(config.publish.manifests)).toBe(true);
        expect(Object.isFrozen(config.packs)).toBe(true);
        expect(Object.isFrozen(config.packs[0])).toBe(true);
        expect(Object.isFrozen(config.packageBuild)).toBe(true);
    });

    it("copies the input so later mutation cannot reach the config", () => {
        const input = minimal();
        const config = defineConfig(input);
        const extra: PackSpec = { name: "actors", type: "Actor" };
        input.packs.push(extra);

        expect(config.packs).toHaveLength(1);
    });

    it.each<[string, unknown]>([
        ["no config at all", undefined],
        ["a non-object config", "sohl"],
        ["a missing contentPackage", { ...minimal(), contentPackage: "" }],
        ["a missing foundryPackage", { ...minimal(), foundryPackage: "  " }],
        ["an unknown packageKind", { ...minimal(), packageKind: "worlds" }],
        ["a non-array pack list", { ...minimal(), packs: "items" }],
        ["a pack with no name", { ...minimal(), packs: [{ type: "Item" }] }],
        [
            "a pack with an unknown document type",
            { ...minimal(), packs: [{ name: "items", type: "Widget" }] },
        ],
        [
            "two packs sharing a name",
            {
                ...minimal(),
                packs: [
                    { name: "items", type: "Item" },
                    { name: "items", type: "Actor" },
                ],
            },
        ],
        ["a missing rootDir", { ...minimal(), rootDir: undefined }],
        ["a relative rootDir", { ...minimal(), rootDir: "packages/x" }],
        ["a missing stats block", { ...minimal(), stats: undefined }],
        ["a non-object paths block", { ...minimal(), paths: "build" }],
        ["an unknown path key", { ...minimal(), paths: { nope: "build" } }],
        ["an absolute configured path", { ...minimal(), paths: { content: "/etc/content" } }],
        ["a non-array skipDirectories", { ...minimal(), skipDirectories: "Templates" }],
        [
            "a companion with no document type",
            {
                ...minimal(),
                packs: [
                    {
                        name: "scenes",
                        type: "Scene",
                        companions: [{ name: "adventures" }],
                    },
                ],
            },
        ],
        [
            "a companion colliding with a pack name",
            {
                ...minimal(),
                packs: [
                    { name: "items", type: "Item" },
                    {
                        name: "scenes",
                        type: "Scene",
                        companions: [{ name: "items", type: "Adventure" }],
                    },
                ],
            },
        ],
        ["a non-mapping packageBuild section", { ...minimal(), packageBuild: [] }],
        ["an unknown site mode", { ...minimal(), publish: { site: "yes" } }],
        // Refused rather than mapped onto the nearest mode: `false` read as
        // "no web presence", which describes no package (#55).
        ["the retired `site: true`", { ...minimal(), publish: { site: true } }],
        ["the retired `site: false`", { ...minimal(), publish: { site: false } }],
        ["an unknown key", { ...minimal(), publishSite: true }],
    ])("rejects %s", (_label, input) => {
        expect(() => defineConfig(input as ContentBuildConfigInput)).toThrow(TypeError);
    });

    it("names the offending field in the error message", () => {
        expect(() =>
            defineConfig({
                ...minimal(),
                packageKind: "worlds",
            } as unknown as ContentBuildConfigInput),
        ).toThrow(/packageKind/);
    });
});

describe("defineConfig — the layout a consumer supplies (#1508)", () => {
    it("defaults every path to the conventional repository layout", () => {
        const config = defineConfig(minimal());

        expect(config.paths).toEqual({
            content: path.join("/repo", "assets/content"),
            manifests: path.join("/repo", "assets/manifests"),
            manifestOut: path.join("/repo", "build/manifests"),
            packJson: path.join("/repo", "build/packs-json"),
            stage: path.join("/repo", "build/stage/packs"),
            unpack: path.join("/repo", "build/tmp/packs"),
            foreignCache: path.join("/repo", "build/cache/foreign"),
        });
    });

    it("resolves a consumer's overrides against its own root", () => {
        // The point of the hoist: a consuming repository supplies its layout
        // instead of inheriting this one's.
        const config = defineConfig({
            ...minimal(),
            rootDir: "/elsewhere",
            paths: { content: "content", stage: "dist/packs" },
        });

        expect(config.paths.content).toBe(path.join("/elsewhere", "content"));
        expect(config.paths.stage).toBe(path.join("/elsewhere", "dist/packs"));
        // Unnamed paths keep the convention, anchored at the same root.
        expect(config.paths.packJson).toBe(path.join("/elsewhere", "build/packs-json"));
    });

    it("derives the served asset root from the package kind and id", () => {
        expect(defineConfig(minimal()).assetRoot).toBe("systems/sohl/assets");
        expect(
            defineConfig({
                ...minimal(),
                foundryPackage: "sohl-thalorna",
                packageKind: "modules",
            }).assetRoot,
        ).toBe("modules/sohl-thalorna/assets");
    });

    it("derives one pack-directory list from the one pack list", () => {
        // `SOURCE_PACKS` and `PACK_CONFIGS` were two lists that had to agree;
        // the compile order is now derived from the single declaration.
        const config = defineConfig({
            ...minimal(),
            packs: [
                { name: "items", type: "Item", folders: "item-folders.yaml" },
                {
                    name: "scenes",
                    type: "Scene",
                    companions: [{ name: "adventures", type: "Adventure" }],
                },
            ],
        });

        expect(config.packDirectories).toEqual(["items", "scenes", "adventures"]);
        expect(config.packs[0].folders).toBe("item-folders.yaml");
        expect(config.packs[1].companions).toEqual([
            {
                name: "adventures",
                type: "Adventure",
                label: "adventures",
                private: false,
                folders: null,
                companions: [],
                mayBeEmpty: false,
                default: false,
                prebuilt: null,
                system: null,
            },
        ]);
    });

    it("defaults the skipped-directory list to empty", () => {
        // `Templates/` is an Obsidian convention, not a property of the
        // toolchain — a consumer that uses it says so.
        expect(defineConfig(minimal()).skipDirectories).toEqual([]);
        expect(
            defineConfig({ ...minimal(), skipDirectories: ["Templates"] }).skipDirectories,
        ).toEqual(["Templates"]);
    });

    it("carries the Foundry core range, which it is now the source of", () => {
        // This reverses a rule that held until #50: the configuration used to
        // be forbidden from holding the floor, and pointed at the manifest
        // instead, because the manifest was hand-authored and moved with test
        // evidence. Now the manifest is generated *from* here, so pointing at
        // it would be a round trip through an artifact that need not exist
        // yet — `build:db` can run before the manifest is written.
        const config = defineConfig(minimal());

        expect(config.compatibility).toEqual({
            minimum: "14.359",
            verified: "14.359",
        });
        expect(Object.isFrozen(config.compatibility)).toBe(true);
    });

    it("keeps `minimum` mandatory, since it is stamped into every document", () => {
        const { compatibility: _drop, ...without } = minimal();
        expect(defineConfig(without).compatibility).toBeNull();

        expect(() => defineConfig({ ...minimal(), compatibility: { verified: "14.4" } })).toThrow(
            /compatibility\.minimum/,
        );
    });

    it("freezes the added blocks too", () => {
        const config = defineConfig(minimal());
        expect(Object.isFrozen(config.paths)).toBe(true);
        expect(Object.isFrozen(config.stats)).toBe(true);
        expect(Object.isFrozen(config.skipDirectories)).toBe(true);
        expect(Object.isFrozen(config.packDirectories)).toBe(true);
    });
});

describe("defineConfig — an item type's default art (#7)", () => {
    const build = (fm: object) => ({ from: "builder", n: (fm as any)?.n ?? 0 });

    it("accepts a bare builder function, and derives no art from it", () => {
        // The original spelling, unchanged: a consumer whose notes all carry
        // `img:` never needs to pair art, and must not be made to.
        const config = defineConfig({
            ...minimal(),
            itemBuilders: { relic: build },
        });

        expect(config.itemBuilders.relic).toBe(build);
        expect(config.itemArt).toEqual({});
        expect([...config.itemTypes]).toEqual(["relic"]);
    });

    it("accepts a builder paired with art, and splits the two apart", () => {
        const config = defineConfig({
            ...minimal(),
            itemBuilders: {
                relic: { system: build, img: "icons/relic.svg" },
            },
        });

        // `itemBuilders` stays the callable table every caller already reads:
        // the paired shape is how a consumer *writes* an entry, not a new thing
        // the compilers have to understand.
        expect(config.itemBuilders.relic).toBe(build);
        expect(config.itemArt).toEqual({ relic: "icons/relic.svg" });
        expect([...config.itemTypes]).toEqual(["relic"]);
    });

    it("lets the two spellings sit side by side", () => {
        // Pairing art is per type, not per repository — adding art to one type
        // must not force it on the rest.
        const config = defineConfig({
            ...minimal(),
            itemBuilders: {
                relic: { system: build, img: "icons/relic.svg" },
                charm: build,
            },
        });

        expect([...config.itemTypes].sort()).toEqual(["charm", "relic"]);
        expect(config.itemArt).toEqual({ relic: "icons/relic.svg" });
    });

    it("derives itemTypes from the keys whichever spelling declared them", () => {
        // #1504's guarantee has to survive the wider entry: the whitelist is
        // still the keys, so a type cannot be accepted without a builder.
        const config = defineConfig({
            ...minimal(),
            itemBuilders: { relic: { system: build } },
        });

        expect([...config.itemTypes]).toEqual(["relic"]);
        expect(config.itemArt).toEqual({});
    });

    it("rejects a paired entry with no system builder", () => {
        expect(() =>
            defineConfig({
                ...minimal(),
                itemBuilders: { relic: { img: "icons/relic.svg" } },
            } as unknown as ContentBuildConfigInput),
        ).toThrow(/itemBuilders\.relic\.system/);
    });

    it("rejects art that is not a non-empty string", () => {
        for (const img of ["", 7, null]) {
            expect(() =>
                defineConfig({
                    ...minimal(),
                    itemBuilders: { relic: { system: build, img } },
                } as unknown as ContentBuildConfigInput),
            ).toThrow(/itemBuilders\.relic\.img/);
        }
    });

    it("rejects a stray key, so a misspelled `image` is not silently ignored", () => {
        // The failure this guards against is quiet: art that never applies,
        // and a build that looks fine until a note without `img:` shows up.
        expect(() =>
            defineConfig({
                ...minimal(),
                itemBuilders: {
                    relic: { system: build, image: "icons/relic.svg" },
                },
            } as unknown as ContentBuildConfigInput),
        ).toThrow(/itemBuilders\.relic\.image/);
    });

    it("rejects an entry that is neither a function nor an object", () => {
        expect(() =>
            defineConfig({
                ...minimal(),
                itemBuilders: { relic: "icons/relic.svg" },
            } as unknown as ContentBuildConfigInput),
        ).toThrow(/itemBuilders\.relic/);
    });
});

describe("the package barrels", () => {
    it("exposes the engine and sohl namespaces", async () => {
        const pkg = await import("../index.mjs");

        expect(pkg.engine).toBeTypeOf("object");
        expect(pkg.sohl).toBeTypeOf("object");
    });
});

describe("the reserved `packageBuild` section", () => {
    // One repository describes itself in one file, so the two shared build
    // packages share it — but they split by input, and neither should learn the
    // other's schema. This validator checks that the section is a mapping and
    // stops there.

    it("passes an arbitrary section through untouched", () => {
        const section = {
            assets: [{ from: "assets/icons", to: "assets/icons" }],
            deploy: { envPrefix: "SOHL" },
            somethingInventedLater: { nested: [1, 2, 3] },
        };
        const config = defineConfig({ ...minimal(), packageBuild: section });

        expect(config.packageBuild).toEqual(section);
    });

    it("does not key-check inside it, unlike every key around it", () => {
        // A typo'd top-level key is a build failure; a key package-build has
        // not heard of is package-build's to reject, not this module's.
        expect(() => defineConfig({ ...minimal(), notAKey: true } as never)).toThrow(/notAKey/);
        expect(() =>
            defineConfig({
                ...minimal(),
                packageBuild: { notAPackageBuildKey: true },
            }),
        ).not.toThrow();
    });

    it("freezes it all the way down", () => {
        // Read through the same immutable object as the rest of the config.
        const config = defineConfig({
            ...minimal(),
            packageBuild: { assets: [{ from: "a", to: "b" }] },
        });
        const section = config.packageBuild as {
            assets: { from: string; to: string }[];
        };

        expect(Object.isFrozen(section)).toBe(true);
        expect(Object.isFrozen(section.assets)).toBe(true);
        expect(Object.isFrozen(section.assets[0])).toBe(true);
    });

    it("copies rather than capturing, so a later mutation cannot reach it", () => {
        const section: Record<string, unknown> = { assets: [] };
        const config = defineConfig({ ...minimal(), packageBuild: section });

        section.assets = [{ from: "sneaked", to: "in" }];

        expect(config.packageBuild).toEqual({ assets: [] });
    });

    it("defaults to an empty mapping", () => {
        expect(defineConfig(minimal()).packageBuild).toEqual({});
    });
});

describe("the address scheme a repository publishes at (#58)", () => {
    const address = (value: unknown) =>
        defineConfig({
            ...minimal(),
            publish: { site: "content", address: value },
        }).publish.address;

    it("defaults to the package root under the `readme` rule", () => {
        expect(defineConfig(minimal()).publish.address).toEqual({
            prefix: "",
            landing: "readme",
        });
    });

    it("carries a mount prefix for a package whose site is more than content", () => {
        expect(address({ prefix: "kb/" })).toEqual({
            prefix: "kb/",
            landing: "readme",
        });
    });

    it("accepts an empty prefix, which is a real layout and not an omission", () => {
        expect(address({ prefix: "" }).prefix).toBe("");
    });

    it("rejects a prefix that would fuse to the first section", () => {
        // A prefix is concatenated, not joined, so `kb` yields
        // `kbaffliction/` — an address that builds, resolves nowhere, and
        // reads as a content error rather than a configuration one.
        expect(() => address({ prefix: "kb" })).toThrow(/must end in a slash/);
    });

    it("rejects a package-absolute prefix", () => {
        // A leading slash is the site-absolute shape #1465 removed: it would
        // record where the package is mounted, which is the consumer's fact.
        expect(() => address({ prefix: "/kb/" })).toThrow(/must not begin with a slash/);
    });

    it("names the landing rules rather than accepting any string", () => {
        expect(address({ landing: "collection" }).landing).toBe("collection");
        expect(() => address({ landing: "readmes" })).toThrow(/readme, collection/);
    });

    it("rejects an unknown key, as every other section does", () => {
        expect(() => address({ mount: "kb/" })).toThrow(/not a recognized/);
    });
});

describe("prebuilt packs and per-pack systems (#40)", () => {
    it("accepts a pack whose JSON is already built, and records where it lives", () => {
        const config = defineConfig({
            ...minimal(),
            packs: [
                {
                    name: "adventures",
                    type: "Adventure",
                    prebuilt: "assets/packs/adventure",
                },
            ],
        });
        expect(config.packs[0].prebuilt).toBe("assets/packs/adventure");
        expect(config.packs[0].system).toBeNull();
    });

    it("defaults prebuilt and system to null on an ordinary pack", () => {
        const config = defineConfig(minimal());
        expect(config.packs[0].prebuilt).toBeNull();
        expect(config.packs[0].system).toBeNull();
    });

    it("records a per-pack system", () => {
        const config = defineConfig({
            ...minimal(),
            packs: [{ name: "actors-hm3", type: "Actor", system: "hm3" }],
        });
        expect(config.packs[0].system).toBe("hm3");
    });

    // `stats.systemId` was required, which forced one answer on every pack. A
    // package whose packs are not all for one system needs none at that level —
    // and the key is derived rather than authored now (#48), so a module that
    // declares no system simply has none.
    it("leaves a module that declares no system with none", () => {
        const config = defineConfig({
            ...minimal(),
            packageKind: "modules",
            stats: { lastModifiedBy: "a" },
        });
        expect(config.stats.systemId).toBeNull();
        expect(config.stats.systemVersion).toBeNull();
    });

    it("refuses an authored systemId or systemVersion", () => {
        for (const key of ["systemId", "systemVersion"]) {
            expect(() =>
                defineConfig({
                    ...minimal(),
                    stats: { [key]: "x", lastModifiedBy: "a" },
                }),
            ).toThrow(/is derived and may not be authored/);
        }
    });

    // Each of these describes a generation pass, and a prebuilt pack has none.
    it.each([
        [
            "folders",
            {
                name: "adventures",
                type: "Adventure",
                prebuilt: "assets/packs/adventure",
                folders: "adventure-folders.yaml",
            },
        ],
        [
            "default",
            {
                name: "adventures",
                type: "Adventure",
                prebuilt: "assets/packs/adventure",
                default: true,
            },
        ],
        [
            "companions",
            {
                name: "adventures",
                type: "Adventure",
                prebuilt: "assets/packs/adventure",
                companions: [{ name: "extra", type: "Scene" }],
            },
        ],
    ])("rejects prebuilt alongside %s", (_label, pack) => {
        expect(() => defineConfig({ ...minimal(), packs: [pack] })).toThrow();
    });

    it("rejects prebuilt on a companion", () => {
        expect(() =>
            defineConfig({
                ...minimal(),
                packs: [
                    {
                        name: "scenes",
                        type: "Scene",
                        companions: [
                            {
                                name: "adventures",
                                type: "Adventure",
                                prebuilt: "assets/packs/adventure",
                            },
                        ],
                    },
                ],
            }),
        ).toThrow();
    });

    it("rejects an empty prebuilt path", () => {
        expect(() =>
            defineConfig({
                ...minimal(),
                packs: [{ name: "adventures", type: "Adventure", prebuilt: "" }],
            }),
        ).toThrow();
    });
});
