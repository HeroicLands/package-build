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
import { AddressEntries } from "./address-values.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { SOCIAL_TIES, SOCIAL_TIE_TARGET_TYPES } from "./social-tie-terms.mjs";

export { SOCIAL_TIES, SOCIAL_TIE_TARGET_TYPES };

const TERMS = new Set(SOCIAL_TIES.map(({ term }) => term));

/**
 * A being's defining ties, in one shape whichever shape they reach here in.
 *
 * Two spellings reach this check, and both read the same entries from here
 * on:
 *
 * - an **{@link AddressEntries}** — the map after the note boundary decoded
 *   its keys into typed Addresses, the shape every compile sees;
 * - a **plain map**, the shape a caller reading raw YAML sees.
 *
 * `sourceKey` is always the authored key text, so a finding locates on what
 * the file actually says even when `key` already carries a parsed Address.
 *
 * @param {unknown} value - The authored `data.socialTies`.
 * @returns {{form: "absent"|"map"|"malformed",
 *   entries: Array<{key: unknown, term: unknown, sourceKey: string}>}}
 */
function readSocialTies(value) {
    if (value === undefined || value === null) return { form: "absent", entries: [] };
    if (value instanceof AddressEntries) {
        return {
            form: "map",
            entries: value.entries.map((entry) => ({
                key: entry.target,
                term: entry.value,
                sourceKey: entry.sourceKey,
            })),
        };
    }
    if (typeof value !== "object" || Array.isArray(value))
        return { form: "malformed", entries: [] };
    return {
        form: "map",
        entries: Object.entries(value).map(([key, term]) => ({ key, term, sourceKey: key })),
    };
}

/**
 * Validate a being's map of defining relationships.
 * @param {object} note
 * @param {{index?: object}} [options]
 */
export function checkSocialTies(note, { index } = {}) {
    const { form, entries } = readSocialTies(note.fm?.data?.socialTies);
    if (form === "absent") return [];
    const at = (key) => ({
        file: note.file,
        ...positionOfFrontmatterPath(
            note.raw ?? "",
            key ? ["data", "socialTies", key] : ["data", "socialTies"],
            { key: true },
        ),
        severity: "error",
    });
    if (form === "malformed")
        return [
            {
                ...at(),
                message: "data.socialTies must be a map of Address keys to relationship terms",
            },
        ];
    const findings = [];
    const seen = new Map();
    for (const { key, term, sourceKey } of entries) {
        const tuple = parseAddress(
            key,
            {
                package: index?.contentPackage,
                system: "note",
                types: index?.types,
                packages: index?.packages,
            },
            { declared: true },
        );
        if (tuple.reason) {
            findings.push({
                ...at(sourceKey),
                message: `data.socialTies key ${JSON.stringify(sourceKey)} is not a complete Address (${tuple.reason}); write being or affiliation as its type`,
            });
        } else if (!acceptsType(tuple, SOCIAL_TIE_TARGET_TYPES)) {
            findings.push({
                ...at(sourceKey),
                message: `data.socialTies accepts being or affiliation, not ${tuple.type}`,
            });
        } else {
            const target = renderAddress(tuple);
            if (seen.has(target)) {
                findings.push({
                    ...at(sourceKey),
                    message: `data.socialTies names the same target ${target} as ${JSON.stringify(seen.get(target))}; keep one tie per target`,
                });
            } else {
                seen.set(target, sourceKey);
            }
            if (
                tuple.package === index?.contentPackage &&
                tuple.type === "being" &&
                tuple.shortcode === note.fm?.shortcode
            ) {
                findings.push({
                    ...at(sourceKey),
                    message: `data.socialTies cannot address this being itself`,
                });
            } else if (index?.addressHit && !index.addressHit(target)) {
                findings.push({
                    ...at(sourceKey),
                    message: `data.socialTies target ${target} does not resolve`,
                });
            }
        }
        // A term that is not text is the inner-key check's finding.
        if ((typeof term === "string" || term === null || term === undefined) && !TERMS.has(term))
            findings.push({
                ...at(sourceKey),
                message: `data.socialTies value ${JSON.stringify(term)} must be one of ${SOCIAL_TIES.map(({ term: value }) => value).join(", ")}`,
            });
    }
    return findings;
}
