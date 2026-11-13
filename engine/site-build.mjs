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
 * Publishing a content tree as a website.
 *
 * Compiling a content tree into compendium packs is `package-build package
 * compile`. Publishing the *same tree* as a website was a script each consumer
 * wrote for itself — 473 code lines in `sohl` and 462 in `sohl-thalorna`, 87 of
 * them identical — and the copies drifted in ways neither repository could see.
 * `sohl-thalorna` reimplemented four things this package already exported, not
 * because it needed different behaviour but because its script predates the
 * extraction. That is the failure a command removes: a consumer cannot
 * accidentally reimplement one.
 *
 * **What is here is the pass, not the framing.** The walk, the frontmatter read,
 * the address derivation, the address index, table expansion, wikilink
 * resolution, code-fence protection, the foreign-manifest merge and the page
 * emission are the same job everywhere. Where a page's address comes from
 * (`publish.address`) and what a repository's own rewrites are, are not — they
 * arrive as configuration and as a **named** pass bundle, since a configuration
 * is data and cannot hold a function.
 *
 * **A site is its homepage and its pages.** The homepage is the mount's
 * `_index.md`, rendered at `/<package>/`; every other note is one page at
 * `/<package>/<type>-<shortcode>/`. Nothing is generated between them — no
 * section directory, no listing, no `_index.md` but the root's. An index of
 * what the package publishes is a `doc` note carrying a content table, and it
 * is authored where every other page is. Every page is one file; the map from a
 * place is set inline in its **From here** section — see
 * `engine/site-maps.mjs`.
 *
 * **Every gate reports; none exits.** The integrity checks a site build needs —
 * a wikilink authored in frontmatter, a name that yields no slug, an unusable
 * or unaddressable foreign manifest, a table directive that cannot be
 * honoured, a dead wikilink — were inline `process.exit` calls in both
 * scripts, with no test between them. Here each returns its findings and the
 * command decides. That is the rule `engine/site-index.mjs` already follows,
 * and it is the only reason these cases can be tested at all.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { addressSlug } from "./content-address.mjs";
import { eventNoteIndex } from "./event-fields.mjs";
import { expandContentTables } from "./content-tables.mjs";
import { runContext } from "./content-scripts.mjs";
import { scanFigures } from "./content-figures.mjs";
import { resolvePathname } from "./pathnames.mjs";
import { buildSiteIndex, figureIndexKeys, resolveInfoboxRef } from "./site-index.mjs";
import { loadForeignIndexes, noContentIndexPackages } from "./metadata-index.mjs";
import { formatUnaddressableFinding, unaddressableForeignPackages } from "./metadata-index.mjs";
import { loadPackConfig } from "./pack-config.mjs";
import { searchableFrontmatter } from "./note-package.mjs";
// The corpus, from the one pass that derives it.
import { indexRecordsFor, publicationIndexRecordsFor } from "./content-index.mjs";
import { normalizeCurrentDate } from "./current-date.mjs";
import { reckoningContext } from "./reckoning-markers.mjs";
import { isNoteRecord, noteFile } from "./index-records.mjs";
import { isGmNote } from "./note-vocabulary.mjs";
import { artPathname, assetAddressIndex } from "./art-fields.mjs";
import { embedRole } from "./content-embeds.mjs";
import { checkHomepageCount, homepageFrontmatter, homepageTitle, isHomepage } from "./homepage.mjs";
import { publishesContentPages, siteBase } from "../content-config.mjs";
import { seeAlsoPages } from "./see-also.mjs";
import { homepageLinkTargets, relatedPages } from "./related-pages.mjs";
import { drawSiteMaps } from "./site-maps.mjs";
// One page's render, shared with the single-note render of `./note-page`.
// A being's computed `age` is applied there — see `engine/being-age.mjs`;
// `pdf-build.mjs` reuses `collectContentPages`'s pages, so it reaches the book too.
import {
    contentPage,
    isPlainObject,
    pageFrontmatter,
    pageTitle,
    parseNote,
    renderSitePage,
    resolveArtFields,
    resolveSitePass,
    sitePageDecorator,
} from "./site-page.mjs";

export { pageFrontmatter, renderSitePage, resolveSitePass, sitePageDecorator };

