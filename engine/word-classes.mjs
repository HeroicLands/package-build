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
 * The master set of word classes: the parts of speech a word may
 * name, and the modifiers that refine one.
 *
 * A leaf module, importing nothing. A class is written as a base followed by
 * zero or more modifiers, separated by spaces: `n I f` is a noun of class I,
 * feminine. The first token is always the base, so `n n` is a neuter noun.
 *
 * @module
 */

/**
 * @typedef {object} WordClassBase
 * @property {string} token The base as a word writes it.
 * @property {string | null} abbreviation The dictionary abbreviation, or
 *   `null` for a base that never prints in the glossary.
 * @property {string} expansion The base in plain words.
 * @property {boolean} glossary Whether entries of this base appear in the
 *   glossary.
 */

/**
 * @typedef {object} WordClassModifier
 * @property {string} token The modifier as a word writes it.
 * @property {string} group What the modifier says: `gender`, `animacy`,
 *   `number`, `declension`, `conjugation` or `voice`.
 * @property {string} abbreviation The dictionary abbreviation.
 * @property {string} expansion The modifier in plain words; a phrase starting
 *   `of` follows its base without a comma.
 */

/**
 * @param {string} token
 * @param {string | null} abbreviation
 * @param {string} expansion
 * @param {boolean} glossary
 * @returns {Readonly<WordClassBase>}
 */
const base = (token, abbreviation, expansion, glossary) =>
    Object.freeze({ token, abbreviation, expansion, glossary });

/**
 * @param {string} token
 * @param {string} group
 * @param {string} abbreviation
 * @param {string} expansion
 * @returns {Readonly<WordClassModifier>}
 */
const modifier = (token, group, abbreviation, expansion) =>
    Object.freeze({ token, group, abbreviation, expansion });

/** The bases, in glossary order. */
export const WORD_CLASS_BASES = Object.freeze([
    base("n", "n.", "noun", true),
    base("v", "v.", "verb", true),
    base("adj", "adj.", "adjective", true),
    base("adv", "adv.", "adverb", true),
    base("pron", "pron.", "pronoun", true),
    base("num", "num.", "numeral", true),
    base("part", "ptcl.", "particle", true),
    base("art", "art.", "article", true),
    base("conj", "conj.", "conjunction", true),
    base("dem", "dem.", "demonstrative", true),
    base("rel", "rel.", "relative marker", true),
    base("call", "call", "call", true),
    base("name", null, "proper name", false),
    base("stem", null, "bound stem", false),
    base("pref", null, "prefix", false),
]);

/**
 * The modifiers. The neuter prints `nt.` because `n. n.` would show the base
 * and the gender identically.
 */
export const WORD_CLASS_MODIFIERS = Object.freeze([
    modifier("m", "gender", "m.", "masculine"),
    modifier("f", "gender", "f.", "feminine"),
    modifier("n", "gender", "nt.", "neuter"),
    modifier("an", "animacy", "anim.", "animate"),
    modifier("in", "animacy", "inan.", "inanimate"),
    modifier("coll", "number", "coll.", "collective"),
    modifier("I", "declension", "I", "of class I"),
    modifier("II", "declension", "II", "of class II"),
    modifier("III", "declension", "III", "of class III"),
    modifier("IV", "declension", "IV", "of class IV"),
    modifier("V", "declension", "V", "of class V"),
    modifier("hal", "declension", "hal.", "of the hallowed class"),
    modifier("â", "conjugation", "â", "of the first conjugation"),
    modifier("ê", "conjugation", "ê", "of the second conjugation"),
    modifier("i", "conjugation", "i", "of the third conjugation"),
    modifier("c", "conjugation", "c", "of the fourth conjugation"),
    modifier("dep", "voice", "dep.", "deponent"),
]);

const BASES_BY_TOKEN = new Map(WORD_CLASS_BASES.map((item) => [item.token, item]));
const MODIFIERS_BY_TOKEN = new Map(WORD_CLASS_MODIFIERS.map((item) => [item.token, item]));

/**
 * Reads a class string as a base and its modifiers.
 *
 * The result is `{ base, modifiers }` when the string is a class, and
 * `{ reason }` when it is not. A hyphen is not a separator: `n-coll` is
 * refused, and `n coll` is the collective noun.
 *
 * @param {string} text
 * @returns {{ base: string, modifiers: string[], reason?: undefined } | { reason: string, base?: undefined, modifiers?: undefined }}
 */
export function parseWordClass(text) {
    const tokens = String(text ?? "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (tokens.length === 0) return { reason: "the class is empty" };
    const [head, ...rest] = tokens;
    if (!BASES_BY_TOKEN.has(head)) {
        return { reason: `\`${head}\` is not a word class base` };
    }
    for (const token of rest) {
        if (!MODIFIERS_BY_TOKEN.has(token)) {
            return { reason: `\`${token}\` is not a word class modifier` };
        }
    }
    return { base: head, modifiers: rest };
}

/**
 * The dictionary abbreviation of a parsed class, such as `n. I f.`. A base
 * with no abbreviation prints as its token.
 *
 * @param {{ base: string, modifiers: readonly string[] }} parsed
 * @returns {string}
 */
export function abbreviateWordClass(parsed) {
    const head = BASES_BY_TOKEN.get(parsed.base);
    return [
        head?.abbreviation ?? parsed.base,
        ...parsed.modifiers.map((token) => MODIFIERS_BY_TOKEN.get(token)?.abbreviation ?? token),
    ].join(" ");
}

/**
 * A parsed class in plain words, such as "noun of class I, feminine".
 *
 * @param {{ base: string, modifiers: readonly string[] }} parsed
 * @returns {string}
 */
export function expandWordClass(parsed) {
    let out = BASES_BY_TOKEN.get(parsed.base)?.expansion ?? parsed.base;
    for (const token of parsed.modifiers) {
        const words = MODIFIERS_BY_TOKEN.get(token)?.expansion ?? token;
        out += words.startsWith("of ") ? ` ${words}` : `, ${words}`;
    }
    return out;
}
