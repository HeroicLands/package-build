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
 * Derive containment and government lists from place facts. Geography comes
 * only from `data.parents`; government comes only from `data.government`.
 * Neither graph expands through affiliation ancestors, and government expands
 * through geographic ones only for a district stating none, which the content
 * index resolves before these lists read it. Government identity preserves the Address package, type and shortcode.
 * Its system normalizes to `note` because Item and journal documents share one page.
 * The lists become a note's generated **Within**, **Governed by** and
 * **Governed places** sections — see {@link module:engine/derived-sections}.
 * @module
 */
import { isAddressTuple, ownDocumentSystem, parseAddress, renderAddress } from "./address.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { readCanonicalKey } from "./content-address.mjs";

/** @typedef {{title:string,sort?:string,url?:string,address:string,type:string,subType?:string}} HoldingsEntry */
/**
 * @typedef {object} HoldingsNode
 * @property {string} shortcode
 * @property {"place"|"affiliation"} type
 * @property {string} [subType]
 * @property {string} title
 * @property {string} [sort] The note's `name.sort`; the list files by it in place of `title`.
 * @property {string} [url]
 * @property {string} [package] Owning content package.
 * @property {string} [system] Own document system.
 * @property {string} [canonical] Full own Address.
 * @property {string} [governmentSystem] Affiliation reference default system.
 * @property {unknown[]} parents
 * @property {unknown} [government] Null is explicit anarchy; absence is omission.
 */
/** @typedef {{contains?:HoldingsEntry[],governed_by?:HoldingsEntry[],governed_places?:HoldingsEntry[]}} Holdings */

/** The shortcodes a `parents` value names, bare or qualified.
 * @param {unknown} value
 * @returns {string[]}
 */
export function shortcodesOf(value) {
    const list =
        Array.isArray(value) ? value
        : value ? [value]
        : [];
    return [
        ...new Set(
            list
                .map((one) => {
                    if (isAddressTuple(one)) return one.shortcode.toLowerCase();
                    const canonical = readCanonicalKey(String(one ?? "").trim());
                    if (canonical) return canonical.shortcode.toLowerCase();
                    const tuple = parseAddress(one, { type: "place", types: new Set(["place"]) });
                    return tuple.reason ? "" : tuple.shortcode.toLowerCase();
                })
                .filter(Boolean),
        ),
    ];
}

/** Resolve in the citing node's package, never another package's namespace.
 * @param {unknown} value
 * @param {HoldingsNode} node
 * @param {"place"|"affiliation"} type
 * @returns {string}
 */
function referenceKey(value, node, type) {
    if (value == null) return "";
    const tuple = parseAddress(
        value,
        {
            package: node.package ?? "local",
            system:
                type === "place" ? "note" : (
                    (node.governmentSystem ?? ownDocumentSystem("affiliation"))
                ),
            type,
            types: new Set([type]),
        },
        { declared: true },
    );
    if (tuple.reason || tuple.type !== type) return "";
    return renderAddress({ ...tuple, system: "note" }).toLowerCase();
}

/** @param {HoldingsNode} node @returns {string} */
function ownKey(node) {
    const tuple = node.canonical ? readCanonicalKey(node.canonical) : node;
    return renderAddress({
        package: tuple.package ?? "local",
        system: "note",
        type: node.type,
        shortcode: node.shortcode.toLowerCase(),
    });
}
/** @param {HoldingsNode} node @returns {boolean} */
function listed(node) {
    return node.url !== undefined && node.url !== null && node.url !== "";
}
/** @param {HoldingsNode} node @returns {HoldingsEntry} */
function entryOf(node) {
    return {
        title: node.title,
        ...(node.sort ? { sort: node.sort } : {}),
        ...(listed(node) ? { url: node.url } : {}),
        address: ownKey(node),
        type: node.type,
        ...(node.subType === undefined ? {} : { subType: node.subType }),
    };
}
/** @param {HoldingsEntry} a @param {HoldingsEntry} b @returns {number} */
function bySubTypeThenTitle(a, b) {
    return (
        (a.subType ?? "").localeCompare(b.subType ?? "", "en") ||
        (a.sort ?? a.title).localeCompare(b.sort ?? b.title, "en")
    );
}

/** Read local facts without converting government omission into anarchy.
 * @param {object} fm
 * @param {{title:string,url?:string,package?:string,system?:string,canonical?:string,governmentSystem?:string}} page
 * @returns {HoldingsNode|null}
 */
