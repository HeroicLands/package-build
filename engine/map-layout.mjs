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
 * The geometry of the map from a place.
 *
 * A pre-modern map was an itinerary: centred on its maker, exact about the
 * next stage and vague about the tenth. A place note's `borders` and `routes`
 * are exactly that, so the map from a place puts the place at the centre and
 * every neighbour where its bearing and its days say — **north up, east
 * right**, the angle from the bearing and the radius from the days marker.
 * One ring per marker, spaced logarithmically so a day's ride and a month's
 * voyage both fit on one page; a border with no route on the innermost ring; a
 * place whose days nobody stated on the rim, marked unknown.
 *
 * **Positions are computed here, not solved by a layout engine.** GraphViz
 * receives every node pinned and only draws, so the picture states what the
 * notes state and nothing a solver decided. Everything in this module is
 * arithmetic over the place records — no file, no process, no GraphViz — so
 * it is tested by asserting coordinates.
 *
 * @module
 */

import { BEARINGS, TRAVEL_DAYS } from "./place-relations.mjs";

/* --------------------------------------------------------------------- */
/*  Bearings                                                              */
/* --------------------------------------------------------------------- */

/**
 * The angle of a bearing in degrees, counter-clockwise from east, so north
 * is up and east is right on a page whose `y` grows upward — GraphViz's
 * coordinate system for a pinned position.
 *
 * @param {unknown} bearing - A bearing.
 * @returns {number|undefined} `N` is 90, `E` 0, `S` -90, `W` 180; `undefined`
 *   for a value that is not a bearing.
 */
export function bearingAngle(bearing) {
    const i = BEARINGS.indexOf(/** @type {string} */ (bearing));
    if (i === -1) return undefined;
    const angle = 90 - 45 * i;
    return angle <= -180 ? angle + 360 : angle;
}

/**
 * The unit vector of a bearing.
 *
 * @param {unknown} bearing - A bearing.
 * @returns {{x: number, y: number}|undefined} The vector, or `undefined` for a
 *   value that is not a bearing.
 */
export function bearingVector(bearing) {
    const angle = bearingAngle(bearing);
    if (angle === undefined) return undefined;
    const rad = (angle * Math.PI) / 180;
    return { x: Math.cos(rad), y: Math.sin(rad) };
}

/**
 * How many steps around the compass separate two bearings, the shorter way:
 * 0 for the same bearing, 1 for adjacent ones, 4 for opposites.
 *
 * @param {unknown} a - A bearing.
 * @param {unknown} b - A bearing.
 * @returns {number|undefined} The steps, or `undefined` when either is not a
 *   bearing.
 */
export function bearingSteps(a, b) {
    const i = BEARINGS.indexOf(/** @type {string} */ (a));
    const j = BEARINGS.indexOf(/** @type {string} */ (b));
    if (i === -1 || j === -1) return undefined;
    const d = Math.abs(i - j) % BEARINGS.length;
    return Math.min(d, BEARINGS.length - d);
}

/* --------------------------------------------------------------------- */
/*  Rings                                                                 */
/* --------------------------------------------------------------------- */

/**
 * The horizon of the map from a place, in days. A place farther than this
 * is a name at the rim rather than a node on a ring.
 *
 * @type {number}
 */
export const HORIZON_DAYS = 90;

/**
 * The days markers that are rings — every marker of the scale up to the
 * horizon.
 *
 * @type {readonly number[]}
 */
export const RING_DAYS = Object.freeze(TRAVEL_DAYS.filter((d) => d <= HORIZON_DAYS));

/** The radius of the one-day ring, in points. */
const INNER_RADIUS = 160;

/** The radius of the horizon ring, in points. */
const HORIZON_RADIUS = 560;

/** Points of radius per unit of `ln(days)`: the log spacing of the rings. */
const RADIUS_PER_LOG_DAY = (HORIZON_RADIUS - INNER_RADIUS) / Math.log(HORIZON_DAYS);

/**
 * The radius of the rim — where a place beyond the horizon, or one whose
 * days nobody stated, is named. One log step beyond the horizon, so the rim
 * reads as the next ring rather than a margin.
 *
 * @returns {number} Points.
 */
