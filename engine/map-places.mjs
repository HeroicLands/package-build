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
 * The places a map is drawn from, and what their `parents` say about the
 * world's shape.
 *
 * **The map reads the content index, not the notes.** A place is a record of
 * this package's index or an entry of a fetched dependency's, read through
 * the same fields either way — name, `subType`, `parents`, `borders`,
 * `routes`, address — so a consumer's map draws its dependencies' places
 * beside its own without a second walk and without knowing which package a
 * place came from. A note is opened only to locate a finding in it.
 *
 * The containment analysis is the author's check: which place is the world,
 * which regions are continents, which continent each place is under, and
 * everything `parents` can get wrong — a place with no parent, a parent no
 * place declares, a cycle, a place with two parents, a region with no
 * `packFolder`, a polity beside no region. Each is reported in the
 * toolchain's finding form, located at the entry that states it.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { indexRecordsFor, isNoteRecord } from "./content-index.mjs";
import { noteFile } from "./index-records.mjs";
import { cachedIndexPath, loadForeignIndexes } from "./metadata-index.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { parseAddress } from "./address.mjs";
import { readCanonicalKey, resolvePackageUrl } from "./content-address.mjs";

/**
 * The one type a `parents` entry may name — the default
 * {@link module:engine/address.parseAddress} fills in when the segment is
 * omitted, and the whole of what this position accepts.
 *
 * @type {ReadonlySet<string>}
 */
const PLACE_TYPES = Object.freeze(new Set(["place"]));

/**
 * A place as the map reads it, from either source.
 *
 * @typedef {object} MapPlace
 * @property {string} shortcode - Lower case.
 * @property {string} name - `name.full`, or the shortcode where a note has none.
 * @property {string} type - `place`.
 * @property {string} [subType]
 * @property {string[]} parents - Shortcodes, lower case, empty where none.
 * @property {Array<{to: string, bearing: string}>} borders
 * @property {Array<{to: string, bearing: string, mode?: string, days?: number}>} routes
 * @property {string} [address] - The canonical address.
 * @property {string} [url] - The page, where a site base is known.
 * @property {string} [file] - The note's path below the content root; local only.
 * @property {string} [folder] - The note's directory below the content root; local only.
 * @property {string} package - The package that publishes it.
 * @property {boolean} local - Whether it is this package's own.
 * @property {boolean|undefined} hasPackFolder - Whether the note declares
 *   `packFolder`; unknown for a fetched entry.
 */

/**
 * A polity — an `affiliation` note of `subType: polity` — drawn beside the
 * region notes that share its directory.
 *
 * @typedef {object} MapPolity
 * @property {string} shortcode
 * @property {string} name
 * @property {string} [address]
 * @property {string} [url]
 * @property {string} file
 * @property {string} folder
 */

/**
 * The world a map is drawn from: every place, every polity, and where the
 * notes are for locating a finding.
 *
 * @typedef {object} MapWorld
 * @property {Map<string, MapPlace>} places - By shortcode, lower case.
 * @property {MapPolity[]} polities - In path order.
 * @property {string} contentBase - The content root the local notes sit under.
 * @property {object} [config] - The resolved configuration, where one was used.
 * @property {Array<{package: string, reason: string}>} stale - Dependency
 *   indexes that could not be read.
 */

/**
 * The shortcode a `parents` entry names, lower case.
 *
 * **A `parents` entry is an Address** — the specification types it
 * `Address[]`, and the description ("enclosing places") is what makes `place`
 * its default and its only accepted type. A qualified form is read
 * structurally by {@link readCanonicalKey} for its literal four segments,
 * since this position asks neither its package nor its system, only the
 * shortcode {@link module:engine/address} would resolve it to anyway.
 *
 * **The match this shortcode feeds is deliberately package-blind.**
 * `world.places` merges this package's own places with every fetched
 * dependency's into one shortcode space, the way a dependency's place
 * attaches to the local containment tree it is drawn beside — see
 * `tests/map.test.ts`'s _loads a dependency's places beside the package's
 * own_, where a fetched place's bare `parents: ["world"]` reaches this
 * package's own root. Comparing the full Address instead would ask the
 * dependency's own package to agree with this one's, which the feature is
 * built to cross.
 *
 * @param {unknown} parent - One `parents` entry.
 * @returns {string} Its shortcode, or `""` for an entry that names nothing.
 */
