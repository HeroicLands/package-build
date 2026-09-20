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
    HOMEPAGE_ORIGIN,
    manifestPacks,
    normalizeRepoUrl,
    packageHomepage,
    publishedRelationships,
    releaseUrls,
    writeManifest,
} from "../manifest.mjs";

describe("normalizeRepoUrl", () => {
    it("passes through the plain form", () => {
        expect(normalizeRepoUrl({ url: "https://github.com/HeroicLands/sohl" })).toBe(
            "https://github.com/HeroicLands/sohl",
        );
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
        expect(normalizeRepoUrl({ url: "https://github.com/a/b/" })).toBe("https://github.com/a/b");
    });

    it("accepts the shorthand string form", () => {
        expect(normalizeRepoUrl("https://github.com/a/b.git")).toBe("https://github.com/a/b");
    });

    // A manifest with no addresses installs and never offers an update.
    it("refuses an absent or empty repository", () => {
        expect(() => normalizeRepoUrl(undefined as never)).toThrow(/no `repository.url`/);
        expect(() => normalizeRepoUrl({})).toThrow();
        expect(() => normalizeRepoUrl({ url: "   " })).toThrow();
    });
});

describe("packageHomepage", () => {
    it("addresses the package by its content-package name", () => {
        expect(packageHomepage("thalorna")).toBe(`${HOMEPAGE_ORIGIN}/thalorna/`);
        expect(packageHomepage("harnensemble")).toBe(`${HOMEPAGE_ORIGIN}/harnensemble/`);
    });

    // The site build writes the same address as its `baseURL`, with the slash.
    // A reader following `url` lands on a directory, not on a redirect to one.
    it("keeps the trailing slash", () => {
        expect(packageHomepage("sohl").endsWith("/sohl/")).toBe(true);
    });

    // `<origin>/undefined/` resolves, so it would be advertised until somebody
    // followed the link and found the 404.
    it("refuses a missing name rather than interpolating it", () => {
        expect(() => packageHomepage(undefined as unknown as string)).toThrow(/contentPackage/);
        expect(() => packageHomepage("  ")).toThrow(/contentPackage/);
    });
});