export function rimRadius() {
    return INNER_RADIUS + RADIUS_PER_LOG_DAY * Math.log(HORIZON_DAYS * 2);
}

/**
 * The radius of the ring a days value sits on.
 *
 * Logarithmic in days, so equal ratios of days are equal steps of radius: a
 * day to two days is the same step as five to ten. Any value beyond the
 * horizon, and no value at all, is the rim.
 *
 * @param {number|undefined} days - A days value, on the scale or not.
 * @returns {number} Points.
 */
export function ringRadius(days) {
    if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) return rimRadius();
    if (days > HORIZON_DAYS) return rimRadius();
    return INNER_RADIUS + RADIUS_PER_LOG_DAY * Math.log(days);
}

/**
 * The rings, inside out — one per marker up to the horizon.
 *
 * @returns {Array<{days: number, radius: number}>} Each marker and its radius.
 */
export function rings() {
    return RING_DAYS.map((days) => ({ days, radius: ringRadius(days) }));
}

/**
 * The smallest marker of the scale that covers a total of days, or `undefined`
 * beyond the scale's end or for no total at all.
 *
 * A two-hop journey adds two markers, and the sum is rarely a marker itself;
 * the ring it belongs on is the first one no shorter than it — "about this,
 * under normal conditions", rounded the pessimistic way.
 *
 * @param {number|undefined} total - Days, on the scale or not.
 * @returns {number|undefined} The marker.
 */
export function daysMarker(total) {
    if (typeof total !== "number" || !Number.isFinite(total)) return undefined;
    return TRAVEL_DAYS.find((d) => d >= total);
}

/**
 * The length a route's edge asks of `neato` in the whole route graph, in
 * inches — the same log scale as the rings, so the god's-eye view and the
 * itinerary agree about what a day and a month look like.
 *
 * @param {number|undefined} days - The route's days, or none for a border.
 * @returns {number} Inches.
 */
export function edgeLength(days) {
    const d = typeof days === "number" && Number.isFinite(days) && days > 0 ? days : 1;
    return (INNER_RADIUS + RADIUS_PER_LOG_DAY * Math.log(d)) / 72;
}

/* --------------------------------------------------------------------- */
/*  Composing hops                                                        */
/* --------------------------------------------------------------------- */

/**
 * One hop of a journey: a bearing and, for a route, its days.
 *
 * @typedef {object} Hop
 * @property {string} bearing - Where the far end lies from the near end.
 * @property {number} [days] - The route's marker; absent for a border.
 */

/**
 * Two hops composed into one bearing and one total, or nothing where they
 * disagree.
 *
 * Two hops agree when their bearings are the same or adjacent; then the
 * composed direction is that of the two hops added as vectors weighted by
 * their days, and the total is their sum. A hop with no days — a border —
 * makes the total unknown, because a frontier states no distance, and then
 * the two hops weigh the same, because nothing says which is the longer.
 * Hops two or more steps apart do not compose:
 * a place east and then north of here is not in any one direction, and the
 * map omits it rather than guess.
 *
 * @param {Hop} first - The hop from the centre.
 * @param {Hop} second - The hop onward.
 * @returns {{angle: number, days: number|undefined}|undefined} The composed
 *   bearing in degrees and the total days, or `undefined` where the hops
 *   disagree or either bearing is not one.
 */
export function composeHops(first, second) {
    const steps = bearingSteps(first?.bearing, second?.bearing);
    if (steps === undefined || steps > 1) return undefined;
    const u = /** @type {{x: number, y: number}} */ (bearingVector(first.bearing));
    const v = /** @type {{x: number, y: number}} */ (bearingVector(second.bearing));
    const known = (d) => typeof d === "number" && Number.isFinite(d) && d > 0;
    const both = known(first.days) && known(second.days);
    const w1 = both ? /** @type {number} */ (first.days) : 1;
    const w2 = both ? /** @type {number} */ (second.days) : 1;
    const x = w1 * u.x + w2 * v.x;
    const y = w1 * u.y + w2 * v.y;
    const angle = (Math.atan2(y, x) * 180) / Math.PI;
    const days =
        both ? /** @type {number} */ (first.days) + /** @type {number} */ (second.days) : undefined;
    // -0 from atan2 on an exactly-east result reads as 0.
    return { angle: angle === 0 ? 0 : angle, days };
}

