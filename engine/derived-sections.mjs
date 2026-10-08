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
 * The **derived sections** a note is given after its text, written as the
 * Markdown every surface receives — see {@link module:engine/generated-sections}
 * for the rules all generated sections share.
 *
 * | Section           | Anchor           | On                   | Lists                                                       |
 * | ----------------- | ---------------- | -------------------- | ----------------------------------------------------------- |
 * | Within            | `within`         | a place              | the places whose `parents` names it, grouped by kind         |
 * | Governed by       | `governedby`     | a place              | the affiliation its `data.government` names                  |
 * | Governed places   | `governedplaces` | an affiliation       | the places naming it as government, grouped by kind          |
 * | In song and story | `insongandstory` | any note             | the works naming it, or one of its events, in `subjects`     |
 * | From here         | `fromhere`       | a place on a border or a route | the map from it, as an image                       |
 *
 * The lists are the derivations {@link module:engine/holdings} and
 * {@link module:engine/literature-works} make, over this package's records and
 * every fetched index. An entry naming a note that publishes a page is a
 * wikilink with an empty label, so each surface resolves it its own way and
 * prints the note's current name; an entry naming a stub is its name as plain
 * text.
 *
 * The map is the drawing `package-build map --from` makes. The section names
 * it by {@link module:engine/generated-sections.fromHereSource}, and each
 * surface draws and serves it.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import {
    authoredSection,
    fromHereFile,
    fromHereSource,
    sectionHeading,
} from "./generated-sections.mjs";
import { foreignHoldingsNodes, holdingsNode, holdingsPages } from "./holdings.mjs";
import { isNoteRecord } from "./index-records.mjs";
import { foreignWorksNodes, worksNode, worksPages } from "./literature-works.mjs";
import { buildMaps, relatedPlaces } from "./map-build.mjs";
import { mapWorld } from "./map-places.mjs";
import { NOTE_VOCABULARY } from "./note-vocabulary.mjs";

/**
 * The heading each kind of place is grouped under, in the order the place
 * vocabulary declares its kinds. A kind the vocabulary does not declare is
 * grouped after these by its own name, and a place stating no kind last, under
 * **Other**.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PLACE_KIND_LABELS = Object.freeze({
    world: "Worlds",
    region: "Regions",
    settlement: "Settlements",
    site: "Sites",
    structure: "Structures",
    feature: "Features",
    celestial: "Celestial places",
});

/** The place kinds, in vocabulary order. */
const PLACE_KINDS = NOTE_VOCABULARY.place.subTypes ?? [];

/**
 * A name set as plain Markdown text, its inline markup characters escaped.
 *
 * @param {string} text - A note's name.
 * @returns {string} Text no surface reads as markup.
 */
