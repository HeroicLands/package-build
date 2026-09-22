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
 * What lies within a place, who holds it, and what an affiliation holds.
 *
 * Two keys the notes already carry answer all three. A place's `data.parents`
 * is geography — the places it sits within — and an affiliation's
 * `data.domains` is tenure — the places it holds. Read across the whole
 * corpus and inverted, they give each page the lists a reader wants:
 * `contains` and `held_by` on a place, `holdings` on an affiliation, each
 * shaped like an entry of `related` and absent where empty.
 *
 * **`domains` names what an affiliation holds directly**, and is never
 * expanded. A polity whose `domains` names a region holds the region; the
 * settlements within it are reachable from the region's `contains`, and
 * repeating them in `holdings` would make every list say the same thing at
 * every level. Tenure below a lord runs through `affiliation.parents` — a
 * house of its earl, an earl of the crown — and geography through
 * `place.parents`, so a subinfeudated manor sits in one region by the first
 * and under a lord of another polity by the second, and both pages say so.
 *
 * **A dependency's places and affiliations take part.** A fetched index entry
 * carries the `parents` and `domains` its record stated, so a place another
 * package publishes is listed within a local region, and a house another
 * package publishes is named on the local manor it holds.
 *
 * **A place's tenure is checked.** A settlement, a site or a structure that no
 * affiliation's `domains` names is land nobody holds — a gap in tenure the
 * lint reports as a warning at the note's `type:` line. A region is held
 * through its polity's `domains` and a feature by nobody, so both are exempt.
 *
 * @module
 */

import { positionInFrontmatter } from "./diagnostics.mjs";

/**
 * The keys this module writes, and which a note cannot author: `contains`
 * and `held_by` on a place, `holdings` on an affiliation.
 *
 * @type {readonly string[]}
 */
export const HOLDINGS_KEYS = Object.freeze(["contains", "held_by", "holdings"]);

/**
 * The place subTypes tenure is checked on. A region is held through its
 * polity's `domains`, a world by nobody, a feature by nobody — a river has no
 * lord — so the rest are the kinds of place a body holds directly.
 *
 * @type {readonly string[]}
 */
export const HELD_SUBTYPES = Object.freeze(["settlement", "site", "structure"]);

/**
 * One entry of a holdings list — a page a reader is pointed at.
 *
 * @typedef {object} HoldingsEntry
 * @property {string} title   The page's published title.
 * @property {string} [url]   `<base><slug>/` — the page's address as every
 *                            href this build renders composes it. **Absent
 *                            for a stub**, which has no page: an entry with no
 *                            `url` renders as plain text.
 * @property {string} type    The note's `type` — `place` or `affiliation`.
 * @property {string} [subType] The note's `subType`, where it declares one.
 */

/**
 * One place or affiliation, as the derivation reads it — a local page or a
 * fetched index entry through one shape.
 *
 * @typedef {object} HoldingsNode
 * @property {string} shortcode Lower case.
 * @property {"place"|"affiliation"} type
 * @property {string} [subType]
 * @property {string} title     The page's published title.
 * @property {string} [url]     The page's URL; absent where the package
 *                              publishes no page for it.
 * @property {string[]} parents What a place sits within, as written.
 * @property {string[]} domains What an affiliation holds, as written.
 */

/**
 * The lists one page carries. Every key is optional, and a key present holds
 * at least one entry.
 *
 * @typedef {object} Holdings
 * @property {HoldingsEntry[]} [contains] Places whose `parents` name this one.
 * @property {HoldingsEntry[]} [held_by]  Affiliations whose `domains` name this one.
 * @property {HoldingsEntry[]} [holdings] Places this affiliation's `domains` name.
 */

/**
 * The shortcode a `parents` or `domains` entry names, lower case.
 *
 * An entry is written as a bare shortcode, as an address, or as a wikilink
 * carrying either; the shortcode is the last segment of the address in every
 * case, because a segment carries no separator.
 *
 * @param {unknown} value - One entry.
 * @returns {string} Its shortcode, or `""` for an entry that names nothing.
 */
function namedShortcode(value) {
    const text = String(value ?? "")
        .trim()
        .replace(/^\[\[/, "")
        .replace(/\]\]$/, "")
        .split("|")[0]
        .split("#")[0]
        .trim();
    return text.split("-").pop()?.toLowerCase() ?? "";
}

/**
 * A `parents` or `domains` value as the shortcodes it names, in order,
 * empties dropped and repeats collapsed.
 *
 * @param {unknown} value - The authored value — a list, or a lone entry.
 * @returns {string[]} The shortcodes.
 */
export function shortcodesOf(value) {
    const list =
        Array.isArray(value) ? value
        : value ? [value]
        : [];
    return [...new Set(list.map(namedShortcode).filter(Boolean))];
}

/**
 * A stable order for `contains` and `holdings`: by subType, then title. An
 * entry with no subType sorts first.
 *
 * @param {HoldingsEntry} a
 * @param {HoldingsEntry} b
 * @returns {number}
 */
