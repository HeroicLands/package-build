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
 * The tongue a work is composed in is its `data.lang`, which every note may
 * state.
 *
 * `DataFieldSpec` declares the keys a type accepts, not the subType that may
 * write them, so {@link checkLiteratureNote} scopes these keys to the subTypes
 * that mean them, the way the calendar check scopes its own to `calendar`.
 *
 * @module
 */

import { positionOfFrontmatterPath } from "./diagnostics.mjs";

/** The `lore` subType whose notes are works of literature. */
export const LITERATURE_SUBTYPE = "literature";

/**
 * The fields only a `literature` note may state. Every one is optional.
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
 * Refuse a literature field on a lore note of any other subType.
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
    return findings;
}
