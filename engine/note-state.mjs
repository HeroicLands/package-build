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
 * The three states of a note, and the one observable fact they rest on.
 *
 * A note whose body is empty is a **stub**: frontmatter only — identity and
 * statistics — reaching the content index and queryable there, generating no
 * page, no address and no link target. A note with a body and the declared
 * `draft` tag is a **draft**: it publishes, compiles and resolves like any
 * other note, and a link *into* it renders marked. A note with a body and no
 * tag is **full**, which is the default and carries no marker at all.
 *
 * **Full is the absence of everything**, and that is right: the overwhelming
 * majority of a finished corpus should say nothing about its own finishedness.
 *
 * **Nothing is stored.** The index gains no `state` key, {@link
 * module:engine/index-records.DERIVED_KEYS} gains no entry, and no note can
 * assert its own state. The only authored signal is the tag, which marks the
 * one thing that is not observable — "I am not finished" is a judgement only
 * the author holds. The observable thing, the body, is not duplicated by a
 * field that could disagree with it.
 *
 * This module holds the rule; the index withholds an address by it, the
 * `entries` view derives the ladder from that absence, and the lint keeps an
 * empty body deliberate.
 *
 * @module
 */

import { NOTE_VOCABULARY } from "./note-vocabulary.mjs";

/**
 * The three states, in the order they read as a ladder.
 *
 * @type {ReadonlyArray<string>}
 */
export const NOTE_STATES = Object.freeze(["stub", "draft", "full"]);

/**
 * Whether a note's body is empty.
 *
 * > **The body is empty when everything after the closing frontmatter fence is
 * > whitespace.** Nothing else is empty.
 *
 * The severity is the point: **the test must be one a person can apply by
 * looking at the file.** Every softer rule makes two files that look different
 * behave the same, and turns "why did my page disappear?" into an
 * investigation. So an HTML comment, a horizontal rule, a lone heading and
 * `_To be written._` are all bodies — each renders to little or nothing, and
 * {@link module:engine/stub-lint} reports them rather than treating them as
 * either state.
 *
 * An HTML comment is deliberately not empty. An invisible marker deciding
 * whether a page exists is the failure the retired `draft:` field was removed
 * for, and reintroducing it in comment form would be worse, because nothing
 * would report it.
 *
 * @param {string|null|undefined} body - The note body, frontmatter stripped.
 * @returns {boolean} Whether the body is empty.
 */
export function isEmptyBody(body) {
    return String(body ?? "").trim() === "";
}

/**
 * Whether an empty body makes a note of this type a stub.
 *
 * Two types are **structural** and exempt, and the measurement forced the
 * question: a `folder` note's page is a generated section index and the
 * `homepage`'s is the site's front door, so both have no body by design. If an
 * empty body meant "no page" for them, a tree would lose a page per folder plus
 * its own front door, and the build would report nothing.
 *
 * Read from {@link module:engine/note-vocabulary.NOTE_VOCABULARY}, where every
 * type declares `stubbable` — so a type added without answering the question
 * fails the guard rather than being classified by a default nobody chose. A
 * type the registry does not declare at all is stubbable: the rule is about the
 * body, and an unknown type has no exemption to claim.
 *
 * @param {string|null|undefined} type - The note's `type`.
 * @param {Readonly<Record<string, {stubbable?: boolean}>>} [vocabulary] - The
 *   registry to read.
 * @returns {boolean} Whether an empty body suppresses this type's page.
 */
export function isStubbableType(type, vocabulary = NOTE_VOCABULARY) {
    const entry = vocabulary?.[String(type ?? "")];
    return entry ? entry.stubbable !== false : true;
}

/**
 * Whether a note is a stub: an empty body on a type an empty body suppresses.
 *
 * The one place the two halves are put together, so the index, the lint and the
 * guard cannot answer it differently.
 *
 * @param {Record<string, any>|null|undefined} frontmatter - Parsed frontmatter.
 * @param {string|null|undefined} body - The note body.
 * @param {Readonly<Record<string, {stubbable?: boolean}>>} [vocabulary] - The
 *   registry to read.
 * @returns {boolean} Whether the note is a stub.
 */
