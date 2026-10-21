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
 * **Mapping notes: code point sequences rewritten into code points.** A `doc`
 * note's `data.map` names a mapping and lists its rows; a run marked `map=`
 * with that name has its text rewritten by them before it is set.
 *
 * ```yaml
 * data:
 *   map:
 *     name: vyl-semaron
 *     vowels: "aeiouAEIOU"
 *     rows:
 *       - [a, "\U000F0230"]
 *       - [aa, "\U000F0248"]
 *       - {from: y, to: "\U000F0237", before: consonant}
 * ```
 *
 * - **A row** is `[from, to]`, or `{from, to, before?, at?}`. `from` is one or
 *   more characters and `to` any number, none included.
 * - **The longest `from` wins.** Among rows of one length, a row with a
 *   condition that holds comes before a row with none, and otherwise the
 *   earlier row wins. A row whose condition fails is skipped.
 * - **`before: vowel`** holds when the next character is one of the map's
 *   `vowels`; **`before: consonant`** when it is any other letter. Neither
 *   holds at the end of the text.
 * - **`at: start`** holds at the first character of the text, or after
 *   whitespace or punctuation; **`at: end`** mirrors it at the match's end.
 * - **A character no row matches passes through unchanged.**
 *
 * - **A word with a native form.** Given a lookup from a language's lexicon,
 *   each word of the text (see {@link module:engine/word-pattern.WORD}) is
 *   looked up as written and then in lowercase; a word found is written by its
 *   native form as one piece, and every other word, and everything between
 *   words, is spelled by the rows.
 * - **A capital on a word found in lowercase** is the rows' own: the word's
 *   first sound is mapped as written and in lowercase, and where the native
 *   form begins with the lowercase result, that beginning is replaced by the
 *   capital one. Where the native form begins otherwise, the piece is marked
 *   `uncapitalised`, which a run reports; the capitalised word is then stated
 *   as a lexicon word of its own.
 *
 * - **A logographic map** (`logographic: true`) writes every word, a word
 *   being a match of the word pattern that holds a letter, by the writing a
 *   lookup gives it (see {@link module:engine/logographic}), and its rows
 *   write only the text between words: spaces, points, and anything else
 *   with no letter. A word the lookup gives no writing is written as typed
 *   and marked `unwritten`, which a run reports. A row of such a map whose
 *   `from` holds a letter could never apply, and is refused.
 *
 * `rows` is a list, never a keyed map, so `A` and `a` are two rows: the index
 * carries them as rows of the `maps` relation, never as struct keys.
 *
 * @module
 */

import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { isNoteRecord } from "./index-records.mjs";
import { WORD } from "./word-pattern.mjs";

/** What a map's `name` may be. */
export const MAP_NAME = /^[a-z0-9-]+$/;

/** Each condition a row may carry, and the values it takes. */
export const MAP_CONDITIONS = Object.freeze({
    before: Object.freeze(["vowel", "consonant"]),
    at: Object.freeze(["start", "end"]),
});

/** The generic families, which a map's `fonts` may not list. */
export const GENERIC_FAMILIES = Object.freeze(["mono", "serif", "sans"]);

/** The keys a row written as a map takes. */
const ROW_KEYS = Object.freeze(["from", "to", "before", "at"]);

/** A letter, for `before: consonant`. */
const LETTER = /\p{L}/u;

/** What `at:` reads as a boundary beside a match. */
const BOUNDARY = /[\s\p{P}\p{S}]/u;

/**
 * One row, read.
 *
 * @typedef {object} MapRow
 * @property {string} from - The characters it matches.
 * @property {string} to - What it writes in their place.
 * @property {"vowel"|"consonant"} [before] - What must follow the match.
 * @property {"start"|"end"} [at] - Where the match must sit.
 */

