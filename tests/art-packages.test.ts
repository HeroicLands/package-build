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

import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import YAML from "yaml";
import { noPicturePackageOutputs } from "./fixtures/art-packages/no-picture-packages.mjs";
import { collectArtMasters, masterAssetRecords } from "../engine/art-masters.mjs";
import {
    bindDependencyMasters,
    checkUnmasteredPictures,
    collectPackageArtMasters,
    fetchArtPackageIndexes,
} from "../engine/art-packages.mjs";
import { writeProvenance, writeSvgProvenance } from "../engine/art-provenance.mjs";
import { alternativeProblem } from "../engine/art-alternatives.mjs";
import { assetAddressIndex, readAssetAddress } from "../engine/art-fields.mjs";
import { annotateHtml, assetReferenceLookup } from "../engine/asset-references.mjs";
import { deployedAssetPath, stagePackageAssets } from "../engine/asset-shipping.mjs";
import { planCdnPublish } from "../engine/cdn-publish.mjs";
import {
    collectContentIndex,
    publishedIndexRecords,
    serializeContentIndex,
} from "../engine/content-index.mjs";
import {
    artPackageIndexFile,
    artPackagePathProblem,
    cachedArtPackageIndexes,
    loadForeignIndexes,
} from "../engine/metadata-index.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import { assetPathnameKey, resolvePathname } from "../engine/pathnames.mjs";
import { assertStagedInside, stagedImagePath } from "../engine/pdf-build.mjs";
import { stagePackageBuildAssets } from "../engine/build-assets.mjs";
import { cachedDependencies } from "../engine/sql-tables.mjs";

const root = path.resolve("build/art-packages-test");
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const INDEX_URL = "https://example.test/releases/artsample-metadata.jsonl";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>';

/** A master SVG carrying the given address and provenance. */
function master(address: string, fields: Record<string, unknown> = {}) {
    return writeSvgProvenance(SVG, {
        address,
        ai: false,
        creator: ["Artist"],
        license: "CC-BY-SA-4.0",
        ...fields,
    }).bytes;
}

/**
 * The published index of picture package `artsample`: a portrait, and any
 * further originals given as file name and bytes.
 */
function pictureIndex(extra: Array<[string, Buffer | Uint8Array]> = []) {
    const source = path.join(root, "artsample-originals");
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, "portrait.svg"), master("artsample-none-image-portrait"));
    for (const [name, bytes] of extra) fs.writeFileSync(path.join(source, name), bytes);
    const collected = collectArtMasters([source], "artsample");
    expect(collected.findings).toEqual([]);
    const records = collectContentIndex(path.join(root, "artsample-content"), {
        skipDirectories: [],
        contentPackage: "artsample",
        assetsBase: path.join(root, "artsample-assets"),
        masterRecords: masterAssetRecords(collected.masters),
    });
    return Buffer.from(serializeContentIndex(records));
}

/** A consuming package `sample`, written to disk so diagnostics are located. */
function consumer(index: Buffer, art: Record<string, unknown> = {}) {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sample", version: "1.0.0" }),
    );
    const data = {
        contentPackage: "sample",
        packageKind: "modules",
        stats: { lastModifiedBy: "samplebuilder000" },
        compatibility: { minimum: "14", verified: "14" },
        packs: [],
        art: {
            masterRoots: ["private"],
            packages: [
                {
                    package: "artsample",
                    url: INDEX_URL,
                    sha256: createHash("sha256").update(index).digest("hex"),
                },
            ],
            ...art,
        },
    };
    const file = path.join(root, "package-build.config.yaml");
    fs.writeFileSync(file, YAML.stringify(data));
    fs.mkdirSync(path.join(root, "private"), { recursive: true });
    return configFromData(data, file);
}

/** A fetch answering every request with the given bytes. */
const serving = (bytes: Buffer) => async () => new Response(bytes, { status: 200 });

