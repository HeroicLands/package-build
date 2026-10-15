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
 * The rows of the SQL `words` and `glossary` relations, read from index
 * records whose Addresses are already strings.
 *
 * `words` is one row per `data.words` entry of every language note, keyed by
 * that note, and `glossary` one row per `data.glossary` entry of every culture
 * and affiliation, with the language the entry resolves to
 * ({@link module:engine/glossary-language}). **Every row has every column**:
 * the keys come from {@link module:engine/word-terms}, so a key no entry in a
 * corpus writes is still a column, `NULL` in every row, and a fence naming it
 * binds.
 *
 * A word row holds the words its own note states, and nothing is copied for a
 * daughter language. `language_lineage` is one row per language and each of
 * its ancestors through `data.family`, itself included at depth `0`, so a
 * language's words with its inherited ones are a join of the two.
 *
 * @module
 */

import { renderAddress } from "./address.mjs";
import { glossaryLanguage } from "./glossary-language.mjs";
import {
    AFFIX_KEYS,
    FIELD_KEYS,
    GLOSSARY_ENTRY_KEYS,
    LANGUAGE_SUBTYPE,
    WORD_KEYS,
} from "./word-terms.mjs";

/** The columns a word row carries before the word's own keys. */
const WORD_IDENTITY_COLUMNS = Object.freeze(["language", "position"]);

/** The columns a word row derives after the word's own keys. */
const WORD_DERIVED_COLUMNS = Object.freeze(["built_text", "built_parts"]);

/** Every column of the `words` relation, in order. */
export const WORD_COLUMNS = Object.freeze([
    ...WORD_IDENTITY_COLUMNS,
    ...WORD_KEYS,
    ...WORD_DERIVED_COLUMNS,
]);

/** Every column of the `glossary` relation, in order. */
export const GLOSSARY_COLUMNS = Object.freeze(["note", "position", ...GLOSSARY_ENTRY_KEYS]);

/** Every column of the `affixes` relation, in order. */
export const AFFIX_COLUMNS = Object.freeze([...WORD_IDENTITY_COLUMNS, ...AFFIX_KEYS]);

/** Every column of the `fields` relation, in order. */
export const FIELD_COLUMNS = Object.freeze([...WORD_IDENTITY_COLUMNS, ...FIELD_KEYS]);

/** Every column of the `language_lineage` relation, in order. */
export const LINEAGE_COLUMNS = Object.freeze(["language", "ancestor", "depth"]);

/** The columns of any of these relations that hold a whole number. */
export const ROW_INTEGER_COLUMNS = Object.freeze(["position", "depth"]);

/** Whether a value is a plain map. */
const isMap = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** A piece's form with its joining hyphens taken off, for a second match. */
const bare = (form) => String(form).replace(/^-+|-+$/g, "");

/**
 * A lookup from a built piece to its gloss, over the words (stems included)
 * and affixes of one or more languages.
 *
 * Languages are given nearest first: a language's own words, then its own
 * affixes, then the next language's, so a daughter's entry wins over its
 * parent's. A piece matches an entry written exactly as it is, and failing
 * that one written with the same letters and different joining hyphens, so
 * `wulf-` finds the word `wulf`. Within a language a word's own gloss wins over
 * an affix's.
 *
 * @param {...object} datas - Each language note's `data`, nearest first.
 * @returns {(piece: string) => string|null} The gloss, or `null` where none resolves.
 */
export function pieceGlosses(...datas) {
    const exact = new Map();
    const loose = new Map();
    const take = (entries) => {
        for (const entry of Array.isArray(entries) ? entries : []) {
            if (!isMap(entry) || typeof entry.form !== "string" || typeof entry.gloss !== "string")
                continue;
            if (!exact.has(entry.form)) exact.set(entry.form, entry.gloss);
            if (!loose.has(bare(entry.form))) loose.set(bare(entry.form), entry.gloss);
        }
    };
    for (const data of datas) {
        take(data?.words);
        take(data?.affixes);
    }
    return (piece) => exact.get(piece) ?? loose.get(bare(piece)) ?? null;
}