/**
 * A map ready to apply.
 *
 * @typedef {object} TextMap
 * @property {string} name - Its name.
 * @property {boolean} logographic - Whether it writes words from the lexicon
 *   alone, its rows only between them.
 * @property {ReadonlySet<string>} vowels - The characters `before: vowel` reads.
 * @property {readonly MapRow[]} rows - Its well-formed shared rows, in authored order.
 * @property {ReadonlyMap<string, readonly MapRow[]>} byFirst - Its shared rows
 *   by the first character of `from`, longest first, conditioned before plain.
 * @property {ReadonlyMap<string, {rows: readonly MapRow[], byFirst: ReadonlyMap<string, readonly MapRow[]>}>} fonts -
 *   Each listed face by slug, in listed order, with its own rows.
 */

/**
 * How a text is mapped beyond the rows.
 *
 * @typedef {object} MapOptions
 * @property {string} [font] - The face the text is set in, whose own rows are
 *   tried first.
 * @property {(word: string) => string|undefined} [native] - A word's native
 *   form, for the word exactly as given, or `undefined` where it states none.
 * @property {(word: string) => import("./logographic.mjs").Writing} [writing] -
 *   A word's writing under a logographic map; without one, no word has one.
 */

/**
 * Whether a value is a plain map.
 *
 * @param {unknown} value - Anything.
 * @returns {boolean} Whether it is an object that is not a list.
 */
