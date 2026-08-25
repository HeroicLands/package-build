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
 * **The address index a site build resolves its wikilinks against.**
 *
 * Every consumer that publishes a content tree as a website has to answer the
 * same question — given `[[Something]]`, which page? — and every one of them
 * answered it with its own copy of the same 150 lines. `sohl`'s and
 * `sohl-thalorna`'s site builds still share 147 identical lines of it, comments
 * and indentation aside. This is that shared half, lifted out whole.
 *
 * **What stays with the consumer: how a page gets its address.** The URL
 * scheme, the section a note is filed under, whether developer docs are part of
 * the site at all — those genuinely differ, and the two builds differ on all
 * three. So this takes *entries that already know their own URL* and does the
 * part that is the same everywhere: index them, index their aliases, merge the
 * foreign packages in, and report what cannot be addressed unambiguously.
 *
 * **Three key spaces, one map.**
 *
 * - `section/slug` and `type/shortcode` are unique by construction, so they
 *   always resolve. `type/shortcode` is the authored form; the canonical
 *   `package-type-shortcode` is set alongside it, which is what a cross-package
 *   link and every merged foreign entry use (#1499).
 * - A bare name, filename, or slug is a **collision-aware fallback**: a key
 *   that would map to two different pages is dropped and remembered, so
 *   `[[Name]]` on it fails the build rather than silently picking one. The
 *   author disambiguates with `[[section/slug|Label]]`.
 * - Aliases are indexed **scoped to their type**, which is what makes a bare
 *   `[[Shock]]` resolvable when "Shock" is both a rules page and a trauma item.
 *   Two notes *of the same type* sharing a name poison it, and the author
 *   writes `[[type/shortcode|Text]]`.
 *
 * **It reports rather than exits.** A build script owns its diagnostics and its
 * exit code; this returns what it found. That is the same rule the rest of the
 * engine follows, and it is what lets these cases be tested at all.
 *
 * @module
 */

import path from "node:path";

import { canonicalKey, readCanonicalKey } from "./kb-manifest.mjs";
import { hasDocEntry } from "./item-docs.mjs";

/**
 * One page the site will publish, as the index needs to see it.
 *
 * @typedef {object} SiteEntry
 * @property {string} kind   `"content"` for a note compiled from the content
 *                           tree, anything else for a page that carries no
 *                           `type`/`shortcode` (a developer doc, say). Only
 *                           content entries take part in type-scoped indexing.
 * @property {object} fm     The note's frontmatter.
 * @property {string} name   Display name.
 * @property {string} slug   URL segment.
 * @property {string} sec    Section the page is filed under.
 * @property {string} base   Source file's basename, e.g. `Climbing.md`.
 * @property {string} url    The page's published address.
 * @property {boolean} isReadme  Whether the page is its section's landing.
 */

/**
 * The resolved index and everything a wikilink resolver reads beside it.
 *
 * @typedef {object} SiteIndex
 * @property {Map<string, {url: string, name?: string}>} index  Address → page.
 * @property {Set<string>} ambiguous     Keys claimed by two pages, and so
 *                                       deliberately absent from `index`.
 * @property {Map<string, {url: string, name?: string}>} typeAlias  `type|alias`.
 * @property {Set<string>} typeCollide   Type-scoped aliases claimed twice.
 * @property {Set<string>} contentTypes  Every type the resolver should read as
 *                                       an address qualifier, local and foreign.
 * @property {Set<string>} sections      Section names, lowercased.
 * @property {Map<string, {name: string, url: string}>} refIndex  `type:shortcode`
 *                                       → page, for callers resolving embedded
 *                                       references (a being's items, say).
 * @property {{key: string, package: string}[]} conflicts  Addresses claimed by
 *                                       more than one package. Non-empty is a
 *                                       build failure; the caller reports it.
 */

/**
 * Add a collision-aware fallback key.
 *
 * First writer wins *until* a second, different page claims the key — at which
 * point the key is removed and blacklisted, so neither page answers to it. That
 * is deliberate: resolving to whichever note happened to be walked first is a
 * silently wrong link, and a failed build is not.
 *
 * @param {Map<string, object>} index - The index being built.
 * @param {Set<string>} collide - Keys already found ambiguous.
 * @param {string} key - The candidate key, in any case.
 * @param {{url: string}} value - The page it would resolve to.
 */
function addFallback(index, collide, key, value) {
    const k = String(key).toLowerCase();
    if (collide.has(k)) return;
    const cur = index.get(k);
    if (cur && cur.url !== value.url) {
        index.delete(k);
        collide.add(k);
    } else if (!cur) {
        index.set(k, value);
    }
}

/**
 * Merge the packages this build does not publish into the local index.
 *
 * Every canonical key is globally unique, so a foreign manifest merges straight
 * in — one map, one lookup, no precedence rule. A key already present is a
 * genuine conflict: two packages claiming one address, which is the case the
 * canonical form exists to make detectable.
 *
 * The short `type/shortcode` form is merged too, because a bare `[[doc-xyz]]`
 * carries no package and must still find a foreign note when exactly one
 * package publishes that address. Claimed by two, it is genuinely ambiguous and
 * the author writes the qualified form — the same rule the type-scoped aliases
 * use, one level out. **Local wins**: a live build is authoritative and a
 * vendored manifest can only be staler, so a short key the local tree already
 * claims is left alone.
 *
 * @param {Map<string, object>} index - The local index, mutated.
 * @param {Map<string, {package: string, type?: string}>} foreignIndex - Merged in.
 * @returns {{key: string, package: string}[]} Addresses claimed twice.
 */
function mergeForeign(index, foreignIndex) {
    const conflicts = [];
    const short = new Map();
    const ambiguous = new Set();

    for (const [key, value] of foreignIndex) {
        if (index.has(key)) {
            conflicts.push({ key, package: value.package });
            continue;
        }
        index.set(key, value);

        const parts = readCanonicalKey(key);
        if (!parts) continue;
        const shortKey = `${parts.type}/${parts.shortcode}`;
        if (
            short.has(shortKey) &&
            short.get(shortKey).package !== value.package
        ) {
            ambiguous.add(shortKey);
        } else {
            short.set(shortKey, value);
        }
    }

    for (const key of ambiguous) short.delete(key);
    for (const [key, value] of short) {
        if (!index.has(key)) index.set(key, value);
    }
    return conflicts;
}

/**
 * Build the address index a site's wikilink resolver reads.
 *
 * @param {readonly SiteEntry[]} entries - Every page the site will publish,
 *   each already knowing its own `url`.
 * @param {object} [options] - Cross-package inputs.
 * @param {Map<string, {package: string, type?: string}>} [options.foreignIndex]
 *   The merged index from `loadForeignManifests`. Omit when the build publishes
 *   no cross-package links.
 * @returns {SiteIndex} The index, and what could not be addressed unambiguously.
 */
export function buildSiteIndex(entries, { foreignIndex = new Map() } = {}) {
    const index = new Map();
    const ambiguous = new Set();
    const typeAlias = new Map();
    const typeCollide = new Set();
    const contentTypes = new Set();
    const sections = new Set();
    const refIndex = new Map();

    // `section/slug` is unique by construction; the rest are fallbacks.
    for (const e of entries) {
        sections.add(String(e.sec).toLowerCase());
        const value = { url: e.url, name: e.name };
        index.set(`${e.sec}/${e.slug}`.toLowerCase(), value);
        addFallback(index, ambiguous, e.name, value);
        if (!e.isReadme) {
            addFallback(index, ambiguous, path.basename(e.base, ".md"), value);
        }
        addFallback(index, ambiguous, e.slug, value);
    }

    // A foreign package may use a type this build has never seen. Seeding those
    // is what lets the resolver recognise `polity-xyz` as an address at all —
    // without it the link reads as prose and silently loses its href.
    for (const value of foreignIndex.values()) {
        if (value.type) contentTypes.add(value.type);
    }

    // Merged *before* the local type-scoped pass below, so a local page always
    // ends up owning its own canonical `package-type-shortcode` address: the
    // local write lands last and wins. `loadForeignManifests` already excludes
    // the local packages, so a manifest should never carry one — this is what
    // makes that a belt-and-braces rather than the only thing standing between
    // a stale vendored manifest and a shadowed local page.
    //
    // The corollary is that a conflict can only be reported against the keys
    // that exist at this point — the addressing ones, `section/slug` and the
    // bare fallbacks — which is precisely the overlap worth refusing.
    const conflicts = mergeForeign(index, foreignIndex);

    for (const e of entries) {
        // A page with no type or shortcode — a developer doc — is addressable
        // by section and name, and takes no part in type-scoped indexing.
        if (e.kind !== "content") continue;
        const type = String(e.fm.type).toLowerCase();
        contentTypes.add(type);
        const value = { url: e.url, name: e.name };

        const shortcode = e.fm.shortcode;
        if (typeof shortcode === "string" && shortcode) {
            refIndex.set(`${e.fm.type}:${shortcode}`, {
                name: e.name,
                url: e.url,
            });
            index.set(`${type}/${shortcode}`.toLowerCase(), value);
            // The canonical address alongside the short one. The short form
            // stays because a bare `[[skill-lang]]` defaults to the citing
            // note's own package and must keep resolving unchanged; the
            // canonical form is what cross-package links use (#1499).
            index.set(canonicalKey(e.fm.package, type, shortcode), value);
            // In Foundry an item and its documentation are two documents, so
            // `skill/wpnc` and `docskill/wpnc` are two UUIDs (#1362). Here the
            // item note renders as one page which *is* its documentation, so
            // the two qualifiers alias one URL and an anchor on either is an
            // ordinary in-page anchor. One authored link, correct in both
            // builds — restricted to the types that actually have an item doc,
            // so a qualifier the packs would reject is reported broken here too.
            if (hasDocEntry(type)) {
                contentTypes.add(`doc${type}`);
                index.set(`doc${type}/${shortcode}`.toLowerCase(), value);
            }
        }

        const aliases = [
            ...(Array.isArray(e.fm.aliases) ? e.fm.aliases : []),
            ...(Array.isArray(e.fm.name?.aliases) ? e.fm.name.aliases : []),
            e.name,
            path.basename(e.base, ".md").replace(/_/g, " "),
        ].filter((a) => typeof a === "string" && a);

        for (const alias of aliases) {
            const key = `${type}|${alias}`.toLowerCase();
            if (typeCollide.has(key)) continue;
            const cur = typeAlias.get(key);
            if (cur && cur.url !== value.url) {
                typeAlias.delete(key);
                typeCollide.add(key);
            } else if (!cur) {
                typeAlias.set(key, value);
            }
        }
    }

    return {
        index,
        ambiguous,
        typeAlias,
        typeCollide,
        contentTypes,
        sections,
        refIndex,
        conflicts,
    };
}

/**
 * The per-page context a wikilink resolver takes.
 *
 * Assembled here so a consumer spells out only what is genuinely its own — the
 * source path, the citing note's type, and where errors collect — instead of
 * restating the whole index every call. Both site builds wrote this object by
 * hand, identically.
 *
 * @param {SiteIndex} built - The result of {@link buildSiteIndex}.
 * @param {object} options - Per-page inputs.
 * @param {string} options.src - Source path of the page being resolved, for
 *   diagnostics.
 * @param {string|null} [options.type] - The citing note's type, which scopes a
 *   bare alias lookup.
 * @param {object[]} options.errors - Collector the resolver appends to.
 * @param {Map<string, object>} [options.foreignIndex] - The foreign index, for
 *   resolvers that distinguish a foreign hit from a local one.
 * @param {boolean} [options.manifestsComplete] - Whether every package this
 *   build links into supplied a manifest. When false, a resolver may soften an
 *   unresolved cross-package link rather than fail.
 * @returns {object} The resolver context.
 */
export function wikiContext(
    built,
    {
        src,
        type = null,
        errors,
        foreignIndex = new Map(),
        manifestsComplete = true,
    },
) {
    return {
        index: built.index,
        foreign: foreignIndex,
        manifestsComplete,
        collide: built.ambiguous,
        sections: built.sections,
        typeAlias: built.typeAlias,
        typeCollide: built.typeCollide,
        contentTypes: built.contentTypes,
        type,
        errors,
        src,
    };
}
