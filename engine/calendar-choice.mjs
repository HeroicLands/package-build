/* SPDX-License-Identifier: GPL-3.0-or-later */

import { isAddressTuple, parseAddress, renderAddress } from "./address.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";

/** Require a being's or place's chosen calendar to address a calendar note. */
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