function parentShortcode(parent) {
    const text = String(parent ?? "").trim();
    if (!text) return "";
    const qualified = readCanonicalKey(text);
    if (qualified) return qualified.shortcode.toLowerCase();
    const read = parseAddress(text, { type: "place", types: PLACE_TYPES });
    return read.reason ? "" : read.shortcode.toLowerCase();
}

/**
 * A `parents` value as a list of shortcodes.
 *
 * @param {unknown} value - The authored value, a list or a lone entry.
 * @returns {string[]} Shortcodes, lower case, empties dropped.
 */
function parentsOf(value) {
    const list =
        Array.isArray(value) ? value
        : value ? [value]
        : [];
    return list.map(parentShortcode).filter(Boolean);
}

/**
 * A relation list as the map reads it: entries that are maps, `to` lower
 * case.
 *
 * @param {unknown} value - A `borders` or `routes` value.
 * @returns {Array<Record<string, any>>} The entries.
 */
function relationList(value) {
    if (!Array.isArray(value)) return [];
    return value
        .filter((e) => e && typeof e === "object" && !Array.isArray(e))
        .map((e) => ({ ...e, to: String(e.to ?? "").toLowerCase() }));
}

/**
 * Read this package's places and polities out of its index records.
 *
 * @param {Array<Record<string, any>>} records - Index records, as
 *   {@link module:engine/content-index.indexRecordsFor} returns them.
 * @param {object} opts
 * @param {string} opts.contentBase - The content root the records were read from.
 * @param {string} [opts.base] - The site base the package's pages are served
 *   under, ending in a slash. Absent, no place carries a URL.
 * @returns {MapWorld} The world, with no dependency's places.
 */
export function placesFromRecords(records, { contentBase, base }) {
    /** @type {Map<string, MapPlace>} */
    const places = new Map();
    /** @type {MapPolity[]} */
    const polities = [];
    const url = (record) =>
        base && record.address?.slug ?
            resolvePackageUrl(`${record.address.slug}/`, base)
        :   undefined;

    for (const record of records) {
        if (!isNoteRecord(record)) continue;
        const shortcode = String(record.shortcode ?? "").toLowerCase();
        if (!shortcode) continue;
        const name = String(record.name?.full ?? record.name ?? shortcode);
        if (record.type === "place") {
            // First writer wins, as in the index itself; a duplicate is the
            // lint's finding.
            if (places.has(shortcode)) continue;
            const data = record.data && typeof record.data === "object" ? record.data : {};
            places.set(shortcode, {
                shortcode,
                name,
                type: "place",
                subType: record.subType === undefined ? undefined : String(record.subType),
                parents: parentsOf(data.parents),
                borders: relationList(data.borders),
                routes: relationList(data.routes),
                address: record.address?.canonical,
                url: url(record),
                file: record.file?.path,
                folder: record.file?.folder ?? "",
                package: String(record.package ?? ""),
                local: true,
                hasPackFolder: Object.hasOwn(record, "packFolder"),
            });
        } else if (record.type === "affiliation" && record.subType === "polity") {
            polities.push({
                shortcode,
                name,
                address: record.address?.canonical,
                url: url(record),
                file: String(record.file?.path ?? ""),
                folder: String(record.file?.folder ?? ""),
            });
        }
    }
    polities.sort((a, b) => a.file.localeCompare(b.file));
    return { places, polities, contentBase, stale: [] };
}

/**
 * Add a fetched index's places to a world.
 *
 * An entry carries what the producer's record stated — name, `subType`,
 * `parents`, `borders`, `routes` and its page URL — and nothing about the
 * file it came from, so a finding about one is located at the cached index
 * that supplied it. A shortcode this package already declares is left to the
 * local place.
 *
 * @param {MapWorld} world - The world to add to.
 * @param {Map<string, object>} foreignIndex - As
 *   {@link module:engine/metadata-index.loadForeignIndexes} returns it.
 * @returns {void}
 */
function addForeignPlaces(world, foreignIndex) {
    for (const [canonical, entry] of foreignIndex) {
        if (entry?.type !== "place") continue;
        const shortcode = readCanonicalKey(canonical)?.shortcode?.toLowerCase() ?? "";
        if (!shortcode || world.places.has(shortcode)) continue;
        world.places.set(shortcode, {
            shortcode,
            name: String(entry.name ?? shortcode),
            type: "place",
            subType: entry.subType === undefined ? undefined : String(entry.subType),
            parents: parentsOf(entry.parents),
            borders: relationList(entry.borders),
            routes: relationList(entry.routes),
            address: canonical,
            url: entry.url,
            package: String(entry.package ?? ""),
            local: false,
            hasPackFolder: undefined,
        });
    }
}

