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
 * What a place is **next to** and what it is **reachable from**.
 *
 * A place note states what it is *within* through `data.parents`. Its other
 * two structural relations are stated here: `data.borders`, the places it
 * shares a frontier with, and `data.routes`, the journeys from its centre to
 * another place. Both are lists of entries naming the other place by
 * shortcode, and both are stated **from each end**: A at `NE` of B is the same
 * fact as B at `SW` of A, so a note stating one side of it and a neighbour
 * stating a different side is a contradiction the lint reports rather than a
 * discovery made while writing a third note.
 *
 * **The value sets are closed and stated once.** The eight bearings, the three
 * travel modes, the days markers and the terrain registry are the constants
 * below, read by the lint, compared against the specification's tables by the
 * test suite, and exported for a consumer drawing a map. A second copy of any
 * of them is one more list free to disagree.
 *
 * **Days are markers, not measurements.** A route's `days` means "about this,
 * under normal conditions" and takes one of twelve values: `10`, `20` and `30`
 * are one, two and three ten-day weeks; `180` is many months; `360` is "who
 * knows". A value off the scale is refused rather than rounded, because a
 * reader of the scale has to be able to trust that every marker means the
 * same thing wherever it appears.
 *
 * **Terrain and mode agree.** Each terrain names the modes that cross it: open
 * sea is crossed by ship, a river or a lake by boat, a road by land, and a
 * coast by any of the three. A water terrain on a land route — or the
 * reverse — is refused.
 *
 * The checks take the link index the lint already holds, so a target resolves
 * through the same resolver a wikilink does and a dependency's places take
 * part: a fetched index entry carries the relation the record stated, and a
 * border across a package boundary is checked from both ends like any other.
 *
 * @module
 */

import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { isAddressSegment } from "./address-charset.mjs";

/* --------------------------------------------------------------------- */
/*  The closed sets                                                       */
/* --------------------------------------------------------------------- */

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

/**
 * The keys a `borders` entry may carry. Both are required.
 *
 * @type {readonly string[]}
 */
export const BORDER_KEYS = Object.freeze(["to", "bearing"]);

/**
 * The keys a `routes` entry may carry. `to`, `bearing`, `mode` and `days` are
 * required; `terrain` and `leagues` are optional.
 *
 * @type {readonly string[]}
 */
export const ROUTE_KEYS = Object.freeze(["to", "bearing", "mode", "days", "terrain", "leagues"]);

/**
 * The bearing the other end of a relation states, or `undefined` for a value
 * that is not a bearing.
 *
 * @param {unknown} bearing - A bearing.
 * @returns {string|undefined} The one four steps around the compass.
 */
export function oppositeBearing(bearing) {
    const i = BEARINGS.indexOf(/** @type {string} */ (bearing));
    return i === -1 ? undefined : BEARINGS[(i + 4) % BEARINGS.length];
}

/* --------------------------------------------------------------------- */
/*  Reading the other end                                                 */
/* --------------------------------------------------------------------- */

/**
 * A resolved target, read the same way whether it is a local note or a
 * fetched index entry.
 *
 * A local note arrives with its parsed frontmatter, so the relation is
 * `fm.data.*`; a fetched entry carries `borders`, `routes` and `parents`
 * directly, copied from the record when the index was loaded.
 *
 * @param {object} hit - What the index resolved.
 * @returns {{type: string, borders: unknown, routes: unknown, parents: unknown, name: string}}
 *   The relation it states.
 */
function relationsOf(hit) {
    if (hit?.fm) {
        const data = hit.fm.data && typeof hit.fm.data === "object" ? hit.fm.data : {};
        return {
            type: String(hit.type ?? hit.fm.type ?? ""),
            borders: data.borders,
            routes: data.routes,
            parents: data.parents,
            name: String(hit.fm.shortcode ?? ""),
        };
    }
    return {
        type: String(hit?.type ?? ""),
        borders: hit?.borders,
        routes: hit?.routes,
        parents: hit?.parents,
        name: "",
    };
}

/**
 * The shortcode a `parents` entry names.
 *
 * A parent is written as a bare shortcode, and may be written as an address;
 * a shortcode is the last segment either way, because a segment carries no
 * separator.
 *
 * @param {unknown} parent - One `parents` entry.
 * @returns {string} Its shortcode.
 */
function parentShortcode(parent) {
    return String(parent ?? "")
        .split("-")
        .pop()
        .toLowerCase();
}

/**
 * Whether one place's `parents` names another.
 *
 * @param {unknown} parents - The `parents` list.
 * @param {string} shortcode - The place asked about.
 * @returns {boolean} Whether it is named.
 */