/**
 * The chain of languages from one up through `data.family`: the language
 * itself, then its parent, and so on. The chain stops at a parent that is no
 * language, and before a language it has already reached, so a cycle the lint
 * refuses still yields a finite chain. `language_lineage`, the dictionary and
 * the resolution of built pieces all walk it.
 *
 * @param {string|undefined} start - The language's key.
 * @param {object} reader
 * @param {(key: string) => boolean} reader.has - Whether a key is a language.
 * @param {(key: string) => string|undefined} reader.parentOf - A language's
 *   parent key, where it states one.
 * @returns {string[]} The keys, nearest first.
 */
export function lineageChain(start, { has, parentOf }) {
    const chain = [];
    const seen = new Set();
    for (let current = start; current && has(current) && !seen.has(current);) {
        seen.add(current);
        chain.push(current);
        current = parentOf(current) || undefined;
    }
    return chain;
}

/** A language record's `data.family` where it is a plain Address string. */
const familyKey = (record) => {
    const family = record?.data?.family;
    return typeof family === "string" && family ? family : undefined;
};

/**
 * A lookup of language records by Address, and the chain walk over them.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {{languages: Map<string, object>, chain: (key: string) => string[]}}
 */
export function languageLineages(records) {
    const languages = new Map();
    for (const record of records)
        if (isLanguageRecord(record)) {
            const key = noteAddressOf(record);
            if (key && !languages.has(key)) languages.set(key, record);
        }
    const reader = {
        has: (key) => languages.has(key),
        parentOf: (key) => familyKey(languages.get(key)),
    };
    return { languages, chain: (key) => lineageChain(key, reader) };
}

/**
 * Whether a record is a language note's.
 *
 * @param {Record<string, any>} record - An index record.
 * @returns {boolean}
 */
export function isLanguageRecord(record) {
    return record?.type === "skill" && record?.subType === LANGUAGE_SUBTYPE;
}

/**
 * A record's Address as a reference to it is written: in the `note` system,
 * so it compares equal to the Addresses other notes state.
 *
 * @param {Record<string, any>} record - An index record.
 * @returns {string|null} The Address, or `null` for a record naming no note.
 */
function noteAddressOf(record) {
    if (!record?.package || !record.type || !record.shortcode) return null;
    return renderAddress({
        package: String(record.package),
        system: "note",
        type: String(record.type),
        shortcode: String(record.shortcode),
    });
}

/**
 * The `words` rows of a set of index records.
 *
 * A row's `language` is the note that states it.
 *
 * @param {Iterable<Record<string, any>>} records - Index records, every
 *   Address a string, already narrowed to the audience being published to.
 * @param {Iterable<Record<string, any>>} [all] - Every record of the package,
 *   for resolving a built piece through an ancestor the audience does not see.
 * @returns {object[]} One row per word, in record then entry order.
 */
export function wordRows(records, all = records) {
    const { languages, chain } = languageLineages(all);
    const rows = [];
    for (const record of records) {
        if (!isLanguageRecord(record)) continue;
        const words = record.data?.words;
        if (!Array.isArray(words) || !words.length) continue;
        const language = noteAddressOf(record);
        if (!language) continue;
        const glossOf = pieceGlosses(...chain(language).map((key) => languages.get(key).data));
        words.forEach((entry, position) => {
            if (!isMap(entry)) return;
            const row = { language, position };
            for (const key of WORD_KEYS) row[key] = entry[key] ?? null;
            if (row.name_sort === null) row.name_sort = row.form;
            const built = Array.isArray(entry.built) ? entry.built.map(String) : [];
            row.built_text = built.length ? built.join(" + ") : null;
            row.built_parts =
                built.length ? built.map((form) => ({ form, gloss: glossOf(form) })) : null;
            rows.push(row);
        });
    }
    return rows;
}

/**
 * The rows of one list a language note states beside its words: one per entry,
 * keyed by the note, with every key of the entry a column.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @param {string} list - The `data` key holding the entries.
 * @param {readonly string[]} keys - The keys an entry carries.
 * @returns {object[]} One row per entry, in record then entry order.
 */