/**
 * Load the world a map is drawn from: this package's index, and the indexes
 * of every dependency it declares.
 *
 * @param {object} opts
 * @param {object} opts.config - The resolved configuration.
 * @param {string} [opts.contentBase] - The content root, defaulting to the
 *   configured one.
 * @param {string} [opts.base] - The site base this package's pages are served
 *   under. Absent, no local place carries a URL; a dependency's places carry
 *   the URL their index resolved to regardless.
 * @param {object[]} [opts.problems] - Collects the notes the index cannot
 *   record, as diagnostics, instead of throwing on the first.
 * @returns {MapWorld} The world.
 */
export function loadMapWorld({ config, contentBase, base, problems }) {
    const tree = contentBase ?? config.paths.content;
    const records = indexRecordsFor({
        contentBase: tree,
        config,
        skipDirectories: config.skipDirectories,
        problems,
    });
    const foreign = loadForeignIndexes(config, [config.contentPackage]);
    const world = mapWorld({
        records,
        foreignIndex: foreign.index,
        contentBase: tree,
        base,
        config,
    });
    world.stale = foreign.stale;
    return world;
}

/**
 * The world a map is drawn from, out of records and indexes a caller already
 * holds: this package's places from its index records, and every
 * dependency's from the fetched indexes. The site build reads its corpus and
 * its foreign indexes once for every surface it publishes, and hands them
 * here rather than walking the tree a second time.
 *
 * @param {object} opts
 * @param {Array<Record<string, any>>} opts.records - Index records, as
 *   {@link module:engine/content-index.indexRecordsFor} returns them.
 * @param {Map<string, object>} opts.foreignIndex - The fetched indexes, as
 *   {@link module:engine/metadata-index.loadForeignIndexes} returns `index`.
 * @param {string} opts.contentBase - The content root the records were read from.
 * @param {string} [opts.base] - The site base this package's pages are served
 *   under. Absent, no local place carries a URL.
 * @param {object} opts.config - The resolved configuration.
 * @returns {MapWorld} The world, with nothing stale: the caller has already
 *   judged its indexes usable.
 */
export function mapWorld({ records, foreignIndex, contentBase, base, config }) {
    const world = placesFromRecords(records, { contentBase, base });
    world.config = config;
    addForeignPlaces(world, foreignIndex);
    return world;
}

/* --------------------------------------------------------------------- */
/*  Containment                                                           */
/* --------------------------------------------------------------------- */

/**
 * What `parents` says about the world's shape.
 *
 * @typedef {object} Containment
 * @property {string|undefined} world - The one `subType: world` place.
 * @property {string[]} continents - Regions parented directly on the world,
 *   in name order.
 * @property {Map<string, string>} continentOf - Each place's continent, for
 *   the places that reach one by walking `parents` upward.
 * @property {Map<string, string[]>} children - Each place's children.
 * @property {string[][]} cycles - Each cycle as a chain that returns to its
 *   first place.
 * @property {Set<string>} cycleNodes - Every place on any cycle.
 * @property {Map<string, string[]>} regionsByFolder - The local region places
 *   in each directory, for placing polities.
 * @property {MapPolity[]} polities - The polities analysed.
 * @property {Anomalies} anomalies
 */

/**
 * Everything the containment tree can get wrong.
 *
 * @typedef {object} Anomalies
 * @property {string[]} noParent - Places with no parent, the world excluded.
 * @property {Array<{place: string, parent: string, index: number}>} unresolved -
 *   `parents` entries no place declares.
 * @property {string[][]} cycles
 * @property {string[]} multiParent - Places with more than one parent.
 * @property {string[]} polityNoRegion - Polity shortcodes whose directory
 *   holds no region note.
 * @property {string[]} regionNoPackFolder - Local regions with no `packFolder`.
 */

/**
 * Every cycle in the child → parent graph, by depth-first search over the
 * parents that resolve.
 *
 * @param {Map<string, MapPlace>} places - Every place.
 * @returns {{cycles: string[][], cycleNodes: Set<string>}} Each cycle once,
 *   and the union of their places.
 */
