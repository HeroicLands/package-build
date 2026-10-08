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
 * The works of literature that concern each page, derived from what the works
 * say. A `literature` lore note names its subjects in `data.subjects`; the build
 * inverts that into the **In song and story** section of every subject — see
 * {@link module:engine/derived-sections} — so a reader of a hero, a place or a
 * god reaches the epics and legends about it. The subject note writes nothing.
 *
 * A subject naming an event lists the work on the page of the note holding
 * that event. A work in a fetched index lists on this package's subject pages
 * when that index carries its `subjects`. A subject in another package has no page here,
 * so a local work naming one lists nowhere.
 *
 * @module
 */

import { parseAddress, renderAddress, splitAnchor } from "./address.mjs";
import { AddressLink } from "./address-values.mjs";
import { readCanonicalKey } from "./content-address.mjs";
import { LITERATURE_SUBTYPE } from "./literature-notes.mjs";

/** @typedef {{title: string, url?: string, address: string, form?: string}} WorkEntry */
/**
 * @typedef {object} WorksNode
 * @property {string} key Own Address, normalized to the `note` system.
 * @property {string} title
 * @property {string} [url] Absent for a note that publishes no page.
 * @property {string} [package] Owning content package.
 * @property {string} [form] A work's `data.form`.
 * @property {unknown[]} subjects A work's `data.subjects`; empty for any other note.
 */

/**
 * The note-system key of one Address, or "" where it names nothing. A subject
 * naming an event — `place-ironfells#sack`, or an {@link AddressLink} read
 * from one — keys the note that holds the event.
 */
function addressKey(value, pkg, types) {
    if (value == null) return "";
    const note =
        value instanceof AddressLink ? value.target
        : typeof value === "string" ? splitAnchor(value).address
        : value;
    const tuple = parseAddress(note, { package: pkg ?? "local", system: "note", types });
    if (tuple.reason) return "";
    return renderAddress({ ...tuple, system: "note" }).toLowerCase();
}

/** Whether a note is a work of literature. */
function isWork(type, subType) {
    return type === "lore" && String(subType ?? "").toLowerCase() === LITERATURE_SUBTYPE;
}

/**
 * One local page's node.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {{title: string, url?: string, package?: string}} page
 * @returns {WorksNode|null} Null for a note with no type or shortcode.
 */
export function worksNode(fm, { title, url, package: pkg }) {
    const type = String(fm?.type ?? "");
    const shortcode = String(fm?.shortcode ?? "").toLowerCase();
    if (!type || !shortcode) return null;
    const data = fm.data && typeof fm.data === "object" && !Array.isArray(fm.data) ? fm.data : {};
    const work = isWork(type, fm.subType);
    return {
        key: renderAddress({ package: pkg ?? "local", system: "note", type, shortcode }),
        title,
        ...(url ? { url } : {}),
        ...(pkg ? { package: pkg } : {}),
        ...(work && typeof data.form === "string" && data.form ? { form: data.form } : {}),
        subjects:
            !work ? []
            : Array.isArray(data.subjects) ? data.subjects
            : data.subjects ? [data.subjects]
            : [],
    };
}

/**
 * The works a fetched index carries, as nodes. Only a work can list itself on
 * a page, and only a page of this package can carry the list, so a foreign
 * entry that is not a work is never needed here.
 *
 * @param {Map<string, object>|undefined} foreignIndex
 * @returns {WorksNode[]}
 */
export function foreignWorksNodes(foreignIndex) {
    const out = [];
    for (const [canonical, entry] of foreignIndex ?? []) {
        const tuple = readCanonicalKey(canonical);
        if (!tuple || !isWork(entry?.type, entry?.subType)) continue;
        if (!Array.isArray(entry.subjects) || !entry.subjects.length) continue;
        out.push({
            key: renderAddress({ ...tuple, system: "note" }),
            title: String(entry.name ?? tuple.shortcode),
            ...(entry.url ? { url: entry.url } : {}),
            package: tuple.package,
            ...(typeof entry.form === "string" && entry.form ? { form: entry.form } : {}),
            subjects: entry.subjects,
        });
    }
    return out;
}

/**
 * Invert every work's subjects into the list each subject's page carries.
 *
 * A subject is resolved in its work's own package. A work naming one subject
 * twice lists once; a work naming itself is not listed on its own page.
 * Entries sort by title.
 *
 * @param {Iterable<WorksNode|null>} nodes - Every local page, then any foreign work.
 * @param {object} options
 * @param {ReadonlySet<string>} options.types - Note types an Address may name.
 * @returns {Map<string, {works: WorkEntry[]}>} Keyed by the subject page's URL.
 */
export function worksPages(nodes, { types }) {
    const all = [...nodes].filter(Boolean);
    /** @type {Map<string, WorksNode>} */
    const pages = new Map();
    for (const node of all) {
        if (!node.url) continue;
        const key = node.key.toLowerCase();
        if (!pages.has(key)) pages.set(key, node);
    }
    /** @type {Map<string, {works: WorkEntry[]}>} */
    const lists = new Map();
    for (const work of all) {
        const seen = new Set();
        for (const subject of work.subjects) {
            const target = pages.get(addressKey(subject, work.package, types));
            if (!target || target.key === work.key || seen.has(target.url)) continue;
            seen.add(target.url);
            let block = lists.get(target.url);
            if (!block) lists.set(target.url, (block = { works: [] }));
            block.works.push({
                title: work.title,
                ...(work.url ? { url: work.url } : {}),
                address: work.key,
                ...(work.form ? { form: work.form } : {}),
            });
        }
    }
    for (const block of lists.values())
        block.works.sort((a, b) => a.title.localeCompare(b.title, "en"));
    return lists;
}
