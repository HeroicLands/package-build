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
import { fileURLToPath } from "node:url";

// Build-time pack configuration (plain ESM, no Foundry). Imported by relative
// path because the pack-build scripts live outside the `@src` alias tree.
import { loadPackConfig } from "../engine/pack-config.mjs";
import {
    contentPackage,
    foundryPackageId,
} from "../engine/content-package.mjs";
import { supportedCoreVersion } from "../engine/helpers.mjs";

// Anchored on this file, not the working directory: the same paths have to
// resolve whichever directory the suite is launched from.
//
// What is under test is the *resolution mechanism* — that configured paths are
// absolute and anchored on the configured root — so the root it checks against
// is this package's own, supplied by the development config at the repository
// root. It used to be the system repository's root, which only resolved while
// this package was vendored inside it.
const PKG_ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);

/**
 * The resolved configuration these cases describe.
 *
 * Read once here rather than imported as a constant: the engine resolves it on
 * first read and not at import, so that the package can be imported — and its
 * CLI asked its version — with no configuration anywhere above it (#2).
 */
const packConfig = loadPackConfig();

/** A throwaway `assets/templates`-shaped directory, `{ fileName: contents }`. */
function templateDir(files: Record<string, unknown>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sohl-packcfg-"));
    for (const [name, body] of Object.entries(files)) {
        fs.writeFileSync(path.join(root, name), JSON.stringify(body), "utf8");
    }
    return root;
}

describe("this repository's resolved pack configuration", () => {
    it("names the content package and the Foundry package it ships", () => {
        expect(packConfig.contentPackage).toBe("sohl");
        expect(packConfig.foundryPackage).toBe("sohl");
        expect(packConfig.packageKind).toBe("systems");
    });

    it("is the single source the legacy constants are derived from", () => {
        // `content-package.mjs` survives as a derived re-export so the link
        // resolver keeps its filesystem-free import path — but it must not be a
        // second place the values are written.
        expect(contentPackage()).toBe(packConfig.contentPackage);
        expect(foundryPackageId()).toBe(packConfig.foundryPackage);
    });

    it("resolves every path against the configured root, not the cwd", () => {
        // The configured root is the fixture repository, not this package's
        // own: the development configuration moved there to have a
        // `package.json` to derive its identity from (#50).
        for (const [key, value] of Object.entries(packConfig.paths)) {
            expect(path.isAbsolute(value as string), key).toBe(true);
            expect(String(value).startsWith(PKG_ROOT), key).toBe(true);
        }
        expect(packConfig.rootDir).toBe(
            path.join(PKG_ROOT, "tests/fixtures/repo"),
        );
        expect(packConfig.paths.content).toBe(
            path.join(packConfig.rootDir, "assets/content"),
        );
        expect(packConfig.paths.packJson).toBe(
            path.join(packConfig.rootDir, "build/packs-json"),
        );
    });

    it("derives the Foundry asset root from the package kind and id", () => {
        // A module consumer must emit `modules/<id>/assets/…`; nothing in the
        // pipeline may spell `systems/sohl` itself.
        expect(packConfig.assetRoot).toBe("systems/sohl/assets");
    });
});

describe("the one pack list (#1508 — SOURCE_PACKS and PACK_CONFIGS merged)", () => {
    it("declares every pack directory the build compiles, in compile order", () => {
        // The actors pass reads the items pass's output, so order is load-bearing.
        expect(packConfig.packDirectories).toEqual([
            "items",
            "journals",
            "actors",
            "macros",
            "scenes",
            "adventures",
        ]);
    });

    it("is the list the shipped manifest is generated from", () => {
        // This used to compare the configured packs against the manifest's,
        // because the two were maintained separately and had to be kept in
        // step. package-build generates the manifest from this list now, so
        // the comparison would be of a thing against itself — a guard that
        // cannot fail is worse than none, because it reads like cover.
        const flatten = (pack) => [pack, ...pack.companions.flatMap(flatten)];

        expect(packConfig.packs.flatMap(flatten).map((p) => p.name)).toEqual(
            packConfig.packDirectories,
        );
    });

    it("gives each generated pack its folder-hierarchy file", () => {
        expect(packConfig.packs.map((p) => [p.name, p.folders])).toEqual([
            ["items", "item-folders.yaml"],
            ["journals", "journal-folders.yaml"],
            ["actors", "actor-folders.yaml"],
            ["macros", "macro-folders.yaml"],
            ["scenes", "scene-folders.yaml"],
        ]);
    });

    it("skips the Obsidian scaffolding directory by configuration", () => {
        // `Templates/` was a hardcoded Obsidian convention inside the generic
        // tree walker; a consumer whose vault does not use it says so here.
        expect(packConfig.skipDirectories).toEqual(["Templates"]);
    });
});

describe("the core version is configuration, and the config is its source", () => {
    // This reverses what this file asserted until #50. The rule *was* that
    // configuration may say only where the manifest is, never what it holds,
    // because the manifest was hand-authored and moved with test evidence — a
    // captured copy would silently stop following it.
    //
    // package-build now generates the manifest *from* this configuration, so
    // there is nothing left to follow: reading it back would be a round trip
    // through an artifact that need not exist yet, since `build:db` can run
    // before the manifest is written. The direction of truth flipped, and the
    // guard flips with it.

    it("stamps the floor the configuration declares", () => {
        expect(supportedCoreVersion()).toBe(packConfig.compatibility.minimum);
    });

    it("follows whatever the configuration declares", () => {
        expect(
            supportedCoreVersion({ compatibility: { minimum: "14.900" } }),
        ).toBe("14.900");
        expect(
            supportedCoreVersion({ compatibility: { minimum: "14.001" } }),
        ).toBe("14.001");
    });

    it("throws rather than falling back when none is declared", () => {
        // The loud failure is the feature, and survives the reversal above. A
        // silent fallback is how every pack came to ship `coreVersion: "14"`,
        // which sorts below every v14 build (#1533).
        expect(() => supportedCoreVersion({ compatibility: null })).toThrow(
            /compatibility\.minimum/,
        );
    });
});