/** Fetch the pinned index through a private download cache. */
const fetchIndex = (config: any, bytes: Buffer) =>
    fetchArtPackageIndexes(config, {
        fetch: serving(bytes) as any,
        cacheDir: path.join(root, "downloads"),
    });

it("accepts a master addressed in a declared picture package and binds it to the pinned index", async () => {
    const index = pictureIndex();
    const config = consumer(index);
    fs.writeFileSync(
        path.join(root, "private", "portrait.svg"),
        master("artsample-none-image-portrait"),
    );
    expect(await fetchIndex(config, index)).toBe(1);
    const collected = collectPackageArtMasters(config.art.masterRoots, config);
    expect(collected.findings).toEqual([]);
    const bound = collected.masters.get("artsample-none-image-portrait");
    expect(bound.dependency).toBe(true);
    const [record] = masterAssetRecords(collected.masters);
    expect(record).toMatchObject({
        package: "artsample",
        type: "image",
        shortcode: "portrait",
        asset: {
            path: "images/artsample/portrait.svg",
            attribution: ["Artist"],
            license: "CC-BY-SA-4.0",
            ai: false,
        },
    });
    const foreign = loadForeignIndexes(config, [config.contentPackage]);
    expect(foreign.packages.has("artsample")).toBe(true);
    expect(foreign.index.get("artsample-none-image-portrait")?.asset?.path).toBe(
        "images/portrait.svg",
    );
});

it("refuses a master of an undeclared package with a diagnostic naming the address and the declared packages", () => {
    const config = consumer(pictureIndex());
    const file = path.join(root, "private", "stray.svg");
    fs.writeFileSync(file, master("other-none-image-stray"));
    const collected = collectPackageArtMasters(config.art.masterRoots, config);
    expect(collected.masters.size).toBe(0);
    expect(collected.findings).toEqual([
        {
            file,
            severity: "error",
            message:
                "master address other-none-image-stray names package `other`, which is " +
                "neither this package nor a picture package declared under `art.packages` " +
                "(declared: artsample)",
        },
    ]);
    const undeclared = collectArtMasters([path.join(root, "private")], "sample");
    expect(undeclared.findings[0].message).toContain("(declared: none)");
});

it("leaves the package's own masters as they are, reading no picture index", () => {
    const config = consumer(pictureIndex());
    fs.writeFileSync(path.join(root, "private", "own.svg"), master("sample-none-image-own"));
    // Nothing is fetched: a collection with no picture-package master reads no index.
    const collected = collectPackageArtMasters(config.art.masterRoots, config);
    expect(collected.findings).toEqual([]);
    const plain = collectArtMasters(config.art.masterRoots, "sample");
    expect(masterAssetRecords(collected.masters)).toEqual(masterAssetRecords(plain.masters));
    const [record] = masterAssetRecords(collected.masters);
    expect(record.asset.path).toBe("images/own.svg");
    expect(collected.masters.get("sample-none-image-own").dependency).toBeUndefined();
    expect(deployedAssetPath(record, ["artsample"])).toBe("images/own.svg");
    expect(deployedAssetPath(record)).toBe("images/own.svg");
});

