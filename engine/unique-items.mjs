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
 * **A one-of-a-kind item is tied to the places and beings involved.**
 *
 * `data.unique: true` on a gear note marks an item there is only one of — a
 * named hammer, a crown, a sword in a tomb. Where it lies and who claims it are
 * prose, because possession changes with play and ownership is a claim that
 * can be disputed; so the note's own links are what tie it to the world, and a
 * unique item whose note links no place and no being is a finding.
 *
 * A link counts wherever the note writes it: a wikilink in its body, or a
 * `made` or `lost` event Address naming a place's or a being's event.
 *
 * @module
 */

import { isAddressTuple, parseAddress } from "./address.mjs";
import { matchAllOutsideCode } from "./code-fences.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { parseWikilink, WIKILINK } from "./wikilink-syntax.mjs";

/** The note types a unique item's links must reach at least one of. */
export const UNIQUE_ITEM_LINK_TYPES = Object.freeze(["place", "being"]);

/**
 * The note type one written target names, or `""` where it is no Address.
 *
 * @param {unknown} target - A wikilink target or an authored Address.
 * @param {object} [index] - The lint's address index.
 * @returns {string} The type.
 */
function typeOf(target, index) {
    if (isAddressTuple(target)) return target.type;
    // An event Address arrives decoded as a link to its note and anchor.
    if (isAddressTuple(target?.target)) return target.target.type;
    const tuple = parseAddress(String(target ?? "").split("#")[0], {
        package: index?.contentPackage,
        system: "note",
        types: index?.types,
        packages: index?.packages,
    });
    return tuple.reason ? "" : String(tuple.type ?? "");
}

/**
 * Report a unique item whose note links no place or being.
 *
 * @param {object} note - The note: `file`, `raw`, `body` and parsed `fm`.
 * @param {{index?: object}} [options] - The lint's options.
 * @returns {object[]} The finding, located at `unique`, or none.
 */
export function checkUniqueItem(note, { index } = {}) {
    const data = note.fm?.data;
    if (data?.unique !== true && data?.unique !== "true") return [];
    const targets = [
        data.made,
        data.lost,
        ...matchAllOutsideCode(note.body ?? "", new RegExp(WIKILINK.source, "g")).map(
            ([, inner]) => parseWikilink(inner).target,
        ),
    ].filter(Boolean);
    if (targets.some((target) => UNIQUE_ITEM_LINK_TYPES.includes(typeOf(target, index)))) return [];
    return [
        {
            file: note.file,
            ...positionOfFrontmatterPath(note.raw ?? "", ["data", "unique"], { key: true }),
            severity: "error",
            message:
                "a unique item links no place or being; link where it lies or who " +
                "holds or claims it in the note's prose",
        },
    ];
}
