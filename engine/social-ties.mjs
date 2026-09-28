/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { acceptsType, parseAddress, renderAddress } from "./address.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { SOCIAL_TIES, SOCIAL_TIE_TARGET_TYPES } from "./social-tie-terms.mjs";

export { SOCIAL_TIES, SOCIAL_TIE_TARGET_TYPES };

const TERMS = new Set(SOCIAL_TIES.map(({ term }) => term));

/**
 * Validate a being's map of defining relationships.
 * @param {object} note
 * @param {{index?: object}} [options]
 */
export function checkSocialTies(note, { index } = {}) {
    const ties = note.fm?.data?.socialTies;
    if (ties === undefined || ties === null) return [];
    const at = (key) => ({
        file: note.file,
        ...positionOfFrontmatterPath(
            note.raw ?? "",
            key ? ["data", "socialTies", key] : ["data", "socialTies"],
            { key: true },
        ),
        severity: "error",
    });
    if (typeof ties !== "object" || Array.isArray(ties))
        return [
            {
                ...at(),
                message: "data.socialTies must be a map of Address keys to relationship terms",
            },
        ];
    const findings = [];
    const seen = new Map();
    for (const [key, term] of Object.entries(ties)) {
        const tuple = parseAddress(
            key,
            {
                package: index?.contentPackage ?? note.fm?.package,
                system: "note",
                types: index?.types,
                packages: index?.packages,
            },
            { declared: true },
        );
        if (tuple.reason) {
            findings.push({
                ...at(key),
                message: `data.socialTies key ${JSON.stringify(key)} is not a complete Address (${tuple.reason}); write being or affiliation as its type`,
            });
        } else if (!acceptsType(tuple, SOCIAL_TIE_TARGET_TYPES)) {
            findings.push({
                ...at(key),
                message: `data.socialTies accepts being or affiliation, not ${tuple.type}`,
            });
        } else {
            const target = renderAddress(tuple);
            if (seen.has(target)) {
                findings.push({
                    ...at(key),
                    message: `data.socialTies names the same target ${target} as ${JSON.stringify(seen.get(target))}; keep one tie per target`,
                });
            } else {
                seen.set(target, key);
            }
            if (
                tuple.package === (index?.contentPackage ?? note.fm?.package) &&
                tuple.type === "being" &&
                tuple.shortcode === note.fm?.shortcode
            ) {
                findings.push({
                    ...at(key),
                    message: `data.socialTies cannot address this being itself`,
                });
            } else if (index?.addressHit && !index.addressHit(target)) {
                findings.push({
                    ...at(key),
                    message: `data.socialTies target ${target} does not resolve`,
                });
            }
        }
        if (!TERMS.has(term))
            findings.push({
                ...at(key),
                message: `data.socialTies value ${JSON.stringify(term)} must be one of ${SOCIAL_TIES.map(({ term: value }) => value).join(", ")}`,
            });
    }
    return findings;
}
