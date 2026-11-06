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
 * One content page, from its note to its body HTML.
 *
 * The site build renders every page through these functions, and
 * {@link module:engine/note-page.renderNoteFile} renders a single note
 * through the same ones. Nothing here reads or writes a file: what a page
 * resolves against arrives as arguments.
 *
 * @module
 */

import { createRequire } from "node:module";

import { readMatter } from "./note-matter.mjs";
import { positionOfLiteral, positionOfYamlPath } from "./diagnostics.mjs";
import { decodeNoteAddresses, noteAddressContext } from "./note-addresses.mjs";
import { addressSlug } from "./content-address.mjs";
import { expandContent } from "./content-expand.mjs";
import { scanPageBreaks } from "./page-breaks.mjs";
import { scanAlerts } from "./content-alerts.mjs";
import { scanSpans } from "./content-spans.mjs";
import { runContext, scanRuns } from "./content-scripts.mjs";
import { scanBlocks } from "./content-blocks.mjs";
import { scanHeadingAttributes, withheldSections } from "./heading-attributes.mjs";
import { footnoteFindings } from "./content-footnotes.mjs";
import { markupAnchorFindings } from "./anchors.mjs";
import { IMAGE_PATTERN, checkImages, renderImageFigures } from "./content-images.mjs";
import { isAddressTuple } from "./address.mjs";
import { assetPathnameKey, pathnameProblem, resolvePathname } from "./pathnames.mjs";
import { resolveInfoboxRef } from "./site-index.mjs";
import { frontmatterWikilinks } from "./wikilinks.mjs";
import { linkFindingMessage } from "./wikilink-syntax.mjs";
import { noteInfoboxes } from "./infobox-registry.mjs";
import { routerFor } from "./pack-router.mjs";
import { applyComputedBeingAge } from "./being-age.mjs";
import { resolvedDateFields } from "./note-dates.mjs";
import { isStubNote } from "./note-state.mjs";
import { isGmNote } from "./note-vocabulary.mjs";
import { ART_SLOTS, artPathname } from "./art-fields.mjs";
import { embedRole } from "./content-embeds.mjs";
import { isHomepage } from "./homepage.mjs";
import { GENERATED_MARK } from "./site-reach.mjs";
import { generatedDrawing } from "./generated-sections.mjs";
import { createRenderer } from "./content-render.mjs";

/**
 * A note's frontmatter and body, from its source text.
 *
 * @param {string} source - The note as authored.
 * @param {string} file - Where it is, for a finding.
 * @param {object} ctx - `{ config, contentPackage }`, which decode its
 *   addresses.
 * @returns {{fm: object, body: string, bodyLine: number}|null} `null` for text
 *   that is not front-mattered markdown.
 * @throws {Error} When an address in its frontmatter cannot be decoded; the
 *   error carries `file` and `position`.
 */
export function parseNote(source, file, ctx) {
    let parsed;
    try {
        parsed = readMatter(source);
    } catch {
        return null;
    }
    const context = {
        ...noteAddressContext(ctx.config ?? {}),
        package: ctx.contentPackage ?? ctx.config?.contentPackage,
    };
    try {
        return {
            fm: decodeNoteAddresses(parsed.data, context),
            body: parsed.content,
            bodyLine: source.slice(0, source.length - parsed.content.length).split("\n").length,
        };
    } catch (error) {
        const position = positionOfYamlPath(parsed.matter, error.keyPath ?? [], {
            key: error.addressKey,
        });
        if (position.line) position.line++;
        error.file = file;
        error.position = position;
        throw error;
    }
}

/**
 * The page a note publishes as, or why it publishes none.
 *
 * @param {{fm: object, body: string, bodyLine: number}} note - From {@link parseNote}.
 * @param {object} ctx - `{ file, fileBase, relPath, folder, base, packages,
 *   contentPackage, sectionPages, present, dates }`: the note's path, its
 *   file name, its path below the content root and its folder's name; the
 *   package's site address; the packages the site publishes and the one the
 *   note belongs to; the pages `site.sections` names; and the present and
 *   reckoning a being's age is computed in.
 * @returns {{page?: object, fmLinks: object[], addressFinding?: object}|null}
 *   `null` for a note with no page: a homepage, a stub, a GM note, or one
 *   outside the published packages. Otherwise the page, or the finding that
 *   says why it has no address, with any wikilink authored in frontmatter.
 */
