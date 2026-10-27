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
 * Native word spellings under any encoding: authored entries first, then all
 * stated parts, affixes and grammatical endings. Ambiguous spellings remain
 * findings, with every matching gloss. Exact lexical forms precede folded
 * lookup, preserving explicitly distinct capitalized spellings.
 */

import { pluralOf } from "./word-inflections.mjs";
import { verbForm, verbPattern } from "./verb-pattern.mjs";
import { parseWordClass } from "./word-classes.mjs";
import { foldWord } from "./word-forms.mjs";
import { glossText } from "./word-terms.mjs";

/** Whether a value is a plain object. */
const isMap = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** A list value, or an empty one. */
const listOf = (value) => (Array.isArray(value) ? value : []);

/** A form with its joining hyphens taken off. */
const bare = (form) => form.replace(/^[-–]+|[-–]+$/gu, "");

/** The characters a hyphenated word is split at. */
const JOINS = /[–-]/u;

/**
 * Where a word's writing comes from, or why it has none.
 *
 * @typedef {{text: string, source: "own"|"parts"}
 *   | {missing: true, noLexicon?: true}
 *   | {ambiguous: {form: string, glosses: string[]}}} Writing
 */

/**
 * The text a list of native entries states for a enc in a face: the entry for
 * the face, else the entry for no face.
 *
 * @param {unknown} natives - A `native` list as authored.
 * @param {string} enc - The encoding's name.
 * @param {string|undefined} font - The face.
 * @returns {string|undefined} The text.
 */

export function nativeText(natives, enc, font) {
    const entries = listOf(natives).filter(
        (entry) => isMap(entry) && entry.enc === enc && typeof entry.text === "string",
    );
    const own = font === undefined ? undefined : entries.find((entry) => entry.font === font);
    return (own ?? entries.find((entry) => typeof entry.font !== "string"))?.text;
}

/**
 * One writing for several candidates: the shared one where every candidate is
 * written alike, else an ambiguity naming each candidate's gloss.
 *
 * @param {string} form - The form the candidates were matched by.
 * @param {Array<{writing: Writing, gloss: string}>} candidates - At least one.
 * @returns {Writing} The writing.
 */
function oneOf(form, candidates) {
    const passed = candidates.find(({ writing }) => "ambiguous" in writing);
    if (passed) return passed.writing;
    const texts = new Set(
        candidates.map(({ writing }) => ("text" in writing ? writing.text : undefined)),
    );
    if (texts.size === 1) return candidates[0].writing;
    return { ambiguous: { form, glosses: candidates.map(({ gloss }) => gloss) } };
}

/** Each language data's writings, by encoding and face. */
const writingsFound = new WeakMap();

/**
 * The writings of a language's words under one encoding in one face. One
 * `data` yields one set of writings per encoding and face, and each word's
 * writing is found once, so `data` must not be modified once it is read here.
 *
 * @param {Record<string, any>|undefined} data - The language note's `data`.
 * @param {string} enc - The encoding's name.
 * @param {string|undefined} font - The face.
 * @returns {{word: (word: string) => Writing, entry: (index: number) => Writing}}
 *   The writing of a run's word, and of the `data.words` entry at an index.
 */
export function writingsOf(data, enc, font) {
    if (!isMap(data)) return findWritings(data, enc, font);
    if (!writingsFound.has(data)) writingsFound.set(data, new Map());
    const byFace = writingsFound.get(data);
    const key = JSON.stringify([enc, font ?? null]);
    if (!byFace.has(key)) {
        const found = findWritings(data, enc, font);
        const words = new Map();
        byFace.set(key, {
            word: (written) => {
                if (!words.has(written)) words.set(written, found.word(written));
                return words.get(written);
            },
            entry: found.entry,
        });
    }
    return byFace.get(key);
}

/**
 * The writings of a language's words under one encoding in one face, found
 * afresh; see {@link writingsOf}.
 *
 * @param {Record<string, any>|undefined} data - The language note's `data`.
 * @param {string} enc - The encoding's name.
 * @param {string|undefined} font - The face.
 * @returns {{word: (word: string) => Writing, entry: (index: number) => Writing}}
 */
