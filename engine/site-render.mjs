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
 * **A site, written as HTML.** {@link writeSite} draws every page of a site
 * through the layouts of {@link module:engine/site-theme} and writes the files
 * that are deployed: one `index.html` per page, `404.html`, `sitemap.xml`, the
 * stylesheets, scripts and fonts the layouts link, and, where the site asks
 * for them, its listings, its feed, a sitemap index and `robots.txt`.
 * {@link packageSite} turns a package's site build into the pages
 * `writeSite` is given.
 *
 * ## The pages of a site
 *
 * A site is given its home page, its regular pages and any section pages its
 * author wrote. The rest is derived:
 *
 * | Page | Where | Lists |
 * | ---- | ----- | ----- |
 * | a section | `<section>/` | the section's pages |
 * | the tags | `tags/` | every tag, with how many pages carry it |
 * | a tag | `tags/<tag>/` | the pages that carry it |
 *
 * A section is the `section` a regular page names; a page that names none is
 * in no section. A section page an author wrote keeps its title and its body,
 * and lists the section's pages the body does not already reach. The tag pages
 * are written only with `tagPages`, and a page's tag links to its page only
 * then.
 *
 * The pages of a section are in the order a reader walks them, which their
 * previous and next links follow: by `weight`, lightest first and unweighted
 * last, then newest first by `date`, then by title in English order, then by
 * address.
 *
 * ## The files beside the pages
 *
 * | Site states | Written |
 * | ----------- | ------- |
 * | always | `404.html`, `sitemap.xml`, `css/code.css` and the theme's own files |
 * | `feed: {section, title}` | `<section>/atom.xml`, the section's pages, newest first |
 * | `sitemaps: [...]` | `sitemap-index.xml`, naming this site's sitemap and each one listed, and `robots.txt` naming them all |
 *
 * Every page is written, but `sitemap.xml` lists only the pages reachable from
 * the homepage by the links the rendered pages carry; see
 * {@link module:engine/site-reach}. A feed is a link, so the pages it lists
 * are reachable when a page links the feed, and a section or tag page lists
 * pages it links to the same way.
 *
 * A sitemap index and `robots.txt` belong at the root of an origin, so a site
 * served under a path refuses `sitemaps`.
 *
 * Every page is minified as it is written; see
 * {@link module:engine/html-minify}.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LEXICAL_LINK_CLASS } from "./dictionary-layout.mjs";
import { createRenderer } from "./content-render.mjs";
import { resolvePathname } from "./pathnames.mjs";
import { minifyHtml } from "./html-minify.mjs";
import { mapWorld } from "./map-places.mjs";
import {
    checkScriptFonts,
    copyScriptFonts,
    scriptFontFiles,
    siteFontsDestination,
} from "./script-font-delivery.mjs";
import { buildSite, gatesFailed } from "./site-build.mjs";
import { readCachedNavigation, siteSettings } from "./site-config.mjs";
import { atomFeed, robotsTxt, sitemapIndexXml, sitemapXml } from "./site-files.mjs";
import {
    pageAddress,
    pruneGenerated,
    reachablePages,
    splitContent,
    unlinkEntries,
} from "./site-reach.mjs";
import { prepareTreeSqlTables } from "./sql-tables.mjs";
import { placeGeography, searchMetadata } from "./site-search.mjs";
import {
    createSiteTheme,
    humanize,
    plainText,
    siteThemeAssets,
    subjectTags,
} from "./site-theme.mjs";
import { basePath, relUrl, tagUrl } from "./site-theme-urls.mjs";
import { slugify } from "./content-slug.mjs";
import { isPost } from "./post-fields.mjs";
import { siteBase } from "../content-config.mjs";

/** This package's root. */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The files the layouts link that the theme ships as they are: the site and
 * icon stylesheets, the spoiler script, the icon font and the theme's images.
 */
export const SITE_STATIC_DIR = path.join(PACKAGE_ROOT, "site-theme", "static");

