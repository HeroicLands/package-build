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
 * **The direction a script is written in.** A script note states it beside its
 * faces:
 *
 * ```yaml
 * data:
 *   script:
 *     fonts: [teng-chou]
 *     emphasis: rubric
 *     direction: vertical-rl
 * ```
 *
 * `vertical-rl` is a script written in columns, top to bottom, the columns
 * read from the right. A script that states no direction is written in lines.
 * Markup never states a direction: a `scroll` fence takes its script's, and is
 * refused in a script written in lines; see
 * {@link module:engine/content-scroll}.
 *
 * @module
 */

import { isNoteRecord } from "./index-records.mjs";
import { SCRIPT_DIRECTIONS, SCRIPT_SUBTYPE } from "./script-emphasis-terms.mjs";

export { SCRIPT_DIRECTIONS } from "./script-emphasis-terms.mjs";

/**
 * Each face's direction, from the script notes among the index records. The
 * first note to list a face keeps it; a face whose note states no direction,
 * or one the build does not know, is absent.
 *
 * @param {Iterable<Record<string, any>>|undefined} records - Index records.
 * @returns {Map<string, "vertical-rl">} The directions, by face slug.
 */
export function directionsFromRecords(records) {
    const out = new Map();
    const listed = new Set();
    for (const record of records ?? []) {
        if (!record || !isNoteRecord(record)) continue;
        if (
            record.type !== "skill" ||
            String(record.subType ?? "").toLowerCase() !== SCRIPT_SUBTYPE
        )
            continue;
        const script = record.data?.script;
        if (!script || typeof script !== "object" || !Array.isArray(script.fonts)) continue;
        for (const slug of script.fonts) {
            if (typeof slug !== "string" || listed.has(slug)) continue;
            listed.add(slug);
            if (SCRIPT_DIRECTIONS.includes(script.direction)) out.set(slug, script.direction);
        }
    }
    return out;
}
