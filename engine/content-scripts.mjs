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
 * **Text marked with a language, a font and a mapping.** Three keys on the
 * attribute grammar spans, divs, verse fences and scroll fences already share,
 * each optional and independent of the others:
 *
 * ```markdown
 * [Daimela, helthos.]{lang=vyl}
 * [Zaron tholmeza]{lang=vyl font=semaron-kuriale map=semaron}
 *
 * ::: {lang=vyl font=semaron-kuriale map=semaron}
 * Zaron tholmeza.
 * :::
 *
 * ```verse {form=epic lang=vyl font=semaron-kuriale map=semaron}
 * ```
 *
 * - **`lang=`** gives the language tag. It is a name declared in the
 *   package's `languages`, which gives its tag, or otherwise a well-formed BCP
 *   47 tag, checked by form alone. A declared language whose note names its
 *   script in `data.writtenIn` gives a run the map and face it leaves
 *   unstated; see {@link module:engine/written-in}.
 * - **`font=`** is one of the installed faces, by its class without `hl-`
 *   (`semaron-kuriale`), or `mono`, `serif` or `sans`.
 * - **`map=`** names a mapping note's `data.map`, which rewrites the text
 *   before it is set; see {@link module:engine/text-maps}. Without it the text
 *   is set as typed. A run's `font=` is one of the faces the map lists in its
 *   `fonts`, whose own rows come before the shared ones.
 * - **`lang=` with `map=` reads the language's lexicon first**: a word whose
 *   entry states a native form for the map is written by it, and the rows
 *   spell every other word; see {@link module:engine/map-lexicon}.
 * - **A logographic map writes every word from the lexicon**: by the word's
 *   own writing or its parts', and a word with neither, or whose form stands
 *   for entries written differently, is a finding at the word, once per run;
 *   see {@link module:engine/logographic}.
 * - **Every word of a run with `lang=` and `map=` is a word of its language**
 *   where the language's `note` names its language note: a lexicon form, a
 *   word of a name its own register lists, or a regular form of a lexicon
 *   form. Any other
 *   word is a finding at its first character, once per run; see
 *   {@link module:engine/run-words}.
 * - **A run inside a span, div or verse fence inherits its keys**, and its
 *   own keys override them. A span switching to a different language selects
 *   that language's script defaults and its own explicit font and map. A span
 *   in the same language keeps the surrounding script choices.
 * - **Text with a font, a map or a declared non-English language is plain.** A span or a
 *   verse holds no emphasis, link, image, footnote, wikilink, code or HTML,
 *   and no span but a marked one; a div holds paragraphs and line breaks only.
 * - **A non-English span holds no bold or italic markup**, including in a
 *   script face. English tags and configured names resolving to English
 *   retain their emphasis under the font's rules. Escaped delimiters are text.
 * - **Other text set in a face takes `*…*` and `**…**`**, set by the convention its
 *   language's note states, else its face's script note, else plainly; see
 *   {@link module:engine/script-emphasis}. A language that marks emphasis
 *   with a word makes either a finding at the emphasis.
 *   The text is read as written, so `[`, `]`, `"`, `<<`, `>>`, `!` and
 *   `@#$%^&` are characters, and need no escaping. A real language's tag alone
 *   marks text and leaves its Markdown alone, subject to the non-English span
 *   rule. Verse indentation periods remain layout rather than mapped text.
 * - **A face draws only what it lists.** After the map, a character that is
 *   neither whitespace nor in the face's `codepoints` is a finding, at the
 *   source character it came from. `mono`, `serif` and `sans` are not checked.
 *
 * - **A scroll fence is set in a face whose script note states
 *   `direction: vertical-rl`.** One that names no `font=` takes its
 *   language's script, else the face of a map drawn in one; one that names no
 *   face, or whose script is written in lines, is a finding. See {@link module:engine/content-scroll}.
 *
 * {@link scanRuns} reads the markup through {@link module:engine/content-spans.scanSpans},
 * {@link module:engine/content-blocks.scanBlocks},
 * {@link module:engine/content-verse.scanVerse} and
 * {@link module:engine/content-scroll.scanScrolls}, so what counts as a span, a
 * div or a fence is theirs to say.
 *
 * @module
 */

import MarkdownIt from "markdown-it";

import { scanBlocks, BLOCK_CONTAINERS } from "./content-blocks.mjs";
import {
    COLUMN_KEYS,
    COLUMNS_CLASS,
    expandVerse,
    expandVerseOrigins,
    scanVerse,
    sourcePosition,
    hasColumns,
    verseColumns,
    STANZA_BREAK,
    verseLine,
} from "./content-verse.mjs";
import { scanSpans } from "./content-spans.mjs";
import { scanScrolls, scrollParagraphs } from "./content-scroll.mjs";
import { directionsFromRecords } from "./script-direction.mjs";
import { isLanguageTag } from "./language-tag.mjs";
import { distance, nearest } from "./near-miss.mjs";
import { emphasesFromRecords, languageEmphasesOf } from "./script-emphasis.mjs";
import { EMPHASIS_CLASSES } from "./script-emphasis-terms.mjs";
import { FONTS_PACKAGE, resolveScriptFonts } from "./script-fonts.mjs";
import {
    fontProblem,
    languageRecordsByName,
    lexiconsFromRecords,
    mappingFor,
    uncapitalisedMessage,
    unwrittenMessage,
} from "./map-lexicon.mjs";
import { unknownWordMessage, unknownWords, wordBooksFromRecords } from "./run-words.mjs";
import { metreBooksFromRecords, metreFindings, metresFromRecords } from "./verse-metre.mjs";
import { applyMap, mapsFromRecords } from "./text-maps.mjs";
import { fromWrittenIn, writtenInOf } from "./written-in.mjs";

/** The keys this module reads, which no construct passes through as written. */
export const RUN_KEYS = Object.freeze(["lang", "font", "map"]);

/** The generic families `font=` may name, each with the class that sets it. */
export const GENERIC_FONTS = Object.freeze({
    mono: "font-mono",
    serif: "font-serif",
    sans: "font-sans",
});

/** The configuration file every unknown language points at. */
const CONFIG = "package-build.config.yaml";

/**
 * What a run is checked against.
 *
 * @typedef {object} RunContext
 * @property {Readonly<Record<string, {tag: string}>>} [languages] - The
 *   configured languages.
 * @property {ReadonlyMap<string, import("./script-fonts.mjs").Face>} [faces] -
 *   The installed faces by slug, from
 *   {@link module:engine/script-fonts.resolveScriptFonts}.
 * @property {ReadonlyMap<string, import("./text-maps.mjs").TextMap>} [maps] -
 *   The mapping notes' maps by name, from
 *   {@link module:engine/text-maps.mapsFromRecords}.
 * @property {ReadonlyMap<string, import("./written-in.mjs").WrittenIn>} [writtenIn] -
 *   The script each configured language's note names, by language name, from
 *   {@link module:engine/written-in.writtenInOf}.
 * @property {ReadonlyMap<string, import("./map-lexicon.mjs").Lexicon>} [lexicons] -
 *   Each configured language's lexicon by name, from
 *   {@link module:engine/map-lexicon.lexiconsFromRecords}.
 * @property {ReadonlyMap<string, import("./run-words.mjs").WordBook>} [wordBooks] -
 *   What each configured language's mapped runs are checked against, from
 *   {@link module:engine/run-words.wordBooksFromRecords}.
 * @property {ReadonlyMap<string, import("./metre-declaration.mjs").Metre>} [metres] -
 *   The metres the `doc` notes declare, by name.
 * @property {ReadonlyMap<string, import("./verse-metre.mjs").MetreBook>} [metreBooks] -
 *   What each configured language's verse is counted by, from
 *   {@link module:engine/verse-metre.metreBooksFromRecords}.
 * @property {ReadonlyMap<string, import("./script-emphasis.mjs").Emphasis>} [emphases] -
 *   Each face's emphasis conventions, from the script notes, by
 *   {@link module:engine/script-emphasis.emphasesFromRecords}.
 * @property {ReadonlyMap<string, import("./script-emphasis.mjs").LanguageEmphasis>} [languageEmphases] -
 *   The convention each configured language's note states, by language name,
 *   from {@link module:engine/script-emphasis.languageEmphasesOf}.
 * @property {ReadonlyMap<string, "vertical-rl">} [directions] - Each face whose
 *   script is written in columns, from the script notes, by
 *   {@link module:engine/script-direction.directionsFromRecords}.
 */

