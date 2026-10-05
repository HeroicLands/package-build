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
 * Journals pack compiler — produces JSON pack files for the "journals"
 * Foundry compendium from markdown notes in the `assets/content/` tree.
 *
 * The content root (`contentBase`) is walked recursively; any `.md` file
 * whose frontmatter declares either `type: doc` or a
 * **doc-carrying type** ({@link sohl.utils.packs.docEntryTypes} — every item
 * type, every actor type, every map type, plus `macro`) is compiled into one
 * JournalEntry document. Each note's
 * body is split on top-level H1 headings; the optional content before the
 * first H1 becomes a lead page, and each subsequent H1 starts a new page named
 * after its heading text. All page bodies are rendered to HTML.
 *
 * A doc-carrying note compiles into that document's **documentation** — the
 * same prose and pages, filed in the same folder as the document itself. An
 * item keeps only a pointer to it; an actor keeps its own inline prose as
 * well, because the indirection an item pays for is bought by embedding one
 * item across hundreds of beings and an actor is singular. See `item-docs.mjs` for why, and for the ids the
 * two passes agree on. A macro note's `{#script}` page is compiled here like
 * any other: the macro pass reads the same page independently, and withholds
 * nothing from the journal.
 *
 * Folder placement is identical to the items pack: `sohl.packFolder` in
 * frontmatter is a folder **note's address**, resolved through the shared
 * address index by the constructor's `folderResolver`. A folder
 * materialises in every pack holding a document that names it, so a journals
 * pack needs to declare nothing — which is what stopped this pass
 * filing documentation into folders its own pack had never heard of. A
 * documentation entry reuses its document's folder verbatim.
 *
 * Not a standalone script — exports the `Journals` compiler class, imported
 * and driven by `packages/package-build/engine/generate.mjs` (via `npm run build:compiledb`).
 *
 * The walk itself — filtering by type, expanding tables, converting
 * wikilinks, writing the JSON and counting errors — belongs to {@link sohl.utils.packs.BasePackCompiler}; this module
 * states only what makes this pass its own.
 */

import log from "loglevel";

import path from "node:path";

import {
    sohlField,
    makeId,
    resolveName,
    resolveImg,
    defaultStats,
    renderFoundryMarkdown,
    md,
    folderField,
} from "./helpers.mjs";
import { BasePackCompiler } from "./base-compiler.mjs";
import { scanBlocks } from "./content-blocks.mjs";
import { anchorPageId, resolveReference } from "./wikilinks.mjs";
import { infoboxesToHtml, linkToUuid } from "./infobox-render.mjs";
import { noteInfoboxes } from "./infobox-registry.mjs";
import { reckoningContext } from "./reckoning-markers.mjs";
import { hasDocEntry, itemDocEntryId } from "./item-docs.mjs";
import { JOURNAL_TYPES } from "./ids.mjs";
import { journalHasContent } from "./note-state.mjs";
import { draftNoticeFor } from "./draft-notice.mjs";
import { scanFigures } from "./content-figures.mjs";
import { separateFootnotes } from "./content-footnotes.mjs";
import { WITHHELD_CLASS, pageOpenings } from "./heading-attributes.mjs";
import { imagesIn } from "./content-images.mjs";
import { IMAGE_EXTENSIONS } from "./asset-types.mjs";
import { pathnameRoles } from "./art-fields.mjs";

/**
 * `CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE` — the default ownership a withheld
 * page states. A GM reads every document whatever it says; everyone else reads
 * this one not at all.
 */
const WITHHELD_OWNERSHIP = 0;

/**
 * Every line a named block's own markup occupies, from its `:::name` opener
 * to its closing `:::` inclusive.
 *
 * Read from {@link module:engine/content-blocks.scanBlocks}'s own ranges
 * rather than restated here, so a figure cannot disagree with the blocks pass
 * about what counts as a named block or where one ends. `scanBlocks` already
 * recognises every name in its registry, carrying an attribute block or not,
 * and already tracks a nested construct's own closer by depth rather than by
 * a flag a bare `:::` clears regardless of whose closer it is.
 *
 * @param {string} markdown - A note's body, as {@link splitPages} receives it.
 * @returns {Set<number>} 0-based line indices inside a named block.
 */