function findCycles(places) {
    const WHITE = 0;
    const GREY = 1;
    const BLACK = 2;
    const colour = new Map([...places.keys()].map((sc) => [sc, WHITE]));
    /** @type {string[]} */
    const stack = [];
    /** @type {string[][]} */
    const cycles = [];
    const cycleNodes = new Set();
    const seen = new Set();

    const visit = (sc) => {
        colour.set(sc, GREY);
        stack.push(sc);
        for (const parent of places.get(sc)?.parents ?? []) {
            if (!places.has(parent)) continue;
            if (colour.get(parent) === WHITE) visit(parent);
            else if (colour.get(parent) === GREY) {
                const cycle = [...stack.slice(stack.indexOf(parent)), parent];
                const key = [...cycle].sort().join("|");
                if (!seen.has(key)) {
                    seen.add(key);
                    cycles.push(cycle);
                }
                for (const node of cycle) cycleNodes.add(node);
            }
        }
        stack.pop();
        colour.set(sc, BLACK);
    };
    for (const sc of [...places.keys()].sort()) if (colour.get(sc) === WHITE) visit(sc);
    return { cycles, cycleNodes };
}

/**
 * Analyse the containment tree.
 *
 * @param {Map<string, MapPlace>} places - Every place.
 * @param {MapPolity[]} [polities] - Every polity.
 * @returns {Containment} The analysis.
 */
export function analyzeContainment(places, polities = []) {
    const worlds = [...places.values()].filter((p) => p.subType === "world");
    const world = worlds[0]?.shortcode;

    /** @type {Map<string, string[]>} */
    const children = new Map();
    for (const place of places.values()) {
        for (const parent of place.parents) {
            if (!places.has(parent)) continue;
            const list = children.get(parent) ?? [];
            list.push(place.shortcode);
            children.set(parent, list);
        }
    }

    /** @type {Map<string, string>} */
    const continentOf = new Map();
    const resolve = (sc, visiting) => {
        if (continentOf.has(sc)) return continentOf.get(sc);
        const place = places.get(sc);
        if (!place || sc === world || visiting.has(sc)) return undefined;
        if (place.subType === "region" && world !== undefined && place.parents.includes(world)) {
            continentOf.set(sc, sc);
            return sc;
        }
        visiting.add(sc);
        let found;
        for (const parent of place.parents) {
            found = resolve(parent, visiting);
            if (found !== undefined) break;
        }
        visiting.delete(sc);
        if (found !== undefined) continentOf.set(sc, found);
        return found;
    };
    for (const sc of places.keys()) resolve(sc, new Set());

    const byName = (a, b) =>
        String(places.get(a)?.name ?? a).localeCompare(String(places.get(b)?.name ?? b));
    const continents = [...continentOf.entries()]
        .filter(([sc, c]) => sc === c)
        .map(([sc]) => sc)
        .sort(byName);

    /** @type {Map<string, string[]>} */
    const regionsByFolder = new Map();
    for (const place of places.values()) {
        if (!place.local || place.subType !== "region") continue;
        const list = regionsByFolder.get(place.folder ?? "") ?? [];
        list.push(place.shortcode);
        regionsByFolder.set(place.folder ?? "", list);
    }

    const { cycles, cycleNodes } = findCycles(places);
    /** @type {Anomalies} */
    const anomalies = {
        noParent: [],
        unresolved: [],
        cycles,
        multiParent: [],
        polityNoRegion: [],
        regionNoPackFolder: [],
    };
    for (const sc of [...places.keys()].sort()) {
        const place = /** @type {MapPlace} */ (places.get(sc));
        if (place.parents.length === 0 && sc !== world) anomalies.noParent.push(sc);
        if (place.parents.length > 1) anomalies.multiParent.push(sc);
        if (place.local && place.subType === "region" && place.hasPackFolder === false) {
            anomalies.regionNoPackFolder.push(sc);
        }
        place.parents.forEach((parent, index) => {
            if (!places.has(parent)) anomalies.unresolved.push({ place: sc, parent, index });
        });
    }
    for (const polity of polities) {
        if (!regionsByFolder.get(polity.folder)?.length)
            anomalies.polityNoRegion.push(polity.shortcode);
    }

    return {
        world,
        continents,
        continentOf,
        children,
        cycles,
        cycleNodes,
        regionsByFolder,
        polities,
        anomalies,
    };
}

/**
 * Every place beneath one, by following `parents` downward — the place
 * itself included.
 *
 * @param {Containment} analysis - The analysis, for its children map.
 * @param {string} root - The place at the top.
 * @returns {Set<string>} The subtree.
 */
