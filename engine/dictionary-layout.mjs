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
 * An `sql` fence's result set as a dictionary of words, `layout=dictionary`,
 * or as a glossary of terms, `layout=glossary`.
 *
 * A dictionary reads the `dictionary` relation's columns and a glossary the
 * `terms` relation's, or any query returning them. Each needs `name`, `senses`
 * and `usage`, and a result missing one is refused naming it; every other
 * column is read where the query selects it. The output is Markdown, so every
 * surface sets it as it sets a note:
 *
 * - **the key**, once, at the head unless the fence sets `key=false`: the abbreviations this rendering uses,
 *   each with its expansion, then the common mark where an entry carries it.
 *   A fence setting `key=only` prints the key alone;
 * - **a heading per letter**, from `letter`, at the fence's `section-level`;
 * - **one paragraph per entry**: the common mark, the bold headword, the
 *   pronunciation between slashes, the language tag (and for a word its
 *   class) in italics, a word's etymology in brackets, the senses, and the
 *   citations as links.
 *
 * A glossary sets the rows that share a headword and a language as one entry:
 * their senses numbered in the order the rows arrive, each tagged with the
 * bodies it comes from, a sense several rows give printed once with all of
 * them. A word's senses carry no bodies, and a glossary's always do.
 *
 * The entries are ordered here rather than by the query: by letter, then by
 * `name_sort` with its accents taken off and its case folded, then as written.
 * A language tag prints where the entry's language is not the language of the
 * page the fence is on, and an etymology never repeats the entry's own.
 *
 * @module
 */

import { parseAddress, renderAddress } from "./address.mjs";
import { dictionaryLetter } from "./dictionary-rows.mjs";
import {
    WORD_CLASS_BASES,
    WORD_CLASS_MODIFIERS,
    abbreviateWordClass,
    parseWordClass,
} from "./word-classes.mjs";

/** The columns a dictionary or a glossary cannot be set without. */
export const LAYOUT_REQUIRED_COLUMNS = Object.freeze({
    dictionary: Object.freeze(["name", "senses", "usage"]),
    glossary: Object.freeze(["name", "senses", "usage"]),
});

/** The mark a common entry opens with. */
export const COMMON_MARK = "•";

/** What the key says of the common mark. */
const COMMON_KEY = "a common word, which a player is expected to know by heart";

/** Code-point order. */
const compare = (a, b) =>
    a < b ? -1
    : a > b ? 1
    : 0;

/** A sort key with its accents off and its case folded. */
const fold = (text) =>
    String(text ?? "")
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase();

/** A sense as a sentence: a capital first, and a closing stop where none is. */
function sentence(text) {
    const value = String(text ?? "").trim();
    if (!value) return value;
    const opened = value[0].toLocaleUpperCase() + value.slice(1);
    return /[.!?…]$/u.test(opened) ? opened : `${opened}.`;
}

/**
 * @typedef {object} LayoutOptions
 * @property {(ref: object) => boolean} [linkable] - Whether an Address can be
 *   linked to; a citation that cannot prints as its label.
 * @property {number} [sectionLevel=2] - The level of a letter heading.
 * @property {object} [addressContext] - Address resolution context.
 * @property {(address: string) => string|undefined} [labelOf] - A note's
 *   `name.full`, by its Address.
 * @property {boolean|"only"} [showKey=true] - Whether the key is printed;
 *   `"only"` prints the key and nothing else.
 * @property {string} [pageLanguage] - The language of the page the fence is
 *   on, which no entry is tagged with.
 */

/**
 * Render a result of words as a dictionary.
 *
 * @param {{columns: string[], rows: object[]}} result - From
 *   {@link module:engine/sql-tables.runSqlQuery}.
 * @param {LayoutOptions} [opts]
 * @returns {string} The Markdown.
 * @throws {Error} When the result lacks a required column.
 */
export function renderDictionary(result, opts = {}) {
    requireColumns(result, "dictionary");
    return render(
        result.rows.map((row) => ({ ...row, rows: [row] })),
        opts,
        true,
    );
}