function namedBlockLines(markdown) {
    const lines = new Set();
    for (const { start, end } of scanBlocks(markdown).blocks) {
        for (let i = start; i <= end; i++) lines.add(i);
    }
    return lines;
}

/**
 * Splits a markdown body into pages by top-level H1 headings. Fenced
 * code blocks are respected so `# foo` inside ``` or ~~~ blocks doesn't
 * trigger a split. Content before the first H1 (if non-empty) becomes a
 * leading page. Each H1 yields a page whose name is the heading
 * text (with any `{#anchor-id}` suffix stripped out and surfaced as
 * `anchorSlug`). The classes the heading declares come along as `classes`, so
 * a surface that honours one has it without reading the suffix again.
 *
 * `leadName` names that leading page. A journal note's is "Introduction",
 * because it introduces the pages that follow. An item doc's is the item — a
 * note with no headings at all is one page holding the whole description, and
 * calling that page "Introduction" would label the description as a preamble to
 * nothing.
 *
 * A figure fence carries its own record along onto the page it starts, as
 * `figure` — `null` for a page a heading started. {@link buildPages} reads it
 * to build the `image` or `text` page a fence begins; nothing else sets it.
 *
 * @param {string} body - Markdown body to split.
 * @param {string} [leadName] - Name of the page before the first heading.
 * @param {(address: string) => string|undefined} [resolveRole] - From a
 *   picture's address to the role its asset declares, so a figure page's
 *   name reads `Map 1` rather than `Figure 1` where it is due — see
 *   {@link module:engine/content-figures.scanFigures}.
 * @returns {Array<{name: string, anchorSlug: string|null, level: number,
 *   classes: string[], figure: object|null, markdown: string}>} Pages in
 *   document order.
 */
export function splitPages(body, leadName = "Introduction", resolveRole) {
    const { markdown, definitions } = separateFootnotes(body);
    const lines = markdown.split("\n");
    const figureStarts = new Map(
        scanFigures(markdown, { resolveRole }).figures.map((figure) => [figure.line - 1, figure]),
    );
    const blockLines = namedBlockLines(markdown);
    const openings = pageOpenings(markdown, blockLines);
    const pages = [];
    const beforeFirstH1 = [];
    let current = null;
    let codeFence = null;

    const closeCurrent = () => {
        if (!current) return;
        pages.push({
            name: current.name,
            anchorSlug: current.anchorSlug,
            level: current.level,
            classes: current.classes,
            figure: current.figure ?? null,
            markdown: current.lines.join("\n").trim(),
        });
        current = null;
    };

    for (const [lineIndex, line] of lines.entries()) {
        // A fence's closer must carry the same character as its opener and
        // be at least as long — a longer fence is what lets a fenced example
        // carry a shorter fence of its own as literal content, same as
        // {@link module:engine/content-blocks.scanBlocks} and
        // {@link module:engine/content-figures.scanFigures} track it.
        const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
        if (codeFence) {
            if (fence && fence[1][0] === codeFence[0] && fence[1].length >= codeFence.length) {
                codeFence = null;
            }
        } else if (fence) {
            codeFence = fence[1];
        }
        const inCodeBlock = codeFence !== null;

        // An H1 starts a page, as does any heading carrying an `{#slug}`
        // anchor: a Foundry UUID can only address a page, so a linkable
        // section has to be one.
        // {@link module:engine/heading-attributes.parseHeadingLine} is the one
        // reading of that rule — `scanBlocks` and `scanFigures` refuse such a
        // heading written where it cannot become a page, from the same
        // function, so none of them can disagree about what starts one. The
        // lines it claims here are collected by `pageOpenings`, which also
        // skips a fence and a named block. A figure fence opens a page of its
        // own, named for the figure's label.
        const opening = openings.get(lineIndex);
        const figure =
            !inCodeBlock && !blockLines.has(lineIndex) ? figureStarts.get(lineIndex) : null;
        if (figure) {
            closeCurrent();
            current = {
                name: figure.label || figure.caption,
                anchorSlug: figure.id || null,
                level: 1,
                classes: [],
                figure,
                lines: [line],
            };
            continue;
        }
        if (opening) {
            closeCurrent();
            current = {
                name: opening.text,
                anchorSlug: opening.id || null,
                level: opening.level,
                classes: opening.classes,
                lines: [],
            };
            continue;
        }

        if (current) {
            current.lines.push(line);
        } else {
            beforeFirstH1.push(line);
        }
    }
    closeCurrent();

    const intro = beforeFirstH1.join("\n").trim();
    if (intro) {
        pages.unshift({
            name: leadName,
            anchorSlug: null,
            level: 1,
            classes: [],
            figure: null,
            markdown: intro,
        });
    }

    if (definitions) {
        for (const page of pages) page.markdown += `\n\n${definitions}`;
    }
    return pages;
}

