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
 * - a `data.words[].form` of the language, or a word of one;
 * - a word of a name in the language note's own `data.register` whose `tongue`
 *   is not `translation`, so a foreign name the run uses is listed there first,
 *   as `other:<tongue>` or under another tag the note declares;
 * - a form one rule the language states derives from a lexicon form:
 *   - the noun plural `data.grammar.plural` gives, or the word's own `plural`;
 *   - a verb's citation form with one ending of `data.grammar.verbs.persons`,
 *     which takes the place of a closing `data.grammar.verbs.replaces` where
 *     the pattern states one (see {@link module:engine/verb-pattern.verbForm});
 *   - a suffix of `data.affixes` that states `replaces`, or its `front` form:
 *     `vowel` takes the place of a closing vowel (a letter whose base is `a`,
 *     `e`, `i`, `o` or `u`), letters take the place of those letters, and a
 *     stem closing otherwise takes the suffix whole. An affix that states no
 *     `replaces` derives nothing.
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

import { pluralOf } from "./dictionary-rows.mjs";
import { languageRecordsByName } from "./map-lexicon.mjs";
import { RESERVED_TONGUE } from "./language-terms.mjs";
import { replaceClosing, verbForm, verbPattern } from "./verb-pattern.mjs";
import { parseWordClass } from "./word-classes.mjs";
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
 * A word as it is compared: NFC, lowercase, `’` read as `'`.
 *
 * @param {string} word - The word.
 * @returns {string} Its folded form.
 */
export function foldWord(word) {
    return word.normalize("NFC").toLowerCase().replace(/’/gu, "'");
}

/** Whether a character is a vowel: its base letter is a, e, i, o or u. */
const isVowel = (char) => /^[aeiou]/iu.test(char.normalize("NFD"));

/**
 * Add a text's words to a set, each whole and each part of a compound.
 *
 * @param {Set<string>} set - The set.
 * @param {string} text - A form or a name.
 */
function addWords(set, text) {
    for (const [word] of text.matchAll(WORD)) {
        const folded = foldWord(word);
        set.add(folded);
        for (const part of folded.split(JOINS)) if (part) set.add(part);
    }
}

/**
 * The form a suffix stating `replaces` makes of a stem.
 *
 * @param {string} stem - The stem, folded.
 * @param {string} suffix - The suffix, folded, with no hyphen.
 * @param {string} replaces - The affix's `replaces`.
 * @returns {string} The derived form.
 */
function attach(stem, suffix, replaces) {
    if (replaces === "vowel") {
        const last = Array.from(stem).at(-1);
        return last !== undefined && isVowel(last) ?
                stem.slice(0, -last.length) + suffix
            :   stem + suffix;
    }
    return replaceClosing(stem, suffix, foldWord(replaces));
}

/**
 * The suffixes a language's affixes state `replaces` for: each `form`, and
 * its `front` form, written `-x`.
 *
 * @param {Record<string, any>} data - The language note's `data`.
 * @returns {Array<{suffix: string, replaces: string}>} The suffixes, folded.
 */
function replacingSuffixes(data) {
    const out = [];
    for (const affix of listOf(data.affixes)) {
        if (!isMap(affix) || typeof affix.replaces !== "string") continue;
        for (const written of [affix.form, affix.front]) {
            if (typeof written !== "string") continue;
            const form = foldWord(written.trim());
            if (!/^[-–]/u.test(form) || /[-–]$/u.test(form)) continue;
            const suffix = form.replace(/^[-–]+/u, "");
            if (suffix) out.push({ suffix, replaces: affix.replaces });
        }
    }
    return out;
}

/**
 * The words a language note accepts of its own: its forms, and what its
 * plural rows, verb pattern and replacing suffixes derive from them.
 *
 * @param {Record<string, any>} data - The language note's `data`.
 * @returns {Set<string>} The words, folded.
 */
export function lexiconWords(data) {
    const accepted = new Set();
    const grammar = isMap(data?.grammar) ? data.grammar : undefined;
    const verbs = verbPattern(grammar?.verbs);
    const replaces = verbs?.replaces === undefined ? undefined : foldWord(verbs.replaces);
    const suffixes = replacingSuffixes(data ?? {});
    for (const word of listOf(data?.words)) {
        if (!isMap(word) || typeof word.form !== "string") continue;
        addWords(accepted, word.form);
        const plural = pluralOf(word, grammar);
        if (plural) addWords(accepted, plural);
        if (verbs && parseWordClass(word.class).base === "v")
            for (const { ending } of verbs.endings)
                addWords(accepted, verbForm(foldWord(word.form), foldWord(ending), replaces));
        if (suffixes.length)
            for (const [stem] of word.form.matchAll(WORD)) {
                const folded = foldWord(stem);
                for (const { suffix, replaces } of suffixes)
                    accepted.add(attach(folded, suffix, replaces));
            }
    }
    return accepted;
}

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
 * language note.
 *
 * @param {Iterable<Record<string, any>>|undefined} records - Index records.
 * @param {{languages?: Readonly<Record<string, {tag: string, note?: string}>>, contentPackage?: string}} config -
 *   The resolved configuration.
 * @returns {Map<string, WordBook>} The books by language name.
 */
export function wordBooksFromRecords(records, config = {}) {
    const list = [...(records ?? [])];
    const books = new Map();
    const languages = languageRecordsByName(list, config);
    if (!languages.size) return books;
    for (const [name, record] of languages) {
        const own = lexiconWords(record.data);
        const names = registeredNameWords(record.data);
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
