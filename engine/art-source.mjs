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

import path from "node:path";

const sources = new WeakMap();

/**
 * Associate a record with its private input without serializing the path.
 * @param {object} record Asset record.
 * @param {string} file Private input.
 * @returns {object} The record.
 */
export function setArtSource(record, file) {
    sources.set(record, file);
    return record;
}

/**
 * Preserve a source association across a record copy.
 * @param {object} from Original record.
 * @param {object} to Copied record.
 * @returns {object} The copy.
 */
export function copyArtSource(from, to) {
    const file = sources.get(from);
    return file ? setArtSource(to, file) : to;
}

/**
 * Locate the input named by an asset diagnostic.
 * @param {Record<string, any>} record Asset record.
 * @param {string} assetsBase Public asset root.
 * @returns {string} Diagnostic source path.
 */
export function artSource(record, assetsBase) {
    return sources.get(record) ?? path.join(assetsBase, record.asset.path);
}
