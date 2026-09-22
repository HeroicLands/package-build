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
 * Whether a world's population figures agree from the region down.
 *
 * A place states `data.population` and an affiliation states how many people
 * it counts. Read across the whole corpus those figures make claims about each
 * other, and four of those claims can be checked: the bodies holding a region
 * fit inside it, the regions inside it fit inside it, a settlement fits inside
 * every place that contains it, and a page citing a figure states the figure
 * that note states.
 *
 * This is {@link module:engine/holdings}'s sibling and reads the same two
 * keys — a place's `data.parents` for geography, an affiliation's
 * `data.domains` for tenure. Where that module asks whether anybody holds a
 * place, this one asks whether the numbers add up.
 *
 * **Every finding is a warning.** A figure out of step with its neighbours is
 * a thing an author wants to see while the note is open, and the same gap can
 * be deliberate for a while: a region whose settlements are half written will
 * disagree with itself until the rest are. Nothing here fails a build.
 *
 * **Figures are authored to two significant digits**, so a parent rounded
 * below the true sum of its children is not a finding.
 * {@link POPULATION_TOLERANCE} is the widest half-unit error such a figure can
 * carry.
 *
 * **A stated figure is compared; an absent one is not.** A place or an
 * affiliation with no `population` contributes nothing to a sum and is never
 * the subject of a finding, so a half-written corpus is quiet rather than
 * noisy. A dependency's places and affiliations take part in the *structure* —
 * a fetched entry carries the `parents` and `domains` its record stated — and
 * a fetched index carries no figure, so a dependency's people are counted
 * nowhere.
 *
 * **There is deliberately no urban-share rule.** A share computed from the
 * named settlements against a region's total measures nothing: the settlement
 * layer names the notable places and is complete nowhere, so the ratio says
 * how much of a region has been written rather than how much of it is urban.
 * As a gate it moved figures rather than finding faults.
 *
 * @module
 */

import { positionOfFrontmatterPath, positionOfLiteral } from "./diagnostics.mjs";
import { shortcodesOf } from "./holdings.mjs";

/**
 * How far a parent's figure may fall below the sum of what it contains before
 * that is a finding.
 *
 * A figure written to two significant digits carries a half-unit of error in
 * the second digit, and that error is widest at the bottom of a decade — half
 * a unit on `1.0` is five per cent, against half a unit on `9.9` at a twentieth
 * of that. The widest case is the one a tolerance has to admit, so the whole
 * scale is held to five per cent.
 *
 * @type {number}
 */
export const POPULATION_TOLERANCE = 1.05;

/**
 * The rules this module enforces, each `name` the prefix its findings carry.
 *
 * The list is the module's own statement of what it checks: a reader learns
 * the whole surface from it, and the suite derives a case per entry from it, so
 * a rule cannot be added without evidence that it fires.
 *
 * @type {ReadonlyArray<{name: string, describe: string}>}
 */
export const POPULATION_RULES = Object.freeze([
    Object.freeze({
        name: "over-held land",
        describe:
            "The polities whose `domains` name a place count more people than the place " +
            "states. A polity subordinate to another holding the same place is already " +
            "counted in that polity's figure, and a settlement is exempt, its holder's " +
            "figure counting a hinterland the settlement does not.",
    }),
    Object.freeze({
        name: "over-full region",
        describe:
            "The regions whose `parents` name a place count more people than the place " +
            "states. A region naming both its parent and its grandparent counts under the " +
            "nearer of the two.",
    }),
    Object.freeze({
        name: "oversized settlement",
        describe:
            "A settlement counts more people than a place containing it states — its own " +
            "region, or any place above that.",
    }),
    Object.freeze({
        name: "disputed figure",
        describe:
            "A `doc` note carries a population beside a wikilink to the place or " +
            "affiliation it belongs to, and the two disagree. A figure is read as a " +
            "population only where it carries the `~` approximation marker.",
    }),
]);

/**
 * The corpus one link index describes, derived once and kept beside it.
 *
 * Every rule asks a question about the whole tree, and the answer does not
 * change between notes, so the walk happens on the first note linted and the
 * rest read it.
 *
 * @type {WeakMap<object, Corpus>}
 */
const CORPUS = new WeakMap();

/**
 * One place or affiliation as the rules read it.
 *
 * @typedef {object} PopulationNode
 * @property {string} shortcode Lower case.
 * @property {"place"|"affiliation"} type
 * @property {string} subType
 * @property {string} title       What a finding calls it.
 * @property {number} [population] The stated figure, absent where unstated.
 * @property {string[]} parents   A place's enclosing places, an affiliation's
 *                                superiors.
 * @property {string[]} domains   What an affiliation holds.
 */