/**
 * Render a result of terms as a glossary.
 *
 * @param {{columns: string[], rows: object[]}} result - From
 *   {@link module:engine/sql-tables.runSqlQuery}.
 * @param {LayoutOptions} [opts]
 * @returns {string} The Markdown.
 * @throws {Error} When the result lacks a required column.
 */
export function renderGlossary(result, opts = {}) {
    requireColumns(result, "glossary");
    const entries = new Map();
    for (const row of result.rows) {
        const key = `${row.language ?? ""}\0${row.name}`;
        if (!entries.has(key)) entries.set(key, { ...row, rows: [] });
        entries.get(key).rows.push(row);
    }
    return render(
        [...entries.values()].map((entry) => {
            const senses = [];
            for (const row of entry.rows)
                for (const sense of Array.isArray(row.senses) ? row.senses : []) {
                    const same = senses.find((one) => one.text === sense?.text);
                    const bodies = Array.isArray(sense?.bodies) ? sense.bodies : [];
                    if (!same) senses.push({ text: sense?.text, bodies: [...bodies] });
                    else
                        for (const body of bodies)
                            if (!same.bodies.includes(body)) same.bodies.push(body);
                }
            for (const sense of senses) sense.bodies.sort(compare);
            const first = (column) =>
                entry.rows.map((row) => row[column]).find((value) => value != null && value !== "");
            return {
                ...entry,
                senses,
                usage: [...new Set(entry.rows.flatMap((row) => row.usage ?? []))].sort(compare),
                common: entry.rows.some((row) => row.common === true),
                pronunciation: first("pronunciation"),
                name_sort: first("name_sort"),
                letter: first("letter"),
                class: undefined,
                etymology: undefined,
            };
        }),
        opts,
        false,
    );
}

/** Refuse a result missing a column its layout needs, naming the column. */
function requireColumns(result, layout) {
    const columns = new Set(result.columns);
    for (const column of LAYOUT_REQUIRED_COLUMNS[layout])
        if (!columns.has(column))
            throw new Error(
                `layout=${layout} needs the column "${column}", and the query does not select it`,
            );
}

/**
 * Set entries as Markdown.
 *
 * @param {object[]} entries - One per entry, with the row columns.
 * @param {LayoutOptions} opts
 * @param {boolean} words - Whether the entries are words, with a class and an
 *   etymology.
 * @returns {string}
 */
