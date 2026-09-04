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
 * part that is the same everywhere: index them, merge the foreign packages in,
 * and report what cannot be addressed unambiguously.
 *
 * **Two key spaces, one map**, and both are addresses. `section/slug` and
 * `type/shortcode` are unique by construction, so they always resolve.
 * `type/shortcode` is the authored form; the canonical
 * `package-type-shortcode` is set alongside it, which is what a cross-package
 * link and every merged foreign entry use (#1499).
 *
 * **A page's *name* is not a key** (#180). It was, as one of a set of
 * collision-aware fallbacks a bare `[[Name]]` was looked up in — which is what
 * made two pages of one type forbidden from sharing a display name (#179). The
 * bare form is retired, so the fallbacks answer nothing and the constraint they
 * imposed is gone with them.
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
import { contentPackage } from "./content-package.mjs";
// The declared tag vocabulary (#172), which is where `draft` is stated.
import { isDraftNote } from "./note-vocabulary.mjs";

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
 * @property {string} [sec]  The Hugo section a **tree** page is filed under, and
 *                           the first segment of the `<sec>/<slug>` address it
 *                           is reachable by. A content page has none: it is
 *                           addressed by `(type, shortcode)` and emitted flat
 *                           (#204).
 * @property {string} base   Source file's basename, e.g. `Climbing.md`.
 * @property {string} url    The page's published address.
 * @property {boolean} [isReadme]  Whether a tree page is its directory's
 *                           landing.
 */

/**
 * The resolved index and everything a wikilink resolver reads beside it.
 *
 * @typedef {object} SiteIndex
 * @property {Map<string, {url: string, name?: string, draft?: boolean}>} index
 *                                       Address → page. `draft` says the page
 *                                       carries the `draft` tag, which marks a
 *                                       link *into* it (#183).
 * @property {Set<string>} ambiguous     Short addresses claimed by two
 *                                       packages, and so deliberately absent
 *                                       from `index`.
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
 * the author writes the qualified form. **Local wins**: a live build is
 * authoritative and a
 * vendored manifest can only be staler, so a short key the local tree already
 * claims is left alone.
 *
 * @param {Map<string, object>} index - The local index, mutated.
 * @param {Map<string, {package: string, type?: string}>} foreignIndex - Merged in.
 * @returns {{conflicts: {key: string, package: string}[],
 *   ambiguous: Set<string>}} The addresses two packages both claim outright,
 *   and the short `type/shortcode` forms two foreign packages claim — those are
 *   left out of the index, so a resolver can say *ambiguous* rather than
 *   *nothing answers*.
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
        if (short.has(shortKey) && short.get(shortKey).package !== value.package) {
            ambiguous.add(shortKey);
        } else {
            short.set(shortKey, value);
        }
    }

    for (const key of ambiguous) short.delete(key);
    for (const [key, value] of short) {
        if (!index.has(key)) index.set(key, value);
    }
    return { conflicts, ambiguous };
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
    const contentTypes = new Set();
    const sections = new Set();
    const refIndex = new Map();
    // Every package an address may name: this build's own, plus every one a
    // vendored manifest speaks for. Without it `readQualifier` cannot see the
    // leading package segment of a canonical address, and `kethira-place-x`
    // reads as the unknown type `kethira` (#131).
    const ownPackage = contentPackage();
    const packages = new Set(ownPackage ? [ownPackage] : []);

    // `section/slug` is unique by construction, and is now a **tree** page's
    // address: a `trees` entry keeps its source layout below a named section,
    // so `dev-docs/testing` is how one is cited. A content page carries no
    // section at all (#204) and is addressed by `(type, shortcode)` below —
    // indexing it here as well would have written `weapongear/weapongear-dagger`,
    // a key no author could reasonably write.
    //
    // A page's name, filename and bare slug were indexed here too, as
    // collision-aware fallbacks the bare `[[Name]]` form looked up; that form is
    // retired and nothing consults them, so they are gone and with them the rule
    // that two pages of a type may not share a name (#179, #180).
    for (const e of entries) {
        if (typeof e.sec !== "string" || !e.sec) continue;
        sections.add(e.sec.toLowerCase());
        // `draft` rides on every key a page is addressable by, because a link
        // into a draft note renders marked whichever of them the author wrote
        // (#183). It decides nothing about resolution: the page is indexed and
        // published as any other.
        index.set(`${e.sec}/${e.slug}`.toLowerCase(), {
            url: e.url,
            name: e.name,
            draft: isDraftNote(e.fm),
        });
    }

    // A foreign package may use a type this build has never seen. Seeding those
    // is what lets the resolver recognise `polity-xyz` as an address at all —
    // without it the link reads as prose and silently loses its href.
    for (const value of foreignIndex.values()) {
        if (value.type) contentTypes.add(value.type);
        if (value.package) packages.add(value.package);
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
    const { conflicts, ambiguous } = mergeForeign(index, foreignIndex);

    for (const e of entries) {
        // A page with no type or shortcode — a developer doc — is addressable
        // by section and name, and takes no part in type-scoped indexing.
        if (e.kind !== "content") continue;
        const type = String(e.fm.type).toLowerCase();
        contentTypes.add(type);
        const value = { url: e.url, name: e.name, draft: isDraftNote(e.fm) };

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
            // The page's package is the configured one — the site collection
            // resolves it and records it as `pkg`. Never read out of
            // frontmatter: `package:` is retired (#56).
            index.set(canonicalKey(e.pkg ?? ownPackage, type, shortcode), value);
            if (e.pkg) packages.add(e.pkg);
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
    }

    return {
        index,
        ambiguous,
        contentTypes,
        sections,
        packages,
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
 * @param {string|null} [options.type] - The citing note's type, carried for a
 *   consumer's own diagnostics.
 * @param {object[]} options.errors - Collector the resolver appends to.
 * @param {string} [options.file] - The page's source file, which a link
 *   diagnostic names. Absent, `src` stands in.
 * @param {Map<string, object>} [options.foreignIndex] - The foreign index, for
 *   resolvers that distinguish a foreign hit from a local one.
 * @returns {object} The resolver context.
 *
 * There is deliberately **no `manifestsComplete`**. It used to let a resolver
 * soften an unresolved cross-package address while any package's manifest was
 * missing; #184 retired the softening, since the pack compilers and the link
 * checker never had it and one authored link must not get two verdicts. A
 * caller still passing it is ignored rather than obeyed.
 */
export function wikiContext(built, { src, file, type = null, errors, foreignIndex = new Map() }) {
    return {
        index: built.index,
        foreign: foreignIndex,
        collide: built.ambiguous,
        sections: built.sections,
        contentTypes: built.contentTypes,
        packages: built.packages,
        type,
        errors,
        src,
        file,
    };
}
