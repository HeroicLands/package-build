/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * `data.culture`: the people a note belongs to, named as a `lore` note of
 * `subType: culture`.
 *
 * One declaration serves every type that takes the field. Where a type's
 * subtypes differ on it — a setting guide requires it, other `doc` genres and a
 * culture note refuse it — {@link checkCultureSubType} scopes it, because
 * `DataFieldSpec` declares the keys a type accepts and not the subType that may
 * write them.
 *
 * @module
 */

import { isAddressTuple, parseAddress, renderAddress } from "./address.mjs";
import { positionInFrontmatter, positionOfFrontmatterPath } from "./diagnostics.mjs";

/** The `lore` subType a culture names, and the one that refuses the field. */
const CULTURE_SUBTYPE = "culture";

/** The `doc` subType that requires a culture; every other `doc` subType refuses it. */
const SETTING_GUIDE_SUBTYPE = "settingguide";

/**
 * Require a note's `data.culture` to address a culture lore note.
 *
 * A value that is not a `lore` Address, or names nothing, is left to the
 * reference check, which reports it in its own terms.
 *
 * @param {object} note
 * @param {{index?: object}} [options]
 * @returns {object[]} One error at the value when it names lore of another subType.
 */
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
 * subType refuses a written value, as does a `lore` note of `subType: culture`,
 * which is itself the culture. A refusal is an error at the key.
 *
 * @param {object} note - The note, as the link index hands it over.
 * @returns {object[]} Findings.
 */
export function checkCultureSubType(note) {
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

    if (type === "lore" && subType === CULTURE_SUBTYPE && written)
        return [
            atKey(
                "`data.culture` names a note's culture, and this note is itself the " +
                    "culture — remove the field",
            ),
        ];

    return [];
}