/** The words of a post a feed entry summarises it with. */
const SUMMARY_WORDS = 70;

/** @param {unknown} value */
const text = (value) => (value === undefined || value === null ? "" : String(value));

/** Titles in the order an English reader sorts them. */
const collator = new Intl.Collator("en", { sensitivity: "variant" });

/**
 * A title as it is sorted: an apostrophe typed as `'` sorts before one typed
 * as `’`, rather than level with it. It is read as U+205E, the punctuation
 * mark the collation places just before both.
 */
const sortKey = (title) => text(title).replaceAll("'", "\u205e");

/**
 * Pages in the order a reader walks them: by `weight`, lightest first and an
 * unweighted page last; then newest first by `date`; then by title; then by
 * address. A page's own `weight` and `date` are read before its `params`'.
 *
 * @template {{title?: string, url: string, date?: unknown, weight?: number, params?: object}} T
 * @param {readonly T[]} pages - The pages.
 * @returns {T[]} A sorted copy.
 */
export function siteOrder(pages) {
    const weight = (page) => {
        const value = Number(page.weight ?? page.params?.weight);
        return value > 0 ? value : Infinity;
    };
    const time = (page) => {
        const value = page.date ?? page.params?.date;
        const date = value ? new Date(String(value)).getTime() : 0;
        return Number.isNaN(date) ? 0 : date;
    };
    return [...pages].sort((a, b) => {
        if (weight(a) !== weight(b)) return weight(a) < weight(b) ? -1 : 1;
        if (time(a) !== time(b)) return time(b) - time(a);
        const titles = collator.compare(sortKey(a.title), sortKey(b.title));
        if (titles) return titles;
        return (
            a.url < b.url ? -1
            : a.url > b.url ? 1
            : 0
        );
    });
}

/** A page as a sibling names it. */
const siblingOf = (page) => ({
    url: page.url,
    title: page.title,
    type: page.params?.type,
    subType: page.params?.subType,
    category: page.params?.category,
});

/** A page as a listing names it. */
const memberOf = (page) => ({
    url: page.url,
    title: page.title,
    description: page.params?.description,
    content: page.content,
});

/**
 * Every page of a site: the pages it is given, with their siblings, and the
 * listings derived from them.
 *
 * @param {object} site - The site, as {@link writeSite} takes it.
 * @param {readonly object[]} pages - The home page, the regular pages and any
 *   authored section pages.
 * @returns {object[]} Every page, home first, then the regular pages, the
 *   sections, and the tag pages.
 */
export function siteTree(site, pages) {
    const home = pages.filter((page) => page.kind === "home");
    const regular = pages.filter((page) => page.kind === "page");
    const authored = new Map(
        pages.filter((page) => page.kind === "section").map((page) => [page.section, page]),
    );

    /** @type {Map<string, object[]>} */
    const sections = new Map();
    for (const page of regular) {
        const key = text(page.section);
        if (!sections.has(key)) sections.set(key, []);
        sections.get(key).push(page);
    }
    const listings = [];
    for (const [key, list] of sections) {
        const ordered = siteOrder(list);
        const siblings = ordered.map(siblingOf);
        for (const page of ordered) page.siblings = siblings;
        if (!key) continue;
        const page = authored.get(key) ?? {
            kind: "section",
            section: key,
            title: humanize(key),
            url: relUrl(site, `${key}/`),
            params: {},
            content: "",
        };
        listings.push({ ...page, members: ordered.map(memberOf) });
    }
    for (const [key, page] of authored)
        if (!sections.has(key)) listings.push({ ...page, members: [] });

    if (!site.tagPages) return [...home, ...regular, ...listings];

    /** @type {Map<string, {name: string, pages: object[]}>} */
    const tags = new Map();
    for (const page of regular)
        for (const name of subjectTags(page.params)) {
            const key = slugify(name);
            if (!key) continue;
            if (!tags.has(key)) tags.set(key, { name, pages: [] });
            tags.get(key).pages.push(page);
        }
    const terms = [...tags.values()].map((tag) => ({
        kind: "term",
        title: tag.name,
        url: tagUrl(site, tag.name),
        params: {},
        content: "",
        members: siteOrder(tag.pages).map(memberOf),
        count: tag.pages.length,
        date: tag.pages
            .map((page) => text(page.date))
            .filter(Boolean)
            .sort()
            .at(-1),
    }));
    const taxonomy = {
        kind: "taxonomy",
        title: "Tags",
        url: relUrl(site, "tags/"),
        params: {},
        content: "",
        members: siteOrder(terms).map((term) => ({
            url: term.url,
            title: term.title,
            count: term.count,
        })),
    };
    return [...home, ...regular, ...listings, taxonomy, ...terms];
}