/**
 * Two pages in one note that would derive the same id, which the LevelDB packer
 * reports only as an opaque duplicate-key collision. Catch it here, where the
 * note and the page can be named.
 *
 * Both halves of {@link journalPageId} are checked, because each is now keyed
 * on an identity alone:
 *
 * - **An anchor**, declared twice, has always collided.
 * - **A name**, repeated among the unanchored pages, collides once
 *   the index out of the key. `MD024` with `siblings_only` already makes two
 *   sibling headings with the same text a lint error, so this is the same rule
 *   restated where the build can enforce it — a lint is a separate command, and
 *   the compile must not depend on someone having run it.
 *
 * The two are counted separately: an anchored page takes its id from the slug
 * and an unanchored one from the name, so a page named for another's anchor is
 * not a collision.
 *
 * @param {Array<{anchorSlug: string|null, name: string}>} rawPages - From
 *   {@link splitPages}.
 * @param {string} noteName - The note, for the error message.
 * @throws {Error} When two pages in one note share an anchor or a name.
 */
export function assertUniquePages(rawPages, noteName) {
    const anchors = new Set();
    const names = new Set();
    for (const page of rawPages) {
        if (page.anchorSlug) {
            if (anchors.has(page.anchorSlug)) {
                throw new Error(
                    `note "${noteName}" declares the anchor {#${page.anchorSlug}} on more than one heading; an anchor must be unique within its note`,
                );
            }
            anchors.add(page.anchorSlug);
            continue;
        }
        if (names.has(page.name)) {
            throw new Error(
                `note "${noteName}" has more than one page named "${page.name}"; a page is identified by its heading, so the two would compile to one document — rename one, or give it an {#anchor}`,
            );
        }
        names.add(page.name);
    }
}

/**
 * The anchor half of {@link assertUniquePages}, under its former name.
 *
 * @deprecated Call {@link assertUniquePages}, which checks page names too.
 * @param {Array<{anchorSlug: string|null, name: string}>} rawPages - From
 *   {@link splitPages}.
 * @param {string} noteName - The note, for the error message.
 */
export function assertUniqueAnchors(rawPages, noteName) {
    assertUniquePages(rawPages, noteName);
}

