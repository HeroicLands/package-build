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
 * **A mapped run's words are words of its language.** In a run marked with
 * `lang=`, whose language's `note` names its language note, and with `map=`,
 * each word (see {@link module:engine/word-pattern.WORD}) is accepted when,
 * case folded, it is:
 *
 * - a `data.words[].form` of the language, or a word of one, or a declared
 *   `variants` entry of a word;
 * - a word of a name in the language note's own `data.register` whose `tongue`
 *   is not `translation`, so a foreign name the run uses is listed there first,
 *   as `other:<tongue>` or under another tag the note declares;
 * - a form one rule the language states derives from a lexicon form: a noun
 *   plural, a verb's present form, a replacing suffix, an agreeing form or a
 *   participle, of a lexicon form or of one of its variants (see {@link module:engine/word-forms.derivedForms}).
 *
 * A word not accepted whole is split at its hyphens and en dashes, and each
 * part is checked. An apostrophe joins a word, so `k'aralzon` is one word, and
 * `’` reads as `'`. A word with no letter is not checked.
 *
 * Nothing here requires a word to take a particular form: a lexicon word
 * stated with its own plural, and the plural the rule gives, both pass.
 *
 * @module
 */

import { lexiconsFromRecords } from "./map-lexicon.mjs";
import { RESERVED_TONGUE } from "./language-terms.mjs";
import { addWords, foldWord, lexiconWords } from "./word-forms.mjs";
import { WORD } from "./word-pattern.mjs";

/** Whether a value is a plain map. */
const isMap = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** A list value, or an empty one. */
const listOf = (value) => (Array.isArray(value) ? value : []);

/** The characters a compound is split at. */
const JOINS = /[–-]/u;

/** A letter, which a checked word holds at least one of. */
const LETTER = /\p{L}/u;

/**
 * The words of every name a language note registers under a tongue other than
 * `translation`.
 *
 * @param {Record<string, any>|undefined} data - The language note's `data`.
 * @returns {Set<string>} The words, folded.
 */
export function registeredNameWords(data) {
    const words = new Set();
    for (const row of listOf(data?.register)) {
        if (!isMap(row) || typeof row.name !== "string") continue;
        if (row.tongue === RESERVED_TONGUE) continue;
        addWords(words, row.name);
    }
    return words;
}

/**
 * What a mapped run's words are checked against, for one language.
 *
 * @typedef {object} WordBook
 * @property {string} language - The language's configured name, as `lang=`
 *   writes it.
 * @property {(word: string) => boolean} accepts - Whether a folded word is
 *   one of the language's.
 */

/**
 * Each configured language's word book: one per language whose `note` names a
 * language note. Its effective lexicon shares the renderer's nearest inherited
 * words, and derives forms and registered names from its own settings.
 *
 * @param {Iterable<Record<string, any>>|undefined} records - Index records.
 * @param {{languages?: Readonly<Record<string, {tag: string, note?: string}>>, contentPackage?: string}} config -
 *   The resolved configuration.
 * @returns {Map<string, WordBook>} The books by language name.
 */
export function wordBooksFromRecords(records, config = {}) {
    const list = [...(records ?? [])];
    const books = new Map();
    const lexicons = lexiconsFromRecords(list, config);
    for (const [name, lexicon] of lexicons) {
        const own = lexiconWords(lexicon.data);
        const names = registeredNameWords(lexicon.data);
        books.set(
            name,
            Object.freeze({
                language: name,
                accepts: (word) => own.has(word) || names.has(word),
            }),
        );
    }
    return books;
}

/**
 * The words of a text its book does not accept, each once, at the offset of
 * its first character: a compound not accepted whole gives each part that is
 * not.
 *
 * @param {string} text - The text, with no escapes.
 * @param {WordBook} book - The language's book.
 * @param {Set<string>} [said] - The folded words already reported in this
 *   run, which are not reported again; updated.
 * @returns {Array<{offset: number, word: string}>} The words, in order.
 */
export function unknownWords(text, book, said = new Set()) {
    const out = [];
    const check = (word, offset) => {
        if (!LETTER.test(word)) return;
        const folded = foldWord(word);
        if (book.accepts(folded) || said.has(folded)) return;
        said.add(folded);
        out.push({ offset, word });
    };
    for (const match of text.matchAll(WORD)) {
        const word = match[0];
        const offset = /** @type {number} */ (match.index);
        if (book.accepts(foldWord(word))) continue;
        if (!JOINS.test(word)) {
            check(word, offset);
            continue;
        }
        let at = 0;
        for (const part of word.split(JOINS)) {
            check(part, offset + at);
            at += part.length + 1;
        }
    }
    return out;
}

/**
 * The finding for a word of a mapped run that is not a word of its language.
 *
 * @param {string} word - The word as written.
 * @param {string} language - The language as `lang=` names it.
 * @returns {string} The message.
 */
export function unknownWordMessage(word, language) {
    return (
        `\`${word}\` is not a word of the \`${language}\` lexicon, a registered name, or a regular ` +
        "form of one; coin it in the lexicon (or register the name) first"
    );
}