/**
 * One span, div, verse fence or scroll fence carrying `lang=`, `font=` or
 * `map=`. Its `lang`, `font` and `map` are the ones it is set with: its own,
 * else the innermost div or fence around it that states one, else its
 * language's script. A scroll fence that still names no face takes the face of
 * its map where the map is drawn in one.
 *
 * @typedef {object} Run
 * @property {"span"|"block"|"verse"|"scroll"} kind - Which construct.
 * @property {string|undefined} lang - The language as written.
 * @property {string|undefined} tag - The BCP 47 tag it resolves to; `undefined`
 *   when it resolves to none.
 * @property {string|undefined} font - The font as written.
 * @property {string|undefined} map - The map as written.
 * @property {number} line - 1-based line of the construct's opening.
 * @property {number} column - 1-based UTF-16 column of its opening.
 * @property {number} start - A span's offset of `[`; a div's or fence's
 *   0-based opening line.
 * @property {number} end - A span's offset past its attributes; a div's or
 *   fence's 0-based closing line.
 */

/** @type {WeakMap<object, RunContext>} */
const contexts = new WeakMap();

/** @type {WeakMap<object, WeakMap<object, RunContext>>} */
const withMaps = new WeakMap();

/**
 * The context a resolved configuration gives, and the maps an index holds.
 *
 * @param {{languages?: object, rootDir?: string}|undefined} config - The
 *   resolved configuration.
 * @param {Iterable<Record<string, any>>} [records] - The content index's
 *   records, whose mapping notes give the maps. Without them no map is known.
 * @returns {RunContext} Its languages, the faces installed where it sits, and
 *   the maps. A fonts package that cannot be read gives no faces; a run naming
 *   one is reported.
 */
export function runContext(config, records) {
    if (!config) return {};
    let base = contexts.get(config);
    if (!base) {
        let faces;
        if (config.rootDir) {
            try {
                faces = resolveScriptFonts(config.rootDir)?.faces;
            } catch {
                faces = undefined;
            }
        }
        base = Object.freeze({
            languages: config.languages ?? {},
            faces: faces ?? new Map(),
            contentPackage: config.contentPackage,
        });
        contexts.set(config, base);
    }
    if (!records || typeof records !== "object") return base;
    let byRecords = withMaps.get(config);
    if (!byRecords) withMaps.set(config, (byRecords = new WeakMap()));
    const known = byRecords.get(records);
    if (known) return known;
    const maps = mapsFromRecords(records);
    const languageRecords = languageRecordsByName(records, config);
    const context = Object.freeze({
        ...base,
        maps,
        writtenIn: writtenInOf(languageRecords, maps),
        lexicons: lexiconsFromRecords(records, config),
        wordBooks: wordBooksFromRecords(records, config),
        metres: metresFromRecords(records),
        metreBooks: metreBooksFromRecords(records, config),
        emphases: emphasesFromRecords(records),
        languageEmphases: languageEmphasesOf(languageRecords),
        directions: directionsFromRecords(records),
    });
    byRecords.set(records, context);
    return context;
}

/**
 * Whether two names are one edit apart: a letter added, dropped or changed,
 * or two neighbouring letters swapped. Case is ignored.
 *
 * @param {string} a - One name.
 * @param {string} b - The other.
 * @returns {boolean} Whether they are within one edit.
 */
function withinOneEdit(a, b) {
    a = a.toLowerCase();
    b = b.toLowerCase();
    if (distance(a, b) <= 1) return true;
    if (a.length !== b.length) return false;
    let at = 0;
    while (a[at] === b[at]) at++;
    return a[at] === b[at + 1] && a[at + 1] === b[at] && a.slice(at + 2) === b.slice(at + 2);
}

/** The word each construct is called in a finding. */
const CONSTRUCT = Object.freeze({ span: "span", block: "div", verse: "verse fence" });

/** Line starts of a source, for offsets to positions. */
function lineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
    return starts;
}

/** The 1-based position of an offset. */
function positionOf(starts, offset) {
    let lo = 0,
        hi = starts.length;
    while (lo + 1 < hi) {
        const mid = (lo + hi) >>> 1;
        if (starts[mid] <= offset) lo = mid;
        else hi = mid;
    }
    return { line: lo + 1, column: offset - starts[lo] + 1 };
}

/**
 * Where a key and its value sit on an opening line, found by searching the
 * line from its attribute block.
 *
 * @param {string} line - The opening line.
 * @param {string} key - The key.
 * @returns {{key: number, value: number}} 1-based columns.
 */
function attributeColumns(line, key) {
    const from = Math.max(0, line.indexOf("{"));
    const match = new RegExp(`[\\s{]${key}=`).exec(line.slice(from));
    if (!match) return { key: from + 1, value: from + 1 };
    const at = from + match.index + 1;
    const value = at + key.length + 1;
    return { key: at + 1, value: value + (line[value] === '"' ? 1 : 0) + 1 };
}

/** ASCII and Unicode punctuation, for the delimiter rules of emphasis. */
const PUNCTUATION = /[\p{P}\p{S}]/u;
const SPACE = /\s/u;

/** A parser that says whether text holds emphasis at all. */
const emphasisParser = new MarkdownIt({ html: true });

/**
 * Whether Markdown reads emphasis, strong emphasis or a strikethrough in text.
 *
 * @param {string} text - Inline text.
 * @returns {boolean} Whether it does.
 */
function holdsEmphasis(text) {
    const tokens = emphasisParser.parseInline(text, {})[0]?.children ?? [];
    return tokens.some((token) => ["em_open", "strong_open", "s_open"].includes(token.type));
}

/** An inline HTML tag, comment or autolink at the start of a string. */
const HTML_START =
    /^(?:<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>|<!--[\s\S]*?-->|<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>|<[^\s<>@]+@[^\s<>]+>)/;

/**
 * The index of the bracket closing the one at `open`, or -1.
 *
 * @param {string} text - The text.
 * @param {number} open - The offset of `[` or `(`.
 * @returns {number} The offset of its match.
 */
function closing(text, open) {
    const [left, right] = text[open] === "(" ? ["(", ")"] : ["[", "]"];
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === "\\") {
            i++;
            continue;
        }
        if (text[i] === left) depth++;
        else if (text[i] === right && --depth === 0) return i;
    }
    return -1;
}

/**
 * The markup in text that must be plain, each at its offset.
 *
 * Read from the raw text: a bracket pair is a character pair unless a `(`, a
 * `{` or a second bracket makes it a link, a span or a wikilink, and `[^id]`
 * is a footnote only where the note defines `id`.
 *
 * @param {string} text - The text, as written.
 * @param {ReadonlySet<string>} footnotes - The labels the note defines.
 * @param {ReadonlyMap<number, number>} [holes] - Marked spans inside the
 *   text, each its offset of `[` to the offset past its attributes. They are
 *   runs of their own and checked as such.
 * @param {boolean} [stars] - Whether `*…*`, `_…_`, `**…**` and `__…__` are
 *   emphasis the text may hold, as in a run in a script face; `~~` is not.
 * @returns {Array<{offset: number, what: string}>} Each fault, in order.
 */
function inlineMarkup(text, footnotes, holes = new Map(), stars = false) {
    const faults = [];
    const skip = new Map();
    const runs = [];
    for (let i = 0; i < text.length; i++) {
        if (holes.has(i)) {
            i = /** @type {number} */ (holes.get(i)) - 1;
            continue;
        }
        if (skip.has(i)) {
            i = skip.get(i);
            continue;
        }
        const char = text[i];
        if (char === "\\") {
            i++;
            continue;
        }
        if (char === "`") {
            const fence = /^`+/.exec(text.slice(i))[0];
            const close = new RegExp(`(?<!\`)${fence}(?!\`)`, "g");
            close.lastIndex = i + fence.length;
            const found = close.exec(text);
            if (found) {
                faults.push({ offset: i, what: "code" });
                i = found.index + fence.length - 1;
            } else i += fence.length - 1;
            continue;
        }
        if (char === "<") {
            // `<<` and `>>` are a quotation's marks in a script that types them.
            if (text[i + 1] === "<") {
                while (text[i + 1] === "<") i++;
                continue;
            }
            const tag = HTML_START.exec(text.slice(i));
            if (tag) {
                faults.push({ offset: i, what: "HTML" });
                i += tag[0].length - 1;
            }
            continue;
        }
        if (char === "[") {
            if (text[i + 1] === "[") {
                const close = text.indexOf("]]", i + 2);
                if (close > i + 2 && !text.slice(i + 2, close).includes("\n")) {
                    faults.push({ offset: i, what: "wikilink" });
                    i = close + 1;
                    continue;
                }
            }
            const end = closing(text, i);
            if (end < 0) continue;
            const label = text.slice(i + 1, end);
            const next = text[end + 1];
            if (next === "(") {
                const close = closing(text, end + 1);
                if (close > 0) {
                    faults.push(
                        text[i - 1] === "!" ?
                            { offset: i - 1, what: "image" }
                        :   { offset: i, what: "link" },
                    );
                    skip.set(end + 1, close);
                    continue;
                }
            }
            if (next === "{") {
                const close = text.indexOf("}", end + 1);
                if (close > 0) {
                    faults.push({ offset: i, what: "nested span" });
                    skip.set(end + 1, close);
                    continue;
                }
            }
            if (/^\^[^\s\]]+$/.test(label) && footnotes.has(label.slice(1))) {
                faults.push({ offset: i, what: "footnote" });
                i = end;
            }
            continue;
        }
        if (char === "*" || char === "_" || (char === "~" && text[i + 1] === "~")) {
            let j = i;
            while (text[j] === char) j++;
            if (stars && char !== "~") {
                i = j - 1;
                continue;
            }
            const before = text[i - 1] ?? " ",
                after = text[j] ?? " ";
            const left =
                !SPACE.test(after) &&
                (!PUNCTUATION.test(after) || SPACE.test(before) || PUNCTUATION.test(before));
            const right =
                !SPACE.test(before) &&
                (!PUNCTUATION.test(before) || SPACE.test(after) || PUNCTUATION.test(after));
            runs.push({
                offset: i,
                char,
                opens: char === "_" ? left && (!right || PUNCTUATION.test(before)) : left,
                closes: char === "_" ? right && (!left || PUNCTUATION.test(after)) : right,
            });
            i = j - 1;
        }
    }
    let outside = stars ? text.replace(/[*_]/g, " ") : text;
    for (const [from, to] of holes)
        outside = outside.slice(0, from) + " ".repeat(to - from) + outside.slice(to);
    if (runs.length && holdsEmphasis(outside)) {
        const used = new Set();
        let found = false;
        for (const [n, run] of runs.entries()) {
            if (used.has(n) || !run.opens) continue;
            const closer = runs.findIndex(
                (other, m) => m > n && !used.has(m) && other.char === run.char && other.closes,
            );
            if (closer < 0) continue;
            used.add(n).add(closer);
            faults.push({ offset: run.offset, what: "emphasis" });
            found = true;
        }
        if (!found) faults.push({ offset: 0, what: "emphasis" });
    }
    return faults.sort((a, b) => a.offset - b.offset);
}

