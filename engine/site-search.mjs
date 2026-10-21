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
 * **What a note's page tells the site's search.** Pagefind reads the filters a
 * page carries, so a reader can narrow a search to a package, a kind of note
 * or a part of the world:
 *
 * | Filter | Value |
 * | ------ | ----- |
 * | `package` | the package that publishes the note |
 * | `type` | the note's `type` |
 * | `subtype` | the note's `subType` |
 * | `culture` | the name of the culture `data.culture` names |
 * | `continent` | the continent the note lies in |
 * | `region` | the outermost region beneath that continent |
 *
 * A place lies where its `parents` lead; a being where its `homes` are; a
 * scenario where its `locations` are. A continent is a region whose parent is
 * the world. A note reached by more than one path carries every continent and
 * region it reaches, so a being with homes in two regions is found under both.
 *
 * The note's name and its aliases are weighted, so a search for a name finds
 * its note first. A note's tags and its draft state are not filters.
 *
 * @module
 */

import { placeShortcodes } from "./map-places.mjs";
import { resolveInfoboxRef } from "./site-index.mjs";

/** The filters a note's page carries, in the order a reader is offered them. */
export const SEARCH_FILTERS = Object.freeze([
    "package",
    "type",
    "subtype",
    "culture",
    "continent",
    "region",
]);

/**
 * @param {unknown} value - Anything.
 * @returns {boolean} Whether it is a mapping a field may be read out of.
 */
const isMapping = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The continents and regions every place lies in.
 *
 * @param {Map<string, {shortcode: string, name: string, subType?: string, parents: string[]}>} places -
 *   Every place, by shortcode, as {@link module:engine/map-places.mapWorld} reads them.
 * @returns {(shortcodes: Iterable<string>) => {continents: string[], regions: string[]}}
 *   The names of the continents and the outermost regions the given places lie
 *   in, each sorted.
 */
export function placeGeography(places) {
    const worlds = new Set(
        [...places.values()].filter((p) => p.subType === "world").map((p) => p.shortcode),
    );
    const isContinent = (place) =>
        place?.subType === "region" && place.parents.some((parent) => worlds.has(parent));
    /** @type {Map<string, {continents: Set<string>, regions: Set<string>}>} */
    const known = new Map();

    const reach = (shortcode, visiting) => {
        if (known.has(shortcode)) return known.get(shortcode);
        const found = { continents: new Set(), regions: new Set() };
        const place = places.get(shortcode);
        if (!place || visiting.has(shortcode) || worlds.has(shortcode)) return found;
        visiting.add(shortcode);
        if (isContinent(place)) found.continents.add(shortcode);
        for (const parent of place.parents) {
            if (place.subType === "region" && isContinent(places.get(parent)))
                found.regions.add(shortcode);
            const above = reach(parent, visiting);
            for (const c of above.continents) found.continents.add(c);
            for (const r of above.regions) found.regions.add(r);
        }
        visiting.delete(shortcode);
        known.set(shortcode, found);
        return found;
    };

    const names = (shortcodes) =>
        [...new Set([...shortcodes].map((sc) => places.get(sc)?.name ?? sc))].sort();
    return (shortcodes) => {
        const continents = new Set();
        const regions = new Set();
        for (const shortcode of shortcodes) {
            const found = reach(shortcode, new Set());
            for (const c of found.continents) continents.add(c);
            for (const r of found.regions) regions.add(r);
        }
        return { continents: names(continents), regions: names(regions) };
    };
}

/**
 * The places a note lies in: itself for a place, its `homes` and its
 * `locations` otherwise.
 *
 * @param {object} fm - The note's frontmatter.
 * @returns {string[]} Shortcodes, lower case.
 */
export function notePlaces(fm) {
    if (fm?.type === "place") return [String(fm.shortcode ?? "").toLowerCase()].filter(Boolean);
    const data = isMapping(fm?.data) ? fm.data : {};
    return [...placeShortcodes(data.homes), ...placeShortcodes(data.locations)];
}

/**
 * What a note's page tells the search.
 *
 * @param {object} fm - The page's frontmatter: the note's, with its `package`.
 * @param {object} options - What the values resolve against.
 * @param {(shortcodes: Iterable<string>) => {continents: string[], regions: string[]}} options.geography -
 *   From {@link placeGeography}.
 * @param {object} [options.index] - The site's address index, which names the
 *   culture `data.culture` names.
 * @returns {{filters: Array<{name: string, values: string[]}>, names: string[]}}
 *   Each filter with a value, in {@link SEARCH_FILTERS} order, and the names a
 *   search weights.
 */
export function searchMetadata(fm, { geography, index }) {
    const data = isMapping(fm?.data) ? fm.data : {};
    const text = (value) => (value === undefined || value === null ? "" : String(value).trim());
    const culture =
        data.culture !== undefined && data.culture !== null && data.culture !== "" ?
            index && resolveInfoboxRef(index, data.culture, { type: "lore" })?.name
        :   undefined;
    const { continents, regions } = geography(notePlaces(fm));
    const values = {
        package: [text(fm?.package)],
        type: [text(fm?.type)],
        subtype: [text(fm?.subType)],
        culture: [text(culture)],
        continent: continents,
        region: regions,
    };
    const filters = SEARCH_FILTERS.map((name) => ({
        name,
        values: values[name].filter(Boolean),
    })).filter((filter) => filter.values.length);
    const name = isMapping(fm?.name) ? fm.name : {};
    const names = [
        text(name.full),
        ...(Array.isArray(name.aliases) ? name.aliases.map(text) : []),
    ].filter(Boolean);
    return { filters, names: [...new Set(names)] };
}
