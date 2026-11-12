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
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import {
    collectArtMasters,
    assertPrivateArtRoots,
    masterAssetRecords,
    shippingAssetRecords,
} from "../engine/art-masters.mjs";
import { renderArtMasters } from "../engine/art-master-render.mjs";
import {
    readProvenance,
    readSvgProvenance,
    readWebpProvenance,
    writeProvenance,
    writeSvgProvenance,
} from "../engine/art-provenance.mjs";
import { collectAssetRecords } from "../engine/asset-index.mjs";
import { stagePackageAssets } from "../engine/asset-shipping.mjs";
import { planCdnPublish } from "../engine/cdn-publish.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import { noteTree } from "../engine/note-cache.mjs";
import { createContentSession } from "../engine/content-session.mjs";
import { stagePackageBuildAssets } from "../engine/build-assets.mjs";
import { resetStage } from "../stage.mjs";

const root = path.resolve("build/art-masters-test");
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it("refuses a staging source containing a link into private masters", () => {
    const privateRoot = path.join(root, "private");
    const publicRoot = path.join(root, "public");
    fs.mkdirSync(privateRoot, { recursive: true });
    fs.mkdirSync(publicRoot, { recursive: true });
    fs.symlinkSync(privateRoot, path.join(publicRoot, "linked"));
    expect(() => assertPrivateArtRoots([privateRoot], [publicRoot])).toThrow(/overlap/);
});

it("resolves a missing output through an existing symlink parent", () => {
    const privateRoot = path.join(root, "private");
    fs.mkdirSync(privateRoot, { recursive: true });
    const link = path.join(root, "alias");
    fs.symlinkSync(privateRoot, link);
    expect(() => assertPrivateArtRoots([privateRoot], [path.join(link, "missing")])).toThrow(
        /overlap/,
    );
    expect(fs.existsSync(path.join(privateRoot, "missing"))).toBe(false);
});

it.each([false, true])(
    "refuses a stage destination inside private masters (symlink: %s)",
    async (alias) => {
        const privateRoot = path.join(root, "private");
        fs.mkdirSync(privateRoot, { recursive: true });
        const source = path.join(privateRoot, "master.svg");
        fs.writeFileSync(source, "private input");
        if (alias) fs.symlinkSync(privateRoot, path.join(root, "alias"));
        await expect(
            stagePackageBuildAssets({
                config: {
                    rootDir: root,
                    assets: [],
                    stageDir: alias ? "alias/stage" : "private/stage",
                    baseStyles: false,
                } as any,
                packConfig: {
                    rootDir: root,
                    paths: { assets: path.join(root, "assets") },
                    contentPackage: "sample",
                    art: { masterRoots: [privateRoot] },
                } as any,
            }),
        ).rejects.toThrow(/overlap/);
        expect(fs.readFileSync(source, "utf8")).toBe("private input");
        expect(fs.existsSync(path.join(privateRoot, "stage"))).toBe(false);
    },
);

it.each([
    { command: ["clean"], privateRoot: "build/private", stageDir: "build/stage" },
    { command: ["stage", "reset"], privateRoot: "private", stageDir: "private" },
    { command: ["manifest"], privateRoot: "private", stageDir: "private" },
])("refuses $command before changing private masters", ({ command, privateRoot, stageDir }) => {
    const directory = path.join(root, privateRoot);
    fs.mkdirSync(directory, { recursive: true });
    const source = path.join(directory, "master.svg");
    fs.writeFileSync(source, "private input");
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sample", version: "1.0.0" }),
    );
    const configFile = path.join(root, "package-build.config.yaml");
    fs.writeFileSync(
        configFile,
        JSON.stringify({
            contentPackage: "sample",
            packageKind: "modules",
            stats: { lastModifiedBy: "samplebuilder000" },
            compatibility: { minimum: "14", verified: "14" },
            packs: [],
            art: { masterRoots: [privateRoot] },
            packageBuild: { stageDir },
        }),
    );
    const result = spawnSync(
        process.execPath,
        [path.resolve("bin/package-build.mjs"), ...command],
        { cwd: root, encoding: "utf8", env: { ...process.env, PACKAGE_BUILD_CONFIG: configFile } },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/overlap/);
    expect(fs.readFileSync(source, "utf8")).toBe("private input");
});

