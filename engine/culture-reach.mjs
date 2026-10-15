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
 * Which terms reach a culture or an affiliation, and whether an affiliation
 * reaches a culture at all.
 *
 * A culture's terms are the words of its language, and the ranks, offices and
 * language words of every affiliation that reaches it — through its own
 * `data.culture`, the one the index resolves for it, or the culture of an
 * affiliation above it through `data.parents` —
 * each affiliation's language being the one its glossary resolves to
 * ({@link module:engine/glossary-language}). An affiliation's terms are its own
 * ranks and offices and the words of that language. A language's words include
 * the words it inherits through `data.family`, and a word is a term only where
 * its class's base is a glossary base. The `dictionary` relation
 * ({@link module:engine/dictionary-rows}) names a glossary entry's term from
 * the same reach.
 *
 * **An affiliation that reaches no culture is a warning**, at its `type`, in a
 * tree that describes peoples, which is a tree holding at least one culture
 * note. A tree holding none describes no peoples, and the rule does not speak
 * there.
 *
 * The corpus is read once per index and kept beside it.
 *
 * @module
 */

import { isAddressTuple, parseAddress, renderAddress } from "./address.mjs";
import { AddressLink } from "./address-values.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { glossaryLanguage } from "./glossary-language.mjs";
import { parseWordClass, WORD_CLASS_BASES } from "./word-classes.mjs";
import { LANGUAGE_SUBTYPE } from "./word-terms.mjs";

/** The bases whose words are glossary terms. */
const GLOSSARY_BASES = new Set(
    WORD_CLASS_BASES.filter((item) => item.glossary).map((item) => item.token),
);

/** A note's parsed frontmatter, whichever shape the index hands over. */
const payload = (note) => note?.fm ?? note ?? {};

/** A note's `data`, or an empty map. */
const dataOf = (note) => {
    const data = payload(note).data;
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
};

/** A note's type, lowercased. */
const typeOf = (note) => String(note?.type ?? payload(note).type ?? "").toLowerCase();

/** A note's subType, lowercased. */
const subTypeOf = (note) => String(payload(note).subType ?? "").toLowerCase();

/** Whether a note is a culture. */
export const isCultureNote = (note) => typeOf(note) === "lore" && subTypeOf(note) === "culture";

/** Whether a note is a language. */
export const isLanguageNote = (note) =>
    typeOf(note) === "skill" && subTypeOf(note) === LANGUAGE_SUBTYPE;

/** A name as the glossary compares it: NFC, case kept. */
export const glossaryName = (name) => String(name ?? "").normalize("NFC");

/**
 * A value's canonical Address as a string, whether the note holds it parsed or
 * as written, or `undefined` where it is no Address.
 *
 * @param {unknown} value - The value.
 * @param {object|undefined} index - The index, for the package and the types.
 * @param {string} type - The type a bare shortcode defaults to.
 * @returns {string|undefined} The Address.
 */
export function addressKeyOf(value, index, type) {
    if (value === undefined || value === null || value === "") return undefined;
    if (isAddressTuple(value)) return renderAddress(value);
    if (value instanceof AddressLink) return renderAddress(value.target);
    if (typeof value !== "string") return undefined;
    const tuple = parseAddress(value, {
        package: index?.contentPackage,
        system: "note",
        type,
        types: index?.types,
        packages: index?.packages,
    });
    return tuple.reason ? undefined : renderAddress(tuple);
}

/** A note's own Address, keyed as a reference to it is: in the `note` system. */
export function ownKey(note, index) {
    const shortcode = payload(note).shortcode;
    if (typeof shortcode !== "string" || !shortcode || !index?.contentPackage) return undefined;
    return renderAddress({
        package: index.contentPackage,
        system: "note",
        type: typeOf(note),
        shortcode,
    });
}

/**
 * Add a sense to a culture's or an affiliation's term.
 *
 * @param {Map<string, Map<string, string[]>>} terms - Note to name to senses.
 * @param {string} culture - The note's Address.
 * @param {unknown} name - The term.
 * @param {unknown} sense - Its sense text.
 */
function addTerm(terms, culture, name, sense) {
    if (typeof name !== "string" || !name.trim()) return;
    if (!terms.has(culture)) terms.set(culture, new Map());
    const byName = terms.get(culture);
    const key = glossaryName(name);
    if (!byName.has(key)) byName.set(key, []);
    if (typeof sense === "string") byName.get(key).push(sense);
}

/**
 * The glossary-base words of every local language note, keyed by the note.
 *
 * @param {readonly object[]} notes - The index's notes.
 * @param {object} index - The index.
 * @returns {Map<string, Array<{form: string, gloss: unknown}>>} Language to its
 *   glossary-base words.
 */
function languageWords(notes, index) {
    const out = new Map();
    for (const note of notes) {
        if (!isLanguageNote(note)) continue;
        const words = dataOf(note).words;
        if (!Array.isArray(words)) continue;
        const language = ownKey(note, index);
        if (!language) continue;
        for (const word of words) {
            if (!word || typeof word !== "object" || typeof word.form !== "string") continue;
            const parsed = parseWordClass(word.class);
            if (parsed.reason || !GLOSSARY_BASES.has(parsed.base)) continue;
            if (!out.has(language)) out.set(language, []);
            out.get(language).push({ form: word.form, gloss: word.gloss });
        }
    }
    return out;
}

/**
 * How the lint reads Addresses and notes for {@link glossaryLanguage}.
 *
 * @param {object} index - The link index.
 * @param {object} note - The owning note.
 * @returns {import("./glossary-language.mjs").GlossaryLanguageReader}
 */