/**
 * The file a page is written to.
 *
 * @param {object} site - The site.
 * @param {string} out - The directory the site is written to.
 * @param {string} url - The page's address, under the site's base path.
 * @returns {string} The `index.html` the address serves.
 * @throws {Error} When the address is not under the site's base path.
 */
function pageFile(site, out, url) {
    const base = basePath(site);
    if (!url.startsWith(base))
        throw new Error(`the page ${url} is not under the site's base path ${base}`);
    return path.join(out, ...url.slice(base.length).split("/").filter(Boolean), "index.html");
}

/**
 * Write the files the layouts link: the theme's own, and the code stylesheet.
 *
 * @param {string} out - The directory the site is written to.
 * @param {string} [staticDir] - The theme's own files.
 * @returns {string[]} The files the theme generates, each written. The theme's
 *   own files are copied as a tree and not listed.
 */
export function writeThemeFiles(out, staticDir = SITE_STATIC_DIR) {
    fs.mkdirSync(out, { recursive: true });
    if (fs.existsSync(staticDir)) fs.cpSync(staticDir, out, { recursive: true });
    return siteThemeAssets().map((asset) => {
        const file = path.join(out, asset.path);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, asset.content);
        return file;
    });
}

/**
 * Draw a site and write it.
 *
 * @param {object} options - The inputs.
 * @param {object} options.site - The site, as
 *   {@link module:engine/site-theme.createSiteTheme} takes it, with `tagPages`,
 *   `feed` and `sitemaps` as the module description sets out. `pages` and
 *   `pageExists` are filled in here.
 * @param {readonly object[]} options.pages - The home page, the regular pages
 *   and any authored section pages, each as a layout is given it.
 * @param {string} options.out - The directory written to. Emptied first.
 * @param {(finding: import("./site-theme.mjs").Finding) => void} [options.report] -
 *   Receives each finding the layouts make.
 * @param {string} [options.staticDir] - The theme's own files, copied first.
 * @param {ReadonlySet<string>} [options.only] - The addresses of the pages to
 *   draw again into a site already written. Nothing else is touched.
 * @returns {{files: string[], pages: string[], reachable: string[],
 *   findings: object[]}} Every file written, the address of every page, the
 *   address of each page reachable from the homepage, and the layouts' findings.
 * @throws {Error} When a page's address is outside the site, or a site served
 *   under a path asks for a sitemap index.
 */