export function subtreeOf(analysis, root) {
    const seen = new Set();
    const stack = [root];
    while (stack.length) {
        const sc = /** @type {string} */ (stack.pop());
        if (seen.has(sc)) continue;
        seen.add(sc);
        stack.push(...(analysis.children.get(sc) ?? []));
    }
    return seen;
}

/**
 * The anomalies as findings, in the toolchain's form.
 *
 * A finding about a `parents` entry is located at that entry in the note; a
 * finding about the note as a whole at its `data` block, or the file alone;
 * a finding about a fetched place at the cached index that supplied it. A
 * place with no parent, a parent no place declares, and a cycle are errors —
 * the tree cannot reach the place, or cannot be a tree. Two parents, a region
 * with no `packFolder` and a polity beside no region are legal and worth a
 * look, so they are warnings.
 *
 * @param {Containment} analysis - The analysis.
 * @param {Map<string, MapPlace>} places - Every place.
 * @param {object} opts
 * @param {string} opts.contentBase - The content root the local notes sit under.
 * @param {object} [opts.config] - The configuration, for naming a cached index.
 * @returns {Array<{file: string, line?: number, column?: number,
 *   severity: "error"|"warning", message: string}>} The findings.
 */
export function containmentFindings(analysis, places, { contentBase, config }) {
    const findings = [];
    /** @type {Map<string, string>} */
    const rawCache = new Map();
    const rawOf = (file) => {
        if (!rawCache.has(file)) {
            let text = "";
            try {
                text = fs.readFileSync(file, "utf8");
            } catch {
                // The note is gone or unreadable; the finding names the file
                // alone rather than guessing a line.
            }
            rawCache.set(file, text);
        }
        return /** @type {string} */ (rawCache.get(file));
    };
    const locate = (place, keyPath) => {
        if (place.local && place.file) {
            const file = noteFile(contentBase, { file: { path: place.file } });
            return { file, ...(keyPath ? positionOfFrontmatterPath(rawOf(file), keyPath) : {}) };
        }
        return {
            file:
                config ?
                    cachedIndexPath(config, place.package)
                :   path.join("build", "cache", "metadata", place.package),
        };
    };
    const { anomalies } = analysis;

    for (const sc of anomalies.noParent) {
        const place = /** @type {MapPlace} */ (places.get(sc));
        findings.push({
            ...locate(place, ["data"]),
            severity: "error",
            message: `place "${sc}" has no parent, so the containment tree cannot reach it; state what it is within in \`data.parents\``,
        });
    }
    for (const { place: sc, parent, index } of anomalies.unresolved) {
        const place = /** @type {MapPlace} */ (places.get(sc));
        findings.push({
            ...locate(place, ["data", "parents", index]),
            severity: "error",
            message: `place "${sc}" names parent "${parent}", which does not resolve to any place in this package or a fetched index`,
        });
    }
    for (const cycle of anomalies.cycles) {
        const first = /** @type {MapPlace} */ (places.get(cycle[0]));
        const index = Math.max(0, first.parents.indexOf(cycle[1]));
        findings.push({
            ...locate(first, ["data", "parents", index]),
            severity: "error",
            message: `\`parents\` form a cycle: ${cycle.join(" → ")}; a place is never its own ancestor`,
        });
    }
    for (const sc of anomalies.multiParent) {
        const place = /** @type {MapPlace} */ (places.get(sc));
        findings.push({
            ...locate(place, ["data", "parents"]),
            severity: "warning",
            message: `place "${sc}" has more than one parent (${place.parents.join(", ")}), which is legal for a sea between continents or a region split between two, and worth a look otherwise`,
        });
    }
    for (const sc of anomalies.regionNoPackFolder) {
        const place = /** @type {MapPlace} */ (places.get(sc));
        findings.push({
            ...locate(place, undefined),
            severity: "warning",
            message: `region "${sc}" declares no \`packFolder\`, so its documents are filed by address rather than in a folder of their own`,
        });
    }
    for (const sc of anomalies.polityNoRegion) {
        const polity = analysis.polities.find((p) => p.shortcode === sc);
        findings.push({
            file: polity ? noteFile(contentBase, { file: { path: polity.file } }) : contentBase,
            severity: "warning",
            message: `polity "${sc}" sits in a directory holding no region note, so the containment tree has no region to draw it beside`,
        });
    }
    return findings;
}