/* --------------------------------------------------------------------- */
/*  Reading a place's relations from both ends                            */
/* --------------------------------------------------------------------- */

/**
 * A place as the map reads it. The shape {@link module:engine/map-places}
 * builds from the content index; only the relation fields matter here.
 *
 * @typedef {object} MapPlace
 * @property {string} shortcode
 * @property {string} name
 * @property {string} [subType]
 * @property {string[]} parents
 * @property {Array<{to: string, bearing: string}>} borders
 * @property {Array<{to: string, bearing: string, mode?: string, days?: number}>} routes
 * @property {string} [url]
 * @property {string} [address]
 */

/**
 * A relation between two places, read from whichever end states it.
 *
 * @typedef {object} Relation
 * @property {string} from
 * @property {string} to
 * @property {string} bearing - Where `to` lies from `from`.
 * @property {"border"|"route"} kind
 * @property {number} [days]
 * @property {string} [mode]
 * @property {boolean} stated - Whether `from` states it, as opposed to `to`.
 */

/**
 * The lower-case shortcode a relation entry names.
 *
 * @param {unknown} entry - A `borders` or `routes` entry.
 * @returns {string} The shortcode, or `""` for an entry naming none.
 */
function targetOf(entry) {
    return String(entry?.to ?? "").toLowerCase();
}

/**
 * A days value as a number on the scale, or `undefined`.
 *
 * @param {unknown} value - The authored value.
 * @returns {number|undefined} The days.
 */
function daysOf(value) {
    const n = typeof value === "string" ? Number(value) : value;
    return typeof n === "number" && TRAVEL_DAYS.includes(n) ? n : undefined;
}

/**
 * The bearing the other end of a relation states.
 *
 * @param {string} bearing - A bearing.
 * @returns {string} The opposite one.
 */
function opposite(bearing) {
    const i = BEARINGS.indexOf(bearing);
    return BEARINGS[(i + 4) % BEARINGS.length];
}

/**
 * Every relation touching one place, read from both ends.
 *
 * A border or a route is one fact stated from each end, and a note that
 * states one side of it does not make the fact untrue — so the map reads what
 * the place states *and* what every other place states about it, inverting
 * the bearing on the way back. The place's own statement wins where both
 * exist, and a target no place declares is returned separately so the caller
 * can name it. The lint is where a missing reciprocal is reported; here it is
 * simply drawn.
 *
 * @param {Map<string, MapPlace>} places - Every place, by shortcode.
 * @param {string} shortcode - The place asked about.
 * @returns {{relations: Relation[], unresolved: Array<{from: string, to: string}>}}
 *   The relations, own statements first, and the targets that resolved to
 *   nothing.
 */
export function relationsOf(places, shortcode) {
    const self = places.get(shortcode);
    /** @type {Relation[]} */
    const relations = [];
    /** @type {Array<{from: string, to: string}>} */
    const unresolved = [];
    const seen = new Set();
    const key = (r) => `${r.to}|${r.kind}|${r.mode ?? ""}`;

    const own = (list, kind) => {
        for (const entry of Array.isArray(list) ? list : []) {
            const to = targetOf(entry);
            const bearing = String(entry?.bearing ?? "");
            if (!to || !BEARINGS.includes(bearing)) continue;
            if (!places.has(to)) {
                unresolved.push({ from: shortcode, to });
                continue;
            }
            const relation = {
                from: shortcode,
                to,
                bearing,
                kind,
                stated: true,
                ...(kind === "route" ?
                    { days: daysOf(entry.days), mode: String(entry.mode ?? "") }
                :   {}),
            };
            if (seen.has(key(relation))) continue;
            seen.add(key(relation));
            relations.push(relation);
        }
    };
    own(self?.borders, "border");
    own(self?.routes, "route");

    for (const [other, place] of places) {
        if (other === shortcode) continue;
        const inbound = (list, kind) => {
            for (const entry of Array.isArray(list) ? list : []) {
                if (targetOf(entry) !== shortcode) continue;
                const theirs = String(entry?.bearing ?? "");
                if (!BEARINGS.includes(theirs)) continue;
                const relation = {
                    from: shortcode,
                    to: other,
                    bearing: opposite(theirs),
                    kind,
                    stated: false,
                    ...(kind === "route" ?
                        { days: daysOf(entry.days), mode: String(entry.mode ?? "") }
                    :   {}),
                };
                if (seen.has(key(relation))) continue;
                seen.add(key(relation));
                relations.push(relation);
            }
        };
        inbound(place.borders, "border");
        inbound(place.routes, "route");
    }

    return { relations, unresolved };
}

