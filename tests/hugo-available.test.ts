/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The Hugo the render cases need must be reachable wherever CI runs.
 *
 * `hugo-theme/` ships inside this package and the render cases drive a real
 * Hugo over it. Those cases probe for the binary and stand down when it is
 * absent, so a runner without Hugo reports a whole green suite that proved
 * nothing — a criterion that skips is not a criterion. This case is the one
 * that refuses: it carries no probe of its own to stand down behind, and it
 * fails outright when `CI` is set and Hugo is missing, too old, or not the
 * extended build.
 *
 * The floor is read from `hugo-theme/theme.toml` rather than written here, so
 * raising `min_version` is what makes this case demand a newer Hugo.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const THEME_MANIFEST = path.join(ROOT, "hugo-theme", "theme.toml");

/** Whether CI demands a working Hugo, rather than merely preferring one. */
const REQUIRED = Boolean(process.env.CI);

/** `hugo version` output, or `null` when no Hugo answers. */
function hugoVersion(): string | null {
    const probe = spawnSync("hugo", ["version"], { encoding: "utf8" });
    return probe.status === 0 ? String(probe.stdout) : null;
}

/** The `min_version` the theme declares, as a comparable triple. */
function declaredFloor(): number[] {
    const source = fs.readFileSync(THEME_MANIFEST, "utf8");
    const stated = /^\s*min_version\s*=\s*"([^"]+)"/m.exec(source);
    if (stated === null) {
        throw new Error(`${THEME_MANIFEST}: declares no min_version`);
    }
    return stated[1].split(".").map(Number);
}

/** The semantic version in `hugo version` output, as a comparable triple. */
function reportedVersion(report: string): number[] {
    const stated = /hugo v(\d+)\.(\d+)\.(\d+)/.exec(report);
    if (stated === null) throw new Error(`hugo version: unreadable — ${report.trim()}`);
    return [Number(stated[1]), Number(stated[2]), Number(stated[3])];
}

/** Whether `found` is at or above `floor`, compared field by field. */
function atLeast(found: number[], floor: number[]): boolean {
    for (let i = 0; i < floor.length; i += 1) {
        const a = found[i] ?? 0;
        const b = floor[i] ?? 0;
        if (a !== b) return a > b;
    }
    return true;
}

describe("the Hugo the render cases need", () => {
    const report = hugoVersion();

    it("declares a floor in the theme's own manifest", () => {
        expect(declaredFloor().length).toBeGreaterThanOrEqual(2);
    });

    it("answers wherever CI runs", () => {
        expect(
            !REQUIRED || report !== null,
            "CI installs no Hugo, so every render case stands down and the suite proves nothing",
        ).toBe(true);
    });

    it("is the extended build wherever CI runs", () => {
        expect(
            !REQUIRED || (report !== null && report.includes("extended")),
            `CI's Hugo is not the extended build — ${report?.trim() ?? "absent"}`,
        ).toBe(true);
    });

    it("meets the floor the theme declares", () => {
        if (report === null) {
            expect(REQUIRED, "no Hugo answers, which CI forbids").toBe(false);
            return;
        }
        const floor = declaredFloor();
        expect(
            atLeast(reportedVersion(report), floor),
            `Hugo ${reportedVersion(report).join(".")} is below the theme's floor ${floor.join(".")}`,
        ).toBe(true);
    });
});
