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

/** Editable population bands for generated rural settlements. @module */
export const DEFAULT_SETTLEMENT_BANDS = Object.freeze({
    homesteadBelow: 10,
    hamletBelow: 100,
    townAt: 1000,
    localAbove: 80,
});

/** Validate and complete the operation's population bands.
 * @param {object} [value] - Optional overrides.
 * @returns {object} Validated thresholds.
 */
export function settlementBands(value = {}) {
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).some((key) => !Object.hasOwn(DEFAULT_SETTLEMENT_BANDS, key))
    )
        throw new RangeError("settlement bands require recognized thresholds");
    const result = { ...DEFAULT_SETTLEMENT_BANDS, ...value };
    if (
        Object.values(result).some((number) => !Number.isSafeInteger(number) || number < 0) ||
        result.homesteadBelow < 1 ||
        result.homesteadBelow >= result.hamletBelow ||
        result.hamletBelow >= result.townAt ||
        result.localAbove >= result.townAt
    )
        throw new RangeError(
            "settlement bands require ordered nonnegative thresholds below the town band",
        );
    return result;
}
