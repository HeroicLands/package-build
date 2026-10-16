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

import { parseAddress, renderAddress, hasAnchor } from "./address.mjs";
import { ASSET_TYPE_NAMES } from "./asset-types.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";

/**
 * Validate note references, refusing unresolved, repeated and self destinations.
 * @param {object} note - The authored note, including its raw source.
 * @param {object} [options] - The local and declared dependency context.
 * @param {object} [options.index] - The local and declared dependency index.
 * @param {string} [options.index.contentPackage] - The package owning the note.
 * @param {Set<string>} [options.index.types] - The indexed note types.
 * @param {Set<string>} [options.index.packages] - The indexed packages.
 * @param {(key: string) => {url?: string, uuid?: string, file?: string}|undefined}
 *   [options.index.addressHit] - Resolve a canonical Address to its destination.
 * @param {import("./address.mjs").AddressDefaults} [options.addressContext]
 *   - The Address defaults and vocabularies at the authored reference.
 * @returns {object[]} Findings located at the offending address.
 */
export function checkSeeAlso(note, { index, addressContext } = {}) {
    const entries = note.fm?.data?.seeAlso;
    if (!Array.isArray(entries)) return [];
    const defaults = {
        package: index?.contentPackage,
        system: "note",
        types: index?.types,
        packages: index?.packages,
        ...addressContext,
        type: undefined,
    };
    const own = parseAddress(note.fm.shortcode, { ...defaults, type: note.fm.type });
    const seen = new Set();
    const findings = [];
    entries.forEach((entry, i) => {
        if (entry === null) {
            findings.push({
                file: note.file,
                ...positionOfFrontmatterPath(note.raw ?? "", ["data", "seeAlso", i]),
                severity: "error",
                message: `\`data.seeAlso.${i}\` should be a map with an address`,
            });
            return;
        }
        if (!entry || typeof entry !== "object" || entry.address == null) return;
        const tuple = parseAddress(entry.address, defaults, { declared: true });
        const key = tuple.reason ? undefined : renderAddress(tuple);
        const target = key ? index?.addressHit?.(key) : undefined;
        const destination = target?.url ?? target?.uuid ?? target?.file ?? key;
        const self =
            (!own.reason &&
                tuple.package === own.package &&
                tuple.type === own.type &&
                tuple.shortcode === own.shortcode) ||
            (target?.file && target.file === note.file);
        const reason =
            hasAnchor(entry.address) ? "takes no anchor — it names a whole note"
            : tuple.reason || ASSET_TYPE_NAMES.has(tuple.type) ? "should be a note Address"
            : index?.addressHit && !target ?
                "does not resolve in this package or its declared dependencies"
            : self ? "names the note itself"
            : seen.has(destination) ? "is a duplicate destination"
            : undefined;
        seen.add(destination);
        if (reason)
            findings.push({
                file: note.file,
                ...positionOfFrontmatterPath(note.raw ?? "", ["data", "seeAlso", i, "address"]),
                severity: "error",
                message: `\`data.seeAlso.${i}.address\` ${reason}`,
            });
    });
    return findings;
}

/**
 * Resolve deliberate references in authored order using the surface's index.
 * @param {object} fm - The note frontmatter.
 * @param {(address: unknown) => object|undefined} resolve - The surface's reference resolver.
 * @returns {object[]} Display names, destinations and optional glosses.
 */
export function seeAlsoEntries(fm, resolve) {
    const entries = fm?.data?.seeAlso;
    if (!Array.isArray(entries)) return [];
    return entries.flatMap((entry) => {
        const target = entry?.address == null ? undefined : resolve(entry.address);
        if (!target) return [];
        return [{ ...target, text: target.name, ...(entry.gloss ? { gloss: entry.gloss } : {}) }];
    });
}

/** Plain text in a generated Markdown paragraph. */
const plain = (text) =>
    String(text ?? "")
        .replace(/([\\`*_[\]<>{}|#!~])/g, "\\$1")
        .replace(/\r?\n/g, " ");

/**
 * A generated section; an empty list emits nothing.
 * @param {object[]} entries - Resolved references in authored order.
 * @param {(entry: object) => string} link - The medium's link markup.
 * @param {number} [level=2] - Heading level; a journal uses one for a separate page.
 * @returns {string} Markdown for the section.
 */
export function seeAlsoMarkdown(entries, link, level = 2) {
    if (!entries.length) return "";
    return `${"#".repeat(level)} See also\n\n${entries.map((entry) => `- ${link(entry)}${entry.gloss ? ` — ${plain(entry.gloss)}` : ""}`).join("\n")}\n`;
}

/**
 * A reference rendered as an ordinary Markdown link for the book pipeline.
 * @param {object} entry - A resolved name and URL.
 * @returns {string} Markdown.
 */
export function seeAlsoWebLink(entry) {
    return entry.url ? `[${plain(entry.text)}](<${entry.url}>)` : plain(entry.text);
}

/**
 * Deliberate site connections for a set of pages, including dependency pages.
 * @param {object[]} pages - Pages carrying frontmatter and their published URL.
 * @param {(address: unknown) => object|undefined} resolve - The site's reference resolver.
 * @returns {Map<string, import("./related-pages.mjs").RelatedEntry[]>} Entries keyed by source URL.
 */
export function seeAlsoPages(pages, resolve) {
    const deliberate = new Map();
    for (const page of pages) {
        const refs = seeAlsoEntries(page.fm, resolve)
            .filter((ref) => ref.url)
            .map((ref) => ({
                title: ref.name,
                url: ref.url,
                type: ref.address.type,
                ...(ref.gloss ? { gloss: ref.gloss } : {}),
            }));
        if (refs.length) deliberate.set(page.url, refs);
    }
    return deliberate;
}
