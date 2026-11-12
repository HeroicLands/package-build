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

import { afterEach, expect, it, vi } from "vitest";
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
import { checkArtSlotSizes } from "../engine/art-fields.mjs";
import { artSource } from "../engine/art-source.mjs";
import { publishToCdn } from "../engine/cdn-publish.mjs";
import { createContentSession } from "../engine/content-session.mjs";
import { emitContentIndex } from "../engine/content-index.mjs";
import { stagePackageBuildAssets } from "../engine/build-assets.mjs";
import { resetStage } from "../stage.mjs";
import { generatePacksJson } from "../engine/generate.mjs";
import { cleanPacks, compilePacks, unpackPacks } from "../engine/compendiums.mjs";
import { buildPackageSite } from "../engine/site-render.mjs";
import { writeSiteRoot } from "../engine/site-root.mjs";
import { runContext } from "../engine/content-scripts.mjs";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";
import * as provenanceCore from "../engine/art-provenance-core.mjs";

const root = path.resolve("build/art-masters-test");
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it("refuses a staging source containing a link into private masters", () => {
    const privateRoot = path.join(root, "private");
    const publicRoot = path.join(root, "public");
    fs.mkdirSync(privateRoot, { recursive: true });
    fs.mkdirSync(publicRoot, { recursive: true });
    fs.symlinkSync(privateRoot, path.join(publicRoot, "linked"));
    expect(() => assertPrivateArtRoots([privateRoot], [publicRoot], { role: "input" })).toThrow(
        `private master root ${privateRoot} overlaps input ${path.join(publicRoot, "linked")}`,
    );
});

