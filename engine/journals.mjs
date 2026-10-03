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

import {
    sohlField,
    makeId,
    resolveName,
    defaultStats,
    renderFoundryMarkdown,
    md,
    folderField,
} from "./helpers.mjs";
import { BasePackCompiler } from "./base-compiler.mjs";
import { anchorPageId, resolveReference } from "./wikilinks.mjs";
import { infoboxesToHtml, linkToUuid } from "./infobox-render.mjs";
import { noteInfoboxes } from "./infobox-registry.mjs";
import { reckoningContext } from "./reckoning-markers.mjs";
import { hasDocEntry, itemDocEntryId } from "./item-docs.mjs";
import { JOURNAL_TYPES } from "./ids.mjs";
import { journalHasContent } from "./note-state.mjs";
import { draftNoticeFor } from "./draft-notice.mjs";
import { scanCaptions } from "./content-captions.mjs";
import { separateFootnotes } from "./content-footnotes.mjs";
import { parseHeadingLine } from "./page-headings.mjs";

/**
 * Splits a markdown body into pages by top-level H1 headings. Fenced
 * code blocks are respected so `# foo` inside ``` blocks doesn't trigger
 * a split. Content before the first H1 (if non-empty) becomes a leading
 * page. Each H1 yields a page whose name is the heading
 * text (with any `{#anchor-id}` suffix stripped out and surfaced as
 * `anchorSlug`).
 *
 * `leadName` names that leading page. A journal note's is "Introduction",
 * because it introduces the pages that follow. An item doc's is the item — a
 * note with no headings at all is one page holding the whole description, and
 * calling that page "Introduction" would label the description as a preamble to
 * nothing.
 *
 * @param {string} body - Markdown body to split.
 * @param {string} [leadName] - Name of the page before the first heading.
 * @returns {Array<{name: string, anchorSlug: string|null, level: number,
 *   markdown: string}>} Pages in document order.
 */
export function splitPages(body, leadName = "Introduction") {
    const { markdown, definitions } = separateFootnotes(body);
    const lines = markdown.split("\n");
    const captions = scanCaptions(markdown).captions;
    const captionStarts = new Map(captions.map((caption) => [caption.line - 1, caption]));
    const captionedHeadings = new Set(
        captions
            .filter((caption) => /^\s*#{1,6}\s/.test(lines[caption.blockStart] ?? ""))
            .map((caption) => caption.blockStart),
    );
    const pages = [];
    const beforeFirstH1 = [];
    let current = null;
    let inCodeBlock = false;
    let inSecret = false;

    const closeCurrent = () => {
        if (!current) return;
        pages.push({
            name: current.name,
            anchorSlug: current.anchorSlug,
            level: current.level,
            markdown: current.lines.join("\n").trim(),
        });
        current = null;
    };

    for (const [lineIndex, line] of lines.entries()) {
        if (line.trim().startsWith("```")) {
            inCodeBlock = !inCodeBlock;
        }
        if (!inCodeBlock && /^:::secret[ \t]*$/.test(line)) inSecret = true;
        else if (!inCodeBlock && /^:::[ \t]*$/.test(line)) inSecret = false;

        // An H1 starts a page, as does any heading carrying an `{#slug}`
        // anchor: a Foundry UUID can only address a page, so a linkable
        // section has to be one. {@link module:engine/page-headings.parseHeadingLine}
        // is the one reading of that rule — `scanBlocks` and `scanCaptions`
        // refuse such a heading written where it cannot become a page, from
        // the same function, so the two cannot disagree about what starts one.
        const heading = !inCodeBlock && !inSecret ? parseHeadingLine(line) : null;
        const caption = !inCodeBlock && !inSecret ? captionStarts.get(lineIndex) : null;
        if (caption) {
            closeCurrent();
            current = {
                name: caption.label,
                anchorSlug: caption.id,
                level: 1,
                lines: [line],
            };
            continue;
        }
        if (heading?.startsPage && !captionedHeadings.has(lineIndex)) {
            closeCurrent();
            current = {
                name: heading.text,
                anchorSlug: heading.anchorSlug,
                level: heading.level,
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
 * Compile split pages into JournalEntryPage documents.
 *
 * @param {Array<object>} rawPages - From {@link splitPages}.
 * @param {string} entryId - The owning JournalEntry's `_id`.
 * @param {string} noteName - The note, for error messages.
 * @returns {Array<{_id: string, name: string, type: string,
 *   title: {show: boolean, level: number},
 *   text: {format: number, content: string}, _key: string}>} The page
 *   documents, in order.
 * @throws {Error} When the note has no content at all, or repeats an anchor.
 */
export function buildPages(rawPages, entryId, noteName, captions) {
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
        return {
            _id: pageId,
            name: page.name,
            type: "text",
            title: { show: true, level: page.level ?? 1 },
            text: {
                format: 1,
                content:
                    page.markdown ?
                        renderFoundryMarkdown(page.markdown, captions, footnoteNumbers, pageId)
                    :   "",
            },
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
 * @param {object} [params.flags] - Document flags.
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
 * @returns {object} The JournalEntry document, keyed for the pack.
 */
export function buildJournalEntry({
    id,
    name,
    markdown,
    leadName,
    folder = null,
    flags,
    stats = defaultStats(),
    infoboxes = [],
    notice = "",
}) {
    const rawPages = splitPages(markdown, leadName);
    const pages = buildPages(rawPages, id, name, scanCaptions(markdown).captions);
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
        flags: flags || {},
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
        });

        return buildJournalEntry({
            id,
            name,
            markdown,
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
            flags: fm.flags,
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