/* --------------------------------------------------------------------- */
/*  The map from a place                                                  */
/* --------------------------------------------------------------------- */

/**
 * One place on the map from a place.
 *
 * @typedef {object} FromNode
 * @property {string} shortcode
 * @property {number} hop - 0 for the centre, 1 for a neighbour, 2 beyond.
 * @property {number} x - Points, east positive.
 * @property {number} y - Points, north positive.
 * @property {number} angle - Degrees, counter-clockwise from east.
 * @property {number} radius - Points from the centre.
 * @property {number} [days] - The days the ring was chosen by, or none.
 * @property {boolean} border - Reached by a border alone.
 * @property {boolean} unknown - On the rim because nobody stated its days.
 * @property {string} [via] - The neighbour a second hop is reached through.
 */

/**
 * One edge on the map from a place.
 *
 * @typedef {object} FromEdge
 * @property {string} from
 * @property {string} to
 * @property {"border"|"route"} kind - A route where any route reaches `to`.
 * @property {string} bearing
 * @property {number} [days] - The shortest route's.
 * @property {string} [mode] - The shortest route's.
 * @property {Array<{mode: string, days: number|undefined}>} routes - Every
 *   route that reaches `to`, for the label.
 * @property {number} hop - 1 from the centre, 2 onward.
 */

/**
 * Half the spread, in degrees, between neighbours that share a ring and a
 * bearing, so they fan out rather than stack.
 */
const FAN_DEGREES = 14;

/**
 * Fan apart the nodes that would otherwise sit on one point.
 *
 * Nodes on one ring at one angle are spread evenly about that angle, in name
 * order so the picture is stable between runs, and their mean stays where the
 * bearing put it.
 *
 * @param {FromNode[]} nodes - The nodes, angles set.
 * @param {Map<string, MapPlace>} places - For the names.
 * @returns {void}
 */
function fanApart(nodes, places) {
    /** @type {Map<string, FromNode[]>} */
    const groups = new Map();
    for (const node of nodes) {
        if (node.hop === 0) continue;
        const key = `${node.radius.toFixed(3)}@${node.angle.toFixed(3)}`;
        const group = groups.get(key) ?? [];
        group.push(node);
        groups.set(key, group);
    }
    for (const group of groups.values()) {
        if (group.length < 2) continue;
        group.sort((a, b) =>
            String(places.get(a.shortcode)?.name ?? a.shortcode).localeCompare(
                String(places.get(b.shortcode)?.name ?? b.shortcode),
            ),
        );
        const step = Math.min(FAN_DEGREES, (2 * FAN_DEGREES) / (group.length - 1));
        group.forEach((node, i) => {
            node.angle += (i - (group.length - 1) / 2) * step;
        });
    }
}

/**
 * Lay out the map from a place.
 *
 * The centre at the origin. Every neighbour it states, or that states it, at
 * the angle of its bearing and on the ring of its days — the innermost ring
 * for a border with no route, the shortest route where several modes reach
 * one neighbour. Beyond each neighbour, every place a second hop reaches, at
 * the composed bearing where the two hops agree and on the ring of their
 * total; on the rim, marked unknown, where either hop states no days; omitted
 * where the hops disagree. A place reachable by several second hops takes
 * the one with known days, then the shortest. Nodes sharing a ring and a
 * bearing are fanned apart.
 *
 * @param {Map<string, MapPlace>} places - Every place, by shortcode.
 * @param {string} centre - The place the map is from.
 * @returns {{centre: string, nodes: FromNode[], edges: FromEdge[],
 *   rings: Array<{days: number, radius: number}>, rim: number,
 *   unresolved: Array<{from: string, to: string}>}} The layout, in points.
 * @throws {Error} When `centre` is not a place.
 */