function render(
    entries,
    {
        linkable = () => true,
        sectionLevel = 2,
        addressContext,
        labelOf = () => undefined,
        showKey = true,
        pageLanguage,
    },
    words,
) {
    const label = (address) => labelOf(address) ?? address;
    const usedTags = new Map();
    const usedBases = new Set();
    const usedModifiers = new Set();
    let anyCommon = false;

    const cite = (address) => {
        const text = label(address);
        const ref = parseAddress(address, addressContext ?? {}, { declared: true });
        if (ref.reason || !linkable(ref)) return text;
        return `[[${renderAddress(ref)}|${String(text).replace(/\|/g, "/")}]]`;
    };
    const tag = (language, text) => {
        if (!text) return "";
        if (!usedTags.has(text)) usedTags.set(text, language);
        return text;
    };

    const sorted = entries.map((row) => {
        const sortKey = String(row.name_sort ?? row.name ?? "");
        return { row, letter: String(row.letter ?? dictionaryLetter(sortKey)), sortKey };
    });
    sorted.sort(
        (a, b) =>
            compare(a.letter, b.letter) ||
            compare(fold(a.sortKey), fold(b.sortKey)) ||
            compare(a.sortKey, b.sortKey) ||
            compare(String(a.row.name), String(b.row.name)) ||
            compare(String(a.row.language_tag ?? ""), String(b.row.language_tag ?? "")),
    );

    const paragraphs = [];
    let letter;
    for (const { row, letter: current } of sorted) {
        if (current !== letter) {
            letter = current;
            paragraphs.push(`${"#".repeat(sectionLevel)} ${letter}`);
        }
        const parts = [];
        if (row.common === true) {
            anyCommon = true;
            parts.push(COMMON_MARK);
        }
        parts.push(`**${row.name}**`);
        if (row.pronunciation) parts.push(`/${row.pronunciation}/`);

        const italic = [];
        if (row.language_tag && row.language !== pageLanguage)
            italic.push(tag(row.language, row.language_tag));
        if (words && row.class) {
            const parsed = parseWordClass(row.class);
            if (!parsed.reason) {
                usedBases.add(parsed.base);
                for (const token of parsed.modifiers) usedModifiers.add(token);
                italic.push(abbreviateWordClass(parsed));
            } else italic.push(String(row.class));
        }
        if (italic.length) parts.push(`_${italic.join(" ")}_`);

        if (words) {
            const bracket = etymologyText(row.etymology, row.language, tag);
            if (bracket) parts.push(`[${bracket}]`);
        }

        const senses = Array.isArray(row.senses) ? row.senses : [];
        const senseText = (sense) => {
            const bodies = Array.isArray(sense?.bodies) ? sense.bodies : [];
            const by = bodies.length ? `(_${bodies.map(label).join(", ")}_) ` : "";
            return `${by}${sentence(sense?.text)}`;
        };
        if (senses.length === 1) parts.push(senseText(senses[0]));
        else senses.forEach((sense, i) => parts.push(`**${i + 1}** ${senseText(sense)}`));

        const usage = Array.isArray(row.usage) ? row.usage : [];
        let line = parts.join(" ");
        if (usage.length) line += ` — ${usage.map(cite).join(", ")}`;
        paragraphs.push(line);
    }

    const key = [];
    for (const [text, language] of [...usedTags].sort((a, b) => compare(a[0], b[0]))) {
        const expansion = language ? labelOf(language) : undefined;
        if (expansion && expansion !== text) key.push(`_${text}_ ${expansion}`);
    }
    for (const base of WORD_CLASS_BASES)
        if (usedBases.has(base.token))
            key.push(`_${base.abbreviation ?? base.token}_ ${base.expansion}`);
    for (const modifier of WORD_CLASS_MODIFIERS)
        if (usedModifiers.has(modifier.token))
            key.push(`_${modifier.abbreviation}_ ${modifier.expansion}`);
    if (anyCommon) key.push(`${COMMON_MARK} ${COMMON_KEY}`);
    const line = key.length ? `**Key:** ${key.join("; ")}.` : "";
    if (showKey === "only") return line;
    if (showKey && line) paragraphs.unshift(line);
    return paragraphs.join("\n\n");
}

/**
 * An etymology as the bracket prints it, without the brackets, or the empty
 * string where it says nothing.
 *
 * @param {object|null|undefined} etymology - The row's `etymology`.
 * @param {string|null|undefined} own - The entry's own language.
 * @param {(language: string, text: string) => string} tag - Records and
 *   returns a language tag.
 * @returns {string}
 */
function etymologyText(etymology, own, tag) {
    if (!etymology || typeof etymology !== "object") return "";
    const pieces = [];
    const tongue =
        etymology.language && etymology.language !== own ?
            tag(etymology.language, etymology.language_tag)
        :   "";
    const form = etymology.form ? `_${etymology.form}_` : "";
    switch (etymology.kind) {
        case "borrowed":
            pieces.push(["fr.", tongue, form].filter(Boolean).join(" "));
            break;
        case "inherited":
        case "kept":
        case "worn":
            if (form || tongue) pieces.push([tongue, form && `*${form}`].filter(Boolean).join(" "));
            break;
        case "coined":
        case "substrate":
        case "island":
            pieces.push(etymology.kind);
            break;
        default:
            break;
    }
    if (Array.isArray(etymology.parts) && etymology.parts.length)
        pieces.push(
            etymology.parts
                .map((part) => `_${part.form}_${part.gloss ? ` "${part.gloss}"` : ""}`)
                .join(" + "),
        );
    const skeleton = [
        etymology.root ? `root _${etymology.root}_` : "",
        etymology.frame ? `pattern _${etymology.frame}_` : "",
    ]
        .filter(Boolean)
        .join(", ");
    if (skeleton) pieces.push(skeleton);
    return pieces.filter(Boolean).join("; ");
}