it("allows removing a stage containing a symlink to private masters", () => {
    const privateRoot = path.join(root, "private");
    const stage = path.join(root, "stage");
    fs.mkdirSync(privateRoot, { recursive: true });
    fs.mkdirSync(stage, { recursive: true });
    const source = path.join(privateRoot, "master.svg");
    fs.writeFileSync(source, "private input");
    fs.symlinkSync(privateRoot, path.join(stage, "link"));
    expect(() =>
        assertPrivateArtRoots([privateRoot], [stage], { inspectChildren: false }),
    ).not.toThrow();
    expect(resetStage(root, "stage")).toBe(true);
    expect(fs.readFileSync(source, "utf8")).toBe("private input");
});

it("round-trips the exact license ID in PNG and SVG master provenance", async () => {
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } })
        .png()
        .toBuffer();
    const fields = { address: "sample-none-image-example", license: "CC-BY-SA-4.0" };
    expect(readProvenance(writeProvenance(png, fields).bytes).record.license).toBe(fields.license);
    expect(
        readSvgProvenance(
            writeSvgProvenance('<svg xmlns="http://www.w3.org/2000/svg"/>', fields).bytes,
        ).record.license,
    ).toBe(fields.license);
});

it("indexes PNG and SVG identities and reports missing and duplicate identities", async () => {
    fs.mkdirSync(root, { recursive: true });
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } })
        .png()
        .toBuffer();
    const address = "sample-none-image-example";
    fs.writeFileSync(path.join(root, "one.png"), writeProvenance(png, { address }).bytes);
    fs.writeFileSync(
        path.join(root, "two.svg"),
        writeSvgProvenance('<svg xmlns="http://www.w3.org/2000/svg"/>', {
            address: "sample-none-icon-example",
        }).bytes,
    );
    fs.writeFileSync(path.join(root, "ignored.webp"), Buffer.from("ignored"));
    let result = collectArtMasters([root], "sample");
    expect(result.findings).toEqual([]);
    expect([...result.masters.keys()].sort()).toEqual([address, "sample-none-icon-example"].sort());
    fs.renameSync(path.join(root, "one.png"), path.join(root, "renamed.png"));
    expect([...collectArtMasters([root], "sample").masters.keys()].sort()).toEqual(
        [...result.masters.keys()].sort(),
    );
    fs.writeFileSync(path.join(root, "missing.png"), png);
    fs.copyFileSync(path.join(root, "renamed.png"), path.join(root, "duplicate.png"));
    result = collectArtMasters([root], "sample");
    expect(result.findings).toHaveLength(3);
    expect(result.findings.filter((f) => f.message.includes("duplicate"))).toHaveLength(2);
});

it("refuses malformed addresses and derivative SVGs", () => {
    fs.mkdirSync(root, { recursive: true });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const valid = writeSvgProvenance(svg, {
        address: "sample-none-image-example",
    }).bytes.toString();
    fs.writeFileSync(
        path.join(root, "bad.svg"),
        valid.replaceAll("sample-none-image-example", "bad"),
    );
    fs.writeFileSync(
        path.join(root, "derived.svg"),
        writeSvgProvenance(svg, { address: "sample-none-image-example", derived: "true" }).bytes,
    );
    const result = collectArtMasters([root], "sample");
    expect(result.masters.size).toBe(0);
    expect(result.findings).toHaveLength(2);
});

