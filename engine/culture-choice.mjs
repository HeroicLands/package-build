/* SPDX-License-Identifier: GPL-3.0-or-later */

import { isAddressTuple, parseAddress, renderAddress } from "./address.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";

/** Require a being's primary culture to address a culture lore note. */
export function checkCultureChoice(note, { index } = {}) {
    const value = note.fm?.data?.culture;
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
    if (!target || (target.fm ?? target).subType === "culture") return [];
    return [
        {
            file: note.file,
            ...positionOfFrontmatterPath(note.raw ?? "", ["data", "culture"]),
            severity: "error",
            message: `data.culture ${isAddressTuple(value) ? renderAddress(value) : value} names lore whose subType is not culture`,
        },
    ];
}