export function contentPage(note, ctx) {
    const { file } = ctx;
    applyComputedBeingAge(note.fm, ctx.present, ctx.dates);
    const { fm, body, bodyLine } = note;
    // The configuration's, never a note's: a note declares no `package:`, so every
    // note in the tree belongs to the package this repository compiles.
    const pkg = ctx.contentPackage;
    if (!ctx.packages.has(pkg) || !fm.type) return null;
    // A homepage is addressed like any other note, but it is
    // gathered by `collectHomepages` rather than here: it is the
    // whole of a homepage-only build, which never walks the tree for
    // content pages at all.
    if (isHomepage(fm)) return null;
    // A stub has no body, so it has no page. Asked of the note's own text
    // rather than of the absent address the index derived, so the site and
    // the index apply one rule from one module and a note that cannot be
    // addressed for some *other* reason still reaches the finding below
    // that says so.
    if (isStubNote(fm, body) || isGmNote(fm)) return null;

    const fmLinks = frontmatterWikilinks(fm).map((hit) => ({ file, ...hit }));

    const fileBase = ctx.fileBase;
    const name =
        fm.name?.full ??
        (fileBase.endsWith(".md") && fileBase !== ".md" ? fileBase.slice(0, -3) : fileBase);
    // The page's address, and therefore its URL. `name` is the
    // display string and nothing else: it titles the page and labels an
    // inbound link, and moving it moves no address.
    let slug;
    try {
        slug = addressSlug(fm);
    } catch (err) {
        return { fmLinks, addressFinding: { file, reason: err.message } };
    }

    const page = {
        kind: "content",
        fm,
        // The note's own path on disk. Carried so a link finding can be
        // reported as `file:line:column:` against the source an author
        // edits, rather than against the page this build emits.
        file,
        // The page's package, recorded once here so every consumer — the
        // index's canonical keys, the table universe, the local-package set
        // — reads one configured value and never frontmatter.
        pkg,
        body,
        bodyLine,
        name,
        slug,
        base: fileBase,
        // Top-level content directory ("Rules", "Skills", …). Wikilinks do
        // not use it: a note is addressed as `type/shortcode` wherever it
        // is filed.
        tld: ctx.relPath.split("/")[0],
        // Location below the content root, POSIX-separated.
        relPath: ctx.relPath,
        // The immediate source subfolder — the page's `kbfolder`.
        folder: ctx.folder,
        // Every page is addressed by `(type, shortcode)` at the package
        // root, which takes no content mount.
        //
        // A note `site.sections` names is the page of its section, and is
        // published at the section rather than at its own address.
        url:
            ctx.sectionPages?.has(slug) ?
                `${ctx.base}${ctx.sectionPages.get(slug)}/`
            :   `${ctx.base}${slug}/`,
    };
    return { page, fmLinks };
}

/**
 * The figure the website sets a drawing in: the SVG inline, so its place names
 * stay links, with no blank line inside it — a blank line would end the HTML
 * block and hand the rest of the drawing to the Markdown renderer.
 *
 * @param {string} svg - The drawing, as {@link module:engine/site-maps.inlineSvg} wrote it.
 * @param {string} alt - What the drawing shows, for a screen reader.
 * @returns {string} One HTML block.
 */
export function inlineDrawingFigure(svg, alt) {
    const label = String(alt ?? "").replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    const body = String(svg)
        .split("\n")
        .filter((line) => line.trim() !== "")
        .join("\n");
    return (
        `<figure class="note-image note-image-full-width" role="img" ` +
        `aria-label="${label}">\n${body}\n</figure>`
    );
}