export function isStubNote(frontmatter, body, vocabulary = NOTE_VOCABULARY) {
    return isEmptyBody(body) && isStubbableType(frontmatter?.type, vocabulary);
}

/**
 * The phrases that stand in for prose nobody has written.
 *
 * A body consisting of nothing but these is an abandoned draft, not a stub:
 * it looks written, publishes a page, and says nothing. The list is matched
 * whole-line, case-insensitively, after trailing punctuation is dropped — a
 * line reading `TBD.` and one reading `tbd` are the same line.
 *
 * @type {ReadonlyArray<string>}
 */
export const PLACEHOLDER_PHRASES = Object.freeze([
    "tbd",
    "tba",
    "to be written",
    "to be done",
    "to come",
    "coming soon",
    "placeholder",
    "n/a",
    "todo",
    "more to come",
    "not yet written",
]);

/** A line that carries no content of its own: a heading, a rule, a comment. */
const STRUCTURE_LINE = /^(?:#{1,6}\s|(?:-\s*){3,}$|(?:\*\s*){3,}$|(?:_\s*){3,}$|<!--)/;

/**
 * One line reduced to the words it says.
 *
 * A placeholder is written dressed: as a list item, a blockquote, italic, bold,
 * with or without a full stop, and in either order — `_To be written._` puts
 * the stop inside the emphasis and `*TBD*.` puts it outside. Stripping every
 * emphasis mark and then the trailing punctuation reads all of them the same,
 * and the phrases themselves carry no such character.
 *
 * @param {string} line - One trimmed line.
 * @returns {string} The words, lower case.
 */
function bareWords(line) {
    return line
        .replace(/^[-*+>\s]+/, "")
        .replace(/[_*`]/g, "")
        .replace(/[.!:,;\s]+$/, "")
        .trim()
        .toLowerCase();
}

/**
 * The placeholder phrases a body reduces to, or an empty list.
 *
 * A body is reduced by dropping every line that carries no content of its own —
 * a heading, a thematic break, an HTML comment, a blank line — and then asking
 * whether every line that is left is a placeholder. A body with some real prose
 * beside its unwritten sections is **not** reduced: a `TBD` under a heading in
 * a note that is honestly a draft is not a defect, and this fires only when a
 * body reduces to nothing but such phrases.
 *
 * The phrases are returned with the 1-based offset of the line each sat on
 * within the body, so a finding can be located rather than merely stated.
 *
 * @param {string|null|undefined} body - The note body.
 * @returns {Array<{phrase: string, line: number}>} The phrases, in body order.
 *   Empty for a body that is empty, or that carries prose of its own.
 */
export function placeholderBody(body) {
    const lines = String(body ?? "").split("\n");
    const found = [];
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i].trim();
        if (!line || STRUCTURE_LINE.test(line)) continue;
        if (!PLACEHOLDER_PHRASES.includes(bareWords(line))) return [];
        found.push({ phrase: line, line: i + 1 });
    }
    return found;
}

/**
 * How many words a body holds, counting only the prose a reader meets.
 *
 * Fence blocks, headings, thematic breaks and HTML comments are dropped, and a
 * wikilink counts as the one word it renders — `[[affiliation-meivor|Mëivōr]]`
 * is a word, not three. What is left is split on whitespace.
 *
 * @param {string|null|undefined} body - The note body.
 * @returns {number} The word count.
 */
export function bodyWordCount(body) {
    const text = String(body ?? "")
        .replace(/```[\s\S]*?(?:```|$)/g, " ")
        .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
        .replace(/\[\[[^\]|]*\|?([^\]]*)\]\]/g, "$1")
        .split("\n")
        .filter((line) => !STRUCTURE_LINE.test(line.trim()))
        .join(" ");
    return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}