/**
 * The id of one page within its entry.
 *
 * An anchored page takes the id its inbound links compute from the note id and
 * the slug, so link and page agree without shared state. Every other page is
 * keyed by its **name**, which is what lets the items pass address an item
 * doc's selected page without having compiled it (see
 * {@link sohl.utils.packs.itemDocPointer}).
 *
 * **It takes no index**. Keying a page by position *and* name,
 * so inserting a heading renumbered every page after it and a re-import created
 * new pages beside the old ones — while nothing about those pages had changed.
 * The anchored case above never took one, and is the shape this now shares.
 *
 * The name is a sound identity here in a way it is not for an embedded item: a
 * page's name is its heading, and `MD024` with `siblings_only` is in the shared
 * markdownlint rule set, so two sibling headings with the same text are already
 * a lint error. {@link assertUniquePages} states the same thing at compile
 * time, where the packer would otherwise report only an opaque duplicate key.
 *
 * @param {string} entryId - The owning JournalEntry's `_id`.
 * @param {{anchorSlug: string|null, name: string}} page - From {@link splitPages}.
 * @returns {string} A 16-character Foundry id.
 */
export function journalPageId(entryId, page) {
    return page.anchorSlug ?
            anchorPageId(entryId, page.anchorSlug)
        :   makeId("journal-page", `${entryId}:${page.name}`);
}

/**
 * Whether a caption carries markup an `image` page's `caption` field cannot
 * hold.
 *
 * `image.caption` is a `StringField`; `text.content` is an `HTMLField`.
 * Parsed as inline Markdown, plain prose tokenises as `text` alone, wrapping
 * at most on a `softbreak` — anything else (emphasis, a code span, a link, an
 * inline image) is a token an image page has nowhere to render.
 *
 * @param {string} caption - The figure's raw caption markdown.
 * @returns {boolean} Whether the caption needs a `text` page.
 */
function captionCarriesMarkup(caption) {
    if (!caption) return false;
    const [inline] = md.parseInline(caption, {});
    return (inline?.children ?? []).some(
        (token) => token.type !== "text" && token.type !== "softbreak",
    );
}

/**
 * The one picture a `figure`-kind fence holds, when it holds exactly one and
 * nothing else — the shape an `image` page can draw on its own. A grouped
 * fence, two pictures or more, keeps the `text` page a single `src` cannot
 * hold, and an embed that resolves to a sound rather than a picture does too,
 * there being no audio page type.
 *
 * By the time a journal note's markdown reaches this pass, an embed has
 * already been rewritten into the ordinary `![alt](src)` image every surface
 * renders ({@link module:engine/content-embeds}), so the file this needs is
 * already sitting in the fence's own contents rather than behind an address
 * this pass would have to resolve a second time.
 *
 * @param {object} figure - The figure record, `kind` already derived.
 * @param {object} page - From {@link splitPages}; `page.markdown` starts on
 *   the figure's own opening line, so `figure`'s line-based offsets translate
 *   into it directly.
 * @returns {string|null} The picture's `src`, or `null`.
 */
function soleFigurePicture(figure, page) {
    if (figure.kind !== "figure" && figure.kind !== "map") return null;
    const offset = figure.line - 1;
    const lines = page.markdown.split("\n");
    const contents = lines.slice(figure.bodyStart - offset, figure.bodyEnd - offset).join("\n");
    const images = imagesIn(contents);
    if (images.length !== 1) return null;
    const extension = path.extname(images[0].src).toLowerCase();
    return IMAGE_EXTENSIONS.includes(extension) ? images[0].src : null;
}

/**
 * Whether a figure fence is the whole of the page {@link splitPages} gave it.
 *
 * A figure always starts a page of its own, but nothing closes one: trailing
 * prose before the next heading or figure stays on it, exactly as it would
 * behind an ordinary heading. An `image` page holds a `src` and a caption and
 * nowhere else to put that prose, so it is refused the type and kept a `text`
 * page, where the prose renders after the figure's own div as it always has.
 *
 * @param {object} figure - The figure record.
 * @param {object} page - From {@link splitPages}.
 * @returns {boolean} Whether nothing follows the fence's closing `:::`.
 */
function figureIsWholePage(figure, page) {
    const offset = figure.line - 1;
    const after = page.markdown
        .split("\n")
        .slice(figure.close - offset + 1)
        .join("\n");
    return after.trim() === "";
}

