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

/**
 * Normalize the settlement population policy.
 * @param {any} value - Authored policy.
 * @param {(where: string, problem: string) => never} fail - Configuration error reporter.
 * @returns {Readonly<{mode: "ceiling"|"complete", urbanShare?: number}>} Population policy.
 */
export function normalizeSettlementPopulation(value, fail) {
    const where = "packageBuild.settlementPopulation";
    if (value === undefined) return Object.freeze({ mode: "ceiling", urbanShare: 0.1 });
    if (!value || typeof value !== "object" || Array.isArray(value))
        fail(where, "must be a mapping");
    for (const key of Object.keys(value))
        if (!["mode", "urbanShare"].includes(key))
            fail(`${where}.${key}`, "is not a recognised key");
    const mode = value.mode === undefined ? "ceiling" : value.mode;
    if (mode !== "ceiling" && mode !== "complete")
        fail(`${where}.mode`, "must be ceiling or complete");
    if (mode === "complete") {
        if (Object.hasOwn(value, "urbanShare"))
            fail(`${where}.urbanShare`, "is not allowed in complete mode");
        return Object.freeze({ mode });
    }
    const urbanShare = value.urbanShare === undefined ? 0.1 : value.urbanShare;
    if (
        typeof urbanShare !== "number" ||
        !Number.isFinite(urbanShare) ||
        urbanShare < 0 ||
        urbanShare > 1
    )
        fail(`${where}.urbanShare`, "must be a finite fraction from 0 to 1");
    return Object.freeze({ mode, urbanShare });
}