/** A parser that reads emphasis and nothing else in text whose other punctuation is escaped. */
const starParser = new MarkdownIt({ html: false, linkify: false, typographer: false });

/** ASCII punctuation, which a backslash escapes. */
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

/**
 * One `*`, `_`, `**` or `__` that Markdown reads as opening or closing emphasis.
 *
 * @typedef {object} Delimiter
 * @property {number} offset - Its first character's offset.
 * @property {number} length - 1 for `*` or `_`, 2 for `**` or `__`.
 * @property {"em"|"strong"} tag - Which level it opens or closes.
 * @property {boolean} open - Whether it opens.
 */

/**
 * The stars and underscores Markdown reads as emphasis in a run's text, as
 * CommonMark pairs them. Every other character is read as itself: an escaped
 * delimiter, or one that pairs with none, is a character of the text. A marked span inside the text
 * reads as one letter, so emphasis may enclose it.
 *
 * @param {string} text - Inline text, as written.
 * @param {ReadonlyMap<number, number>} [holes] - Marked spans inside it, by
 *   offset in `text`.
 * @returns {Delimiter[]} Each delimiter, in order, at its offset in `text`.
 */
function emphasisDelimiters(text, holes = new Map()) {
    let masked = "";
    const stars = [];
    for (let i = 0; i < text.length; i++) {
        if (holes.has(i)) {
            masked += "x";
            i = /** @type {number} */ (holes.get(i)) - 1;
            continue;
        }
        const char = text[i];
        if (char === "\\" && ASCII_PUNCTUATION.test(text[i + 1] ?? "")) {
            masked += text[i + 1] === "*" || text[i + 1] === "_" ? "\\!" : `\\${text[i + 1]}`;
            i++;
        } else if (char === "*" || char === "_") {
            masked += char;
            stars.push(i);
        } else masked += ASCII_PUNCTUATION.test(char) ? `\\${char}` : char;
    }
    if (!stars.length) return [];
    const delimiters = [];
    let at = 0;
    for (const token of starParser.parseInline(masked, {})[0]?.children ?? []) {
        if (token.type === "text") at += (token.content.match(/[*_]/g) ?? []).length;
        else if (/^(?:em|strong)_(?:open|close)$/.test(token.type)) {
            delimiters.push({
                offset: stars[at],
                length: token.markup.length,
                tag: /** @type {"em"|"strong"} */ (token.tag),
                open: token.nesting === 1,
            });
            at += token.markup.length;
        }
    }
    return delimiters;
}

/**
 * The parts of ranges of text that no delimiter covers.
 *
 * @param {Array<[number, number]>} parts - The ranges, as offsets.
 * @param {readonly Delimiter[]} delimiters - Delimiters, by absolute offset.
 * @returns {Array<[number, number]>} The ranges, split around each delimiter.
 */
function outsideDelimiters(parts, delimiters) {
    if (!delimiters.length) return parts;
    const out = [];
    for (const [from, to] of parts) {
        let at = from;
        for (const delimiter of delimiters) {
            if (delimiter.offset < at || delimiter.offset >= to) continue;
            if (delimiter.offset > at) out.push([at, delimiter.offset]);
            at = delimiter.offset + delimiter.length;
        }
        if (at < to) out.push([at, to]);
    }
    return out;
}

/** A line split into its indentation, its text, a trailing break and its trailing space. */
const LINE_PARTS = /^(\s*)(.*?)(\\?)(\s*)$/;

/**
 * Backslash-escape the characters Markdown reads as markup, so the text of a
 * run reaches every later pass as the characters it is.
 *
 * @param {string} line - Text with no escapes in it, on one line.
 * @param {boolean} [lineStart] - Whether the text starts its line, where a
 *   list marker, a heading underline or an ordered-list number would be read.
 * @returns {string} The text, safe in a paragraph.
 */
