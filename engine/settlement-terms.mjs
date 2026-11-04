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

/** Dependency-free settlement row declarations. @module */
/** The generated heading. */
export const SETTLEMENTS_HEADING = "Settlements";

/** Rendered columns, in their fixed order; Held by and For appear when a row states them. */
export const SETTLEMENT_COLUMNS = Object.freeze([
    Object.freeze({ name: "Name", required: true }),
    Object.freeze({ name: "Market", required: true }),
    Object.freeze({ name: "People", required: true }),
    Object.freeze({ name: "Held by", required: false }),
    Object.freeze({ name: "For", required: false }),
]);

/** The closed row fields; existing subjects use native Addresses. */
export const SETTLEMENT_ROW_FIELDS = Object.freeze(
    [
        {
            name: "place",
            kind: "address",
            shape: "a place Address",
            describe: "The existing settlement note; exclusive with name.",
        },
        {
            name: "name",
            kind: "string",
            shape: "plain text",
            describe: "A settlement without a note; exclusive with place.",
        },
        {
            name: "market",
            kind: "number",
            required: true,
            shape: "a market class, 1 to 6",
            describe: "What trade the settlement supports.",
        },
        {
            name: "population",
            kind: "number",
            required: true,
            shape: "a positive whole number",
            describe: "How many people live here.",
        },
        {
            name: "heldBy",
            kind: "address",
            shape: "an affiliation or being Address",
            describe:
                "What holds the settlement's land, where its culture holds land; what the holder is says how it is held.",
        },
        {
            name: "for",
            kind: "string",
            shape: "plain text",
            describe: "Optional reason the settlement exists.",
        },
    ].map(Object.freeze),
);

/** The place vocabulary's single settlement declaration. */
export const SETTLEMENTS_FIELD = Object.freeze({
    name: "settlements",
    kind: "map",
    shape: "{ rows, tail }",
    fields: Object.freeze([
        {
            name: "rows",
            kind: "list",
            required: true,
            shape: "a list of settlement rows",
            entries: { kind: "map", shape: "a settlement row", fields: SETTLEMENT_ROW_FIELDS },
            describe: "One row per settlement.",
        },
        {
            name: "tail",
            kind: "string",
            required: true,
            shape: "a nonempty sentence",
            describe: "What the table leaves out.",
        },
    ]),
    describe:
        "A region's settlement rows and the sentence stating what they leave out; the table is generated from this declaration.",
});

/** Every semantic finding, named once for the reference and its guards. */
export const SETTLEMENT_TABLE_RULES = Object.freeze(
    [
        [
            "body settlements table",
            "A body table under Settlements is refused; declare data.settlements.",
        ],
        ["settlements shape", "A region declares rows and tail, with one name or place per row."],
        ["unresolved settlement reference", "A place or heldBy Address does not resolve."],
        ["market class", "A row's market is not an integer class from 1 to 6."],
        ["people figure", "A row's population is not a positive whole number."],
        ["not a holder", "A heldBy Address names neither an affiliation nor a being."],
        ["not a settlement", "A place Address names a subject that is not a place."],
        ["figure disagrees", "A linked population differs from its note, or the note states none."],
        ["market disagrees", "A linked market differs from its note, or the note states none."],
        ["unlinked settlement", "A plain name has an existing settlement note in this region."],
        ["missing row", "A covered settlement note has no row."],
        ["duplicate settlement", "A settlement has another row here or in another region."],
        ["no tail", "The declaration has no sentence stating what it leaves out."],
    ].map(([name, describe]) => Object.freeze({ name, describe })),
);
