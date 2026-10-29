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
 * Text marked with a language, font or encoding document on shared attributes.
 * `enc=` resolves a document Address and infers its configured language and
 * font; explicit selections must agree. `enc=default`, including an omitted
 * selection, retains Roman text. A language alias or BCP 47 tag identifies
 * text independently of conversion, and an installed font or generic family
 * selects its face independently.
 *
 * Configured language notes supply vocabulary, Roman additions and emphasis.
 * Encoded words read lexical native writings, complete parts and encoding
 * mappings in that order. Source validation sees the complete logical run,
 * including class-only emphasis and name children, while physical rendering
 * preserves their wrappers. Children stating run keys make a separate choice.
 * A native name's braces write the shared name controls.
 *
 * Plain configured-language runs restrict Markdown consistently across site,
 * Foundry and book targets. Non-English spans admit no bold or italic markup;
 * explicit emphasis classes follow the language's or script's convention.
 * English text with the default encoding retains ordinary Markdown grammar.
 * A selected font must draw every visible encoded output character.
 *
 * Span, div, verse and scroll scanners retain original UTF-16 source offsets.
 * Public diagnostics count Unicode code-point columns. A scroll's face must
 * belong to a script written vertically. An encoded verse derives native and
 * Roman presentations from one authored text and retains explicit boundaries.
 * @module
 */

import MarkdownIt from "markdown-it";
import { blockTokens } from "./markdown-blocks.mjs";

import { scanBlocks, BLOCK_CONTAINERS } from "./content-blocks.mjs";
import { scanVerse } from "./content-verse.mjs";
import { scanSpans } from "./content-spans.mjs";
import { footnoteLabels, footnoteReferences } from "./content-footnotes.mjs";
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
    encodingFor,
} from "./encoding-lexicon.mjs";
import { unknownWordMessage, unknownWords, wordBooksFromRecords } from "./run-words.mjs";
import { metreBooksFromRecords, metreFindings, metresFromRecords } from "./verse-metre.mjs";
import { encodeWithLanguage } from "./encoding-language.mjs";
import { encodingsFromRecords, encodingAddress } from "./encoding-notes.mjs";
import {
    romanInventoriesOf,
    romanPunctuationState,
    romanTextProblems,
    romanUnclosedQuotations,
} from "./roman-characters.mjs";
import { plainRomanRun } from "./roman-run.mjs";
import { plainRomanVerse } from "./roman-verse.mjs";
import { encodeText } from "./encoding.mjs";
import { WIKILINK } from "./wikilink-syntax.mjs";
import { matchAllOutsideCode } from "./code-fences.mjs";
import { parseExtensionAttributes } from "./extension-attributes.mjs";

/** The keys this module reads, which no construct passes through as written. */
export const RUN_KEYS = Object.freeze(["lang", "font", "enc"]);

/** Explicit opt-in to native-script presentation on this construct. */
const NATIVEFONT_CLASS = "nativefont";

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
 * @property {string} [contentPackage] - The citing content package.
 * @property {Readonly<Record<string, {tag: string}>>} [languages] - The
 *   configured languages.
 * @property {ReadonlyMap<string, import("./script-fonts.mjs").Face>} [faces] -
 *   The installed faces by slug, from
 *   {@link module:engine/script-fonts.resolveScriptFonts}.
 * @property {ReadonlyMap<string, ReturnType<import("./encoding.mjs").compileEncoding>>} [encodings] -
 *   The compiled encoding documents, keyed by canonical and local Addresses.
 * @property {ReadonlyArray<{file?: string, line?: number, column?: number, message: string}>} [encodingFindings] - Encoding-document or font-code findings.
 * @property {ReadonlyMap<string, {data: object, codes: Record<string,string>}>} [encodingDefinitions] - Serialized encoding documents and their selected font codes.
 * @property {ReadonlyMap<string, Record<string, any>>} [languageRecords] - The configured language notes.
 * @property {ReadonlyMap<string, import("./encoding-lexicon.mjs").Lexicon>} [lexicons] -
 *   Each configured language's lexicon by name, from
 *   {@link module:engine/encoding-lexicon.lexiconsFromRecords}.
 * @property {ReadonlyMap<string, import("./run-words.mjs").WordBook>} [wordBooks] -
 *   What each configured language's encoded runs are checked against, from
 *   {@link module:engine/run-words.wordBooksFromRecords}.
 * @property {ReadonlyMap<string, import("./metre-declaration.mjs").Metre>} [metres] -
 *   The metres the `doc` notes declare, by name.
 * @property {ReadonlyMap<string, import("./verse-metre.mjs").MetreBook>} [metreBooks] -
 *   What each configured language's verse is counted by, from
 *   {@link module:engine/verse-metre.metreBooksFromRecords}.
 * @property {ReadonlyMap<string, import("./roman-characters.mjs").RomanInventory>} [romanInventories] -
 *   Exact Roman source inventories by configured alias and BCP 47 tag.
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
 * One span, div, verse div or scroll fence carrying run attributes.
 * Values combine explicit choices, class-only inheritance, encoding-document
 * language/font defaults and the Roman default encoding.
 *
 * @typedef {object} Run
 * @property {"span"|"block"|"verse"|"scroll"} kind - Which construct.
 * @property {string|undefined} lang - The language as written.
 * @property {string|undefined} tag - The BCP 47 tag it resolves to; `undefined`
 *   when it resolves to none.
 * @property {string|undefined} font - The font as written.
 * @property {string|undefined} enc - The resolved document Address, or default for Roman text.
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
const withEncodings = new WeakMap();

/**
 * The context a resolved configuration gives, and the encodings an index holds.
 *
 * @param {{languages?: object, rootDir?: string, contentPackage?:string, paths?:{content?:string}}|undefined} config - The
 *   resolved configuration.
 * @param {Iterable<Record<string, any>>} [records] - The content index's
 *   records, whose language notes supply lexical writings and script choices.
 * @returns {RunContext} Its languages, the faces installed where it sits, and
 *   the encodings. A fonts package that cannot be read gives no faces; a run naming
 *   one is reported.
 */