function escapeRoman(line, lineStart = true) {
    const escaped = line.replace(/[\\`*_[\]<>!&#~|{}]/g, "\\$&");
    return lineStart ?
            escaped.replace(/^([-+=:])/, "\\$1").replace(/^(\d+)([.)])/, "$1\\$2")
        :   escaped;
}

/**
 * The text of one line with an author's escapes removed, and where each
 * remaining character was written.
 *
 * @param {string} core - A line's text.
 * @returns {{text: string, offsets: number[]}} The text, and for each of its
 *   UTF-16 units the offset in `core` its character came from.
 */
function unescapeRoman(core) {
    let text = "";
    const offsets = [];
    for (let at = 0; at < core.length;) {
        const escaped =
            at + 1 < core.length && core[at] === "\\" && /[!-/:-@[-`{-~]/.test(core[at + 1]);
        const point = String.fromCodePoint(
            /** @type {number} */ (core.codePointAt(at + (escaped ? 1 : 0))),
        );
        text += point;
        for (let unit = 0; unit < point.length; unit++) offsets.push(at + (escaped ? 1 : 0));
        at += point.length + (escaped ? 1 : 0);
    }
    return { text, offsets };
}

/**
 * Set a piece of a run's text: an author's escapes removed, the map applied,
 * and the characters Markdown would read escaped again. Every line is set on
 * its own, so the line count holds.
 *
 * @param {string} raw - The text as written.
 * @param {import("./map-lexicon.mjs").Mapping|undefined} mapping - The run's
 *   map, face and lexicon.
 * @param {boolean} lineStart - Whether `raw` starts its line.
 * @returns {{text: string, pieces: Array<{offset: number, from: string, to: string, row: boolean, native?: boolean, uncapitalised?: string, unwritten?: object}>}}
 *   The set text, and each piece of it with the offset in `raw` it came from.
 */
function setText(raw, mapping, lineStart) {
    const out = [];
    const pieces = [];
    let base = 0;
    raw.split("\n").forEach((line, index) => {
        const [, lead, core, breakMark, trail] = /** @type {RegExpExecArray} */ (
            LINE_PARTS.exec(line)
        );
        if (core === "") out.push(line);
        else {
            const plain = unescapeRoman(core);
            const mapped = applyMap(mapping?.map, plain.text, {
                font: mapping?.font,
                native: mapping?.native,
                writing: mapping?.writing,
            });
            for (const piece of mapped.pieces)
                pieces.push({
                    offset: base + lead.length + (plain.offsets[piece.at] ?? 0),
                    from: piece.from,
                    to: piece.to,
                    row: piece.row,
                    ...(piece.native ? { native: true } : {}),
                    ...(piece.uncapitalised === undefined ?
                        {}
                    :   { uncapitalised: piece.uncapitalised }),
                    ...(piece.unwritten === undefined ? {} : { unwritten: piece.unwritten }),
                });
            out.push(
                lead +
                    escapeRoman(mapped.text, index > 0 || lineStart || lead !== "") +
                    breakMark +
                    trail,
            );
        }
        base += line.length + 1;
    });
    return { text: out.join("\n"), pieces };
}

/**
 * Set a stretch of a scroll fence's text: the author's escapes removed and the
 * map applied to all of it, its spaces included, and nothing escaped, since
 * the fence's body is raw.
 *
 * @param {string} raw - The text, on one line.
 * @param {import("./map-lexicon.mjs").Mapping|undefined} mapping - The run's
 *   map, face and lexicon.
 * @returns {{text: string, pieces: Array<{from: string, to: string}>}} The set
 *   text, and each piece of it.
 */
function setScrollText(raw, mapping) {
    const plain = unescapeRoman(raw);
    return applyMap(mapping?.map, plain.text, {
        font: mapping?.font,
        native: mapping?.native,
        writing: mapping?.writing,
    });
}

/**
 * The parts of a range of text that no hole covers.
 *
 * @param {number} from - The range's first offset.
 * @param {number} to - The offset past it.
 * @param {ReadonlyMap<number, number>} holes - Marked spans inside it, start
 *   to end, by absolute offset.
 * @returns {Array<[number, number]>} The uncovered parts, in order.
 */
function outsideHoles(from, to, holes) {
    const parts = [];
    let at = from;
    for (const [start, end] of [...holes].sort((a, b) => a[0] - b[0])) {
        if (end <= at || start >= to) continue;
        if (start > at) parts.push([at, start]);
        at = Math.max(at, end);
    }
    if (at < to) parts.push([at, to]);
    return parts;
}

/**
 * The paragraphs of a fence's body: each run of nonblank lines.
 *
 * @param {string[]} lines - The source, by line.
 * @param {number} first - The body's first line, 0-based.
 * @param {number} last - The line past it: the closing fence.
 * @returns {Array<[number, number]>} Each paragraph's first line and the line
 *   past its last.
 */
function paragraphRanges(lines, first, last) {
    const ranges = [];
    let top;
    for (let line = first; line <= last; line++) {
        const blank = line === last || !lines[line].trim();
        if (!blank && top === undefined) top = line;
        else if (blank && top !== undefined) {
            ranges.push([top, line]);
            top = undefined;
        }
    }
    return ranges;
}

/** `U+XXXX` for a code point. */
function codeName(point) {
    return `U+${point.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** A parser for the block structure of a div's body. */
const blockParser = new MarkdownIt({ html: true });

/** What a block token is called in a finding. */
const BLOCK_WHAT = Object.freeze({
    heading_open: "a heading",
    bullet_list_open: "a list",
    ordered_list_open: "a list",
    blockquote_open: "a block quote",
    code_block: "a code block",
    table_open: "a table",
    hr: "a rule",
    html_block: "HTML",
});

/**
 * One marked construct, with what rendering it needs beside its {@link Run}.
 *
 * @typedef {object} RunDetail
 * @property {Run} run - The run.
 * @property {{id: string, classes: string[], values: Array<[string, string]>}} own -
 *   What the construct carries besides the run keys.
 * @property {Record<string, string>} keys - The run keys it states itself.
 * @property {boolean} plain - Whether its text is set.
 * @property {import("./script-fonts.mjs").Face|undefined} face - Its face.
 * @property {string|undefined} generic - Its generic family's class.
 * @property {import("./text-maps.mjs").TextMap|undefined} textMap - Its map.
 * @property {import("./map-lexicon.mjs").Mapping|undefined} mapping - Its map,
 *   face and lexicon, which its text is set by.
 * @property {Map<number, number>} holes - The marked spans inside it.
 * @property {[number, number]|undefined} body - A div's or fence's body, as
 *   offsets: the first body line's start to the end of the last.
 * @property {number|undefined} contentEnd - A span's offset of its closing `]`.
 * @property {import("./script-emphasis.mjs").LanguageEmphasis|undefined} languageEmphasis -
 *   The convention its language's note states.
 * @property {import("./script-emphasis.mjs").Emphasis|undefined} conventions -
 *   What its emphasis is set by: its language's convention, else its face's
 *   script's; `undefined` sets it plain.
 * @property {Delimiter[]} emphasis - The emphasis it holds, by absolute offset.
 * @property {boolean} [unrolled] - A scroll fence whose opening has a finding,
 *   which is left as written.
 */

/**
 * The finding for emphasis in a language that marks it with a word.
 *
 * @param {string} lang - The language, as `lang=` names it.
 * @returns {string} The message.
 */
function wordsMessage(lang) {
    return `\`${lang}\` marks emphasis with a word, not a mark; write the word`;
}

/**
 * What a run's emphasis is set by: the convention its language's note states,
 * else the one its face's script note states, else none. A language that
 * marks emphasis with a word sets none, and its emphasis is a finding.
 *
 * @param {{face: import("./script-fonts.mjs").Face|undefined, languageEmphasis: string|undefined}} detail -
 *   The run.
 * @param {RunContext} ctx - The conventions.
 * @returns {import("./script-emphasis.mjs").Emphasis|undefined} The conventions.
 */
function conventionsOf({ face, languageEmphasis }, ctx) {
    if (!face || languageEmphasis === "words") return undefined;
    if (languageEmphasis === "rubric" || languageEmphasis === "overline")
        return { em: languageEmphasis, strong: languageEmphasis };
    return ctx.emphases?.get(face.slug);
}

/**
 * Read every marked construct in a source, and every fault in it.
 *
 * @param {string} source - Authored Markdown.
 * @param {RunContext} ctx - The names.
 * @param {import("./content-session.mjs").ContentSyntax} [syntax] - Session
 *   scanner projections.
 * @returns {{runs: Run[], details: RunDetail[], errors: Array<{line: number, column: number, message: string}>, warnings: Array<{line: number, column: number, message: string}>, spans: object[], divs: Map<number, object>, poems: Map<number, object>}}
 *   What {@link scanRuns} returns, and what {@link renderRuns} rewrites by.
 */