it("keeps a package that declares no picture packages exactly as it was", () => {
    fs.mkdirSync(path.join(root, "private"), { recursive: true });
    fs.writeFileSync(path.join(root, "private", "own.svg"), master("sample-none-image-own"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sample", version: "1.0.0" }),
    );
    const config = configFromData(
        {
            contentPackage: "sample",
            packageKind: "modules",
            stats: { lastModifiedBy: "samplebuilder000" },
            compatibility: { minimum: "14", verified: "14" },
            packs: [],
            art: { masterRoots: ["private"] },
        },
        path.join(root, "package-build.config.yaml"),
    );
    expect(config.art.packages).toEqual([]);
    expect(cachedArtPackageIndexes(config)).toEqual([]);
    const collected = collectPackageArtMasters(config.art.masterRoots, config);
    const plain = collectArtMasters(config.art.masterRoots, "sample");
    expect(collected.findings).toEqual(plain.findings);
    expect(masterAssetRecords(collected.masters)).toEqual(masterAssetRecords(plain.masters));
    expect(resolvePathname("sample/assets/images/deep/own.svg", config)?.foundry).toBe(
        "modules/sample/images/own.svg",
    );
});

it("refuses a pinned index whose bytes differ from its digest, and one never fetched", async () => {
    const index = pictureIndex();
    const config = consumer(index);
    fs.writeFileSync(
        path.join(root, "private", "portrait.svg"),
        master("artsample-none-image-portrait"),
    );
    const location = /package-build\.config\.yaml:\d+:\d+: error: art\.packages\[0\]: /;
    const unfetched = () => collectPackageArtMasters(config.art.masterRoots, config);
    expect(unfetched).toThrow(location);
    expect(unfetched).toThrow(/the index of `artsample` pinned at .* has not been fetched/);
    const tampered = Buffer.concat([index, Buffer.from("\n")]);
    await expect(fetchIndex(config, tampered)).rejects.toThrow(location);
    await expect(fetchIndex(config, tampered)).rejects.toThrow(/download SHA-256 does not match/);
    await fetchIndex(config, index);
    const cached = artPackageIndexFile(config, config.art.packages[0]);
    fs.appendFileSync(cached, "\n");
    expect(() => cachedArtPackageIndexes(config)).toThrow(location);
    expect(() => cachedArtPackageIndexes(config)).toThrow(
        /has SHA-256 [0-9a-f]{64}, not the pinned/,
    );
});

it("refuses a picture-package master whose metadata differs from its indexed row", async () => {
    const index = pictureIndex();
    const config = consumer(index);
    const file = path.join(root, "private", "portrait.svg");
    fs.writeFileSync(
        file,
        master("artsample-none-image-portrait", { license: "CC-BY-4.0", creator: ["Other"] }),
    );
    await fetchIndex(config, index);
    const collected = collectArtMasters(config.art.masterRoots, "sample", {
        dependencyPackages: ["artsample"],
    });
    expect(bindDependencyMasters(collected, config)).toEqual([
        {
            file,
            severity: "error",
            message:
                "master artsample-none-image-portrait differs from the index of `artsample` " +
                'pinned under `art.packages`: creator is ["Other"] in the master and ' +
                '["Artist"] in the index; license is "CC-BY-4.0" in the master and ' +
                '"CC-BY-SA-4.0" in the index',
        },
    ]);
    fs.writeFileSync(file, master("artsample-none-image-absent"));
    expect(collectPackageArtMasters(config.art.masterRoots, config).findings).toEqual([
        {
            file,
            severity: "error",
            message:
                "master address artsample-none-image-absent is not an image or icon in the " +
                "index of `artsample` pinned under `art.packages`",
        },
    ]);
});

it("ships picture-package pictures under a directory named for their package", async () => {
    const index = pictureIndex();
    const config = consumer(index);
    const portrait = path.join(root, "private", "portrait.svg");
    fs.writeFileSync(portrait, master("artsample-none-image-portrait"));
    const own = path.join(root, "private", "portrait-own.svg");
    fs.writeFileSync(own, master("sample-none-image-portrait"));
    await fetchIndex(config, index);
    const collected = collectPackageArtMasters(config.art.masterRoots, config);
    expect(collected.findings).toEqual([]);
    const records = masterAssetRecords(collected.masters);
    const byPackage = (pkg: string) => records.find((record) => record.package === pkg);
    expect(deployedAssetPath(byPackage("artsample"), ["artsample"])).toBe(
        "images/artsample/portrait.svg",
    );
    expect(deployedAssetPath(byPackage("sample"), ["artsample"])).toBe("images/portrait.svg");
    // Only a declared picture package deploys under its own directory.
    expect(deployedAssetPath(byPackage("artsample"))).toBe("images/portrait.svg");

    const site = { ...config, site: { ...config.site, assets: "https://cdn.example.test" } };
    // The pathname a picture package's own index names, and the one this
    // package's record names, resolve to the same place on every surface.
    for (const pathname of [
        "artsample/assets/images/portrait.svg",
        "artsample/assets/images/artsample/portrait.svg",
    ])
        expect(resolvePathname(pathname, site)).toMatchObject({
            package: "artsample",
            own: false,
            served: true,
            local: null,
            foundry: "modules/sample/images/artsample/portrait.svg",
            web: "https://cdn.example.test/sample/images/artsample/portrait.svg",
            pdf: "assets/images/artsample/portrait.svg",
        });
    expect(resolvePathname("sample/assets/images/portrait.svg", site)).toMatchObject({
        own: true,
        served: false,
        foundry: "modules/sample/images/portrait.svg",
        web: "https://cdn.example.test/sample/images/portrait.svg",
    });
    expect(stagedImagePath("artsample/assets/images/portrait.svg", config)).toEqual({
        from: path.join(root, "build/art/images/artsample/portrait.svg"),
        to: "assets/images/artsample/portrait.svg",
        served: true,
    });
    expect(stagedImagePath("sample/assets/images/portrait.svg", config)).toEqual({
        from: path.join(root, "assets/images/portrait.svg"),
        to: "assets/images/portrait.svg",
    });
    // The book finds the master by the key its record is filed under.
    const dependencyRecord = byPackage("artsample");
    expect(assetPathnameKey("artsample/assets/images/portrait.svg", config)).toBe(
        `artsample/assets/${dependencyRecord.asset.path}`,
    );

    const preparedMasters = new Map([
        ["artsample-none-image-portrait", portrait],
        ["sample-none-image-portrait", own],
    ]);
    const stageDir = path.join(root, "stage");
    const staged = stagePackageAssets({
        assetsBase: path.join(root, "assets"),
        contentPackage: "sample",
        stageDir,
        title: "Sample",
        records,
        preparedMasters,
        picturePackages: ["artsample"],
    });
    expect(staged.findings).toEqual([]);
    expect(staged.manifest?.assets.map((entry) => entry.target)).toEqual([
        "images/artsample/portrait.svg",
        "images/portrait.svg",
    ]);
    expect(fs.existsSync(path.join(stageDir, "images", "artsample", "portrait.svg"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "images", "portrait.svg"))).toBe(true);

    const plan = planCdnPublish({
        assetsBase: path.join(root, "assets"),
        contentPackage: "sample",
        host: "https://cdn.example.test",
        setFile: "set.json",
        setName: "Sample",
        records,
        preparedMasters,
        picturePackages: ["artsample"],
    });
    expect(plan.uploads.map((upload) => upload.key).sort()).toEqual([
        "sample/images/artsample/portrait.svg",
        "sample/images/portrait.svg",
    ]);
});

/** A configuration of package `sample` with the given extra keys. */
function sampleConfig(extra: Record<string, unknown>) {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sample", version: "1.0.0" }),
    );
    return configFromData(
        {
            contentPackage: "sample",
            packageKind: "modules",
            stats: { lastModifiedBy: "samplebuilder000" },
            compatibility: { minimum: "14", verified: "14" },
            packs: [],
            ...extra,
        },
        path.join(root, "package-build.config.yaml"),
    );
}