/**
 * The fields particular to the Foundry page a `:::figure` fence begins.
 *
 * A fence holding exactly one picture, captioned with no inline markup, and
 * standing alone on its page becomes a page of type `image`: `src` the
 * picture, `image.caption` the caption text, the page named for the figure's
 * own number. Every other fence — grouped, an audio embed, a caption
 * `image.caption` cannot hold, or one trailing prose keeps company with —
 * becomes a page of type `text`.
 *
 * The `text` page's content is rendered and then relabeled. The render sees
 * only this one fence — {@link scanFigures}, called again inside
 * {@link module:engine/content-figures.renderFigureBlocks} on this page's own
 * markdown, recounts it as the first of its kind regardless of its true,
 * note-wide number. The fence is the whole of the figure on this page, so its
 * label paragraph is the one element to correct, to the number the note-wide
 * scan in {@link buildJournalEntry} already assigned.
 *
 * @param {object} figure - The figure record from {@link scanFigures},
 *   carried onto the page by {@link splitPages}.
 * @param {object} page - From {@link splitPages}.
 * @param {string} pageId - The page's `_id`, threaded into footnote anchors.
 * @param {Map<string, number>} footnoteNumbers - Shared across the note.
 * @param {(address: string) => string|undefined} [resolveRole] - See
 *   {@link splitPages}.
 * @returns {{name: string, type: "image", src: string, image: {caption?: string}}
 *   |{name: string, type: "text", text: {format: number, content: string}}}
 */
function buildFigurePageFields(figure, page, pageId, footnoteNumbers, resolveRole) {
    const picture = soleFigurePicture(figure, page);
    if (picture && figureIsWholePage(figure, page) && !captionCarriesMarkup(figure.caption)) {
        let src = picture;
        try {
            src = resolveImg(picture) ?? picture;
        } catch {
            // Left as the authored pathname — the same fallback an inline
            // image's own render takes when no configuration resolves it.
        }
        return {
            name: figure.label || figure.caption,
            type: "image",
            src,
            image: figure.hasCaption ? { caption: figure.caption } : {},
        };
    }
    const label =
        figure.hasCaption ?
            `${figure.label ? `${figure.label}: ` : ""}${md.renderInline(figure.caption)}`
        :   figure.label;
    const content = renderFoundryMarkdown(
        page.markdown,
        undefined,
        footnoteNumbers,
        pageId,
        resolveRole,
    );
    return {
        name: figure.label || figure.caption,
        type: "text",
        text: {
            format: 1,
            content: content.replace(
                /<p class="content-figure-label">[\s\S]*?<\/p>/,
                () => `<p class="content-figure-label">${label}</p>`,
            ),
        },
    };
}

/**
 * Compile split pages into JournalEntryPage documents.
 *
 * @param {Array<object>} rawPages - From {@link splitPages}.
 * @param {string} entryId - The owning JournalEntry's `_id`.
 * @param {string} noteName - The note, for error messages.
 * A page whose heading carries `.secret` is given to the GM alone, by the one
 * ownership value Foundry reads as "nobody but a GM". Every other page states
 * no ownership and inherits the journal's. A figure-started page states none
 * either: {@link scanFigures} validates a figure's classes against its own
 * closed vocabulary, which carries no `.secret`.
 *
 * @param {Array<object>} figures - From {@link scanFigures}, numbered across
 *   the whole note. Read by a page a heading started; a page a figure started
 *   carries its own figure already, from {@link splitPages}.
 * @param {(address: string) => string|undefined} [resolveRole] - See
 *   {@link splitPages}.
 * @returns {Array<{_id: string, name: string, type: string,
 *   title: {show: boolean, level: number},
 *   text: {format: number, content: string}, _key: string,
 *   ownership?: {default: number}}>} The page documents, in order.
 * @throws {Error} When the note has no content at all, or repeats an anchor.
 */