export function runContext(config, records) {
    if (!config) return {};
    let base = contexts.get(config);
    if (!base) {
        let faces;
        let fonts;
        if (config.rootDir) {
            try {
                fonts = resolveScriptFonts(config.rootDir);
                faces = fonts?.faces;
            } catch {
                faces = undefined;
            }
        }
        base = Object.freeze({
            fonts,
            encodings: new Map(),
            encodingFindings: [],
            languages: config.languages ?? {},
            faces: faces ?? new Map(),
            contentPackage: config.contentPackage,
        });
        contexts.set(config, base);
    }
    if (!records || typeof records !== "object") return base;
    let byRecords = withEncodings.get(config);
    if (!byRecords) withEncodings.set(config, (byRecords = new WeakMap()));
    const known = byRecords.get(records);
    if (known) return known;
    const loaded = encodingsFromRecords(records, config, base.fonts);
    const encodings = loaded.encodings;
    const languageRecords = languageRecordsByName(records, config);
    const context = Object.freeze({
        ...base,
        encodings,
        encodingDefinitions: loaded.definitions,
        encodingFindings: loaded.findings,
        languageRecords,
        romanInventories: romanInventoriesOf(languageRecords, config.languages),
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
const CONSTRUCT = Object.freeze({ span: "span", block: "div", verse: "verse div" });

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
 * The label of exactly one resolved reference, as offsets within its span.
 * Targets and the resolver's draft decoration are presentation, not words of
 * the label's language. No surrounding prose belongs to this atom.
 *
 * @param {string} text - A span's entire content after wikilink resolution.
 * @returns {[number, number]|undefined} The visible label's bounds.
 */
function referenceLabel(text) {
    let offset = 0;
    const draft =
        /^<span class="sohl-draft-link" title="Draft — not yet written">([\s\S]*)<\/span>$/.exec(
            text,
        );
    if (draft) {
        offset = text.indexOf(">") + 1;
        text = draft[1];
    } else if (text.endsWith(" (draft)")) {
        text = text.slice(0, -8);
    }
    const uuid = /^@UUID\[[^\]\r\n]+\]\{([^{}\r\n]*)\}$/.exec(text);
    if (uuid) {
        const start = text.indexOf("]{") + 2;
        return [offset + start, offset + text.length - 1];
    }
    if (!text.startsWith("[")) return undefined;
    const end = closing(text, 0);
    if (end < 0 || text[end + 1] !== "(") return undefined;
    if (closing(text, end + 1) !== text.length - 1) return undefined;
    return [offset + 1, offset + end];
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
    const escaped = line.replace(/[\\`*_[\]<>"'!&#~|{}-]/g, "\\$&");
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

/** Apply a selected encoding, retaining source text only for recoverable rendering. */
function applyEncoding(encoding, text, options = {}) {
    if (!encoding)
        return {
            text,
            pieces: [...text].map((char, index) => ({
                from: char,
                to: char,
                at: index,
                row: false,
            })),
        };
    const result = encodeWithLanguage(encoding, text, options);
    return {
        text: result.findings.length ? text : result.text,
        pieces: [
            ...result.pieces.map((one) => ({ ...one, at: one.start, row: Boolean(one.row) })),
            ...result.findings.map((one) => ({
                from: text.slice(one.offset, one.offset + 1),
                to: "",
                at: one.offset,
                row: false,
                problem: one.message,
            })),
        ],
    };
}

/**
 * Set a piece of a run's text: an author's escapes removed, the enc applied,
 * and the characters Markdown would read escaped again. Every line is set on
 * its own, so the line count holds.
 *
 * @param {string} raw - The text as written.
 * @param {ReturnType<import("./encoding-lexicon.mjs").encodingFor>|undefined} selection - The run's
 *   enc, face and lexicon.
 * @param {boolean} lineStart - Whether `raw` starts its line.
 * @returns {{text: string, pieces: Array<{offset: number, from: string, to: string, row: boolean, native?: boolean, problem?: string}>}}
 *   The set text, and each piece of it with the offset in `raw` it came from.
 */
function setText(raw, selection, lineStart) {
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
            const encoded = applyEncoding(selection?.encoding, plain.text, {
                font: selection?.font,
                lexicon: selection?.lexicon,
            });
            for (const piece of encoded.pieces)
                pieces.push({
                    offset: base + lead.length + (plain.offsets[piece.at] ?? 0),
                    from: piece.from,
                    to: piece.to,
                    row: piece.row,
                    ...(piece.native ? { native: true } : {}),
                    ...(piece.problem === undefined ? {} : { problem: piece.problem }),
                });
            out.push(
                lead +
                    escapeRoman(encoded.text, index > 0 || lineStart || lead !== "") +
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
 * enc applied to all of it, its spaces included, and nothing escaped, since
 * the fence's body is raw.
 *
 * @param {string} raw - The text, on one line.
 * @param {ReturnType<import("./encoding-lexicon.mjs").encodingFor>|undefined} selection - The run's
 *   enc, face and lexicon.
 * @returns {{text: string, pieces: Array<{from: string, to: string}>}} The set
 *   text, and each piece of it.
 */
function setScrollText(raw, selection) {
    const plain = unescapeRoman(raw);
    return applyEncoding(selection?.encoding, plain.text, {
        font: selection?.font,
        lexicon: selection?.lexicon,
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
 * @property {ReturnType<import("./encoding.mjs").compileEncoding>|undefined} encoding - Its enc.
 * @property {ReturnType<import("./encoding-lexicon.mjs").encodingFor>|undefined} selection - Its enc,
 *   face and lexicon, which its text is set by.
 * @property {Map<number, number>} holes - The marked spans inside it.
 * @property {[number, number]|undefined} body - A div's or fence's body, as
 *   offsets: the first body line's start to the end of the last.
 * @property {number|undefined} contentEnd - A span's offset of its closing `]`.
 * @property {[number, number]|undefined} reference - A resolved reference's
 *   visible label bounds, by absolute offset; its target stays untouched.
 * @property {import("./script-emphasis.mjs").LanguageEmphasis|undefined} languageEmphasis -
 *   The convention its language's note states.
 * @property {import("./script-emphasis.mjs").Emphasis|undefined} conventions -
 *   What its emphasis is set by: its language's convention, else its face's
 *   script's; `undefined` sets it plain.
 * @property {Delimiter[]} emphasis - The emphasis it holds, by absolute offset.
 * @property {boolean} [checkRoman] - Its inline source structure permits Roman
 *   inventory validation, independently of encoding and face resolution.
 * @property {boolean} [checkText] - Its selection and source structure permit
 *   native encoding and output glyph validation.
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
    if (languageEmphasis === "words") return undefined;
    if (languageEmphasis === "rubric" || languageEmphasis === "overline")
        return { em: languageEmphasis, strong: languageEmphasis };
    return face ? ctx.emphases?.get(face.slug) : undefined;
}

/**
 * Read every marked construct in a source, and every fault in it.
 *
 * @param {string} source - Authored Markdown.
 * @param {RunContext} ctx - The names.
 * @param {import("./content-session.mjs").ContentSyntax} [syntax] - Session
 *   scanner projections.
 * @returns {{runs: Run[], details: RunDetail[], errors: Array<{file?: string, line: number, column: number, message: string}>, warnings: Array<{line: number, column: number, message: string}>, spans: object[], divs: Map<number, object>, poems: Map<number, object>}}
 *   What {@link scanRuns} returns, and what {@link renderRuns} rewrites by.
 */
function analyseRuns(source, ctx, syntax) {
    const text = String(source ?? "");
    const lines = text.split("\n");
    const starts = lineStarts(text);
    const languages = ctx.languages ?? {};
    const faces = ctx.faces ?? new Map();
    const encodings = ctx.encodings ?? new Map();
    const encodingUnavailable = ctx.encodingFindings?.[0];
    const encodingNamed = (value) =>
        value === "default" ? undefined : (
            (encodings.get(value) ?? encodings.get(encodingAddress(value, ctx.contentPackage)))
        );
    const errors = [];
    const warnings = [];
    const footnotes = footnoteLabels(text);
    /** @param {{line: number, column: number}} at @param {string} message */
    const report = (at, message) => errors.push({ line: at.line, column: at.column, message });
    /** @param {Record<string, string>} values */
    const runKeys = (values) =>
        Object.fromEntries(Object.entries(values).filter(([key]) => RUN_KEYS.includes(key)));

    const nativeAt = (construct) => {
        const opening = lines[construct.line0];
        const from =
            construct.kind === "span" ?
                construct.node.contentEnd + 2
            :   starts[construct.line0] + opening.indexOf("{") + 1;
        const end =
            construct.kind === "span" ?
                construct.where.end
            :   starts[construct.line0] + opening.lastIndexOf("}") + 1;
        const to = text[end - 1] === "}" ? end - 1 : end;
        // Attribute tokens keep quoted values intact, so a class-looking value
        // or longer class cannot steal the opt-in's diagnostic location.
        for (const token of text.slice(from, to).matchAll(/(?:[^\s"\\]|\\.|"(?:\\.|[^"\\])*")+/g))
            if (token[0] === ".nativefont") return positionOf(starts, from + token.index);
        return construct.where;
    };

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
            if (block.name === "verse" || block.classes?.includes("verse")) continue;
            const first = offset + block.start;
            const last = offset + block.end;
            const opening = lines[first];
            const at = (key, part) => ({
                line: first + 1,
                column: attributeColumns(opening, key)[part],
            });
            const keys = runKeys(block.attributes);
            if (block.name !== "div") {
                if (block.classes?.includes(NATIVEFONT_CLASS))
                    report(
                        nativeAt({
                            kind: "block",
                            line0: first,
                            where: { line: first + 1, column: 1 },
                        }),
                        "`.nativefont` is not an accepted class; select an encoding with `enc=`",
                    );
                for (const key of Object.keys(keys))
                    report(
                        at(key, "key"),
                        `\`${key}=\` is read on a span, a div or a verse div, not on a ${block.name} block`,
                    );
            } else {
                divs.set(first, block);
                if (Object.keys(keys).length || block.classes?.includes(NATIVEFONT_CLASS))
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
    for (const poem of scanVerse(text).blocks) {
        poems.set(poem.start, poem);
        const keys = runKeys(poem.attributes);
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
            construct.own.classes.includes(NATIVEFONT_CLASS) ||
            construct.own.classes.some((name) => name === "emph" || name === "strong") ||
            Object.keys(construct.keys).length ||
            around(construct).some((container) => Object.keys(container.keys).length),
    );

    /** A language's tag, or `undefined` when it resolves to none. */
    const tagOf = (lang) =>
        lang === undefined ? undefined
        : Object.hasOwn(languages, lang) ? languages[lang].tag
        : isLanguageTag(lang) ? lang
        : undefined;

    const native = (construct) =>
        construct.keys.enc !== undefined && construct.keys.enc !== "default";

    const faceNames = () => [...faces.keys(), ...Object.keys(GENERIC_FONTS)];

    /** Check the keys a construct states itself. */
    const checkOwn = (construct) => {
        const { lang, font, enc } = construct.keys;
        const { at } = construct;
        if (construct.own.classes.includes(NATIVEFONT_CLASS))
            report(
                nativeAt(construct),
                "`.nativefont` is not an accepted class; select an encoding with `enc=`",
            );

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
        if (enc !== undefined && enc !== "default" && !encodingNamed(enc) && !encodingUnavailable) {
            const near = nearest(enc, [...encodings.keys()]);
            report(
                at("enc", "value"),
                `\`${enc}\` does not resolve to an encoding document` +
                    (near ? `; did you mean \`${near}\`?` : ""),
            );
        }
    };

    const nativeDefaults = (construct, keys) => {
        if (encodingUnavailable) return;
        const encoding = encodings.get(keys.enc);
        if (!encoding) return;
        if (
            encoding.language !== undefined &&
            keys.lang !== undefined &&
            keys.lang !== encoding.language &&
            tagOf(keys.lang)?.toLowerCase() !== tagOf(encoding.language)?.toLowerCase()
        )
            report(
                construct.at(construct.keys.lang !== undefined ? "lang" : "enc", "value"),
                `Encoding \`${encoding.name}\` writes language \`${encoding.language}\`, not \`${keys.lang}\``,
            );
        if (!keys.font || (!faces.has(keys.font) && !Object.hasOwn(GENERIC_FONTS, keys.font)))
            report(construct.at("enc", "value"), `Encoding font \`${keys.font}\` is unavailable`);
    };

    // A class-only child marks the parent's text. An explicit run key makes
    // a separate presentation choice, including an explicit language switch.
    const presentations = new Map();
    const presentationOf = (construct) => {
        if (presentations.has(construct)) return presentations.get(construct);
        const ancestors = around(construct);
        const inherits = construct.kind === "span" && !Object.keys(construct.keys).length;
        const parent = inherits ? ancestors.at(-1) : undefined;
        const inherited = parent ? presentationOf(parent) : undefined;
        const keys = inherited ? { ...inherited.keys } : {};
        if (!inherited)
            for (const ancestor of ancestors) {
                const inheritedKeys = presentationOf(ancestor).keys;
                if (inheritedKeys.lang !== undefined) keys.lang = inheritedKeys.lang;
                if (!native(ancestor) && ancestor.keys.font !== undefined)
                    keys.font = ancestor.keys.font;
            }
        if (native(construct)) delete keys.font;
        Object.assign(keys, construct.keys);
        keys.enc ??= "default";
        const selected = encodingNamed(keys.enc);
        if (selected) {
            keys.enc = selected.name;
            keys.lang ??= selected.language;
            keys.font ??= selected.font ?? selected.fonts[0];
        } else if (!inherits && keys.font === undefined && ancestors.some(native)) {
            keys.font = "serif";
        }
        const result = { keys };
        presentations.set(construct, result);
        return result;
    };

    const rawReferences = [];
    // Raw wikilinks belong to the resolver, not the span rewriter. Validate
    // their own control attributes with the same grammar before resolution,
    // without selection a destination or consuming the trailing attributes.
    for (const match of matchAllOutsideCode(text, new RegExp(WIKILINK.source, "g"))) {
        const close = match[0].indexOf("]]") + 1;
        const from = match.index + close + 2;
        const attrs = parseExtensionAttributes(match[0].slice(close + 2, -1), { positions: true });
        const at = positionOf(starts, match.index);
        const construct = {
            kind: "span",
            keys: runKeys(attrs.values),
            node: { contentEnd: match.index + close },
            line0: at.line - 1,
            where: { ...at, start: match.index, end: match.index + match[0].length },
            own: { classes: attrs.classes },
            at: (key, part) =>
                attrs.positions?.[key]?.[part] ?
                    positionOf(starts, from + attrs.positions[key][part].start)
                :   at,
        };
        const unchecked = errors.length;
        checkOwn(construct);
        const keys = presentationOf(construct).keys;
        const bar = match[1].indexOf("|");
        if (bar >= 0 && errors.length === unchecked) {
            rawReferences.push({
                lang: keys.lang,
                font: keys.font,
                enc: keys.enc,
                from: match.index + 2 + bar + 1,
                to: match.index + close - 1,
                where: construct.where,
                construct,
            });
        }
        if (errors.length !== unchecked || keys.enc === "default" || !encodingNamed(keys.enc))
            continue;
        nativeDefaults(construct, keys);
        if (errors.length !== unchecked || keys.enc === undefined || keys.font === undefined)
            continue;
        const problem = fontProblem(encodings.get(keys.enc), keys.font);
        if (problem)
            report(
                construct.at(construct.keys.font !== undefined ? "font" : "enc", "value"),
                problem,
            );
    }

    const verseMarkers = new Map();
    const verseContexts = [
        ...scanVerse(text, { checkWorks: false }).blocks,
        ...spans
            .filter((span) => span.verseModel)
            .map((span) => ({
                bodyStart: span.start + 1,
                bodyEnd: span.contentEnd,
                body: text.slice(span.start + 1, span.contentEnd),
                model: span.verseModel,
            })),
    ];
    // A reference with its own run keys is an independent child, just as
    // the presentation span produced by the link resolver is. Keep its label
    // out of the enclosing language and encoder without rewriting its target.
    const independentReferences = rawReferences.filter(
        (reference) =>
            Object.keys(reference.construct.keys).length &&
            verseContexts.some(
                (poem) =>
                    reference.where.start >= poem.bodyStart && reference.where.end <= poem.bodyEnd,
            ),
    );
    const referenceSpans = independentReferences.map((reference) => ({
        start: reference.where.start,
        end: reference.where.end,
        contentEnd: reference.to,
    }));
    for (const poem of verseContexts) {
        const bodyStart = poem.bodyStart;
        for (const [from, to] of poem.model.layout)
            verseMarkers.set(bodyStart + from, bodyStart + to);
        for (const match of poem.body.matchAll(WIKILINK)) {
            const bar = match[1].indexOf("|");
            if (bar < 0) {
                verseMarkers.set(
                    bodyStart + match.index,
                    bodyStart + match.index + match[0].length,
                );
                continue;
            }
            verseMarkers.set(bodyStart + match.index, bodyStart + match.index + 3 + bar);
            verseMarkers.set(
                bodyStart + match.index + match[0].indexOf("]]"),
                bodyStart + match.index + match[0].length,
            );
        }
        // Link destinations and footnote references remain Markdown; only a
        // link's visible label contributes text to the encoding projection.
        for (let at = 0; at < poem.body.length; at++) {
            if (poem.body[at] === "\\") {
                at++;
                continue;
            }
            if (poem.body[at] !== "[") continue;
            const end = closing(poem.body, at);
            if (end < 0) continue;
            if (poem.body[end + 1] === "(" && poem.body[at - 1] !== "!") {
                const past = closing(poem.body, end + 1);
                if (past < 0) continue;
                verseMarkers.set(bodyStart + at, bodyStart + at + 1);
                verseMarkers.set(bodyStart + end, bodyStart + past + 1);
            }
        }
    }

    const noteReferences = [
        ...new Map(
            [
                ...footnoteReferences(text, { definitions: footnotes }),
                ...spans.flatMap((span) => {
                    const label = referenceLabel(span.text);
                    if (!label) return [];
                    const base = span.start + 1 + label[0];
                    return footnoteReferences(span.text.slice(label[0], label[1]), {
                        definitions: footnotes,
                        inline: true,
                    }).map((reference) => ({
                        ...reference,
                        from: base + reference.from,
                        to: base + reference.to,
                    }));
                }),
                ...verseContexts.flatMap((region) =>
                    footnoteReferences(region.body, { definitions: footnotes, inline: true }).map(
                        (reference) => ({
                            ...reference,
                            from: reference.from + region.bodyStart,
                            to: reference.to + region.bodyStart,
                        }),
                    ),
                ),
            ].map((reference) => [reference.from, reference]),
        ).values(),
    ];

    /** Nested spans and verse markers excluded from a run, by absolute offset. */
    const holesIn = (from, to) =>
        new Map([
            ...noteReferences
                .filter((reference) => reference.from >= from && reference.from < to)
                .map((reference) => [reference.from, reference.to]),
            ...[...verseMarkers].filter(([start]) => start >= from && start < to),
            ...independentReferences
                .filter((reference) => reference.where.start >= from && reference.where.start < to)
                .map((reference) => [reference.where.start, reference.where.end]),
            ...verseContexts
                .filter(
                    (region) =>
                        Number.isFinite(region.from) && region.from >= from && region.from < to,
                )
                .map((region) => [region.from, Math.min(region.to, to)]),
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

    /** The configured source inventory for either an alias or its BCP 47 tag. */
    const inventoryOf = (lang) =>
        lang === undefined ? undefined : (
            (ctx.romanInventories?.get(lang) ?? ctx.romanInventories?.get(lang.toLowerCase()))
        );

    /**
     * Give a scroll fence the face it is set in, and report a fence that names
     * none or whose script is written in lines. A fence that names no face
     * takes its enc's, where the enc is drawn in one.
     *
     * @param {object} construct - The scroll fence.
     * @param {Record<string, string>} keys - Its run keys, given the face.
     */
    const scrollFace = (construct, keys) => {
        if (!ctx.directions || !(faces.has(keys.font) || Object.hasOwn(GENERIC_FONTS, keys.font)))
            return;
        if (ctx.directions.get(keys.font) === "vertical-rl") return;
        report(
            construct.keys.font !== undefined ? construct.at("font", "value")
            : construct.keys.enc !== undefined ? construct.at("enc", "value")
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
        let named = errors.length === unchecked;
        const { keys } = presentationOf(construct);
        if (named && native(construct)) {
            nativeDefaults(construct, keys);
            named = errors.length === unchecked;
        }
        const { lang, font, enc } = keys;
        // A face the run's enc is not for, once the face and the enc are each
        // known, at the construct that states either.
        const stated =
            native(construct) ||
            construct.keys.enc !== undefined ||
            construct.keys.font !== undefined;
        if (
            named &&
            stated &&
            enc !== undefined &&
            encodings.has(enc) &&
            font !== undefined &&
            (faces.has(font) || Object.hasOwn(GENERIC_FONTS, font))
        ) {
            const problem = fontProblem(encodings.get(enc), font);
            if (problem)
                report(
                    construct.at(construct.keys.font !== undefined ? "font" : "enc", "value"),
                    problem,
                );
        }
        named = errors.length === unchecked;
        if (construct.kind === "scroll" && named) {
            scrollFace(construct, keys);
            named = errors.length === unchecked;
        }
        const run = {
            kind: construct.kind,
            lang,
            tag: tagOf(lang),
            font,
            enc,
            ...construct.where,
        };
        runs.push(run);
        const plain =
            inventoryOf(lang) !== undefined ||
            font !== undefined ||
            (enc !== undefined && enc !== "default") ||
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
            encoding: enc === undefined ? undefined : encodings.get(enc),
            selection: enc === undefined ? undefined : encodingFor(ctx, { enc, font, lang }),
            holes: new Map(),
            body: undefined,
            verseModel: construct.kind === "span" ? construct.node.verseModel : undefined,
            contentEnd: construct.kind === "span" ? construct.node.contentEnd : undefined,
            reference: undefined,
            languageEmphasis: lang === undefined ? undefined : ctx.languageEmphases?.get(lang),
            conventions: undefined,
            emphasis: [],
            ...(construct.kind === "scroll" && construct.node.invalid ? { unrolled: true } : {}),
        };
        detail.conventions = conventionsOf(detail, ctx);
        details.push(detail);
        const nonEnglishSpan =
            construct.kind === "span" &&
            !construct.node.verseModel &&
            run.tag !== undefined &&
            !/^en(?:-|$)/i.test(run.tag);
        const emphasis = construct.own.classes.filter(
            (name) => name === "emph" || name === "strong",
        );
        if (emphasis.length > 1)
            report(construct.where, "a span takes `.emph` or `.strong`, not both");
        else if (emphasis[0] === "strong" && nonEnglishSpan)
            report(
                construct.where,
                `a span in non-English language \`${lang}\` holds no \`.strong\` emphasis`,
            );
        else if (emphasis[0] === "emph" && detail.languageEmphasis === "words")
            report(construct.where, wordsMessage(lang));
        if (!plain && !nonEnglishSpan) continue;
        const marking = [
            ...(lang === undefined ? [] : [`lang=${lang}`]),
            ...(font === undefined ? [] : [`font=${font}`]),
            ...(enc === undefined ? [] : [`enc=${enc}`]),
        ].join(" ");
        const before = errors.length;

        if (construct.kind === "span") {
            const span = construct.node;
            let from = span.start + 1;
            let to = span.contentEnd;
            const label = referenceLabel(text.slice(from, to));
            if (label) {
                detail.reference = [from + label[0], from + label[1]];
                [from, to] = detail.reference;
            }
            const inline = text.slice(from, to);
            detail.holes =
                label ?
                    new Map(
                        noteReferences
                            .filter((reference) => reference.from >= from && reference.to <= to)
                            .map((reference) => [reference.from, reference.to]),
                    )
                :   holesIn(from, to);
            if (nonEnglishSpan) {
                const relative = new Map(
                    [...detail.holes].map(([from, to]) => [
                        from - (span.start + 1),
                        to - (span.start + 1),
                    ]),
                );
                for (const delimiter of emphasisDelimiters(inline, relative))
                    if (delimiter.open)
                        report(
                            positionOf(starts, from + delimiter.offset),
                            `a span in non-English language \`${lang}\` holds no bold or italic markup`,
                        );
            }
            if (plain && errors.length === before)
                plainInline(inline, from, marking, detail, detail.holes);
            detail.checkRoman = errors.length === before;
            if (named && detail.checkRoman) detail.checkText = true;
            continue;
        }

        const first = construct.line0 + 1;
        const last = construct.last;
        // Verse regions retain authored UTF-16 bounds, including the full
        // width of a CRLF terminator. A one-byte closing-line adjustment
        // would leave CR outside the model and lose verse projection.
        const from =
            construct.kind === "verse" ? construct.node.bodyStart : (starts[first] ?? text.length);
        const to =
            construct.kind === "verse" ? construct.node.bodyEnd
            : last > first ? starts[last] - 1
            : from;
        detail.body = [from, to];
        detail.holes = holesIn(from, to);

        if (construct.kind === "block") {
            const body = lines.slice(first, last);
            const said = (line, what) =>
                report(
                    { line: first + line + 1, column: /^ */.exec(body[line])[0].length + 1 },
                    `a div marked \`${marking}\` holds paragraphs and line breaks only, not ${what}`,
                );
            for (const token of blockTokens(body.join("\n"))) {
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
                            "a code fence named `verse`; write a `::: {.verse}` div"
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
        detail.checkRoman = errors.length === before;
        if (named && detail.checkRoman) detail.checkText = true;
    }

    const boundsOf = (detail) =>
        detail.reference ??
        (detail.run.kind === "span" ? [detail.run.start + 1, detail.contentEnd] : detail.body);
    // Each run's parent and owner are read many times while ownership is
    // assigned below, so each is found once.
    const parents = new Map();
    const parentOf = (detail) => {
        if (!parents.has(detail)) parents.set(detail, findParent(detail));
        return parents.get(detail);
    };
    const findParent = (detail) => {
        if (detail.run.kind !== "span" || Object.keys(detail.keys).length) return undefined;
        return details
            .filter(
                (parent) =>
                    parent !== detail &&
                    boundsOf(parent) &&
                    boundsOf(parent)[0] <= detail.run.start &&
                    boundsOf(parent)[1] >= detail.run.end,
            )
            .sort((a, b) => boundsOf(a)[1] - boundsOf(a)[0] - (boundsOf(b)[1] - boundsOf(b)[0]))[0];
    };
    const owners = new Map();
    const ownerOf = (detail) => {
        if (!owners.has(detail)) {
            const parent = parentOf(detail);
            owners.set(detail, parent ? ownerOf(parent) : detail);
        }
        return owners.get(detail);
    };

    const spanDetails = new Map(
        details
            .filter((detail) => detail.run.kind === "span")
            .map((detail) => [detail.run.start, detail]),
    );
    // Inline runs, spans and labelled links, of one resolved language and
    // encoding separated only by whitespace form one punctuation stream: a
    // sentence or a quotation may run through several of them. Each run opens
    // in the state its predecessor in the stream closed in, and quotations
    // still open are reported once, where the stream ends. A block (a div,
    // verse or scroll) is a stream of its own and never joins an inline run,
    // as a paragraph does not continue a sentence from outside it; it still
    // separates the runs on either side of it.
    const ownerDetails = details
        .filter((detail) => ownerOf(detail) === detail)
        .sort((a, b) => a.run.start - b.run.start);
    const streamEntry = (where, lang, enc, checkable, inline) => {
        const inventory = inventoryOf(lang);
        // A block's bounds are its opening and closing line indices.
        const end = Math.min(where.end, lines.length - 1);
        return {
            inline,
            start: inline ? where.start : starts[where.start],
            end: inline ? where.end : starts[end] + lines[end].length,
            line: where.line,
            column: where.column,
            lang,
            language: tagOf(lang)?.toLowerCase() ?? lang,
            enc,
            inventory,
            checked: checkable && Boolean(inventory?.characters),
            previous: undefined,
            continued: false,
            state: undefined,
            problems: undefined,
        };
    };
    const streamRuns = [
        ...ownerDetails.map((detail) => ({
            ...streamEntry(
                detail.run,
                detail.run.lang,
                detail.run.enc,
                Boolean(boundsOf(detail) && detail.checkRoman),
                detail.run.kind === "span",
            ),
            detail,
        })),
        ...rawReferences.map((reference) => ({
            ...streamEntry(reference.where, reference.lang, reference.enc, true, true),
            reference,
        })),
    ].sort((a, b) => a.start - b.start);
    for (const entry of streamRuns) {
        if (!entry.checked || !entry.inline) continue;
        const previous = streamRuns
            .filter((other) => other.end <= entry.start)
            .reduce((last, other) => (last && last.end >= other.end ? last : other), undefined);
        if (
            previous?.checked &&
            previous.inline &&
            previous.inventory === entry.inventory &&
            previous.language === entry.language &&
            previous.enc === entry.enc &&
            /^[\p{Zs}\t\r\n]*$/u.test(text.slice(previous.end, entry.start))
        ) {
            entry.previous = previous;
            previous.continued = true;
        }
    }
    const streamRunOf = new Map(
        streamRuns.filter((entry) => entry.detail).map((entry) => [entry.detail, entry]),
    );
    /** The punctuation state a run opens in, a copy of its predecessor's. */
    const openingState = (entry) => {
        const previous = entry.previous && closingState(entry.previous);
        return previous ?
                {
                    sentenceStart: previous.sentenceStart,
                    quotes: previous.quotes.map((quote) => ({ ...quote })),
                }
            :   romanPunctuationState();
    };
    /** A run's closing punctuation state, checking a labelled link on demand. */
    const closingState = (entry) => {
        if (entry.reference) checkReference(entry);
        return entry.state;
    };
    /**
     * Check a run's Roman text in its stream, giving findings by source offset.
     *
     * @param {any} entry - The run.
     * @param {string} roman - Its projected Roman text.
     * @param {(offset: number) => number} source - A text offset's source offset.
     */
    const checkStream = (entry, roman, source) => {
        const state = openingState(entry);
        const problems = romanTextProblems(roman, entry.inventory, state).map((problem) => ({
            ...problem,
            offset: source(problem.offset),
        }));
        for (const quote of state.quotes) quote.source ??= source(quote.offset);
        if (!entry.continued)
            problems.push(
                ...romanUnclosedQuotations(
                    state.quotes.map((quote) => ({ ...quote, offset: quote.source })),
                ),
            );
        entry.state = state;
        return problems;
    };
    /** Check a labelled link's Roman source once, in its stream. */
    const checkReference = (entry) => {
        if (entry.problems) return entry.problems;
        entry.problems = [];
        if (!entry.checked) return entry.problems;
        const { reference } = entry;
        const plain = plainRomanRun(text, { from: reference.from, to: reference.to });
        entry.problems = checkStream(
            entry,
            plain.text,
            (offset) => plain.offsets[offset] ?? reference.from,
        );
        return entry.problems;
    };

    for (const owner of ownerDetails) {
        const bounds = boundsOf(owner);
        if (!bounds || !owner.checkRoman) continue;
        const owned = details.filter((detail) => ownerOf(detail) === owner);
        for (const detail of owned) detail.owner = owner;
        const excluded = [
            ...noteReferences
                .filter((reference) => reference.from >= bounds[0] && reference.from < bounds[1])
                .map((reference) => [reference.from, reference.to]),
            ...[...verseMarkers].filter(
                ([start]) =>
                    start >= bounds[0] &&
                    start < bounds[1] &&
                    !referenceSpans.some((span) => start === span.start),
            ),
            ...verseContexts
                .filter(
                    (region) =>
                        Number.isFinite(region.from) &&
                        region.from >= bounds[0] &&
                        region.from < bounds[1],
                )
                .map((region) => [region.from, Math.min(region.to, bounds[1])]),
            ...owned.flatMap((detail) =>
                detail.emphasis.map((delimiter) => [
                    delimiter.offset,
                    delimiter.offset + delimiter.length,
                ]),
            ),
        ];
        const projectionOptions = {
            from: bounds[0],
            to: bounds[1],
            spans: [...spans, ...referenceSpans],
            exclude: excluded,
            includeSpan: (span) =>
                spanDetails.has(span.start) && ownerOf(spanDetails.get(span.start)) === owner,
        };
        const poem = verseContexts
            .filter((region) => region.bodyStart <= bounds[0] && region.bodyEnd >= bounds[1])
            .sort((a, b) => a.bodyEnd - a.bodyStart - (b.bodyEnd - b.bodyStart))[0];
        const verse = poem !== undefined;
        const projection =
            verse ?
                plainRomanVerse(text, {
                    ...projectionOptions,
                    model: poem.model,
                    modelOffset: poem.bodyStart,
                })
            :   plainRomanRun(text, projectionOptions);
        const before = errors.length;
        const inventory = inventoryOf(owner.run.lang);
        if (inventory && !inventory.characters)
            report(
                { line: owner.run.line, column: owner.run.column },
                `the language note for \`${inventory.language}\` must declare \`data.roman\``,
            );
        else if (inventory) {
            const entry = streamRunOf.get(owner);
            for (const problem of checkStream(
                entry,
                projection.text,
                (offset) => projection.offsets[offset] ?? bounds[0],
            ))
                report(positionOf(starts, problem.offset), problem.message);
        }
        for (const problem of projection.errors ?? [])
            report(positionOf(starts, problem.offset), problem.message);

        const book = ctx.wordBooks?.get(owner.run.lang);
        if (book) {
            const mask = projection.text.split("");
            for (const match of projection.text.matchAll(/⟦[^]*?(?:⟧|$)/g))
                mask.fill(" ", match.index, match.index + match[0].length);
            for (const span of projection.spans.filter((span) => !span.included))
                mask.fill(" ", span.from, span.to);
            for (const problem of unknownWords(mask.join(""), book))
                report(
                    positionOf(starts, projection.offsets[problem.offset] ?? bounds[0]),
                    unknownWordMessage(problem.word, owner.run.lang),
                );
        }
        // Roman spelling and structure belong to the authored source even
        // when its selected encoding or face cannot be resolved. Only the
        // native conversion and glyph checks depend on that selection.
        if (!owner.checkText) continue;
        if (!owner.selection) {
            const marker = projection.text.indexOf("⟦");
            if (marker >= 0 && !encodingUnavailable)
                report(
                    positionOf(starts, projection.offsets[marker]),
                    "literal codage names no encoding; state `enc=`",
                );
            continue;
        }
        if (errors.length !== before) continue;
        const result = encodeWithLanguage(owner.selection.encoding, projection.text, {
            font: owner.selection.font,
            lexicon: owner.selection.lexicon,
        });
        const opaque = projection.spans.filter((span) => !span.included);
        const braces = new Map(
            projection.spans
                .filter((span) => span.included && span.name)
                .flatMap((span) => [
                    [span.from, { anchor: span.source.start + 1 }],
                    [span.to - 1, { anchor: span.source.contentEnd, closing: true }],
                ]),
        );
        const pieces = result.pieces
            .filter(
                (piece) => !opaque.some((span) => piece.start >= span.from && piece.end <= span.to),
            )
            .filter((piece) => !verse || !/[\r\n]/.test(piece.from) || piece.from.startsWith("⟦"))
            .map((piece) => {
                const brace = braces.get(piece.start);
                return {
                    ...piece,
                    offset: projection.offsets[piece.start] ?? bounds[0],
                    anchor: brace?.anchor ?? projection.offsets[piece.start] ?? bounds[0],
                    closing: brace?.closing ?? false,
                };
            });
        for (const finding of result.findings) {
            if (!opaque.some((span) => finding.offset >= span.from && finding.offset < span.to))
                report(
                    positionOf(starts, projection.offsets[finding.offset] ?? bounds[0]),
                    finding.message,
                );
        }
        if (verse) {
            for (const boundary of projection.boundaries) {
                let target;
                if (boundary.kind === "canto") {
                    const encoded = encodeWithLanguage(owner.selection.encoding, "***", {
                        font: owner.selection.font,
                        lexicon: owner.selection.lexicon,
                        verse: true,
                    });
                    for (const message of new Set(
                        encoded.findings.map((finding) => finding.message),
                    ))
                        report(positionOf(starts, boundary.sourceOffset), message);
                    target = encoded.text;
                } else
                    target =
                        boundary.kind === "line" ?
                            encodeText(owner.selection.encoding, "/", {
                                font: owner.selection.font,
                            })
                        :   owner.selection.encoding.controls.verseStanza;
                if (target === undefined) continue;
                pieces.push({
                    from: "",
                    to: target,
                    start: boundary.at,
                    end: boundary.at,
                    offset: boundary.sourceOffset,
                    anchor: boundary.sourceOffset,
                    boundary: boundary.kind,
                    closing: true,
                });
            }
        }
        pieces.sort((a, b) => a.anchor - b.anchor || a.start - b.start);
        const said = new Set();
        if (owner.face)
            for (const piece of pieces)
                for (const char of piece.to) {
                    const point = char.codePointAt(0);
                    if (
                        /\s/u.test(char) ||
                        /\p{Default_Ignorable_Code_Point}/u.test(char) ||
                        owner.face.draws.has(point) ||
                        said.has(point)
                    )
                        continue;
                    said.add(point);
                    report(
                        positionOf(starts, piece.offset),
                        `\`${piece.from}\` encodes to ${codeName(point)} in \`${owner.selection.encoding.name}\`, which the font \`${owner.face.slug}\` does not draw`,
                    );
                }
        const plan = { owner, bounds, projection, pieces, verse, emitted: new Set() };
        for (const detail of owned) detail.plan = plan;
    }

    for (const entry of streamRuns.filter((entry) => entry.reference)) {
        const inventory = inventoryOf(entry.lang);
        if (inventory && !inventory.characters)
            report(
                { line: entry.line, column: entry.column },
                `the language note for \`${inventory.language}\` must declare \`data.roman\``,
            );
        for (const problem of checkReference(entry))
            report(positionOf(starts, problem.offset), problem.message);
    }

    for (const reference of independentReferences) {
        const book = ctx.wordBooks?.get(reference.lang);
        if (!book) continue;
        const projection = plainRomanRun(text, { from: reference.from, to: reference.to });
        for (const problem of unknownWords(projection.text, book))
            report(
                positionOf(starts, projection.offsets[problem.offset] ?? reference.from),
                unknownWordMessage(problem.word, reference.lang),
            );
    }

    const firstEncodingRun =
        active.find(native) ??
        rawReferences.find((reference) => native(reference.construct))?.construct;
    if (encodingUnavailable && firstEncodingRun) {
        if (encodingUnavailable.file)
            errors.push({
                file: encodingUnavailable.file,
                line: encodingUnavailable.line ?? 1,
                column: encodingUnavailable.column ?? 1,
                message: encodingUnavailable.message,
            });
        else report(nativeAt(firstEncodingRun), encodingUnavailable.message);
    }
    for (const match of matchAllOutsideCode(text, /⟦/g)) {
        if (encodingUnavailable && firstEncodingRun) continue;
        if (
            details.some(
                (detail) =>
                    detail.selection &&
                    boundsOf(detail) &&
                    boundsOf(detail)[0] <= match.index &&
                    match.index < boundsOf(detail)[1],
            )
        )
            continue;
        const where = positionOf(starts, match.index);
        if (
            !errors.some(
                (error) =>
                    error.line === where.line &&
                    error.column === where.column &&
                    error.message.includes("literal codage"),
            )
        )
            report(where, "literal codage names no encoding; state `enc=`");
    }

    const order = (a, b) => a.line - b.line || a.column - b.column;
    runs.sort(order);
    details.sort((a, b) => order(a.run, b.run));
    errors.sort(order);
    warnings.sort(order);
    return { runs, details, errors, warnings, spans, divs, poems, references: noteReferences };
}

/**
 * Diagnostic columns count Unicode code points. Parsing, edits and run records
 * keep their UTF-16 source coordinates; foreign-file loader positions already
 * use the encoding file's own code-point columns.
 * @param {string} source - Original authored text.
 * @param {Array<{file?: string, line: number, column: number, message: string}>} findings - Internal findings.
 * @returns {Array<{file?: string, line: number, column: number, message: string}>} Public diagnostic positions.
 */
function diagnosticColumns(source, findings) {
    const lines = source.split("\n");
    return findings.map((finding) =>
        finding.file ? finding : (
            {
                ...finding,
                column:
                    [...(lines[finding.line - 1] ?? "").slice(0, Math.max(0, finding.column - 1))]
                        .length + 1,
            }
        ),
    );
}

/**
 * Find the spans, divs and verse divs marked with `lang=`, `font=` or
 * `enc=`, and every fault in their markup and their text.
 *
 * @param {string} source - Authored Markdown: a note body, or a whole file
 *   whose frontmatter is blanked.
 * @param {RunContext} [ctx] - The configured languages, the installed faces
 *   and the encodings. Without them every `lang=` must be a tag, every face and
 *   enc is unknown, and only `mono`, `serif` and `sans` are fonts.
 * @param {import("./content-session.mjs").ContentSyntax} [syntax] - Session
 *   scanner projections, so the source's spans and blocks are scanned once.
 * @returns {{runs: Run[], errors: Array<{file?: string, line: number, column: number, message: string}>, warnings: Array<{line: number, column: number, message: string}>}}
 *   The runs in source order, and each finding at its 1-based position. A
 *   warning is a `lang=` read as a tag that sits within one edit of a
 *   declared name. Diagnostic columns count Unicode code points; each run's
 *   source offsets and column remain UTF-16 units.
 */
export function scanRuns(source, ctx = {}, syntax) {
    const text = String(source ?? "");
    const authored = analyseRuns(text, ctx, syntax);
    const metre = metreFindings(scanVerse(text).blocks, text.split("\n"), {
        metres: ctx.metres,
        languages: ctx.languages,
        metreBooks: ctx.metreBooks,
        lexicons: ctx.lexicons,
        attributeColumns,
    });
    const merged = (found, extra) =>
        [...found, ...extra].sort((a, b) => a.line - b.line || a.column - b.column);
    return {
        runs: authored.runs,
        errors: diagnosticColumns(text, merged(authored.errors, metre.errors)),
        warnings: diagnosticColumns(text, merged(authored.warnings, metre.warnings)),
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
    const { run, own, keys, face, generic, encoding } = detail;
    const emphasis = own.classes.find((name) => name === "emph" || name === "strong");
    if (emphasis && !Object.keys(keys).length) {
        const convention = detail.conventions?.[emphasis === "emph" ? "em" : "strong"];
        return attributeText({
            lang: undefined,
            ...own,
            classes: [...own.classes, ...(convention ? [EMPHASIS_CLASSES[convention]] : [])],
        });
    }
    const changes =
        own.classes.includes(NATIVEFONT_CLASS) ||
        run.font !== undefined ||
        run.enc !== undefined ||
        (run.tag !== undefined &&
            (keys.lang !== run.tag || run.kind === "verse" || run.kind === "scroll"));
    if (!changes) return undefined;
    const convention =
        emphasis ? detail.conventions?.[emphasis === "emph" ? "em" : "strong"] : undefined;
    const classes = [
        ...own.classes.filter((name) => name !== NATIVEFONT_CLASS),
        ...(convention ? [EMPHASIS_CLASSES[convention]] : []),
    ];
    const values = [...own.values];
    if (face) {
        classes.push(SCRIPT_CLASS);
        if (run.kind === "block") classes.push(SCRIPT_BLOCK_CLASS);
        classes.push(face.class);
        if (run.kind !== "span" && face.direction === "rtl") values.push(["dir", "rtl"]);
        if (search) values.push(["data-pagefind-ignore", "true"]);
    } else if (generic) classes.push(generic);
    if (run.enc !== undefined && run.enc !== "default" && !encoding) return undefined;
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
    if (detail.plan) {
        const events = detail.plan.pieces.filter(
            (piece) =>
                piece.boundary !== "canto" &&
                ((piece.anchor >= from && piece.anchor < to) ||
                    (piece.anchor === to && piece.closing)),
        );
        for (const piece of events) detail.plan.emitted.add(piece);
        const breaks = [...text.slice(from, to).matchAll(/\r\n|\r|\n/g)].map((match) => ({
            anchor: from + match.index,
            text: match[0],
            newline: true,
        }));
        const emphasis = detail.emphasis
            .filter((delimiter) => delimiter.offset >= from && delimiter.offset < to)
            .map((delimiter) => ({
                anchor: delimiter.offset,
                text: emphasisTag(delimiter, detail.conventions, book),
                markup: true,
            }));
        const output = [...events, ...breaks, ...emphasis].sort(
            (a, b) => a.anchor - b.anchor || Number(a.newline) - Number(b.newline),
        );
        return output
            .map((event) =>
                event.newline || event.markup ?
                    event.text
                :   escapeRoman(event.to, lineStart && event.anchor === from),
            )
            .join("");
    }
    let out = "";
    let at = from;
    for (const delimiter of detail.emphasis) {
        if (delimiter.offset < from || delimiter.offset >= to) continue;
        if (delimiter.offset > at)
            out += setText(
                text.slice(at, delimiter.offset),
                detail.selection,
                at === from && lineStart,
            ).text;
        out += emphasisTag(delimiter, detail.conventions, book);
        at = delimiter.offset + delimiter.length;
    }
    if (at < to)
        out += setText(text.slice(at, to), detail.selection, at === from && lineStart).text;
    return out;
}

/**
 * Rewrite text marked with `lang=`, `font=` and `enc=` into the plain span,
 * div and verse grammar the rest of each chain renders.
 *
 * - **Verse layout markers** stay outside encoded text. A shared logical
 *   structure retains authored source positions and both presentations.
 * - **The enc, if any, is applied first.** Characters Markdown would read are
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
 *   lines joined by what the enc writes for a space, and left unescaped,
 *   since the body is raw. Its layout, each character with the source text it
 *   was written from, is returned for the book, which draws it.
 *
 * A run with a finding is left as written; {@link scanRuns} reports it.
 *
 * @param {string} source - Authored Markdown: a note body.
 * @param {RunContext} [ctx] - The configured languages, faces and encodings.
 * @param {import("./content-session.mjs").ContentSyntax} [syntax] - Session
 *   scanner projections.
 * @param {{target?: "site"|"foundry"|"book"}} [options] - The target the
 *   Markdown is rendered for; only `site` writes the search marker.
 * @returns {{markdown: string, errors: Array<{file?: string, line: number, column: number, message: string}>, scrolls: Map<string, import("./content-scroll.mjs").ScrollLayout>, verses: Map<string, {model: ReturnType<typeof import("./content-verse.mjs").parseVerse>, classes: string[], attributes: Record<string, string>, inline: boolean}>}}
 *   The rewritten Markdown, the findings of {@link scanRuns}, and each
 *   rewritten scroll fence's layout, by its rewritten body.
 */
export function renderRuns(source, ctx = {}, syntax, options = {}) {
    const search = options.target === "site";
    const book = options.target === "book";
    const text = String(source ?? "");
    /** @type {Map<string, import("./content-scroll.mjs").ScrollLayout>} */
    const scrolls = new Map();
    const verses = new Map();
    if (!/\b(?:lang|font|enc)=|\bnativefont\b|\.(?:emph|strong)\b|⟦/.test(text))
        return { markdown: text, errors: [], scrolls, verses };
    const { details, errors, references } = analyseRuns(text, ctx, syntax);
    if (!details.length)
        return { markdown: text, errors: diagnosticColumns(text, errors), scrolls, verses };
    const lines = text.split("\n");
    const starts = lineStarts(text);

    /** Whether a finding sits inside a run. */
    const faulted = (run) => {
        if (run.enc !== "default" && errors.some((error) => error.file)) return true;
        const from = (run.line - 1) * 1e6 + run.column;
        const end = run.kind === "span" ? positionOf(starts, run.end) : undefined;
        const to = end ? (end.line - 1) * 1e6 + end.column : (run.end + 1) * 1e6;
        return errors.some((error) => {
            if (error.file) return false;
            const at = (error.line - 1) * 1e6 + error.column;
            return at >= from && at < to;
        });
    };

    /** @type {Array<{from: number, to: number, text: string}>} */
    const edits = [];
    const poems = [
        ...scanVerse(text, { checkWorks: false }).blocks.map((block) => ({
            ...block,
            inline: false,
        })),
        ...scanSpans(text)
            .spans.filter((span) => span.verseModel)
            .map((span) => ({
                ...span,
                inline: true,
                model: span.verseModel,
                body: text.slice(span.start + 1, span.contentEnd),
                bodyStart: span.start + 1,
                bodyEnd: span.contentEnd,
            })),
    ].sort((a, b) => a.bodyStart - b.bodyStart);
    const logicalRanges = poems.flatMap((poem) => {
        const base = poem.bodyStart;
        return poem.model.groups.flatMap((group) =>
            group.cantoBreak ? [] : group.lines.map((line) => [base + line.from, base + line.to]),
        );
    });
    const rangesWithin = (from, to) => {
        const cuts = logicalRanges.flat().filter((at) => at > from && at < to);
        const points = [from, ...new Set(cuts.sort((a, b) => a - b)), to];
        return points.slice(1).map((past, index) => [points[index], past]);
    };

    /**
     * A scroll fence's body set as one line per paragraph, and its layout.
     *
     * @param {RunDetail} detail - The scroll fence.
     * @returns {{text: string, layout: import("./content-scroll.mjs").ScrollLayout}}
     *   The body and the layout.
     */
    const setScroll = (detail) => {
        const join = setScrollText(" ", detail.selection);
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
                    const chars = [...piece.to].filter(
                        (char) => !/\p{Default_Ignorable_Code_Point}/u.test(char),
                    );
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
                const pieces = detail.plan?.pieces.filter(
                    (piece) => piece.anchor >= from && piece.anchor < to,
                );
                const result =
                    pieces ?
                        { text: pieces.map((piece) => piece.to).join(""), pieces }
                    :   setScrollText(text.slice(from, to), detail.selection);
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
        if (faulted(run) || (detail.owner && faulted(detail.owner.run))) continue;
        const attributes = rewrittenAttributes(detail, search);
        if (run.kind === "span") {
            const contentEnd = /** @type {number} */ (detail.contentEnd);
            if (book && detail.reference) {
                // The book's link renderer adds page and volume cues after
                // the label. Keep those in the page font, while the authored
                // presentation attributes still enclose the whole reference.
                const empty = { id: "", classes: [], values: [] };
                const native =
                    rewrittenAttributes({ ...detail, own: empty }, search) ??
                    attributeText({ lang: run.tag, ...empty });
                const [from, to] = detail.reference;
                const label = `[${setRange(text, from, to, detail, false, book)}]{${native}}`;
                const reference =
                    text.slice(run.start + 1, from) + label + text.slice(to, contentEnd);
                const outer = attributeText({
                    lang: undefined,
                    ...detail.own,
                    classes: detail.own.classes.filter((name) => name !== NATIVEFONT_CLASS),
                });
                edits.push({
                    from: run.start,
                    to: run.end,
                    text: outer ? `[${reference}]{${outer}}` : reference,
                });
                continue;
            }
            const emphasis = detail.own.classes.some(
                (name) => name === "emph" || name === "strong",
            );
            if (emphasis && book && detail.face && !detail.conventions) {
                edits.push({ from: run.start, to: run.start + 1, text: "" });
                edits.push({ from: contentEnd, to: run.end, text: "" });
            } else if (attributes !== undefined)
                edits.push({ from: contentEnd + 2, to: run.end - 1, text: attributes });
            if (detail.plain)
                for (const [from, to] of detail.reference ?
                    [detail.reference]
                :   outsideHoles(run.start + 1, contentEnd, detail.holes)) {
                    for (const [first, past] of rangesWithin(from, to)) {
                        const set = setRange(text, first, past, detail, false, book);
                        if (set !== text.slice(first, past))
                            edits.push({ from: first, to: past, text: set });
                    }
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
            if (open < 0 && run.kind === "verse") {
                const opening = lines[run.start];
                edits.push({
                    from: starts[run.start] + opening.indexOf(":::"),
                    to: starts[run.start] + opening.replace(/\r$/, "").length,
                    text: `::: {${attributes}}`,
                });
            } else
                edits.push({
                    from: starts[run.start] + open + 1,
                    to: starts[run.start] + close,
                    text: attributes,
                });
        }
        if (detail.plain && detail.body)
            for (const [from, to] of outsideHoles(detail.body[0], detail.body[1], detail.holes)) {
                for (const [first, past] of rangesWithin(from, to)) {
                    const lineStart = first === 0 || text[first - 1] === "\n";
                    const set = setRange(text, first, past, detail, lineStart, book);
                    if (set !== text.slice(first, past))
                        edits.push({ from: first, to: past, text: set });
                }
            }
    }

    for (const detail of details) {
        if (!detail.plan || detail.plan.owner !== detail || faulted(detail.run)) continue;
        for (const piece of detail.plan.pieces.filter(
            (piece) => piece.boundary && !detail.plan.emitted.has(piece),
        )) {
            if (piece.boundary === "canto") {
                const end = text.indexOf("\n", piece.anchor);
                edits.push({ from: piece.anchor, to: end < 0 ? text.length : end, text: piece.to });
            } else {
                // A final independent child may occupy the rest of the line.
                // Its boundary belongs after that child, in the enclosing face.
                edits.push({
                    from: piece.anchor,
                    to: piece.anchor,
                    text: escapeRoman(piece.to, false),
                });
            }
        }
    }

    const restoredReferences = new Map();
    for (const reference of references) {
        const nativeDiv = details.find(
            (detail) =>
                detail.run.kind === "verse" &&
                detail.selection &&
                detail.run.enc !== "default" &&
                detail.body &&
                reference.from >= detail.body[0] &&
                reference.to <= detail.body[1] &&
                !faulted(detail.run),
        );
        const nativeSpans = details
            .filter(
                (detail) =>
                    detail.run.kind === "span" &&
                    detail.selection &&
                    detail.run.enc !== "default" &&
                    reference.from > detail.run.start &&
                    reference.to <= detail.contentEnd &&
                    !faulted(detail.run),
            )
            .sort((a, b) => a.run.start - b.run.start);
        const outer = nativeSpans[0];
        if (!nativeDiv && !outer) continue;
        if (!edits.some((edit) => edit.from <= reference.from && edit.to >= reference.to))
            edits.push({ from: reference.from, to: reference.to, text: "" });
        if (nativeDiv) continue;
        if (!restoredReferences.has(outer.run.end)) restoredReferences.set(outer.run.end, []);
        restoredReferences.get(outer.run.end).push(reference);
    }
    for (const [at, notes] of restoredReferences)
        edits.push({
            from: at,
            to: at,
            text: notes
                .sort((a, b) => a.from - b.from)
                .map((reference) => reference.text)
                .join(""),
        });

    let markdown = text;
    for (const edit of edits.sort((a, b) => b.from - a.from))
        markdown = markdown.slice(0, edit.from) + edit.text + markdown.slice(edit.to);
    // Models retain authored structure; a native script may draw the boundaries
    // as glyphs which must not be reparsed as Roman delimiters.
    const rewritten = [
        ...scanVerse(markdown, { checkWorks: false }).blocks.map((block) => ({
            ...block,
            inline: false,
        })),
        ...scanSpans(markdown)
            .spans.filter((span) => span.verseModel)
            .map((span) => ({
                ...span,
                inline: true,
                body: markdown.slice(span.start + 1, span.contentEnd),
                bodyStart: span.start + 1,
                bodyEnd: span.contentEnd,
            })),
    ].sort((a, b) => a.bodyStart - b.bodyStart);
    const pairedEdits = [];
    for (const [index, poem] of poems.entries()) {
        const detail = details.find(
            (detail) =>
                detail.run.kind === (poem.inline ? "span" : "verse") &&
                detail.run.start === poem.start,
        );
        if (!detail || detail.run.enc === "default" || !detail.selection || faulted(detail.run))
            continue;
        const block = rewritten[index];
        if (!block) continue;
        const base = poem.bodyStart;
        const applyLine = (line) => {
            const patches = [];
            for (const edit of edits) {
                const positions = line.offsets.flatMap((offset, index) => {
                    const sourceOffset = base + offset;
                    return sourceOffset >= edit.from && sourceOffset < edit.to ? [index] : [];
                });
                if (positions.length)
                    patches.push({ from: positions[0], to: positions.at(-1) + 1, text: edit.text });
                else if (
                    (edit.from === edit.to && edit.from === base + line.to) ||
                    (edit.from > base + (line.offsets.at(-1) ?? line.from) &&
                        edit.to <= base + line.to)
                )
                    // Trailing source whitespace has no logical-text offsets.
                    // It may still carry a stanza control after a footnote hole.
                    patches.push({ from: line.text.length, to: line.text.length, text: edit.text });
            }
            let result = line.text;
            for (const edit of patches.sort((a, b) => b.from - a.from))
                result = result.slice(0, edit.from) + edit.text + result.slice(edit.to);
            return result.replace(/\r?\n[ ]*/g, "").trim();
        };
        const rewriteSpanAttributes = (source, rewrite) => {
            const changes = scanSpans(source).spans.flatMap((span) => {
                const attrs = parseExtensionAttributes(
                    source.slice(span.contentEnd + 2, span.end - 1),
                );
                if (!rewrite(attrs, span)) return [];
                return [
                    {
                        from: span.contentEnd + 2,
                        to: span.end - 1,
                        text: attributeText({
                            lang: attrs.values.lang,
                            id: attrs.id,
                            classes: attrs.classes,
                            values: Object.entries(attrs.values).filter(([key]) => key !== "lang"),
                        }),
                    },
                ];
            });
            let result = source;
            for (const change of changes.sort((a, b) => b.from - a.from))
                result = result.slice(0, change.from) + change.text + result.slice(change.to);
            return result;
        };
        const romanLine = (source) =>
            rewriteSpanAttributes(source, (attrs) => {
                const lang = attrs.values.lang;
                if (lang !== undefined) attrs.values.lang = ctx.languages?.[lang]?.tag ?? lang;
                delete attrs.values.enc;
                delete attrs.values.font;
                attrs.id = "";
                return true;
            });
        const model = structuredClone(poem.model);
        for (const note of model.notes ?? []) {
            note.romanText = romanLine(note.text);
            note.text = "";
        }
        for (const group of model.groups) {
            if (group.cantoBreak) {
                group.text =
                    detail.plan?.pieces.find(
                        (piece) => piece.boundary === "canto" && piece.offset === base + group.from,
                    )?.to ?? "";
                continue;
            }
            for (const line of group.lines) {
                line.romanText = romanLine(line.text);
                const ids = new Set(
                    scanSpans(line.text)
                        .spans.map((span) => span.id)
                        .filter(Boolean),
                );
                line.text = rewriteSpanAttributes(applyLine(line), (attrs, span) => {
                    if (!span.id || ids.has(span.id)) return false;
                    attrs.id = "";
                    return true;
                });
            }
        }
        if (poem.inline) {
            const values = Object.fromEntries(
                block.attrs.filter(([key]) => !["id", "class"].includes(key)),
            );
            const classes = (block.attrs.find(([key]) => key === "class")?.[1] ?? "")
                .split(/\s+/)
                .filter((name) => name && name !== "verse");
            const attributes = attributeText({
                lang: values.lang,
                id: block.id,
                classes,
                values: Object.entries(values).filter(([key]) => key !== "lang"),
            });
            const fragments = model.groups.flatMap((group) =>
                group.cantoBreak ? [{ from: group.from, text: group.text ?? "" }] : group.lines,
            );
            // Consecutive boundaries can stand between logical lines. They
            // still contribute controls even when no line owns their offsets.
            for (const piece of detail.plan?.pieces ?? []) {
                if (!piece.boundary || piece.boundary === "canto") continue;
                const offset = piece.anchor - base;
                if (
                    model.groups.some((group) =>
                        group.lines.some((line) => offset >= line.from && offset <= line.to),
                    )
                )
                    continue;
                fragments.push({ from: offset, text: escapeRoman(piece.to, false) });
            }
            const native = fragments
                .sort((a, b) => a.from - b.from)
                .map((fragment) => fragment.text)
                .join("");
            pairedEdits.push({
                from: block.start,
                to: block.end,
                text: `[${native}]{${attributes}}`,
            });
            continue;
        }
        const classes = [SCRIPT_CLASS, ...(detail.face ? [detail.face.class] : [])];
        const attributes = {
            ...(detail.run.tag ? { lang: detail.run.tag } : {}),
            ...(detail.face?.direction === "rtl" ? { dir: "rtl" } : {}),
            ...(search ? { "data-pagefind-ignore": "true" } : {}),
        };
        const marker = `<!--verse-pair:${verses.size + 1}-->${poem.inline ? "" : "\n"}`;
        const body = marker + block.body;
        verses.set(body, { model, classes, attributes, inline: poem.inline });
        pairedEdits.push({ from: block.bodyStart, to: block.bodyStart, text: marker });
    }
    for (const edit of pairedEdits.sort((a, b) => b.from - a.from))
        markdown = markdown.slice(0, edit.from) + edit.text + markdown.slice(edit.to);
    return { markdown, errors: diagnosticColumns(text, errors), scrolls, verses };
}