it("reports links in master roots and refuses physical aliases", () => {
    const privateRoot = path.join(root, "private");
    fs.mkdirSync(privateRoot, { recursive: true });
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sample", version: "1.0.0" }),
    );
    fs.writeFileSync(path.join(privateRoot, "master.svg"), "<svg/>");
    fs.symlinkSync(path.join(privateRoot, "master.svg"), path.join(privateRoot, "linked.svg"));
    fs.symlinkSync(privateRoot, path.join(privateRoot, "linked-directory"));
    fs.symlinkSync(privateRoot, path.join(root, "alias"));
    const result = collectArtMasters([privateRoot], "sample");
    expect(
        result.findings.some(
            (finding) =>
                finding.file.endsWith("linked.svg") && finding.message.includes("symbolic links"),
        ),
    ).toBe(true);
    expect(
        result.findings.some(
            (finding) =>
                finding.file.endsWith("linked-directory") &&
                finding.message.includes("symbolic links"),
        ),
    ).toBe(true);
    expect(() =>
        configFromData(
            {
                contentPackage: "sample",
                packageKind: "modules",
                stats: { lastModifiedBy: "samplebuilder000" },
                compatibility: { minimum: "14", verified: "14" },
                packs: [],
                art: { masterRoots: ["private", "alias"] },
            },
            path.join(root, "package-build.config.yaml"),
        ),
    ).toThrow(/overlaps/);
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

it("refuses an asset row that reaches a private master through its destination", async () => {
    const privateRoot = path.join(root, "private");
    fs.mkdirSync(privateRoot, { recursive: true });
    const master = path.join(privateRoot, "master.svg");
    fs.writeFileSync(master, "private input");
    fs.writeFileSync(path.join(root, "public.txt"), "public replacement");
    await expect(
        stagePackageBuildAssets({
            config: {
                rootDir: root,
                assets: [
                    {
                        from: "public.txt",
                        to: path.relative(path.join(root, "build", "stage"), master),
                    },
                ],
                stageDir: "build/stage",
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
    expect(fs.readFileSync(master, "utf8")).toBe("private input");
    expect(fs.existsSync(path.join(root, "build", "stage"))).toBe(false);
});

it("refuses index output inside private masters before writing", () => {
    const privateRoot = path.join(root, "private");
    fs.mkdirSync(privateRoot, { recursive: true });
    const source = path.join(privateRoot, "master.svg");
    fs.writeFileSync(source, "private input");
    expect(() =>
        emitContentIndex({
            config: {
                rootDir: root,
                contentPackage: "sample",
                paths: { content: path.join(root, "content"), contentIndex: privateRoot },
                art: { masterRoots: [privateRoot] },
            },
        }),
    ).toThrow(/overlap/);
    expect(fs.readFileSync(source, "utf8")).toBe("private input");
    expect(fs.existsSync(path.join(privateRoot, "sample-metadata.jsonl"))).toBe(false);
});

it("guards standalone pack and site outputs before touching private masters", async () => {
    const privateRoot = path.join(root, "private");
    fs.mkdirSync(privateRoot, { recursive: true });
    const source = path.join(privateRoot, "master.svg");
    fs.writeFileSync(source, "private input");
    const config = {
        rootDir: root,
        art: { masterRoots: [privateRoot] },
        paths: {
            content: path.join(root, "content"),
            packJson: root,
            stage: path.join(root, "stage"),
            unpack: privateRoot,
        },
        packs: [{ name: "private", companions: [] }],
        packDirectories: ["private"],
    } as any;
    await expect(generatePacksJson({ config })).rejects.toThrow(/overlap/);
    await expect(
        compilePacks({ config, sourcePacks: ["private"], stageDest: root }),
    ).rejects.toThrow(/overlap/);
    await expect(cleanPacks({ config, packDest: privateRoot })).rejects.toThrow(/overlap/);
    await expect(
        unpackPacks({ config, packs: [{ name: "private" }] as any, packDest: root }),
    ).rejects.toThrow(/overlap/);
    await expect(buildPackageSite({ config, out: privateRoot })).rejects.toThrow(/overlap/);
    await expect(
        writeSiteRoot({ pkg: "sample", out: privateRoot, masterRoots: [privateRoot] }),
    ).rejects.toThrow(/overlap/);
    expect(fs.readFileSync(source, "utf8")).toBe("private input");
});

it("refuses a directory destination containing a symlink to private masters", async () => {
    const privateRoot = path.join(root, "private");
    const destination = path.join(root, "outside");
    fs.mkdirSync(privateRoot, { recursive: true });
    fs.mkdirSync(destination, { recursive: true });
    fs.mkdirSync(path.join(root, "public"), { recursive: true });
    const master = path.join(privateRoot, "master.svg");
    fs.writeFileSync(master, "private input");
    fs.writeFileSync(path.join(root, "public", "link"), "public replacement");
    fs.symlinkSync(master, path.join(destination, "link"));
    await expect(
        stagePackageBuildAssets({
            config: {
                rootDir: root,
                assets: [
                    {
                        from: "public",
                        to: path.relative(path.join(root, "build", "stage"), destination),
                    },
                ],
                stageDir: "build/stage",
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
    expect(fs.readFileSync(master, "utf8")).toBe("private input");
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

it("reports each public asset superseded by a master", () => {
    const assets = path.join(root, "assets");
    const publicFile = path.join(assets, "images", "example.svg");
    fs.mkdirSync(path.dirname(publicFile), { recursive: true });
    fs.writeFileSync(publicFile, "<svg/>");
    const warnings: any[] = [];
    const masterRecords = [{ address: { canonical: "sample-none-image-example" }, asset: {} }];
    const records = collectAssetRecords(assets, {
        contentPackage: "sample",
        masterRecords,
        warnings,
    });
    expect(records).toEqual(masterRecords);
    expect(warnings).toEqual([
        {
            file: publicFile,
            severity: "warning",
            message: "public asset sample-none-image-example is superseded by a private master",
        },
    ]);
    warnings.length = 0;
    fs.unlinkSync(publicFile);
    collectAssetRecords(assets, { contentPackage: "sample", masterRecords, warnings });
    expect(warnings).toEqual([]);
});

it("locates diagnostics at the master without publishing the source path", async () => {
    const privateRoot = path.join(root, "private");
    fs.mkdirSync(privateRoot, { recursive: true });
    const source = path.join(privateRoot, "master.png");
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } })
        .png()
        .toBuffer();
    fs.writeFileSync(source, writeProvenance(png, { address: "sample-none-image-example" }).bytes);
    const assets = path.join(root, "assets");
    const reads = vi.spyOn(fs, "readFileSync");
    const master = collectArtMasters([privateRoot], "sample");
    const records = collectAssetRecords(assets, {
        contentPackage: "sample",
        masterRecords: masterAssetRecords(master.masters),
    });
    expect(reads.mock.calls.filter(([name]) => name === source)).toHaveLength(1);
    reads.mockRestore();
    const findings = checkArtSlotSizes(
        [{ type: "place", data: { banner: "image-example" } }, ...records],
        { config: { contentPackage: "sample" }, assetsBase: assets },
    );
    expect(findings[0].file).toBe(source);
    expect(JSON.stringify(records)).not.toContain(privateRoot);
    const copied = shippingAssetRecords(records);
    expect(artSource(copied[0], assets)).toBe(source);
    const body = path.join(root, "body.webp");
    fs.writeFileSync(body, "fixture");
    const plan = planCdnPublish({
        assetsBase: assets,
        contentPackage: "sample",
        host: "https://example.test",
        setFile: "set.json",
        setName: "Sample",
        records: copied,
        preparedMasters: new Map([["sample-none-image-example", body]]),
    });
    const result = await publishToCdn(plan, {
        store: {
            describe: "fixture",
            size: async () => {
                throw new Error("fixture failure");
            },
        } as any,
        dryRun: true,
    });
    expect(artSource(result.failed[0].upload.record, assets)).toBe(source);
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
    const secondRoot = path.join(root, "second");
    const assets = path.join(root, "assets");
    fs.mkdirSync(privateRoot, { recursive: true });
    fs.mkdirSync(secondRoot, { recursive: true });
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
            art: { masterRoots: ["private", "second"] },
        },
        path.join(root, "package-build.config.yaml"),
    );
    const foreign = "sample-note-being-hidden Private name private text";
    const packet = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:p="urn:private"><p:credit>${foreign}</p:credit></rdf:Description></rdf:RDF></x:xmpmeta>`;
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } })
        .withExif({ IFD0: { ImageDescription: foreign } })
        .withXmp(packet)
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
    const master = collectArtMasters([privateRoot, secondRoot], "sample");
    const sessionBefore = await createContentSession({ config });
    const runs = runContext(config, sessionBefore.records);
    expect(
        renderFoundryMarkdown(
            "![Example](images/example.webp)\n",
            undefined,
            undefined,
            undefined,
            undefined,
            runs,
        ),
    ).toContain('width="2" height="2"');
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
    const prepared = await renderArtMasters(
        master.masters,
        notes,
        out,
        path.join(root, "build/.cache/art"),
    );
    const first = fs.readFileSync(prepared.get(address)!);
    for (const secret of ["sample-note-being-hidden", "Private name", "private text"]) {
        expect(original.includes(Buffer.from(secret))).toBe(true);
        expect(first.includes(Buffer.from(secret))).toBe(false);
    }
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
    fs.mkdirSync(path.join(secondRoot, "nested"));
    const movedFile = path.join(secondRoot, "nested", "renamed.png");
    fs.renameSync(source, movedFile);
    const moved = collectArtMasters([privateRoot, secondRoot], "sample");
    const sessionAfter = await createContentSession({ config });
    expect(sessionAfter.records.filter((record) => record.asset)).toEqual(
        sessionBefore.records.filter((record) => record.asset),
    );
    const movedRecords = collectAssetRecords(assets, {
        contentPackage: "sample",
        masterRecords: masterAssetRecords(moved.masters),
    });
    expect(movedRecords).toEqual(records);
    const repeated = await renderArtMasters(
        moved.masters,
        notes,
        out,
        path.join(root, "build/.cache/art"),
    );
    expect(fs.readFileSync(repeated.get(address)!).equals(first)).toBe(true);
    const movedStage = stagePackageAssets({
        assetsBase: assets,
        contentPackage: "sample",
        stageDir: path.join(root, "stage-after"),
        title: "Sample",
        records: movedRecords,
        preparedMasters: repeated,
    });
    expect(movedStage.manifest?.assets).toEqual(staged.manifest?.assets);
    const movedPlan = planCdnPublish({
        assetsBase: assets,
        contentPackage: "sample",
        host: "https://example.test",
        setFile: "set.json",
        setName: "Sample",
        records: movedRecords,
        preparedMasters: repeated,
    });
    expect(movedPlan.uploads[0].target).toBe(plan.uploads[0].target);
    expect(movedPlan.uploads[0].body.equals(plan.uploads[0].body)).toBe(true);
    expect(fs.readFileSync(movedFile).equals(original)).toBe(true);
    expect(fs.readFileSync(stale, "utf8")).toBe("stale public derivative");
    sessionBefore.dispose();
    sessionAfter.dispose();
});

it("withholds private note names and safely excludes unknown classification", async () => {
    const privateRoot = path.join(root, "private");
    fs.mkdirSync(privateRoot, { recursive: true });
    const svg =
        '<svg xmlns="http://www.w3.org/2000/svg"><metadata><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:p="urn:private"><p:credit>sample-note-being-person Private name private text</p:credit></rdf:Description></rdf:RDF></x:xmpmeta></metadata><rect width="1" height="1"/></svg>';
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
    const prepared = await renderArtMasters(
        master.masters,
        notes,
        path.join(root, "render"),
        path.join(root, "build/.cache/art"),
    );
    const outputBytes = fs.readFileSync(prepared.get(address)!);
    for (const secret of ["sample-note-being-person", "Private name", "private text"])
        expect(outputBytes.includes(Buffer.from(secret))).toBe(false);
    const output = readSvgProvenance(outputBytes).record;
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

it.each([
    { format: "png", publicNote: false },
    { format: "svg", publicNote: true },
])(
    "keeps private metadata out of $format derivatives (public note: $publicNote)",
    async ({ format, publicNote }) => {
        const privateRoot = path.join(root, "private");
        fs.mkdirSync(privateRoot, { recursive: true });
        const secret = "sample-note-being-hidden Private name private text";
        const packet = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:p="urn:private"><p:credit>${secret}</p:credit></rdf:Description></rdf:RDF></x:xmpmeta>`;
        const fields = {
            address: "sample-none-image-example",
            primaryNote: publicNote ? "sample-note-being-public" : "sample-note-being-hidden",
            name: "Private name",
            prompt: "private text",
            creator: "Author",
            rights: "Terms",
        };
        const bytes =
            format === "png" ?
                writeProvenance(
                    await sharp({
                        create: { width: 2, height: 2, channels: 3, background: "white" },
                    })
                        .withExif({ IFD0: { ImageDescription: secret } })
                        .withXmp(packet)
                        .png()
                        .toBuffer(),
                    fields,
                ).bytes
            :   writeSvgProvenance(
                    `<svg xmlns="http://www.w3.org/2000/svg"><metadata>${packet}</metadata><rect width="1" height="1"/></svg>`,
                    fields,
                ).bytes;
        fs.writeFileSync(path.join(privateRoot, `master.${format}`), bytes);
        const master = collectArtMasters([privateRoot], "sample");
        const notes = [
            {
                type: "being",
                address: { canonical: fields.primaryNote },
                name: { full: publicNote ? "Public name" : "Private name" },
                tags: publicNote ? [] : ["gm"],
            },
        ];
        const rendered = await renderArtMasters(
            master.masters,
            notes,
            path.join(root, "render"),
            path.join(root, "build/.cache/art"),
        );
        const output = fs.readFileSync(rendered.get(fields.address)!);
        for (const value of ["sample-note-being-hidden", "Private name", "private text"]) {
            expect(bytes.includes(Buffer.from(value))).toBe(true);
            expect(output.includes(Buffer.from(value))).toBe(false);
        }
        const record =
            format === "png" ? readWebpProvenance(output).record : readSvgProvenance(output).record;
        expect(record).toMatchObject({
            address: fields.address,
            creator: "Author",
            rights: "Terms",
        });
        expect(record.primaryNote).toBe(publicNote ? fields.primaryNote : undefined);
        expect(record.name).toBe(publicNote ? "Public name" : undefined);
    },
);

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
    const publicFile = path.join(config.paths.assets, "images", "first.svg");
    fs.mkdirSync(path.dirname(publicFile), { recursive: true });
    fs.writeFileSync(publicFile, "<svg/>");
    const first = await createContentSession({ config, trackChanges: true });
    expect(first.warnings).toEqual([
        {
            file: publicFile,
            severity: "warning",
            message: "public asset sample-none-image-first is superseded by a private master",
        },
    ]);
    expect(first.problems).toEqual([]);
    expect(first.records.some((record) => record.address?.canonical?.shortcode === "first")).toBe(
        true,
    );
    expect(
        artSource(
            first.records.find((record) => record.asset),
            config.paths.assets,
        ),
    ).toBe(file);
    expect(JSON.stringify(first.records)).not.toContain(privateRoot);
    expect(shippingAssetRecords(first.records)[0].address.canonical).toBe(
        "sample-none-image-first",
    );
    const parse = vi.spyOn(provenanceCore, "readSvgProvenance");
    const reads = vi.spyOn(fs, "readFileSync");
    const firstTree = await noteTree(config, { toolchain: "test" });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(firstTree.cache.tree).toBe("miss");
    expect((await noteTree(config, { toolchain: "test" })).cache.tree).toBe("hit");
    expect(parse).toHaveBeenCalledTimes(2);
    expect(reads.mock.calls.filter(([name]) => name === file)).toHaveLength(2);
    reads.mockRestore();
    parse.mockRestore();
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
    fs.writeFileSync(path.join(root, "public.txt"), "public input");
    await stagePackageBuildAssets({
        config: {
            rootDir: root,
            assets: [
                {
                    from: "public.txt",
                    to: path.relative(
                        path.join(root, "build", "stage"),
                        path.join(root, "outside", "public.txt"),
                    ),
                },
            ],
            stageDir: "build/stage",
            baseStyles: false,
        } as any,
        packConfig: config,
        session: first,
    });
    expect(fs.readFileSync(path.join(root, "outside", "public.txt"), "utf8")).toBe("public input");
    fs.writeFileSync(file, writeSvgProvenance(svg, { address: "sample-none-image-second" }).bytes);
    expect(() => first.assertUnchanged()).toThrow(/Content sources changed/);
    fs.unlinkSync(publicFile);
    const second = await createContentSession({ config });
    expect(second.records.some((record) => record.address?.canonical?.shortcode === "second")).toBe(
        true,
    );
    const secondTree = await noteTree(config, { toolchain: "test" });
    expect(secondTree.cache.tree).toBe("miss");
    expect(
        secondTree.records.some((record) => record.address?.canonical?.shortcode === "second"),
    ).toBe(true);
    fs.writeFileSync(
        path.join(privateRoot, "two.svg"),
        writeSvgProvenance(svg, { address: "sample-none-image-third" }).bytes,
    );
    const thirdTree = await noteTree(config, { toolchain: "test" });
    expect(thirdTree.cache.tree).toBe("miss");
    expect(
        thirdTree.records.some((record) => record.address?.canonical?.shortcode === "third"),
    ).toBe(true);
    fs.mkdirSync(path.join(privateRoot, "nested"));
    fs.renameSync(file, path.join(privateRoot, "nested", "moved.svg"));
    expect((await noteTree(config, { toolchain: "test" })).cache.tree).toBe("miss");
    fs.unlinkSync(path.join(privateRoot, "two.svg"));
    expect((await noteTree(config, { toolchain: "test" })).cache.tree).toBe("miss");
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
