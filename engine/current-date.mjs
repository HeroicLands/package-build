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

/** Setting-wide neutral current date, independent of configuration loading. */
import { parseNoteDate } from "./note-dates.mjs";

/** Default day on the neutral setting timeline. */
export const DEFAULT_CURRENT_DATE = "720.1";

/**
 * Validate a quoted neutral date and preserve its authored day digits.
 * @param {unknown} [value] - Explicit configuration or adapter override.
 * @returns {string} Validated neutral date; undefined selects the default.
 * @throws {TypeError} An explicit value is not a valid neutral date string.
 */
export function normalizeCurrentDate(value = undefined) {
    if (value === undefined) return DEFAULT_CURRENT_DATE;
    if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?(?::\d{6})?$/.test(value.trim()))
        throw new TypeError('currentDate must be a quoted neutral date: "<year>[.<day>[:HHMMSS]]"');
    const text = value.trim();
    const parsed = parseNoteDate(text, { allowUnknown: false });
    if (!parsed.date || parsed.findings.some((finding) => finding.severity === "error"))
        throw new TypeError(
            `currentDate: ${parsed.findings[0]?.message ?? "invalid neutral date"}`,
        );
    return text;
}