function analyseRuns(source, ctx, syntax) {
    const text = String(source ?? "");
    const lines = text.split("\n");
    const starts = lineStarts(text);
    const languages = ctx.languages ?? {};
    const faces = ctx.faces ?? new Map();
    const maps = ctx.maps ?? new Map();
    const errors = [];
    const warnings = [];
    const footnotes = new Set(
        [...text.matchAll(/^ {0,3}\[\^([^\]\s]+)\]:/gm)].map((match) => match[1]),
    );
    /** @param {{line: number, column: number}} at @param {string} message */
    const report = (at, message) => errors.push({ line: at.line, column: at.column, message });
    /** @param {Record<string, string>} values */
    const runKeys = (values) =>
        Object.fromEntries(Object.entries(values).filter(([key]) => RUN_KEYS.includes(key)));

    // Every construct that states a run key, with where it sits.
    const constructs = [];
    const spans = (syntax ? syntax(text).spans : scanSpans(text)).spans;
    for (const span of spans) {
        const keys = Object.fromEntries(span.attrs.filter(([key]) => RUN_KEYS.includes(key)));
        if (!span.attrs.length && !span.id) continue;
        const positions = span.attributePositions ?? {};
        constructs.push({
            kind: "span",
            keys,
            node: span,
            line0: span.line - 1,
            last: span.line - 1,
            at: (key, part) => positions[key]?.[part] ?? { line: span.line, column: span.column },
            where: { line: span.line, column: span.column, start: span.start, end: span.end },
            own: {
                id: span.id ?? "",
                classes: (span.attrs.find(([key]) => key === "class")?.[1] ?? "")
                    .split(/\s+/)
                    .filter(Boolean),
                values: span.attrs.filter(([key]) => !["id", "class", ...RUN_KEYS].includes(key)),
            },
        });
    }

    const divs = new Map();
    const collect = (offset, body) => {
        const scanned = offset === 0 && syntax ? syntax(body).blocks : scanBlocks(body);
        for (const block of scanned.blocks) {
            const first = offset + block.start;
            const last = offset + block.end;
            const opening = lines[first];
            const at = (key, part) => ({
                line: first + 1,
                column: attributeColumns(opening, key)[part],
            });
            const keys = runKeys(block.attributes);
            if (block.name !== "div") {
                for (const key of Object.keys(keys))
                    report(
                        at(key, "key"),
                        `\`${key}=\` is read on a span, a div or a verse fence, not on a ${block.name} block`,
                    );
            } else {
                divs.set(first, block);
                if (Object.keys(keys).length)
                    constructs.push({
                        kind: "block",
                        keys,
                        node: block,
                        line0: first,
                        last,
                        at,
                        where: {
                            line: first + 1,
                            column: opening.indexOf(":::") + 1,
                            start: first,
                            end: last,
                        },
                        own: {
                            id: block.id ?? "",
                            classes: block.classes ?? [],
                            values: Object.entries(block.attributes ?? {}).filter(
                                ([key]) => !RUN_KEYS.includes(key),
                            ),
                        },
                    });
            }
            if (BLOCK_CONTAINERS.includes(block.name))
                collect(first + 1, lines.slice(first + 1, last).join("\n"));
        }
    };
    collect(0, text);

    const poems = new Map();
    const romanColumnLines = new Set();
    for (const poem of scanVerse(text).blocks) {
        poems.set(poem.start, poem);
        // Expansion writes one span per display entry. An entry with no map
        // keeps the source spelling and page font, even when its language
        // normally selects a script. The fence itself holds only structure.
        if (poem.classes.includes(COLUMNS_CLASS)) {
            const entries = verseColumns(poem, lines[poem.start]).flatMap(
                (column) => column.entries,
            );
            let entry = 0;
            for (let line = poem.start + 1; line < poem.end; line++) {
                if (!lines[line].trim() || STANZA_BREAK.test(lines[line].trim())) continue;
                if (entries[entry++ % entries.length]?.map === undefined)
                    romanColumnLines.add(line);
            }
        }
        const keys = runKeys(poem.attributes);
        if (!Object.keys(keys).length) continue;
        const opening = lines[poem.start];
        constructs.push({
            kind: "verse",
            keys,
            node: poem,
            line0: poem.start,
            last: poem.end,
            at: (key, part) => ({
                line: poem.start + 1,
                column: attributeColumns(opening, key)[part],
            }),
            where: {
                line: poem.start + 1,
                column: poem.indent.length + 1,
                start: poem.start,
                end: poem.end,
            },
            own: {
                id: poem.id ?? "",
                classes: poem.classes ?? [],
                values: Object.entries(poem.attributes ?? {}).filter(
                    ([key]) => !RUN_KEYS.includes(key),
                ),
            },
        });
    }

    // Every scroll fence is a construct, keys or none: its text is set in a
    // face, so one that names none is a finding.
    for (const scroll of scanScrolls(text).blocks) {
        const opening = lines[scroll.start];
        constructs.push({
            kind: "scroll",
            keys: runKeys(scroll.attributes),
            node: scroll,
            line0: scroll.start,
            last: scroll.end,
            at: (key, part) => ({
                line: scroll.start + 1,
                column: attributeColumns(opening, key)[part],
            }),
            where: {
                line: scroll.start + 1,
                column: scroll.indent.length + 1,
                start: scroll.start,
                end: scroll.end,
            },
            own: {
                id: "",
                classes: scroll.classes ?? [],
                values: Object.entries(scroll.attributes ?? {}).filter(
                    ([key]) => !RUN_KEYS.includes(key),
                ),
            },
        });
    }

    /** The constructs around a run, outermost first. */
    const around = (construct) =>
        constructs
            .filter(
                (container) =>
                    container !== construct &&
                    (container.kind === "span" ?
                        construct.kind === "span" &&
                        container.where.start < construct.where.start &&
                        container.where.end >= construct.where.end
                    :   container.line0 < construct.line0 && construct.line0 < container.last),
            )
            .sort((a, b) =>
                a.kind !== "span" && b.kind !== "span" ? a.line0 - b.line0
                : a.kind !== "span" ? -1
                : b.kind !== "span" ? 1
                : a.where.start - b.where.start,
            );
    const active = constructs.filter(
        (construct) =>
            construct.kind === "scroll" ||
            Object.keys(construct.keys).length ||
            around(construct).some((container) => Object.keys(container.keys).length),
    );

    /** A language's tag, or `undefined` when it resolves to none. */
    const tagOf = (lang) =>
        lang === undefined ? undefined
        : Object.hasOwn(languages, lang) ? languages[lang].tag
        : isLanguageTag(lang) ? lang
        : undefined;

    const faceNames = () => [...faces.keys(), ...Object.keys(GENERIC_FONTS)];

    /** Check the keys a construct states itself. */
    const checkOwn = (construct) => {
        const { lang, font, map } = construct.keys;
        const { at } = construct;
        if (lang !== undefined && !Object.hasOwn(languages, lang)) {
            if (isLanguageTag(lang)) {
                const declared = Object.keys(languages).find((name) => withinOneEdit(lang, name));
                if (declared) {
                    const where = at("lang", "value");
                    warnings.push({
                        line: where.line,
                        column: where.column,
                        message: `\`${lang}\` is read as a BCP 47 tag; did you mean the declared language \`${declared}\`?`,
                    });
                }
            } else {
                const near = nearest(lang, Object.keys(languages));
                report(
                    at("lang", "value"),
                    `\`${lang}\` is not a declared language (\`languages\` in ${CONFIG}) or a BCP 47 tag` +
                        (near ? `; did you mean \`${near}\`?` : ""),
                );
            }
        }
        if (font !== undefined && !faces.has(font) && !Object.hasOwn(GENERIC_FONTS, font)) {
            const near = nearest(font, faceNames());
            report(
                at("font", "value"),
                `\`${font}\` is not a font: \`font=\` names ` +
                    (faces.size ?
                        "an installed face, or `mono`, `serif` or `sans`"
                    :   `\`mono\`, \`serif\` or \`sans\`, or a face of ${FONTS_PACKAGE}, which this package has not installed`) +
                    (near ? `; did you mean \`${near}\`?` : ""),
            );
        }
        if (map !== undefined && !maps.has(map)) {
            const near = nearest(map, [...maps.keys()]);
            report(
                at("map", "value"),
                `\`${map}\` is not a map: \`map=\` names the \`data.map.name\` of a mapping note` +
                    (near ? `; did you mean \`${near}\`?` : ""),
            );
        }
    };

    const verseMarkers = new Map();
    for (const poem of scanVerse(text).blocks)
        for (let line = poem.start + 1; line < poem.end; line++) {
            const { markerStart, markerLength } = verseLine(lines[line]);
            if (markerLength) {
                const from = starts[line] + markerStart;
                verseMarkers.set(from, from + markerLength);
            }
        }

    /** Nested spans and verse markers excluded from a run, by absolute offset. */
    const holesIn = (from, to) =>
        new Map([
            ...[...verseMarkers].filter(([start]) => start >= from && start < to),
            ...active
                .filter(
                    (construct) =>
                        construct.kind === "span" &&
                        construct.where.start >= from &&
                        construct.where.start < to,
                )
                .map((construct) => [construct.where.start, construct.where.end]),
        ]);

    /**
     * Report the markup in inline text that must be plain, and collect the
     * emphasis a run in a script face holds.
     *
     * @param {string} inline - The text.
     * @param {number} offset - Its offset in the source.
     * @param {string} marking - How its construct is marked.
     * @param {RunDetail} detail - The run, whose `emphasis` collects each
     *   delimiter by absolute offset.
     * @param {ReadonlyMap<number, number>} [holes] - Marked spans in it, by
     *   absolute offset.
     */
    const plainInline = (inline, offset, marking, detail, holes = new Map()) => {
        const relative = new Map(
            [...holes]
                .filter(([start]) => start >= offset && start < offset + inline.length)
                .map(([start, end]) => [start - offset, end - offset]),
        );
        const { lang } = detail.run;
        const words = detail.languageEmphasis === "words";
        const stars = words || detail.face !== undefined;
        for (const fault of inlineMarkup(inline, footnotes, relative, stars))
            report(
                positionOf(starts, offset + fault.offset),
                fault.what !== "emphasis" || !stars ?
                    `text marked \`${marking}\` is plain text and holds no ${fault.what}`
                : words ? wordsMessage(/** @type {string} */ (lang))
                : `text marked \`${marking}\` takes emphasis only as \`*…*\`, \`_…_\`, \`**…**\` or \`__…__\``,
            );
        if (!stars) return;
        for (const delimiter of emphasisDelimiters(inline, relative)) {
            if (words) {
                if (delimiter.open)
                    report(
                        positionOf(starts, offset + delimiter.offset),
                        wordsMessage(/** @type {string} */ (lang)),
                    );
            } else detail.emphasis.push({ ...delimiter, offset: offset + delimiter.offset });
        }
    };

    /**
     * Report each character a face does not draw, once per run, at the source
     * character it came from.
     *
     * @param {Array<[number, number]>} parts - The text to check, as offsets.
     * @param {RunDetail} detail - The run.
     */
    const covered = (parts, detail) => {
        const { face, textMap, mapping } = detail;
        if (!face) return;
        const said = new Set();
        for (const [from, to] of parts) {
            const lineStart = from === 0 || text[from - 1] === "\n";
            for (const piece of setText(text.slice(from, to), mapping, lineStart).pieces) {
                // A word with no writing is its own finding, not a face's.
                if (piece.unwritten) continue;
                for (const char of piece.to) {
                    const point = /** @type {number} */ (char.codePointAt(0));
                    if (/\s/u.test(char) || face.draws.has(point)) continue;
                    const key = piece.row ? `${piece.from}\u0000${point}` : char;
                    if (said.has(key)) continue;
                    said.add(key);
                    const where = positionOf(starts, from + piece.offset);
                    if (piece.native)
                        report(
                            where,
                            `\`${piece.from}\` is written ${codeName(point)} by the lexicon of ` +
                                `\`${detail.run.lang}\` for the map \`${textMap?.name}\`, which the font ` +
                                `\`${face.slug}\` does not draw`,
                        );
                    else if (piece.row)
                        report(
                            where,
                            `\`${piece.from}\` maps to ${codeName(point)} in the map \`${textMap?.name}\`, ` +
                                `which the font \`${face.slug}\` does not draw`,
                        );
                    else
                        report(
                            where,
                            `\`${char}\` (${codeName(point)}) is not drawn by the font \`${face.slug}\`` +
                                (textMap ?
                                    `, and the map \`${textMap.name}\` has no row for it`
                                :   ""),
                        );
                }
            }
        }
    };

    /**
     * Report each capitalised word whose native form the rows cannot
     * capitalise, at the word.
     *
     * @param {Array<[number, number]>} parts - The text to check, as offsets.
     * @param {RunDetail} detail - The run.
     */
    const capitals = (parts, detail) => {
        const { mapping } = detail;
        if (!mapping?.native) return;
        for (const [from, to] of parts) {
            const lineStart = from === 0 || text[from - 1] === "\n";
            for (const piece of setText(text.slice(from, to), mapping, lineStart).pieces)
                if (piece.uncapitalised !== undefined)
                    report(
                        positionOf(starts, from + piece.offset),
                        uncapitalisedMessage(
                            piece.from,
                            piece.uncapitalised,
                            detail.run.lang,
                            mapping.map.name,
                        ),
                    );
        }
    };

    /**
     * Report each word a logographic map gives no writing, once per run, at
     * the word.
     *
     * @param {Array<[number, number]>} parts - The text to check, as offsets.
     * @param {RunDetail} detail - The run.
     */
    const writings = (parts, detail) => {
        const { mapping } = detail;
        if (!mapping?.map.logographic) return;
        const said = new Set();
        for (const [from, to] of parts) {
            const lineStart = from === 0 || text[from - 1] === "\n";
            for (const piece of setText(text.slice(from, to), mapping, lineStart).pieces) {
                if (piece.unwritten === undefined || said.has(piece.from)) continue;
                said.add(piece.from);
                report(
                    positionOf(starts, from + piece.offset),
                    unwrittenMessage(
                        piece.from,
                        piece.unwritten,
                        detail.run.lang,
                        mapping.map.name,
                    ),
                );
            }
        }
    };

    /**
     * Report each word of a mapped run that is not a word of its language, once
     * per run, at its first character.
     *
     * @param {Array<[number, number]>} parts - The text to check, as offsets.
     * @param {RunDetail} detail - The run.
     */
    const lexical = (parts, detail) => {
        const { lang, map } = detail.run;
        if (lang === undefined || map === undefined || !maps.has(map)) return;
        const book = ctx.wordBooks?.get(lang);
        if (!book) return;
        const said = new Set();
        for (const [from, to] of parts) {
            let base = from;
            for (const line of text.slice(from, to).split("\n")) {
                const plain = unescapeRoman(line);
                for (const { offset, word } of unknownWords(plain.text, book, said))
                    report(
                        positionOf(starts, base + (plain.offsets[offset] ?? 0)),
                        unknownWordMessage(word, lang),
                    );
                base += line.length + 1;
            }
        }
    };

    /**
     * Give a scroll fence the face it is set in, and report a fence that names
     * none or whose script is written in lines. A fence that names no face
     * takes its map's, where the map is drawn in one.
     *
     * @param {object} construct - The scroll fence.
     * @param {Record<string, string>} keys - Its run keys, given the face.
     */
    const scrollFace = (construct, keys) => {
        const textMap = keys.map === undefined ? undefined : maps.get(keys.map);
        if (keys.font === undefined) {
            if (textMap && textMap.fonts.size === 1) keys.font = [...textMap.fonts.keys()][0];
            else if (textMap && textMap.fonts.size > 1) {
                report(
                    construct.at("map", "value"),
                    `the map \`${keys.map}\` is drawn in more than one face; a \`scroll\` fence names its face with \`font=\``,
                );
                return;
            } else if (keys.map === undefined) {
                report(
                    construct.where,
                    "a `scroll` fence names the face it is set in, with `font=`, a map drawn in one " +
                        "face, with `map=`, or a language whose note names its script in " +
                        "`data.writtenIn`, with `lang=`",
                );
                return;
            } else return;
        }
        if (!ctx.directions || !(faces.has(keys.font) || Object.hasOwn(GENERIC_FONTS, keys.font)))
            return;
        if (ctx.directions.get(keys.font) === "vertical-rl") return;
        report(
            construct.keys.font !== undefined ? construct.at("font", "value")
            : construct.keys.map !== undefined ? construct.at("map", "value")
            : construct.keys.lang !== undefined ? construct.at("lang", "value")
            : construct.where,
            `a \`scroll\` fence sets a script written in columns, and the script of \`${keys.font}\` ` +
                "is written in lines; set it in a face whose script note states `direction: vertical-rl`, or use a div",
        );
    };

    const runs = [];
    const details = [];
    for (const construct of active) {
        const unchecked = errors.length;
        checkOwn(construct);
        // A key that names nothing is the finding; the text it would have set
        // is not then checked against a face or a language it cannot reach.
        let named = errors.length === unchecked;
        const keys = {};
        const ancestors = [...around(construct), construct];
        const columnEntry =
            construct.kind === "span" && romanColumnLines.has(construct.line0) ?
                ancestors.find((current) => current.kind === "span")
            :   undefined;
        let columnSource = false;
        for (const current of ancestors) {
            // An explicit language switch selects that language's own script.
            if (
                current.kind === "span" &&
                current.keys.lang !== undefined &&
                keys.lang !== undefined &&
                tagOf(current.keys.lang)?.toLowerCase() !== tagOf(keys.lang)?.toLowerCase()
            ) {
                delete keys.font;
                delete keys.map;
                columnSource = false;
            }
            Object.assign(keys, current.keys);
            if (current === columnEntry) columnSource = true;
        }
        // The language's script fills what the run leaves unstated, once its
        // own keys are known to name something.
        const columnFence = construct.kind === "verse" && hasColumns(construct.node);
        if (named && !columnSource && !columnFence)
            Object.assign(keys, fromWrittenIn(keys, ctx.writtenIn, maps));
        if (construct.kind === "scroll" && named) {
            scrollFace(construct, keys);
            named = errors.length === unchecked;
        }
        const { lang, font, map } = keys;
        // A face the run's map is not for, once the face and the map are each
        // known, at the construct that states either.
        const stated = construct.keys.map !== undefined || construct.keys.font !== undefined;
        if (
            stated &&
            map !== undefined &&
            maps.has(map) &&
            font !== undefined &&
            (faces.has(font) || Object.hasOwn(GENERIC_FONTS, font))
        ) {
            const problem = fontProblem(maps.get(map), font);
            if (problem)
                report(
                    construct.at(construct.keys.map !== undefined ? "map" : "font", "value"),
                    problem,
                );
        }
        const run = {
            kind: construct.kind,
            lang,
            tag: tagOf(lang),
            font,
            map,
            ...construct.where,
        };
        runs.push(run);
        const plain =
            font !== undefined ||
            map !== undefined ||
            (lang !== undefined &&
                Object.hasOwn(languages, lang) &&
                !/^en(?:-|$)/i.test(run.tag ?? ""));
        const detail = {
            run,
            own: construct.own,
            keys: construct.keys,
            plain,
            face: font === undefined ? undefined : faces.get(font),
            generic: font === undefined ? undefined : GENERIC_FONTS[font],
            textMap: map === undefined ? undefined : maps.get(map),
            mapping: map === undefined ? undefined : mappingFor(ctx, { map, font, lang }),
            holes: new Map(),
            body: undefined,
            contentEnd: construct.kind === "span" ? construct.node.contentEnd : undefined,
            languageEmphasis: lang === undefined ? undefined : ctx.languageEmphases?.get(lang),
            conventions: undefined,
            emphasis: [],
            ...(construct.kind === "scroll" && construct.node.invalid ? { unrolled: true } : {}),
        };
        detail.conventions = conventionsOf(detail, ctx);
        details.push(detail);
        const nonEnglishSpan =
            construct.kind === "span" && run.tag !== undefined && !/^en(?:-|$)/i.test(run.tag);
        if (!plain && !nonEnglishSpan) continue;
        const marking = [
            ...(lang === undefined ? [] : [`lang=${lang}`]),
            ...(font === undefined ? [] : [`font=${font}`]),
            ...(map === undefined ? [] : [`map=${map}`]),
        ].join(" ");
        const before = errors.length;

        if (construct.kind === "span") {
            const span = construct.node;
            const inline = text.slice(span.start + 1, span.contentEnd);
            detail.holes = holesIn(span.start + 1, span.contentEnd);
            if (nonEnglishSpan) {
                const relative = new Map(
                    [...detail.holes].map(([from, to]) => [
                        from - span.start - 1,
                        to - span.start - 1,
                    ]),
                );
                for (const delimiter of emphasisDelimiters(inline, relative))
                    if (delimiter.open)
                        report(
                            positionOf(starts, span.start + 1 + delimiter.offset),
                            `a span in non-English language \`${lang}\` holds no bold or italic markup`,
                        );
            }
            if (plain && errors.length === before)
                plainInline(inline, span.start + 1, marking, detail, detail.holes);
            if (named && errors.length === before) {
                const parts = outsideDelimiters(
                    outsideHoles(span.start + 1, span.contentEnd, detail.holes),
                    detail.emphasis,
                );
                lexical(parts, detail);
                capitals(parts, detail);
                writings(parts, detail);
                covered(parts, detail);
            }
            continue;
        }

        const first = construct.line0 + 1;
        const last = construct.last;
        const from = starts[first] ?? text.length;
        const to = last > first ? starts[last] - 1 : from;
        detail.body = [from, to];
        detail.holes = holesIn(from, to);

        if (construct.kind === "block") {
            const body = lines.slice(first, last);
            const said = (line, what) =>
                report(
                    { line: first + line + 1, column: /^ */.exec(body[line])[0].length + 1 },
                    `a div marked \`${marking}\` holds paragraphs and line breaks only, not ${what}`,
                );
            for (const token of blockParser.parse(body.join("\n"), {})) {
                if (token.level !== 0 || !token.map) continue;
                const [top, past] = token.map;
                if (token.type === "paragraph_open") {
                    const nested = body.slice(top, past).findIndex((line) => /^ *:::/.test(line));
                    if (nested >= 0) said(top + nested, "a nested block");
                    else if (
                        body.slice(top, past).some((line) => /^ {0,3}\[\^[^\]]+\]:/.test(line))
                    )
                        said(top, "a footnote definition");
                    else
                        plainInline(
                            body.slice(top, past).join("\n"),
                            starts[first + top],
                            marking,
                            detail,
                            detail.holes,
                        );
                    continue;
                }
                if (token.type === "fence")
                    said(
                        top,
                        token.info.trim().split(/\s/)[0] === "verse" ?
                            "a verse fence"
                        :   "a code fence",
                    );
                else if (Object.hasOwn(BLOCK_WHAT, token.type)) said(top, BLOCK_WHAT[token.type]);
            }
        } else if (construct.kind === "scroll") {
            // A paragraph is reflowed as one text, so its emphasis may cross
            // the lines it is written on.
            for (const [top, past] of paragraphRanges(lines, first, last))
                plainInline(
                    text.slice(starts[top], starts[past - 1] + lines[past - 1].length),
                    starts[top],
                    marking,
                    detail,
                );
        } else {
            for (let line = first; line < last; line++)
                plainInline(lines[line], starts[line], marking, detail, detail.holes);
        }
        if (named && errors.length === before) {
            const parts = outsideDelimiters(outsideHoles(from, to, detail.holes), detail.emphasis);
            lexical(parts, detail);
            capitals(parts, detail);
            writings(parts, detail);
            covered(parts, detail);
        }
    }

    const order = (a, b) => a.line - b.line || a.column - b.column;
    runs.sort(order);
    details.sort((a, b) => order(a.run, b.run));
    errors.sort(order);
    warnings.sort(order);
    return { runs, details, errors, warnings, spans, divs, poems };
}