function isMap(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read one authored row.
 *
 * @param {unknown} row - The row as YAML gave it.
 * @returns {{row: MapRow}|{problem: string, key?: string}} The row, or what is
 *   wrong with it and the key the fault sits at.
 */
export function readMapRow(row) {
    if (Array.isArray(row)) {
        if (row.length !== 2 || typeof row[0] !== "string" || typeof row[1] !== "string")
            return {
                problem: "is a list, and a row written as a list is two strings, `[from, to]`",
            };
        if (row[0] === "")
            return { problem: "has an empty `from`; a row matches one or more characters" };
        return { row: { from: row[0], to: row[1] } };
    }
    if (!isMap(row)) return { problem: "is neither `[from, to]` nor `{from, to, before?, at?}`" };
    const map = /** @type {Record<string, unknown>} */ (row);
    for (const key of Object.keys(map))
        if (!ROW_KEYS.includes(key))
            return {
                problem: `has \`${key}\`, which is not a row key; a row takes \`from\`, \`to\`, \`before\` and \`at\``,
                key,
            };
    if (typeof map.from !== "string" || map.from === "")
        return {
            problem: "needs `from`, the one or more characters the row matches",
            ...(map.from === undefined ? {} : { key: "from" }),
        };
    if (typeof map.to !== "string")
        return {
            problem: "needs `to`, the characters the row writes, which may be empty",
            ...(map.to === undefined ? {} : { key: "to" }),
        };
    const read = /** @type {MapRow} */ ({ from: map.from, to: map.to });
    for (const [condition, allowed] of Object.entries(MAP_CONDITIONS)) {
        const value = map[condition];
        if (value === undefined) continue;
        if (typeof value !== "string" || !allowed.includes(value))
            return {
                problem: `has \`${condition}: ${String(value)}\`; \`${condition}\` is ${allowed.map((word) => `\`${word}\``).join(" or ")}`,
                key: condition,
            };
        read[condition] = value;
    }
    return { row: read };
}

/**
 * Rows by the first character of `from`, longest first, conditioned before
 * plain, then in authored order.
 *
 * @param {readonly MapRow[]} rows - Well-formed rows.
 * @returns {ReadonlyMap<string, readonly MapRow[]>} The index.
 */
function indexRows(rows) {
    const byFirst = new Map();
    rows.forEach((row, order) => {
        const first = String.fromCodePoint(/** @type {number} */ (row.from.codePointAt(0)));
        if (!byFirst.has(first)) byFirst.set(first, []);
        byFirst.get(first).push({ row, order });
    });
    for (const [first, list] of byFirst) {
        list.sort(
            (a, b) =>
                b.row.from.length - a.row.from.length ||
                Number(Boolean(b.row.before || b.row.at)) -
                    Number(Boolean(a.row.before || a.row.at)) ||
                a.order - b.order,
        );
        byFirst.set(first, Object.freeze(list.map(({ row }) => row)));
    }
    return byFirst;
}

/**
 * The well-formed rows of an authored list.
 *
 * @param {unknown} list - The rows as YAML gave them.
 * @returns {readonly MapRow[]} The rows that read.
 */
function readRows(list) {
    const rows = [];
    for (const authored of Array.isArray(list) ? list : []) {
        const read = readMapRow(authored);
        if ("row" in read) rows.push(Object.freeze(read.row));
    }
    return Object.freeze(rows);
}

/**
 * Compile a `data.map` value, keeping its well-formed rows.
 *
 * @param {unknown} value - The note's `data.map`.
 * @returns {TextMap|undefined} The map, or `undefined` when it has no valid name.
 */
export function compileMap(value) {
    if (!isMap(value)) return undefined;
    const map = /** @type {Record<string, unknown>} */ (value);
    if (typeof map.name !== "string" || !MAP_NAME.test(map.name)) return undefined;
    const vowels = new Set(typeof map.vowels === "string" ? Array.from(map.vowels) : []);
    const rows = readRows(map.rows);
    const fonts = new Map();
    for (const entry of Array.isArray(map.fonts) ? map.fonts : []) {
        if (!isMap(entry) || typeof entry.font !== "string" || fonts.has(entry.font)) continue;
        const own = readRows(entry.rows);
        fonts.set(entry.font, Object.freeze({ rows: own, byFirst: indexRows(own) }));
    }
    return Object.freeze({
        name: map.name,
        logographic: map.logographic === true,
        vowels,
        rows,
        byFirst: indexRows(rows),
        fonts,
    });
}

/**
 * Whether a row's conditions hold for a match.
 *
 * @param {MapRow} row - The row.
 * @param {string} text - The whole text.
 * @param {number} from - The match's first UTF-16 offset.
 * @param {number} to - The offset past the match.
 * @param {ReadonlySet<string>} vowels - The map's vowels.
 * @returns {boolean} Whether every condition holds.
 */
function holds(row, text, from, to, vowels) {
    if (row.before) {
        const next = text.codePointAt(to);
        if (next === undefined) return false;
        const char = String.fromCodePoint(next);
        const vowel = vowels.has(char);
        if (row.before === "vowel" ? !vowel : vowel || !LETTER.test(char)) return false;
    }
    if (row.at === "start" && from > 0 && !BOUNDARY.test(text[from - 1])) return false;
    if (row.at === "end" && to < text.length && !BOUNDARY.test(text[to])) return false;
    return true;
}

/**
 * The row that matches at an offset: the font's own rows first, then the
 * shared ones.
 *
 * @param {TextMap} map - The map.
 * @param {string|undefined} font - The face.
 * @param {string} text - The whole text.
 * @param {number} at - The offset.
 * @param {number} limit - The offset no match may run past.
 * @returns {MapRow|undefined} The row.
 */
function rowAt(map, font, text, at, limit) {
    const char = String.fromCodePoint(/** @type {number} */ (text.codePointAt(at)));
    const tiers = [font === undefined ? undefined : map.fonts?.get(font)?.byFirst, map.byFirst];
    for (const byFirst of tiers) {
        const row = byFirst
            ?.get(char)
            ?.find(
                (candidate) =>
                    at + candidate.from.length <= limit &&
                    text.startsWith(candidate.from, at) &&
                    holds(candidate, text, at, at + candidate.from.length, map.vowels),
            );
        if (row) return row;
    }
    return undefined;
}

/**
 * Apply the rows alone.
 *
 * @param {TextMap|undefined} map - The map.
 * @param {string} text - The text.
 * @param {string|undefined} font - The face.
 * @param {ReadonlyMap<number, {end: number, to: string, uncapitalised?: string, unwritten?: object}>} words -
 *   Words written whole, by offset.
 * @returns {{text: string, pieces: Array<{at: number, from: string, to: string, row: boolean, native?: boolean, uncapitalised?: string, unwritten?: object}>}}
 *   As {@link applyMap}.
 */
function applyRows(map, text, font, words) {
    const pieces = [];
    let out = "";
    const starts = [...words.keys()].sort((a, b) => a - b);
    let next = 0;
    for (let at = 0; at < text.length;) {
        const word = words.get(at);
        if (word) {
            pieces.push({
                at,
                from: text.slice(at, word.end),
                to: word.to,
                ...(word.unwritten === undefined ?
                    { row: true, native: true }
                :   { row: false, unwritten: word.unwritten }),
                ...(word.uncapitalised === undefined ? {} : { uncapitalised: word.uncapitalised }),
            });
            out += word.to;
            at = word.end;
            continue;
        }
        while (next < starts.length && starts[next] <= at) next++;
        const limit = next < starts.length ? starts[next] : text.length;
        const row = map ? rowAt(map, font, text, at, limit) : undefined;
        if (row) {
            pieces.push({ at, from: row.from, to: row.to, row: true });
            out += row.to;
            at += row.from.length;
        } else {
            const char = String.fromCodePoint(/** @type {number} */ (text.codePointAt(at)));
            pieces.push({ at, from: char, to: char, row: false });
            out += char;
            at += char.length;
        }
    }
    return { text: out, pieces };
}

/**
 * A native form found for a word in lowercase, given the word's capital as the
 * rows write it: the rows map the word's first sound as written and in
 * lowercase, and where the native form begins with the lowercase result, that
 * beginning becomes the capital one.
 *
 * @param {TextMap} map - The map.
 * @param {string|undefined} font - The face.
 * @param {string} word - The word as written.
 * @param {string} native - The native form of its lowercase.
 * @returns {string|undefined} The native form, capitalised; `undefined` where
 *   it does not begin as the rows begin the word, so the rows cannot say how.
 */
export function capitalNative(map, font, word, native) {
    const none = new Map();
    const lower = applyRows(map, word.toLowerCase(), font, none).pieces[0];
    const upper = applyRows(map, word, font, none).pieces[0];
    if (!lower || !upper || lower.from.length !== upper.from.length) return undefined;
    if (!native.startsWith(lower.to)) return undefined;
    return upper.to + native.slice(lower.to.length);
}

/**
 * Apply a map to text.
 *
 * @param {TextMap|undefined} map - The map; without one the text is returned
 *   as it is.
 * @param {string} text - The text, with no escapes in it.
 * @param {MapOptions} [options] - The face, and the native forms of words.
 * @returns {{text: string, pieces: Array<{at: number, from: string, to: string, row: boolean, native?: boolean, unwritten?: object}>}}
 *   The rewritten text, and each piece of it with the UTF-16 offset in `text`
 *   it came from: a matched row's `from` and what it wrote, a word and its
 *   native form (`native: true`), or one character that passed through. A
 *   capitalised word whose native form the rows cannot capitalise is written
 *   as stated and carries `uncapitalised`, the lowercase form it was found by.
 *   Under a logographic map, a word with no writing is written as typed and
 *   carries `unwritten`, why it has none.
 */
export function applyMap(map, text, { font, native, writing } = {}) {
    const words = new Map();
    if (map?.logographic) {
        for (const match of text.matchAll(WORD)) {
            const word = match[0];
            if (!LETTER.test(word)) continue;
            const found = writing ? writing(word) : { missing: true, noLexicon: true };
            words.set(
                match.index,
                "text" in found ?
                    { end: match.index + word.length, to: found.text }
                :   { end: match.index + word.length, to: word, unwritten: found },
            );
        }
        return applyRows(map, text, font, words);
    }
    if (map && native)
        for (const match of text.matchAll(WORD)) {
            const word = match[0];
            const exact = native(word);
            if (exact !== undefined) {
                words.set(match.index, { end: match.index + word.length, to: exact });
                continue;
            }
            const lower = word.toLowerCase();
            const found = lower === word ? undefined : native(lower);
            if (found === undefined) continue;
            const first = String.fromCodePoint(/** @type {number} */ (word.codePointAt(0)));
            const capital = first !== first.toLowerCase();
            const capitalised = capital ? capitalNative(map, font, word, found) : found;
            words.set(match.index, {
                end: match.index + word.length,
                to: capitalised ?? found,
                ...(capitalised === undefined ? { uncapitalised: lower } : {}),
            });
        }
    return applyRows(map, text, font, words);
}

/**
 * Every map the index records declare, by name. The first note to declare a
 * name keeps it; the duplicate is the lint's to report.
 *
 * @param {Iterable<Record<string, any>>|undefined} records - Index records.
 * @returns {Map<string, TextMap>} The maps.
 */
export function mapsFromRecords(records) {
    const maps = new Map();
    for (const record of records ?? []) {
        if (!record || !isNoteRecord(record)) continue;
        const map = compileMap(record.data?.map);
        if (map && !maps.has(map.name)) maps.set(map.name, map);
    }
    return maps;
}

/** Every column of the `maps` relation, in order. */
export const MAP_COLUMNS = Object.freeze([
    "owner",
    "name",
    "font",
    "row",
    "from",
    "to",
    "before",
    "at",
]);

/**
 * One row per well-formed map row, for the `maps` relation: the shared rows
 * with no `font`, then each listed face's own rows with its slug.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @param {(record: Record<string, any>) => string|null} ownerOf - A record's
 *   page Address.
 * @returns {Array<Record<string, string|number|null>>} The rows, in record
 *   then authored order; `row` is the row's 1-based place in its list.
 */
export function mapRows(records, ownerOf) {
    const out = [];
    for (const record of records) {
        if (!record || !isNoteRecord(record)) continue;
        const value = record.data?.map;
        if (!isMap(value) || typeof value.name !== "string") continue;
        const owner = ownerOf(record);
        const lists = [
            [null, value.rows],
            ...(Array.isArray(value.fonts) ? value.fonts : [])
                .filter((entry) => isMap(entry) && typeof entry.font === "string")
                .map((entry) => [entry.font, entry.rows]),
        ];
        for (const [font, rows] of lists) {
            if (!Array.isArray(rows)) continue;
            rows.forEach((authored, index) => {
                const read = readMapRow(authored);
                if (!("row" in read)) return;
                out.push({
                    owner,
                    name: value.name,
                    font,
                    row: index + 1,
                    from: read.row.from,
                    to: read.row.to,
                    before: read.row.before ?? null,
                    at: read.row.at ?? null,
                });
            });
        }
    }
    return out;
}

/** The notes declaring each map name, read once per lint index. */
const declaredNames = new WeakMap();

/**
 * Each map name the index's notes declare, and the notes declaring it.
 *
 * @param {{notes?: Iterable<{file: string, fm?: Record<string, any>}>}} index - The lint index.
 * @returns {Map<string, string[]>} Name → the files that declare it.
 */
function namesIn(index) {
    const known = declaredNames.get(index);
    if (known) return known;
    const names = new Map();
    for (const note of index.notes ?? []) {
        const name = note?.fm?.data?.map?.name;
        if (typeof name !== "string") continue;
        if (!names.has(name)) names.set(name, []);
        names.get(name).push(note.file);
    }
    declaredNames.set(index, names);
    return names;
}

/**
 * Check a note's `data.map`: its name, that no other note declares it, each
 * row written as a list, a `before` condition on a map with no `vowels`, an
 * empty `fonts`, a generic family in it, and a row of a logographic map that
 * matches a letter. The data-key check owns every
 * key, its kind and the words a condition takes; whether a listed face is
 * installed, and draws what the map writes, is
 * {@link module:engine/map-lexicon.checkMapFonts}'s.
 *
 * @param {{file: string, raw?: string, fm?: Record<string, any>}} note - The note.
 * @param {{index?: {notes?: Iterable<object>}}} [context] - The lint index.
 * @returns {object[]} The findings, each at its key.
 */
export function checkMapField(note, { index } = {}) {
    const value = note?.fm?.data?.map;
    if (!isMap(value)) return [];
    const raw = note.raw ?? "";
    /**
     * @param {Array<string|number>} keyPath - Where the fault is.
     * @param {string} message - What is wrong.
     * @param {boolean} [key] - Locate the key rather than its value.
     */
    const finding = (keyPath, message, key = false) => ({
        file: note.file,
        ...positionOfFrontmatterPath(raw, ["data", "map", ...keyPath], { key }),
        severity: "error",
        message,
    });
    const findings = [];
    const { name, vowels, rows, fonts, logographic } = /** @type {Record<string, unknown>} */ (
        value
    );
    if (typeof name === "string" && !MAP_NAME.test(name))
        findings.push(
            finding(
                ["name"],
                `\`data.map.name\` is \`${name}\`; a map's name is lowercase letters, digits and \`-\``,
            ),
        );
    else if (typeof name === "string" && index) {
        const others = (namesIn(index).get(name) ?? []).filter((file) => file !== note.file);
        if (others.length)
            findings.push(
                finding(
                    ["name"],
                    `\`data.map.name\` is \`${name}\`, which ${others.join(", ")} also declares; a map's name is unique`,
                ),
            );
    }
    if (Array.isArray(fonts)) {
        if (!fonts.length)
            findings.push(
                finding(
                    ["fonts"],
                    "`data.map.fonts` is empty; a map lists each face it is drawn in",
                ),
            );
        fonts.forEach((entry, at) => {
            if (isMap(entry) && GENERIC_FAMILIES.includes(entry.font))
                findings.push(
                    finding(
                        ["fonts", at, "font"],
                        `\`data.map.fonts[${at}].font\` is \`${entry.font}\`, a generic family; a map lists the faces it is drawn in`,
                    ),
                );
        });
    }
    // A row's keys, their kinds and the words a condition takes are the
    // data-key check's; what it cannot say is a list row's arity, an empty
    // `from` in one, a condition the map has no vowels for, and a letter a
    // logographic map's row could never meet.
    const hasVowels = typeof vowels === "string" && vowels !== "";
    const rowFindings = (list, keyPath) => {
        if (!Array.isArray(list)) return;
        const label = `data.map.${keyPath.join(".").replace(/\.(\d+)/g, "[$1]")}`;
        list.forEach((row, at) => {
            const from =
                Array.isArray(row) ? row[0]
                : isMap(row) ? row.from
                : undefined;
            const letter = typeof from === "string" ? from.match(LETTER)?.[0] : undefined;
            if (logographic === true && letter !== undefined)
                findings.push(
                    finding(
                        [...keyPath, at],
                        `\`${label}[${at}]\` matches \`${letter}\`, a letter, and the rows of a ` +
                            "logographic map write only the text between words",
                    ),
                );
            if (Array.isArray(row)) {
                if (row.length !== 2)
                    findings.push(
                        finding(
                            [...keyPath, at],
                            `\`${label}[${at}]\` is a list, and a row written as a list is two strings, \`[from, to]\``,
                        ),
                    );
                else if (row[0] === "")
                    findings.push(
                        finding(
                            [...keyPath, at],
                            `\`${label}[${at}]\` has an empty \`from\`; a row matches one or more characters`,
                        ),
                    );
                return;
            }
            if (isMap(row) && row.before !== undefined && !hasVowels)
                findings.push(
                    finding(
                        [...keyPath, at, "before"],
                        `\`${label}[${at}]\` has \`before: ${String(row.before)}\`, and the map states no \`vowels\` to read it by`,
                        true,
                    ),
                );
        });
    };
    rowFindings(rows, ["rows"]);
    if (Array.isArray(fonts))
        fonts.forEach((entry, at) => {
            if (isMap(entry)) rowFindings(entry.rows, ["fonts", at, "rows"]);
        });
    return findings;
}