it("refuses a picture package name that cannot be one, or that another declaration holds", () => {
    const pin = (name: string) => ({ package: name, url: INDEX_URL, sha256: "0".repeat(64) });
    const refused = (extra: Record<string, unknown>, message: string) =>
        expect(() => sampleConfig(extra)).toThrow(message);
    refused(
        { art: { packages: [pin("../x")] } },
        "`art.packages[0].package` must be a content package name",
    );
    refused(
        { art: { packages: [pin("Artsample")] } },
        "`art.packages[0].package` must be a content package name",
    );
    refused({ art: { packages: [pin("sample")] } }, "`art.packages[0].package` names this package");
    refused(
        { art: { packages: [pin("artsample"), pin("artsample")] } },
        "`art.packages[1].package` duplicates a picture package",
    );
    refused({ art: { packages: [pin("packagebuild")] } }, "which is a reserved package name");
    refused(
        {
            systems: { sohl: { compatibility: { verified: "0.4.3" } } },
            art: { packages: [pin("sohl")] },
        },
        "names `sohl`, a system this package compiles for",
    );
    refused(
        {
            systems: { sohl: { compatibility: { verified: "0.4.3" } } },
            requiresSystem: "sohl",
            art: { packages: [pin("sohl")] },
        },
        "names `sohl`, a system this package compiles for",
    );
    refused(
        {
            systems: { hm3: { compatibility: { verified: "1.0.0" } } },
            packs: [
                { name: "items", type: "Item", system: "hm3", default: true, mayBeEmpty: true },
            ],
            art: { packages: [pin("hm3")] },
        },
        "names `hm3`, a system this package compiles for",
    );
    expect(() => consumer(pictureIndex(), { packages: [pin("sample")] })).toThrow(
        /package-build\.config\.yaml:\d+:\d+: error: package-build config: `art\.packages\[0\]\.package` names this package/,
    );
    refused(
        {
            relationships: { requires: [{ id: "artsample" }] },
            art: { packages: [pin("artsample")] },
        },
        "which `relationships` already declares",
    );
    expect(sampleConfig({ art: { packages: [pin("artsample")] } }).art.packages).toEqual([
        pin("artsample"),
    ]);
});

