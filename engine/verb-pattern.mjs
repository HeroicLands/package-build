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
 * **A language's one regular verb pattern, read once for every reader.** A
 * language's `data.grammar.verbs` is `{ invariant: true }` or six `persons`
 * endings, optionally with `replaces`. A present form is the citation form
 * with the ending added; where the pattern states `replaces`, a citation form
 * closing on those letters has them swapped for the ending, and one closing
 * otherwise takes the ending whole, as a suffix's `replaces` does.
 *
 * The dictionary's verb table and a mapped run's lexicon check both read the
 * pattern through {@link verbPattern} and build forms with {@link verbForm}.
 *
 * @module
 */

import { VERB_PERSON_FIELDS } from "./language-terms.mjs";

/** Whether a value is a plain map. */
const isMap = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * A stated verb pattern, as its readers use it.
 *
 * @typedef {object} VerbPattern
 * @property {boolean} invariant - Whether verbs keep the citation form for
 *   every person.
 * @property {string|undefined} replaces - The letters each ending takes the
 *   place of, where the pattern states them.
 * @property {Array<{name: string, label: string, ending: string}>} endings -
 *   The six endings in presentation order; empty for an invariant pattern.
 */

/**
 * Read a language's verb pattern.
 *
 * @param {unknown} verbs - The language's `data.grammar.verbs`, as authored or
 *   as a SQL row carries it (absent fields `null`).
 * @returns {VerbPattern|undefined} The pattern, or `undefined` where none is
 *   stated in full.
 */
export function verbPattern(verbs) {
    if (!isMap(verbs)) return undefined;
    const replaces =
        typeof verbs.replaces === "string" && verbs.replaces.trim() ? verbs.replaces : undefined;
    if (verbs.invariant === true) return { invariant: true, replaces, endings: [] };
    const persons = isMap(verbs.persons) ? verbs.persons : undefined;
    if (!persons || !VERB_PERSON_FIELDS.every(({ name }) => typeof persons[name] === "string"))
        return undefined;
    return {
        invariant: false,
        replaces,
        endings: VERB_PERSON_FIELDS.map(({ name, label }) => ({
            name,
            label,
            ending: persons[name],
        })),
    };
}

/**
 * A stem with its closing letters swapped for an ending, or with the ending
 * added where the stem does not close on them.
 *
 * @param {string} stem - The stem.
 * @param {string} ending - The ending.
 * @param {string|undefined} letters - The closing letters the ending takes
 *   the place of; none adds the ending.
 * @returns {string} The form.
 */
export function replaceClosing(stem, ending, letters) {
    return letters && stem.endsWith(letters) ?
            stem.slice(0, -letters.length) + ending
        :   stem + ending;
}

/**
 * The present form of a verb for one ending.
 *
 * @param {string} citation - The citation form.
 * @param {string} ending - The person's ending; empty leaves the citation
 *   form, less any closing `replaces`.
 * @param {string} [replaces] - The pattern's `replaces`.
 * @returns {string} The form.
 */
export function verbForm(citation, ending, replaces) {
    return replaceClosing(citation, ending, replaces);
}
