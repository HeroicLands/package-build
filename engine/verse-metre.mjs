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
 * **A verse fence declares its metre, and the build counts its beats.** A
 * metre is declared once, as an entry of a `doc` note's `data.metres`:
 *
 * ```yaml
 * data:
 *   metres:
 *     - { name: hexameter, beats: 6, kind: accentual }
 * ```
 *
 * A fence that states `scan=` with the `name` and `lang=` with a language
 * whose note states `data.sounds.stress` is counted line by line, and a line
 * that cannot have the metre's beats is a warning at that line. No `scan=`
 * means no check.
 *
 * **Syllables** are vowel groups: a vowel is a letter whose base is `a`, `e`,
 * `i`, `o` or `u`, and a pair of vowels the language lists in
 * `data.sounds.syllables.vowelPairs` is one syllable. **The stressed
 * syllable** follows `data.sounds.stress`: `two` for a word of two, `longer`
 * for a word of three or more, and a vowel carrying the rule's `mark` is
 * stressed wherever it sits.
 *
 * **Beats** follow the accentual convention:
 *
 * - a word of two or more syllables has one beat, on its stressed syllable;
 * - a one-syllable noun, verb, adjective, numeral or proper name has a beat;
 *   a one-syllable particle, preposition, conjunction, adverb or pronoun has
 *   none, by the `class` of the lexicon entry the word is, or is derived
 *   from; a word whose entries differ is a beat that may be left out;
 * - a one-syllable word the lexicon does not hold is a content word;
 * - a word of four or more syllables whose stress is not on its first may take
 *   a second, lighter beat on its first syllable, and a line scans when its
 *   count can be the metre's, choosing second beats as it needs;
 * - the caesura is not written.
 *
 * @module
 */

import { nearest } from "./near-miss.mjs";
import { isNoteRecord } from "./index-records.mjs";
import { METRE_KINDS, METRE_NAME } from "./metre-declaration.mjs";
import { languageRecordsByName } from "./encoding-lexicon.mjs";
import { STRESS_LONGER, STRESS_MARKS, STRESS_TWO } from "./language-terms.mjs";
import { parseWordClass } from "./word-classes.mjs";
import { derivedForms, foldWord } from "./word-forms.mjs";
import { WORD } from "./word-pattern.mjs";

import MarkdownIt from "markdown-it";
import { spanMarkdownPlugin } from "./content-spans.mjs";
import { STANZA_BREAK, verseLine } from "./content-verse.mjs";
import { inlineText } from "./name-markup.mjs";

const verseParser = new MarkdownIt().use(spanMarkdownPlugin);

export { METRE_KINDS, METRE_NAME, checkMetresField } from "./metre-declaration.mjs";

/** The bases whose one-syllable words carry a beat. */
export const BEAT_BASES = Object.freeze(["n", "v", "adj", "num", "name"]);

/** The characters a compound is split at. */
const JOINS = /[–-]/u;

/** A letter, which a counted word holds at least one of. */
const LETTER = /\p{L}/u;

/** Whether a value is a plain map. */
const isMap = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** A list value, or an empty one. */
const listOf = (value) => (Array.isArray(value) ? value : []);

/** A character's base letter, lowercase. */
const baseOf = (char) => char.normalize("NFD")[0].toLowerCase();

/** Whether a character is a vowel: its base letter is a, e, i, o or u. */
const isVowel = (char) => "aeiou".includes(baseOf(char));

/**
 * The syllables of a word, each as the vowel group that makes it.
 *
 * @param {string} word - The word.
 * @param {Iterable<string>} pairs - The vowel pairs that are one syllable.
 * @returns {string[]} The nuclei, in order; none for a word with no vowel.
 */
export function nucleiOf(word, pairs) {
    const chars = Array.from(String(word).normalize("NFC"));
    const known = new Set(pairs);
    const longest = Math.max(1, ...Array.from(known, (pair) => Array.from(pair).length));
    const nuclei = [];
    for (let at = 0; at < chars.length; at++) {
        if (!isVowel(chars[at])) continue;
        let taken = 1;
        for (let size = Math.min(longest, chars.length - at); size > 1; size--) {
            const group = chars.slice(at, at + size);
            if (!group.every(isVowel)) continue;
            if (known.has(group.join("")) || known.has(group.map(baseOf).join(""))) {
                taken = size;
                break;
            }
        }
        nuclei.push(chars.slice(at, at + taken).join(""));
        at += taken - 1;
    }
    return nuclei;
}

/**
 * The index of the stressed syllable of a word.
 *
 * @param {string} word - The word.
 * @param {{two: string, longer: string, mark?: string}} rule - The language's
 *   `data.sounds.stress`.
 * @param {Iterable<string>} pairs - The vowel pairs that are one syllable.
 * @returns {number} The 0-based syllable; 0 for a word of one syllable or none.
 */