it("judges every shape of a picture-package row's path", () => {
    const tuple = { type: "image", shortcode: "portrait" };
    for (const accepted of ["images/portrait.svg", "images/deep/portrait.webp"])
        expect(artPackagePathProblem(accepted, tuple)).toBe("");
    for (const refused of [
        "/images/portrait.svg",
        "images\\portrait.svg",
        "images//portrait.svg",
        "images/./portrait.svg",
        "images/../portrait.svg",
        "icons/portrait.svg",
        "images/other.svg",
        "images/portrait.txt",
        "portrait.svg",
        "",
    ])
        expect(artPackagePathProblem(refused, tuple), refused).not.toBe("");
    expect(artPackagePathProblem(undefined, tuple)).toBe("has no `asset.path`");
});

it("refuses a pinned index holding another package's records, wherever they stand", async () => {
    const own = pictureIndex().toString();
    const first = own.split("\n")[0];
    const relabelled = JSON.stringify({
        ...JSON.parse(first),
        package: "sohl",
        foundry: { sohl: { uuid: "Compendium.sohl.art.Item.portrait" } },
    });
    for (const [label, text, line, problem] of [
        [
            "first",
            `${first.replaceAll("artsample", "sample")}\n${own}`,
            1,
            "holds a record of `sample`",
        ],
        [
            "mixed",
            `${own}${first.replaceAll("artsample", "other")}\n`,
            own.split("\n").length,
            "holds a record of `other`",
        ],
        ["package field", `${relabelled}\n${own}`, 1, "holds a record of `sohl`"],
        [
            "package record",
            `${JSON.stringify({ package: "other", packageModules: [] })}\n${own}`,
            1,
            "holds a record of `other`",
        ],
        [
            "no owner",
            `${JSON.stringify({ type: "image", shortcode: "stray", asset: { path: "images/stray.svg" } })}\n${own}`,
            1,
            "holds a record of `no package`",
        ],
        [
            "modules",
            `${JSON.stringify({ package: "artsample", packageModules: ["ghost"] })}\n${own}`,
            1,
            "requires the modules ghost; a picture package's index requires no other package",
        ],
    ] as const) {
        fs.rmSync(root, { recursive: true, force: true });
        const index = Buffer.from(text);
        const config = consumer(index);
        await fetchIndex(config, index);
        const escaped = problem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const refusal = new RegExp(
            `art\\.packages\\[0\\]: .*:${line}: the index pinned as \`artsample\` ${escaped}`,
        );
        expect(() => loadForeignIndexes(config, [config.contentPackage]), label).toThrow(refusal);
        expect(() => cachedArtPackageIndexes(config), label).toThrow(refusal);
    }
});