/**
 * The content-tree files this build publishes from, in the order it emits them.
 *
 * **The corpus comes from the content index** — the same derivation the
 * packs are compiled from — so the site and the packs cannot disagree about
 * which files are the content. The note is still read for its `{fm, body}`: the
 * index carries no note text, and a page *is* its text.
 *
 * **Records are in content-path order**, and nothing downstream depends on
 * it: each page is emitted to its own file at an address derived from its
 * frontmatter, and a content table orders what it lists by its own clause.
 * A content-path order is a fact about the content, where directory-read
 * order is a fact about the filesystem and can differ between two checkouts
 * of one tree.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} ctx - The build context. `ctx.records` is the corpus when the
 *   caller already derived it — the site build derives one and hands it to both
 *   collectors, so the two cannot disagree.
 * @returns {string[]} Absolute paths, in emission order.
 */
function siteCorpusFiles(contentBase, ctx) {
    const records =
        ctx.records ??
        indexRecordsFor({
            contentBase,
            config: ctx.config,
            skipDirectories: ctx.skipDirectories,
        });
    return records.filter(isNoteRecord).map((record) => noteFile(contentBase, record));
}

/**
 * Reads a note, returning `null` for one that cannot be parsed.
 *
 * A file that is not front-mattered markdown is skipped rather than reported: a
 * content tree may contain editor or working files, and failing on one would
 * make the build depend on unrelated local files.
 *
 * @param {string} file - Absolute path.
 * @returns {{fm: object, body: string}|null}
 */
function readNote(file, ctx) {
    let source;
    try {
        source = fs.readFileSync(file, "utf8");
    } catch {
        return null;
    }
    return parseNote(source, file, ctx);
}

/**
 * The content tree's pages, and what could not be addressed.
 *
 * @param {string} contentBase - Absolute path to the content tree.
 * @param {object} ctx - `{ packages, contentPackage, skipDirectories, base,
 *   mount, scheme, only }`. `contentPackage` is the package a note that
 *   declares none belongs to; `base` is where the package is served and `mount`
 *   is where its content tree sits inside it. `only`, an absolute path, reads
 *   that one note and no other.
 * @returns {{pages: object[], addressFindings: object[], fmLinkFindings: object[]}}
 */
export function collectContentPages(contentBase, ctx) {
    // Where an addressed page publishes. A missing `base` would put *every*
    // page at `undefined/` rather than one, and it is the caller's contract
    // rather than a note's defect, so it throws instead of being collected as a
    // finding.
    if (typeof ctx.base !== "string" || !ctx.base) {
        throw new TypeError(
            "collectContentPages: `ctx.base` must be a non-empty string — it is the package address every page's URL is built on",
        );
    }
    const pages = [];
    const addressFindings = [];
    const fmLinkFindings = [];

    // Site and PDF pages use the setting date alongside shared calendar context.
    const records =
        ctx.records ??
        indexRecordsFor({
            contentBase,
            config: ctx.config,
            skipDirectories: ctx.skipDirectories,
        });
    const present = normalizeCurrentDate(ctx.config?.currentDate);
    const dates = reckoningContext({ notes: records });

    for (const file of siteCorpusFiles(contentBase, ctx)) {
        if (ctx.only && file !== ctx.only) continue;
        const note = readNote(file, ctx);
        if (!note) continue;
        const made = contentPage(note, {
            ...ctx,
            file,
            fileBase: path.basename(file),
            relPath: path.relative(contentBase, file).split(path.sep).join("/"),
            folder: path.basename(path.dirname(file)),
            present,
            dates,
        });
        if (!made) continue;
        fmLinkFindings.push(...made.fmLinks);
        if (made.addressFinding) addressFindings.push(made.addressFinding);
        else pages.push(made.page);
    }
    return { pages, addressFindings, fmLinkFindings };
}

/**
 * Each section `site.sections` names whose page no note in the tree is.
 *
 * The finding names the configuration key rather than a note, since it is the
 * key that has to change; the command locates it in the configuration file.
 *
 * @param {Readonly<Record<string, string>>} sections - `site.sections`.
 * @param {readonly {slug: string}[]} pages - The content pages.
 * @returns {Array<{param: string[], severity: "error", message: string}>} The findings.
 */
function unmatchedSectionPages(sections, pages) {
    const addresses = new Set(pages.map((page) => page.slug));
    return Object.entries(sections)
        .filter(([, address]) => !addresses.has(address))
        .map(([name, address]) => ({
            param: ["sections", name],
            severity: "error",
            message:
                `\`site.sections.${name}\` is \`${address}\`, and no note in the content ` +
                `tree has that address, so the section has no page to publish at ` +
                `\`/${name}/\``,
        }));
}