export function stressIndex(word, rule, pairs) {
    const nuclei = nucleiOf(word, pairs);
    const mark = rule.mark === undefined ? undefined : STRESS_MARKS[rule.mark];
    if (mark) {
        const marked = nuclei.findIndex((nucleus) => nucleus.normalize("NFD").includes(mark));
        if (marked >= 0) return marked;
    }
    const count = nuclei.length;
    if (count <= 1) return 0;
    if (count === 2) return rule.two === "last" ? 1 : 0;
    if (rule.longer === "first") return 0;
    if (rule.longer === "antepenultimate") return count - 3;
    if (rule.longer === "final") return count - 1;
    return count - 2;
}

/**
 * What a language's lines are counted by.
 *
 * @typedef {object} MetreBook
 * @property {string} language - The language's configured name.
 * @property {{two: string, longer: string, mark?: string}} rule - Its stress rule.
 * @property {ReadonlySet<string>} pairs - Its vowel pairs.
 * @property {ReadonlyMap<string, ReadonlySet<string>>} classes - Each lexicon
 *   form, and each form its rules derive, folded, with the class bases of its
 *   entries.
 */

/** Whether a stress value is a complete rule. */
const isRule = (stress) =>
    isMap(stress) && STRESS_TWO.includes(stress.two) && STRESS_LONGER.includes(stress.longer);

/**
 * Each configured language's metre book: one per language whose `note` names a
 * language note stating a complete `data.sounds.stress`.
 *
 * @param {Iterable<Record<string, any>>|undefined} records - Index records.
 * @param {{languages?: Readonly<Record<string, {tag: string, note?: string}>>, contentPackage?: string}} config -
 *   The resolved configuration.
 * @returns {Map<string, MetreBook>} The books by language name.
 */
export function metreBooksFromRecords(records, config = {}) {
    const books = new Map();
    for (const [language, record] of languageRecordsByName([...(records ?? [])], config)) {
        const data = isMap(record.data) ? record.data : {};
        const sounds = isMap(data.sounds) ? data.sounds : {};
        if (!isRule(sounds.stress)) continue;
        const syllables = isMap(sounds.syllables) ? sounds.syllables : {};
        const classes = new Map();
        const add = (form, word) => {
            const base = parseWordClass(word.class).base;
            if (base === undefined) return;
            const folded = foldWord(form);
            if (!classes.has(folded)) classes.set(folded, new Set());
            classes.get(folded).add(base);
        };
        for (const word of listOf(data.words))
            if (isMap(word) && typeof word.form === "string") add(word.form, word);
        for (const { form, word } of derivedForms(data)) add(form, word);
        books.set(
            language,
            Object.freeze({
                language,
                rule: Object.freeze({ ...sounds.stress }),
                pairs: new Set(listOf(syllables.vowelPairs).filter((p) => typeof p === "string")),
                classes,
            }),
        );
    }
    return books;
}

/**
 * Every metre the index's `doc` notes declare, by name. The first note to
 * declare a name keeps it.
 *
 * @param {Iterable<Record<string, any>>|undefined} records - Index records.
 * @returns {Map<string, import("./metre-declaration.mjs").Metre>} The metres.
 */
export function metresFromRecords(records) {
    const metres = new Map();
    for (const record of records ?? []) {
        if (!record || !isNoteRecord(record)) continue;
        for (const entry of listOf(record.data?.metres)) {
            if (
                !isMap(entry) ||
                typeof entry.name !== "string" ||
                !METRE_NAME.test(entry.name) ||
                !Number.isInteger(Number(entry.beats)) ||
                Number(entry.beats) < 1 ||
                !METRE_KINDS.includes(entry.kind) ||
                metres.has(entry.name)
            )
                continue;
            metres.set(
                entry.name,
                Object.freeze({ name: entry.name, beats: Number(entry.beats), kind: entry.kind }),
            );
        }
    }
    return metres;
}

/**
 * The beats a word can carry.
 *
 * @param {string} word - The word as written.
 * @param {MetreBook} book - The language's book.
 * @returns {{min: number, max: number}} The fewest and the most.
 */
function wordBeats(word, book) {
    const folded = foldWord(word);
    const count = nucleiOf(folded, book.pairs).length;
    if (count === 0) return { min: 0, max: 0 };
    if (count > 1) {
        const first = stressIndex(folded, book.rule, book.pairs) === 0;
        return { min: 1, max: count >= 4 && !first ? 2 : 1 };
    }
    const bases = book.classes.get(folded);
    if (!bases) return { min: 1, max: 1 };
    const carrying = [...bases].filter((base) => BEAT_BASES.includes(base)).length;
    if (carrying === bases.size) return { min: 1, max: 1 };
    return { min: 0, max: carrying ? 1 : 0 };
}

/**
 * The beats a line of verse can have.
 *
 * @param {string} text - The line.
 * @param {MetreBook} book - The line's language's book.
 * @returns {{min: number, max: number}} The beats without the second beats a
 *   long word may take, and with all of them.
 */
