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
 * **What a district and a route require of their notes.**
 *
 * A `place/district` is a recognised division of a larger place, usually
 * administrative: a city's quarter, a town's ward, a kingdom's shire. It always
 * stands within a `place/settlement` or a `place/region`, named in
 * `data.parents`. It may name its own governing affiliation in
 * `data.government`; without one it falls under its parent's government.
 *
 * A `place/route` is a road, a pass or a sea lane, and the journeys it carries
 * are its `data.routes`.
 *
 * @module
 */

import { isAddressTuple, parseAddress, renderAddress } from "./address.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";

/** The place kinds a district may stand within. */
export const DISTRICT_PARENT_KINDS = Object.freeze(["settlement", "region"]);

/**
 * The place one `parents` entry names, as the lint's index holds it.
 *
 * @param {unknown} value - The authored entry.
 * @param {object} [index] - The lint's address index.
 * @returns {{resolved: boolean, fm?: object}} Whether it resolves, and its
 *   frontmatter where it does.
 */
function parentOf(value, index) {
    const tuple =
        isAddressTuple(value) ? value : (
            parseAddress(value, {
                package: index?.contentPackage,
                system: "note",
                type: "place",
                types: index?.types,
                packages: index?.packages,
            })
        );
    if (!isAddressTuple(tuple) || !index?.addressHit) return { resolved: false };
    const hit = index.addressHit(renderAddress({ ...tuple, system: "note" }));
    return hit ? { resolved: true, fm: hit.fm ?? hit } : { resolved: false };
}

/**
 * Check a district's parent and a route's journeys.
 *
 * A district naming no parent is reported at its `subType`; one whose parents
 * all resolve and none is a settlement or a region is reported at `parents`.
 * A parent that does not resolve is the Address check's finding, so a district
 * whose only parents are unresolved earns nothing more here. A route stating no
 * `data.routes` entry is reported at its `subType`.
 *
 * @param {object} note - The note: `file`, `raw` and parsed `fm`.
 * @param {{index?: object}} [options] - The lint's options.
 * @returns {object[]} Located findings.
 */
export function checkPlaceKind(note, { index } = {}) {
    const subType = note.fm?.subType;
    const at = (path, key) => ({
        file: note.file,
        ...positionOfFrontmatterPath(note.raw ?? "", path, key ? { key: true } : undefined),
        severity: "error",
    });
    if (subType === "district") {
        const parents = note.fm?.data?.parents;
        const list =
            Array.isArray(parents) ? parents
            : parents == null ? []
            : [parents];
        const message =
            "a district stands within a settlement or a region; name one in `data.parents`";
        if (!list.length) return [{ ...at(["subType"]), message }];
        const found = list.map((value) => parentOf(value, index));
        if (found.some((one) => !one.resolved)) return [];
        if (found.some((one) => DISTRICT_PARENT_KINDS.includes(one.fm?.subType))) return [];
        return [{ ...at(["data", "parents"], true), message }];
    }
    if (subType === "route") {
        const routes = note.fm?.data?.routes;
        if (Array.isArray(routes) && routes.length) return [];
        return [
            {
                ...at(["subType"]),
                message:
                    "a route carries its journeys in `data.routes`; state at least one, " +
                    "each `{ to, bearing, mode, days }`",
            },
        ];
    }
    return [];
}