export function buildPages(rawPages, entryId, noteName, figures, resolveRole) {
    if (rawPages.length === 0) {
        throw new Error(
            `note "${noteName}" has no Introduction content and no H1 headings — nothing to compile`,
        );
    }
    assertUniquePages(rawPages, noteName);
    const footnoteNumbers = new Map();
    for (const page of rawPages) {
        const env = {};
        md.parse(page.markdown ?? "", env);
        for (const { label } of env.footnotes?.list ?? []) {
            if (!footnoteNumbers.has(label)) footnoteNumbers.set(label, footnoteNumbers.size + 1);
        }
    }
    return rawPages.map((page) => {
        const pageId = journalPageId(entryId, page);
        const withheld = (page.classes ?? []).includes(WITHHELD_CLASS);
        const fields =
            page.figure ?
                buildFigurePageFields(page.figure, page, pageId, footnoteNumbers, resolveRole)
            :   {
                    name: page.name,
                    type: "text",
                    text: {
                        format: 1,
                        content:
                            page.markdown ?
                                renderFoundryMarkdown(
                                    page.markdown,
                                    figures,
                                    footnoteNumbers,
                                    pageId,
                                    resolveRole,
                                )
                            :   "",
                    },
                };
        return {
            _id: pageId,
            ...fields,
            title: { show: true, level: page.level ?? 1 },
            ...(withheld ? { ownership: { default: WITHHELD_OWNERSHIP } } : {}),
            _key: `!journal.pages!${entryId}.${pageId}`,
        };
    });
}

/**
 * Assemble one JournalEntry document from a note's converted markdown.
 *
 * Shared with the scenes pass, which needs the *same* entry a map note's prose
 * compiles into so it can bundle it into an Adventure alongside the Scene. Two
 * passes deriving the same document from the same body is what keeps a map
 * pin's `pageId` pointing at a page that actually exists.
 *
 * @param {object} params
 * @param {string} params.id - The entry's `_id`.
 * @param {string} params.name - The entry's name.
 * @param {string} params.markdown - The body, tables expanded and wikilinks
 *   resolved.
 * @param {string} [params.leadName] - Name for the page before the first
 *   heading; see {@link splitPages}.
 * @param {string|null} [params.folder] - The folder id, or `null`.
 * @param {object} [params.stats] - The `_stats` block to stamp. Passed by the
 *   caller because it is a property of the *pack* being written, not of the
 *   entry: a module may ship the same content for two systems, and each pack's
 *   documents record the system version they were built against. A
 *   caller with no pack in hand gets the package-wide block.
 * @param {Array<{id: string, name: string, html: string}>} [params.infoboxes] -
 *   Emitted boxes, each rendered to HTML. Each becomes a separate page after
 *   the authored pages. Its identity uses the box id in a generated-page
 *   namespace, independent of authored headings and anchors.
 * @param {string} [params.notice] - A statement about the entry rather than
 *   about its subject, already rendered to HTML — see {@link
 *   module:engine/draft-notice}. It leads the first authored page,
 *   because a reader deciding whether to rely on the entry has to be told
 *   before they read it rather than after.
 * @param {(address: string) => string|undefined} [params.resolveRole] - From
 *   a picture's address to the role its asset declares, so a figure page's
 *   name reads `Map 1` rather than `Figure 1` where it is due — see
 *   {@link module:engine/content-figures.scanFigures}.
 * @returns {object} The JournalEntry document, keyed for the pack.
 */
export function buildJournalEntry({
    id,
    name,
    markdown,
    leadName,
    folder = null,
    stats = defaultStats(),
    infoboxes = [],
    notice = "",
    resolveRole,
}) {
    const rawPages = splitPages(markdown, leadName, resolveRole);
    const pages = buildPages(
        rawPages,
        id,
        name,
        scanFigures(markdown, { resolveRole }).figures,
        resolveRole,
    );
    for (const box of infoboxes) {
        const pageId = makeId("journal-infobox-page", `${id}:${box.id}`);
        pages.push({
            _id: pageId,
            name: box.name,
            type: "text",
            title: { show: true, level: 1 },
            text: { format: 1, content: box.html },
            _key: `!journal.pages!${id}.${pageId}`,
        });
    }
    if (notice.trim() && pages.length) {
        pages[0].text.content = `${notice}\n${pages[0].text.content}`;
    }
    return {
        name,
        pages,
        folder,
        sort: 0,
        ownership: { default: 0 },
        flags: {},
        _id: id,
        _stats: stats,
        _key: `!journal!${id}`,
    };
}