function bySubTypeThenTitle(a, b) {
    return (
        (a.subType ?? "").localeCompare(b.subType ?? "", "en") ||
        a.title.localeCompare(b.title, "en")
    );
}

/**
 * A stable order for `held_by`: by title.
 *
 * @param {HoldingsEntry} a
 * @param {HoldingsEntry} b
 * @returns {number}
 */
function byTitle(a, b) {
    return a.title.localeCompare(b.title, "en");
}

/**
 * The entry a node is listed as.
 *
 * **`url` is absent for a node that publishes no page**, and the entry is
 * emitted all the same. A stub is a place somebody has not written yet: it
 * carries its facts, and Weyshott belongs in Aelwyth's `contains` whether or
 * not anyone has written Weyshott's page. What it cannot have is a link, so
 * the renderer prints the title as plain text — the same rule a table cell
 * follows when its `_ref` is null, in a different renderer.
 *
 * @param {HoldingsNode} node - The node.
 * @returns {HoldingsEntry} Its entry.
 */
function entryOf(node) {
    return {
        title: node.title,
        ...(listed(node) ? { url: node.url } : {}),
        type: node.type,
        ...(node.subType === undefined ? {} : { subType: node.subType }),
    };
}

/**
 * Whether a node publishes a page.
 *
 * **A URL gates where a list is written, never whether a node may appear in
 * someone else's list.** You cannot write a `contains` block on a page that
 * does not exist, so this guards {@link holdingsPages}'s `on(url)` calls — and
 * nothing else. Guarding the membership too is how a stub vanishes from every
 * containment and tenure list in the corpus, silently, which is the one failure
 * mode a diff cannot show.
 *
 * @param {HoldingsNode} node - The node.
 * @returns {boolean} Whether it has a page to write a list on.
 */
function listed(node) {
    return node.url !== undefined && node.url !== null && node.url !== "";
}

/**
 * Read a local note into a node, or `null` for a note that takes no part.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {object} page - The page it publishes as.
 * @param {string} page.title - Its published title.
 * @param {string} page.url - Its URL.
 * @returns {HoldingsNode|null} The node, or `null` for a note that is neither
 *   a place nor an affiliation, or that declares no shortcode.
 */
export function holdingsNode(fm, { title, url }) {
    const type = String(fm?.type ?? "");
    if (type !== "place" && type !== "affiliation") return null;
    const shortcode = String(fm?.shortcode ?? "").toLowerCase();
    if (!shortcode) return null;
    const data = fm.data && typeof fm.data === "object" && !Array.isArray(fm.data) ? fm.data : {};
    return {
        shortcode,
        type,
        subType: fm.subType == null ? undefined : String(fm.subType),
        title,
        url,
        parents: type === "place" ? shortcodesOf(data.parents) : [],
        domains: type === "affiliation" ? shortcodesOf(data.domains) : [],
    };
}

/**
 * Read a fetched index's places and affiliations as nodes.
 *
 * An entry carries what the producer's record stated — its name, `subType`,
 * `parents` and `domains` — and its page URL where the package publishes one.
 *
 * @param {Map<string, object>|undefined} foreignIndex - As
 *   {@link module:engine/metadata-index.loadForeignIndexes} returns it.
 * @returns {HoldingsNode[]} The nodes, in index order.
 */
export function foreignHoldingsNodes(foreignIndex) {
    const out = [];
    if (!foreignIndex) return out;
    for (const [canonical, entry] of foreignIndex) {
        const type = String(entry?.type ?? "");
        if (type !== "place" && type !== "affiliation") continue;
        const shortcode = canonical.split("-").pop()?.toLowerCase() ?? "";
        if (!shortcode) continue;
        out.push({
            shortcode,
            type,
            subType: entry.subType == null ? undefined : String(entry.subType),
            title: String(entry.name ?? shortcode),
            url: entry.url,
            parents: type === "place" ? shortcodesOf(entry.parents) : [],
            domains: type === "affiliation" ? shortcodesOf(entry.domains) : [],
        });
    }
    return out;
}

/**
 * Invert `parents` and `domains` into each page's lists.
 *
 * A shortcode is declared once per type: the first node declaring it wins,
 * so local nodes handed in ahead of fetched ones shadow a dependency's, the
 * way the link resolver answers. A node with no URL carries no lists of its
 * own, since there is no page to write them on — and is still an entry on
 * everybody else's, rendered as plain text. A name no node declares is
 * dropped: a `parents` naming nowhere is the map's finding, a `domains`
 * naming nowhere the reference check's.
 *
 * The result holds only pages with at least one entry on at least one list,
 * and a page's block carries only the keys it has entries for — the theme's
 * silent-disappear convention, kept at the source.
 *
 * @param {Iterable<HoldingsNode|null>} nodes - Every place and affiliation,
 *   local first. `parents` and `domains` are read as written, so a node
 *   built by hand may carry them as the note spells them.
 * @returns {Map<string, Holdings>} URL → the page's lists, sorted.
 */