function hasParent(parents, shortcode) {
    return Array.isArray(parents) && parents.some((p) => parentShortcode(p) === shortcode);
}

/**
 * The entries of a relation list that name one place.
 *
 * @param {unknown} list - A `borders` or `routes` value.
 * @param {string} shortcode - The place they name.
 * @returns {Record<string, unknown>[]} The entries.
 */
function entriesTo(list, shortcode) {
    if (!Array.isArray(list)) return [];
    return list.filter(
        (e) =>
            e &&
            typeof e === "object" &&
            !Array.isArray(e) &&
            String(e.to ?? "").toLowerCase() === shortcode,
    );
}

/* --------------------------------------------------------------------- */
/*  The checks                                                            */
/* --------------------------------------------------------------------- */

/**
 * Format a closed set for a message: `N, NE, … or NW`.
 *
 * @param {readonly unknown[]} values - The set.
 * @returns {string} The values, joined.
 */
function oneOf(values) {
    const all = values.map(String);
    return all.length < 2 ?
            all.join("")
        :   `${all.slice(0, -1).join(", ")} or ${all[all.length - 1]}`;
}

/**
 * A days value as a number, or `undefined` where it is not one. A quoted
 * scalar is a number here for the reason it is everywhere else in the lint:
 * that is how a number arrives from many editors.
 *
 * @param {unknown} value - The authored value.
 * @returns {number|undefined} The number.
 */
function daysOf(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
        return Number(value);
    }
    return undefined;
}

/**
 * Check one relation list — `borders` or `routes` — on one place note.
 *
 * Shared by the two exported checks, which differ only in which keys an entry
 * carries, whether a route's `mode` and `days` take part, and what the
 * reciprocal check compares. Every finding is located at the entry that states
 * the fault, or at the value inside it where the fault is one value.
 *
 * @param {object} note - The note, as the link index hands it over.
 * @param {object} opts
 * @param {"borders"|"routes"} opts.field - Which list.
 * @param {object} [opts.index] - The link index, for resolving `to`. Absent,
 *   every check that needs the other end is skipped and only the values are
 *   checked.
 * @returns {object[]} Findings.
 */
