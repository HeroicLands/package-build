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
 * A work a people tells, sings or writes: the `literature` lore subType and the
 * optional facts only such a note may state about itself. Whose work it is,
 * `data.culture`, is a field every lore note but a culture note may state,
 * declared in `culture-choice.mjs`.
 *
 * `data.language` is shared beyond literature: a work names the tongue it is
 * composed in, a culture the tongue its people speak, whose name lists
 * `package-build npc new` draws from, and an affiliation the trade, temple or
 * order tongue it keeps.
 *
 * `DataFieldSpec` declares the keys a type accepts, not the subType that may
 * write them, so {@link checkLiteratureNote} scopes these keys to the subTypes
 * that mean them, the way the calendar check scopes its own to `calendar`.
 *
 * @module
 */

import { isAddressTuple, parseAddress, renderAddress } from "./address.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";

/** The `lore` subType whose notes are works of literature. */
export const LITERATURE_SUBTYPE = "literature";

/** The `lore` subTypes that may name a language. */
export const LANGUAGE_SUBTYPES = Object.freeze([LITERATURE_SUBTYPE, "culture"]);

/**
 * Require `data.language` to address a `skill` note whose subType is
 * `language`.
 *
 * An Address that does not resolve is the reference check's to report, so
 * this speaks only about a target that exists and is the wrong kind.
 *
 * @param {object} note
 * @param {{index?: object}} [options]
 * @returns {object[]} The findings.
 */
export function checkLanguageChoice(note, { index } = {}) {
    const value = note.fm?.data?.language;
    if (value === undefined || value === null || !index?.addressHit) return [];
    const tuple = parseAddress(value, {
        package: index.contentPackage,
        system: "note",
        type: "skill",
        types: index.types,
        packages: index.packages,
    });
    if (tuple.reason) return [];
    const target = index.addressHit(renderAddress(tuple));
    if (!target) return [];
    const fm = target.fm ?? target;
    if (tuple.type === "skill" && fm.subType === "language") return [];
    return [
        {
            file: note.file,
            ...positionOfFrontmatterPath(note.raw ?? "", ["data", "language"]),
            severity: "error",
            message: `data.language ${isAddressTuple(value) ? renderAddress(value) : value} names a note that is not a skill whose subType is language`,
        },
    ];
}

/**
 * `data.language`: the tongue a work is composed in, the tongue a culture's
 * people speak, or the tongue an affiliation keeps. Optional on all three.
 *
 * @type {object}
 */
export const LANGUAGE_FIELD = Object.freeze({
    name: "language",
    shape: "an Address",
    kind: "address",
    ref: "skill",
    accepts: Object.freeze(["skill"]),
    check: checkLanguageChoice,
    describe:
        "The tongue the note is in, as a language skill note: the tongue a work is composed " +
        "in, a culture's people speak, or an affiliation keeps as its trade, temple or order " +
        "tongue. `package-build npc new` draws a culture's names from its language's " +
        "`data.names`. A `literature` or `culture` lore note, or an affiliation, only.",
});

/**
 * The fields only a `literature` note may state, beside the shared
 * {@link LANGUAGE_FIELD}. Every one is optional.
 *
 * @type {ReadonlyArray<object>}
 */
export const LITERATURE_FIELDS = Object.freeze([
    {
        name: "form",
        shape: "string",
        kind: "string",
        describe:
            "The kind of work in its people's own terms — an epic, a saga, a " +
            "praise-song, an elegy. Free text.",
    },
    {
        name: "subjects",
        shape: "list of Addresses",
        kind: "list",
        entryKind: "address",
        anchors: Object.freeze(["event"]),
        describe:
            "The beings, places, gods and other notes the work concerns, and each " +
            "event it concerns, named as `place-ironfells#sack`.",
    },
]);

const LITERATURE_KEYS = Object.freeze(LITERATURE_FIELDS.map((field) => field.name));

/**
 * Refuse a literature field on a lore note of any other subType, and
 * `data.language` on a lore note that is neither a work nor a culture.
 *
 * @param {object} note
 * @returns {object[]} One error per key written off the subTypes that take it.
 */
export function checkLiteratureNote(note) {
    const type = String(note?.type ?? note?.fm?.type ?? "").toLowerCase();
    const subType = String(note?.fm?.subType ?? "").toLowerCase();
    if (type !== "lore") return [];
    const data = note?.fm?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return [];
    const stated = (key) => data[key] !== undefined && data[key] !== null;
    const finding = (key, message) => ({
        file: note.file,
        ...positionOfFrontmatterPath(note.raw ?? "", ["data", key], { key: true }),
        severity: "error",
        message,
    });
    const findings = [];
    if (subType !== LITERATURE_SUBTYPE)
        for (const key of LITERATURE_KEYS.filter(stated))
            findings.push(
                finding(
                    key,
                    `\`data.${key}\` describes a work of literature, and this note's ` +
                        `\`subType\` is not \`literature\``,
                ),
            );
    if (!LANGUAGE_SUBTYPES.includes(subType) && stated(LANGUAGE_FIELD.name))
        findings.push(
            finding(
                LANGUAGE_FIELD.name,
                "`data.language` names the tongue of a work of literature or of a culture, " +
                    "and this note's `subType` is neither `literature` nor `culture`",
            ),
        );
    return findings;
}
