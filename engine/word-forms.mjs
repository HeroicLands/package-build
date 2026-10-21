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
 * **The regular forms a language's own rules derive from its lexicon.** Each
 * rule a language note states in machine-readable form gives a lexicon word
 * further forms, and nothing else does:
 *
 * - **the noun plural**: `data.grammar.plural`, or the word's own `plural`;
 * - **the verb pattern**: a verb's citation form with one ending of
 *   `data.grammar.verbs.persons`, which takes the place of a closing
 *   `data.grammar.verbs.replaces` where the pattern states one (see
 *   {@link module:engine/verb-pattern.verbForm});
 * - **a replacing suffix**: a suffix of `data.affixes` that states `replaces`,
 *   or its `front` form, on any word: `vowel` takes the place of a closing
 *   vowel (a letter whose base is `a`, `e`, `i`, `o` or `u`), letters take the
 *   place of those letters, and a stem closing otherwise takes the suffix
 *   whole. An affix that states no `replaces` derives nothing here;
 * - **agreement**: a word whose class base `data.grammar.agreement.classes`
 *   names, closing on one of `data.grammar.agreement.endings` (the longest
 *   that leaves a stem), also takes each other ending in its place, and each
 *   of those forms and the word itself takes the plural the
 *   `data.grammar.plural` rule gives;
 * - **participles**: a verb closing on one of `data.grammar.participles.root`
 *   (the longest that leaves a root) drops it, and each suffix of `data.affixes`
 *   that `data.grammar.participles.affixes` names, by its `form`, attaches to
 *   the root as its `replaces` says, or whole where it states none. A
 *   participle closing on an agreement ending agrees.
 *
 * The mapped-run word check ({@link module:engine/run-words}) and
 * `package-build lexicon --derived` both read {@link derivedForms}, so what
 * the command lists is what the check accepts.
 *
 * @module
 */

import { pluralByRule, pluralOf } from "./dictionary-rows.mjs";
import { replaceClosing, verbForm, verbPattern } from "./verb-pattern.mjs";
import { parseWordClass } from "./word-classes.mjs";
import { WORD } from "./word-pattern.mjs";

/** Whether a value is a plain map. */
const isMap = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** A list value, or an empty one. */
const listOf = (value) => (Array.isArray(value) ? value : []);

/** The characters a compound is split at. */
const JOINS = /[–-]/u;

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
export function addWords(set, text) {
    for (const [word] of text.matchAll(WORD)) {
        const folded = foldWord(word);
        set.add(folded);
        for (const part of folded.split(JOINS)) if (part) set.add(part);
    }
}

/**
 * The form a suffix makes of a stem.
 *
 * @param {string} stem - The stem, folded.
 * @param {string} suffix - The suffix, folded, with no hyphen.
 * @param {string|undefined} replaces - The affix's `replaces`; none adds the
 *   suffix whole.
 * @returns {string} The derived form.
 */
function attach(stem, suffix, replaces) {
    if (replaces === "vowel") {
        const last = Array.from(stem).at(-1);
        return last !== undefined && isVowel(last) ?
                stem.slice(0, -last.length) + suffix
            :   stem + suffix;
    }
    return replaceClosing(stem, suffix, replaces === undefined ? undefined : foldWord(replaces));
}

/**
 * An affix's suffixes: its `form` and its `front` form, each written `-x`,
 * folded and without the hyphen.
 *
 * @param {Record<string, any>} affix - One `data.affixes` entry.
 * @returns {string[]} The suffixes.
 */
function suffixesOf(affix) {
    const out = [];
    for (const written of [affix.form, affix.front]) {
        if (typeof written !== "string") continue;
        const form = foldWord(written.trim());
        if (!/^[-–]/u.test(form) || /[-–]$/u.test(form)) continue;
        const suffix = form.replace(/^[-–]+/u, "");
        if (suffix) out.push(suffix);
    }
    return out;
}

/**
 * The suffixes a language's affixes state `replaces` for.
 *
 * @param {Record<string, any>} data - The language note's `data`.
 * @returns {Array<{suffix: string, replaces: string}>} The suffixes, folded.
 */
function replacingSuffixes(data) {
    const out = [];
    for (const affix of listOf(data.affixes)) {
        if (!isMap(affix) || typeof affix.replaces !== "string") continue;
        for (const suffix of suffixesOf(affix)) out.push({ suffix, replaces: affix.replaces });
    }
    return out;
}

/**
 * The strings of a list, trimmed and folded, keeping those with letters.
 *
 * @param {unknown} value - The list.
 * @returns {string[]} The strings.
 */
const foldedStrings = (value) =>
    listOf(value)
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => foldWord(item.trim()));

/**
 * A language's agreement rule, as derivation reads it.
 *
 * @typedef {object} Agreement
 * @property {ReadonlySet<string>} classes - The class bases that agree.
 * @property {readonly string[]} endings - The endings, folded, longest first.
 */

/**
 * Read a language's `data.grammar.agreement`.
 *
 * @param {unknown} value - The authored value.
 * @returns {Agreement|undefined} The rule, or `undefined` where none is stated
 *   in full.
 */
function agreementOf(value) {
    if (!isMap(value)) return undefined;
    const classes = listOf(value.classes).filter((item) => typeof item === "string");
    const endings = [
        ...new Set(
            listOf(value.endings)
                .filter((item) => typeof item === "string")
                .map((item) => foldWord(item.trim())),
        ),
    ];
    if (!classes.length || endings.length < 2) return undefined;
    return {
        classes: new Set(classes.map((item) => item.trim())),
        endings: endings.sort((a, b) => b.length - a.length),
    };
}

