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
 * **What a draft note says about itself**, in one sentence, on every surface it
 * reaches.
 *
 * A note tagged `draft` compiles, validates, publishes and resolves like any
 * other. What separates it from a finished note is a judgement only its author
 * holds — the content is not settled — and a reader who is not told assumes the
 * opposite. So each surface states it where the reader cannot miss it: at the
 * head of the entry, above the infobox and above the prose.
 *
 * **The words are the same everywhere and are stated once here.** A reader who
 * meets the same note on a page, in a compendium and in the book should meet
 * one statement, not three that agree approximately. {@link DRAFT_NOTICE} is
 * that statement; every renderer below composes its own markup around it and
 * changes none of it.
 *
 * **A label alone will not do.** "Draft" names the writing, so it reads as
 * rough prose; what has to land is that the facts may change. The label and the
 * sentence are one unit, and the sentence carries the meaning by itself — which
 * is the floor each surface is built to, because each of them can lose
 * everything around it.
 *
 * ## What each surface can rely on
 *
 * - **Foundry** renders a JournalEntry's own HTML inside a sheet, so the floor
 *   is what a journal page carries with no module and no system stylesheet
 *   loaded. Foundry draws a left rule on a `blockquote` in any application
 *   window and bundles Font Awesome, so the rule and the mark are the host's
 *   and nothing here ships CSS. The class is a hook for a package that wants
 *   one, never a requirement.
 * - **The book** sets Typst, where a glyph missing from the face is silent and
 *   a consumer declaring no icon family is the normal case — see {@link
 *   module:engine/content-icons}. So the mark is **drawn**, from two
 *   primitives, and cannot become a box.
 * - **An Actor's prose** lands in a system's own sheet, in a field the system
 *   styles. It gets the same HTML the journal does; what it can rely on is the
 *   sentence.
 *
 * @module
 */

import { isDraftNote } from "./note-vocabulary.mjs";

/** The word that opens the notice, and the only part a reader reads as a label. */
export const DRAFT_NOTICE_LABEL = "Draft.";

/**
 * The sentence, which states the fact and stops.
 *
 * It says the content may change rather than that the writing is rough,
 * because that is the difference between a reader who treats the entry as
 * provisional and one who builds on it. It gives no instruction: a notice that
 * reaches one page in seven wears better as a statement than as a direction,
 * and the fact carries the consequence for anyone who can act on it.
 *
 * @type {string}
 */
export const DRAFT_NOTICE =
    "This entry is unfinished. What it states may change, and nothing in it is settled.";

/** The Font Awesome mark: a notice, not a hazard. */
export const DRAFT_NOTICE_ICON = "fa-circle-exclamation";

/** The class a package may style the HTML notice against. */
export const DRAFT_NOTICE_CLASS = "sohl-draft-notice";

/** The Typst function the book's notice calls. */
export const BOOK_DRAFT_NOTICE = "book-draft-notice";

/**
 * The notice as HTML, for a JournalEntry page and for an Actor's prose field.
 *
 * A `blockquote` because that is the element Foundry already sets apart —
 * `body.game .app blockquote` carries a left rule and an indent — so the
 * treatment survives with no stylesheet of this package's own. The mark is a
 * Font Awesome element, which Foundry bundles; `aria-hidden` keeps it out of a
 * screen reader, where the label reads it.
 *
 * @returns {string} The notice's HTML.
 */
export function draftNoticeHtml() {
    return (
        `<blockquote class="${DRAFT_NOTICE_CLASS}">` +
        `<p><i class="fa-solid ${DRAFT_NOTICE_ICON}" aria-hidden="true"></i> ` +
        `<strong>${DRAFT_NOTICE_LABEL}</strong> ${DRAFT_NOTICE}</p>` +
        `</blockquote>`
    );
}

/**
 * The notice a note has earned, or nothing.
 *
 * The one place the tag is asked about on a compiled document, so the packs and
 * the book cannot answer it differently. It reads {@link
 * module:engine/note-vocabulary.isDraftNote}, which is the single reader of the
 * tag itself.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter.
 * @returns {string} The notice's HTML, or `""` for a note that is settled.
 */
export function draftNoticeFor(fm) {
    return isDraftNote(fm) ? draftNoticeHtml() : "";
}

/**
 * Prose led by the notice, where the note is a draft.
 *
 * **Which field a system leads is the system's decision, and it makes it
 * once.** A referee at the table opens an actor sheet rather than the
 * documentation beside it, so the prose a sheet draws says it too — on one
 * field, since a document showing the same statement twice teaches a reader to
 * skip it. Both systems put it on the dossier: SoHL's `dossier` and HM3's
 * `biography` read the same authored section, so the notice lands on the same
 * prose whichever system compiles it.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter.
 * @param {string} html - The rendered prose.
 * @returns {string} The prose, led by the notice where one is due.
 */
export function withDraftNotice(fm, html) {
    const notice = draftNoticeFor(fm);
    if (!notice) return html;
    return html ? `${notice}\n${html}` : notice;
}

/**
 * The `#let` the book's notice is drawn by.
 *
 * Emitted with the rest of the book's preamble. The mark is a circle with an
 * exclamation set inside it: two primitives and the face already setting the
 * page, so there is no font to resolve and nothing that can come out as a box.
 *
 * @returns {string} The Typst definition.
 */
export function bookDraftNoticePreamble() {
    return (
        `#let ${BOOK_DRAFT_NOTICE}(label, body) = block(\n` +
        "  width: 100%, above: 0.55em, below: 0.75em, breakable: false,\n" +
        "  inset: (left: 0.7em, top: 0.35em, bottom: 0.35em),\n" +
        "  stroke: (left: 1.6pt + book-faint))[\n" +
        "  #set par(justify: false, first-line-indent: 0em)\n" +
        "  #set text(size: 8.6pt, fill: book-faint)\n" +
        "  #box(baseline: 0.18em, circle(radius: 0.42em, stroke: 0.6pt + book-faint)[\n" +
        '    #align(center + horizon)[#text(size: 6.4pt, weight: "bold")[!]]\n' +
        "  ])\n" +
        "  #h(0.4em)\n" +
        '  #text(weight: "bold")[#label]\n' +
        "  #h(0.25em)\n" +
        "  #body\n" +
        "]"
    );
}

/**
 * The notice as Typst, for a leaf of the book.
 *
 * @returns {string} The call, ready to sit between the entry's plate and its
 *   infobox panel.
 */
export function draftNoticeTypst() {
    return `#${BOOK_DRAFT_NOTICE}[${DRAFT_NOTICE_LABEL}][${DRAFT_NOTICE}]`;
}