function checkRelation(note, { field, index }) {
    const findings = [];
    const fm = note.fm ?? {};
    const data = fm.data && typeof fm.data === "object" && !Array.isArray(fm.data) ? fm.data : {};
    const list = data[field];
    // Absent, or the wrong shape: the container check reports the shape, so
    // nothing here has anything to add.
    if (!Array.isArray(list)) return findings;

    const raw = note.raw ?? "";
    const self = String(fm.shortcode ?? "").toLowerCase();
    const isRoute = field === "routes";
    const keys = isRoute ? ROUTE_KEYS : BORDER_KEYS;
    const at = (i, key) =>
        positionOfFrontmatterPath(raw, ["data", field, i, ...(key ? [key] : [])]);
    const label = (i, key) => `\`data.${field}[${i}]${key ? `.${key}` : ""}\``;
    const finding = (i, key, severity, message) => ({
        file: note.file,
        ...at(i, key),
        severity,
        message,
    });
    const error = (i, key, message) => findings.push(finding(i, key, "error", message));

    /** `to` → the modes it has been listed with, for the once-per-pair rule. */
    const seen = new Map();

    list.forEach((entry, i) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            error(
                i,
                undefined,
                `${label(i)} must be a map — \`{ to: <shortcode>, bearing: <bearing>` +
                    `${isRoute ? ", mode: <mode>, days: <days>" : ""} }\` — but reads ` +
                    JSON.stringify(entry),
            );
            return;
        }

        for (const key of Object.keys(entry)) {
            if (keys.includes(key)) continue;
            error(
                i,
                key,
                `"${key}" is not a key of a ${field} entry; an entry carries ` +
                    `${oneOf(keys.map((k) => `\`${k}\``))} and nothing else`,
            );
        }

        // `to`: a shortcode, and one a place declares.
        const to = entry.to;
        let target;
        let toIsValid = false;
        if (to === undefined || to === null || to === "") {
            error(i, undefined, `${label(i)} must name the other place in \`to\``);
        } else if (typeof to !== "string" || !isAddressSegment(to)) {
            error(
                i,
                "to",
                `${label(i, "to")} must be a shortcode — the other place's ` +
                    `\`shortcode\`, not an address — but reads ${JSON.stringify(to)}`,
            );
        } else if (index) {
            const hit = index.referenceHit(`place-${to}`);
            if (hit) {
                target = relationsOf(hit);
                toIsValid = true;
            } else {
                // The same shortcode on a note of another type is the likely
                // slip, and naming it says what was found rather than only
                // what was not.
                const other = (index.notes ?? []).find(
                    (n) => String(n.fm?.shortcode ?? "").toLowerCase() === to.toLowerCase(),
                );
                error(
                    i,
                    "to",
                    `${label(i, "to")} names "${to}", and no place in this package or a ` +
                        `fetched index declares that shortcode` +
                        (other ? `; the ${other.type} note "${to}" is not a place` : ""),
                );
            }
        } else {
            toIsValid = true;
        }

        // `bearing`.
        const bearing = entry.bearing;
        let bearingIsValid = false;
        if (bearing === undefined || bearing === null || bearing === "") {
            error(i, undefined, `${label(i)} must state a \`bearing\` — ${oneOf(BEARINGS)}`);
        } else if (!BEARINGS.includes(String(bearing))) {
            error(
                i,
                "bearing",
                `${label(i, "bearing")} must be one of ${oneOf(BEARINGS)}, but reads ` +
                    JSON.stringify(bearing),
            );
        } else {
            bearingIsValid = true;
        }

        // `mode` and `days`, on a route.
        let mode;
        let days;
        if (isRoute) {
            if (entry.mode === undefined || entry.mode === null || entry.mode === "") {
                error(i, undefined, `${label(i)} must state a \`mode\` — ${oneOf(ROUTE_MODES)}`);
            } else if (!ROUTE_MODES.includes(String(entry.mode))) {
                error(
                    i,
                    "mode",
                    `${label(i, "mode")} must be one of ${oneOf(ROUTE_MODES)}, but reads ` +
                        JSON.stringify(entry.mode),
                );
            } else {
                mode = String(entry.mode);
            }

            if (entry.days === undefined || entry.days === null || entry.days === "") {
                error(i, undefined, `${label(i)} must state \`days\` — ${oneOf(TRAVEL_DAYS)}`);
            } else {
                const n = daysOf(entry.days);
                if (n === undefined || !TRAVEL_DAYS.includes(n)) {
                    error(
                        i,
                        "days",
                        `${label(i, "days")} must be one of ${oneOf(TRAVEL_DAYS)} — a marker ` +
                            `meaning "about this, under normal conditions" — but reads ` +
                            JSON.stringify(entry.days),
                    );
                } else {
                    days = n;
                }
            }

            if (entry.terrain !== undefined && entry.terrain !== null) {
                if (!Array.isArray(entry.terrain)) {
                    error(
                        i,
                        "terrain",
                        `${label(i, "terrain")} must be a list of terrains in travel order, ` +
                            `but reads ${JSON.stringify(entry.terrain)}`,
                    );
                } else {
                    entry.terrain.forEach((terrain, j) => {
                        const name = String(terrain);
                        const modes = TERRAIN_MODES[name];
                        if (!modes) {
                            findings.push({
                                file: note.file,
                                ...positionOfFrontmatterPath(raw, ["data", field, i, "terrain", j]),
                                severity: "error",
                                message:
                                    `${label(i, "terrain")} names "${name}", which is not a ` +
                                    `terrain; the registry is ${oneOf(TERRAINS)}`,
                            });
                        } else if (mode && !modes.includes(mode)) {
                            findings.push({
                                file: note.file,
                                ...positionOfFrontmatterPath(raw, ["data", field, i, "terrain", j]),
                                severity: "error",
                                message:
                                    `${label(i, "terrain")} names "${name}", which is crossed ` +
                                    `by ${oneOf(modes)}, but the route is by ${mode}`,
                            });
                        }
                    });
                }
            }

            if (entry.leagues !== undefined && entry.leagues !== null) {
                const n = daysOf(entry.leagues);
                if (n === undefined || n <= 0) {
                    error(
                        i,
                        "leagues",
                        `${label(i, "leagues")} must be a distance in leagues, but reads ` +
                            JSON.stringify(entry.leagues),
                    );
                }
            }
        }

        if (!toIsValid) return;
        const toKey = String(to).toLowerCase();

        // Once per pair — per mode, on a route.
        const modes = seen.get(toKey) ?? new Set();
        const modeKey = isRoute ? (mode ?? "") : "";
        if (modes.has(modeKey)) {
            error(
                i,
                undefined,
                isRoute ?
                    `${label(i)} lists "${to}" by ${mode} twice; a pair appears in \`routes\` ` +
                        `once per mode`
                :   `${label(i)} lists "${to}" twice; a pair appears in \`borders\` once`,
            );
            return;
        }
        modes.add(modeKey);
        seen.set(toKey, modes);

        if (!target) return;

        if (target.type !== "place") {
            error(
                i,
                "to",
                `${label(i, "to")} names "${to}", which is a ${target.type} note; a ` +
                    `${field === "borders" ? "border" : "route"} is between places`,
            );
            return;
        }

        // Containment is `parents`; a border to a parent or a child restates
        // it as adjacency, and the two cannot both be true.
        if (!isRoute) {
            if (hasParent(data.parents, toKey)) {
                error(
                    i,
                    undefined,
                    `${label(i)} borders "${to}", which is this place's parent; ` +
                        `containment is \`parents\`, and a place never borders its parent`,
                );
                return;
            }
            if (hasParent(target.parents, self)) {
                error(
                    i,
                    undefined,
                    `${label(i)} borders "${to}", which is this place's child; ` +
                        `containment is \`parents\`, and a place never borders its child`,
                );
                return;
            }
        }

        if (!bearingIsValid) return;
        const back = entriesTo(target[field], self);
        const expected = oppositeBearing(bearing);

        if (!isRoute) {
            if (back.length === 0) {
                findings.push(
                    finding(
                        i,
                        undefined,
                        "warning",
                        `"${self}" borders "${to}" at ${bearing}, but "${to}" states no ` +
                            `border to "${self}"; it should carry ` +
                            `\`{ to: ${self}, bearing: ${expected} }\``,
                    ),
                );
                return;
            }
            const theirs = String(back[0].bearing ?? "");
            if (BEARINGS.includes(theirs) && theirs !== expected) {
                error(
                    i,
                    "bearing",
                    `"${self}" borders "${to}" at ${bearing}, so "${to}" should state the ` +
                        `border back at bearing ${expected}, but states ${theirs}`,
                );
            }
            return;
        }

        if (mode === undefined || days === undefined) return;
        if (back.length === 0) {
            findings.push(
                finding(
                    i,
                    undefined,
                    "warning",
                    `"${self}" reaches "${to}" by ${mode} in ${days} days, but "${to}" ` +
                        `states no route to "${self}"; it should carry ` +
                        `\`{ to: ${self}, bearing: ${expected}, mode: ${mode}, days: ${days} }\``,
                ),
            );
            return;
        }
        const sameMode = back.find((e) => String(e.mode ?? "") === mode);
        if (!sameMode) {
            // Only the modes the other end states validly: an invalid one is
            // that note's own finding, and reading it as a mismatch here would
            // report one slip twice.
            const theirs = [...new Set(back.map((e) => String(e.mode ?? "")))].filter((m) =>
                ROUTE_MODES.includes(m),
            );
            if (theirs.length === 0) return;
            error(
                i,
                "mode",
                `"${self}" reaches "${to}" by ${mode}, but "${to}" states the route back ` +
                    `by ${oneOf(theirs)} only; a pair is stated by the same mode at ` +
                    `both ends`,
            );
            return;
        }
        const theirBearing = String(sameMode.bearing ?? "");
        if (BEARINGS.includes(theirBearing) && theirBearing !== expected) {
            error(
                i,
                "bearing",
                `"${self}" reaches "${to}" at ${bearing}, so "${to}" should state the route ` +
                    `back at bearing ${expected}, but states ${theirBearing}`,
            );
        }
        const theirDays = daysOf(sameMode.days);
        if (theirDays !== undefined && theirDays !== days) {
            error(
                i,
                "days",
                `"${self}" reaches "${to}" by ${mode} in ${days} days, but "${to}" states ` +
                    `the route back as ${theirDays}; both ends state the same days`,
            );
        }
    });

    return findings;
}

/**
 * Check a place note's `data.borders`.
 *
 * Every `to` is a shortcode a place declares, every `bearing` is one of the
 * eight, no pair is listed twice, no target is the note's own parent or child,
 * and the other end states the pair back at the opposite bearing — a missing
 * reciprocal is a warning naming both notes, a wrong one an error.
 *
 * @param {object} note - The note, as the link index hands it over.
 * @param {object} [opts]
 * @param {object} [opts.index] - The link index, for resolving `to`.
 * @returns {object[]} Findings.
 */
export function checkBorders(note, { index } = {}) {
    return checkRelation(note, { field: "borders", index });
}

/**
 * Check a place note's `data.routes`.
 *
 * As {@link checkBorders}, plus: `mode` and `days` are required and from
 * their sets, `terrain` is from the registry and crossable by the mode, a pair
 * appears once per mode, and the other end states the pair back by the same
 * mode, at the opposite bearing, with the same days.
 *
 * @param {object} note - The note, as the link index hands it over.
 * @param {object} [opts]
 * @param {object} [opts.index] - The link index, for resolving `to`.
 * @returns {object[]} Findings.
 */
export function checkRoutes(note, { index } = {}) {
    return checkRelation(note, { field: "routes", index });
}