it("files a pinned index under the package it is pinned as", async () => {
    const index = pictureIndex();
    const config = consumer(index);
    await fetchIndex(config, index);
    const [entry] = cachedArtPackageIndexes(config);
    expect(entry).toMatchObject({ id: "artsample", picture: true, text: index.toString() });
    const foreign = loadForeignIndexes(config, [config.contentPackage]);
    expect(foreign.index.get("artsample-none-image-portrait")?.package).toBe("artsample");
    expect(await cachedDependencies(config)).toEqual([]);
});

it("keeps the book's copies inside the package and its output", () => {
    const outDir = path.join(root, "book");
    const inside = { from: path.join(root, "assets/images/portrait.svg") };
    expect(() =>
        assertStagedInside(inside, path.join(outDir, "assets/images/portrait.svg"), root, outDir),
    ).not.toThrow();
    expect(() =>
        assertStagedInside(
            { from: path.join(root, "..", "elsewhere.svg") },
            path.join(outDir, "elsewhere.svg"),
            root,
            outDir,
        ),
    ).toThrow("resolves outside the package or the book's output directory");
    expect(() =>
        assertStagedInside(inside, path.join(outDir, "..", "escaped.svg"), root, outDir),
    ).toThrow("resolves outside the package or the book's output directory");
});

it("stages a consumer's picture-package pictures through the build's stage", async () => {
    const index = pictureIndex();
    const config = consumer(index);
    fs.writeFileSync(
        path.join(root, "private", "portrait.svg"),
        master("artsample-none-image-portrait"),
    );
    fs.writeFileSync(path.join(root, "private", "own.svg"), master("sample-none-image-portrait"));
    fs.mkdirSync(path.join(root, "assets", "content"), { recursive: true });
    fs.writeFileSync(
        path.join(root, "assets", "content", "harbor.md"),
        `---\n${YAML.stringify({
            type: "lore",
            subType: "history",
            shortcode: "harbor",
            name: { full: "The Harbor" },
            description: "The harbor.",
        })}---\n\n![[artsample-none-image-portrait|The portrait]]\n`,
    );
    await fetchIndex(config, index);
    await stagePackageBuildAssets({
        config: {
            rootDir: root,
            assets: [],
            stageDir: "build/stage",
            baseStyles: false,
            shippingLicenses: [],
            manifest: { title: "Sample" },
        } as any,
        packConfig: config,
    });
    const stage = path.join(root, "build", "stage");
    expect(fs.existsSync(path.join(stage, "images", "artsample", "portrait.svg"))).toBe(true);
    expect(fs.existsSync(path.join(stage, "images", "portrait.svg"))).toBe(true);
    const set = JSON.parse(fs.readFileSync(path.join(stage, "asset-sets", "default.json"), "utf8"));
    expect(set.assets.map((entry: { target: string }) => entry.target)).toEqual([
        "images/artsample/portrait.svg",
        "images/portrait.svg",
    ]);
});