/**
 * The whole tree, indexed the three ways the rules read it.
 *
 * @typedef {object} Corpus
 * @property {Map<string, PopulationNode>} places       By shortcode.
 * @property {Map<string, PopulationNode>} affiliations By shortcode.
 * @property {Map<string, string[]>} childrenOf   Place shortcode → the places
 *                                                whose `parents` name it.
 * @property {Map<string, string[]>} holdersOf    Place shortcode → the polities
 *                                                whose `domains` name it.
 * @property {Map<string, PopulationNode>} byAddress `type-shortcode` → the node,
 *                                                for the citation rule.
 */

/**
 * A `data.population` value as a number, or `undefined`.
 *
 * A figure is a positive count. Anything else — a blank, a string of prose, a
 * zero — states nothing this module can compare, and is read as unstated
 * rather than as a figure of zero, which would make every sum a finding.
 *
 * @param {unknown} value - The authored value.
 * @returns {number|undefined} The figure, or `undefined`.
 */
function figureOf(value) {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * A node's `data` block, or an empty one.
 *
 * @param {object|undefined} fm - The frontmatter.
 * @returns {object} The block.
 */
function dataOf(fm) {
    const data = fm?.data;
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

/**
 * A count as a finding spells it.
 *
 * @param {number} n - The figure.
 * @returns {string} Grouped in threes.
 */
function counted(n) {
    return n.toLocaleString("en-US");
}

/**
 * Read one local note into a node, or `null` where it takes no part.
 *
 * @param {object} note - A note from the link index.
 * @returns {PopulationNode|null} The node.
 */
function localNode(note) {
    const fm = note.fm ?? {};
    const type = String(fm.type ?? note.type ?? "");
    if (type !== "place" && type !== "affiliation") return null;
    const shortcode = String(fm.shortcode ?? "").toLowerCase();
    if (!shortcode) return null;
    const data = dataOf(fm);
    return {
        shortcode,
        type,
        subType: String(fm.subType ?? ""),
        title: String(fm.name?.full ?? shortcode),
        population: figureOf(data.population),
        parents: shortcodesOf(data.parents),
        domains: type === "affiliation" ? shortcodesOf(data.domains) : [],
    };
}

/**
 * Read a fetched index entry into a node, or `null` where it takes no part.
 *
 * A fetched entry carries the structure its record stated and no figure, so
 * a dependency's place sits in the geography and counts nobody.
 *
 * @param {string} canonical - The entry's address.
 * @param {object} entry - The entry.
 * @returns {PopulationNode|null} The node.
 */
function foreignNode(canonical, entry) {
    const type = String(entry?.type ?? "");
    if (type !== "place" && type !== "affiliation") return null;
    const shortcode = canonical.split("-").pop()?.toLowerCase() ?? "";
    if (!shortcode) return null;
    return {
        shortcode,
        type,
        subType: String(entry.subType ?? ""),
        title: String(entry.name ?? shortcode),
        parents: shortcodesOf(entry.parents),
        domains: type === "affiliation" ? shortcodesOf(entry.domains) : [],
    };
}

/**
 * The corpus a link index describes.
 *
 * A shortcode is declared once per type and the first declaration wins, so a
 * local note shadows a dependency's the way the link resolver answers.
 *
 * @param {object} index - The link index.
 * @returns {Corpus} The corpus.
 */
function corpusOf(index) {
    let found = CORPUS.get(index);
    if (found) return found;

    /** @type {Map<string, PopulationNode>} */
    const places = new Map();
    /** @type {Map<string, PopulationNode>} */
    const affiliations = new Map();
    /** @type {Map<string, PopulationNode>} */
    const byAddress = new Map();

    const take = (node) => {
        if (!node) return;
        const by = node.type === "place" ? places : affiliations;
        if (by.has(node.shortcode)) return;
        by.set(node.shortcode, node);
        const address = `${node.type}-${node.shortcode}`;
        if (!byAddress.has(address)) byAddress.set(address, node);
    };

    for (const note of index.notes ?? []) take(localNode(note));
    for (const [canonical, entry] of index.foreign?.index ?? [])
        take(foreignNode(canonical, entry));

    /** @type {Map<string, string[]>} */
    const childrenOf = new Map();
    for (const node of places.values()) {
        for (const parent of node.parents) {
            const list = childrenOf.get(parent);
            if (list) list.push(node.shortcode);
            else childrenOf.set(parent, [node.shortcode]);
        }
    }

    /** @type {Map<string, string[]>} */
    const holdersOf = new Map();
    for (const node of affiliations.values()) {
        if (node.subType !== "polity") continue;
        for (const domain of node.domains) {
            const list = holdersOf.get(domain);
            if (list) list.push(node.shortcode);
            else holdersOf.set(domain, [node.shortcode]);
        }
    }

    found = { places, affiliations, childrenOf, holdersOf, byAddress };
    CORPUS.set(index, found);
    return found;
}

/**
 * Every place below one, by `parents`.
 *
 * @param {Corpus} corpus - The corpus.
 * @param {string} shortcode - Where to start.
 * @returns {Set<string>} The descendants, the starting place excluded.
 */
function descendants(corpus, shortcode) {
    const seen = new Set();
    const queue = [...(corpus.childrenOf.get(shortcode) ?? [])];
    while (queue.length) {
        const next = queue.pop();
        if (!next || seen.has(next)) continue;
        seen.add(next);
        queue.push(...(corpus.childrenOf.get(next) ?? []));
    }
    return seen;
}

/**
 * Every place above one, by `parents`.
 *
 * @param {Corpus} corpus - The corpus.
 * @param {string} shortcode - Where to start.
 * @returns {string[]} The ancestors, nearest first, the starting place
 *   excluded and a cycle broken.
 */
function ancestors(corpus, shortcode) {
    const seen = new Set();
    const out = [];
    const queue = [...(corpus.places.get(shortcode)?.parents ?? [])];
    while (queue.length) {
        const next = queue.shift();
        if (!next || next === shortcode || seen.has(next)) continue;
        const node = corpus.places.get(next);
        if (!node) continue;
        seen.add(next);
        out.push(next);
        queue.push(...node.parents);
    }
    return out;
}

/**
 * The polities holding a place, each counted once.
 *
 * A polity subordinate to another polity that holds the same place is already
 * inside that polity's figure, so only the topmost of a chain counts.
 *
 * @param {Corpus} corpus - The corpus.
 * @param {string} shortcode - The place.
 * @returns {PopulationNode[]} The holders.
 */
function topHolders(corpus, shortcode) {
    const holders = corpus.holdersOf.get(shortcode) ?? [];
    const held = new Set(holders);
    return holders
        .map((name) => corpus.affiliations.get(name))
        .filter(
            /** @returns {node is PopulationNode} */
            (node) => Boolean(node) && !(node?.parents ?? []).some((p) => held.has(p)),
        );
}

/**
 * The regions immediately inside a place.
 *
 * A place may name both its region and that region's continent as parents.
 * It is counted under the nearer, so a region naming a second parent that is
 * itself inside this place is left to that parent.
 *
 * @param {Corpus} corpus - The corpus.
 * @param {string} shortcode - The enclosing place.
 * @returns {PopulationNode[]} The regions.
 */
function nearestRegions(corpus, shortcode) {
    const inside = descendants(corpus, shortcode);
    const out = [];
    for (const child of corpus.childrenOf.get(shortcode) ?? []) {
        const node = corpus.places.get(child);
        if (!node || node.subType !== "region") continue;
        if (node.parents.some((p) => p !== shortcode && inside.has(p))) continue;
        out.push(node);
    }
    return out;
}

/**
 * A finding on the note's own `data.population`.
 *
 * @param {object} note - The note.
 * @param {string} rule - The rule's name.
 * @param {string} message - What it found, after the name.
 * @returns {object} The finding.
 */
function atFigure(note, rule, message) {
    return {
        file: note.file,
        ...positionOfFrontmatterPath(note.raw ?? "", ["data", "population"]),
        severity: "warning",
        message: `${rule}: ${message}`,
    };
}

/**
 * Check a place's population against the corpus around it.
 *
 * Declared on the `place` vocabulary beside `data.population`, so the lint
 * runs it with the index every reference check resolves through. Without an
 * index the questions cannot be asked and nothing is reported.
 *
 * Three rules, each reported on the note being linted: `over-held land` and
 * `over-full region` on the place whose figure is exceeded, and
 * `oversized settlement` on the settlement that exceeds one.
 *
 * @param {object} note - The note, as the link index hands it over.
 * @param {object} [opts]
 * @param {object} [opts.index] - The link index, holding the whole corpus.
 * @returns {object[]} Findings.
 */
export function checkPopulation(note, { index } = {}) {
    if (!index) return [];
    const fm = note.fm ?? {};
    if (String(fm.type ?? "") !== "place") return [];
    const shortcode = String(fm.shortcode ?? "").toLowerCase();
    if (!shortcode) return [];
    const stated = figureOf(dataOf(fm).population);
    if (stated === undefined) return [];

    const corpus = corpusOf(index);
    const self = corpus.places.get(shortcode);
    const title = self?.title ?? shortcode;
    const subType = self?.subType ?? String(fm.subType ?? "");
    const allowed = stated * POPULATION_TOLERANCE;
    const findings = [];

    // A settlement is exempt: the polity holding a city-state counts the
    // hinterland the city does not, so its figure is properly the larger.
    if (subType !== "settlement") {
        const holders = topHolders(corpus, shortcode);
        const sum = holders.reduce((total, node) => total + (node.population ?? 0), 0);
        if (sum > allowed) {
            findings.push(
                atFigure(
                    note,
                    "over-held land",
                    `the polities holding ${title} count ${counted(sum)} people against its ` +
                        `stated ${counted(stated)}`,
                ),
            );
        }
    }

    const regions = nearestRegions(corpus, shortcode);
    const inside = regions.reduce((total, node) => total + (node.population ?? 0), 0);
    if (inside > allowed) {
        findings.push(
            atFigure(
                note,
                "over-full region",
                `the regions inside ${title} count ${counted(inside)} people against its ` +
                    `stated ${counted(stated)}`,
            ),
        );
    }

    if (subType === "settlement") {
        for (const name of ancestors(corpus, shortcode)) {
            const above = corpus.places.get(name);
            const room = above?.population;
            if (room === undefined || stated <= room * POPULATION_TOLERANCE) continue;
            findings.push(
                atFigure(
                    note,
                    "oversized settlement",
                    `${title} holds ${counted(stated)}, more than the ${counted(room)} ` +
                        `stated by ${above?.title}`,
                ),
            );
        }
    }

    return findings;
}

/**
 * A wikilink to a place or an affiliation followed by an approximate figure.
 *
 * The figure must carry `~`, which is how a note marks a number as an
 * estimate. That is what separates a population from every other number a
 * table puts beside a place — a distance, a stage count, a tally of days — and
 * without it a routes table would be read as a census.
 *
 * The span between the link and the figure crosses neither a newline nor
 * another wikilink, so a row's figure belongs to that row's link.
 *
 * **The figure is read whole or not at all.** A number carrying a magnitude
 * letter, a decimal, a percent sign or a dash into a second number is prose
 * about a figure rather than the figure — `~1M`, `~1.5M`, `~5%`, `~12–14M` —
 * and reading its leading digits would compare `1` against a million. Those
 * are left alone, so an aside stays an aside and the rule holds the tables
 * that state a count exactly.
 *
 * @type {RegExp}
 */
const CITED =
    /\[\[((?:place|affiliation)-[a-z0-9.]+)(?:\\?\|[^\]]*)?\]\]([^[\n]{0,80}?)~([0-9](?:[0-9,]*[0-9])?)(?![\w%]|[.,]\d|[-–—])/g;

/**
 * Check the populations a `doc` note cites against the notes they belong to.
 *
 * A reference page restates figures the place and affiliation notes own, and
 * restated figures drift. Each is located at the figure it wrote, counting
 * repeats so two rows carrying one number land on their own lines.
 *
 * A citation naming a note this package does not hold is skipped: a fetched
 * index carries no figure, so there is nothing to disagree with.
 *
 * Declared as the `doc` vocabulary's type-level check.
 *
 * @param {object} note - The note, as the link index hands it over.
 * @param {object} [opts]
 * @param {object} [opts.index] - The link index, holding the whole corpus.
 * @returns {object[]} Findings.
 */
export function checkCitedPopulations(note, { index } = {}) {
    if (!index) return [];
    if (String(note.fm?.type ?? "") !== "doc") return [];
    const raw = String(note.raw ?? "");
    const body = String(note.body ?? "");
    if (!body) return [];

    const corpus = corpusOf(index);
    const offset = raw.length - body.length;
    const findings = [];

    CITED.lastIndex = 0;
    for (const match of body.matchAll(CITED)) {
        const [, address, , figure] = match;
        const target = corpus.byAddress.get(address.toLowerCase());
        if (!target || target.population === undefined) continue;
        const claimed = Number(figure.replace(/,/g, ""));
        if (!Number.isFinite(claimed) || claimed === target.population) continue;

        // Which `~figure` in the file this is, so a number written twice is
        // located twice rather than both findings landing on the first.
        const needle = `~${figure}`;
        const at = offset + (match.index ?? 0) + match[0].length - needle.length;
        const occurrence = raw.slice(0, at).split(needle).length;

        findings.push({
            file: note.file,
            ...positionOfLiteral(raw, needle, occurrence),
            severity: "warning",
            message:
                `disputed figure: ${target.title} is carried at ${counted(claimed)} here and ` +
                `${counted(target.population)} on its own note`,
        });
    }

    return findings;
}