it("renders stable derivatives and preserves targets across a private master move", async () => {
    const privateRoot = path.join(root, "private");
    const assets = path.join(root, "assets");
    fs.mkdirSync(privateRoot, { recursive: true });
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } })
        .withExif({ IFD0: { ImageDescription: "foreign-private-fixture" } })
        .png()
        .toBuffer();
    const address = "sample-none-image-example";
    const original = writeProvenance(png, {
        address,
        license: "CC-BY-SA-4.0",
        creator: "Author",
        rights: "Terms",
        digitalSourceType: "digitalCreation",
        prompt: "private text",
        primaryNote: "sample-note-being-person",
        name: "Private name",
    }).bytes;
    const source = path.join(privateRoot, "source.png");
    fs.writeFileSync(source, original);
    const master = collectArtMasters([privateRoot], "sample");
    const records = collectAssetRecords(assets, {
        contentPackage: "sample",
        masterRecords: masterAssetRecords(master.masters),
    });
    fs.mkdirSync(path.join(assets, "images"), { recursive: true });
    const stale = path.join(assets, "images", "example.webp");
    fs.writeFileSync(stale, "stale public derivative");
    expect(
        collectAssetRecords(assets, {
            contentPackage: "sample",
            masterRecords: masterAssetRecords(master.masters),
        }),
    ).toEqual(records);
    const notes = [
        {
            type: "being",
            address: { canonical: "sample-note-being-person" },
            name: { full: "Public name" },
            tags: [],
        },
    ];
    const out = path.join(root, "render");
    const prepared = await renderArtMasters(master.masters, notes, out);
    const first = fs.readFileSync(prepared.get(address)!);
    expect(original.includes(Buffer.from("foreign-private-fixture"))).toBe(true);
    expect(first.includes(Buffer.from("foreign-private-fixture"))).toBe(false);
    const metadata = readWebpProvenance(first).record;
    expect(metadata).toMatchObject({
        address,
        creator: "Author",
        rights: "Terms",
        name: "Public name",
        primaryNote: "sample-note-being-person",
        derivedFrom: address,
    });
    expect(metadata.prompt).toBeUndefined();
    expect(metadata.license).toBeUndefined();
    expect(JSON.stringify(records)).not.toContain("private text");
    expect(JSON.stringify(records)).not.toContain(privateRoot);
    const staged = stagePackageAssets({
        assetsBase: assets,
        contentPackage: "sample",
        stageDir: path.join(root, "stage"),
        title: "Sample",
        records,
        preparedMasters: prepared,
    });
    expect(staged.findings).toEqual([]);
    expect(staged.staged).toHaveLength(1);
    const plan = planCdnPublish({
        assetsBase: assets,
        contentPackage: "sample",
        host: "https://example.test",
        setFile: "set.json",
        setName: "Sample",
        records,
        preparedMasters: prepared,
    });
    expect(plan.uploads[0].body.equals(first)).toBe(true);
    expect(plan.uploads[0].target).toBe("images/example.webp");
    fs.renameSync(source, path.join(privateRoot, "renamed.png"));
    const moved = collectArtMasters([privateRoot], "sample");
    const movedRecords = collectAssetRecords(assets, {
        contentPackage: "sample",
        masterRecords: masterAssetRecords(moved.masters),
    });
    expect(movedRecords).toEqual(records);
    const repeated = await renderArtMasters(moved.masters, notes, out);
    expect(fs.readFileSync(repeated.get(address)!).equals(first)).toBe(true);
    expect(fs.readFileSync(path.join(privateRoot, "renamed.png")).equals(original)).toBe(true);
    expect(fs.readFileSync(stale, "utf8")).toBe("stale public derivative");
});

it("withholds private note names and safely excludes unknown classification", async () => {
    const privateRoot = path.join(root, "private");
    fs.mkdirSync(privateRoot, { recursive: true });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    const address = "sample-none-image-example";
    const bytes = writeSvgProvenance(svg, {
        address,
        license: "CC-BY-SA-4.0",
        creator: "Author",
        rights: "Terms",
        digitalSourceType: "algorithmicMedia",
        primaryNote: "sample-note-being-person",
        name: "Private name",
        prompt: "private text",
    }).bytes;
    fs.writeFileSync(path.join(privateRoot, "source.svg"), bytes);
    const master = collectArtMasters([privateRoot], "sample");
    const records = collectAssetRecords(path.join(root, "assets"), {
        contentPackage: "sample",
        masterRecords: masterAssetRecords(master.masters),
    });
    expect(records[0].asset.ai).toBeNull();
    const notes = [
        {
            type: "being",
            address: { canonical: "sample-note-being-person" },
            name: { full: "Private name" },
            tags: ["gm"],
        },
    ];
    const prepared = await renderArtMasters(master.masters, notes, path.join(root, "render"));
    const output = readSvgProvenance(fs.readFileSync(prepared.get(address)!)).record;
    expect(output.name).toBeUndefined();
    expect(output.primaryNote).toBeUndefined();
    expect(output.prompt).toBeUndefined();
    const stage = stagePackageAssets({
        assetsBase: path.join(root, "assets"),
        contentPackage: "sample",
        stageDir: path.join(root, "stage"),
        title: "Sample",
        records,
        preparedMasters: prepared,
    });
    expect(stage.staged).toHaveLength(0);
    expect(stage.excluded).toHaveLength(1);
});