export function lineBeats(text, book) {
    let min = 0;
    let max = 0;
    for (const [whole] of String(text).matchAll(WORD)) {
        const parts = book.classes.has(foldWord(whole)) ? [whole] : whole.split(JOINS);
        for (const part of parts) {
            if (!LETTER.test(part)) continue;
            const beats = wordBeats(part, book);
            min += beats.min;
            max += beats.max;
        }
    }
    return { min, max };
}

/**
 * The warning for a line that cannot have its metre's beats.
 *
 * @param {{min: number, max: number}} beats - The line's beats.
 * @param {import("./metre-declaration.mjs").Metre} metre - The fence's metre.
 * @returns {string} The message.
 */
export function metreMessage({ min, max }, metre) {
    const has = max === min ? `${min} beats` : `${min} beats (${max} with secondary beats)`;
    return `this line has ${has}; the metre \`${metre.name}\` has ${metre.beats}`;
}

/**
 * Check the verse fences that state `scan=`.
 *
 * @param {ReadonlyArray<{start: number, end: number, indent: string, attributes: Record<string, string>, classes: string[]}>} blocks -
 *   The fences, from {@link module:engine/content-verse.scanVerse}.
 * @param {string[]} lines - The source's lines.
 * @param {{languages?: Readonly<Record<string, {tag: string}>>, metres?: ReadonlyMap<string, import("./metre-declaration.mjs").Metre>, metreBooks?: ReadonlyMap<string, MetreBook>, lexicons?: ReadonlyMap<string, unknown>, attributeColumns: (line: string, key: string) => {key: number, value: number}}} ctx -
 *   The metres and books, and how the fence says its columns and where its
 *   keys sit.
 * @returns {{errors: object[], warnings: object[]}} The findings at 1-based
 *   positions.
 */
export function metreFindings(blocks, lines, ctx) {
    const errors = [];
    const warnings = [];
    const metres = ctx.metres ?? new Map();
    for (const block of blocks) {
        const name = block.attributes.scan;
        if (name === undefined) continue;
        const opening = lines[block.start];
        const at = (key, part) => ({
            line: block.start + 1,
            column: ctx.attributeColumns(opening, key)[part],
        });
        const error = (position, message) => errors.push({ ...position, message });
        if (Number(block.attributes.cols ?? 1) > 1) {
            error(
                at("scan", "key"),
                "`scan=` counts the beats of one language's lines; a verse with cols>1 groups independent physical lines",
            );
            continue;
        }
        const metre = metres.get(name);
        if (!metre) {
            const near = nearest(name, [...metres.keys()]);
            error(
                at("scan", "value"),
                `\`${name}\` is not a declared metre: \`scan=\` names the \`name\` of a \`data.metres\` entry of a \`doc\` note` +
                    (near ? `; did you mean \`${near}\`?` : ""),
            );
            continue;
        }
        const lang = block.attributes.lang;
        if (lang === undefined) {
            error(
                at("scan", "key"),
                "`scan=` counts beats by a language's stress rule: the fence needs a `lang=`",
            );
            continue;
        }
        const book = ctx.metreBooks?.get(lang);
        if (!book) {
            error(
                at("lang", "value"),
                ctx.lexicons?.has(lang) ?
                    `the language \`${lang}\` states no \`data.sounds.stress\`, which \`scan=\` counts beats by`
                :   `the language \`${lang}\` is not a configured language with a \`note\`, so it has no stress rule for \`scan=\` to count beats by`,
            );
            continue;
        }
        for (let line = block.start + 1; line < block.end; line++) {
            const text = lines[line];
            if (!text.trim() || STANZA_BREAK.test(text.trim())) continue;
            const reading = verseLine(text);
            const tokens = verseParser.parseInline(reading.text, {})[0]?.children ?? [];
            const tag = (name) => (ctx.languages?.[name]?.tag ?? name).toLowerCase();
            const foreign = tokens.find(
                (token) =>
                    token.type === "span_open" &&
                    token.attrGet("lang") &&
                    tag(token.attrGet("lang")) !== tag(lang),
            );
            if (foreign) {
                error(
                    {
                        line: line + 1,
                        column:
                            reading.textColumn +
                            foreign.meta.start +
                            (reading.markerStart <= reading.textColumn - 1 + foreign.meta.start ?
                                reading.markerLength
                            :   0),
                    },
                    "`scan=` counts one language's beats; this verse line contains another language",
                );
                continue;
            }
            const beats = lineBeats(inlineText(tokens), book);
            if (metre.beats >= beats.min && metre.beats <= beats.max) continue;
            warnings.push({
                line: line + 1,
                column: /^\s*/.exec(text)[0].length + 1,
                message: metreMessage(beats, metre),
            });
        }
    }
    return { errors, warnings };
}
