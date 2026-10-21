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
 * **The expansion step.** {@link expandContent} turns a note's authored body
 * into markdown with every construct that reads the content index resolved,
 * before a target renders it. In order:
 *
 * 1. **Tables.** Each prepared `sql` fence and page list is replaced by the
 *    markdown its query returned, and the note's generated sections are
 *    appended — see {@link module:engine/content-tables.expandContentTables}.
 *    This runs outside code protection, because a table is authored as a
 *    fence.
 * 2. **Figure numbers.** The expanded body's captions are numbered by
 *    {@link module:engine/content-figures.scanFigures}; a `ref` and a
 *    `[[#id]]` link read the label.
 * 3. **Expressions.** `{{…}}` is evaluated — `sql`, `ref`, dates and the
 *    helpers — see {@link module:engine/markdown-expressions.renderMarkdownExpressions}.
 * 4. **Wikilinks.** Each `[[…]]` outside code is resolved against the index by
 *    {@link module:engine/wikilinks.resolveWikilinks}, and written in the
 *    target's form.
 *
 * Steps 1 and 2 are {@link expandTables}, which a caller numbering figures
 * across more than one note — the book — runs on its own first.
 *
 * **What the target decides.** Every step reads the same on each target except
 * where the target's own medium differs:
 *
 * | | `foundry` | `web` | `book` |
 * | --- | --- | --- | --- |
 * | a resolved link | an `@UUID[…]{label}` content link | a markdown link to the page's URL | a markdown link to the page's URL, which the book sets as a cross-reference to the entry it prints |
 * | an unresolved link | the error that fails the note, as `linkError` | a `sohl-unresolved-link` span, and a finding | the label, then `(unresolved link)`, and a finding |
 * | a `ref` | a `[[#anchor\|label]]` link, which the link pass addresses by its journal page | a markdown link to the anchor, or to another note's page | as on the web |
 * | the generated sections | part of the one body | resolved apart, and returned as `generated` | resolved with the body, and returned as `generated` |
 * | the date context | the compile's link index | the site index's `dateContext`, which carries the present | as on the web |
 * | a figure's number | counted on the note | counted on the note | counted across the book, by the caller |
 *
 * Expansion reports and never throws on what it finds: each step's findings
 * are returned for the caller to report in its own form.
 *
 * @module
 */

import { collectAnchors, eventAnchors } from "./anchors.mjs";
import { protectCode } from "./code-fences.mjs";
import { scanFigures } from "./content-figures.mjs";
import { expandContentTables } from "./content-tables.mjs";
import { markGenerated, splitGenerated } from "./generated-sections.mjs";
import { convertNoteWikilinks } from "./helpers.mjs";
import { renderMarkdownExpressions } from "./markdown-expressions.mjs";
import { reckoningContext } from "./reckoning-markers.mjs";
import { resolveCrossNoteFigures, wikiContext } from "./site-index.mjs";
import { resolveWebWikilinks } from "./wikilinks.mjs";

/** The targets a body is expanded for. */
export const EXPANSION_TARGETS = Object.freeze(["foundry", "web", "book"]);

/**
 * A `ref` call's Foundry rendering: a same-page wikilink rather than a
 * Markdown link, so the wikilink pass that runs after expressions render
 * addresses it exactly as an authored `[[#anchor|Text]]` is — by the
 * JournalEntryPage the figure's own fence became, whether that page holds
 * only the figure or carries it alongside other prose. A Markdown link's
 * `#anchor` fragment resolves nowhere in Foundry, which addresses a page by
 * UUID and an anchor within a page by that page's own anchor.
 *
 * @param {{anchor: string}} target - The figure's own anchor.
 * @param {string} label - The link's text, which may itself carry Markdown.
 * @returns {string} `[[#anchor|label]]`, with a literal `|` in the label
 *   escaped so it cannot be read as the wikilink's own separator.
 */
function foundryRefLink({ anchor }, label) {
    return `[[#${anchor}|${label.replace(/\|/g, "\\|")}]]`;
}

/**
 * The note a body belongs to.
 *
 * @typedef {object} ExpandedNote
 * @property {Record<string, any>} fm - Its frontmatter.
 * @property {string} [file] - Its file, which findings name.
 * @property {string} source - What a table's or a link's finding names the
 *   note by: its path on the web, its name in Foundry.
 * @property {number} [bodyLine] - The file line its body starts on.
 * @property {number} [bodyColumn] - The column its body starts at on that line.
 */