export function holdingsNode(
    fm,
    { title, url, package: pkg, system, canonical, governmentSystem },
) {
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
        ...(typeof fm.name?.sort === "string" && fm.name.sort ? { sort: fm.name.sort } : {}),
        url,
        ...(pkg ? { package: pkg } : {}),
        ...(system ? { system } : {}),
        ...(canonical ? { canonical } : {}),
        ...(governmentSystem ? { governmentSystem } : {}),
        parents:
            type === "place" ?
                Array.isArray(data.parents) ? data.parents
                : data.parents ? [data.parents]
                : []
            :   [],
        ...(type === "place" && Object.hasOwn(data, "government") ?
            { government: data.government }
        :   {}),
    };
}

/** @param {Map<string,object>|undefined} foreignIndex @returns {HoldingsNode[]} */
export function foreignHoldingsNodes(foreignIndex) {
    const out = [];
    for (const [canonical, entry] of foreignIndex ?? []) {
        const tuple = readCanonicalKey(canonical);
        const type = String(entry?.type ?? "");
        if (!tuple || (type !== "place" && type !== "affiliation")) continue;
        out.push({
            canonical,
            package: tuple.package,
            system: tuple.system,
            shortcode: tuple.shortcode.toLowerCase(),
            type,
            subType: entry.subType == null ? undefined : String(entry.subType),
            title: String(entry.name ?? tuple.shortcode),
            ...(typeof entry.nameSort === "string" && entry.nameSort ?
                { sort: entry.nameSort }
            :   {}),
            url: entry.url,
            parents:
                type === "place" ?
                    Array.isArray(entry.parents) ? entry.parents
                    : entry.parents ? [entry.parents]
                    : []
                :   [],
            ...(type === "place" && Object.hasOwn(entry, "government") ?
                { government: entry.government }
            :   {}),
        });
    }
    return out;
}

/** Invert direct place facts. A stub remains a plain text entry; a stub's own
 * absent page receives no lists. First declaration of a page Address wins;
 * different document systems for one page normalize to its `note` identity.
 * @param {Iterable<HoldingsNode|null>} nodes
 * @param {object} [options]
 * @param {Iterable<HoldingsNode|null>} [options.governmentNodes] Additional public
 *   records without pages, participating only in government relationships.
 * @returns {Map<string,Holdings>}
 */
export function holdingsPages(nodes, { governmentNodes = [] } = {}) {
    const places = new Map();
    const affiliations = new Map();
    const geographicPlaces = new Map();
    for (const node of nodes) {
        if (!node || !node.shortcode) continue;
        const by = node.type === "place" ? places : affiliations;
        const key = ownKey(node);
        if (!by.has(key)) by.set(key, node);
        if (node.type === "place" && !geographicPlaces.has(node.shortcode.toLowerCase())) {
            // Shortcode identity: geography keeps its historical first-declaration rule.
            geographicPlaces.set(node.shortcode.toLowerCase(), node);
        }
    }
    // Local records with no published page still state government. They must
    // not add geographic edges: containment keeps its existing page graph.
    for (const node of governmentNodes) {
        if (!node || !node.shortcode) continue;
        const by = node.type === "place" ? places : affiliations;
        const key = ownKey(node);
        if (!by.has(key)) by.set(key, node);
    }
    const lists = new Map();
    const add = (node, key, entry) => {
        if (!listed(node)) return;
        let block = lists.get(node.url);
        if (!block) {
            block = {};
            lists.set(node.url, block);
        }
        (block[key] ??= []).push(entryOf(entry));
    };
    for (const child of geographicPlaces.values()) {
        const parentKeys = shortcodesOf(child.parents);
        for (const key of parentKeys) {
            const parent = geographicPlaces.get(key);
            if (parent && parent !== child) add(parent, "contains", child);
        }
    }
    for (const child of places.values()) {
        const government = affiliations.get(referenceKey(child.government, child, "affiliation"));
        if (!government) continue;
        add(child, "governed_by", government);
        add(government, "governed_places", child);
    }
    for (const block of lists.values()) {
        block.contains?.sort(bySubTypeThenTitle);
        block.governed_places?.sort(bySubTypeThenTitle);
    }
    return lists;
}

/* --------------------------------------------------------------------- */
/*  A district's government                                               */
/* --------------------------------------------------------------------- */

/** Districts whose government the index supplied from a parent. */
const inheritedGovernment = new WeakSet();

/**
 * Whether a record's `data.government` came from a parent rather than its own
 * note.
 *
 * @param {object} record - An index record.
 * @returns {boolean} True for a district that inherited its government.
 */