export function writeSite({ site, pages, out, report, staticDir = SITE_STATIC_DIR, only }) {
    if (site.sitemaps && basePath(site) !== "/")
        throw new Error(
            `a sitemap index and robots.txt belong at the root of an origin, and this site is served under ${basePath(site)}`,
        );
    const tree = siteTree(site, pages);
    const published = new Set(tree.map((page) => page.url));
    const feedUrl = site.feed ? relUrl(site, `${site.feed.section}/atom.xml`) : "";
    const base = basePath(site);
    const origin = (url) => new URL(url, site.baseURL).href;

    // The address of the page a URL names, or undefined where it names none of
    // this site's.
    const pageOfUrl = (url) => {
        let pathname;
        try {
            const resolved = new URL(String(url), origin(base));
            if (resolved.origin !== new URL(site.baseURL).origin) return undefined;
            pathname = decodeURI(resolved.pathname);
        } catch {
            return undefined;
        }
        const address = pageAddress(pathname);
        return published.has(address) ? address : undefined;
    };

    // A page is drawn twice. The first draw has no generated link to a page,
    // and the pages it links are the reachable ones; the second draws the
    // generated sections again with the links that stay inside that set.
    const makeTheme = ({ visible, contentOf, report: sink }) =>
        createSiteTheme({
            site: {
                ...site,
                visible,
                feed:
                    site.feed ?
                        {
                            title: site.feed.title ?? site.title,
                            url: feedUrl,
                            section: text(site.feed.section),
                        }
                    :   undefined,
                pages: tree
                    .filter((page) => page.kind === "page")
                    .map((page) => ({
                        url: page.url,
                        title: page.title,
                        section: text(page.section),
                        type: page.params?.type,
                        subType: page.params?.subType,
                        date: page.date ?? page.params?.date,
                        content: contentOf(page),
                    })),
                pageExists: (url) =>
                    published.has(url) || published.has(`${url.replace(/\/?$/, "/")}`),
            },
            report: sink,
        });
    const authoredOf = (page) =>
        unlinkEntries(
            splitContent(page.content).authored,
            (url) => pageOfUrl(url) !== undefined,
            LEXICAL_LINK_CLASS,
        );
    const first = makeTheme({
        visible: (url) => pageOfUrl(url) === undefined,
        contentOf: authoredOf,
    });
    const firstPass = new Map();
    for (const page of tree)
        firstPass.set(
            page.url,
            first.render({
                ...page,
                content: page.content === undefined ? undefined : authoredOf(page),
                permalink: origin(page.url),
            }),
        );

    const section = site.feed ? text(site.feed.section) : "";
    const time = (page) => new Date(text(page.date ?? page.params?.date)).getTime() || 0;
    const posts =
        site.feed ?
            tree
                .filter((page) => page.kind === "page" && text(page.section) === section)
                .sort((a, b) => time(b) - time(a))
        :   [];
    const reachable = reachablePages({
        base,
        html: (url) => firstPass.get(url),
        expand: (target) => (site.feed && target === feedUrl ? posts.map((post) => post.url) : []),
    });
    const outside = (url) => {
        const address = pageOfUrl(url);
        return address !== undefined && !reachable.has(address);
    };
    const contentOf = (page) => {
        if (page.content === undefined) return page.content;
        const { authored, generated } = splitContent(page.content);
        return (
            unlinkEntries(authored, outside, LEXICAL_LINK_CLASS) +
            pruneGenerated(generated, outside)
        );
    };
    const theme = makeTheme({ visible: (url) => !outside(url), contentOf, report });

    const files = [];
    const write = (file, content) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
        files.push(file);
    };
    const draw = (page) => {
        const html = minifyHtml(
            theme.render({ ...page, content: contentOf(page), permalink: origin(page.url) }),
        );
        write(pageFile(site, out, page.url), html);
    };
    const result = (extra = {}) => ({
        files,
        pages: tree.map((page) => page.url),
        reachable: [...reachable],
        findings: theme.findings,
        ...extra,
    });
    if (only) {
        for (const page of tree) if (only.has(page.url)) draw(page);
        return result();
    }

    fs.rmSync(out, { recursive: true, force: true });
    files.push(...writeThemeFiles(out, staticDir));
    for (const page of tree) draw(page);
    write(
        path.join(out, "404.html"),
        minifyHtml(
            theme.render({
                kind: "404",
                title: "Page not found",
                url: relUrl(site, "404.html"),
                params: {},
            }),
        ),
    );

    write(
        path.join(out, "sitemap.xml"),
        sitemapXml(
            tree
                .filter((page) => reachable.has(page.url))
                .map((page) => ({
                    loc: origin(page.url),
                    lastmod: page.params?.lastmod ?? page.date ?? page.params?.date,
                })),
        ),
    );

    if (site.feed) {
        write(
            path.join(out, ...section.split("/").filter(Boolean), "atom.xml"),
            atomFeed({
                title: site.feed.title ?? site.title,
                id: origin(relUrl(site, `${section}/`)),
                self: origin(feedUrl),
                author: site.params?.author,
                entries: posts.map((post) => {
                    const words = plainText(contentOf(post)).split(" ").filter(Boolean);
                    return {
                        title: post.title,
                        url: origin(post.url),
                        date: post.date ?? post.params?.date,
                        author: text(post.params?.data?.author) || site.params?.author,
                        summary:
                            text(post.params?.description) ||
                            (words.length > SUMMARY_WORDS ?
                                `${words.slice(0, SUMMARY_WORDS).join(" ")}…`
                            :   words.join(" ")),
                        content: contentOf(post),
                    };
                }),
            }),
        );
    }

    if (site.sitemaps) {
        const own = origin(relUrl(site, "sitemap.xml"));
        const index = origin(relUrl(site, "sitemap-index.xml"));
        const all = [own, ...site.sitemaps.filter((loc) => loc !== own)];
        write(path.join(out, "sitemap-index.xml"), sitemapIndexXml(all));
        write(path.join(out, "robots.txt"), robotsTxt([index, ...all]));
    }

    return result();
}