export function holdingsPages(nodes) {
    /** @type {Map<string, HoldingsNode>} */
    const places = new Map();
    /** @type {Map<string, HoldingsNode>} */
    const affiliations = new Map();
    for (const node of nodes) {
        if (!node) continue;
        const by = node.type === "place" ? places : affiliations;
        const shortcode = String(node.shortcode ?? "").toLowerCase();
        if (!shortcode || by.has(shortcode)) continue;
        // Read through the one reader, so a caller handing in what a note
        // wrote — an address, a wikilink, a repeat — is read as `holdingsNode`
        // reads it.
        by.set(shortcode, {
            ...node,
            shortcode,
            parents: shortcodesOf(node.parents),
            domains: shortcodesOf(node.domains),
        });
    }

    /** @type {Map<string, {contains: HoldingsEntry[], held_by: HoldingsEntry[], holdings: HoldingsEntry[]}>} */
    const lists = new Map();
    const on = (url) => {
        let found = lists.get(url);
        if (!found) {
            found = { contains: [], held_by: [], holdings: [] };
            lists.set(url, found);
        }
        return found;
    };
    // Every gate below is on the page a list is *written* on, never on the
    // node the list names — see {@link listed}.
    for (const child of places.values()) {
        for (const shortcode of child.parents) {
            const parent = places.get(shortcode);
            if (!parent || !listed(parent) || parent === child) continue;
            on(parent.url).contains.push(entryOf(child));
        }
    }

    for (const holder of affiliations.values()) {
        for (const shortcode of holder.domains) {
            const held = places.get(shortcode);
            if (!held) continue;
            if (listed(holder)) on(holder.url).holdings.push(entryOf(held));
            if (listed(held)) on(held.url).held_by.push(entryOf(holder));
        }
    }

    const out = new Map();
    for (const [url, { contains, held_by, holdings }] of lists) {
        /** @type {Holdings} */
        const block = {};
        if (contains.length) block.contains = contains.sort(bySubTypeThenTitle);
        if (held_by.length) block.held_by = held_by.sort(byTitle);
        if (holdings.length) block.holdings = holdings.sort(bySubTypeThenTitle);
        if (Object.keys(block).length) out.set(url, block);
    }
    return out;
}

/* --------------------------------------------------------------------- */
/*  The lint                                                              */
/* --------------------------------------------------------------------- */

/**
 * Every shortcode some affiliation's `domains` names, computed once per link
 * index. The lint asks the question once per place note, and the answer is a
 * fact about the whole corpus — local notes and every fetched entry — so it
 * is read off the index the first time and kept beside it.
 *
 * @type {WeakMap<object, Set<string>>}
 */
const HELD = new WeakMap();

/**
 * The shortcodes every affiliation's `domains` names, across the link index.
 *
 * @param {object} index - The link index.
 * @returns {Set<string>} The held shortcodes, lower case.
 */
function heldShortcodes(index) {
    let held = HELD.get(index);
    if (held) return held;
    held = new Set();
    for (const note of index.notes ?? []) {
        if (String(note.type ?? note.fm?.type ?? "") !== "affiliation") continue;
        const data = note.fm?.data;
        const domains = data && typeof data === "object" ? data.domains : undefined;
        for (const shortcode of shortcodesOf(domains)) held.add(shortcode);
    }
    for (const entry of index.foreign?.index?.values?.() ?? []) {
        if (String(entry?.type ?? "") !== "affiliation") continue;
        for (const shortcode of shortcodesOf(entry.domains)) held.add(shortcode);
    }
    HELD.set(index, held);
    return held;
}

/**
 * Check a place note's tenure: a settlement, a site or a structure that no
 * affiliation's `domains` names is unheld land, reported as a warning at the
 * note's `type:` line.
 *
 * Declared on the `place` vocabulary as its type-level check, so the lint
 * runs it beside the field checks with the same index. Without an index the
 * question cannot be asked and nothing is reported.
 *
 * @param {object} note - The note, as the link index hands it over.
 * @param {object} [opts]
 * @param {object} [opts.index] - The link index, holding every affiliation.
 * @returns {object[]} Findings.
 */
export function checkHeld(note, { index } = {}) {
    if (!index) return [];
    const fm = note.fm ?? {};
    if (String(fm.type ?? "") !== "place") return [];
    const subType = String(fm.subType ?? "");
    if (!HELD_SUBTYPES.includes(subType)) return [];
    const shortcode = String(fm.shortcode ?? "").toLowerCase();
    if (!shortcode) return [];
    if (heldShortcodes(index).has(shortcode)) return [];
    return [
        {
            file: note.file,
            ...positionInFrontmatter(note.raw ?? "", "type", undefined, { topLevel: true }),
            severity: "warning",
            message:
                `unheld land: no affiliation's \`domains\` names "${shortcode}", so nothing ` +
                `says who holds this ${subType}; name it in the \`domains\` of the house, ` +
                `order or polity that does`,
        },
    ];
}
