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
 * The closed sets a place's `borders` and `routes` are held to, and the keys
 * one entry of each carries.
 *
 * A leaf module, importing nothing: the note vocabulary reads the entry
 * declarations as it loads, and {@link module:engine/place-relations}, which
 * checks what the values mean, reaches the vocabulary through the Address
 * reader.
 *
 * @module
 */

/* --------------------------------------------------------------------- */
/*  The closed sets                                                       */
/* --------------------------------------------------------------------- */

/**
 * The type a border's or a route's `to` names.
 *
 * It is both the default its `<type>` segment takes when an author omits it and
 * the whole of the set the position accepts, which is what makes `vylar` and
 * `place-vylar` the same Address and a `to` naming a `lore` note an error rather
 * than a lookup that quietly finds nothing.
 *
 * @type {string}
 */
export const RELATION_TYPE = "place";

/**
 * The eight compass bearings, clockwise from north.
 *
 * Where a neighbour or a destination lies from the place stating it. The
 * order is load-bearing: {@link oppositeBearing} reads four steps around it.
 *
 * @type {readonly string[]}
 */
export const BEARINGS = Object.freeze(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);

/**
 * The modes a route is travelled by: `land`, `boat` on a river or a lake,
 * `ship` on open sea.
 *
 * @type {readonly string[]}
 */
export const ROUTE_MODES = Object.freeze(["land", "boat", "ship"]);

/**
 * The days markers a route may state.
 *
 * Each is "about this, under normal conditions": `10`, `20` and `30` are one,
 * two and three ten-day weeks, `180` is many months, `360` is "who knows".
 *
 * @type {readonly number[]}
 */
export const TRAVEL_DAYS = Object.freeze([1, 2, 3, 5, 10, 20, 30, 45, 60, 90, 180, 360]);

/**
 * The terrain registry, each terrain naming the modes that cross it.
 *
 * A land terrain is crossed by land alone; open sea by ship; a river or a lake
 * by boat; a coast by all three, because a coast road and a coasting voyage
 * are both journeys along it.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const TERRAIN_MODES = Object.freeze({
    road: Object.freeze(["land"]),
    track: Object.freeze(["land"]),
    plain: Object.freeze(["land"]),
    steppe: Object.freeze(["land"]),
    hills: Object.freeze(["land"]),
    mountains: Object.freeze(["land"]),
    forest: Object.freeze(["land"]),
    jungle: Object.freeze(["land"]),
    marsh: Object.freeze(["land"]),
    dunes: Object.freeze(["land"]),
    desert: Object.freeze(["land"]),
    ice: Object.freeze(["land"]),
    coast: Object.freeze(["land", "boat", "ship"]),
    "open-sea": Object.freeze(["ship"]),
    river: Object.freeze(["boat"]),
    lake: Object.freeze(["boat"]),
});

/**
 * The terrain names, in registry order — the closed set a `terrain` list
 * draws from.
 *
 * @type {readonly string[]}
 */
export const TERRAINS = Object.freeze(Object.keys(TERRAIN_MODES));

/** A list entry's `to` and `bearing`, which both relations carry. */
const RELATION_ENDS = Object.freeze([
    Object.freeze({
        name: "to",
        kind: "address",
        required: true,
        shape: "the other place — its shortcode, or its Address",
        describe: "The other place, by Address; the type defaults to `place`.",
    }),
    Object.freeze({
        name: "bearing",
        kind: "string",
        required: true,
        shape: `one of ${BEARINGS.join(", ")}`,
        describe: "Where the other place lies from here.",
    }),
]);

/**
 * The keys a `borders` entry carries, as inner-key declarations. Both are
 * required.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const BORDER_FIELDS = RELATION_ENDS;

/**
 * The keys a `routes` entry carries, as inner-key declarations. `to`,
 * `bearing`, `mode` and `days` are required; `terrain` and `leagues` are
 * optional.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const ROUTE_FIELDS = Object.freeze([
    ...RELATION_ENDS,
    Object.freeze({
        name: "mode",
        kind: "string",
        required: true,
        shape: `one of ${ROUTE_MODES.join(", ")}`,
        describe: "How the journey is travelled.",
    }),
    Object.freeze({
        name: "days",
        kind: "number",
        required: true,
        shape: `one of ${TRAVEL_DAYS.join(", ")}`,
        describe: "About how many days the journey takes, under normal conditions.",
    }),
    Object.freeze({
        name: "terrain",
        kind: "list",
        shape: "a list of terrains in travel order",
        entries: Object.freeze({ kind: "string", shape: "a terrain" }),
        describe: "The terrains crossed, in travel order, each crossable by the mode.",
    }),
    Object.freeze({
        name: "leagues",
        kind: "number",
        shape: "a distance in leagues",
        describe: "The distance, in leagues.",
    }),
]);

/** The keys a `borders` entry carries. @type {readonly string[]} */
export const BORDER_KEYS = Object.freeze(BORDER_FIELDS.map((field) => field.name));

/** The keys a `routes` entry carries. @type {readonly string[]} */
export const ROUTE_KEYS = Object.freeze(ROUTE_FIELDS.map((field) => field.name));
