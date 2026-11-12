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

import { parseAddress, renderAddress } from "./address.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";

/**
 * Resolve an occupation template Address with being defaults.
 * @param {unknown} value - The authored or decoded Address.
 * @param {object} index - The content link index.
 * @returns {string|undefined} The canonical Address, if valid.
 */
export function occupationKey(value, index) {
    const tuple = parseAddress(value, {
        package: index?.contentPackage,
        system: "note",
        type: "being",
        types: index?.types,
        packages: index?.packages,
    });
    return tuple.reason ? undefined : renderAddress(tuple);
}

/**
 * Check the subtype of a resolved occupation template.
 * @param {object} note - The note and its source location.
 * @param {{index?: object}} [options] - The content link index.
 * @returns {object[]} Located findings.
 */
export function checkOccupationChoice(note, { index } = {}) {
    const value = note.fm?.data?.occupationNote;
    if (value === undefined || value === null || !index?.addressHit) return [];
    const key = occupationKey(value, index);
    const target = key && index.addressHit(key);
    if (!target || (target.fm ?? target).subType === "npc") return [];
    return [
        {
            file: note.file,
            ...positionOfFrontmatterPath(note.raw ?? "", ["data", "occupationNote"]),
            severity: "error",
            message: `data.occupationNote ${key} must name a being with subType npc`,
        },
    ];
}