/**
 * The package's homepage notes — the authored page at `/<contentPackage>/`.
 *
 * A separate collection from {@link collectContentPages} keeps the homepage
 * at the package root and leaves content pages at their note addresses.
 *
 * Returned as a list rather than as the one note there should be, because the
 * count is what {@link checkHomepageCount} judges — this walk reports
 * what it found, and {@link buildSite} decides whether that is one.
 *
 * A homepage that declares no `shortcode` has no address, and is
 * reported rather than written: it is the same finding a content page's missing
 * shortcode produces, and it is reported even when the tree has no other notes.
 *
 * **It is still counted.** An unaddressable homepage is a homepage — dropping
 * it from the list would make {@link checkHomepageCount} report a tree with one
 * as having none, sending its author to write a second front page instead of a
 * line of frontmatter.
 *
 * @param {string} contentBase - Absolute path to the content tree.
 * @param {object} ctx - `{ skipDirectories }`.
 * @returns {{pages: object[], addressFindings: object[]}} The homepage notes,
 *   in walk order, and the ones among them that could not be addressed.
 */
export function collectHomepages(contentBase, ctx) {
    const pages = [];
    const addressFindings = [];
    for (const file of siteCorpusFiles(contentBase, ctx)) {
        const note = readNote(file, ctx);
        if (!note || !isHomepage(note.fm)) continue;
        if (isGmNote(note.fm)) {
            addressFindings.push({ file, reason: "a GM-tagged homepage cannot publish publicly" });
            continue;
        }
        try {
            addressSlug(note.fm);
        } catch (err) {
            addressFindings.push({ file, reason: err.message });
        }
        pages.push({ kind: "homepage", file, fm: note.fm, body: note.body });
    }
    return { pages, addressFindings };
}

/**
 * Each homepage's frontmatter as its page publishes it, and its body.
 *
 * @param {readonly object[]} pages - From {@link collectHomepages}.
 * @param {object} config - The resolved configuration.
 * @param {object} [options] - Options.
 * @param {import("./related-pages.mjs").Related} [options.related] - The
 *   homepage's backlinks and mentions. Absent where nothing connects to it,
 *   and when the tree contains only a homepage, where no content link resolves.
 * @param {readonly object[]} [options.records] - The corpus, so a `data.banner`
 *   address resolves against the images this package ships.
 * @param {object} [options.foreign] - The dependencies' vendored indexes, so a
 *   `data.banner` may name an image a dependency ships.
 * @returns {Array<{file: string, body: string, data: object}>} One entry per
 *   homepage, in walk order.
 */
export function homepageData(pages, config, { related, records, foreign } = {}) {
    const artIndex = assetAddressIndex(records ?? [], { config, foreign });
    // A pathname no asset host serves resolves to `null`, which the theme reads
    // as an unset banner rather than as a URL to nowhere.
    const webSrc = (src) => resolvePathname(src, config)?.web ?? null;
    const artSrc = (value, type, accepts) => artPathname(artIndex, value, type, accepts).pathname;
    return pages.map((page) => {
        const data = homepageFrontmatter(page.fm, {
            contentPackage: config.contentPackage,
            title: homepageTitle(page.fm, config),
            related,
        });
        if (isPlainObject(data.data)) data.data = { ...data.data };
        resolveArtFields(data, webSrc, artSrc);
        return { file: page.file, body: page.body, data };
    });
}

/**
 * The integrity gates a site build runs before it writes anything.
 *
 * Every one of these was an inline `process.exit` in both consumer scripts, so
 * none of them had a test. They are grouped here, reporting rather than exiting,
 * because the order matters and the reasons are worth stating once:
 *
 * - **Frontmatter wikilinks** first, because frontmatter is copied to the page
 *   verbatim and a link written in one reaches the reader as literal `[[…]]`.
 * - **Addresses** next: a note that has no address — no shortcode to be
 *   addressed by — would silently drop a page.
 *   There is no collision gate beside it: an address is `(type, shortcode)`,
 *   which is unique within a package by rule, so two pages cannot claim one URL.
 * - **Foreign manifests** last, in two steps. *Unusable* is a file this build
 *   cannot read; *unaddressable* is one it can read but cannot look anything up
 *   in — a distinction worth keeping, because the second surfaces as a pile of
 *   dead links blaming the notes that cite them rather than the file at fault.
 *
 * @param {object[]} pages - Every page, from both walks.
 * @param {object} findings - `{ addressFindings, fmLinkFindings }` from
 *   collection.
 * @param {object} options
 * @param {object} options.config - The resolved build configuration.
 * @param {object[]} options.records - Content-index records.
 * @param {Map<string, object[]>} [options.sqlTables] - Prepared directives,
 *   whose emitted anchors belong to the pages they expand in.
 * @returns {object} The gate results and, when they pass, the built index.
 */
