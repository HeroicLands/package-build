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
/** A settlement's recorded household count. */
export const HOUSEHOLDS_FIELD = Object.freeze({
    name: "households",
    kind: "integer",
    kindChecked: true,
    nullable: true,
    shape: "a nonnegative household count or null",
    describe: "Exact households; null means unknown.",
    table: false,
});
/** A settlement's primary livelihood. */
export const ECONOMIC_FOCUS_FIELD = Object.freeze({
    name: "economicFocus",
    kind: "string",
    kindChecked: true,
    shape: "a primary livelihood",
    describe: "The settlement's primary livelihood.",
    table: false,
});
/** Map identity associated with a generated settlement row. */
export const GENERATOR_SOURCE_FIELD = Object.freeze({
    name: "generatorSource",
    kind: "map",
    shape: "a map source identity",
    describe: "The map cell or burg identifying this row.",
    table: false,
    fields: Object.freeze(
        [
            {
                name: "mapId",
                kind: "string",
                required: true,
                shape: "a map identity",
                describe: "Stable map identity.",
            },
            {
                name: "kind",
                kind: "string",
                required: true,
                allowed: Object.freeze(["cell", "burg"]),
                shape: "cell or burg",
                describe: "The map object kind.",
            },
            {
                name: "id",
                kind: "integer",
                kindChecked: true,
                required: true,
                shape: "a nonnegative integer",
                describe: "The map object ID.",
            },
            {
                name: "slot",
                kind: "integer",
                kindChecked: true,
                shape: "a nonnegative integer",
                describe: "A settlement's slot within a cell.",
            },
        ].map(Object.freeze),
    ),
});
/**
 * A population's actual and apparent figures.
 * @param {string} name - The field name.
 * @returns {object} The field declaration.
 */
export function populationField(name) {
    return {
        name,
        kind: "map",
        populationMap: true,
        shape: "a population with actual and optional apparent figures",
        fields: [
            {
                name: "actual",
                kind: "number",
                nullable: true,
                required: true,
                shape: "a number or null",
            },
            { name: "apparent", kind: "number", nullable: true, shape: "a number or null" },
        ],
    };
}

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
            shape: "an affiliation or being Address, or a name",
            accepts: Object.freeze(["affiliation", "being"]),
            describe: "Who holds the land.",
        },
        {
            ...populationField("population"),
            required: true,
            describe:
                "People living here; actual and apparent figures take null, zero, or a positive integer with at most two significant digits.",
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
            shape: "nonempty short text",
            describe: "What distinguishes this settlement.",
        },
        HOUSEHOLDS_FIELD,
        ECONOMIC_FOCUS_FIELD,
        GENERATOR_SOURCE_FIELD,
    ].map(Object.freeze),
);
/** Columns in the generated table. */
export const SETTLEMENT_COLUMNS = Object.freeze(
    SETTLEMENT_ROW_FIELDS.filter((field) => field.table !== false).map((field) =>
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
            "Required settlement facts, enumerated values, household counts and map identities have the declared shapes.",
        ],
        [
            "unresolved settlement reference",
            "Settlement references resolve to the required note types.",
        ],
        [
            "people figure",
            "Settlement populations are null when unknown, zero when abandoned, or positive whole numbers with at most two significant digits.",
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