/**
 * The frontmatter a page publishes with.
 *
 * A content page carries the package the build **derived**. No note
 * declares one, so the note's frontmatter alone would publish a page that does
 * not say which package it belongs to. Writing the derived value keeps a page
 * self-describing and makes sweeping the field out of a content tree
 * output-preserving for a site as it already is for the packs.
 *
 * **`related` is derived, never authored.** What links to a page is a fact
 * about every other page, known only once the whole tree has resolved — see
 * {@link module:engine/related-pages} — so an authored value is dropped, and
 * {@link module:engine/site-build.renderPages} sets the derived block once it holds the graph.
 *
 * @param {object} page - The page.
 * @param {object} options
 * @param {(data: object, page: object) => void} [options.decorate] - Called
 *   with each page's frontmatter, for whatever a consumer's own pass adds.
 * @param {(value: unknown, type: string, accepts?: Iterable<string>) => string|null} [options.artSrc] -
 *   Translates an art address into the pathname the website resolver takes, or
 *   `null` where nothing answers it.
 * @param {(src: string) => string} [options.webSrc] - Translates an authored
 *   pathname into the address the website serves. Every artwork field goes
 *   through it, so a page's `img:` and its body images name the same file the
 *   same way.
 * @returns {object} The frontmatter.
 */
export function pageFrontmatter(page, { decorate, webSrc, artSrc }) {
    const { fm, slug } = page;
    const data = {
        ...fm,
        ...(isPlainObject(fm.data) ? { data: { ...fm.data } } : {}),
        // Spread after the note's own frontmatter. Guarded because
        // `package: undefined` is not a value YAML can carry.
        ...(page.pkg ? { package: page.pkg } : {}),
        // The address, stated site-root relative; `slug` is its last segment.
        slug,
        url: `/${slug}/`,
        title: pageTitle(page),
        kbfolder: page.folder,
    };
    if (decorate) decorate(data, page);
    delete data.related;
    if (webSrc && artSrc) resolveArtFields(data, webSrc, artSrc);
    return data;
}

/**
 * The title a content page publishes under — the note's name.
 *
 * One rule, read by the page's own front matter and by every `related` entry
 * that names the page, so a card lists a page by exactly the title its heading
 * shows.
 *
 * @param {object} page - The page, from {@link module:engine/site-build.collectContentPages}.
 * @returns {string} The title.
 */
export function pageTitle(page) {
    return page.name;
}

/**
 * Rewrite a page's artwork addresses into the URLs the website serves.
 *
 * The slots are read from {@link module:engine/art-fields.ART_SLOTS}, so a slot
 * added to the vocabulary reaches the page without anyone remembering this
 * function exists. Only an authored **string** is touched: `null` is a note
 * naming no art and `""` is one naming none on purpose, and neither is an
 * address to resolve. A slot's declining word (`banner: none`) is emitted as
 * a blank, the value a theme reads as "draw no image".
 *
 * **An address nothing answers is dropped**, not emitted as written. The theme
 * renders nothing where a value is absent — its silent-disappear convention —
 * and a raw address left in place would reach the reader as a broken image
 * source with nothing saying why.
 *
 * @param {object} data - The frontmatter being emitted, rewritten in place.
 * @param {(src: string) => string} webSrc - The website's pathname resolver.
 * @param {(value: unknown, type: string, accepts?: Iterable<string>) => string|null} artSrc -
 *   The address resolver, yielding the pathname `webSrc` takes.
 * @returns {void}
 */
export function resolveArtFields(data, webSrc, artSrc) {
    for (const { key, type, accepts, declines } of ART_SLOTS) {
        const holder = isPlainObject(data.data) ? data.data : null;
        if (!holder) continue;
        const value = holder[key];
        if (declines !== undefined && value === declines) {
            holder[key] = "";
            continue;
        }
        if ((typeof value !== "string" && !isAddressTuple(value)) || value === "") continue;
        const pathname = artSrc(value, type, accepts);
        if (pathname === null) delete holder[key];
        else holder[key] = webSrc(pathname);
    }
}

/**
 * @param {unknown} value - Anything.
 * @returns {boolean} Whether it is a mapping a field may be read out of.
 */