/**
 * Find the spans, divs and verse fences marked with `lang=`, `font=` or
 * `map=`, and every fault in their markup and their text.
 *
 * @param {string} source - Authored Markdown: a note body, or a whole file
 *   whose frontmatter is blanked.
 * @param {RunContext} [ctx] - The configured languages, the installed faces
 *   and the maps. Without them every `lang=` must be a tag, every face and
 *   map is unknown, and only `mono`, `serif` and `sans` are fonts.
 * @param {import("./content-session.mjs").ContentSyntax} [syntax] - Session
 *   scanner projections, so the source's spans and blocks are scanned once.
 * @returns {{runs: Run[], errors: Array<{line: number, column: number, message: string}>, warnings: Array<{line: number, column: number, message: string}>}}
 *   The runs in source order, and each finding at its 1-based position. A
 *   warning is a `lang=` read as a tag that sits within one edit of a
 *   declared name.
 */
export function scanRuns(source, ctx = {}, syntax) {
    const text = String(source ?? "");
    const { markdown, origins } = expandVerseOrigins(text);
    const authored = analyseRuns(text, ctx, syntax);
    const metre = metreFindings(scanVerse(text).blocks, text.split("\n"), {
        metres: ctx.metres,
        languages: ctx.languages,
        metreBooks: ctx.metreBooks,
        lexicons: ctx.lexicons,
        columnsClass: COLUMNS_CLASS,
        columnKeys: COLUMN_KEYS,
        attributeColumns,
    });
    /** @param {object[]} found @param {object[]} extra */
    const merged = (found, extra) =>
        extra.length ?
            [...found, ...extra].sort((a, b) => a.line - b.line || a.column - b.column)
        :   found;
    if (markdown === text)
        return {
            ...authored,
            errors: merged(authored.errors, metre.errors),
            warnings: merged(authored.warnings, metre.warnings),
        };
    // A verse in columns is checked as the spans each entry sets, which are
    // written only in the expansion; every finding is placed back where the
    // note wrote the text or the entry it comes from, once.
    const expanded = markdown.split("\n");
    const checked = analyseRuns(markdown, ctx);
    const placed = (findings) => {
        const seen = new Set();
        return findings
            .map((finding) => ({ ...finding, ...sourcePosition(finding, expanded, origins) }))
            .filter((finding) => {
                const key = `${finding.line}:${finding.column}:${finding.message}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .sort((a, b) => a.line - b.line || a.column - b.column);
    };
    return {
        runs: authored.runs,
        errors: merged(placed(checked.errors), metre.errors),
        warnings: merged(placed(checked.warnings), metre.warnings),
    };
}

/**
 * An attribute value as the shared attribute grammar reads it back.
 *
 * @param {string} value - The value.
 * @returns {string} The value, quoted when it holds anything but name characters.
 */
function attributeValue(value) {
    return /^[A-Za-z0-9_.:/@%+-]+$/.test(value) ? value : `"${value.replace(/[\\"]/g, "\\$&")}"`;
}