/**
 * How a target resolves links, beyond the index.
 *
 * @typedef {object} ExpandLinks
 * @property {string|null} [pack] - `foundry`: the pack the note's own document
 *   lands in, which a `[[#slug]]` self-link addresses.
 * @property {string|null} [docPack] - `foundry`: the pack its journal lands in.
 * @property {Map<string, object>} [foreign] - `web` and `book`: the merged
 *   foreign index.
 * @property {object} [assets] - `web` and `book`: the address space an embed
 *   resolves against, from {@link module:engine/art-fields.assetAddressIndex}.
 * @property {(text: string) => string} [beforeLinks] - `web` and `book`: a pass
 *   run on the text outside code before its links resolve.
 * @property {(text: string) => string} [afterLinks] - `web` and `book`: a pass
 *   run on the text outside code once its links resolve.
 */

/**
 * The first two steps of an expansion: the tables, and the figures of the
 * table-expanded body.
 *
 * @typedef {object} ExpandedTables
 * @property {{markdown: string, errors: object[], lineMap: object[],
 *   generatedFrom: number|undefined}} tables - From
 *   {@link module:engine/content-tables.expandContentTables}.
 * @property {{figures: object[], errors: object[]}} figures - The figure scan
 *   of `tables.markdown`. A caller numbering figures across notes replaces
 *   `figures.figures` with its numbering before expanding the rest.
 */

/**
 * Expand a note's tables and scan the result for figures — steps 1 and 2 of
 * {@link expandContent}.
 *
 * @param {string} markdown - The body as authored.
 * @param {object} options
 * @param {string} options.source - What a table's finding names the note by.
 * @param {{sqlTables?: object[], pageLists?: object[]}} [options.prepared] -
 *   This note's prepared SQL tables and page lists.
 * @param {(address: string) => string|undefined} [options.resolveRole] - The
 *   role an embedded picture takes, which numbers a map apart from a figure.
 * @returns {ExpandedTables} The two steps' results.
 */
export function expandTables(markdown, { source, prepared = {}, resolveRole }) {
    const tables = expandContentTables(markdown ?? "", {
        source,
        sqlTables: prepared.sqlTables,
        pageLists: prepared.pageLists,
    });
    return { tables, figures: scanFigures(tables.markdown, { resolveRole }) };
}

/**
 * The expanded body, and what each step found.
 *
 * @typedef {object} Expansion
 * @property {string} markdown - The whole body, expanded.
 * @property {string} authored - The author's text, expanded. In Foundry it is
 *   the whole body.
 * @property {string} generated - The generated sections, expanded apart from
 *   the author's text on the web; `""` in Foundry, and wherever there are none.
 * @property {Array<{line: number, generated: boolean}>} lineMap - The authored
 *   line, 0-based, each line of the table-expanded body came from.
 * @property {number|undefined} generatedFrom - The 0-based line of the
 *   table-expanded body the generated sections start on.
 * @property {{figures: object[], errors: object[]}} figures - The figure scan
 *   of the table-expanded body.
 * @property {{tables: object[], captions: object[], expressions: object[], links: object[]}} findings -
 *   Each step's findings, as the step reports them: a table's and a caption's
 *   by expanded body line, an expression's in file coordinates, a link's by
 *   occurrence of its literal.
 * @property {Error|undefined} linkError - `foundry`: the error
 *   {@link module:engine/helpers.convertNoteWikilinks} fails a note with,
 *   carrying `file` and `position`.
 * @property {object[]} unresolved - `foundry`: the links that did not resolve.
 * @property {object[]} resolved - `web` and `book`: every link that resolved,
 *   in order.
 * @property {number} authoredLinks - `web`: how many of `resolved` the
 *   author's text made, before the generated sections'.
 */

/**
 * Expand a note's body for one target.
 *
 * @param {string} markdown - The body as authored.
 * @param {object} options
 * @param {"foundry"|"web"|"book"} options.target - What the body is expanded
 *   for.
 * @param {object} options.index - What links resolve against: the compile's
 *   link index for `foundry`, the {@link module:engine/site-index.buildSiteIndex}
 *   index for `web` and `book`.
 * @param {ExpandedNote} options.note - The note.
 * @param {{sqlTables?: object[], pageLists?: object[], inline?: object[]}} [options.prepared] -
 *   This note's prepared SQL tables, page lists and inline query results.
 * @param {object} [options.events] - Every note's events, from
 *   {@link module:engine/event-fields.eventNoteIndex}.
 * @param {(address: string) => string|undefined} [options.resolveRole] - The
 *   role an embedded picture takes, which numbers a map apart from a figure.
 * @param {Map<string, Map<string, object>>} [options.figuresByAddress] - `web`
 *   and `book`: every page's figures, by the address a cross-note `ref` writes.
 * @param {ExpandedTables} [options.tables] - The note's {@link expandTables},
 *   already run — with the figures numbered, for the book. Run here when
 *   omitted.
 * @param {ExpandLinks} [options.links] - How the target resolves links.
 * @returns {Expansion} The expanded body and the findings.
 * @throws {Error} When `target` is not one of {@link EXPANSION_TARGETS}.
 */