/**
 * Journals pack compiler.
 *
 * Walks the content tree and compiles every `type: doc` note, and every note of
 * a doc-carrying type, into one JournalEntry document: the body split into
 * pages on its top-level H1 headings, each rendered to HTML. A doc-carrying
 * note's entry is that document's documentation, filed in the document's own
 * folder.
 */
export class Journals extends BasePackCompiler {
    static id = "journals";
    static label = "journal";

    /**
     * A note with no id is skipped with a warning rather than failing the
     * build: unlike an item or a macro, an unidentified journal note is prose
     * that simply never became an entry.
     */
    static requiresId = false;

    /**
     * **None.** A JournalEntry has no artwork — no `img` property, and no
     * nested place for one — so a note whose whole document is prose has
     * nowhere to put an authored path.
     *
     * The emptiness is the declaration, in the sense `JOURNAL_ONLY_FIELDS` is:
     * it is what separates a pass that emits no art from one that has simply
     * not said, and it is the fact the frontmatter lint reports a `lore` note's
     * inert `img:` from.
     *
     * @type {readonly string[]}
     */
    static emitsArt = Object.freeze([]);

    /**
     * How many of the compiled entries were documentation for a document
     * compiled elsewhere, for the summary.
     *
     * @type {number}
     */
    docEntries = 0;

    /**
     * Journal notes, plus every doc-carrying note — an item's prose is its
     * documentation, so it compiles here and the item keeps a pointer to it;
     * a macro's is the same arrangement, and so is a map's,
     * whose prose is the place description its pins point at.
     *
     * Two memberships, and they mean different things.
     * {@link module:engine/ids.JOURNAL_TYPES} is the types whose whole document
     * *is* a journal — `doc`, `place`, `lore` and `scenario`,
     * which the content format has always described and nothing compiled.
     * {@link sohl.utils.packs.docEntryTypes}, read through
     * {@link sohl.utils.packs.hasDocEntry}, is the types whose prose becomes a
     * journal *beside* another document. The second is the one the link
     * manifest also reads, so what compiles and what is published cannot drift
     * apart; the first has no second document to point at.
     *
     * @param {object} fm - The note's frontmatter.
     * @returns {boolean} True for a journal-only note or a doc-carrying one.
     */
    selects(fm) {
        return JOURNAL_TYPES.has(String(fm.type)) || hasDocEntry(fm.type);
    }

    /**
     * **A journal that would be empty is not created**, and that is the whole
     * rule — one test, asked of every note this pass claims, whether its
     * journal is its own document or the documentation standing beside an item.
     * A note with no prose gets no entry: the items pass leaves its description
     * empty rather than pointing at nothing, a map gets no pin target, and
     * {@link module:engine/foundry-entries} publishes no UUID, so nothing names
     * a document that was not made.
     *
     * An entry holding only its infobox is empty by this test. The panel is a
     * rendering of `data:` that the content index already carries, so a
     * compendium entry of nothing else tells a reader what the index told them.
     *
     * @param {object} fm - The note's frontmatter.
     * @param {string} body - The note body, frontmatter stripped.
     * @returns {boolean} True to skip the note.
     */
    skipNote(fm, body) {
        return !journalHasContent(body);
    }

