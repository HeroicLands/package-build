/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The toolchain's own files are addressable, and reachable with nothing fetched.
 *
 * `packagebuild-none-image-<shortcode>` lets a note borrow a section banner
 * without declaring a dependency on some parent system or module it otherwise
 * has no relationship with. Three things have to hold for that to work, and
 * each is checked here:
 *
 * - the files are **walked**, so an installed copy and a git checkout answer
 *   alike and a cold cache is not a failure mode;
 * - the walk is **published** as a file the tarball carries, for the readers
 *   that are not this process — and the two cannot disagree, because the
 *   emitter writes what the walk produced;
 * - the addresses have **no Foundry form**, by construction rather than by
 *   lookup failure, since Foundry installs no package for this one.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import {
    PACKAGEBUILD_ASSETS,
    PACKAGEBUILD_INDEX_FILE,
    PACKAGEBUILD_ROOT,
    emitPackageBuildIndex,
    packageBuildRecords,
} from "../engine/packagebuild-index.mjs";
import { PACKAGEBUILD_PACKAGE, metadataFileName } from "../engine/packages.mjs";
import { resolvePathname } from "../engine/pathnames.mjs";
import { readCanonicalKey } from "../engine/content-address.mjs";

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"));

describe("the toolchain's own assets are indexed from the tree it ships", () => {
    it("finds the tree, so the cases below are not about an empty walk", () => {
        expect(PACKAGEBUILD_ROOT).toBe(PKG_ROOT);
        expect(fs.existsSync(PACKAGEBUILD_ASSETS)).toBe(true);
        expect(packageBuildRecords().length).toBeGreaterThan(0);
    });

    it("addresses every one under the reserved package name", () => {
        for (const record of packageBuildRecords()) {
            const parts = readCanonicalKey(record.address.canonical);
            expect(parts?.package, record.address.canonical).toBe(PACKAGEBUILD_PACKAGE);
            expect(parts?.system, record.address.canonical).toBe("none");
        }
    });

    it("names a path that walks back to a file the package ships", () => {
        for (const record of packageBuildRecords()) {
            const file = path.join(PACKAGEBUILD_ASSETS, ...record.asset.path.split("/"));
            expect(fs.existsSync(file), record.asset.path).toBe(true);
        }
    });

    it("carries the provenance recorded beside the files", () => {
        const banner = packageBuildRecords().find((r) => r.shortcode === "skillbnr");
        expect(banner?.asset.path).toBe("images/banners/skillbnr.webp");
        expect(banner?.asset.license).toBe("CC-BY-SA-4.0");
    });

    it("derives the records rather than reading a file, so nothing can be cold", () => {
        // The walk is the source. A missing published index makes no difference
        // to a build inside this process, which is what lets the file be a
        // publication rather than a dependency.
        const before = packageBuildRecords();
        expect(before).toEqual(packageBuildRecords());
    });
});

describe("the published index is the walk, written down", () => {
    it("writes exactly the records the walk produced, as JSON Lines", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pbindex-"));
        const file = path.join(dir, metadataFileName(PACKAGEBUILD_PACKAGE));
        const result = emitPackageBuildIndex({ file });

        const lines = fs
            .readFileSync(file, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line));
        expect(lines).toEqual(packageBuildRecords());
        expect(result.assets).toBe(lines.length);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("is byte-identical across two runs over an unchanged tree", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pbindex-"));
        const one = path.join(dir, "one.jsonl");
        const two = path.join(dir, "two.jsonl");
        emitPackageBuildIndex({ file: one });
        emitPackageBuildIndex({ file: two });
        expect(fs.readFileSync(one, "utf8")).toBe(fs.readFileSync(two, "utf8"));
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("is published from the package root, under the one index name", () => {
        expect(PACKAGEBUILD_INDEX_FILE).toBe(
            path.join(PACKAGEBUILD_ROOT, metadataFileName(PACKAGEBUILD_PACKAGE)),
        );
    });

    it("ships in the tarball, beside the files it describes", () => {
        // Derived and disposable, so it is gitignored like `types/` — which
        // makes `files` the only thing that puts it in the tarball.
        expect(PACKAGE_JSON.files).toContain(metadataFileName(PACKAGEBUILD_PACKAGE));
        expect(PACKAGE_JSON.files).toContain("assets");
        expect(PACKAGE_JSON.scripts.prepack).toContain("build:asset-index");
    });
});

describe("a `packagebuild` address has no Foundry form", () => {
    /** A configuration that knows every package this repository could name. */
    const config = {
        contentPackage: "thalorna",
        packageKind: "modules",
        foundryPackage: "sohl-thalorna",
        assetRoot: "modules/sohl-thalorna/assets",
        relationships: { systems: [{ id: "sohl" }] },
        site: { assets: "https://cdn.example.org" },
    } as never;

    it("yields `null` rather than deriving one that installs nowhere", () => {
        // Foundry installs no package for this one, so `modules/packagebuild/…`
        // would be an address a reader would trust and nothing would serve.
        const forms = resolvePathname("packagebuild/assets/images/banners/skillbnr.webp", config)!;
        expect(forms.package).toBe(PACKAGEBUILD_PACKAGE);
        expect(forms.foundry).toBeNull();
    });

    it("still resolves on the website, which is where a banner is read", () => {
        const forms = resolvePathname("packagebuild/assets/images/banners/skillbnr.webp", config)!;
        expect(forms.web).toBe("https://cdn.example.org/packagebuild/images/banners/skillbnr.webp");
    });

    it("gives a package Foundry does install the address it serves", () => {
        // Guards the guard: were every package to yield `null`, the case above
        // would pass while saying nothing about this one.
        const forms = resolvePathname("sohl/assets/icons/other/sword.svg", config)!;
        expect(forms.foundry).toBe("systems/sohl/assets/icons/other/sword.svg");
    });
});
