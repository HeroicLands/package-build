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
 * Every asset reference in a compiled document states the asset's address.
 *
 * A compiled document names a picture by its Foundry path. That path says where
 * the file sits in one install and nothing more, so each reference also carries
 * the asset's canonical address, which says which file it is wherever a world
 * keeps it:
 *
 * - **HTML.** Each `<img>` whose `src` names an asset carries
 *   `data-asset="<address>"` beside it.
 * - **Path fields.** The address goes in `flags.<system>.assets` on the
 *   document holding the field, as nested objects mirroring the field's path —
 *   never a dotted key, which Foundry's `expandObject` splits on update.
 *
 *   | Document | Flag on | Keys |
 *   | --- | --- | --- |
 *   | Actor, Item, ActiveEffect, Macro, RollTable | the document | `img` |
 *   | Actor token art | `prototypeToken.flags` | `texture.src` |
 *   | Table result | the result | `img` |
 *   | Journal image page | the page | `src` |
 *
 * `<system>` is the system the document is compiled for — its
 * `_stats.systemId`.
 *
 * **A stand-in replaces an asset the package does not ship.** A reference to
 * an excluded picture compiles to its package's own
 * `<package>-none-<icon|image>-missing` and keeps the excluded asset's address,
 * which is how a world finds the real file once it holds it. An excluded
 * picture with no shipped stand-in is a finding against the note.
 *
 * The pass runs over the finished document, so it answers the same way
 * whichever compiler built it and whether the path came from an art address,
 * an authored pathname or a body image.
 *
 * @module
 */

import { isAssetRecord } from "./index-records.mjs";
import { ASSETS_SEGMENT, resolvePathname } from "./pathnames.mjs";
import { deployedAssetPath, exclusionReason, standInAddress } from "./asset-shipping.mjs";

/**
 * The embedded collections each document type holds, and their document type.
 *
 * @type {Readonly<Record<string, Readonly<Record<string, string>>>>}
 */
const EMBEDDED_COLLECTIONS = Object.freeze({
    Actor: Object.freeze({ items: "Item", effects: "ActiveEffect" }),
    Item: Object.freeze({ effects: "ActiveEffect" }),
    JournalEntry: Object.freeze({ pages: "JournalEntryPage" }),
    RollTable: Object.freeze({ results: "TableResult" }),
    Adventure: Object.freeze({
        actors: "Actor",
        items: "Item",
        journal: "JournalEntry",
        tables: "RollTable",
        macros: "Macro",
    }),
});

/**
 * One path field: the object whose `flags` record it, and the field's path
 * inside that object.
 *
 * @typedef {object} AssetPathField
 * @property {readonly string[]} holder - From the document to the object
 *   carrying the flag; empty for the document itself.
 * @property {readonly string[]} field - From that object to the value.
 * @property {(doc: object) => boolean} [when] - Whether the field is a picture
 *   on this document.
 */

/**
 * The path fields naming an asset, by document type.
 *
 * @type {Readonly<Record<string, readonly AssetPathField[]>>}
 */
export const ASSET_PATH_FIELDS = Object.freeze({
    Actor: Object.freeze([
        { holder: [], field: ["img"] },
        { holder: ["prototypeToken"], field: ["texture", "src"] },
    ]),
    Item: Object.freeze([{ holder: [], field: ["img"] }]),
    ActiveEffect: Object.freeze([{ holder: [], field: ["img"] }]),
    Macro: Object.freeze([{ holder: [], field: ["img"] }]),
    RollTable: Object.freeze([{ holder: [], field: ["img"] }]),
    TableResult: Object.freeze([{ holder: [], field: ["img"] }]),
    JournalEntryPage: Object.freeze([
        { holder: [], field: ["src"], when: (doc) => doc?.type === "image" },
    ]),
});

/**
 * One asset a compiled path can name.
 *
 * @typedef {object} AssetReferenceEntry
 * @property {string} address - The canonical address.
 * @property {string} package - The content package shipping it.
 * @property {string} type - `icon` or `image`.
 * @property {string} foundry - Its path in a Foundry install.
 * @property {boolean} shipped - Whether its package ships it.
 */