describe("releaseUrls", () => {
    const urls = releaseUrls({
        repoUrl: "https://github.com/HeroicLands/sohl",
        homeUrl: packageHomepage("sohl"),
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

    // `url` is the Project Homepage link a reader follows from the package
    // listing before installing. The repository answers a different question.
    it("sends url to the homepage and bugs to the repository", () => {
        expect(urls.url).toBe(`${HOMEPAGE_ORIGIN}/sohl/`);
        expect(urls.bugs).toBe("https://github.com/HeroicLands/sohl/issues");
    });

    it("keeps the release artefacts on the repository holding them", () => {
        expect(urls.manifest.startsWith("https://github.com/HeroicLands/sohl/")).toBe(true);
        expect(urls.download.startsWith("https://github.com/HeroicLands/sohl/")).toBe(true);
    });

    it("names the module artifact for a module", () => {
        const m = releaseUrls({
            repoUrl: "https://github.com/HeroicLands/sohl-thalorna",
            homeUrl: packageHomepage("thalorna"),
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
        expect(manifestPacks(config).map((p) => p.name)).toEqual(["items", "scenes", "adventures"]);
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
            contentPackage: "sohl",
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

    // This URL is how every consumer finds the index it resolves this
    // package's addresses through, so it is derived, version-pinned, and not
    // something a repository is asked to write down.
    it("advertises the content index, pinned to this version", () => {
        const manifest = build({ contentPackage: "sohl" }) as Record<string, never>;

        expect((manifest.flags as Record<string, string>).metadataUrl).toBe(
            "https://github.com/HeroicLands/sohl/releases/download/v1.2.3/sohl-metadata.jsonl",
        );
    });

    // Pinned where `manifest` deliberately floats: a consumer reads the
    // manifest and then fetches the index it names, so the two must describe
    // one release or a pinned build would pair with a moving index.
    it("pins the index where the manifest URL floats", () => {
        const manifest = build({ contentPackage: "sohl" }) as Record<string, string>;

        expect(manifest.manifest).toContain("/releases/latest/download/");
        expect((manifest.flags as unknown as Record<string, string>).metadataUrl).toContain(
            "/releases/download/v1.2.3/",
        );
    });

    // `contentPackage` is required of a resolved configuration, so in a real
    // build the URL is always written. The guard
    // is for a caller holding a partial config, and is asserted so that a later
    // change making the flag unconditional is a deliberate one.
    // Every package names a content package, so every manifest advertises the
    // index consumers resolve its addresses through.
    it("always advertises the content index", () => {
        const manifest = build() as Record<string, unknown>;

        expect((manifest.flags as Record<string, string>).metadataUrl).toContain(
            "sohl-metadata.jsonl",
        );
    });

    // Namespaced flags and this one share the object, so adding a namespace
    // must not drop the URL — they are merged, not written in turn.
    it("keeps the index URL beside namespaced flags", () => {
        const manifest = build({ contentPackage: "sohl" }, { hm3: { archetype: 0 } }) as Record<
            string,
            never
        >;
        const flags = manifest.flags as unknown as Record<string, unknown>;

        expect(flags.metadataUrl).toContain("sohl-metadata.jsonl");
        expect(flags.hm3).toEqual({ archetype: 0 });
    });

    // `url` is the Project Homepage link a reader follows from the package
    // listing *before* installing, so it answers "what is this?". The
    // repository answers a different question and keeps `bugs` and the release
    // artefacts.
    it("sends url to the package's homepage, and the rest to the repository", () => {
        const manifest = build({ contentPackage: "sohl" });

        expect(manifest.url).toBe(`${HOMEPAGE_ORIGIN}/sohl/`);
        expect(manifest.bugs).toBe("https://github.com/HeroicLands/sohl/issues");
        expect(manifest.manifest).toContain("github.com/HeroicLands/sohl/releases/");
        expect(manifest.download).toContain("github.com/HeroicLands/sohl/releases/");
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
        // The homepage, not the repository — `url` is the Project Homepage link
        // a reader follows from the package listing before installing.
        expect(manifest.url).toBe(`${HOMEPAGE_ORIGIN}/sohl/`);
        expect(manifest.bugs).toBe("https://github.com/HeroicLands/sohl/issues");
        expect(manifest.manifest).toBe(
            "https://github.com/HeroicLands/sohl/releases/latest/download/system.json",
        );
        expect(manifest.download).toBe(
            "https://github.com/HeroicLands/sohl/releases/download/v1.2.3/system.zip",
        );
    });

    // `packageBuild.manifest.description` is refused (see `config.test.ts`),
    // so the only source is `packageBuild.manifest.descriptionHtml`.
    it("derives the description from packageBuild.manifest.descriptionHtml", () => {
        const manifest = buildManifest({
            config: config({
                packageBuild: {
                    manifest: {
                        title: "Song of Heroic Lands",
                        descriptionHtml: "<p>The SoHL Foundry VTT system.</p>",
                    },
                },
            }) as never,
            packageJson,
            artifact: "system",
        });

        expect(manifest.description).toBe("<p>The SoHL Foundry VTT system.</p>");
    });

    it("does not carry descriptionHtml through under its own name", () => {
        const manifest = buildManifest({
            config: config({
                packageBuild: {
                    manifest: { descriptionHtml: "<p>The SoHL Foundry VTT system.</p>" },
                },
            }) as never,
            packageJson,
            artifact: "system",
        });

        expect(manifest).not.toHaveProperty("descriptionHtml");
    });

    it("omits description rather than emitting one, when nothing declares descriptionHtml", () => {
        expect(build()).not.toHaveProperty("description");
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
            metadataUrl: expect.stringContaining("sohl-metadata.jsonl"),
            sohl: { keep: "me", creditsUuid: "Compendium.sohl.journals.x" },
        });
    });

    it("leaves declared flags alone when nothing is computed", () => {
        const manifest = build({
            packageBuild: { manifest: { flags: { allowBugReporter: true } } },
        });

        // The index URL is always written, so it stands beside the declared
        // flags rather than in place of them.
        expect(manifest.flags).toEqual({
            allowBugReporter: true,
            metadataUrl: expect.stringContaining("sohl-metadata.jsonl"),
        });
    });

    it("writes its keys in a fixed order, so the file diffs", () => {
        // Not for Foundry's sake — for the human reading a diff, and so the
        // generated file is comparable against the template it replaced.
        const keys = Object.keys(build());

        expect(keys.indexOf("id")).toBeLessThan(keys.indexOf("title"));
        expect(keys.indexOf("title")).toBeLessThan(keys.indexOf("version"));
        expect(keys.indexOf("compatibility")).toBeLessThan(keys.indexOf("packs"));
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
        const outDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pb-manifest-")), "stage");
        const { path: written, manifest } = await writeManifest({
            config: {
                foundryPackage: "sohl-thalorna",
                contentPackage: "thalorna",
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

describe("manifestPacks — the system is per pack", () => {
    const pack = (extra = {}) => ({
        name: "adventures",
        type: "Adventure",
        label: "Adventures",
        private: false,
        companions: [],
        ...extra,
    });

    // Foundry requires `system` on ActiveEffect, Actor and Item packs and on no
    // others. An Adventure pack that declares one is hidden from every other
    // system, so the key is omitted rather than guessed.
    it("omits system when neither the pack nor the package names one", () => {
        const [entry] = manifestPacks({
            stats: { systemId: null },
            packs: [pack()],
        });
        expect(entry).not.toHaveProperty("system");
    });

    it("falls back to the package-wide systemId", () => {
        const [entry] = manifestPacks({
            stats: { systemId: "sohl" },
            packs: [pack()],
        });
        expect(entry.system).toBe("sohl");
    });

    it("lets a pack override the package-wide systemId", () => {
        const [entry] = manifestPacks({
            stats: { systemId: "sohl" },
            packs: [pack({ system: "hm3" })],
        });
        expect(entry.system).toBe("hm3");
    });

    // The shape harn-adventures needs: one system-less Adventure pack beside
    // two Actor packs that each name their own system.
    it("emits a different answer per pack", () => {
        const entries = manifestPacks({
            stats: { systemId: null },
            packs: [
                pack(),
                pack({ name: "actors-hm3", type: "Actor", system: "hm3" }),
                pack({ name: "actors-sohl", type: "Actor", system: "sohl" }),
            ],
        });
        expect(entries.map((e) => e.system)).toEqual([undefined, "hm3", "sohl"]);
    });
});