/**
 * The text of an attribute block: `lang` first, then the id and classes, and
 * the other attributes.
 *
 * @param {object} parts - What the block carries.
 * @param {string|undefined} parts.lang - The tag.
 * @param {string} parts.id - The `#id`, or "".
 * @param {string[]} parts.classes - Every class.
 * @param {Array<[string, string]>} parts.values - The other `key=value` pairs.
 * @returns {string} The text between the braces.
 */
function attributeText({ lang, id, classes, values }) {
    return [
        ...(lang === undefined ? [] : [`lang=${attributeValue(lang)}`]),
        ...(id ? [`#${id}`] : []),
        ...classes.map((name) => `.${name}`),
        ...values.map(([key, value]) => `${key}=${attributeValue(value)}`),
    ].join(" ");
}

/** The class every run in one of the faces carries. */
const SCRIPT_CLASS = "script";

/** The class a div in one of the faces carries, which the theme sets its block rules on. */
const SCRIPT_BLOCK_CLASS = "script-block";

/**
 * The attribute text a run is rewritten to, or `undefined` when it stays as
 * written.
 *
 * @param {RunDetail} detail - The run.
 * @param {boolean} search - Whether the target is the site, whose search
 *   index a face's code points are kept out of.
 * @returns {string|undefined} The text between the braces.
 */
function rewrittenAttributes(detail, search) {
    const { run, own, keys, face, generic, textMap } = detail;
    const changes =
        run.font !== undefined ||
        run.map !== undefined ||
        (run.tag !== undefined &&
            (keys.lang !== run.tag || run.kind === "verse" || run.kind === "scroll"));
    if (!changes) return undefined;
    const classes = [...own.classes];
    const values = [...own.values];
    if (face) {
        classes.push(SCRIPT_CLASS);
        if (run.kind === "block") classes.push(SCRIPT_BLOCK_CLASS);
        classes.push(face.class);
        if (run.kind !== "span" && face.direction === "rtl") values.push(["dir", "rtl"]);
        if (search) values.push(["data-pagefind-ignore", "true"]);
    } else if (generic) classes.push(generic);
    if (run.map !== undefined && !textMap) return undefined;
    return attributeText({ lang: run.tag, id: own.id, classes, values });
}

/**
 * The tag a delimiter is written as: an `<em>` or a `<strong>` carrying its
 * convention's class. The book's parser reads only the classed form, so a
 * delimiter with no convention writes nothing there, and the text is set in
 * the face's Regular.
 *
 * @param {Delimiter} delimiter - The delimiter.
 * @param {import("./script-emphasis.mjs").Emphasis|undefined} conventions -
 *   The run's conventions.
 * @param {boolean} book - Whether the target is the book.
 * @returns {string} The tag.
 */
function emphasisTag(delimiter, conventions, book) {
    const convention = conventions?.[delimiter.tag];
    if (!convention && book) return "";
    if (!delimiter.open) return `</${delimiter.tag}>`;
    return convention ?
            `<${delimiter.tag} class="${EMPHASIS_CLASSES[convention]}">`
        :   `<${delimiter.tag}>`;
}