it("refuses a pinned index row whose path leaves the package's pictures", async () => {
    const hostile = Buffer.from(
        pictureIndex()
            .toString()
            .replace('"path":"images/portrait.svg"', '"path":"images/../../../portrait.svg"'),
    );
    expect(hostile.toString()).toContain("images/../../../portrait.svg");
    const config = consumer(hostile);
    fs.writeFileSync(
        path.join(root, "private", "portrait.svg"),
        master("artsample-none-image-portrait"),
    );
    await fetchIndex(config, hostile);
    const refusal =
        /package-build\.config\.yaml:\d+:\d+: error: art\.packages\[0\]: .*:1: artsample-none-image-portrait has `asset\.path` "images\/\.\.\/\.\.\/\.\.\/portrait\.svg"/;
    expect(() => collectPackageArtMasters(config.art.masterRoots, config)).toThrow(refusal);
    expect(() => loadForeignIndexes(config, [config.contentPackage])).toThrow(refusal);
});

it("compares the dimensions of a raster master with its indexed row", async () => {
    const credit = {
        address: "artsample-none-image-map",
        ai: false,
        creator: ["Artist"],
        license: "CC-BY-SA-4.0",
    };
    const raster = (width: number) => {
        const image = new PNG({ width, height: 2 });
        image.data.fill(255);
        return writeProvenance(PNG.sync.write(image), credit).bytes;
    };
    const index = pictureIndex([["map.png", raster(3)]]);
    const config = consumer(index);
    const file = path.join(root, "private", "map.png");
    fs.writeFileSync(file, raster(4));
    await fetchIndex(config, index);
    expect(collectPackageArtMasters(config.art.masterRoots, config).findings).toEqual([
        {
            file,
            severity: "error",
            message:
                "master artsample-none-image-map differs from the index of `artsample` pinned " +
                "under `art.packages`: width is 4 in the master and 3 in the index",
        },
    ]);
    fs.writeFileSync(file, raster(3));
    const matched = collectPackageArtMasters(config.art.masterRoots, config);
    expect(matched.findings).toEqual([]);
    expect(masterAssetRecords(matched.masters)[0].asset).toMatchObject({
        path: "images/artsample/map.jpg",
        width: 3,
        height: 2,
    });
});

/** The consuming package's records, its foreign index and its link index. */
async function consumerBuild(extraArt: Record<string, unknown> = {}) {
    const index = pictureIndex([["harbor.svg", master("artsample-none-image-harbor")]]);
    const config = consumer(index, extraArt);
    fs.writeFileSync(
        path.join(root, "private", "portrait.svg"),
        master("artsample-none-image-portrait"),
    );
    fs.writeFileSync(
        path.join(root, "private", "missing.svg"),
        master("sample-none-image-missing"),
    );
    await fetchIndex(config, index);
    const collected = collectPackageArtMasters(config.art.masterRoots, config);
    expect(collected.findings).toEqual([]);
    const records = collectContentIndex(path.join(root, "content"), {
        skipDirectories: [],
        contentPackage: "sample",
        assetsBase: path.join(root, "assets"),
        masterRecords: masterAssetRecords(collected.masters),
    });
    const foreign = loadForeignIndexes(config, [config.contentPackage]);
    return { config, records, foreign, links: assetAddressIndex(records, { config, foreign }) };
}

it("draws a picture-package picture in compendium documents, and the stand-in for one with no master", async () => {
    const { config, links } = await consumerBuild();
    const lookup = assetReferenceLookup(links, config);
    expect(lookup.byAddress.get("artsample-none-image-portrait")).toMatchObject({
        foundry: "modules/sample/images/artsample/portrait.svg",
        shipper: "sample",
        shipped: true,
    });
    expect(lookup.byAddress.get("artsample-none-image-harbor")).toMatchObject({
        foundry: "modules/sample/images/artsample/harbor.svg",
        shipper: "sample",
        shipped: false,
    });
    const reports: string[] = [];
    const report = (message: string) => void reports.push(message);
    expect(
        annotateHtml('<img src="modules/sample/images/artsample/portrait.svg">', lookup, report),
    ).toBe(
        '<img src="modules/sample/images/artsample/portrait.svg" data-asset="artsample-none-image-portrait">',
    );
    expect(
        annotateHtml('<img src="modules/sample/images/artsample/harbor.svg">', lookup, report),
    ).toBe(
        '<img src="modules/sample/images/missing.svg" data-asset="artsample-none-image-harbor">',
    );
    expect(reports).toEqual([]);
    expect(readAssetAddress(links, "artsample-none-image-portrait", "image").pathname).toBe(
        "artsample/assets/images/artsample/portrait.svg",
    );
});

