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
 * **The pages a reader can reach.** Every note is written as a page, but what
 * a reader finds is what the homepage leads to: the sitemap and the search
 * index cover the pages reachable from the homepage by the links the rendered
 * HTML carries, and no others. An unlinked page is still served at its
 * address, so an author reads a page in place before linking it to publish it.
 *
 * Reachability is read from the rendered pages, never from the source notes:
 * the `<a>` and `<link>` targets that lie inside the site's base path, the
 * menu and the chrome included. A link that lands on a feed makes the pages
 * the feed lists reachable too, because a feed is a list of links.
 *
 * @module
 */

/** A URL with a scheme, or a protocol-relative one: not a path inside the site. */
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** An `<a>` or `<link>` and its `href`, quoted either way or bare. */
const LINK = /<(?:a|link)\b[^>]*?\shref=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/**
 * The internal targets a page links.
 *
 * @param {string} html - A rendered page.
 * @param {string} from - The page's own address, beginning with `/`.
 * @param {string} base - The site's base path, beginning and ending with `/`.
 * @returns {string[]} Absolute paths inside the base, without fragment or query.
 */
export function internalLinks(html, from, base) {
    const found = [];
    for (const match of html.matchAll(LINK)) {
        const href = (match[1] ?? match[2] ?? match[3] ?? "").trim().replace(/&amp;/g, "&");
        if (!href || href.startsWith("#") || EXTERNAL.test(href)) continue;
        let pathname;
        try {
            pathname = new URL(href, `http://site.invalid${from}`).pathname;
        } catch {
            continue;
        }
        if (pathname.startsWith(base)) found.push(decodeURI(pathname));
    }
    return found;
}

/**
 * The address a link to a file names a page by: `…/index.html` is its
 * directory, and a bare directory ends in a slash.
 *
 * @param {string} pathname - An absolute path.
 * @returns {string} The page address it would be keyed by.
 */
export function pageAddress(pathname) {
    if (pathname.endsWith("/index.html")) return pathname.slice(0, -"index.html".length);
    return pathname.endsWith("/") || /\.[a-z0-9]+$/i.test(pathname) ? pathname : `${pathname}/`;
}

/**
 * The pages reachable from the homepage.
 *
 * @param {object} options - The inputs.
 * @param {string} options.base - The site's base path, beginning and ending
 *   with `/`; the homepage is at the base.
 * @param {(url: string) => string|undefined} options.html - A page's rendered
 *   HTML by its address, or `undefined` where the site has no such page.
 * @param {(pathname: string) => readonly string[]} [options.expand] - The page
 *   addresses a linked non-page file, such as a feed, lists.
 * @returns {Set<string>} The address of every reachable page, the homepage
 *   included.
 */
export function reachablePages({ base, html, expand = () => [] }) {
    /** @type {Set<string>} */
    const reached = new Set();
    const queue = [base];
    const seenFiles = new Set();
    while (queue.length) {
        const url = queue.pop();
        if (reached.has(url)) continue;
        const body = html(url);
        if (body === undefined) continue;
        reached.add(url);
        for (const target of internalLinks(body, url, base)) {
            const address = pageAddress(target);
            if (html(address) !== undefined) {
                queue.push(address);
            } else if (!seenFiles.has(target)) {
                seenFiles.add(target);
                for (const listed of expand(target)) queue.push(pageAddress(listed));
            }
        }
    }
    return reached;
}

/**
 * The page addresses an Atom feed lists, as paths.
 *
 * @param {string} xml - The feed.
 * @returns {string[]} The `href` of every `<link>` that is an absolute URL,
 *   as its path.
 */
export function feedPaths(xml) {
    const paths = [];
    for (const match of xml.matchAll(/<link\b[^>]*?\shref="([^"]*)"/g)) {
        try {
            paths.push(new URL(match[1].replace(/&amp;/g, "&")).pathname);
        } catch {
            // A relative or malformed link names no page.
        }
    }
    return paths;
}