/**
 * A package's pages, from its site build.
 *
 * Each body is rendered by the `web` renderer from the markdown the build
 * expanded, and each page carries what it tells the search; see
 * {@link module:engine/site-search}. The site carries what the configuration
 * asks for: `site.tags` as `tagPages`, `site.feed` as the feed's section, each
 * package of `site.sitemaps` as its sitemap's address on the site's origin,
 * and each of `site.mergeIndexes` as the path of its search bundle.
 *
 * @param {object} options - The inputs.
 * @param {object} options.config - The resolved configuration.
 * @param {object} options.built - What `buildSite` returned with `write: false`.
 * @param {{baseURL: string, title: string, params: object}} options.settings -
 *   From {@link module:engine/site-config.siteSettings}.
 * @param {readonly {name: string, url: string, children?: object[]}[]} [options.navigation] -
 *   The menu.
 * @param {number} [options.year] - The year the footer states.
 * @returns {{site: object, pages: object[], pageOf: (entry: object) => object}}
 *   What {@link writeSite} is given, and how one note the build rendered again
 *   becomes its page.
 */
export function packageSite({ config, built, settings, navigation = [], year }) {
    const renderer = createRenderer("web", { icons: config.icons });
    const resolveSrc = (src) => resolvePathname(src, config)?.web ?? null;
    const { site: from } = built;
    const relative = (file) =>
        file ? path.relative(process.cwd(), file).split(path.sep).join("/") : undefined;
    const world = mapWorld({
        records: from.records,
        foreignIndex: from.foreign?.index ?? new Map(),
        contentBase: config.paths.content,
        base: from.base,
        config,
    });
    const geography = placeGeography(world.places);
    const search = (data) => searchMetadata(data, { geography, index: from.index });

    /** Each note `site.sections` names, by address, with the section it is the page of. */
    const sectionOf = new Map(
        Object.entries(config.site.sections).map(([name, address]) => [address, name]),
    );
    /**
     * A content page, from what the build made of its note: a section's page
     * for a note `site.sections` names, and a page of the feed's section for
     * a post.
     */
    const pageOf = ({ page, markdown, figures, data }) => {
        const section = sectionOf.get(page.slug);
        return {
            kind: section ? "section" : "page",
            title: text(data.title),
            url: page.url,
            section: section ?? (isPost(data) ? config.site.feed : ""),
            params: data,
            date: isPost(data) ? data.data?.date : undefined,
            weight: data.weight,
            content: renderer.render(markdown, { runs: from.runs, figures, resolveSrc }),
            source: relative(page.file),
            search: search(data),
        };
    };

    const pages = [];
    for (const home of from.homepages)
        pages.push({
            kind: "home",
            title: text(home.data.title),
            url: from.base,
            params: home.data,
            content: renderer.render(home.body, { runs: from.runs, resolveSrc }),
            source: relative(home.file),
            search: search(home.data),
        });
    for (const entry of from.pages) pages.push(pageOf(entry));

    const site = {
        title: settings.title,
        baseURL: settings.baseURL,
        params: { ...settings.params, search: config.site.search !== false },
        menu: navigation.map((entry) => ({
            name: entry.name,
            url: entry.url,
            children: (entry.children ?? []).map((child) => ({ name: child.name, url: child.url })),
        })),
        year,
        tagPages: config.site.tags,
        ...(config.site.feed ? { feed: { section: config.site.feed } } : {}),
        ...(config.site.sitemaps.length ?
            {
                sitemaps: config.site.sitemaps.map(
                    (pkg) => new URL(`/${pkg}/sitemap.xml`, settings.baseURL).href,
                ),
            }
        :   {}),
        ...(config.site.mergeIndexes.length ?
            { mergeIndexes: config.site.mergeIndexes.map((pkg) => `/${pkg}/pagefind/`) }
        :   {}),
    };
    return { site, pages, pageOf };
}