/**
 * Every picture a compiled document can name, by Foundry path and by address.
 *
 * Built from this package's asset records and every fetched dependency's, so a
 * reference to another package's picture states its address too.
 *
 * @param {{assets?: Map<string, object>, foreign?: Map<string, object>}} linkIndex -
 *   The compile's link index.
 * @param {object} config - The resolved build configuration.
 * @returns {{byPath: Map<string, AssetReferenceEntry>, byAddress: Map<string, AssetReferenceEntry>}}
 */
export function assetReferenceLookup(linkIndex, config) {
    const byPath = new Map();
    const byAddress = new Map();
    // Keyed by the rendered canonical address in both maps — a local record's
    // own `address.canonical` is the parsed form, and a fetched dependency's
    // entry carries none — so the key is the address.
    const entries = [
        ...(linkIndex?.foreign?.entries() ?? []),
        ...(linkIndex?.assets?.entries() ?? []),
    ];
    for (const [key, record] of entries) {
        if (!isAssetRecord(record) || !record.package) continue;
        if (deployedAssetPath(record) === undefined) continue;
        let forms;
        try {
            forms = resolvePathname(
                `${record.package}/${ASSETS_SEGMENT}/${record.asset.path}`,
                config,
            );
        } catch {
            continue;
        }
        if (!forms?.foundry) continue;
        const entry = {
            address: key,
            package: record.package,
            type: record.type,
            foundry: forms.foundry,
            // Additions are this package's own: a dependency's list is its own.
            shipped:
                exclusionReason(
                    record,
                    record.package === config.contentPackage ?
                        (config.packageBuild?.shippingLicenses ?? [])
                    :   [],
                ) === "",
        };
        byPath.set(entry.foundry, entry);
        byAddress.set(entry.address, entry);
    }
    return { byPath, byAddress };
}

/**
 * What one compiled path becomes: the path to write and the address to state.
 *
 * @param {string} value - A compiled path.
 * @param {{byPath: Map<string, AssetReferenceEntry>, byAddress: Map<string, AssetReferenceEntry>}} lookup
 * @param {(message: string) => void} report - Called once per excluded asset
 *   with no stand-in.
 * @returns {{src: string, address: string}|null} `null` for a path naming no
 *   asset.
 */
function resolveReference(value, lookup, report) {
    const entry = lookup.byPath.get(value);
    if (!entry) return null;
    if (entry.shipped) return { src: value, address: entry.address };
    const standIn = lookup.byAddress.get(standInAddress(entry.package, entry.type));
    if (standIn?.shipped) return { src: standIn.foundry, address: entry.address };
    report(
        `\`${entry.address}\` is not shipped in the \`${entry.package}\` package, and that ` +
            `package has no shipped stand-in \`${standInAddress(entry.package, entry.type)}\` ` +
            "to draw in its place — add a human-made `missing` picture under its " +
            `${entry.type === "icon" ? "icons" : "images"}/ root, licensed to ship`,
    );
    return { src: value, address: entry.address };
}

/**
 * Read a nested property.
 *
 * @param {any} obj
 * @param {readonly string[]} keys
 * @returns {any}
 */
function getPath(obj, keys) {
    let at = obj;
    for (const key of keys) {
        if (at == null || typeof at !== "object") return undefined;
        at = at[key];
    }
    return at;
}

/**
 * Write a nested property, creating plain objects on the way.
 *
 * @param {Record<string, any>} obj
 * @param {readonly string[]} keys
 * @param {unknown} value
 */
function setPath(obj, keys, value) {
    let at = obj;
    for (const key of keys.slice(0, -1)) {
        if (at[key] == null || typeof at[key] !== "object") at[key] = {};
        at = at[key];
    }
    at[keys[keys.length - 1]] = value;
}

/**
 * Record one field's address on the object holding it.
 *
 * Copies the `flags` objects it writes into, so a `flags` block the document
 * shares with an authored note is never changed in place.
 *
 * @param {Record<string, any>} holder
 * @param {string} system
 * @param {readonly string[]} field
 * @param {string} address
 */
function flagAddress(holder, system, field, address) {
    const flags = { ...(holder.flags ?? {}) };
    const scope = { ...(flags[system] ?? {}) };
    const assets = structuredClone(scope.assets ?? {});
    setPath(assets, field, address);
    scope.assets = assets;
    flags[system] = scope;
    holder.flags = flags;
}

