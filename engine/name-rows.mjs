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
 * Authored `.name` occurrences projected from own-note index records into the
 * SQL `names` relation. Documentation records and assets contribute no rows.
 * @module
 */

import { canonicalKey, readCanonicalKey } from "./address.mjs";
import { encodeAddresses } from "./address-values.mjs";
import { isNoteRecord } from "./index-records.mjs";

/** Every column of the `names` relation, in order. */
export const NAME_COLUMNS = Object.freeze([
    "owner",
    "name",
    "type",
    "subType",
    "ref",
    "line",
    "column",
]);

/**
 * @typedef {object} NameRow
 * @property {string|null} owner - Containing authored page's canonical NOTE Address.
 * @property {string} name - Rendered visible text of the occurrence.
 * @property {string|null} type - Supplied note type, or null.
 * @property {string|null} subType - Supplied subtype, or null.
 * @property {string|null} ref - The `ref=` as written, a note address or a page-local `#key`, or null.
 * @property {number} line - Original 1-based source line at the opening bracket.
 * @property {number} column - Original 1-based UTF-16 source column at that bracket.
 */

/**
 * The containing page's NOTE identity, including for a native Item source.
 * @param {Record<string, any>} record - An own-note index record.
 * @returns {string|null} The page Address, or null for an unaddressable record.
 */
function ownerOf(record) {
    const parts = readCanonicalKey(encodeAddresses(record.address?.canonical));
    return parts ? canonicalKey(parts.package, "note", parts.type, parts.shortcode) : null;
}

/**
 * Project captured occurrences without reading sources or changing records.
 * @param {Iterable<Record<string, any>>} records - Index records, already narrowed
 *   to the audience; canonical Addresses may be typed or encoded strings.
 * @returns {NameRow[]} One row per occurrence, in record then source order.
 */
export function namesRows(records) {
    const rows = [];
    for (const record of records) {
        if (!record || !isNoteRecord(record) || !Array.isArray(record.names)) continue;
        const owner = ownerOf(record);
        for (const entry of record.names) {
            rows.push({
                owner,
                name: entry.name,
                type: entry.type ?? null,
                subType: entry.subType ?? null,
                ref: entry.ref ?? null,
                line: entry.line,
                column: entry.column,
            });
        }
    }
    return rows;
}
