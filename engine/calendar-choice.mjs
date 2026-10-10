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

import { isAddressTuple, parseAddress, renderAddress } from "./address.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";

/**
 * Require a being's or place's chosen calendar to address a calendar note.
 * @param {object} note
 * @param {{index?: object}} [options]
 */
export function checkCalendarChoice(note, { index } = {}) {
    const value = note.fm?.data?.calendar;
    if (value === undefined || value === null || !index?.addressHit) return [];
    const tuple = parseAddress(value, {
        package: index.contentPackage,
        system: "note",
        type: "lore",
        types: index.types,
        packages: index.packages,
    });
    if (tuple.reason || tuple.type !== "lore") return [];
    const target = index.addressHit(renderAddress(tuple));
    if (!target || (target.fm ?? target).subType === "calendar") return [];
    return [
        {
            file: note.file,
            ...positionOfFrontmatterPath(note.raw ?? "", ["data", "calendar"]),
            severity: "error",
            message: `data.calendar ${isAddressTuple(value) ? renderAddress(value) : value} names lore whose subType is not calendar`,
        },
    ];
}
