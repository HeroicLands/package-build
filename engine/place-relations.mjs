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
 * **Address**, and both are stated **from each end**: A at `NE` of B is the same
 * fact as B at `SW` of A, so a note stating one side of it and a neighbour
 * stating a different side is a contradiction the lint reports rather than a
 * discovery made while writing a third note.
 *
 * **`to` is an Address, written at whatever length says what it means.** Its
 * `<type>` segment defaults to `place` and `place` is the whole of its accepted
 * set, so `vylar`, `place-vylar` and `thalorna-none-place-vylar` name one place
 * and a `to` naming anything else is an error. The `<package>` segment defaults
 * to **the package doing the building** — wherever the value was written, and
 * whether it was authored here or carried back by a fetched index — so a short
 * `to` always names a place in the package being built, naming a dependency's
 * place is what the fully qualified form is for, and two places sharing a
 * shortcode in different packages never answer for each other.
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
 * Across that boundary the far side states the frontier in the fully qualified
 * form, which is the only form that names this package's place from over there —
 * a short `to` in a dependency's record names the package being built, so the
 * long form is not optional for a cross-package border.
 *
 * @module
 */

import { encodeAddresses } from "./address-values.mjs";

import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { acceptsType, parseAddress, renderAddress } from "./address.mjs";
import { NOTE_SYSTEM } from "./systems.mjs";

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
 * @returns {{type: string, borders: unknown, routes: unknown, parents: unknown}}
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
        };
    }
    return {
        type: String(hit?.type ?? ""),
        borders: hit?.borders,
        routes: hit?.routes,
        parents: hit?.parents,
    };
}

/**
 * The Address defaults a place's relation values are read against.
 *
 * The vocabularies are the tree's, so every position reads one grammar, and
 * there is **one** set of defaults: the package is always the one being built.
 * That is the whole of the cross-package rule, and it holds for both ends of a
 * frontier — a note's own relations and the relations a fetched index carries
 * back are read the same way, so a short value in a dependency's record names a
 * place in the package being built and a dependency names a place of its own by
 * writing the Address in full. `place` is the type an omitted `<type>` segment
 * takes, and a place is a core document, so the system is `none`.
 *
 * @param {object} [index] - The link index, for the tree's vocabularies and the
 *   package being built.
 * @returns {object} The defaults {@link parseAddress} takes.
 */
function addressDefaults(index) {
    return {
        types: index?.types ?? new Set([RELATION_TYPE]),
        packages: index?.packages,
        noIndexPackages: index?.noIndexPackages,
        package: index?.contentPackage,
        system: NOTE_SYSTEM,
        type: RELATION_TYPE,
    };
}

/**
 * The canonical Address a written relation value names, or `undefined` where it
 * names no place.
 *
 * Every comparison between two ends of a relation goes through this, so the two
 * are compared as the Addresses they name rather than as the strings two authors
 * happened to type.
 *
 * @param {unknown} written - The value as authored.
 * @param {object} defaults - What {@link addressDefaults} returns.
 * @returns {string|undefined} The canonical `package-none-place-shortcode`.
 */
function placeAddress(written, defaults) {
    if (!defaults.package) return undefined;
    const read = parseAddress(written, defaults);
    if (read.reason || !acceptsType(read, [RELATION_TYPE])) return undefined;
    return renderAddress(read);
}

/**
 * Whether one place's `parents` names another.
 *
 * @param {unknown} parents - The `parents` list.
 * @param {string|undefined} address - The place asked about, as its Address.
 * @param {object} defaults - What {@link addressDefaults} returns.
 * @returns {boolean} Whether it is named.
 */
function hasParent(parents, address, defaults) {
    if (!address || !Array.isArray(parents)) return false;
    return parents.some((p) => placeAddress(p, defaults) === address);
}

/**
 * The entries of a relation list that name one place.
 *
 * @param {unknown} list - A `borders` or `routes` value.
 * @param {string|undefined} address - The place they name, as its Address.
 * @param {object} defaults - What {@link addressDefaults} returns.
 * @returns {Record<string, unknown>[]} The entries.
 */