function readerOf(index, note) {
    return {
        keyOf: (value, type) => addressKeyOf(value, index, type),
        lookup: (key) => index.addressHit?.(key),
        self: ownKey(note, index),
    };
}

/**
 * The language a glossary entry on a note resolves to.
 *
 * @param {object} index - The link index.
 * @param {object} note - The culture or affiliation the entry is written on.
 * @param {object|undefined} entry - The entry, or nothing for the note's own.
 * @returns {string|undefined} The language's Address.
 */
export function entryLanguage(index, note, entry) {
    return glossaryLanguage(entry, note, readerOf(index, note));
}

/**
 * What the index says about each culture's and affiliation's terms, read once.
 *
 * @typedef {object} GlossaryCorpus
 * @property {boolean} describesPeoples - The tree holds a culture note.
 * @property {Map<string, Map<string, string[]>>} terms - Each culture's and
 *   affiliation's terms by NFC name, each with the sense texts its sources
 *   give it.
 */

/** @type {WeakMap<object, GlossaryCorpus>} */
const CORPUS = new WeakMap();

/**
 * Add an affiliation's ranks and offices to a note's terms.
 *
 * @param {Map<string, Map<string, string[]>>} terms - Note to name to senses.
 * @param {string} key - The note the terms belong to.
 * @param {object} data - The affiliation's `data`.
 */
function addGovernance(terms, key, data) {
    const ranks = data.governance?.ranks;
    for (const rung of Array.isArray(ranks) ? ranks : [])
        if (rung && typeof rung === "object") addTerm(terms, key, rung.title, rung.description);
    const offices = data.governance?.offices;
    if (offices && typeof offices === "object" && !Array.isArray(offices))
        for (const [title, office] of Object.entries(offices))
            addTerm(terms, key, title, typeof office === "string" ? office : office?.description);
}

/**
 * Every culture an affiliation's terms reach: its own, and the culture of each
 * affiliation above it through `data.parents`.
 *
 * @param {object} index - The link index.
 * @param {object} note - The affiliation.
 * @returns {string[]} The cultures' Addresses.
 */
function reachedCultures(index, note) {
    const out = new Set();
    const seen = new Set();
    const queue = [note];
    while (queue.length) {
        const body = queue.shift();
        if (!body || seen.has(body)) continue;
        seen.add(body);
        const data = dataOf(body);
        const culture = addressKeyOf(data.culture, index, "lore");
        if (culture) out.add(culture);
        for (const parent of Array.isArray(data.parents) ? data.parents : []) {
            const key = addressKeyOf(parent, index, "affiliation");
            const target = key ? index.addressHit?.(key) : undefined;
            if (target && typeOf(target) === "affiliation") queue.push(target);
        }
    }
    return [...out];
}

/**
 * The glossary corpus of an index.
 *
 * @param {object} index - The link index: `notes`, `contentPackage`, `types`.
 * @returns {GlossaryCorpus}
 */
export function glossaryCorpus(index) {
    const cached = CORPUS.get(index);
    if (cached) return cached;
    const notes = index.notes ?? [];
    const words = languageWords(notes, index);
    const families = new Map();
    for (const note of notes)
        if (isLanguageNote(note)) {
            const key = ownKey(note, index);
            if (key) families.set(key, addressKeyOf(dataOf(note).family, index, "skill"));
        }
    const terms = new Map();
    // A language's words include those it inherits through `data.family`.
    const addWords = (key, language) => {
        const seen = new Set();
        for (
            let current = language;
            current && !seen.has(current);
            current = families.get(current)
        ) {
            seen.add(current);
            for (const word of words.get(current) ?? []) addTerm(terms, key, word.form, word.gloss);
        }
    };
    for (const note of notes) {
        const culture = isCultureNote(note);
        if (!culture && typeOf(note) !== "affiliation") continue;
        const key = ownKey(note, index);
        if (!key) continue;
        if (!terms.has(key)) terms.set(key, new Map());
        const data = dataOf(note);
        if (culture) {
            addWords(key, addressKeyOf(data.language, index, "skill"));
            continue;
        }
        addGovernance(terms, key, data);
        addWords(key, entryLanguage(index, note, undefined));
        for (const home of reachedCultures(index, note)) {
            addGovernance(terms, home, data);
            addWords(home, entryLanguage(index, note, undefined));
        }
    }
    const corpus = { describesPeoples: notes.some(isCultureNote), terms };
    CORPUS.set(index, corpus);
    return corpus;
}

/**
 * A culture's or an affiliation's terms, by NFC name, each with the sense
 * texts its sources give.
 *
 * @param {object} index - The link index.
 * @param {object} note - The culture or affiliation note.
 * @returns {Map<string, string[]>} The terms; empty for a note no source reaches.
 */
export function noteTerms(index, note) {
    const key = ownKey(note, index);
    return (key && glossaryCorpus(index).terms.get(key)) || new Map();
}

/**
 * Warn of an affiliation that reaches no culture, its own or one it inherits,
 * in a tree that describes peoples.
 *
 * @param {object} note - An `affiliation` note.
 * @param {{index?: object}} [context]
 * @returns {object[]} One warning, at the note's `type`, or none.
 */
export function checkAffiliationReach(note, { index } = {}) {
    if (!index?.notes || !glossaryCorpus(index).describesPeoples) return [];
    if (addressKeyOf(dataOf(note).culture, index, "lore")) return [];
    return [
        {
            file: note.file,
            ...positionOfFrontmatterPath(note.raw ?? "", ["type"]),
            severity: "warning",
            message:
                "this affiliation reaches no culture, its own or one inherited through " +
                "`data.parents`, so its ranks, offices and language enter no culture's glossary; " +
                "state `data.culture`",
        },
    ];
}
