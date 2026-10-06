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
 * four optional facts such a note may state about itself.
 *
 * `DataFieldSpec` declares the keys a type accepts, not the subType that may
 * write them, so {@link checkLiteratureNote} scopes these keys to `literature`
 * the way the calendar check scopes its own to `calendar`.
 *
 * @module
 */

import { isAddressTuple, parseAddress, renderAddress } from "./address.mjs";
import { checkCultureChoice } from "./culture-choice.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";

/** The `lore` subType whose notes are works of literature. */
export const LITERATURE_SUBTYPE = "literature";

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
 * The fields a `literature` note may state. Every one is optional.
 *
 * @type {ReadonlyArray<object>}
 */
export const LITERATURE_FIELDS = Object.freeze([
    {
        name: "culture",
        shape: "an Address",
        kind: "address",
        ref: "lore",
        accepts: ["lore"],
        check: checkCultureChoice,
        describe: "The people whose work this is, as a culture lore note.",
    },
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
        describe: "The beings, places, gods, events and other notes the work concerns.",
    },
    {
        name: "language",
        shape: "an Address",
        kind: "address",
        ref: "skill",
        accepts: ["skill"],
        check: checkLanguageChoice,
        describe: "The tongue the work is composed in, as a language skill note.",
    },
]);

const LITERATURE_KEYS = Object.freeze(LITERATURE_FIELDS.map((field) => field.name));

/**
 * Refuse a literature field on a lore note of any other subType.
 *
 * @param {object} note
 * @returns {object[]} One error per literature key written off `literature`.
 */
export function checkLiteratureNote(note) {
    const type = String(note?.type ?? note?.fm?.type ?? "").toLowerCase();
    const subType = String(note?.fm?.subType ?? "").toLowerCase();
    if (type !== "lore" || subType === LITERATURE_SUBTYPE) return [];
    const data = note?.fm?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return [];
    return LITERATURE_KEYS.filter((key) => data[key] !== undefined && data[key] !== null).map(
        (key) => ({
            file: note.file,
            ...positionOfFrontmatterPath(note.raw ?? "", ["data", key], { key: true }),
            severity: "error",
            message:
                `\`data.${key}\` describes a work of literature, and this note's ` +
                `\`subType\` is not \`literature\``,
        }),
    );
}
