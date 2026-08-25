/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    buildManifest,
    manifestPacks,
    normalizeRepoUrl,
    publishedRelationships,
    releaseUrls,
    writeManifest,
} from "../manifest.mjs";

describe("normalizeRepoUrl", () => {
    it("passes through the plain form", () => {
        expect(
            normalizeRepoUrl({ url: "https://github.com/HeroicLands/sohl" }),
        ).toBe("https://github.com/HeroicLands/sohl");
    });

    // The form npm itself writes, and the one `sohl-kethira-basic` declares.
    // Left in place it yields a 404 on every Foundry update check.
    it("strips the git+ prefix and the .git suffix", () => {
        expect(
            normalizeRepoUrl({
                url: "git+https://github.com/HeroicLands/sohl-kethira-basic.git",
            }),
        ).toBe("https://github.com/HeroicLands/sohl-kethira-basic");
    });

    it("strips a trailing slash", () => {
        expect(normalizeRepoUrl({ url: "https://github.com/a/b/" })).toBe(
            "https://github.com/a/b",
        );
    });

    it("accepts the shorthand string form", () => {
        expect(normalizeRepoUrl("https://github.com/a/b.git")).toBe(
            "https://github.com/a/b",
        );
    });

    // A manifest with no addresses installs and never offers an update.
    it("refuses an absent or empty repository", () => {
        expect(() => normalizeRepoUrl(undefined as never)).toThrow(
            /no `repository.url`/,
        );
        expect(() => normalizeRepoUrl({})).toThrow();
        expect(() => normalizeRepoUrl({ url: "   " })).toThrow();
    });
});

describe("releaseUrls", () => {
    const urls = releaseUrls({
        repoUrl: "https://github.com/HeroicLands/sohl",
        version: "0.8.2",
        artifact: "system",
    });

    // The URL an *installed* package re-fetches to discover a newer one. Pinned
    // to this version it would freeze every install at this release forever.
    it("points `manifest` at releases/latest, not at this version", () => {
        expect(urls.manifest).toBe(
            "https://github.com/HeroicLands/sohl/releases/latest/download/system.json",
        );
    });

    it("points `download` at this exact version", () => {
        expect(urls.download).toBe(
            "https://github.com/HeroicLands/sohl/releases/download/v0.8.2/system.zip",
        );
    });

    it("derives url and bugs from the same root", () => {
        expect(urls.url).toBe("https://github.com/HeroicLands/sohl");
        expect(urls.bugs).toBe("https://github.com/HeroicLands/sohl/issues");
    });

    it("names the module artifact for a module", () => {
        const m = releaseUrls({
            repoUrl: "https://github.com/HeroicLands/sohl-thalorna",
            version: "0.1.0",
            artifact: "module",
        });
        expect(m.manifest).toContain("/module.json");
        expect(m.download).toContain("/module.zip");
    });
});

describe("manifestPacks — one pack list, not two", () => {
    // The manifest used to restate every pack's name and type beside a label,
    // a path and a system id, with nothing checking that the pairs agreed.
    const config = {
        stats: { systemId: "sohl" },
        packs: [
            {
                name: "items",
                type: "Item",
                label: "Items",
                private: false,
                companions: [],
            },
            {
                name: "scenes",
                type: "Scene",
                label: "Maps",
                private: false,
                companions: [
                    {
                        name: "adventures",
                        type: "Adventure",
                        label: "Adventures",
                        private: false,
                        companions: [],
                    },
                ],
            },
        ],
    };

    it("derives each entry from the configured pack", () => {
        expect(manifestPacks(config)).toEqual([
            {
                label: "Items",
                type: "Item",
                name: "items",
                system: "sohl",
                path: "packs/items",
                private: false,
            },
            {
                label: "Maps",
                type: "Scene",
                name: "scenes",
                system: "sohl",
                path: "packs/scenes",
                private: false,
            },
            {
                label: "Adventures",
                type: "Adventure",
                name: "adventures",
                system: "sohl",
                path: "packs/adventures",
                private: false,
            },
        ]);
    });

    it("flattens companions, which Foundry sees no difference in", () => {
        // A companion is only a pack written by another pass rather than one of
        // its own; it ships as an ordinary compendium.
        expect(manifestPacks(config).map((p) => p.name)).toEqual([
            "items",
            "scenes",
            "adventures",
        ]);
    });
});

