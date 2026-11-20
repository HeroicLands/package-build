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
 * List the private artwork roots declared by a producer.
 * @param {{art?:{masterRoots?:readonly string[],componentRoots?:readonly string[]}}} config Package configuration.
 * @returns {string[]} Declared private input roots.
 */
export function privateArtRoots(config) {
    return [...(config.art?.masterRoots ?? []), ...(config.art?.componentRoots ?? [])];
}
