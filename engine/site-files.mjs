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
 * **The files a site writes beside its pages**, for search engines and feed
 * readers:
 *
 * | File | Holds |
 * | ---- | ----- |
 * | `sitemap.xml` | every page of the site, by its full address ({@link sitemapXml}) |
 * | a sitemap index | every site's sitemap ({@link sitemapIndexXml}) |
 * | `robots.txt` | where every sitemap is ({@link robotsTxt}) |
 * | an Atom feed | a section's posts, newest first ({@link atomFeed}) |
 *
 * Each is a pure function of what it is given, and states no time of its own:
 * a date is a page's date, so a build of the same content writes the same
 * files.
 *
 * @module
 */

/** @param {unknown} value */
const text = (value) => (value === undefined || value === null ? "" : String(value));

/**
 * Text escaped for XML content and attribute values.
 *
 * @param {unknown} value - The text.
 * @returns {string} The escaped text.
 */
export function escapeXml(value) {
    return text(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

/**
 * A date as an RFC 3339 timestamp, or `""` for a value that is no date.
 *
 * @param {unknown} value - A date, or a string a `Date` reads.
 * @returns {string} The timestamp, in UTC.
 */
export function timestamp(value) {
    if (value === undefined || value === null || value === "") return "";
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().replace(/\.000Z$/, "Z");
}

/**
 * A site's sitemap.
 *
 * @param {Array<{loc: string, lastmod?: unknown}>} entries - Each page's full
 *   address, and the date it states where it states one.
 * @returns {string} The document.
 */
export function sitemapXml(entries) {
    const urls = entries.map((entry) => {
        const lastmod = timestamp(entry.lastmod);
        return [
            "  <url>",
            `    <loc>${escapeXml(entry.loc)}</loc>`,
            ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
            "  </url>",
        ].join("\n");
    });
    return [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls,
        "</urlset>",
        "",
    ].join("\n");
}

/**
 * A sitemap index naming other sitemaps.
 *
 * @param {readonly string[]} sitemaps - Each sitemap's full address.
 * @returns {string} The document.
 */
export function sitemapIndexXml(sitemaps) {
    return [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...sitemaps.map((loc) => `  <sitemap>\n    <loc>${escapeXml(loc)}</loc>\n  </sitemap>`),
        "</sitemapindex>",
        "",
    ].join("\n");
}

/**
 * The `robots.txt` of a site's root: every agent may read every page, and
 * every sitemap is named.
 *
 * @param {readonly string[]} sitemaps - Each sitemap's full address, the
 *   sitemap index first.
 * @returns {string} The file.
 */
export function robotsTxt(sitemaps) {
    return ["User-agent: *", "Allow: /", "", ...sitemaps.map((loc) => `Sitemap: ${loc}`), ""].join(
        "\n",
    );
}

/**
 * An Atom feed.
 *
 * The feed is dated by its newest entry, and an entry by its own date, so the
 * feed changes only when a post does.
 *
 * @param {object} feed - The feed.
 * @param {string} feed.title - The feed's title.
 * @param {string} feed.id - The full address of the page the feed follows,
 *   which is also its id.
 * @param {string} feed.self - The feed's own full address.
 * @param {string} [feed.author] - Who writes the posts, where an entry names
 *   no author of its own.
 * @param {Array<{title: string, url: string, date: unknown, author?: string,
 *   summary?: string, content?: string}>} feed.entries - The posts, each with
 *   its full address and its HTML `content`.
 * @returns {string} The document.
 */
export function atomFeed({ title, id, self, author, entries }) {
    const dated = entries
        .map((entry) => ({ ...entry, updated: timestamp(entry.date) }))
        .filter((entry) => entry.updated)
        .sort((a, b) =>
            a.updated < b.updated ? 1
            : a.updated > b.updated ? -1
            : a.url < b.url ? -1
            : 1,
        );
    const name = (who) => `<author><name>${escapeXml(who)}</name></author>`;
    const lines = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<feed xmlns="http://www.w3.org/2005/Atom">',
        `  <title>${escapeXml(title)}</title>`,
        `  <id>${escapeXml(id)}</id>`,
        `  <link rel="self" type="application/atom+xml" href="${escapeXml(self)}"/>`,
        `  <link rel="alternate" type="text/html" href="${escapeXml(id)}"/>`,
        ...(dated.length ? [`  <updated>${dated[0].updated}</updated>`] : []),
        ...(author ? [`  ${name(author)}`] : []),
    ];
    for (const entry of dated) {
        lines.push(
            "  <entry>",
            `    <title>${escapeXml(entry.title)}</title>`,
            `    <id>${escapeXml(entry.url)}</id>`,
            `    <link rel="alternate" type="text/html" href="${escapeXml(entry.url)}"/>`,
            `    <published>${entry.updated}</published>`,
            `    <updated>${entry.updated}</updated>`,
            ...(entry.author ? [`    ${name(entry.author)}`] : []),
            ...(entry.summary ? [`    <summary>${escapeXml(entry.summary)}</summary>`] : []),
            ...(entry.content ?
                [`    <content type="html">${escapeXml(entry.content)}</content>`]
            :   []),
            "  </entry>",
        );
    }
    lines.push("</feed>", "");
    return lines.join("\n");
}