export function expandContent(
    markdown,
    {
        target,
        index,
        note,
        prepared = {},
        events,
        resolveRole,
        figuresByAddress = new Map(),
        tables: staged,
        links = {},
    },
) {
    if (!EXPANSION_TARGETS.includes(target))
        throw new Error(
            `\`${target}\` is not an expansion target; expected ` +
                EXPANSION_TARGETS.slice(0, -1)
                    .map((name) => `\`${name}\``)
                    .join(", ") +
                ` or \`${EXPANSION_TARGETS.at(-1)}\``,
        );
    const { fm, file, source, bodyLine, bodyColumn } = note;
    // The website and the book read the site index, and resolve the same way.
    const web = target !== "foundry";

    const { tables, figures } = staged ?? expandTables(markdown, { source, prepared, resolveRole });
    const { lineMap, generatedFrom } = tables;
    const figuresById = new Map(
        figures.figures
            .filter((figure) => figure.id)
            .map((figure) => [
                figure.id,
                { label: figure.label, caption: figure.caption, hasCaption: figure.hasCaption },
            ]),
    );

    const expressions = renderMarkdownExpressions(
        web ? markGenerated(tables.markdown, generatedFrom) : tables.markdown,
        {
            fm,
            dates: web ? index.dateContext : reckoningContext(index),
            file,
            bodyLine,
            sqlResults: prepared.inline,
            events,
            figures:
                web ?
                    {
                        get: (id) => figuresById.get(id),
                        // A cross-note `ref` resolves the written address
                        // exactly as a wikilink does, against every page's
                        // figures scanned before any page's expressions render.
                        note: (address) =>
                            resolveCrossNoteFigures(address, {
                                contentTypes: index.contentTypes,
                                packages: index.packages,
                                noIndexPackages: index.noIndexPackages,
                                contentPackage: index.contentPackage,
                                siteIndexMap: index.index,
                                figuresByAddress,
                            }),
                    }
                :   { get: (id) => figuresById.get(id), link: foundryRefLink },
        },
    );

    const findings = {
        tables: tables.errors,
        captions: figures.errors,
        expressions: expressions.findings,
        links: [],
    };

    if (!web) {
        let converted;
        let linkError;
        try {
            converted = convertNoteWikilinks(expressions.markdown, {
                type: fm.type,
                id: fm.id,
                file,
                bodyLine,
                bodyColumn,
                lineMap,
                pack: links.pack,
                docPack: links.docPack,
                index,
                name: source,
            });
        } catch (error) {
            linkError = error;
        }
        const body = converted?.markdown ?? expressions.markdown;
        return {
            markdown: body,
            authored: body,
            generated: "",
            lineMap,
            generatedFrom,
            figures,
            findings,
            linkError,
            unresolved: converted?.unresolved ?? [],
            resolved: [],
            authoredLinks: 0,
        };
    }

    const resolved = [];
    const book = target === "book";
    const ctx = wikiContext(index, {
        src: source,
        file,
        type: fm.type ?? null,
        errors: findings.links,
        foreignIndex: links.foreign,
        assets: links.assets,
        resolved,
    });
    ctx.captionLabels = new Map(
        figures.figures.filter((figure) => figure.id).map((figure) => [figure.id, figure.label]),
    );
    // This page's own anchors, so a `[[#slug]]` self-link is checked against
    // what the page actually declares rather than trusted unconditionally.
    ctx.anchors = new Set(collectAnchors(tables.markdown).map((anchor) => anchor.slug));
    ctx.eventAnchors = new Set(eventAnchors(fm).map((anchor) => anchor.slug));
    if (book) ctx.output = "book";
    const resolve = (text) => {
        const before = links.beforeLinks ? links.beforeLinks(text) : text;
        const linked = resolveWebWikilinks(before, ctx);
        return links.afterLinks ? links.afterLinks(linked) : linked;
    };
    // The book resolves the body whole, so a link's occurrence counts across
    // the author's text and the generated sections it prints after it.
    if (book) {
        const split = splitGenerated(protectCode(expressions.markdown, resolve));
        return {
            markdown: split.generated ? `${split.authored}\n${split.generated}` : split.authored,
            authored: split.authored,
            generated: split.generated ?? "",
            lineMap,
            generatedFrom,
            figures,
            findings,
            linkError: undefined,
            unresolved: [],
            resolved,
            authoredLinks: 0,
        };
    }
    // The author's text and the generated sections are resolved apart, so a
    // caller can tell the links the author wrote from the ones a section
    // derives.
    const split = splitGenerated(expressions.markdown);
    const authored = protectCode(split.authored, resolve);
    const authoredLinks = resolved.length;
    const generated = split.generated ? protectCode(split.generated, resolve) : "";
    return {
        markdown: split.generated ? `${authored}\n${generated}` : authored,
        authored,
        generated,
        lineMap,
        generatedFrom,
        figures,
        findings,
        linkError: undefined,
        unresolved: [],
        resolved,
        authoredLinks,
    };
}