function entriesTo(list, address, defaults) {
    if (!address || !Array.isArray(list)) return [];
    return list.filter(
        (e) =>
            e &&
            typeof e === "object" &&
            !Array.isArray(e) &&
            placeAddress(e.to, defaults) === address,
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
    // One set of defaults, read by both ends: an omitted `<package>` segment is
    // always the package being built.
    const here = addressDefaults(index);
    /** This place, as the Address the far end has to name it by. */
    const selfAddress =
        here.package && self ?
            renderAddress({
                package: here.package,
                system: NOTE_SYSTEM,
                type: RELATION_TYPE,
                shortcode: self,
            })
        :   undefined;
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

        // `to`: an Address naming a place, and one a place declares.
        const to = entry.to;
        let target;
        let toIsValid = false;
        /** The one canonical Address `to` names, once it parses. */
        let toAddress;
        const read = parseAddress(to, here);
        if (to === undefined || to === null || to === "") {
            error(i, undefined, `${label(i)} must name the other place in \`to\``);
        } else if (
            read.reason === "no-content-index" ||
            (!read.reason && here.noIndexPackages?.has(read.package))
        ) {
            error(
                i,
                "to",
                `${label(i, "to")} names package "${read.package}", which is declared ` +
                    `\`contentIndex: false\` — a Foundry dependency only, with no content ` +
                    `index fetched for it, so nothing it publishes can be named here`,
            );
        } else if (read.reason) {
            error(
                i,
                "to",
                `${label(i, "to")} must name a place — the other place's \`shortcode\`, or ` +
                    `its address as \`${RELATION_TYPE}-<shortcode>\` or ` +
                    `\`<package>-${NOTE_SYSTEM}-${RELATION_TYPE}-<shortcode>\` for a place in ` +
                    `another package — but reads ${JSON.stringify(encodeAddresses(to))}`,
            );
        } else if (!acceptsType(read, [RELATION_TYPE])) {
            error(
                i,
                "to",
                `${label(i, "to")} names a \`${read.type}\`, and a ` +
                    `${isRoute ? "route" : "border"} is between places, so it names a ` +
                    `\`${RELATION_TYPE}\` — but reads ${JSON.stringify(encodeAddresses(to))}`,
            );
        } else if (index) {
            toAddress = renderAddress(read);
            const hit = index.addressHit(toAddress);
            if (hit) {
                target = relationsOf(hit);
                toIsValid = true;
            } else {
                // The same shortcode on a note of another type is the likely
                // slip, and naming it says what was found rather than only
                // what was not.
                const other = (index.notes ?? []).find(
                    (n) =>
                        String(n.fm?.shortcode ?? "").toLowerCase() === read.shortcode &&
                        String(n.type ?? "") !== RELATION_TYPE,
                );
                error(
                    i,
                    "to",
                    `${label(i, "to")} names "${encodeAddresses(to)}", and no place at ${toAddress} is ` +
                        `declared by this package or by a fetched index` +
                        (other ?
                            `; the ${other.type} note "${read.shortcode}" is not a place`
                        :   ""),
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
        // The pair is keyed on the Address rather than on the written form, so
        // one place named once bare and once qualified is the one pair it is.
        // With no index there is no package to complete the Address with, and
        // the shortcode is all the note itself states.
        const toKey = toAddress ?? read.shortcode;

        // Once per pair — per mode, on a route.
        const modes = seen.get(toKey) ?? new Set();
        const modeKey = isRoute ? (mode ?? "") : "";
        if (modes.has(modeKey)) {
            error(
                i,
                undefined,
                isRoute ?
                    `${label(i)} lists "${encodeAddresses(to)}" by ${mode} twice; a pair appears in \`routes\` ` +
                        `once per mode`
                :   `${label(i)} lists "${encodeAddresses(to)}" twice; a pair appears in \`borders\` once`,
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
                `${label(i, "to")} names "${encodeAddresses(to)}", which is a ${target.type} note; a ` +
                    `${field === "borders" ? "border" : "route"} is between places`,
            );
            return;
        }

        // Containment is `parents`; a border to a parent or a child restates
        // it as adjacency, and the two cannot both be true.
        if (!isRoute) {
            if (hasParent(data.parents, toAddress, here)) {
                error(
                    i,
                    undefined,
                    `${label(i)} borders "${encodeAddresses(to)}", which is this place's parent; ` +
                        `containment is \`parents\`, and a place never borders its parent`,
                );
                return;
            }
            if (hasParent(target.parents, selfAddress, here)) {
                error(
                    i,
                    undefined,
                    `${label(i)} borders "${encodeAddresses(to)}", which is this place's child; ` +
                        `containment is \`parents\`, and a place never borders its child`,
                );
                return;
            }
        }

        if (!bearingIsValid) return;
        const back = entriesTo(target[field], selfAddress, here);
        const expected = oppositeBearing(bearing);
        // How the far end writes this place: its bare `shortcode` within the same
        // package, and the full Address across a package boundary, where the far
        // note is authored in a package whose own short forms name its own
        // places.
        const selfThere = read.package === here.package || !selfAddress ? self : selfAddress;

        if (!isRoute) {
            if (back.length === 0) {
                findings.push(
                    finding(
                        i,
                        undefined,
                        "warning",
                        `"${self}" borders "${encodeAddresses(to)}" at ${bearing}, but "${encodeAddresses(to)}" states no ` +
                            `border to "${self}"; it should carry ` +
                            `\`{ to: ${selfThere}, bearing: ${expected} }\``,
                    ),
                );
                return;
            }
            const theirs = String(back[0].bearing ?? "");
            if (BEARINGS.includes(theirs) && theirs !== expected) {
                error(
                    i,
                    "bearing",
                    `"${self}" borders "${encodeAddresses(to)}" at ${bearing}, so "${encodeAddresses(to)}" should state the ` +
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
                    `"${self}" reaches "${encodeAddresses(to)}" by ${mode} in ${days} days, but "${encodeAddresses(to)}" ` +
                        `states no route to "${self}"; it should carry ` +
                        `\`{ to: ${selfThere}, bearing: ${expected}, mode: ${mode}, days: ${days} }\``,
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
                `"${self}" reaches "${encodeAddresses(to)}" by ${mode}, but "${encodeAddresses(to)}" states the route back ` +
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
                `"${self}" reaches "${encodeAddresses(to)}" at ${bearing}, so "${encodeAddresses(to)}" should state the route ` +
                    `back at bearing ${expected}, but states ${theirBearing}`,
            );
        }
        const theirDays = daysOf(sameMode.days);
        if (theirDays !== undefined && theirDays !== days) {
            error(
                i,
                "days",
                `"${self}" reaches "${encodeAddresses(to)}" by ${mode} in ${days} days, but "${encodeAddresses(to)}" states ` +
                    `the route back as ${theirDays}; both ends state the same days`,
            );
        }
    });

    return findings;
}

/**
 * Check a place note's `data.borders`.
 *
 * Every `to` is an Address a place declares, every `bearing` is one of the
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