export function siteGates(pages, findings, { config, records, sqlTables }) {
    const out = {
        // Always empty here: the homepage count is decided in `buildSite`
        // before the content walk, and a failing count returns without ever
        // reaching these gates. Present so every caller reads one shape.
        homepages: [],
        frontmatterLinks: findings.fmLinkFindings ?? [],
        addressErrors: findings.addressFindings ?? [],
        sections: findings.sectionFindings ?? [],
        staleManifests: [],
        unaddressable: [],
        index: null,
        foreign: null,
        manifests: null,
    };
    if (out.frontmatterLinks.length || out.addressErrors.length || out.sections.length) return out;

    const content = pages.filter((p) => p.kind === "content");
    // Which packages are *local* is what decides which manifests are foreign,
    // and that is only known once the tree is walked — reading it from a
    // configured list instead silently discarded the manifest of any package
    // the list named but the tree did not contain.
    const localPackages = new Set(content.map((p) => p.pkg));
    const foreign = loadForeignIndexes(config, localPackages);
    out.foreign = foreign;
    if (foreign.stale.length) {
        out.staleManifests = foreign.stale;
        return out;
    }

    out.unaddressable = unaddressableForeignPackages(foreign.index);
    if (out.unaddressable.length) return out;

    const expanded =
        sqlTables ?
            pages.map((page) => ({
                ...page,
                body: expandContentTables(page.body ?? "", {
                    source: page.file,
                    sqlTables: sqlTables.get(page.file),
                    pageLists: sqlTables.pageLists?.get(page.file),
                }).markdown,
            }))
        :   pages;
    out.index = buildSiteIndex(expanded, {
        config,
        package: config.contentPackage,
        currentDate: config.currentDate,
        foreignIndex: foreign.index,
        foreignReferences: foreign.references,
        records,
        noIndexPackages: noContentIndexPackages(config),
    });
    return out;
}

/**
 * The gate result of a build that ran none of them.
 *
 * Homepage-only publishes one authored page and resolves nothing, so every gate
 * here is about a surface that mode does not have. The shape is returned all the
 * same, because a caller reads the same fields whichever mode ran and a `null`
 * would make each of them a special case.
 *
 * @returns {object} An all-clear gate result.
 */
export function emptyGates() {
    return {
        homepages: [],
        frontmatterLinks: [],
        addressErrors: [],
        sections: [],
        staleManifests: [],
        unaddressable: [],
        index: null,
        foreign: null,
        manifests: null,
    };
}

/**
 * Whether any gate produced a finding.
 * @param {{homepages: unknown[], frontmatterLinks: unknown[],
 *   addressErrors: unknown[], sections?: unknown[], staleManifests: unknown[],
 *   unaddressable: unknown[]}} gates - Results of the site checks.
 * @returns {boolean} Whether at least one check found an error.
 */
export function gatesFailed(gates) {
    return Boolean(
        gates.homepages.length ||
        gates.frontmatterLinks.length ||
        gates.addressErrors.length ||
        gates.sections?.length ||
        gates.staleManifests.length ||
        gates.unaddressable.length,
    );
}

/**
 * Whether a site build found anything that stops its pages being written: a
 * gate that fired, or a note whose table, expression, block, caption, heading,
 * footnote, link, image or embed is in error. What drawing the maps found does
 * not stop it.
 *
 * @param {object} result - From {@link buildSite}.
 * @returns {boolean} Whether the build failed.
 */
export function siteBuildFailed(result) {
    return (
        gatesFailed(result.gates) ||
        [
            result.tableErrors,
            result.expressionErrors,
            result.secretErrors,
            result.captionErrors,
            result.headingErrors,
            result.footnoteErrors,
            result.wikiErrors,
            result.imageErrors,
            result.embedErrors,
        ].some((list) => list?.length)
    );
}

/**
 * The universe a generated table searches, grouped by package.
 *
 * Reference pages only, and grouped so a page never tabulates another package's
 * content: a table is a claim about what this package ships.
 *
 * @param {object[]} pages - Every page.
 * @returns {Map<string, object[]>} Package → the notes it may tabulate.
 */
export function tableUniverse(pages) {
    const byPackage = new Map();
    for (const p of pages) {
        if (p.kind !== "content") continue;
        const pkg = p.pkg;
        if (!byPackage.has(pkg)) byPackage.set(pkg, []);
        byPackage.get(pkg).push({
            // Package present for a `WHERE … package = "…"` clause,
            // synthesised rather than authored — see
            // {@link searchableFrontmatter}.
            fm: searchableFrontmatter(p.fm, pkg),
            path: p.relPath,
            tld: p.tld,
            folder: p.folder,
        });
    }
    return byPackage;
}