it("reports a picture-package picture cited without a master, as an error when originals are configured", async () => {
    const note = {
        frontmatter: { data: { banner: "artsample-none-image-harbor" } },
        body: "![[artsample-none-image-portrait|Portrait]]\n\n![[artsample-none-image-harbor|Harbor]]\n",
        raw: "---\ndata:\n  banner: artsample-none-image-harbor\n---\n![[artsample-none-image-portrait|Portrait]]\n\n![[artsample-none-image-harbor|Harbor]]\n",
    };
    const parsed = new Map([["content/place.md", note]]);
    const message = (written: string) =>
        `\`${written}\` names artsample-none-image-harbor, a picture of \`artsample\` whose ` +
        "master this build does not hold, so this package does not ship it; supply its " +
        "original in the artwork archives or master roots, or name another picture";
    const { config, records, foreign } = await consumerBuild();
    const indexed = (address: string) => foreign.index.get(address);
    expect(checkUnmasteredPictures(records, { parsed, config, indexed })).toEqual([
        {
            file: "content/place.md",
            line: 3,
            column: 11,
            severity: "error",
            message: message("artsample-none-image-harbor"),
        },
        {
            file: "content/place.md",
            line: 7,
            column: 4,
            severity: "error",
            message: message("artsample-none-image-harbor"),
        },
    ]);
    const withoutOriginals = { ...config, art: { ...config.art, masterRoots: [], archives: [] } };
    expect(
        checkUnmasteredPictures(records, { parsed, config: withoutOriginals, indexed }).map(
            (finding) => finding.severity,
        ),
    ).toEqual(["warning", "warning"]);
});

it("applies the package's added licences to a picture package's alternative", () => {
    const config = sampleConfig({
        art: { packages: [{ package: "artsample", url: INDEX_URL, sha256: "0".repeat(64) }] },
        packageBuild: { shippingLicenses: ["LicenseRef-Custom"] },
    });
    const target = {
        package: "artsample",
        type: "image",
        shortcode: "plain",
        address: { canonical: "artsample-none-image-plain" },
        asset: { path: "images/artsample/plain.svg", ai: false, license: "LicenseRef-Custom" },
    };
    const index = new Map([["artsample-none-image-plain", target]]);
    const record = {
        address: { canonical: "sample-none-image-made" },
        asset: { ai: true, nonAiAlternative: "artsample-none-image-plain" },
    };
    expect(alternativeProblem(record, index, config)).toBe("");
    const undeclared = sampleConfig({ packageBuild: { shippingLicenses: ["LicenseRef-Custom"] } });
    expect(alternativeProblem(record, index, undeclared)).toContain(
        "names an undeclared or optional package",
    );
});

it("leaves picture-package rows out of the package's own published index", async () => {
    const { records } = await consumerBuild();
    expect(records.some((record) => record.package === "artsample")).toBe(true);
    const published = publishedIndexRecords(records, "sample");
    expect(published.some((record) => record.package === "artsample")).toBe(false);
    expect(published.some((record) => record.package === "sample")).toBe(true);
    expect(serializeContentIndex(published)).not.toContain("artsample");
});

it("builds a package that declares no picture packages exactly as before", async () => {
    const golden = JSON.parse(
        fs.readFileSync(
            path.resolve("tests/fixtures/art-packages/no-picture-packages.json"),
            "utf8",
        ),
    );
    const outputs = await noPicturePackageOutputs(path.join(root, "golden"));
    expect(JSON.parse(JSON.stringify(outputs))).toEqual(golden);
});
