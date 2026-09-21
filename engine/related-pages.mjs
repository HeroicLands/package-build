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
 * What links to a page, and what it links to.
 *
 * The site build resolves every wikilink through the address index, so by the
 * time it writes a page it holds the whole link graph. This is the half that
 * turns the graph into front matter: the `related` block the theme's Related
 * card reads, on every page, in one shape.
 *
 * **A page is identified by its URL.** An address is unique within a package
 * and a page publishes at exactly one, so the URL is the one key both a
 * resolved wikilink and a homepage's markdown link can be reduced to — the
 * link resolver answers with a URL, and a homepage link *is* one. It is also
 * what makes a `doc<type>-<shortcode>` link a link to the same page as the
 * `<type>-<shortcode>` form: the site index keys one page under both, and both
 * answer with one URL.
 *
 * **Only a page of this site is an endpoint.** A link into another package
 * resolves to a URL the build renders but no page it writes, so it appears
 * on neither side: a backlink can only be counted on a page this build emits,
 * and listing a foreign mention beside local ones would make the two lists
 * disagree about what a connection is.
 *
 * @module
 */

import { homepageAddresses } from "./homepage.mjs";

/**
 * One entry in a `related` list — the page a reader is pointed at.
 *
 * @typedef {object} RelatedEntry
 * @property {string} title The page's published title.
 * @property {string} url   `<base><slug>/` — the page's address as every href
 *                          this build renders composes it, never the
 *                          site-root-relative form the page states for itself.
 * @property {string} type  The note's `type`, which the theme groups by.
 */

/**
 * The `related` block one page publishes.
 *
 * @typedef {object} Related
 * @property {RelatedEntry[]} backlinks Pages that link to this one.
 * @property {RelatedEntry[]} mentions  Pages this one links to.
 */

/**
 * A stable order for a list: by type, then title.
 *
 * The theme groups a list by type and reads each group in the order it
 * arrives, so the order is fixed here rather than left to walk order — which
 * is content-path order, and would reshuffle a page's card whenever a note was
 * filed elsewhere.
 *
 * @param {RelatedEntry} a
 * @param {RelatedEntry} b
 * @returns {number}
 */
function byTypeThenTitle(a, b) {
    return a.type.localeCompare(b.type, "en") || a.title.localeCompare(b.title, "en");
}

/**
 * Inverts a link graph into each page's backlinks and mentions.
 *
 * An edge is `(source URL, target URL)`, and a URL that is not in `entries` is
 * not a page of this site, so an edge touching one is dropped. A self-link says
 * nothing a reader is not already looking at, and a page that links another
 * three times is connected to it once, so both collapse.
 *
 * The result holds only pages with at least one connection, so the caller can
 * write nothing on a page with none — the theme's silent-disappear convention,
 * kept at the source rather than papered over with an empty block.
 *
 * @param {Iterable<readonly [string, string]>} edges - Every resolved link, as
 *   the source page's URL and the target page's.
 * @param {ReadonlyMap<string, RelatedEntry>} entries - Every page of this
 *   site, keyed by URL.
 * @returns {Map<string, Related>} URL → the page's `related` block, both lists
 *   sorted, for every page with at least one entry in either.
 */
export function relatedPages(edges, entries) {
    /** @type {Map<string, {backlinks: Set<string>, mentions: Set<string>}>} */
    const graph = new Map();
    const node = (url) => {
        let found = graph.get(url);
        if (!found) {
            found = { backlinks: new Set(), mentions: new Set() };
            graph.set(url, found);
        }
        return found;
    };

    for (const [source, target] of edges) {
        if (source === target) continue;
        if (!entries.has(source) || !entries.has(target)) continue;
        node(source).mentions.add(target);
        node(target).backlinks.add(source);
    }

    const list = (urls) =>
        [...urls]
            .map((url) => /** @type {RelatedEntry} */ (entries.get(url)))
            .sort(byTypeThenTitle);

    const out = new Map();
    for (const [url, { backlinks, mentions }] of graph) {
        out.set(url, { backlinks: list(backlinks), mentions: list(mentions) });
    }
    return out;
}

/**
 * The pages a homepage's body links to, as URLs.
 *
 * A homepage is published verbatim — no wikilink on it resolves, and its links
 * are ordinary markdown the browser resolves against the page's own address,
 * which is the package root. So its edges are read the same way: each target
 * resolved against `base`, the way a browser would. A package-relative
 * `being-x/`, a root-relative `/pkg/being-x/` and a `./being-x/#anchor` all
 * name the same page; a bare `#anchor` names the homepage itself.
 *
 * A link that names a host or a scheme leaves the site, whatever path it
 * carries, and yields nothing: the site's own pages are addressed without one.
 *
 * @param {string} body - The homepage's markdown body.
 * @param {string} base - Where the package is served — the homepage's own URL.
 * @returns {string[]} The targets' URLs, in body order, repeats included.
 */
export function homepageLinkTargets(body, base) {
    const out = [];
    // A placeholder origin, so a relative target resolves the way a browser
    // resolves it from the homepage. It never reaches the result: only the
    // path is read, and only when the target stayed on this origin.
    const origin = "http://site.invalid";
    for (const { url } of homepageAddresses(body)) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) continue;
        let resolved;
        try {
            resolved = new URL(url, `${origin}${base}`);
        } catch {
            continue;
        }
        if (resolved.origin !== origin) continue;
        out.push(resolved.pathname);
    }
    return out;
}