export function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Transform one content page.
 *
 * `page` is from {@link contentPage}; the options are what it resolves
 * against: the site `index`, the `foreign` indexes, the consumer's `pass`, the
 * frontmatter `decorate`, the prepared `sqlTables`, the `config`, the asset
 * `artIndex`, other pages' `figuresByAddress`, the `events` index, `drawing`
 * and the marked-text `runs`. The result holds the expanded `markdown`, its
 * `figures`, the page's frontmatter as `data`, the links it `resolved`, and
 * each kind of finding.
 *
 * Reads no file. A drawing a generated **From here** section names is asked
 * of `drawing`, by its file name, for its SVG text, and set inline when it
 * answers.
 */
export function renderSitePage(
    page,
    {
        index,
        foreign,
        pass = {},
        decorate,
        sqlTables,
        config,
        artIndex,
        figuresByAddress = new Map(),
        events,
        drawing = () => undefined,
        runs = runContext(config, undefined, {
            referenceName: (target) => resolveInfoboxRef(index, target)?.name,
        }),
    },
) {
    const secretErrors = [];
    const captionErrors = [];
    const headingErrors = [];
    const footnoteErrors = [];
    const imageErrors = [];
    const embedErrors = [];
    const src = page.relPath ?? page.base;

    const seenImages = new Map();
    const webSrc = (src) => {
        const occurrence = (seenImages.get(src) ?? 0) + 1;
        seenImages.set(src, occurrence);
        const problem = pathnameProblem(src);
        if (problem) {
            imageErrors.push({ file: page.file, src, occurrence, message: problem });
            return src;
        }
        const forms = resolvePathname(src, config);
        if (!forms || forms.web !== null) return forms?.web ?? src;
        imageErrors.push({
            file: page.file,
            src,
            occurrence,
            message:
                `\`${src}\` names a file the \`${forms.package}\` package ships, and ` +
                "no asset host is configured to serve it from — set `site.assets` in " +
                "package-build.config.yaml. Emitted as authored, the address resolves " +
                "against the page's own URL, which is nowhere",
        });
        return src;
    };
    const artSrc = (value, type, accepts) => artPathname(artIndex, value, type, accepts).pathname;
    // The role lookup a captioned item's `map` counter reaches through — see
    // `engine/content-figures.mjs`'s `resolveRole`. It numbers the page's
    // figures once, in expansion, and the render below reads that numbering.
    const resolveRole = (address) => embedRole(artIndex, address);
    // The picture's role and pixel size, by the address it resolved to — read
    // before `webSrc` translates it to the page's own host. A body image is
    // free to write the bare, own-package form, so the address is normalized
    // to the pathname the asset index keys by first.
    const lookupAsset = (src) => {
        const key = assetPathnameKey(src, config);
        return key ? artIndex?.byPath?.get(key) : undefined;
    };
    // A generated **From here** section names the drawing the build made, which
    // the asset host does not serve: it is set inline, so its place names stay
    // links. A drawing this build did not make is left for the image pass,
    // which reports it.
    const inlineDrawings = (text) =>
        text.replace(new RegExp(IMAGE_PATTERN.source, "g"), (whole, alt, src) => {
            const name = generatedDrawing(src);
            const svg = name ? drawing(name) : undefined;
            if (svg === undefined) return whole;
            return inlineDrawingFigure(svg, alt);
        });

    // The frontmatter's art resolves before the body's pictures, so a picture
    // named in both is counted in that order.
    const data = pageFrontmatter(page, { decorate, webSrc, artSrc });
    const expanded = expandContent(page.body, {
        target: "web",
        index,
        note: { fm: page.fm, file: page.file, source: src, bodyLine: page.bodyLine },
        prepared: {
            sqlTables: sqlTables?.get(page.file),
            pageLists: sqlTables?.pageLists?.get(page.file),
            inline: sqlTables?.inline?.get(page.file),
        },
        events,
        resolveRole,
        figuresByAddress,
        links: {
            foreign: foreign.index,
            assets: artIndex,
            beforeLinks: pass.beforeLinks ? (text) => pass.beforeLinks(text, page) : undefined,
            afterLinks: (text) => renderImageFigures(inlineDrawings(text), webSrc, lookupAsset),
        },
    });
    const { lineMap } = expanded;
    const tableErrors = expanded.findings.tables;
    const expressionErrors = expanded.findings.expressions;
    const wikiErrors = expanded.findings.links;
    // The author's text and the sections the build generated after it are
    // told apart by a comment, so the site writer can leave the generated
    // links out of what makes a page reachable.
    const resolvedBody =
        expanded.generated ?
            `${expanded.authored}\n\n${GENERATED_MARK}\n\n${expanded.generated}`
        :   expanded.markdown;
    for (const error of expanded.findings.captions)
        captionErrors.push({
            file: page.file,
            line: (page.bodyLine ?? 1) + (lineMap[error.line - 1]?.line ?? error.line - 1),
            column: error.column,
            message: error.message,
        });
    for (const error of [
        ...scanBlocks(page.body).errors,
        ...scanAlerts(page.body).errors,
        ...scanPageBreaks(page.body).errors,
        ...scanSpans(page.body).errors,
        ...scanRuns(page.body, runs).errors,
        ...markupAnchorFindings(page.body),
    ])
        secretErrors.push({
            file: error.file ?? page.file,
            line: error.file ? error.line : (page.bodyLine ?? 1) + error.line - 1,
            column: error.column,
            message: error.message,
        });
    for (const error of scanHeadingAttributes(page.body, page.bodyLine ?? 1).errors)
        headingErrors.push({ file: page.file, ...error });
    for (const error of withheldSections(page.body, page.bodyLine ?? 1).errors)
        headingErrors.push({ file: page.file, ...error });
    for (const error of footnoteFindings(page.body))
        footnoteErrors.push({
            file: error.file ?? page.file,
            line: error.file ? error.line : (page.bodyLine ?? 1) + error.line - 1,
            column: error.column,
            message: error.message,
        });
    // An image sharing its paragraph with other text, or an address or title
    // the lint already refuses — asked here too, so a site build run on its
    // own fails on the same input `renderImageFigures` otherwise renders as
    // though the directive were absent.
    for (const error of checkImages(page.body, page.file, { bodyLine: page.bodyLine ?? 1 }))
        embedErrors.push(error);
    return {
        page,
        // The expanded body and its numbered figures, for the renderer that
        // writes the whole page.
        markdown: resolvedBody,
        figures: expanded.figures.figures,
        data,
        // The links a generated section makes join no page's Related card:
        // that card is what the authors link, and the sections already list
        // what they derive.
        resolved: expanded.resolved.slice(0, expanded.authoredLinks),
        tableErrors,
        expressionErrors,
        secretErrors,
        captionErrors,
        headingErrors,
        footnoteErrors,
        wikiErrors,
        imageErrors,
        embedErrors,
    };
}