/**
 * Renders every page.
 *
 * Each page's body is expanded by
 * {@link module:engine/content-expand.expandContent}, the step the pack
 * compilers take too: tables first and outside code-fence protection, then
 * figure numbers and expressions, then, inside protection, the consumer's
 * `beforeLinks` pass and wikilink resolution. A `{@link}` tag may sit in prose
 * a wikilink also touches, so the repository's own rewrite runs before the
 * shared one rather than replacing it.
 *
 * **Every page is rendered before any is finished.** What links *to* a page is
 * known only once every other page has resolved, and it is set in the page's
 * own front matter, so the render is one pass over the tree and the
 * finishing is a second — with the link graph read off the first, at the one
 * point the resolver answers, and inverted once between them. Nothing is
 * resolved twice.
 *
 * **A map is set inline in its page.** The drawing from a place is made before
 * this render — see {@link module:engine/site-maps} — and handed in keyed by
 * the file name the page's **From here** section names.
 *
 * @param {object[]} pages - Every page.
 * @param {object} options - Everything the render needs. `homepages` is the
 *   homepage as the index knows it — `{ fm, body, url, title }` — which takes
 *   no part in the render and every part in the graph: a content page links
 *   it by wikilink, and its own markdown links name content pages. `maps` is
 *   each drawing by the file name a **From here** section names.
 * @returns {{written: number, byKind: Record<string, number>, tableErrors: object[],
 *   wikiErrors: object[], imageErrors: object[], embedErrors: object[],
 *   related: Map<string, import("./related-pages.mjs").Related>,
 *   maps: number, pages: object[], runs: object}} `related`
 *   is keyed by page URL, and holds the homepage's block beside every content
 *   page's, so the caller can set it on the page this render does not.
 *   `maps` counts the pages carrying a map. `pages` holds
 *   `{page, markdown, figures, data}` for each page and `runs` the package's
 *   marked-text context.
 */