/**
 * The directory a package's site is written to: its base path under the
 * deployed root, so a site served at `/` is written at the root itself.
 *
 * @param {object} config - The resolved configuration.
 * @param {string} root - The deployed root.
 * @returns {string} The directory.
 */
export function siteDirectory(config, root) {
    return path.join(root, ...siteBase(config).split("/").filter(Boolean));
}

/**
 * Copy the script fonts the site's pages set their marked text in.
 *
 * @param {object} config - The resolved configuration.
 * @param {string} out - The directory the site is written to.
 * @returns {{findings: object[], count: number, dest?: string}} What checking
 *   the installed fonts found, and how many files were copied where. Nothing is
 *   copied when there is a finding, or when the package sets no script.
 */
export function deliverSiteFonts(config, out) {
    const found = scriptFontFiles(config, ["woff2"]);
    if (!found) return { findings: [], count: 0 };
    const findings = checkScriptFonts(config);
    if (findings.length) return { findings, count: 0 };
    const dest = path.join(out, siteFontsDestination(found.version));
    return { findings, count: copyScriptFonts(config, dest, ["woff2"]), dest };
}

/**
 * Build a package's site from its content tree and write it.
 *
 * The site's address, title and menu are read before the tree is, so a site
 * that cannot be described fails before anything is built. A gate that fires
 * stops the build before anything is written; a note in error is written as
 * its page shows it, with the finding in what is returned, which
 * `siteBuildFailed` reads.
 *
 * @param {object} options - The inputs.
 * @param {object} options.config - The resolved configuration.
 * @param {string} options.out - The directory the site is written to, which
 *   is the package's own directory under the deployed root.
 * @param {number} [options.year] - The year the footer states.
 * @returns {Promise<{built: object, written: object|null, fonts: object|null,
 *   site?: object, pages?: object[], pageOf?: (entry: object) => object}>}
 *   What the build found, and, when it found nothing that stops it, what was
 *   written, the pages it was written from and how a note rendered again
 *   becomes its page. `written` is `null` when a gate fired.
 * @throws {Error} When the site's settings or its cached menu cannot be read.
 */
export async function buildPackageSite({ config, out, year }) {
    const settings = siteSettings({ config });
    const navigation = readCachedNavigation(config);
    const sqlTables = await prepareTreeSqlTables(config.paths.content, {
        skipDirectories: config.skipDirectories,
        config,
        audience: "public",
    });
    const built = buildSite({ config, sqlTables, write: false });
    if (gatesFailed(built.gates)) return { built, written: null, fonts: null };
    const { site, pages, pageOf } = packageSite({ config, built, settings, navigation, year });
    const written = writeSite({ site, pages, out });
    const fonts = deliverSiteFonts(config, out);
    return { built, written, fonts, site, pages, pageOf };
}