/**
 * The named pass bundles a configuration may select.
 *
 * `site.pass` is the one part of the site contract that is *code* — a
 * repository's own body rewrites — so a configuration names a bundle instead of
 * supplying one, exactly as `itemBuilders` names an item registry. Required
 * lazily, so importing this module does not drag a package-specific half of the
 * toolchain in behind it.
 *
 * @type {Readonly<Record<string, () => Function>>}
 */
const SITE_PASSES = Object.freeze({
    sohlKb: () => createRequire(import.meta.url)("../sohl/kb-passes.mjs").sohlKbPass,
});

/**
 * Resolves `site.pass` to its bundle.
 *
 * @param {string|undefined} name - The configured name.
 * @param {object} options - The configured options, plus `repoRoot`.
 * @returns {{beforeLinks?: Function}} The bundle.
 */
export function resolveSitePass(name, options) {
    if (!name) return {};
    const factory = SITE_PASSES[name];
    if (!factory) {
        throw new Error(
            `unknown site pass ${JSON.stringify(name)} — expected one of ` +
                `${Object.keys(SITE_PASSES).join(", ")}`,
        );
    }
    return factory()(options);
}

/** The site frontmatter decoration shared by the site writer and page preview. */
export function sitePageDecorator(config, index) {
    const router = routerFor(config);
    return (data, page) => {
        // A being's dates reach the page; a note's events reach no page.
        const { events: _events, ...resolvedDates } = resolvedDateFields(
            page.fm,
            index.dateContext,
        );
        if (Object.keys(resolvedDates).length) data.resolvedDates = resolvedDates;
        data.infoboxes = noteInfoboxes(page.fm, {
            resolve: (ref, hint) => resolveInfoboxRef(index, ref, hint),
            router,
            dates: index.dateContext,
            contentPackage: index.contentPackage,
        });
    };
}