    /**
     * Compile one note into a JournalEntry.
     *
     * A `doc` note becomes the entry its frontmatter describes. A
     * **doc-carrying note** — every item, actor, map and macro note — becomes
     * that document's documentation instead: the same prose, the same pages,
     * in the same folder, under an id derived from the note's, so the pointer
     * the items pass wrote resolves to it (see
     * {@link sohl.utils.packs.itemDocPointer}). A macro's `{#script}` page is
     * compiled here like any other; nothing is withheld from the journal
     * because the macro pass also reads it.
     *
     * @param {object} fm - The note's frontmatter.
     * @param {string} markdown - The body, tables expanded and wikilinks
     *   resolved. The links are resolved from the note as authored — against
     *   the note's own id, not the entry's.
     * @returns {object} The JournalEntry document.
     */
    buildEntry(fm, markdown) {
        const name = resolveName(fm);
        const ownsDoc = hasDocEntry(fm.type);
        const id = ownsDoc ? itemDocEntryId(fm.id) : fm.id;

        // A documentation entry is filed exactly where the document it
        // describes is, so the journals pack mirrors the items pack and a doc
        // sits under the same heading a reader found the item under.
        //
        // An address is resolved wherever it is written, including here — and
        // resolving it *here* is what cures the defect this comment used to
        // describe. A folder note has one definition and one address, so the
        // journals pack materialises the very folder the items pack does, by
        // the same id. There is no second folder file left to disagree
        // with the first, and so no arrangement to assume: the mirroring
        // failure is unrepresentable rather than merely reported.
        //
        // The id spelling used to cross packs verbatim here, on the assumption
        // both declared it — the arrangement retired with the YAML.
        const { value: authoredFolder } = folderField(fm);
        const folder = this.folderResolver(authoredFolder, { isAddress: true });

        // What the note summarises, in the panel every medium draws from one
        // definition. Links are compendium references rather than website
        // URLs: a player reading this at the table stays in Foundry.
        const boxes = noteInfoboxes(fm, {
            resolve: (ref, hint) => resolveReference(this.linkIndex, ref, hint),
            // This compile's own router, so the panel's `available` is decided
            // by the pack list this build is being driven by.
            router: this.router,
            dates: reckoningContext(this.linkIndex),
            contentPackage: this.linkIndex?.contentPackage,
        });

        // The markdown this pass reads has already had its embeds rewritten
        // into ordinary images, each `src` the pathname `pathnameRoles` keys
        // its roles by — so a `:::figure` of a map names itself `Map 1` here
        // exactly as the website and the book name the same picture.
        const roles = pathnameRoles(this.linkIndex);

        return buildJournalEntry({
            id,
            name,
            markdown,
            resolveRole: (pathname) => roles.get(pathname),
            infoboxes: boxes.map((box) => ({
                id: box.id,
                name: `${
                    box.id === "note" ? "Properties"
                    : box.id === "sohl" ? "SoHL"
                    : "HM3"
                } Infobox`,
                html: infoboxesToHtml([box], { link: linkToUuid }),
            })),
            // Whether the entry is settled, asked of the tag through the one
            // reader of it. This sits here rather than in `buildJournalEntry`
            // for the reason `skipNote` runs first: a note with no prose
            // compiles into nothing, and a notice composed before that test
            // would be content enough to give it an entry.
            notice: draftNoticeFor(fm),
            // A doc-carrying note's lead page is the document itself, not an
            // "Introduction" — see {@link splitPages}.
            leadName: ownsDoc ? name : undefined,
            folder,
            stats: this.stats,
        });
    }

    /** @inheritdoc */
    onCompiled(fm) {
        if (hasDocEntry(fm.type)) this.docEntries++;
    }

    /** @inheritdoc */
    reportCompiled(stats) {
        log.info(
            `Compiled ${stats.compiled} journal entr${stats.compiled === 1 ? "y" : "ies"} (${this.docEntries} documentation entr${this.docEntries === 1 ? "y" : "ies"})`,
        );
    }

    /** @inheritdoc */
    reportDetail(stats) {
        log.debug(`Skipped ${stats.skippedOther} non-doc file(s) (not type:doc)`);
    }
}