/**
 * The forms an agreeing word takes beside its own.
 *
 * @param {string} form - The word, folded.
 * @param {Agreement} agreement - The rule.
 * @param {Record<string, any>|undefined} grammar - The language's grammar,
 *   for its plural rule.
 * @returns {string[]} The forms; none where the word closes on no ending.
 */
function agreeingForms(form, agreement, grammar) {
    const ending = agreement.endings.find((one) => form.length > one.length && form.endsWith(one));
    if (ending === undefined) return [];
    const stem = form.slice(0, form.length - ending.length);
    const singulars = agreement.endings.map((one) => stem + one);
    const out = singulars.filter((one) => one !== form);
    for (const one of singulars) {
        const plural = pluralByRule(one, grammar);
        if (plural) out.push(foldWord(plural));
    }
    return out;
}

/**
 * A language's participle rule, as derivation reads it.
 *
 * @typedef {object} Participles
 * @property {readonly string[]} root - The root endings, folded, longest
 *   first.
 * @property {Array<{suffix: string, replaces: string|undefined}>} suffixes -
 *   The participle suffixes, folded.
 */

/**
 * Read a language's `data.grammar.participles` against its affixes.
 *
 * @param {unknown} value - The authored value.
 * @param {Record<string, any>} data - The language note's `data`.
 * @returns {Participles|undefined} The rule, or `undefined` where it names no
 *   root ending or no suffix the affixes state.
 */
function participlesOf(value, data) {
    if (!isMap(value)) return undefined;
    const root = [...new Set(foldedStrings(value.root))].sort((a, b) => b.length - a.length);
    const named = new Set(
        listOf(value.affixes)
            .filter((item) => typeof item === "string")
            .map((item) => item.trim()),
    );
    const suffixes = [];
    for (const affix of listOf(data.affixes)) {
        if (!isMap(affix) || typeof affix.form !== "string" || !named.has(affix.form.trim()))
            continue;
        const replaces = typeof affix.replaces === "string" ? affix.replaces : undefined;
        for (const suffix of suffixesOf(affix)) suffixes.push({ suffix, replaces });
    }
    if (!root.length || !suffixes.length) return undefined;
    return { root, suffixes };
}

/**
 * The participles of a verb.
 *
 * @param {string} citation - The citation form, folded.
 * @param {Participles} participles - The rule.
 * @returns {string[]} The participles; none where the verb closes on no root
 *   ending.
 */
function participleForms(citation, participles) {
    const ending = participles.root.find(
        (one) => citation.length > one.length && citation.endsWith(one),
    );
    if (ending === undefined) return [];
    const root = citation.slice(0, citation.length - ending.length);
    return participles.suffixes.map(({ suffix, replaces }) => attach(root, suffix, replaces));
}

/**
 * One form a rule derives from a lexicon word.
 *
 * @typedef {object} DerivedForm
 * @property {string} form - The form, folded.
 * @property {Record<string, any>} word - The `data.words` entry it comes from.
 */

/**
 * Every form the language's rules derive from its lexicon words, in
 * `data.words` order, each once, leaving out a form that is a lexicon word.
 *
 * @param {Record<string, any>|undefined} data - The language note's `data`.
 * @returns {DerivedForm[]} The forms.
 */
export function derivedForms(data) {
    const words = listOf(data?.words).filter(
        (word) => isMap(word) && typeof word.form === "string",
    );
    const grammar = isMap(data?.grammar) ? data.grammar : undefined;
    const verbs = verbPattern(grammar?.verbs);
    const replaces = verbs?.replaces === undefined ? undefined : foldWord(verbs.replaces);
    const suffixes = replacingSuffixes(data ?? {});
    const agreement = agreementOf(grammar?.agreement);
    const participles = participlesOf(grammar?.participles, data ?? {});
    const seen = new Set(words.map((word) => foldWord(word.form)));
    const out = [];
    for (const word of words) {
        const add = (form) => {
            const folded = foldWord(form);
            if (!folded || seen.has(folded)) return;
            seen.add(folded);
            out.push({ form: folded, word });
        };
        const folded = foldWord(word.form);
        const base = parseWordClass(word.class).base;
        const plural = pluralOf(word, grammar);
        if (plural) add(plural);
        if (verbs && base === "v")
            for (const { ending } of verbs.endings)
                add(verbForm(folded, foldWord(ending), replaces));
        if (suffixes.length)
            for (const [stem] of word.form.matchAll(WORD)) {
                const one = foldWord(stem);
                for (const { suffix, replaces: closing } of suffixes)
                    add(attach(one, suffix, closing));
            }
        if (agreement && base !== undefined && agreement.classes.has(base))
            for (const form of agreeingForms(folded, agreement, grammar)) add(form);
        if (participles && base === "v")
            for (const participle of participleForms(folded, participles)) {
                add(participle);
                if (agreement)
                    for (const form of agreeingForms(participle, agreement, grammar)) add(form);
            }
    }
    return out;
}

/**
 * The words a language note accepts of its own: its forms, and what its rules
 * derive from them (see {@link derivedForms}), each whole and each part of a
 * compound.
 *
 * @param {Record<string, any>} data - The language note's `data`.
 * @returns {Set<string>} The words, folded.
 */
export function lexiconWords(data) {
    const accepted = new Set();
    for (const word of listOf(data?.words))
        if (isMap(word) && typeof word.form === "string") addWords(accepted, word.form);
    for (const { form } of derivedForms(data)) addWords(accepted, form);
    return accepted;
}