export function governmentInherited(record) {
    return inheritedGovernment.has(record);
}

/**
 * Give each district that states no government its parent's.
 *
 * A `place/district` falls under the government of the place it stands
 * within. One stating no `data.government` key takes the value of its nearest
 * parent that states the key, walking `data.parents` breadth first, in the
 * order written, through any parent that states none, and never visiting a
 * place twice. An explicit value on the district, `null` (complete anarchy)
 * included, is its own and is kept; a parent's explicit `null` is inherited as
 * anarchy. Every reader of the index — the Governed by and Governed places
 * sections, the "missing government" advisory, a consumer of the published
 * index — then reads the effective government at `data.government`.
 *
 * @param {object[]} records - Content-index records, edited in place.
 * @param {object} [opts]
 * @param {(key: string) => object|undefined} [opts.foreignRecord] - A fetched
 *   index's record by canonical Address, for a parent in a dependency.
 * @returns {void}
 */
export function inheritDistrictGovernments(records, { foreignRecord } = {}) {
    const keyOf = (pkg, shortcode) =>
        renderAddress({
            package: String(pkg ?? "local"),
            system: "note",
            type: "place",
            shortcode: String(shortcode).toLowerCase(),
        });
    const places = new Map();
    for (const record of records) {
        if (record?.type !== "place" || record.documents || !record.shortcode) continue;
        const key = keyOf(record.package, record.shortcode);
        if (!places.has(key)) places.set(key, record);
    }
    const parentKeys = (record) => {
        const parents = record?.data?.parents ?? record?.parents;
        const list =
            Array.isArray(parents) ? parents
            : parents == null ? []
            : [parents];
        return list
            .map((value) => {
                if (isAddressTuple(value)) return keyOf(value.package, value.shortcode);
                const tuple =
                    readCanonicalKey(String(value ?? "")) ??
                    parseAddress(value, {
                        package: record.package ?? "local",
                        system: "note",
                        type: "place",
                        types: new Set(["place"]),
                    });
                return isAddressTuple(tuple) ? keyOf(tuple.package, tuple.shortcode) : "";
            })
            .filter(Boolean);
    };
    const stated = (record) => {
        const data = record?.data && typeof record.data === "object" ? record.data : record;
        return data && Object.hasOwn(data, "government") && !inheritedGovernment.has(record) ?
                { value: data.government }
            :   undefined;
    };
    for (const district of places.values()) {
        if (district.subType !== "district") continue;
        const data = district.data && typeof district.data === "object" ? district.data : {};
        if (Object.hasOwn(data, "government")) continue;
        const seen = new Set([keyOf(district.package, district.shortcode)]);
        const queue = parentKeys(district);
        let found;
        while (queue.length && !found) {
            const key = queue.shift();
            if (seen.has(key)) continue;
            seen.add(key);
            const parent = places.get(key) ?? foreignRecord?.(key);
            if (!parent) continue;
            found = stated(parent);
            if (!found) queue.push(...parentKeys(parent));
        }
        if (!found) continue;
        district.data = { ...data, government: found.value };
        inheritedGovernment.add(district);
    }
}

/* --------------------------------------------------------------------- */
/*  The lint                                                              */
/* --------------------------------------------------------------------- */

/**
 * Advise when a place with an authored positive population omits government.
 * Missing, null or zero population establishes no inhabited population.
 * Property presence distinguishes omitted government from explicit null,
 * which means complete anarchy. Non-null values are validated by the declared
 * affiliation reference field. Tenure never supplies this fact, and
 * containment supplies it only to a district, which the content index gives
 * its nearest parent's government (see {@link inheritDistrictGovernments}), so
 * a district under a governed place is never advised.
 *
 * @param {object} note - The note with parsed frontmatter and raw source.
 * @returns {object[]} Located warning findings.
 */
export function checkGovernment(note) {
    const fm = note.fm ?? {};
    if (fm.type !== "place") return [];
    const data = fm.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return [];
    const population = data.population;
    if (typeof population !== "number" && typeof population !== "string") return [];
    const count = Number(population);
    if (!Number.isFinite(count) || count <= 0 || Object.hasOwn(data, "government")) return [];
    return [
        {
            file: note.file,
            ...positionOfFrontmatterPath(note.raw ?? "", ["data", "population"], { key: true }),
            severity: "warning",
            message:
                `missing government: place "${fm.shortcode ?? ""}" has positive population ` +
                "but no `data.government`; name an affiliation or write null for complete anarchy",
        },
    ];
}