export function layoutFrom(places, centre) {
    if (!places.has(centre)) {
        throw new Error(`"${centre}" is not a place in this package or a fetched index`);
    }

    /** @type {FromNode[]} */
    const nodes = [
        {
            shortcode: centre,
            hop: 0,
            x: 0,
            y: 0,
            angle: 0,
            radius: 0,
            border: false,
            unknown: false,
        },
    ];
    /** @type {FromEdge[]} */
    const edges = [];
    /** @type {Map<string, FromNode>} */
    const byShortcode = new Map([[centre, nodes[0]]]);
    /** @type {Map<string, {bearing: string, days: number|undefined}>} */
    const firstHops = new Map();

    const { relations, unresolved } = relationsOf(places, centre);

    // Hop 1: one node and one edge per neighbour, the ring from its shortest
    // route, the edge carrying every mode that reaches it.
    /** @type {Map<string, FromEdge>} */
    const firstEdges = new Map();
    for (const relation of relations) {
        const days = relation.kind === "route" ? relation.days : undefined;
        let node = byShortcode.get(relation.to);
        if (!node) {
            node = {
                shortcode: relation.to,
                hop: 1,
                x: 0,
                y: 0,
                angle: /** @type {number} */ (bearingAngle(relation.bearing)),
                radius: days === undefined ? ringRadius(1) : ringRadius(days),
                days,
                border: relation.kind === "border",
                // A route whose days are off the scale sits on the rim, and
                // says so; a border sits on the innermost ring by rule.
                unknown: relation.kind === "route" && days === undefined,
            };
            nodes.push(node);
            byShortcode.set(relation.to, node);
            firstHops.set(relation.to, { bearing: relation.bearing, days });
            firstEdges.set(relation.to, {
                from: centre,
                to: relation.to,
                kind: relation.kind,
                bearing: relation.bearing,
                hop: 1,
                routes: [],
            });
            edges.push(/** @type {FromEdge} */ (firstEdges.get(relation.to)));
        }
        const edge = /** @type {FromEdge} */ (firstEdges.get(relation.to));
        if (relation.kind !== "route") continue;
        edge.routes.push({ mode: String(relation.mode ?? ""), days });
        // A route outranks a border for the node's ring and the edge's style,
        // and the shortest route sets both.
        if (
            edge.kind === "border" ||
            (days !== undefined && (edge.days === undefined || days < edge.days))
        ) {
            edge.kind = "route";
            edge.days = days;
            edge.mode = String(relation.mode ?? "");
            node.days = days;
            node.border = false;
            node.radius = ringRadius(days);
            node.unknown = days === undefined;
            firstHops.set(relation.to, { bearing: relation.bearing, days });
        }
    }

    // Hop 2: the best composed candidate per place beyond the neighbours.
    /** @type {Map<string, {node: FromNode, edge: FromEdge, marker: number|undefined}>} */
    const candidates = new Map();
    const better = (a, b) => {
        if (!b) return true;
        const aKnown = a.node.days !== undefined;
        const bKnown = b.node.days !== undefined;
        if (aKnown !== bKnown) return aKnown;
        if (aKnown && a.node.days !== b.node.days) return a.node.days < b.node.days;
        return String(a.node.via).localeCompare(String(b.node.via)) < 0;
    };
    for (const [via, first] of firstHops) {
        const onward = relationsOf(places, via);
        for (const relation of onward.relations) {
            if (byShortcode.has(relation.to)) continue;
            const second = { bearing: relation.bearing, days: relation.days };
            const composed = composeHops(first, second);
            if (!composed) continue;
            const marker = daysMarker(composed.days);
            const node = {
                shortcode: relation.to,
                hop: 2,
                x: 0,
                y: 0,
                angle: composed.angle,
                radius: ringRadius(marker),
                days: composed.days,
                border: relation.kind === "border" && first.days === undefined,
                unknown: composed.days === undefined,
                via,
            };
            const edge = {
                from: via,
                to: relation.to,
                kind: relation.kind,
                bearing: relation.bearing,
                hop: 2,
                routes:
                    relation.kind === "route" ?
                        [{ mode: String(relation.mode ?? ""), days: relation.days }]
                    :   [],
                ...(relation.kind === "route" ? { days: relation.days, mode: relation.mode } : {}),
            };
            const candidate = { node, edge, marker };
            if (better(candidate, candidates.get(relation.to))) {
                candidates.set(relation.to, candidate);
            }
        }
    }
    for (const { node, edge } of [...candidates.values()].sort((a, b) =>
        a.node.shortcode.localeCompare(b.node.shortcode),
    )) {
        nodes.push(node);
        edges.push(edge);
    }

    fanApart(nodes, places);
    for (const node of nodes) {
        if (node.hop === 0) continue;
        const rad = (node.angle * Math.PI) / 180;
        node.x = exact(node.radius * Math.cos(rad));
        node.y = exact(node.radius * Math.sin(rad));
    }

    return { centre, nodes, edges, rings: rings(), rim: rimRadius(), unresolved };
}