/** One `<img …>` tag. */
const IMG_TAG = /<img\b[^>]*>/gi;

/** The `src` attribute inside a tag. */
const SRC_ATTRIBUTE = /(\ssrc\s*=\s*)(["'])(.*?)\2/i;

/**
 * Mark every `<img>` in one HTML string with its asset's address.
 *
 * @param {string} html
 * @param {Parameters<typeof resolveReference>[1]} lookup
 * @param {(message: string) => void} report
 * @returns {string} The HTML, every asset `<img>` carrying `data-asset`.
 */
export function annotateHtml(html, lookup, report) {
    if (typeof html !== "string" || !html.includes("<img")) return html;
    return html.replace(IMG_TAG, (tag) => {
        if (/\sdata-asset\s*=/i.test(tag)) return tag;
        const src = tag.match(SRC_ATTRIBUTE);
        if (!src) return tag;
        const resolved = resolveReference(src[3], lookup, report);
        if (!resolved) return tag;
        const rewritten = tag.replace(SRC_ATTRIBUTE, `$1$2${resolved.src}$2`);
        const close = rewritten.endsWith("/>") ? "/>" : ">";
        const body = rewritten.slice(0, -close.length).replace(/\s+$/, "");
        return `${body} data-asset="${resolved.address}"${close === "/>" ? " />" : ">"}`;
    });
}

/**
 * Mark every HTML string anywhere under a value, in place.
 *
 * @param {any} value
 * @param {Parameters<typeof resolveReference>[1]} lookup
 * @param {(message: string) => void} report
 */
function annotateStrings(value, lookup, report) {
    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            if (typeof item !== "string") annotateStrings(item, lookup, report);
            else {
                const annotated = annotateHtml(item, lookup, report);
                if (annotated !== item) value[index] = annotated;
            }
        });
        return;
    }
    if (value == null || typeof value !== "object") return;
    // Written back only where something changed: a document holds frozen
    // values — a parsed Address among them — that no `<img>` ever sits in.
    for (const [key, item] of Object.entries(value)) {
        if (typeof item !== "string") annotateStrings(item, lookup, report);
        else {
            const annotated = annotateHtml(item, lookup, report);
            if (annotated !== item) value[key] = annotated;
        }
    }
}

/**
 * Annotate one document's path fields, and its embedded documents', in place.
 *
 * @param {Record<string, any>} doc
 * @param {string} documentType
 * @param {string|null|undefined} system
 * @param {Parameters<typeof resolveReference>[1]} lookup
 * @param {(message: string) => void} report
 */
function annotateFields(doc, documentType, system, lookup, report) {
    if (doc == null || typeof doc !== "object") return;
    for (const { holder: holderPath, field, when } of ASSET_PATH_FIELDS[documentType] ?? []) {
        if (when && !when(doc)) continue;
        const holder = holderPath.length ? getPath(doc, holderPath) : doc;
        if (holder == null || typeof holder !== "object") continue;
        const value = getPath(holder, field);
        if (typeof value !== "string" || !value) continue;
        const resolved = resolveReference(value, lookup, report);
        if (!resolved) continue;
        setPath(holder, field, resolved.src);
        if (system) flagAddress(holder, system, field, resolved.address);
    }
    for (const [key, childType] of Object.entries(EMBEDDED_COLLECTIONS[documentType] ?? {})) {
        const children = doc[key];
        if (!Array.isArray(children)) continue;
        for (const child of children) annotateFields(child, childType, system, lookup, report);
    }
}

/**
 * State the address of every asset one compiled document references, and draw
 * a stand-in for each the package does not ship. Changes `doc` in place.
 *
 * @param {Record<string, any>} doc - The compiled document.
 * @param {string} documentType - Its Foundry document type.
 * @param {object} opts - Options.
 * @param {Parameters<typeof resolveReference>[1]} opts.lookup - From
 *   {@link assetReferenceLookup}.
 * @param {string|null|undefined} opts.system - The flag scope; no flag is
 *   written without one.
 * @param {(message: string) => void} opts.report - Receives each finding.
 * @returns {Record<string, any>} `doc`.
 */
export function annotateAssetReferences(doc, documentType, { lookup, system, report }) {
    annotateFields(doc, documentType, system, lookup, report);
    annotateStrings(doc, lookup, report);
    return doc;
}