function findWritings(data, enc, font) {
    const words = listOf(data?.words);
    const affixes = listOf(data?.affixes).filter(isMap);
    const grammar = isMap(data?.grammar) ? data.grammar : undefined;
    const verbs = verbPattern(grammar?.verbs);
    const replaces = verbs?.replaces === undefined ? undefined : foldWord(verbs.replaces);
    const endings = grammar?.native;
    const indexed = words
        .map((word, index) => ({ word, index }))
        .filter(({ word }) => isMap(word) && typeof word.form === "string");
    const glossOf = (entry) => glossText(entry.gloss) ?? String(entry.form ?? "");

    /**
     * @param {number} index - A `data.words` index.
     * @param {Set<number>} visiting - The entries whose parts are being read.
     * @returns {Writing}
     */
    const entry = (index, visiting) => {
        const word = words[index];
        const own = nativeText(word?.native, enc, font);
        if (own !== undefined) return { text: own, source: "own" };
        const pieces = listOf(word?.built).filter((piece) => typeof piece === "string");
        if (!pieces.length || visiting.has(index)) return { missing: true };
        const inner = new Set(visiting).add(index);
        let text = "";
        for (const piece of pieces) {
            const found = part(piece, inner);
            if (!("text" in found)) return found;
            text += found.text;
        }
        return { text, source: "parts" };
    };

    /** The candidates of a list of matched words and affixes. */
    const candidatesOf = (matchedWords, matchedAffixes, visiting) => [
        ...matchedWords.map(({ word, index }) => ({
            writing: entry(index, visiting),
            gloss: glossOf(word),
        })),
        ...matchedAffixes.map((affix) => {
            const text = nativeText(affix.native, enc, font);
            return {
                writing: /** @type {Writing} */ (
                    text === undefined ? { missing: true } : { text, source: "own" }
                ),
                gloss: glossOf(affix),
            };
        }),
    ];

    /**
     * A `built` piece: a word written exactly so, else an affix, else either
     * with its joining hyphens taken off.
     *
     * @param {string} piece - The piece.
     * @param {Set<number>} visiting - The entries whose parts are being read.
     * @returns {Writing}
     */
    const part = (piece, visiting) => {
        const affixForms = (affix) =>
            [affix.form, affix.front].filter((form) => typeof form === "string");
        const stages = [
            [indexed.filter(({ word }) => word.form === piece), []],
            [[], affixes.filter((affix) => affixForms(affix).includes(piece))],
            [indexed.filter(({ word }) => bare(word.form) === bare(piece)), []],
            [[], affixes.filter((affix) => affixForms(affix).some((f) => bare(f) === bare(piece)))],
        ];
        for (const [matchedWords, matchedAffixes] of stages) {
            const candidates = candidatesOf(matchedWords, matchedAffixes, visiting);
            if (candidates.length) return oneOf(piece, candidates);
        }
        return { missing: true };
    };

    /**
     * The ending's writing a derived form takes after its stem's.
     *
     * @param {string} ending - A name of
     *   {@link module:engine/language-terms.WRITTEN_ENDINGS}.
     * @returns {string|undefined} The text.
     */
    const endingText = (ending) =>
        nativeText(
            listOf(endings).filter((one) => isMap(one) && one.ending === ending),
            enc,
            font,
        );

    /**
     * A word of a run, matched case folded.
     *
     * @param {string} written - The word as written.
     * @returns {Writing}
     */
    const word = (written) => {
        const folded = foldWord(written);
        const none = new Set();
        const stages = [
            indexed.filter(({ word: one }) => one.form === written),
            indexed.filter(({ word: one }) => listOf(one.variants).includes(written)),
            indexed.filter(({ word: one }) => foldWord(one.form) === folded),
            indexed.filter(({ word: one }) =>
                listOf(one.variants).some(
                    (form) => typeof form === "string" && foldWord(form) === folded,
                ),
            ),
        ];
        for (const stated of stages)
            if (stated.length) return oneOf(written, candidatesOf(stated, [], none));
        const stripped = indexed.filter(({ word: one }) => bare(foldWord(one.form)) === folded);
        if (stripped.length) return oneOf(written, candidatesOf(stripped, [], none));
        const derived = [];
        for (const { word: one, index } of indexed) {
            const base = parseWordClass(one.class).base;
            const plural = pluralOf(one, grammar);
            const forms = [
                ...(plural ? [{ form: plural, ending: "plural" }] : []),
                ...(verbs && base === "v" ?
                    verbs.endings.map(({ name, ending }) => ({
                        form: verbForm(foldWord(one.form), foldWord(ending), replaces),
                        ending: name,
                    }))
                :   []),
            ];
            for (const { form, ending } of forms) {
                if (foldWord(form) !== folded) continue;
                const stem = entry(index, none);
                const tail = endingText(ending);
                derived.push({
                    writing: /** @type {Writing} */ (
                        !("text" in stem) ? stem
                        : tail === undefined ? { missing: true }
                        : { text: stem.text + tail, source: "parts" }
                    ),
                    gloss: glossOf(one),
                });
            }
        }
        if (derived.length) return oneOf(written, derived);
        if (JOINS.test(written)) {
            let text = "";
            for (const piece of written.split(JOINS)) {
                if (!piece) continue;
                const found = word(piece);
                if ("missing" in found) return { missing: true };
                if ("ambiguous" in found) return found;
                text += found.text;
            }
            return { text, source: "parts" };
        }
        return { missing: true };
    };

    return { word, entry: (index) => entry(index, new Set()) };
}
