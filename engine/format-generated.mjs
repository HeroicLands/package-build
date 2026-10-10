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
 * Format generated text using the destination file's Prettier configuration.
 * @param {string} text
 * @param {string} filepath
 * @returns {Promise<string>}
 */
export async function formatGenerated(text, filepath) {
    const prettier = await import("prettier");
    const config = await prettier.resolveConfig(filepath);
    return prettier.format(text, { ...config, filepath });
}