function plain(text) {
    return String(text ?? "").replace(/([\\`*_[\]<>{}|#!~])/g, "\\$1");
}

/**
 * One entry: a wikilink to a note with a page, its name as text otherwise.
 *
 * @param {{title: string, url?: string, address?: string}} entry - From a
 *   derivation.
 * @returns {string} Markdown.
 */
function entryText(entry) {
    return entry.url && entry.address ? `[[${entry.address}|]]` : plain(entry.title);
}

/**
 * A kind's words as a reader meets them: `polity`, `noble house`.
 *
 * @param {string} kind - A `subType`.
 * @returns {string} The words.
 */
function kindWords(kind) {
    return String(kind)
        .replace(/[-_]+/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase();
}

/**
 * Places grouped by kind, a paragraph to each kind: `**Settlements:** A, B`.
 *
 * @param {Array<{title: string, url?: string, address?: string, subType?: string}>} entries -
 *   Sorted by kind, then title.
 * @returns {string} Markdown.
 */
function groupedPlaces(entries) {
    const byKind = new Map();
    for (const entry of entries) {
        const kind = entry.subType ?? "";
        if (!byKind.has(kind)) byKind.set(kind, []);
        byKind.get(kind).push(entry);
    }
    const label = (kind) => {
        if (!kind) return "Other";
        if (PLACE_KIND_LABELS[kind]) return PLACE_KIND_LABELS[kind];
        const words = kindWords(kind);
        return words.charAt(0).toUpperCase() + words.slice(1);
    };
    const known = PLACE_KINDS.filter((kind) => byKind.has(kind));
    const others = [...byKind.keys()]
        .filter((kind) => kind && !PLACE_KINDS.includes(kind))
        .sort((a, b) => label(a).localeCompare(label(b), "en"));
    const order = [...known, ...others, ...(byKind.has("") ? [""] : [])];
    return order
        .map((kind) => `**${label(kind)}:** ${byKind.get(kind).map(entryText).join(", ")}`)
        .join("\n\n");
}

/**
 * A list, one entry to a line, with its kind or form after it in parentheses.
 *
 * @param {Array<{title: string, url?: string, address?: string}>} entries
 * @param {(entry: object) => string|undefined} detail - What follows the name.
 * @returns {string} Markdown.
 */
function listed(entries, detail) {
    return entries
        .map((entry) => {
            const after = detail(entry);
            return `- ${entryText(entry)}${after ? ` (${plain(after)})` : ""}`;
        })
        .join("\n");
}

/**
 * A section's Markdown: its heading, with its anchor, and its content.
 *
 * @param {string} slug - The section.
 * @param {string} content - What it shows.
 * @returns {string} The section.
 */
function section(slug, content) {
    return `${sectionHeading(slug)}\n\n${content}\n`;
}

/**
 * The note's name, as the derivations title an entry.
 *
 * @param {object} record - An index record.
 * @returns {string} The name.
 */
function titleOf(record) {
    return String(record.name?.full ?? record.shortcode ?? "");
}

/**
 * The places of this package that are given the map from them: each one that
 * states, or is named in, a border or a route, and publishes a page.
 *
 * @param {object[]} records - The content-index records.
 * @param {object} [opts]
 * @param {Map<string, object>} [opts.foreignIndex] - The fetched indexes, whose
 *   places a local place's border or route may name.
 * @param {object} [opts.config] - The resolved configuration. `site.maps:
 *   false` gives no place a map.
 * @returns {string[]} The places' shortcodes, sorted.
 */
export function placesWithMaps(records, { foreignIndex = new Map(), config } = {}) {
    if (config?.site?.maps === false) return [];
    const world = mapWorld({
        records: records.filter((record) => isNoteRecord(record)),
        foreignIndex,
        contentBase: config?.paths?.content ?? "",
        config,
    });
    const published = new Set(
        records
            .filter((record) => isNoteRecord(record) && record.type === "place" && record.address)
            .map((record) => String(record.shortcode).toLowerCase()),
    );
    return relatedPlaces(world.places).filter(
        (shortcode) => world.places.get(shortcode)?.local && published.has(shortcode),
    );
}

/**
 * Draw the map from each place given one, for a surface that serves the
 * drawing as a file: the Foundry compile and the book. Each drawing is the
 * standalone SVG `package-build map --from` writes, with no links, since
 * neither surface follows a link inside a picture.
 *
 * @param {object[]} records - The content-index records.
 * @param {object} opts
 * @param {string} opts.outDir - Where to draw. Emptied first, so a place that
 *   lost its relations keeps no drawing from an earlier run.
 * @param {Map<string, object>} [opts.foreignIndex] - The fetched indexes.
 * @param {object} [opts.config] - The resolved configuration.
 * @param {Iterable<string>} [opts.only] - The places to draw, of those given a
 *   map; absent, every one.
 * @returns {{maps: Map<string, string>, findings: object[]}} Each drawing's
 *   file, keyed by the file name a **From here** section names, and what
 *   drawing found.
 */
export function drawMapsFrom(records, { outDir, foreignIndex = new Map(), config, only } = {}) {
    fs.rmSync(outDir, { recursive: true, force: true });
    const wanted = only ? new Set([...only].map((one) => String(one).toLowerCase())) : null;
    const centres = placesWithMaps(records, { foreignIndex, config }).filter(
        (shortcode) => !wanted || wanted.has(shortcode),
    );
    /** @type {Map<string, string>} */
    const maps = new Map();
    if (!centres.length) return { maps, findings: [] };
    const world = mapWorld({
        records: records.filter((record) => isNoteRecord(record)),
        foreignIndex,
        contentBase: config?.paths?.content ?? "",
        config,
    });
    const { findings } = buildMaps({ world, outDir, from: centres });
    for (const centre of centres) {
        const name = fromHereFile(centre);
        maps.set(name, path.join(outDir, name));
    }
    return { maps, findings };
}

/**
 * The derived sections each note is given.
 *
 * @param {object[]} records - The content-index records, of the audience the
 *   surface publishes to.
 * @param {object} opts
 * @param {(record: object) => string} opts.fileOf - A record's note file, as
 *   prepared results are keyed.
 * @param {Map<string, object>} [opts.foreignIndex] - The fetched indexes.
 * @param {object} [opts.config] - The resolved configuration.
 * @param {string} [opts.only] - One note file to give sections to; absent,
 *   every note.
 * @returns {Map<string, Map<string, string>>} Note file to its sections, each
 *   keyed by its slug, for every note given at least one.
 */
export function derivedSections(records, { fileOf, foreignIndex = new Map(), config, only }) {
    const notes = records.filter((record) => isNoteRecord(record) && record.shortcode);
    const pages = notes.filter((record) => record.address);
    const nodeOf = (record) => ({
        title: titleOf(record),
        ...(record.address ? { url: record.address.canonical } : {}),
        package: String(record.package ?? config?.contentPackage ?? ""),
        ...(record.address ? { canonical: record.address.canonical } : {}),
    });

    // A stub publishes no page and is listed as plain text, so it takes part
    // in every list without being given one.
    const holdings = holdingsPages([
        ...notes.map((record) => holdingsNode(record, nodeOf(record))),
        ...foreignHoldingsNodes(foreignIndex),
    ]);
    const works = worksPages(
        [
            ...notes.map((record) => worksNode(record, nodeOf(record))),
            ...foreignWorksNodes(foreignIndex),
        ],
        { types: new Set(Object.keys(NOTE_VOCABULARY)) },
    );
    const mapped = new Set(placesWithMaps(notes, { foreignIndex, config }));

    const out = new Map();
    for (const record of pages) {
        if (only !== undefined && fileOf(record) !== only) continue;
        const key = record.address.canonical;
        const lists = holdings.get(key) ?? {};
        const sections = new Map();
        const add = (slug, content) => {
            if (content && !authoredSection(record, slug))
                sections.set(slug, section(slug, content));
        };
        if (lists.contains?.length) add("within", groupedPlaces(lists.contains));
        if (lists.governed_by?.length)
            add(
                "governedby",
                listed(lists.governed_by, (entry) => entry.subType && kindWords(entry.subType)),
            );
        if (lists.governed_places?.length)
            add("governedplaces", groupedPlaces(lists.governed_places));
        const written = works.get(key)?.works ?? [];
        if (written.length)
            add(
                "insongandstory",
                listed(written, (entry) => entry.form),
            );
        const shortcode = String(record.shortcode).toLowerCase();
        if (record.type === "place" && mapped.has(shortcode)) {
            const alt = `Map from ${titleOf(record)}`.replace(/[[\]]/g, "");
            add("fromhere", `![${alt}](${fromHereSource(shortcode)}){.full-width}`);
        }
        if (sections.size) out.set(fileOf(record), sections);
    }
    return out;
}
