/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Build-time pack helper (plain ESM, no Foundry). Imported by relative path
// because the pack-build scripts live outside the `@src` alias tree.
import { buildStats as buildStatsRaw } from "../engine/helpers.mjs";
import { loadPackConfig } from "../engine/pack-config.mjs";
import { defineConfig } from "../index.mjs";

// The pack helpers are plain ESM whose JSDoc types the return as `object`.
const buildStats = (systemVersion?: string, config?: unknown): any =>
    buildStatsRaw(systemVersion as any, config as any);

// Anchored on this file, not the working directory (see pack-config.test.ts).
// This package owns its manifest fixture: what is under test is how a manifest's
// supported floor becomes a `_stats.coreVersion`, which is package behaviour. It
// used to read the *system repository's* real manifest, which only resolved
// while this package was vendored inside it.
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The Foundry floor this repository's development configuration declares. */
const CORE_FLOOR = loadPackConfig().compatibility.minimum;

/**
 * The newest Foundry v14 migration shim that rewrites shipped document data.
 *
 * `Scene._migrationRegistry` gates `migrateMeasuredTemplates` at 14.352 and
 * both `migrateLevels` and `migrateFogExploration` at 14.353. A record stamped
 * older than this is eligible for all of them, and `migrateLevels` in
 * particular is an unconditional `levels = [synthesised]` that never checks
 * whether the record already has one (#1533).
 */
const NEWEST_V14_SHIM = "14.353";

/** Foundry's own ordering: dotted numeric segments, compared left to right. */
function isOlderThan(a: string, b: string): boolean {
    const seg = (v: string) => v.split(".").map((n) => Number(n) || 0);
    const [x, y] = [seg(a), seg(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const [p, q] = [x[i] ?? 0, y[i] ?? 0];
        if (p !== q) return p < q;
    }
    return false;
}

describe("isOlderThan (the comparison the guards below rest on)", () => {
    it("orders build numbers, not string segments", () => {
        // The bug this file guards was invisible precisely because "14" *looks*
        // like a v14 version while sorting below every v14 build.
        expect(isOlderThan("14", "14.353")).toBe(true);
        expect(isOlderThan("14.352", "14.353")).toBe(true);
        expect(isOlderThan("14.359", "14.353")).toBe(false);
        expect(isOlderThan("14.353", "14.353")).toBe(false);
        expect(isOlderThan("14.9", "14.10")).toBe(true);
    });
});

describe("the compiled-pack `_stats` stamp", () => {
    it("declares the manifest's own minimum, not a literal", () => {
        // Two literals would rot apart. The stamp is only *safe* because the
        // manifest refuses to run on an older core, so if that floor ever moves
        // the stamp has to move with it.
        expect(buildStats().coreVersion).toBe(CORE_FLOOR);
    });

    it("is never older than the newest v14 migration shim", () => {
        // The regression test for #1533: a document stamped below this is
        // rewritten by Foundry on load, silently, and no build check can see it.
        const stamped = buildStats().coreVersion;
        expect(
            isOlderThan(stamped, NEWEST_V14_SHIM),
            `shipped documents stamp coreVersion ${stamped}, older than the ` +
                `${NEWEST_V14_SHIM} migration shims that rewrite them`,
        ).toBe(false);
    });

    it("keeps the supported floor above those shims", () => {
        // The stamp is derived, so this is what actually makes it safe: a
        // client old enough to run those shims cannot load the system at all.
        expect(isOlderThan(CORE_FLOOR, NEWEST_V14_SHIM)).toBe(false);
    });

    it("still carries the system version it is given", () => {
        expect(buildStats("1.2.3").systemVersion).toBe("1.2.3");
        expect(buildStats().systemId).toBe("sohl");
    });
});

describe("the `_stats` stamp is configuration, not a literal (#1508)", () => {
    it("takes every stamped identity from the resolved configuration", () => {
        // Four call sites used to pass the same frozen "0.6.0" literal; the
        // version now has one home, and so do the other two stamped fields.
        const stats = buildStats();
        expect(stats.systemId).toBe(loadPackConfig().stats.systemId);
        expect(stats.systemVersion).toBe(loadPackConfig().stats.systemVersion);
        expect(stats.lastModifiedBy).toBe(loadPackConfig().stats.lastModifiedBy);
    });

    it("stamps a non-`sohl` consumer's own identity", () => {
        const moduleConfig = defineConfig({
            compatibility: { minimum: "14.359", verified: "14.359" },
            rootDir: PKG_ROOT,
            contentPackage: "thalorna",
            foundryPackage: "sohl-thalorna",
            packageKind: "modules",
            // Declared and required rather than authored into `stats` (#48).
            systems: { sohl: { compatibility: { verified: "0.1.0" } } },
            requiresSystem: "sohl",
            stats: {
                lastModifiedBy: "thalornabuild000",
            },
            packs: [{ name: "items", type: "Item" }],
        });
        const stats = buildStats(undefined, moduleConfig);
        expect(stats.systemVersion).toBe("0.1.0");
        expect(stats.lastModifiedBy).toBe("thalornabuild000");
        // Derived from that config's own manifest directory — the fixture here,
        // since the module config points its root and manifest path at it.
        expect(stats.coreVersion).toBe(CORE_FLOOR);
    });
});