function languageListRows(records, list, keys) {
    const rows = [];
    for (const record of records) {
        if (!isLanguageRecord(record)) continue;
        const entries = record.data?.[list];
        if (!Array.isArray(entries) || !entries.length) continue;
        const language = noteAddressOf(record);
        if (!language) continue;
        entries.forEach((entry, position) => {
            if (!isMap(entry)) return;
            const row = { language, position };
            for (const key of keys) row[key] = entry[key] ?? null;
            rows.push(row);
        });
    }
    return rows;
}

/**
 * The `affixes` rows of a set of index records: one per `data.affixes` entry
 * of a language note, which is the row's `language`.
 *
 * @param {Iterable<Record<string, any>>} records - Index records, every
 *   Address a string, already narrowed to the audience being published to.
 * @returns {object[]} One row per affix, in record then entry order.
 */
export function affixRows(records) {
    return languageListRows(records, "affixes", AFFIX_KEYS);
}

/**
 * The `fields` rows of a set of index records: one per `data.fields` entry of
 * a language note, which is the row's `language`.
 *
 * @param {Iterable<Record<string, any>>} records - Index records, every
 *   Address a string, already narrowed to the audience being published to.
 * @returns {object[]} One row per field, in record then entry order.
 */
export function fieldRows(records) {
    return languageListRows(records, "fields", FIELD_KEYS);
}

/**
 * The `glossary` rows of a set of index records: one per entry of a culture's
 * or an affiliation's `data.glossary`, with `name_sort` the name and `common`
 * `false` where the entry leaves them unstated, and `language` the language
 * the entry resolves to, or `NULL` where it resolves to none.
 *
 * @param {Iterable<Record<string, any>>} records - Index records, every
 *   Address a string, already narrowed to the audience being published to.
 * @param {Iterable<Record<string, any>>} [all] - Every record of the package,
 *   for resolving a language through a note the audience does not see.
 * @returns {object[]} One row per entry, in record then entry order.
 */
export function glossaryRows(records, all = records) {
    const byAddress = new Map();
    for (const record of all) {
        const key = noteAddressOf(record);
        if (key && !byAddress.has(key)) byAddress.set(key, record);
    }
    const reader = {
        keyOf: (value) => (typeof value === "string" && value ? value : undefined),
        lookup: (key) => byAddress.get(key),
    };
    const rows = [];
    for (const record of records) {
        const owner =
            record?.type === "affiliation" ||
            (record?.type === "lore" && record?.subType === "culture");
        if (!owner) continue;
        const entries = record.data?.glossary;
        if (!Array.isArray(entries) || !entries.length) continue;
        const note = noteAddressOf(record);
        if (!note) continue;
        entries.forEach((entry, position) => {
            if (!isMap(entry) || typeof entry.name !== "string") return;
            const row = { note, position };
            for (const key of GLOSSARY_ENTRY_KEYS) row[key] = entry[key] ?? null;
            if (row.name_sort === null) row.name_sort = row.name;
            if (row.common === null) row.common = false;
            row.language = glossaryLanguage(entry, record, { ...reader, self: note }) ?? null;
            rows.push(row);
        });
    }
    return rows;
}

/**
 * The `language_lineage` rows of a set of index records: for each language
 * note, itself at depth `0`, its `data.family` at depth `1`, and so on up the
 * chain. The chain stops at a parent that is no language note of the package,
 * and before a language it has already reached, so a cycle the lint refuses
 * still yields finite rows.
 *
 * @param {Iterable<Record<string, any>>} records - Index records, every
 *   Address a string, already narrowed to the audience being published to.
 * @param {Iterable<Record<string, any>>} [all] - Every record of the package,
 *   for following a chain through a note the audience does not see.
 * @returns {object[]} One row per language and ancestor, in record then depth order.
 */
export function lineageRows(records, all = records) {
    const { chain } = languageLineages(all);
    const rows = [];
    for (const record of records) {
        if (!isLanguageRecord(record)) continue;
        const language = noteAddressOf(record);
        if (!language) continue;
        chain(language).forEach((ancestor, depth) => rows.push({ language, ancestor, depth }));
    }
    return rows;
}