/**
 * How a site renders a page body from the markdown its build expanded.
 *
 * @param {object} config - The resolved configuration.
 * @returns {(markdown: string, options?: {runs?: object, figures?: object[]}) => string}
 *   The body HTML as the site writer receives it.
 */
export function siteBodyRenderer(config) {
    const renderer = createRenderer("web", { icons: config.icons });
    const resolveSrc = (src) => resolvePathname(src, config)?.web ?? null;
    return (markdown, { runs, figures } = {}) =>
        renderer.render(markdown, { runs, figures, resolveSrc });
}

/**
 * Each finding of a page render as a diagnostic, kind by kind.
 *
 * @param {object} result - From {@link renderSitePage}, or the site build's
 *   gathered result, which carries the same lists.
 * @param {(file: string) => string} rawOf - A note's source text, which
 *   locates a link or an image by the literal it was handed.
 * @returns {Array<{file?: string, line?: number, column?: number,
 *   severity: string, message: string}>} The diagnostics.
 */
export function pageDiagnostics(result, rawOf) {
    const out = [];
    for (const e of result.tableErrors)
        out.push({
            file: e.source,
            line: typeof e.line === "number" ? e.line + 1 : undefined,
            column: e.column,
            severity: "error",
            message: e.reason,
        });
    for (const e of result.expressionErrors) out.push(e);
    for (const list of [
        result.secretErrors,
        result.captionErrors,
        result.headingErrors,
        result.footnoteErrors,
        result.embedErrors,
    ])
        for (const e of list) out.push({ ...e, severity: "error" });
    // Worded by the shared table the pack build words the same finding
    // with, and located by searching the note for the link. An embed's
    // directive speaks the image vocabulary rather than the link one, and
    // carries its own sentence.
    for (const e of result.wikiErrors)
        out.push({
            file: e.file,
            ...positionOfLiteral(rawOf(e.file), e.link, e.occurrence),
            severity: "error",
            message: e.message ?? linkFindingMessage(e),
        });
    // An image whose pathname the site cannot resolve, located the way a
    // wikilink finding is: by searching the note for the literal the resolver
    // was handed.
    for (const e of result.imageErrors)
        out.push({
            file: e.file,
            ...positionOfLiteral(rawOf(e.file), e.src, e.occurrence),
            severity: "error",
            message: e.message,
        });
    return out;
}

/**
 * A wikilink authored in a note's frontmatter, as a diagnostic.
 *
 * @param {{file: string, link: string, path: string}} finding - From
 *   {@link contentPage}'s `fmLinks`.
 * @returns {{file: string, severity: "error", message: string}} The diagnostic.
 */
export function frontmatterLinkDiagnostic(finding) {
    return {
        file: finding.file,
        severity: "error",
        message:
            `wikilink ${finding.link} authored in frontmatter at ` +
            `${finding.path} — frontmatter is data, is copied to the ` +
            `page verbatim, and reaches the reader as brackets`,
    };
}

/**
 * A note whose page has no address, as a diagnostic.
 *
 * @param {{file: string, reason: string}} finding - From {@link contentPage}'s
 *   `addressFinding`.
 * @returns {{file: string, severity: "error", message: string}} The diagnostic.
 */
export function addressDiagnostic(finding) {
    return {
        file: finding.file,
        severity: "error",
        message: `cannot derive a URL: ${finding.reason}`,
    };
}
