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
 * The notes that cite a language's words, read from the notes' prose and from
 * the names their frontmatter carries.
 *
 * **A marked use is an italic span of a note's body**: `_vazhmadêr_` or
 * `*vazhmadêr*`, holding text alone — a span holding a link, a code span or
 * other markup is no use, and neither is anything in a code fence. A use cites
 * every word, of every language note of the package, whose form or one of
 * whose `variants` it spells, compared with diacritics taken off and case
 * folded, so `_Vazhmadêr_` and `_vazhmader_` both cite `vazhmadêr`. An
 * italic span that spells no word cites nothing.
 *
 * **A note also cites a word its frontmatter names whole**: a full name or an
 * alias, or an affiliation's rank or office title, that spells the word's form
 * or a variant under the same folding. A word found only inside a longer name
 * is no citation.
 *
 * A language note never cites its own words, and its own body cites nothing:
 * its italics are the words it describes. The index carries what this derives as each language record's
 * `citations` — the citing notes' Addresses, never their text — and the
 * `attested` column of the `words` relation and the `usage` of a `dictionary`
 * entry read it.
 *
 * @module
 */

import MarkdownIt from "markdown-it";

import { isLanguageRecord, noteAddressOf } from "./word-rows.mjs";

/** The parser marked uses are read with: CommonMark's emphasis and nothing added. */
const PARSER = new MarkdownIt("commonmark");

/** Code-point order, so a list is the same on every machine. */
const compare = (a, b) =>
    a < b ? -1
    : a > b ? 1
    : 0;

/** Whether a value is a plain map. */
const isMap = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * A form as uses are matched against it: diacritics taken off, case folded.
 *
 * @param {unknown} text - A form or a use.
 * @returns {string} The folded form.
 */
export function foldForm(text) {
    return String(text ?? "")
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .normalize("NFC")
        .trim();
}

/**
 * The marked uses in a note's body: the text of every italic span that holds
 * text alone, in document order.
 *
 * @param {string} body - The note's Markdown body.
 * @returns {string[]} Each span's text.
 */
export function markedUses(body) {
    const text = String(body ?? "");
    if (!/[_*]/.test(text)) return [];
    const uses = [];
    for (const token of PARSER.parse(text, {})) {
        if (token.type !== "inline" || !token.children) continue;
        let span;
        for (const child of token.children) {
            if (child.type === "em_open") span = [];
            else if (child.type === "em_close") {
                if (span) {
                    const use = span.join("").trim();
                    if (use && !use.includes("[[")) uses.push(use);
                }
                span = undefined;
            } else if (span) {
                if (child.type === "text") span.push(child.content);
                else span = undefined;
            }
        }
    }
    return uses;
}

/**
 * The names a note carries whole, which cite a word they spell exactly: its
 * full name and aliases, and an affiliation's rank and office titles.
 *
 * @param {Record<string, any>} record - An index record.
 * @returns {string[]}
 */
function namesCarried(record) {
    const out = [];
    const name = isMap(record.name) ? record.name : {};
    if (typeof name.full === "string") out.push(name.full);
    for (const alias of Array.isArray(name.aliases) ? name.aliases : [])
        if (typeof alias === "string") out.push(alias);
    const governance = isMap(record.data?.governance) ? record.data.governance : {};
    for (const rank of Array.isArray(governance.ranks) ? governance.ranks : [])
        if (isMap(rank) && typeof rank.title === "string") out.push(rank.title);
    if (isMap(governance.offices)) out.push(...Object.keys(governance.offices));
    return out;
}

/**
 * Each language note's cited words: for every word some note's marked use
 * spells, the Addresses of the notes citing it.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @param {Iterable<{record: Record<string, any>, body: string}>} notes - The
 *   notes whose bodies are read, each with its record.
 * @returns {Map<string, Map<string, string[]>>} By language Address, by the
 *   word's form, the citing notes in code-point order.
 */
export function wordCitations(records, notes) {
    const byFold = new Map();
    for (const record of records) {
        if (!isLanguageRecord(record)) continue;
        const language = noteAddressOf(record);
        if (!language) continue;
        for (const word of Array.isArray(record.data?.words) ? record.data.words : []) {
            if (!isMap(word) || typeof word.form !== "string") continue;
            const spellings = [
                word.form,
                ...(Array.isArray(word.variants) ? word.variants : []).filter(
                    (variant) => typeof variant === "string",
                ),
            ];
            for (const spelling of spellings) {
                const fold = foldForm(spelling);
                if (!fold) continue;
                if (!byFold.has(fold)) byFold.set(fold, []);
                byFold.get(fold).push({ language, form: word.form });
            }
        }
    }
    const cited = new Map();
    if (!byFold.size) return cited;
    /** Cite every word a folded spelling matches from `note`, never from its own language. */
    const cite = (note, fold) => {
        for (const { language, form } of byFold.get(fold) ?? []) {
            if (language === note) continue;
            if (!cited.has(language)) cited.set(language, new Map());
            const words = cited.get(language);
            if (!words.has(form)) words.set(form, new Set());
            words.get(form).add(note);
        }
    };
    for (const { record, body } of notes) {
        if (isLanguageRecord(record)) continue;
        const note = noteAddressOf(record);
        if (!note) continue;
        for (const fold of new Set(markedUses(body).map(foldForm))) cite(note, fold);
    }
    for (const record of records) {
        if (record?.documents || record?.type === "folder") continue;
        const note = noteAddressOf(record);
        if (!note) continue;
        for (const name of namesCarried(record)) cite(note, foldForm(name));
    }
    const out = new Map();
    for (const [language, words] of cited)
        out.set(language, new Map([...words].map(([form, set]) => [form, [...set].sort(compare)])));
    return out;
}

/**
 * Set each language record's `citations` from {@link wordCitations}: one entry
 * per cited word, in the order the words stand, `{ form, notes }`. A language
 * with no cited word carries no `citations`.
 *
 * @param {Record<string, any>[]} records - Index records, written in place.
 * @param {Iterable<{record: Record<string, any>, body: string}>} notes - The
 *   notes whose bodies are read.
 * @returns {void}
 */
export function attachCitations(records, notes) {
    const cited = wordCitations(records, notes);
    for (const record of records) {
        if (!isLanguageRecord(record)) continue;
        const words = cited.get(noteAddressOf(record) ?? "");
        if (!words) continue;
        const citations = [];
        for (const word of record.data.words)
            if (isMap(word) && words.has(word.form))
                citations.push({ form: word.form, notes: words.get(word.form) });
        record.citations = citations;
    }
}
