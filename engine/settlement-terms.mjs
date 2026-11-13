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

/** Settlement columns and accepted authored values. @module */
import { MARKET_CLASSES } from "./market-class.mjs";
/** Heading for the generated table. */
export const SETTLEMENTS_HEADING = "Settlements";
/** Settlement types. */
export const SETTLEMENT_TYPES = Object.freeze([
    "encampment",
    "homestead",
    "hamlet",
    "village",
    "town",
    "city",
    "metropolis",
]);
/** Fortification types. */
export const FORTIFICATIONS = Object.freeze(["none", "minimal", "palisade", "walled", "fortress"]);
/** Stronghold types. */
export const STRONGHOLDS = Object.freeze(["fort", "castle", "keep", "fortified manor", "tower"]);
const enumeration = (name, allowed, nullable = false) => ({
    name,
    kind: "string",
    allowed,
    nullable,
    shape: allowed.join(", ") + (nullable ? ", or null" : ""),
    describe: `The settlement's ${name}.`,
});
/** Fields declared by each settlement row. */
export const SETTLEMENT_ROW_FIELDS = Object.freeze(
    [
        {
            name: "settlement",
            kind: "string",
            required: true,
            shape: "a nonempty name",
            describe: "A settlement without a note.",
        },
        {
            name: "polity",
            kind: "address-or-string",
            required: true,
            shape: "a polity Address or a name",
            describe: "The settlement's polity.",
        },
        {
            name: "location",
            kind: "address",
            required: true,
            ref: "place",
            accepts: ["place"],
            shape: "a place Address",
            describe: "The enclosing place.",
        },
        { ...enumeration("type", SETTLEMENT_TYPES), required: true },
        enumeration("fortification", FORTIFICATIONS, true),
        enumeration("stronghold", STRONGHOLDS, true),
        {
            name: "holder",
            kind: "address-or-string",
            required: true,
            shape: "an affiliation or being Address, or a name",
            describe: "Who holds the land.",
        },
        {
            name: "population",
            kind: "number",
            required: true,
            shape: "a positive integer with at most two significant digits",
            describe: "People living here.",
        },
        {
            ...enumeration(
                "market",
                MARKET_CLASSES.map((c) => c.value),
            ),
            required: true,
        },
        {
            name: "notes",
            kind: "string",
            required: true,
            shape: "nonempty short text",
            describe: "What distinguishes this settlement.",
        },
    ].map(Object.freeze),
);
/** Columns in the generated table. */
export const SETTLEMENT_COLUMNS = Object.freeze(
    SETTLEMENT_ROW_FIELDS.map((field) =>
        Object.freeze({ name: field.name[0].toUpperCase() + field.name.slice(1), required: true }),
    ),
);
/** The polity settlement list declaration. */
export const SETTLEMENTS_FIELD = Object.freeze({
    name: "settlements",
    kind: "list",
    shape: "a list of settlement rows",
    entries: { kind: "map", shape: "a settlement row", fields: SETTLEMENT_ROW_FIELDS },
    describe:
        "A polity's directly held settlements without notes; merged with noted settlements at build time.",
});
/** Rules governing settlement tables. */
export const SETTLEMENT_TABLE_RULES = Object.freeze(
    [
        [
            "body settlements table",
            "Settlement tables are generated from frontmatter and the index.",
        ],
        [
            "settlements shape",
            "Only a polity declares a list of settlement rows with the declared fields.",
        ],
        [
            "settlement field",
            "Required settlement facts are present and enumerated facts take declared values.",
        ],
        [
            "unresolved settlement reference",
            "Settlement references resolve to the required note types.",
        ],
        [
            "people figure",
            "Settlement populations are positive whole numbers with at most two significant digits.",
        ],
        ["duplicate settlement", "Each settlement is listed or noted exactly once."],
        [
            "territorial population",
            "A polity with settlements, a seat, or subordinate polities states a territorial total; settlement populations obey the configured population policy.",
        ],
        ["polity superior", "A polity declares at most one superior polity."],
        ["polity cycle", "The subordinate polity chain has no cycles."],
    ].map(([name, describe]) => Object.freeze({ name, describe })),
);
