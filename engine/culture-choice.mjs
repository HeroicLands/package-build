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
 * `data.culture`: the people a note belongs to, named as a `lore` note of
 * `subType: culture`.
 *
 * One declaration serves every type that takes the field. Where a type's
 * subtypes differ on it — a setting guide requires it, other `doc` genres
 * refuse it, and a culture note names only itself — {@link checkCultureSubType}
 * scopes it, because
 * `DataFieldSpec` declares the keys a type accepts and not the subType that may
 * write them.
 *
 * @module
 */

import {
    canonicalKey,
    isAddressTuple,
    ownDocumentSystem,
    parseAddress,
    renderAddress,
} from "./address.mjs";
import { positionInFrontmatter, positionOfFrontmatterPath } from "./diagnostics.mjs";

/** The `lore` subType a culture names, and the one whose culture is itself. */
const CULTURE_SUBTYPE = "culture";

/** The `doc` subType that requires a culture; every other `doc` subType refuses it. */
const SETTING_GUIDE_SUBTYPE = "settingguide";

/**
 * The Address a `data.culture` value names, read against the defaults of the
 * position it is written in.
 *
 * @param {unknown} value - The value as written, or an already decoded tuple.
 * @param {object} [index] - The link index, for the package and vocabularies.
 * @returns {object} The tuple, or the parser's problem.
 */
function cultureAddress(value, index) {
    return parseAddress(value, {
        package: index?.contentPackage,
        system: "note",
        type: "lore",
        types: index?.types,
        packages: index?.packages,
    });
}

/**
 * Whether a `data.culture` value names the note that carries it.
 *
 * The comparison is between canonical Addresses, so a culture note's shortcode,
 * any longer form of its Address and a decoded tuple all name it alike. A note
 * with no shortcode has no Address to compare against and names nothing.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {unknown} value - The `data.culture` value, as written or decoded.
 * @param {object} [index] - The package and vocabularies a written value is
 *   read against, and the package the note's own Address is in.
 * @returns {boolean} Whether the value is the note's own Address.
 */
export function cultureNamesItself(fm, value, index) {
    const shortcode = fm?.shortcode;
    const type = String(fm?.type ?? "").toLowerCase();
    if (typeof shortcode !== "string" || !shortcode.trim() || !type) return false;
    if (value === undefined || value === null) return false;
    const tuple = cultureAddress(value, index);
    if (tuple.reason) return false;
    return (
        renderAddress(tuple) ===
        canonicalKey(index?.contentPackage, ownDocumentSystem(type), type, shortcode.trim())
    );
}

/**
 * Whether a note is a `lore` note of `subType: culture`.
 *
 * @param {object} note - The note, as the link index hands it over.
 * @returns {boolean} Whether it is a culture note.
 */
function isCultureNote(note) {
    return (
        String(note?.type ?? note?.fm?.type ?? "").toLowerCase() === "lore" &&
        String(note?.fm?.subType ?? "").toLowerCase() === CULTURE_SUBTYPE
    );
}

/**
 * Require a note's `data.culture` to address a culture lore note.
 *
 * A value that is not a `lore` Address, or names nothing, is left to the
 * reference check, which reports it in its own terms. A culture note's own
 * value is {@link checkCultureSubType}'s to judge, since it names only the note
 * itself.
 *
 * @param {object} note
 * @param {{index?: object}} [options]
 * @returns {object[]} One error at the value when it names lore of another subType.
 */
export function checkCultureChoice(note, { index } = {}) {
    const value = note.fm?.data?.culture;
    if (value === undefined || value === null || !index?.addressHit) return [];
    if (isCultureNote(note)) return [];
    const tuple = cultureAddress(value, index);
    if (tuple.reason || tuple.type !== "lore") return [];
    const target = index.addressHit(renderAddress(tuple));
    if (!target || (target.fm ?? target).subType === CULTURE_SUBTYPE) return [];
    const type = String(note.type ?? note.fm?.type ?? "note");
    const article = /^[aeiou]/i.test(type) ? "an" : "a";
    return [
        {
            file: note.file,
            ...positionOfFrontmatterPath(note.raw ?? "", ["data", "culture"]),
            severity: "error",
            message:
                `data.culture ${isAddressTuple(value) ? renderAddress(value) : value} names lore ` +
                `whose subType is not culture; ${article} ${type}'s culture is a culture lore note`,
        },
    ];
}

/**
 * The `data.culture` field, declared once and spread into each type that takes
 * it. A type gives its own `describe` where the field means something narrower
 * there.
 *
 * @type {Readonly<object>}
 */
export const CULTURE_FIELD = Object.freeze({
    name: "culture",
    shape: "an Address",
    kind: "address",
    ref: "lore",
    accepts: Object.freeze(["lore"]),
    check: checkCultureChoice,
    describe: "The people this note belongs to, as a culture lore note.",
});

/**
 * Scope `data.culture` to the subtypes that take it.
 *
 * A `doc` of `subType: settingguide` introduces one culture's setting and must
 * name it; a missing value is an error at the `subType:` line. Every other `doc`
 * subType refuses a written value, as an error at the key.
 *
 * A `lore` note of `subType: culture` is itself the culture. It may omit the
 * field or name itself, in any form the Address parser reads; a value naming any
 * other Address is an error at the value. A note with no shortcode has no
 * Address to compare against, and the shortcode check reports it.
 *
 * @param {object} note - The note, as the link index hands it over.
 * @param {{index?: object}} [options] - The link index, for the package and
 *   vocabularies a written value is read against.
 * @returns {object[]} Findings.
 */
export function checkCultureSubType(note, { index } = {}) {
    const type = String(note?.type ?? note?.fm?.type ?? "").toLowerCase();
    const subType = String(note?.fm?.subType ?? "").toLowerCase();
    const data = note?.fm?.data;
    const written =
        data !== null &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        data.culture !== undefined &&
        data.culture !== null;
    const atKey = (message) => ({
        file: note.file,
        ...positionOfFrontmatterPath(note.raw ?? "", ["data", "culture"], { key: true }),
        severity: "error",
        message,
    });

    if (type === "doc") {
        if (subType === SETTING_GUIDE_SUBTYPE) {
            if (written) return [];
            return [
                {
                    file: note.file,
                    ...positionInFrontmatter(note.raw ?? "", "subType", undefined, {
                        topLevel: true,
                    }),
                    severity: "error",
                    message:
                        "a setting guide introduces one culture, so this note must state " +
                        "`data.culture`, naming a culture lore note",
                },
            ];
        }
        if (!written) return [];
        return [
            atKey(
                `\`data.culture\` is stated by a setting guide, and this note's \`subType\` ` +
                    `is not \`${SETTING_GUIDE_SUBTYPE}\``,
            ),
        ];
    }

    if (type === "lore" && subType === CULTURE_SUBTYPE && written) {
        const shortcode = note.fm?.shortcode;
        if (typeof shortcode !== "string" || !shortcode.trim()) return [];
        const value = data.culture;
        if (cultureAddress(value, index).reason) return [];
        if (cultureNamesItself({ ...note.fm, type }, value, index)) return [];
        return [
            {
                file: note.file,
                ...positionOfFrontmatterPath(note.raw ?? "", ["data", "culture"]),
                severity: "error",
                message:
                    `data.culture ${isAddressTuple(value) ? renderAddress(value) : value} ` +
                    `names another note; a culture note's data.culture names the note itself`,
            },
        ];
    }

    return [];
}