/**
 * Set a range of a run's text, each piece between its emphasis delimiters by
 * {@link setText}, and each delimiter as its tag.
 *
 * @param {string} text - The source.
 * @param {number} from - The range's first offset.
 * @param {number} to - The offset past it.
 * @param {RunDetail} detail - The run.
 * @param {boolean} lineStart - Whether `from` starts its line.
 * @param {boolean} book - Whether the target is the book.
 * @returns {string} The set text.
 */
function setRange(text, from, to, detail, lineStart, book) {
    let out = "";
    let at = from;
    for (const delimiter of detail.emphasis) {
        if (delimiter.offset < from || delimiter.offset >= to) continue;
        if (delimiter.offset > at)
            out += setText(
                text.slice(at, delimiter.offset),
                detail.mapping,
                at === from && lineStart,
            ).text;
        out += emphasisTag(delimiter, detail.conventions, book);
        at = delimiter.offset + delimiter.length;
    }
    if (at < to) out += setText(text.slice(at, to), detail.mapping, at === from && lineStart).text;
    return out;
}

/**
 * Rewrite text marked with `lang=`, `font=` and `map=` into the plain span,
 * div and verse grammar the rest of each chain renders, one line for one line.
 *
 * - **A verse in columns is expanded first** into one span per column entry
 *   per verse line, by {@link module:engine/content-verse.expandVerse}, so
 *   each entry is mapped and set as a span with its keys is. That is the one
 *   rewrite that changes the number of lines.
 * - **The map, if any, is applied first.** Characters Markdown would read are
 *   then backslash-escaped, so they reach every later pass as characters.
 * - **Emphasis in a face** becomes an `<em>` or a `<strong>` carrying its
 *   convention's class, or no class where none is stated. The book reads
 *   only the classed form, so a classless one writes nothing there.
 * - **The construct carries** the language's tag as `lang`, the face's class
 *   (with `script`, and `script-block` on a div) or the generic family's
 *   class. On the site, a face's construct also carries
 *   `data-pagefind-ignore`, since site search cannot read its code points;
 *   Foundry and the book receive no search marker.
 * - **A div or fence in a right-to-left face** carries `dir=rtl`. No direction
 *   mark, `<bdo>` or `<bdi>` is ever written: the code points carry their own
 *   direction.
 * - **A scroll fence's body** is rewritten to one line per paragraph, its
 *   lines joined by what the map writes for a space, and left unescaped,
 *   since the body is raw. Its layout, each character with the source text it
 *   was written from, is returned for the book, which draws it.
 *
 * A run with a finding is left as written; {@link scanRuns} reports it.
 *
 * @param {string} source - Authored Markdown: a note body.
 * @param {RunContext} [ctx] - The configured languages, faces and maps.
 * @param {import("./content-session.mjs").ContentSyntax} [syntax] - Session
 *   scanner projections.
 * @param {{target?: "site"|"foundry"|"book"}} [options] - The target the
 *   Markdown is rendered for; only `site` writes the search marker.
 * @returns {{markdown: string, errors: Array<{line: number, column: number, message: string}>, scrolls: Map<string, import("./content-scroll.mjs").ScrollLayout>}}
 *   The rewritten Markdown, the findings of {@link scanRuns}, and each
 *   rewritten scroll fence's layout, by its rewritten body.
 */
export function renderRuns(source, ctx = {}, syntax, options = {}) {
    const search = options.target === "site";
    const book = options.target === "book";
    const authored = String(source ?? "");
    const text = expandVerse(authored);
    if (text !== authored) syntax = undefined;
    /** @type {Map<string, import("./content-scroll.mjs").ScrollLayout>} */
    const scrolls = new Map();
    if (!/\b(?:lang|font|map)=/.test(text)) return { markdown: text, errors: [], scrolls };
    const { details, errors } = analyseRuns(text, ctx, syntax);
    if (!details.length) return { markdown: text, errors, scrolls };
    const lines = text.split("\n");
    const starts = lineStarts(text);

    /** Whether a finding sits inside a run. */
    const faulted = (run) => {
        const from = (run.line - 1) * 1e6 + run.column;
        const end = run.kind === "span" ? positionOf(starts, run.end) : undefined;
        const to = end ? (end.line - 1) * 1e6 + end.column : (run.end + 1) * 1e6;
        return errors.some((error) => {
            const at = (error.line - 1) * 1e6 + error.column;
            return at >= from && at < to;
        });
    };

    /** @type {Array<{from: number, to: number, text: string}>} */
    const edits = [];

    /**
     * A scroll fence's body set as one line per paragraph, and its layout.
     *
     * @param {RunDetail} detail - The scroll fence.
     * @returns {{text: string, layout: import("./content-scroll.mjs").ScrollLayout}}
     *   The body and the layout.
     */
    const setScroll = (detail) => {
        const join = setScrollText(" ", detail.mapping);
        const texts = [];
        const paragraphs = [];
        for (const [top, past] of paragraphRanges(lines, detail.run.start + 1, detail.run.end)) {
            let out = "";
            /** @type {import("./content-scroll.mjs").ScrollCell[]} */
            const cells = [];
            const conventions = [];
            let pending = "";
            const emit = (pieces) => {
                for (const piece of pieces) {
                    const chars = [...piece.to];
                    if (!chars.length) {
                        pending += piece.from;
                        continue;
                    }
                    const emphasis = conventions.at(-1);
                    chars.forEach((char, at) =>
                        cells.push({
                            text: char,
                            roman: at ? "" : pending + piece.from,
                            ...(emphasis ? { emphasis } : {}),
                        }),
                    );
                    pending = "";
                }
            };
            const set = (from, to) => {
                const result = setScrollText(text.slice(from, to), detail.mapping);
                out += result.text;
                emit(result.pieces);
            };
            for (let line = top; line < past; line++) {
                if (line > top) {
                    out += join.text;
                    emit(join.pieces);
                }
                const written = lines[line];
                const from = starts[line] + written.length - written.trimStart().length;
                const to = starts[line] + written.trimEnd().length;
                let at = from;
                for (const delimiter of detail.emphasis) {
                    if (delimiter.offset < from || delimiter.offset >= to) continue;
                    if (delimiter.offset > at) set(at, delimiter.offset);
                    out += emphasisTag(delimiter, detail.conventions, book);
                    if (delimiter.open) conventions.push(detail.conventions?.[delimiter.tag]);
                    else conventions.pop();
                    at = delimiter.offset + delimiter.length;
                }
                if (at < to) set(at, to);
            }
            if (pending && cells.length) cells[cells.length - 1].roman += pending;
            texts.push(out);
            paragraphs.push(cells);
        }
        return { text: texts.join("\n\n"), layout: { face: detail.face, paragraphs } };
    };

    for (const detail of details) {
        const { run } = detail;
        if (faulted(run)) continue;
        const attributes = rewrittenAttributes(detail, search);
        if (run.kind === "span") {
            const contentEnd = /** @type {number} */ (detail.contentEnd);
            if (attributes !== undefined)
                edits.push({ from: contentEnd + 2, to: run.end - 1, text: attributes });
            if (detail.plain)
                for (const [from, to] of outsideHoles(run.start + 1, contentEnd, detail.holes)) {
                    const set = setRange(text, from, to, detail, false, book);
                    if (set !== text.slice(from, to)) edits.push({ from, to, text: set });
                }
            continue;
        }
        if (run.kind === "scroll" && attributes !== undefined && !detail.unrolled) {
            const open = lines[run.start].indexOf("{");
            const close = lines[run.start].lastIndexOf("}");
            edits.push({
                from: starts[run.start] + open + 1,
                to: starts[run.start] + close,
                text: attributes,
            });
            if (detail.plain && detail.body) {
                const { text: body, layout } = setScroll(detail);
                edits.push({ from: detail.body[0], to: detail.body[1], text: body });
                scrolls.set(scrollParagraphs(body.split("\n")).join("\n\n"), layout);
            }
            continue;
        }
        if (run.kind === "scroll") continue;
        if (attributes !== undefined) {
            const open = lines[run.start].indexOf("{");
            const close = lines[run.start].lastIndexOf("}");
            edits.push({
                from: starts[run.start] + open + 1,
                to: starts[run.start] + close,
                text: attributes,
            });
        }
        if (detail.plain && detail.body)
            for (const [from, to] of outsideHoles(detail.body[0], detail.body[1], detail.holes)) {
                const lineStart = from === 0 || text[from - 1] === "\n";
                const set = setRange(text, from, to, detail, lineStart, book);
                if (set !== text.slice(from, to)) edits.push({ from, to, text: set });
            }
    }

    let markdown = text;
    for (const edit of edits.sort((a, b) => b.from - a.from))
        markdown = markdown.slice(0, edit.from) + edit.text + markdown.slice(edit.to);
    return { markdown, errors, scrolls };
}