/**
 * The comment that separates a page's authored text from the sections the
 * build generated after it, in the HTML the renderer writes.
 *
 * @type {string}
 */
export const GENERATED_MARK = "<!--generated-sections-->";

/**
 * A page body split at {@link GENERATED_MARK}.
 *
 * @param {string} html - A page body.
 * @returns {{authored: string, generated: string}} The author's text, and the
 *   generated sections after it, `""` where there are none.
 */
export function splitContent(html) {
    const text = String(html ?? "");
    const at = text.indexOf(GENERATED_MARK);
    if (at < 0) return { authored: text, generated: "" };
    return { authored: text.slice(0, at), generated: text.slice(at + GENERATED_MARK.length) };
}

/** An `<a>` element with an `href`, whole. */
const ANCHOR = /<a\b[^>]*?\shref=(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>[\s\S]*?<\/a>/gi;

/**
 * Generated sections with the entries that lead outside a set of pages taken
 * out.
 *
 * An entry is a list item, a table row, or a link in a paragraph's comma
 * separated run; a paragraph, list or table left with no entry goes, and so
 * does a section left with nothing under its heading. A link to anything that
 * is not a page of the site is kept, and so is text that was never a link.
 *
 * @param {string} html - The generated sections, rendered.
 * @param {(href: string) => boolean} outside - Whether an `href` names a page
 *   of the site that is not reachable.
 * @returns {string} The sections, or `""` when nothing is left.
 */
export function pruneGenerated(html, outside) {
    const dead = (anchor) => {
        const href = new RegExp(ANCHOR.source, "i").exec(anchor);
        const value = href ? (href[1] ?? href[2] ?? href[3] ?? "").replace(/&amp;/g, "&") : "";
        return value !== "" && outside(value);
    };
    const holdsDead = (fragment) => [...fragment.matchAll(ANCHOR)].some((match) => dead(match[0]));

    // Each section runs from its heading to the next one.
    const parts = String(html ?? "").split(/(?=<h1\b)/);
    const kept = parts.map((part) => {
        if (!holdsDead(part)) return part;
        let out = part
            .replace(/<li\b[^>]*>(?:(?!<\/li>)[\s\S])*<\/li>\s*/g, (item) =>
                holdsDead(item) ? "" : item,
            )
            .replace(/<tr\b[^>]*>(?:(?!<\/tr>)[\s\S])*<\/tr>\s*/g, (row) =>
                holdsDead(row) ? "" : row,
            )
            .replace(/<p\b[^>]*>(?:(?!<\/p>)[\s\S])*<\/p>\s*/g, (paragraph) => {
                if (!holdsDead(paragraph)) return paragraph;
                const trimmed = paragraph.replace(ANCHOR, (anchor) =>
                    dead(anchor) ? "\u0000" : anchor,
                );
                const entries = trimmed
                    .replace(/<\/?p\b[^>]*>/g, "")
                    .replace(/^\s*<strong>[^<]*<\/strong>/, "")
                    .replace(/\u0000/g, "")
                    .replace(/[\s,]+/g, " ")
                    .replace(/<[^>]*>/g, "")
                    .trim();
                if (!entries) return "";
                return trimmed
                    .replace(/\u0000,\s*/g, "")
                    .replace(/,\s*\u0000/g, "")
                    .replace(/\u0000/g, "");
            });
        out = out
            .replace(/<(ul|ol)\b[^>]*>\s*<\/\1>\s*/g, "")
            .replace(/<tbody\b[^>]*>\s*<\/tbody>\s*/g, "")
            .replace(/<table\b[^>]*>(?:(?!<tr\b)[\s\S])*<\/table>\s*/g, (table) =>
                /<tr\b/.test(table) ? table : "",
            );
        const rest = out.replace(/^<h1\b[^>]*>[\s\S]*?<\/h1>/, "").replace(/<!--[\s\S]*?-->/g, "");
        return rest.trim() === "" ? "" : out;
    });
    return kept.join("");
}
