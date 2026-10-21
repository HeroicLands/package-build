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
 * **The site layouts.** {@link createSiteTheme} turns a page's data into a
 * complete HTML document through the Handlebars layouts in `site-theme/`.
 *
 * ## What a layout is given
 *
 * A page is the data of one note, or of one generated page, after the renderer
 * has made its body HTML:
 *
 * | Field | Meaning |
 * | ----- | ------- |
 * | `kind` | `home`, `page`, `section`, `taxonomy`, `term` or `404` |
 * | `title`, `url` | The page's title and its address under the site's base path |
 * | `params` | The note's frontmatter: `type`, `subType`, `category`, `description`, `banner`, `data`, `tags`, `date`, `series`, `package`, `infoboxes`, `related` |
 * | `content` | The body as HTML |
 * | `section` | A section page's name |
 * | `members` | A listing's pages: `{url, title, description, content, count}` |
 * | `siblings` | The pages beside this one, in the order a reader walks them: `{url, title, type, subType, category}` |
 * | `source` | The file the page was written in, named in a finding |
 * | `search` | What the page tells the site's search; see below |
 *
 * The site is its title, its `baseURL`, the `params` a consumer configures
 * (`description`, `cdnBaseURL`, `brand`, `home`, `notfound`, `search`,
 * `draftNotice`, `scriptFonts`), its `menu`, and `pages`, every regular page
 * as `{url, title, section, type, subType, date, content}`. `tagPages` says the site
 * writes a page for each tag, and `pageExists` answers whether a path inside
 * the site is published. `feed` is the site's Atom feed as `{title, url,
 * section}`, `section` being the one its posts are listed in, and
 * `mergeIndexes` the search bundles of other sites its search reads beside
 * its own.
 *
 * A page's `search` is what it tells the site's search: `filters` as
 * `{name, values}`, and the `names` a search weights. A page's `title` is its
 * result's title, its icon or banner the result's picture. A post — a `doc` of
 * `subType: post` — carries `author` and `tags` filters and sorts by its
 * `date`; its `author` is `data.author`, or the site's byline where it names
 * none.
 *
 * ## Which layout draws a page
 *
 * | Page | Layout |
 * | ---- | ------ |
 * | `kind` `home` | `home` |
 * | `kind` `404` | `not-found` |
 * | a post: `type: doc`, `subType: post` | `blog-post` |
 * | the section the feed lists | `blog-list` |
 * | any other listing | `list` |
 * | any other page | `page` |
 *
 * A page that names its `layout` is drawn by that one.
 *
 * ## Disappearing sections
 *
 * A section with nothing to show is not drawn: the decision is made where the
 * data is read, and the templates write a section only when its data is there.
 * `tests/helpers/empty-shells.ts` holds the check that proves it.
 *
 * ## Where the code stylesheet is
 *
 * {@link siteThemeAssets} lists the files a layout links that the theme
 * generates rather than ships.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import MarkdownIt from "markdown-it";

import { siteCodeStylesheet } from "./content-styles.mjs";
import { groupDictionaryLists } from "./dictionary-html.mjs";
import { bannerUrl, shippedBannerData } from "./site-theme-banner.mjs";
import { cdnUrl, relUrl, safeUrl, siteUrl, tagUrl, isAbsoluteUrl } from "./site-theme-urls.mjs";
import { isPost } from "./post-fields.mjs";

/** The directory the layouts and partials are read from. */
export const SITE_THEME_DIR = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "site-theme",
);

/** The layouts a page can be drawn by. */
export const LAYOUTS = Object.freeze([
    "base",
    "page",
    "home",
    "list",
    "blog-list",
    "blog-post",
    "not-found",
]);

/** The label each page type is grouped under in a related-pages block. */
const TYPE_LABELS = Object.freeze({
    affiliation: "Affiliations",
    being: "Beings",
    character: "People",
    continent: "Continents",
    creature: "Creatures",
    faith: "Faiths",
    language: "Languages",
    lore: "Lore",
    organization: "Organizations",
    page: "Pages",
    pantheon: "Pantheons",
    people: "Peoples",
    polity: "Polities",
    post: "Posts",
    "project-page": "Projects",
    region: "Regions",
    religion: "Religions",
    settlement: "Settlements",
    site: "Places",
    world: "Worlds",
});

/** The tag that marks a note as unfinished. */
const DRAFT_TAG = "draft";

/** The sentence a draft page states when the site supplies none. */
const DRAFT_NOTICE =
    "This entry is unfinished. What it states may change, and nothing in it is settled.";

/** The layouts of an infobox section, and the key each carries its content under. */
const SECTION_KEYS = Object.freeze({
    rows: "rows",
    grid: "cells",
    runin: "groups",
    list: "entries",
});

const { unescapeAll } = new MarkdownIt().utils;

/** @param {unknown} value */
const text = (value) => (value === undefined || value === null ? "" : String(value));

/** A string with its first letter capitalised and its separators read as spaces. */
export function humanize(value) {
    const spaced = text(value).replace(/[-_]+/g, " ").trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The text of HTML: tags dropped, character references decoded, whitespace collapsed. */
export function plainText(html) {
    const stripped = text(html).replace(/<[^>]*>/g, " ");
    return unescapeAll(stripped.replace(/\\/g, "\\\\")).replace(/\s+/g, " ").trim();
}

/** @param {unknown} value @returns {Date|undefined} */
function toDate(value) {
    if (value === undefined || value === null || value === "") return undefined;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

/** A date as `YYYY-MM-DD` and as `January 2, 2006`, in UTC. */
function dateParts(value) {
    const date = toDate(value);
    if (!date) return undefined;
    return {
        iso: date.toISOString().slice(0, 10),
        text: date.toLocaleDateString("en-US", {
            timeZone: "UTC",
            year: "numeric",
            month: "long",
            day: "numeric",
        }),
    };
}

/** Whether a page states it is a draft. */
export function isDraft(params = {}) {
    return (params.tags ?? []).some((tag) => text(tag).toLowerCase() === DRAFT_TAG);
}

/**
 * The subject tags of a page: every tag but the one that marks a draft.
 *
 * @param {object} params - The page's frontmatter.
 * @returns {string[]} The tags.
 */
export function subjectTags(params = {}) {
    return (params.tags ?? []).map(text).filter((tag) => tag.toLowerCase() !== DRAFT_TAG);
}

/**
 * The headings of rendered HTML that a contents list names.
 *
 * @param {string} html - A page's body.
 * @returns {Array<{level: number, id: string, text: string}>} The `h2` and `h3`
 *   headings in document order, the footnote list's own heading left out; `id`
 *   is empty for a heading that has none.
 */
export function pageHeadings(html) {
    const prose = text(html).replace(/<section class="footnotes">[^]*?<\/section>/gi, "");
    return [...prose.matchAll(/<h([23])\b([^>]*)>([^]*?)<\/h\1>/gi)].map((match) => ({
        level: Number(match[1]),
        id: /\bid\s*=\s*"([^"]*)"/i.exec(match[2])?.[1] ?? "",
        text: plainText(match[3]),
    }));
}

/** @param {string} value */
const escapeHtml = (value) =>
    text(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

/**
 * A contents list for a page's headings.
 *
 * @param {Array<{level: number, id: string, text: string}>} headings - From {@link pageHeadings}.
 * @returns {string} A `nav` of nested lists, or `""` when there are no headings. A
 *   heading with no id is listed without a link.
 */
export function tableOfContents(headings) {
    if (!headings.length) return "";
    const entry = (heading) =>
        heading.id ?
            `<a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a>`
        :   escapeHtml(heading.text);
    const lines = ['<nav id="TableOfContents">', "  <ul>"];
    let open = false;
    let nested = false;
    for (const heading of headings) {
        if (heading.level === 2 || !open) {
            if (nested) lines.push("      </ul>", "    </li>");
            else if (open) lines.push("    </li>");
            nested = false;
            lines.push(`    <li>${entry(heading)}`);
            open = true;
        } else {
            if (!nested) lines.push("      <ul>");
            nested = true;
            lines.push(`        <li>${entry(heading)}</li>`);
        }
    }
    if (nested) lines.push("      </ul>", "    </li>");
    else if (open) lines.push("    </li>");
    lines.push("  </ul>", "</nav>");
    return lines.join("\n");
}

/** How much more a page's name and aliases count in a search than a word of its body. */
const NAME_WEIGHT = 10;

/** The most `h2` headings a page may have before it gets a contents list. */
const TOC_THRESHOLD = 3;

/**
 * The page before and the page after this one.
 *
 * `siblings` is in the order a reader walks. Where the section holds more than
 * one catalog, the siblings are narrowed to the pages sharing this page's
 * catalog key: `type`, or for a `doc` its `subType` or `category`. A section
 * holding one catalog is left alone, as is a page declaring none.
 *
 * @param {object} page - The page.
 * @param {boolean} [narrow] - Whether to narrow to the page's catalog.
 * @returns {{prev?: object, next?: object}} The neighbours; `prev` is the entry
 *   after this one in `siblings`, and `next` the entry before it.
 */
export function neighbours(page, narrow = true) {
    const siblings = page.siblings ?? [];
    const keyOf = (item) => {
        const type = item.type ?? "";
        return type === "doc" ? (item.subType ?? item.category ?? "") : type;
    };
    const own = {
        type: page.params?.type,
        subType: page.params?.subType,
        category: page.params?.category,
    };
    const key = keyOf(own);
    let list = siblings;
    if (narrow && key) {
        const matching = siblings.filter((item) => keyOf(item) === key);
        const mixed = siblings.some((item) => keyOf(item) !== key && keyOf(item) !== "");
        if (mixed) list = matching;
    }
    const index = list.findIndex((item) => item.url === page.url);
    if (index < 0) return {};
    return { prev: list[index + 1], next: list[index - 1] };
}

/** Whether a string has anything other than whitespace in it. */
const present = (value) => text(value).trim() !== "";

/**
 * @typedef {object} Finding
 * @property {"warning"|"error"} severity
 * @property {string} message
 * @property {string} [page] - The address of the page the finding is about.
 * @property {string} [file] - The file the page was written in.
 * @property {Array<string|number>} [param] - The path of the site parameter
 *   the finding is about, such as `["notfound", "links", 1, "url"]`.
 */

/**
 * Create the layouts for one site.
 *
 * @param {object} options - The inputs.
 * @param {object} options.site - The site; see the module description.
 * @param {string} [options.dir] - The directory holding `layouts/` and
 *   `partials/`. The shipped theme by default.
 * @param {{banners: object, kinds: object}} [options.bannerData] - The banner
 *   inventory and kind mapping. The shipped ones by default.
 * @param {(finding: Finding) => void} [options.report] - Receives each finding
 *   as it is made. Every finding is also kept in `findings`.
 * @returns {{
 *   render: (page: object) => string,
 *   layoutFor: (page: object) => string,
 *   partial: (name: string, context?: object) => string,
 *   findings: Finding[],
 * }} The theme.
 */
export function createSiteTheme({ site, dir = SITE_THEME_DIR, bannerData, report }) {
    const hb = Handlebars.create();
    const findings = [];
    const reportedBanners = new Set();
    const emit = (finding, page) => {
        const made = { ...finding };
        if (page?.source) made.file = page.source;
        findings.push(made);
        report?.(made);
    };

    hb.registerHelper("cssUrl", (value) =>
        text(value).replace(/[\s'"()\\]/g, (char) => encodeURIComponent(char)),
    );
    hb.registerHelper("safeUrl", (value) => safeUrl(value));
    // JSON a `<script>` can hold: nothing in it closes the element.
    hb.registerHelper(
        "json",
        (value) =>
            new Handlebars.SafeString(
                JSON.stringify(value ?? null)
                    .replace(/</g, "\\u003c")
                    .replace(/\u2028/g, "\\u2028")
                    .replace(/\u2029/g, "\\u2029"),
            ),
    );

    const read = (folder) => {
        const base = path.join(dir, folder);
        return fs
            .readdirSync(base)
            .filter((file) => file.endsWith(".hbs"))
            .sort()
            .map((file) => [file.slice(0, -4), fs.readFileSync(path.join(base, file), "utf8")]);
    };
    // A partial ends where its last tag does, so one used inside a line adds no break.
    for (const [name, source] of read("partials"))
        hb.registerPartial(name, source.replace(/\n$/, ""));
    const compiled = Object.fromEntries(
        read("layouts").map(([name, source]) => [name, hb.compile(source)]),
    );

    const params = site.params ?? {};
    const banners = bannerData ?? shippedBannerData();

    const banner = (page, fields) =>
        bannerUrl(site, fields, {
            data: banners,
            reported: reportedBanners,
            report: (finding) => emit(finding, page),
        });

    /** The chrome every page shares. */
    const chrome = (page) => {
        const menu = (site.menu ?? []).map((item) => ({
            name: item.name,
            url: safeUrl(item.url),
            active: Boolean(item.active) || (page.permalink && item.url === page.permalink),
            children: (item.children ?? []).map((child) => ({
                name: child.name,
                url: safeUrl(child.url),
            })),
            hasChildren: (item.children ?? []).length > 0,
        }));
        const brand = params.brand ?? {};
        return {
            title: site.title,
            homeUrl: relUrl(site, ""),
            menu,
            hasMenu: menu.length > 0,
            search: Boolean(params.search),
            searchOptions: {
                element: "#search",
                showSubResults: true,
                showImages: true,
                ...(site.mergeIndexes?.length ?
                    { mergeIndex: site.mergeIndexes.map((bundlePath) => ({ bundlePath })) }
                :   {}),
            },
            feed:
                site.feed ?
                    { title: text(site.feed.title), url: safeUrl(site.feed.url) }
                :   undefined,
            hasActions: menu.length > 0 || Boolean(params.search),
            brand: {
                logoUrl: brand.logo ? cdnUrl(site, brand.logo) : "",
                licenseUrl: brand.licenseURL ? safeUrl(brand.licenseURL) : "",
                discordUrl: brand.discordURL ? safeUrl(brand.discordURL) : "",
            },
            year: site.year ?? new Date().getFullYear(),
            urls: {
                style: relUrl(site, "css/style.css"),
                icons: relUrl(site, "css/sohl-icons.css"),
                code: relUrl(site, "css/code.css"),
                scriptFonts: params.scriptFonts ? relUrl(site, params.scriptFonts) : "",
                pagefindCss: relUrl(site, "pagefind/pagefind-ui.css"),
                pagefindJs: relUrl(site, "pagefind/pagefind-ui.js"),
                spoilers: relUrl(site, "js/inline-spoilers.js"),
            },
        };
    };

    /** The hero band of a page. */
    const heroOf = (page) => {
        const frontmatter = page.params ?? {};
        const type = frontmatter.type ?? "";
        const url = banner(page, {
            data: frontmatter.data,
            banner: frontmatter.banner,
            type,
            subType: frontmatter.subType,
            category: frontmatter.category,
            subtype: type === "" ? "default" : "",
            context: page.url,
        });
        const title = text(page.title);
        const tagline = text(frontmatter.description);
        if (!title && !tagline && !url) return undefined;
        return { bannerUrl: url, title, tagline };
    };

    /** One infobox entry. */
    const entryOf = (entry) => ({
        lead: text(entry?.lead),
        text: text(entry?.text),
        url: entry?.url ? safeUrl(entry.url) : "",
    });

    /** The value of one row, by its kind. */
    const valueOf = (row) => {
        const kind = row.kind || "text";
        if (kind === "link") return { isLink: true, entry: entryOf(row.value) };
        if (kind === "links") return { isLinks: true, entries: (row.value ?? []).map(entryOf) };
        if (kind === "list") return { text: (row.value ?? []).join(", ") };
        if (kind === "number") {
            const digits = text(row.value);
            return {
                text:
                    /^-?[0-9]+$/.test(digits) ?
                        new Intl.NumberFormat("en-US").format(Number(digits))
                    :   digits,
            };
        }
        return { text: text(row.value) };
    };

    /** One infobox section, or `undefined` when it holds nothing to draw. */
    const sectionOf = (section, page) => {
        const layout = section.layout ?? "";
        const key = SECTION_KEYS[layout];
        if (!key) {
            emit(
                {
                    severity: "warning",
                    page: page.url,
                    message:
                        `infobox: section layout "${layout}" is not one of rows, grid, runin or ` +
                        "list, so the section is not drawn.",
                },
                page,
            );
            return undefined;
        }
        const items = section[key];
        if (!Array.isArray(items) || !items.length) return undefined;
        const view = {
            id: text(section.id),
            label: text(section.label),
            [layout]: true,
        };
        if (layout === "rows") {
            view.rows = items
                .map((row) => ({ label: text(row.label), ...valueOf(row) }))
                .filter((row) => row.isLink || row.isLinks || present(row.text));
            if (!view.rows.length) return undefined;
        } else if (layout === "grid") {
            view.cells = items.map((cell) => ({
                label: text(cell.label),
                value: text(cell.value),
            }));
        } else if (layout === "runin") {
            view.groups = items
                .filter((group) => (group.entries ?? []).length)
                .map((group) => ({
                    label: text(group.label),
                    entries: group.entries.map(entryOf),
                }));
            if (!view.groups.length) return undefined;
        } else {
            view.entries = items.map(entryOf);
        }
        return view;
    };

    /** The boxes a page declares, with the sections that hold something. */
    const infoboxesOf = (page) => {
        const boxes = [];
        for (const box of page.params?.infoboxes ?? []) {
            const sections = (box.sections ?? [])
                .map((section) => sectionOf(section, page))
                .filter(Boolean);
            const statement = text(box.statement);
            if (!sections.length && !(box.kind === "system" && statement)) continue;
            boxes.push({
                id: text(box.id),
                title: text(box.title),
                statement: box.kind === "system" ? statement : "",
                sections: box.kind === "system" && statement ? [] : sections,
            });
        }
        return boxes;
    };

    /** The related-pages block, or `undefined` when there is nothing in it. */
    const relatedOf = (page) => {
        const related = page.params?.related ?? {};
        const seen = new Set();
        const deliberate = [];
        const merged = [];
        for (const ref of related.seeAlso ?? []) {
            if (seen.has(ref.url)) continue;
            seen.add(ref.url);
            deliberate.push({
                url: safeUrl(ref.url),
                title: text(ref.title),
                gloss: text(ref.gloss),
            });
        }
        for (const ref of [...(related.mentions ?? []), ...(related.backlinks ?? [])]) {
            if (seen.has(ref.url)) continue;
            seen.add(ref.url);
            merged.push(ref);
        }
        const groups = new Map();
        for (const ref of merged) {
            const type = isPost(ref) ? "post" : ref.type || "page";
            if (!groups.has(type)) groups.set(type, []);
            groups.get(type).push({ url: safeUrl(ref.url), title: text(ref.title) });
        }
        const rows = [...groups].map(([type, refs]) => ({
            label: TYPE_LABELS[type] ?? humanize(type),
            refs,
        }));
        rows.sort((a, b) =>
            a.label < b.label ? -1
            : a.label > b.label ? 1
            : 0,
        );
        if (!rows.length && !deliberate.length) return undefined;
        return { seeAlso: deliberate, groups: rows };
    };

    /** The tag chips of a page. */
    const tagsOf = (page) => {
        const items = subjectTags(page.params).map((name) => ({
            name,
            url: site.tagPages ? tagUrl(site, name) : "",
        }));
        return items.length ? { items } : undefined;
    };

    /** The prev/next links of a page. */
    const navOf = (page, narrow) => {
        const { prev, next } = neighbours(page, narrow);
        if (!prev && !next) return undefined;
        const link = (item) => item && { url: safeUrl(item.url), title: text(item.title) };
        return { prev: link(prev), next: link(next) };
    };

    /**
     * What a page tells the search: its title, filters and weighted names,
     * and its icon or banner as the result's picture.
     */
    const searchOf = (page, hero, extra = {}) => {
        const frontmatter = page.params ?? {};
        const search = page.search ?? {};
        const icon = frontmatter.data?.icon;
        const image =
            (typeof icon === "string" && icon ? cdnUrl(site, icon) : "") || hero?.bannerUrl;
        const names = (search.names ?? []).map(text).filter(present);
        return {
            title: text(page.title),
            filters: [...(search.filters ?? []), ...(extra.filters ?? [])]
                .map((filter) => ({
                    name: text(filter.name),
                    values: (filter.values ?? []).map(text).filter(present),
                }))
                .filter((filter) => filter.name && filter.values.length),
            aliases: names.slice(1).join(", "),
            names: names.join(" "),
            weight: NAME_WEIGHT,
            image: image ? safeUrl(image) : "",
            date: extra.date ?? "",
        };
    };

    /** The article of a note's page: the rail, the prose and the links around them. */
    const articleOf = (page, hero) => {
        const frontmatter = page.params ?? {};
        const content = groupDictionaryLists(page.content);
        const boxes = infoboxesOf(page);
        const headings = pageHeadings(content);
        const hasToc = headings.filter((heading) => heading.level === 2).length > TOC_THRESHOLD;
        const hasSidebar = boxes.length > 0;
        const draft = isDraft(frontmatter);
        const date = dateParts(frontmatter.date ?? page.date);
        const tags = tagsOf(page);
        const subtype =
            frontmatter.type === "being" && frontmatter.subType ?
                frontmatter.subType === "npc" ?
                    "NPC"
                :   humanize(frontmatter.subType)
            :   "";
        const hasBody = present(content);
        const related = relatedOf(page);
        const nav = navOf(page, true);
        if (!hasBody && !hasSidebar && !date && !tags && !subtype && !related && !nav && !draft)
            return undefined;
        return {
            articleClass:
                "single" +
                (hasSidebar ? " single-with-sidebar"
                : hasToc ? " single-with-toc"
                : "") +
                (draft ? " single-with-notice" : ""),
            isDraft: draft,
            notice: text(params.draftNotice) || DRAFT_NOTICE,
            search: searchOf(page, hero),
            boxes,
            hasSidebar,
            toc: hasToc ? tableOfContents(headings) : "",
            tocBeside: hasToc && hasSidebar,
            tocBelow: hasToc && !hasSidebar,
            meta: date || tags || subtype ? { date, subtype, tags } : undefined,
            content,
            hasBody,
            hasMain: Boolean(date || tags || subtype || hasBody || related || nav),
            related,
            nav,
        };
    };

    /** The members of a listing that no page already reached is linked from. */
    const unlistedMembers = (page) => {
        const members = page.members ?? [];
        if (page.kind !== "section" || !present(page.content)) return members;
        let haystack = page.content;
        const reached = new Set();
        let growing = true;
        for (let pass = 0; pass < 12 && growing; pass++) {
            growing = false;
            for (const member of members) {
                if (reached.has(member.url)) continue;
                if (haystack.includes(`href="${member.url}`)) {
                    reached.add(member.url);
                    haystack += text(member.content);
                    growing = true;
                }
            }
        }
        return members.filter((member) => !reached.has(member.url));
    };

    /** A page of links. */
    const listOf = (items) => (items.length ? { items } : undefined);

    const views = {
        page: (page) => {
            const hero = heroOf(page);
            return { hero, article: articleOf(page, hero) };
        },

        home: (page) => {
            const frontmatter = page.params ?? {};
            if ((frontmatter.type ?? "") === "homepage")
                return { ...views.page(page), isHomepage: true };
            const home = params.home;
            if (!home) {
                emit(
                    {
                        severity: "warning",
                        page: page.url,
                        message:
                            "the home page is not a `type: homepage` note and the site configures " +
                            "no `home`, so there is nothing to draw",
                    },
                    page,
                );
                return {};
            }
            const heading = (item) => ({ title: text(item.title), class: text(item.class) });
            const card = (item) => ({
                title: text(item.title),
                url: safeUrl(item.url),
                text: text(item.text),
                key: text(item.key),
                imageUrl: item.image ? cdnUrl(site, item.image) : "",
                alt: text(item.alt) || text(item.title),
            });
            const headings = (home.headings ?? []).map(heading);
            const cards = (home.cards ?? []).map(card);
            return {
                grid: {
                    hero:
                        present(home.herotitle) || home.heroimage ?
                            {
                                bannerUrl: home.heroimage ? cdnUrl(site, home.heroimage) : "",
                                title: text(home.herotitle),
                                tagline: text(home.herotagline),
                            }
                        :   undefined,
                    headings,
                    cards,
                    hasItems: headings.length > 0 || cards.length > 0,
                },
            };
        },

        list: (page) => {
            const unlisted = unlistedMembers(page);
            const labelled = page.kind === "section" && present(page.content);
            const taxonomy = page.kind === "taxonomy";
            const items = unlisted.map((member) => ({
                url: safeUrl(member.url),
                title: text(member.title),
                text: taxonomy ? "" : text(member.description),
                count: taxonomy ? String(member.count ?? 0) : "",
            }));
            const body = present(page.content) ? groupDictionaryLists(page.content) : "";
            const empty = !items.length && !labelled;
            return {
                hero: heroOf(page),
                body,
                hasBody: body !== "",
                listing: listOf(items),
                heading: items.length && labelled && !taxonomy ? "Orphaned Pages" : "",
                empty,
                hasMembers: items.length > 0 || empty,
            };
        },

        "blog-list": (page) => {
            const posts = (site.pages ?? [])
                .filter((entry) => entry.section === page.section && isPost(entry))
                .sort((a, b) => {
                    const left = toDate(a.date)?.getTime() ?? 0;
                    const right = toDate(b.date)?.getTime() ?? 0;
                    return right - left;
                });
            const items = posts.map((post) => {
                const words = plainText(post.content).split(" ").filter(Boolean);
                const preview =
                    words.length > 100 ? `${words.slice(0, 100).join(" ")}…` : words.join(" ");
                return {
                    url: safeUrl(post.url),
                    title: text(post.title),
                    date: dateParts(post.date),
                    preview,
                };
            });
            return {
                hero: heroOf(page),
                body: present(page.content) ? groupDictionaryLists(page.content) : "",
                posts: items.length ? items : undefined,
                empty: !items.length,
            };
        },

        "blog-post": (page) => {
            const frontmatter = page.params ?? {};
            const date = dateParts(frontmatter.date ?? page.date);
            const tags = tagsOf(page);
            const series = text(frontmatter.series);
            const content = present(page.content) ? groupDictionaryLists(page.content) : "";
            const meta = date || tags || series ? { series, date, tags } : undefined;
            const related = relatedOf(page);
            const nav = navOf(page, false);
            const hero = heroOf(page);
            const author = text(frontmatter.data?.author) || text(params.author);
            const search = searchOf(page, hero, {
                filters: [
                    { name: "author", values: author ? [author] : [] },
                    { name: "tags", values: subjectTags(frontmatter) },
                ],
                date: date?.iso,
            });
            return {
                hero,
                article:
                    meta || content || related || nav ?
                        { meta, content, related, nav, search }
                    :   undefined,
            };
        },

        "not-found": () => {
            const notfound = params.notfound ?? {};
            const hero = cdnUrl(site, notfound.heroimage || "images/banners/default.webp");
            const links = [];
            let skipped = 0;
            for (const link of notfound.links ?? []) {
                const internal = !isAbsoluteUrl(link.url);
                const url = siteUrl(site, link.url);
                if (internal && site.pageExists && !site.pageExists(url)) {
                    emit({
                        severity: "warning",
                        page: relUrl(site, "404.html"),
                        param: ["notfound", "links", links.length + skipped, "url"],
                        message: `the page-not-found links to ${url}, which the site does not publish, so the link is left out`,
                    });
                    skipped++;
                    continue;
                }
                links.push({ url: safeUrl(url), title: text(link.title), text: text(link.text) });
            }
            return {
                heroUrl: hero,
                tagline: text(notfound.tagline) || "This site has no page at",
                noun: text(notfound.sitenoun) || "site",
                links: listOf(links),
            };
        },
    };

    /**
     * Which layout draws a page.
     *
     * @param {object} page - The page.
     * @returns {string} A name from {@link LAYOUTS}.
     */
    const layoutFor = (page) => {
        if (page.layout) return page.layout;
        if (page.kind === "home") return "home";
        if (page.kind === "404") return "not-found";
        if (page.kind === "section" && site.feed?.section && page.section === site.feed.section)
            return "blog-list";
        if (["section", "taxonomy", "term"].includes(page.kind)) return "list";
        if (isPost(page.params)) return "blog-post";
        return "page";
    };

    /**
     * Draw a page as a complete document.
     *
     * @param {object} page - The page; see the module description.
     * @returns {string} The HTML.
     */
    const render = (page) => {
        const name = layoutFor(page);
        const layout = compiled[name];
        if (!layout) throw new Error(`the site theme has no layout named "${name}"`);
        const view = views[name](page);
        const isHome = page.kind === "home";
        const common = chrome(page);
        const body = layout({ ...view, site: common });
        const description = text(page.params?.description) || text(params.description);
        return compiled.base({
            site: common,
            head: {
                title: isHome ? text(site.title) : `${text(page.title)} — ${text(site.title)}`,
                description,
            },
            body,
        });
    };

    /**
     * Draw one partial on its own, such as the copyable address a note can hold.
     *
     * @param {string} name - The partial's file name without its extension.
     * @param {object} [context] - What the partial is given.
     * @returns {string} The HTML.
     * @throws {Error} When the theme has no partial of that name.
     */
    const partial = (name, context = {}) => {
        const source = hb.partials[name];
        if (source === undefined) throw new Error(`the site theme has no partial named "${name}"`);
        return hb.compile(source)(context);
    };

    return { render, layoutFor, partial, findings };
}

/**
 * The files the layouts link that the theme generates.
 *
 * @returns {Array<{path: string, content: string}>} Each file's path under the
 *   site and its contents.
 */
export function siteThemeAssets() {
    return [{ path: "css/code.css", content: siteCodeStylesheet() }];
}
