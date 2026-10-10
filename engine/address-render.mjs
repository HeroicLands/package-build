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

import { assertSystemSegment } from "./systems.mjs";

/**
 * Render the four segments of a complete Address in lowercase.
 * @param {{package: string, system: string, type: string, shortcode: string}} tuple
 * @returns {string} The canonical Address.
 */
export function renderAddress(tuple) {
    const { package: pkg, system, type, shortcode } = tuple;
    assertSystemSegment(system, `the address of ${type}-${shortcode}`);
    return `${pkg}-${system}-${type}-${shortcode}`.toLowerCase();
}

/** Render every written suffix of one complete Address. */
export function addressSuffixes(tuple) {
    const full = renderAddress(tuple);
    const { system, type, shortcode } = tuple;
    return [
        String(shortcode).toLowerCase(),
        [type, shortcode].join("-").toLowerCase(),
        [system, type, shortcode].join("-").toLowerCase(),
        full,
    ];
}