export function renderPages(pages, options) {
    const {
        index,
        foreign,
        universe,
        pass = {},
        decorate,
        linkable = (d) => Boolean(d.fm.shortcode),
        sqlTables,
        config,
        records = [],
        homepages = [],
        maps = new Map(),
    } = options;

    // The address space the art slots and the body's embeds resolve against:
    // the files this package ships, and the ones a dependency published.
    const artIndex = assetAddressIndex(records, {
        config,
        foreign,
        types: index?.contentTypes ?? [],
    });

    // Every page's own figures, by the address a `ref` crossing into it would
    // write — scanned once, before any page's own expressions render, so a
    // page citing another's figure finds it already numbered. Numbering stays
    // per page: each `scanFigures` call here starts its own counters, exactly
    // as the page's own render does, so the number a cross-note `ref` reports
    // is the one the target's own page carries.
    const figuresByAddress = new Map();
    for (const page of pages) {
        const shortcode = page.fm.shortcode;
        if (typeof shortcode !== "string" || !shortcode) continue;
        const src = page.relPath ?? page.base;
        const { markdown } = expandContentTables(page.body, {
            docs: universe.get(page.pkg) ?? [],
            linkable,
            source: src,
            sqlTables: sqlTables?.get(page.file),
            pageLists: sqlTables?.pageLists?.get(page.file),
            self: { fm: searchableFrontmatter(page.fm, page.pkg), path: page.relPath },
        });
        const byId = new Map(
            scanFigures(markdown, { resolveRole: (address) => embedRole(artIndex, address) })
                .figures.filter((figure) => figure.id)
                .map((figure) => [
                    figure.id,
                    { label: figure.label, caption: figure.caption, hasCaption: figure.hasCaption },
                ]),
        );
        const type = String(page.fm.type ?? "").toLowerCase();
        for (const key of figureIndexKeys(page.pkg, type, shortcode))
            figuresByAddress.set(key, byId);
    }

    // Every note's events by Address, for an inline reference to an event's
    // field — the same lookup the Foundry compile and the book build.
    const events = eventNoteIndex(records, {
        contentPackage: index?.contentPackage,
        foreignIndex: foreign?.index,
        dates: index?.dateContext,
    });

    const tableErrors = [];
    const expressionErrors = [];
    const secretErrors = [];
    const captionErrors = [];
    const headingErrors = [];
    const footnoteErrors = [];
    const wikiErrors = [];
    const imageErrors = [];
    const embedErrors = [];
    const byKind = {};
    // The link graph, as `(source URL, target URL)` — read off each page's
    // resolution below, and off the homepage's markdown links.
    /** @type {Array<[string, string]>} */
    const edges = [];
    // Every page of this site, as a `related` entry names it.
    /** @type {Map<string, import("./related-pages.mjs").RelatedEntry>} */
    const entries = new Map();
    for (const page of pages) {
        entries.set(page.url, {
            title: pageTitle(page),
            url: page.url,
            type: String(page.fm.type),
            ...(page.fm.subType ? { subType: String(page.fm.subType) } : {}),
            ...(typeof page.fm.name?.sort === "string" && page.fm.name.sort ?
                { sort: page.fm.name.sort }
            :   {}),
        });
    }
    for (const home of homepages) {
        entries.set(home.url, { title: home.title, url: home.url, type: String(home.fm.type) });
        for (const target of homepageLinkTargets(home.body, home.url)) {
            edges.push([home.url, target]);
        }
    }
    // What each page renders as, held until the graph is whole.
    /** @type {Array<{page: object, markdown: string, figures: object[], data: object}>} */
    const rendered = [];
    const runs = runContext(config, records, {
        referenceName: (target) => resolveInfoboxRef(index, target)?.name,
    });

    const renderOne = (page) =>
        renderSitePage(page, {
            index,
            foreign,
            universe,
            pass,
            decorate,
            linkable,
            sqlTables,
            config,
            artIndex,
            figuresByAddress,
            events,
            drawing: (name) => {
                const drawn = maps.get(name);
                return drawn ? fs.readFileSync(drawn.file, "utf8") : undefined;
            },
            runs,
        });
    const externalRunFindings = new Set();
    for (const page of pages) {
        const result = renderOne(page);
        tableErrors.push(...result.tableErrors);
        expressionErrors.push(...result.expressionErrors);
        secretErrors.push(
            ...result.secretErrors.filter((error) => {
                if (!error.file || error.file === page.file) return true;
                const key = JSON.stringify([error.file, error.line, error.column, error.message]);
                if (externalRunFindings.has(key)) return false;
                externalRunFindings.add(key);
                return true;
            }),
        );
        captionErrors.push(...result.captionErrors);
        headingErrors.push(...result.headingErrors);
        footnoteErrors.push(...result.footnoteErrors);
        wikiErrors.push(...result.wikiErrors);
        imageErrors.push(...result.imageErrors);
        embedErrors.push(...result.embedErrors);
        rendered.push({
            page,
            markdown: result.markdown,
            figures: result.figures,
            data: result.data,
        });
        for (const hit of result.resolved) if (hit.url) edges.push([page.url, hit.url]);
    }

    const deliberate = seeAlsoPages([...pages, ...homepages], (ref) =>
        resolveInfoboxRef(index, ref),
    );
    const related = relatedPages(edges, entries, deliberate);

    let withMap = 0;
    for (const { page, data } of rendered) {
        const block = related.get(page.url);
        if (block) data.related = block;
        if (/\{#fromhere\}/.test(sqlTables?.get(page.file)?.generated ?? "")) withMap += 1;
        byKind[page.kind] = (byKind[page.kind] ?? 0) + 1;
    }

    return {
        written: pages.length,
        byKind,
        tableErrors,
        expressionErrors,
        secretErrors,
        captionErrors,
        headingErrors,
        footnoteErrors,
        wikiErrors,
        imageErrors,
        embedErrors,
        related,
        maps: withMap,
        pages: rendered.map(({ page, markdown, figures, data }) => ({
            page,
            markdown,
            figures,
            data,
        })),
        runs,
        // One page rendered again with everything the whole render resolved
        // against, its place in the link graph included.
        renderAgain: (page) => {
            const result = renderOne(page);
            const block = related.get(page.url);
            if (block) result.data.related = block;
            return result;
        },
    };
}

/**
 * Collects, checks and renders a content tree's pages, and reports what it found.
 *
 * Returns rather than exits, in every case. A caller — the command, or a test —
 * decides what a finding means; the gates below are grouped so it can report
 * the first that fired and stop, which is what keeps a wall of dead links from
 * burying the one manifest that caused them.
 *
 * @param {object} [options] - Options.
 * @param {object} [options.config] - A resolved configuration; loaded when
 *   omitted.
 * @param {(message: string) => void} [options.progress] - Build phase summaries.
 * @param {Map<string, object[]>} [options.sqlTables] - Prepared `sql` results,
 *   keyed by the note's absolute file, from
 *   {@link module:engine/sql-tables.prepareSqlTables}. A page authoring an
 *   `sql` directive with none prepared is a table error: nothing here runs a
 *   query.
 * @returns {{gates: object, stats: object|null, tableErrors: object[],
 *   wikiErrors: object[], imageErrors: object[], embedErrors: object[],
 *   mapFindings: object[],
 *   manifests: object|null, site?: object}} `mapFindings` is what drawing the
 *   maps found — warnings, never a reason to fail the build. `site` holds what a page renderer needs: `base`, `pages` (each content
 *   page's `{page, markdown, figures, data}`), `homepages` (each
 *   `{file, body, data}`), `runs`, `index`, `foreign` and `records`; and
 *   `renderNote(file)`, which reads one content note again and renders it
 *   against the rest of the build, or returns `null` when its address, name
 *   or type changed and the whole site must be built again.
 */
export function buildSite({ config, sqlTables, progress = () => {} } = {}) {
    const resolved = config ?? loadPackConfig();
    const site = resolved.site;
    const scheme = resolved.publish.address;
    // A tree containing only the homepage has no content pages to publish.
    const publishesContent = publishesContentPages(resolved);

    // Where the package is served, and where its content mounts inside it. The
    // two are separate facts: `base` is the package's own address on the site
    // that publishes it, and `prefix` is the content tree's mount within the
    // package — the same `prefix` the link manifest records against, so a page
    // and its manifest entry cannot disagree.
    const base = siteBase(resolved);
    const mount = `${base}${scheme.prefix}`;

    const packages = new Set(site.packages.length ? site.packages : [resolved.contentPackage]);

    const ctx = {
        packages,
        // The package every note in the tree belongs to. a note declares no
        // `package:`, so this is the only source of it.
        contentPackage: resolved.contentPackage,
        skipDirectories: resolved.skipDirectories,
        config: resolved,
        // The corpus, derived once for this build and handed to both
        // collectors — the homepage pass and the content pass read one answer
        // about which files the content is, rather than walking twice.
        records: publicationIndexRecordsFor({
            contentBase: resolved.paths.content,
            config: resolved,
            skipDirectories: resolved.skipDirectories,
        }),
        // Where the package is served, which is where an addressed page
        // publishes: an address is `(type, shortcode)`, a package-wide
        // identity that takes no content mount.
        base,
        mount,
        scheme,
        // The notes `site.sections` names, by address, each with the section
        // it is the page of.
        sectionPages: new Map(
            Object.entries(site.sections ?? {}).map(([name, address]) => [address, name]),
        ),
    };

    const collected = collectHomepages(resolved.paths.content, ctx);
    const homepages = collected.pages;

    // Check for exactly one homepage before clearing the output tree, so a
    // malformed tree does not destroy the last good site.
    //
    // The count is judged first, and alone when it fires: a tree with two
    // homepages does not need to be told about each one's address as well, and
    // a tree with none has no address to report.
    const counted = checkHomepageCount(homepages, {
        contentBase: resolved.paths.content,
        contentPackage: resolved.contentPackage,
    });
    // A homepage that cannot be addressed is reported in the same place, and
    // also applies when the tree contains only a homepage.
    const homepageFindings =
        counted.length ? counted : (
            collected.addressFindings.map((f) => ({
                file: f.file,
                severity: "error",
                message: `${f.reason}, so there is no page to publish at \`${base}\``,
            }))
        );
    if (homepageFindings.length) {
        return {
            gates: { ...emptyGates(), homepages: homepageFindings },
            manifests: null,
            tableErrors: [],
            expressionErrors: [],
            secretErrors: [],
            captionErrors: [],
            headingErrors: [],
            footnoteErrors: [],
            wikiErrors: [],
            imageErrors: [],
            embedErrors: [],
            mapFindings: [],
            stats: null,
        };
    }

    // Homepage-only stops here, and stopping is the point: nothing below reads
    // the content tree for pages, so `sohl-kethira-basic` and `harn-adventures`
    // cannot publish one whatever else their `site:` block declares.
    if (!publishesContent) {
        progress(`rendering ${homepages.length} page(s)`);
        return {
            gates: emptyGates(),
            manifests: null,
            tableErrors: [],
            expressionErrors: [],
            secretErrors: [],
            captionErrors: [],
            headingErrors: [],
            footnoteErrors: [],
            wikiErrors: [],
            imageErrors: [],
            embedErrors: [],
            mapFindings: [],
            stats: { homepages: homepages.length },
            site: {
                base,
                pages: [],
                homepages: homepageData(homepages, resolved, { records: ctx.records }),
                runs: runContext(resolved, ctx.records),
                index: null,
                foreign: null,
                records: ctx.records,
                renderNote: () => null,
            },
        };
    }
    const content = collectContentPages(resolved.paths.content, ctx);
    const { pages } = content;
    content.sectionFindings = unmatchedSectionPages(site.sections ?? {}, pages);

    // The homepage is **indexed but not rendered**. `[[homepage-root|Text]]`
    // is an ordinary wikilink and has to resolve to the page the build
    // publishes — which means the address index must hold it, at the address
    // it publishes at: the package root. It takes no part in `renderPages`: a
    // homepage is authored markdown published verbatim, with no table
    // expansion and no link resolution of its own, and routing it through
    // that pipeline would buy it a pass it has no input for.
    //
    // It is a node of the link graph all the same: `renderPages` reads its
    // markdown links for the edges it authors, and the resolver records the
    // ones that land on it.
    const homepageEntries = homepages.map((page) => ({
        kind: "content",
        fm: page.fm,
        body: page.body,
        pkg: resolved.contentPackage,
        name: page.fm.name?.full ?? homepageTitle(page.fm, resolved),
        title: homepageTitle(page.fm, resolved),
        slug: addressSlug(page.fm),
        base: path.basename(page.file),
        url: base,
    }));

    const gates = siteGates([...pages, ...homepageEntries], content, {
        config: resolved,
        records: ctx.records,
        sqlTables,
    });
    if (gatesFailed(gates)) {
        return {
            gates,
            stats: null,
            tableErrors: [],
            expressionErrors: [],
            secretErrors: [],
            captionErrors: [],
            headingErrors: [],
            footnoteErrors: [],
            wikiErrors: [],
            imageErrors: [],
            embedErrors: [],
            mapFindings: [],
        };
    }

    progress(`rendering ${pages.length + homepages.length} page(s)`);
    const pass = resolveSitePass(site.pass, {
        ...site.passOptions,
        repoRoot: resolved.rootDir,
        config: resolved,
    });

    // The map from each place given a From here section, drawn now that every
    // page is known to be addressable and before any is written, so the page
    // writer sets each drawing inline in its section. Drawn with `base`, which
    // is what every name in a drawing links through — the same `<base><slug>/`
    // every other href composes. With `site.maps: false` no place is given the
    // section, nothing is drawn and nothing is asked of GraphViz.
    const drawn = drawSiteMaps({
        records: ctx.records,
        foreignIndex: gates.foreign.index,
        config: resolved,
        base,
    });

    const rendered = renderPages(pages, {
        sqlTables,
        config: resolved,
        records: ctx.records,
        index: gates.index,
        foreign: gates.foreign,
        universe: tableUniverse(pages),
        homepages: homepageEntries,
        maps: drawn.maps,
        pass,
        // What counts as a being is the toolchain's to say, not a consumer's.
        decorate: sitePageDecorator(resolved, gates.index),
    });

    // The package's front page is not part of the content tree it
    // introduces. It publishes at `base`, which is where the graph keys its
    // block.
    const homepageOptions = {
        related: rendered.related.get(base),
        records: ctx.records,
        foreign: gates.foreign,
    };

    return {
        gates,
        tableErrors: rendered.tableErrors,
        expressionErrors: rendered.expressionErrors,
        secretErrors: rendered.secretErrors,
        captionErrors: rendered.captionErrors,
        headingErrors: rendered.headingErrors,
        footnoteErrors: rendered.footnoteErrors,
        wikiErrors: rendered.wikiErrors,
        imageErrors: rendered.imageErrors,
        embedErrors: rendered.embedErrors,
        mapFindings: drawn.findings,
        stats: {
            ...rendered.byKind,
            homepages: homepages.length,
            maps: rendered.maps,
        },
        site: {
            base,
            pages: rendered.pages,
            homepages: homepageData(homepages, resolved, homepageOptions),
            runs: rendered.runs,
            index: gates.index,
            foreign: gates.foreign,
            records: ctx.records,
            renderNote: (file) => {
                const before = pages.find((page) => page.file === file);
                const after = collectContentPages(resolved.paths.content, {
                    ...ctx,
                    only: file,
                }).pages[0];
                // A note with a new address, name or type, or a new
                // note, changes what other pages resolve to, which
                // only a whole build answers.
                if (
                    !before ||
                    !after ||
                    after.url !== before.url ||
                    after.name !== before.name ||
                    String(after.fm.type) !== String(before.fm.type)
                )
                    return null;
                const result = rendered.renderAgain(after);
                return {
                    page: after,
                    markdown: result.markdown,
                    figures: result.figures,
                    data: result.data,
                    findings: [
                        ...result.tableErrors,
                        ...result.expressionErrors,
                        ...result.secretErrors,
                        ...result.captionErrors,
                        ...result.headingErrors,
                        ...result.footnoteErrors,
                        ...result.wikiErrors,
                        ...result.imageErrors,
                        ...result.embedErrors,
                    ],
                };
            },
        },
    };
}

export { formatUnaddressableFinding };