describe("publishedRelationships", () => {
    it("filters every kind, not just systems", () => {
        expect(
            publishedRelationships({
                systems: [{ id: "sohl", itemCatalog: true }],
                requires: [{ id: "a", itemCatalog: true }],
                recommends: [{ id: "b" }],
            }),
        ).toEqual({
            systems: [{ id: "sohl" }],
            requires: [{ id: "a" }],
            recommends: [{ id: "b" }],
        });
    });

    // Same reasoning as a declared manifest key: a key Foundry adds later
    // should not need a release of this package to be publishable.
    it("leaves a key it does not recognise alone", () => {
        expect(
            publishedRelationships({
                requires: [{ id: "a", somethingFoundryAddsLater: "yes" }],
            }),
        ).toEqual({
            requires: [{ id: "a", somethingFoundryAddsLater: "yes" }],
        });
    });

    it("returns a block with nothing build-only equal to what went in", () => {
        const declared = {
            systems: [{ id: "sohl", compatibility: { minimum: "0.8.0" } }],
        };
        expect(publishedRelationships(declared)).toEqual(declared);
    });
});

describe("buildManifest", () => {
    /** A resolved configuration, with only what the manifest reads. */
    function config(over: Record<string, unknown> = {}) {
        return {
            foundryPackage: "sohl",
            stats: { systemId: "sohl" },
            compatibility: { minimum: "14.359", verified: "14.364" },
            relationships: {},
            packs: [
                {
                    name: "items",
                    type: "Item",
                    label: "Items",
                    private: false,
                    companions: [],
                },
            ],
            packageBuild: { manifest: { title: "Song of Heroic Lands" } },
            ...over,
        };
    }

    const packageJson = {
        version: "1.2.3",
        repository: { url: "git+https://github.com/HeroicLands/sohl.git" },
    };

    const build = (over = {}, flags?: Record<string, object>) =>
        buildManifest({
            config: config(over) as never,
            packageJson,
            artifact: "system",
            flags,
        });

    it("emits what the repository declared, unchanged", () => {
        // Pass-through is the point: a key Foundry adds in a later version can
        // be declared without waiting for a release of this package.
        const manifest = build({
            packageBuild: {
                manifest: {
                    title: "Song of Heroic Lands",
                    somethingFoundryAddsLater: { nested: [1, 2] },
                },
            },
        });

        expect(manifest.title).toBe("Song of Heroic Lands");
        expect(manifest.somethingFoundryAddsLater).toEqual({ nested: [1, 2] });
    });

    it("derives the identity, the version and the release addresses", () => {
        const manifest = build();

        expect(manifest.id).toBe("sohl");
        expect(manifest.version).toBe("1.2.3");
        expect(manifest.url).toBe("https://github.com/HeroicLands/sohl");
        expect(manifest.bugs).toBe(
            "https://github.com/HeroicLands/sohl/issues",
        );
        expect(manifest.manifest).toBe(
            "https://github.com/HeroicLands/sohl/releases/latest/download/system.json",
        );
        expect(manifest.download).toBe(
            "https://github.com/HeroicLands/sohl/releases/download/v1.2.3/system.zip",
        );
    });

    it("carries the compatibility range from the shared configuration", () => {
        expect(build().compatibility).toEqual({
            minimum: "14.359",
            verified: "14.364",
        });
    });

    it("omits relationships when none are declared", () => {
        // An empty block in a manifest is noise; Foundry treats absent and
        // empty alike.
        expect(build()).not.toHaveProperty("relationships");

        const withOne = build({
            relationships: { systems: [{ id: "sohl" }] },
        });
        expect(withOne.relationships).toEqual({ systems: [{ id: "sohl" }] });
    });

    // A manifest is a published contract, and `itemCatalog` is a directive to
    // the build — Foundry's relationship schema does not define it, and a
    // consumer reading it cannot tell it from a fact about the package.
    it("does not publish the build-only keys of a relationship", () => {
        const manifest = build({
            relationships: {
                systems: [
                    {
                        id: "sohl",
                        type: "system",
                        manifest:
                            "https://github.com/HeroicLands/sohl/releases/latest/download/system.json",
                        compatibility: { minimum: "0.8.0", verified: "0.8.2" },
                        itemCatalog: true,
                    },
                ],
            },
        });

        expect(manifest.relationships).toEqual({
            systems: [
                {
                    id: "sohl",
                    type: "system",
                    manifest:
                        "https://github.com/HeroicLands/sohl/releases/latest/download/system.json",
                    compatibility: { minimum: "0.8.0", verified: "0.8.2" },
                },
            ],
        });
    });

    // Dropping the whole relationship, or the kind it sits under, would take a
    // declared dependency out of the manifest with it.
    it("keeps a relationship whose only other key was build-only", () => {
        const manifest = build({
            relationships: { requires: [{ id: "x", itemCatalog: false }] },
        });

        expect(manifest.relationships).toEqual({ requires: [{ id: "x" }] });
    });

    it("merges computed flags over the declared ones, per namespace", () => {
        const manifest = build(
            {
                packageBuild: {
                    manifest: {
                        flags: {
                            allowBugReporter: true,
                            sohl: { keep: "me" },
                        },
                    },
                },
            },
            { sohl: { creditsUuid: "Compendium.sohl.journals.x" } },
        );

        expect(manifest.flags).toEqual({
            allowBugReporter: true,
            sohl: { keep: "me", creditsUuid: "Compendium.sohl.journals.x" },
        });
    });

    it("leaves declared flags alone when nothing is computed", () => {
        const manifest = build({
            packageBuild: { manifest: { flags: { allowBugReporter: true } } },
        });

        expect(manifest.flags).toEqual({ allowBugReporter: true });
    });

    it("writes its keys in a fixed order, so the file diffs", () => {
        // Not for Foundry's sake — for the human reading a diff, and so the
        // generated file is comparable against the template it replaced.
        const keys = Object.keys(build());

        expect(keys.indexOf("id")).toBeLessThan(keys.indexOf("title"));
        expect(keys.indexOf("title")).toBeLessThan(keys.indexOf("version"));
        expect(keys.indexOf("compatibility")).toBeLessThan(
            keys.indexOf("packs"),
        );
        expect(keys.indexOf("packs")).toBeLessThan(keys.indexOf("url"));
    });

    it("puts an undeclared key after the ones it knows", () => {
        const keys = Object.keys(
            build({
                packageBuild: {
                    manifest: { title: "x", inventedLater: true },
                },
            }),
        );

        expect(keys.at(-1)).toBe("inventedLater");
    });
});

describe("writeManifest", () => {
    it("writes <artifact>.json into the stage, creating it", async () => {
        const outDir = path.join(
            fs.mkdtempSync(path.join(os.tmpdir(), "pb-manifest-")),
            "stage",
        );
        const { path: written, manifest } = await writeManifest({
            config: {
                foundryPackage: "sohl-thalorna",
                stats: { systemId: "sohl" },
                compatibility: { minimum: "14.359" },
                relationships: {},
                packs: [],
                packageBuild: { manifest: { title: "Thalorna" } },
            } as never,
            packageJson: {
                version: "0.1.0",
                repository: "https://github.com/HeroicLands/sohl-thalorna",
            },
            artifact: "module",
            outDir,
        });

        expect(written).toBe(path.join(outDir, "module.json"));
        expect(manifest.id).toBe("sohl-thalorna");

        const onDisk = fs.readFileSync(written, "utf8");
        expect(JSON.parse(onDisk).title).toBe("Thalorna");
        // The file is committed to a release archive and read by humans as
        // often as by Foundry.
        expect(onDisk.endsWith("\n")).toBe(true);
    });
});