it("captures masters once per session and observes changed inputs in a fresh session", async () => {
    const privateRoot = path.join(root, "private");
    fs.mkdirSync(privateRoot, { recursive: true });
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
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    const file = path.join(privateRoot, "one.svg");
    fs.writeFileSync(
        file,
        writeSvgProvenance(svg, {
            address: "sample-none-image-first",
            license: "CC-BY-SA-4.0",
            digitalSourceType: "digitalCreation",
        }).bytes,
    );
    const first = await createContentSession({ config, trackChanges: true });
    expect(first.records.some((record) => record.address?.canonical?.shortcode === "first")).toBe(
        true,
    );
    expect(shippingAssetRecords(first.records)[0].address.canonical).toBe(
        "sample-none-image-first",
    );
    const firstTree = await noteTree(config, { toolchain: "test" });
    expect(firstTree.cache.tree).toBe("off");
    const code = `require('./sohl/item-builders.mjs');
const { indexRecordsFor } = await import('./engine/content-index.mjs');
const { configFromData } = require('./engine/pack-config.mjs');
const config = configFromData(${JSON.stringify({ contentPackage: "sample", packageKind: "modules", stats: { lastModifiedBy: "samplebuilder000" }, compatibility: { minimum: "14", verified: "14" }, packs: [], art: { masterRoots: ["private"] } })}, ${JSON.stringify(path.join(root, "package-build.config.yaml"))});
if (!indexRecordsFor({config}).some(record => record.address?.canonical?.shortcode === 'first')) process.exit(1);`;
    const sync = spawnSync(
        process.execPath,
        [
            "--input-type=module",
            "-e",
            `import {createRequire} from 'node:module'; const require = createRequire(import.meta.url); ${code}`,
        ],
        { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(sync.status, sync.stderr).toBe(0);
    await stagePackageBuildAssets({
        config: { rootDir: root, assets: [], stageDir: "stage", baseStyles: false } as any,
        packConfig: config,
        session: first,
    });
    expect(fs.existsSync(path.join(root, "stage", "images", "first.svg"))).toBe(true);
    fs.writeFileSync(file, writeSvgProvenance(svg, { address: "sample-none-image-second" }).bytes);
    expect(() => first.assertUnchanged()).toThrow(/Content sources changed/);
    const second = await createContentSession({ config });
    expect(second.records.some((record) => record.address?.canonical?.shortcode === "second")).toBe(
        true,
    );
    const secondTree = await noteTree(config, { toolchain: "test" });
    expect(
        secondTree.records.some((record) => record.address?.canonical?.shortcode === "second"),
    ).toBe(true);
    first.dispose();
    second.dispose();
});

it("refuses a private root inside a build output before clearing it", () => {
    const privateRoot = path.join(root, "build", "content-index", "private");
    fs.mkdirSync(privateRoot, { recursive: true });
    const source = path.join(privateRoot, "master.svg");
    fs.writeFileSync(source, "private input");
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sample", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(root, "package-build.config.yaml"),
        JSON.stringify({
            contentPackage: "sample",
            packageKind: "modules",
            stats: { lastModifiedBy: "samplebuilder000" },
            compatibility: { minimum: "14", verified: "14" },
            packs: [],
            art: { masterRoots: ["build/content-index/private"] },
        }),
    );
    const result = spawnSync(
        process.execPath,
        [
            path.resolve("bin/package-build.mjs"),
            "content",
            "build",
            "--calendaria-version",
            "1.4.2",
        ],
        {
            cwd: root,
            encoding: "utf8",
            env: {
                ...process.env,
                PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
            },
        },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/overlap/);
    expect(fs.readFileSync(source, "utf8")).toBe("private input");
});