/**
 * A coordinate with the floating-point dust of a right angle swept off, so a
 * place due north sits at `x = 0` rather than at `1e-14`.
 *
 * @param {number} value - Points.
 * @returns {number} The value, or `0` where it is within a millionth of it.
 */
function exact(value) {
    return Math.abs(value) < 1e-6 ? 0 : value;
}

/* --------------------------------------------------------------------- */
/*  The whole route graph                                                 */
/* --------------------------------------------------------------------- */

/**
 * One edge of the whole route graph.
 *
 * @typedef {object} TravelEdge
 * @property {string} from
 * @property {string} to
 * @property {"border"|"route"} kind
 * @property {string} bearing - Where `to` lies from `from`.
 * @property {number} [days]
 * @property {string} [mode]
 * @property {number} len - The length asked of `neato`, in inches.
 */

/**
 * The whole route graph: one edge per pair of places, however many ends and
 * modes state it, with a length from its days.
 *
 * A pair reached by several modes takes the shortest; a pair that both
 * borders and travels takes the route, since the days are what the length
 * is from. The end that states the relation is `from`, so a one-sided entry
 * is drawn from the note that carries it.
 *
 * @param {Map<string, MapPlace>} places - Every place, by shortcode.
 * @returns {{edges: TravelEdge[], unresolved: Array<{from: string, to: string}>}}
 *   The edges, in a stable order.
 */
export function travelGraph(places) {
    /** @type {Map<string, TravelEdge>} */
    const edges = new Map();
    /** @type {Array<{from: string, to: string}>} */
    const unresolved = [];
    const pairKey = (a, b) => [a, b].sort().join("|");

    for (const shortcode of [...places.keys()].sort()) {
        const place = places.get(shortcode);
        const consider = (list, kind) => {
            for (const entry of Array.isArray(list) ? list : []) {
                const to = targetOf(entry);
                const bearing = String(entry?.bearing ?? "");
                if (!to || !BEARINGS.includes(bearing)) continue;
                if (!places.has(to)) {
                    unresolved.push({ from: shortcode, to });
                    continue;
                }
                const days = kind === "route" ? daysOf(entry.days) : undefined;
                const edge = {
                    from: shortcode,
                    to,
                    kind,
                    bearing,
                    len: edgeLength(days),
                    ...(kind === "route" ? { days, mode: String(entry.mode ?? "") } : {}),
                };
                const key = pairKey(shortcode, to);
                const existing = edges.get(key);
                if (!existing) {
                    edges.set(key, edge);
                    continue;
                }
                // A route outranks a border, and a shorter route a longer.
                if (existing.kind === "border" && kind === "route") edges.set(key, edge);
                else if (
                    existing.kind === "route" &&
                    kind === "route" &&
                    days !== undefined &&
                    (existing.days === undefined || days < existing.days)
                ) {
                    edges.set(key, edge);
                }
            }
        };
        consider(place?.borders, "border");
        consider(place?.routes, "route");
    }

    return { edges: [...edges.values()], unresolved };
}
