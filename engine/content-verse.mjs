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

/** The authored verse lines, excluding stanza separators. */
export function verseLines(body) {
    return String(body ?? "")
        .split("\n")
        .filter((line) => line.trim());
}

/**
 * The least-indented verse is level zero. Every two additional leading spaces
 * add one level; a leftover space is discarded and the level stops at eight.
 * Blank lines divide stanzas rather than contributing to the baseline.
 */
export function verseStanzas(body) {
    const lines = String(body ?? "").split("\n");
    const verses = verseLines(body);
    if (!verses.length) return [];
    const baseline = Math.min(...verses.map((line) => /^ */.exec(line)[0].length));
    const stanzas = [];
    let stanza = [];
    for (const line of lines) {
        if (!line.trim()) {
            if (stanza.length) stanzas.push(stanza);
            stanza = [];
            continue;
        }
        const spaces = /^ */.exec(line)[0].length;
        stanza.push({
            text: line.slice(spaces).trimEnd(),
            level: Math.min(8, Math.floor((spaces - baseline) / 2)),
        });
    }
    if (stanza.length) stanzas.push(stanza);
    return stanzas;
}

/** A verse is inline Markdown even when it starts with block syntax. */
export function inlineVerse(text) {
    return String(text)
        .replace(/^(#{1,6}\s|>\s|[-+*]\s|:{1,2}\s|`{3,}|~{3,}|-{3,}\s*$)/, "\\$1")
        .replace(/^(\d+)([.)])\s/, "$1\\$2 ");
}

/**
 * Keep stanzas as Markdown paragraphs and make every verse line a hard break.
 * The surrounding renderer still sees the entire note, so links and footnote
 * definitions remain in scope. The span carries the indent for each line.
 */
export function verseMarkdown(body, step = 0) {
    let count = 0;
    return verseStanzas(body)
        .map((stanza) =>
            stanza
                .map(({ text, level }) => {
                    const number = lineNumber(++count, step);
                    return `<span class="verse-line${level ? ` i${level}` : ""}">${number === undefined || number === "" ? "" : `<span class="verse-number">${number}</span>`}${inlineVerse(text)}</span>`;
                })
                .join("  \n"),
        )
        .join("\n\n");
}

/**
 * The number a line shows: `undefined` when the verse is not numbered, `""`
 * when this line is not one of every `step`th.
 *
 * @param {number} line - The line's number, 1-based across the verse.
 * @param {number} step - The verse's `numstep`.
 * @returns {string|undefined} The number shown.
 */
export function lineNumber(line, step) {
    if (!step) return undefined;
    return line % step === 0 ? String(line) : "";
}

/**
 * The rows of an expanded verse in columns: one row per verse line, holding
 * its number when the verse is numbered, then each column's entries stacked,
 * the first in the normal tone and each later one `verse-secondary`. A part
 * whose text runs right to left carries `dir="rtl"`. A row is a line of a
 * paragraph, and a paragraph a stanza, so each part stays inline Markdown.
 *
 * @param {object} block - An expanded verse from {@link scanVerse}.
 * @param {string[]} lines - The source, by line.
 * @param {number} step - The verse's `numstep`.
 * @returns {string} The rows as Markdown with inline HTML.
 */
function columnsMarkdown(block, lines, step) {
    const counts = verseColumns(block, lines[block.start]).map((column) => column.entries.length);
    const total = counts.reduce((sum, n) => sum + n, 0);
    const stanzas = [[]];
    let count = 0;
    const body = lines.slice(block.start + 1, block.end).map((line) => line.trim());
    for (let at = 0; at < body.length;) {
        if (!body[at]) {
            at++;
            continue;
        }
        if (STANZA_BREAK.test(body[at])) {
            stanzas.push([]);
            at++;
            continue;
        }
        const parts = body.slice(at, at + total);
        at += total;
        const number = lineNumber(++count, step);
        let next = 0;
        const cells = counts.map(
            (n) =>
                '<span class="verse-column">' +
                parts
                    .slice(next, (next += n))
                    .map(
                        (part, k) =>
                            `<span class="verse-part${k ? " verse-secondary" : ""}"${rightToLeft(part) ? ' dir="rtl"' : ""}>${part}</span>`,
                    )
                    .join("") +
                "</span>",
        );
        stanzas
            .at(-1)
            .push(
                '<span class="verse-row">' +
                    (number === undefined ? "" : `<span class="verse-number">${number}</span>`) +
                    cells.join("") +
                    "</span>",
            );
    }
    return stanzas
        .filter((rows) => rows.length)
        .map((rows) => rows.join("\n"))
        .join("\n\n");
}

import MarkdownIt from "markdown-it";
import { slugify } from "./content-slug.mjs";
import { parseExtensionAttributes, refusedAttributes } from "./extension-attributes.mjs";

const structureParser = new MarkdownIt({ html: true });

/** The keys that set a verse in columns, the left first. */
export const COLUMN_KEYS = Object.freeze(["col1", "col2"]);

/** The class the build gives a verse in columns once its lines are expanded. */
export const COLUMNS_CLASS = "verse-columns";

/**
 * The keys a verse fence's attribute block takes. `lang`, `font` and `map`
 * are read by `scanRuns` in content-scripts.mjs; `dir`, and on the site
 * `data-pagefind-ignore`, are written by its rewrite of a fence set in one of
 * the faces, and reach the element as they are written.
 */
export const VERSE_KEYS = Object.freeze([
    "form",
    "meter",
    "rhyme",
    "syllables",
    "lang",
    "font",
    "map",
    "numstep",
    ...COLUMN_KEYS,
    "dir",
    "data-pagefind-ignore",
]);

/** Read verse code fences; start/end are inclusive zero-based source lines.
 * @param {string} source - Authored Markdown.
 */
export function scanVerse(source) {
    const lines = String(source ?? "").split("\n"),
        blocks = [],
        errors = [];
    const literalLines = new Set();
    for (const token of structureParser.parse(String(source ?? ""), {})) {
        if (!token.map || !["blockquote_open", "html_block"].includes(token.type)) continue;
        for (let line = token.map[0]; line < token.map[1]; line++) literalLines.add(line);
    }
    let opening = null;
    for (let i = 0; i < lines.length; i++) {
        if (literalLines.has(i)) continue;
        const match = /^ *(`{3,}|~{3,})(.*)$/.exec(lines[i]);
        if (opening) {
            if (
                match &&
                match[1][0] === opening.fence[0] &&
                match[1].length >= opening.fence.length &&
                !match[2].trim()
            ) {
                if (opening.name === "verse") {
                    const body = lines.slice(opening.start + 1, i).join("\n");
                    if (!body.trim())
                        errors.push({
                            line: opening.start + 1,
                            column: 1,
                            message: "verse block is empty",
                        });
                    for (let n = opening.start + 1; n < i; n++) {
                        const col = lines[n].indexOf("\t");
                        if (col >= 0)
                            errors.push({
                                line: n + 1,
                                column: col + 1,
                                message: "tabs are not allowed in verse",
                            });
                    }
                    const block = { ...opening, end: i, body };
                    const columned = hasColumns(block);
                    const count =
                        columned ?
                            verseGroups(block, lines).filter((group) => !group.stanzaBreak).length
                        :   verseLines(body).length;
                    if (
                        opening.attributes.syllables &&
                        opening.attributes.syllables.split(",").length !== count
                    )
                        errors.push({
                            line: opening.start + 1,
                            column: 1,
                            message: `verse syllables= gives ${opening.attributes.syllables.split(",").length} counts for ${count} verse lines`,
                        });
                    if (columned) errors.push(...columnFindings(block, lines));
                    blocks.push(block);
                }
                opening = null;
            }
            continue;
        }
        if (!match) continue;
        const info = match[2].trim();
        opening = {
            start: i,
            fence: match[1],
            name: info.split(/\s/)[0],
            attributes: {},
            id: "",
            classes: [],
            indent: /^ */.exec(lines[i])[0],
        };
        if (opening.name !== "verse") continue;
        const raw = info.slice(6).trim();
        const at = { line: i + 1, column: 1 };
        if (raw && !/^\{[^}\n]*\}$/.test(raw)) {
            errors.push({ ...at, message: "verse attributes need {…} braces" });
            continue;
        }
        const parsed = parseExtensionAttributes(raw ? raw.slice(1, -1) : "");
        opening.id = parsed.id;
        opening.classes = parsed.classes;
        opening.attributes = parsed.values;
        for (const message of [...parsed.problems, ...refusedAttributes(parsed.values)])
            errors.push({ ...at, message });
        for (const [key, value] of Object.entries(parsed.values)) {
            if (/^col/.test(key) && !COLUMN_KEYS.includes(key))
                errors.push({
                    line: i + 1,
                    column: keyColumn(lines[i], key),
                    message: `\`${key}=\` is not a column: a verse has at most two, \`col1=\` and \`col2=\``,
                });
            else if (!VERSE_KEYS.includes(key))
                errors.push({ ...at, message: `${key}= is not a verse attribute` });
            else if (key === "numstep" && !/^\d+$/.test(value))
                errors.push({
                    line: i + 1,
                    column: keyColumn(lines[i], key),
                    message: "verse numstep= numbers every Nth line: a whole number, 0 for none",
                });
            else if (key === "syllables" && !/^[1-9]\d*(?:,[1-9]\d*)*$/.test(value))
                errors.push({
                    ...at,
                    message: "verse syllables= needs positive comma-separated counts",
                });
        }
    }
    if (opening?.name === "verse")
        errors.push({
            line: opening.start + 1,
            column: 1,
            message: "verse block needs a closing code fence",
        });
    errors.sort((a, b) => a.line - b.line || a.column - b.column);
    return { blocks, errors };
}

/**
 * The 1-based column of `key=`, or of a class or id token, in an opening line.
 *
 * @param {string} opening - The fence's opening line.
 * @param {string} key - The key, or a `.class` or `#id` token.
 * @returns {number} Its column, or the brace's when it is not found.
 */
function keyColumn(opening, key) {
    const brace = opening.indexOf("{");
    const token = /^[.#]/.test(key) ? key : `${key}=`;
    const at = opening
        .slice(brace)
        .search(new RegExp(`(?<=[{\\s])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    return (at < 0 ? brace : brace + at) + 1;
}

/** Whether a verse states a column. */
export function hasColumns(block) {
    return COLUMN_KEYS.some((key) => Object.hasOwn(block.attributes ?? {}, key));
}

/** One part of a column entry, `language[/mapping[/font]]`. */
const ENTRY_PART = /^[A-Za-z0-9_-]+$/;

/**
 * A column's stacked entries, each with its offset in the written value.
 *
 * @param {string} value - A `col1=` or `col2=` value.
 * @returns {Array<{raw: string, offset: number, lang?: string, map?: string, font?: string, offsets: {lang: number, map?: number, font?: number}}>}
 *   Each entry; one whose `lang` is `undefined` is malformed.
 */
export function columnEntries(value) {
    const entries = [];
    let offset = 0;
    for (const raw of String(value).split(":")) {
        const parts = raw.split("/");
        const sound = parts.length <= 3 && parts.every((part) => ENTRY_PART.test(part));
        const offsets = { lang: offset };
        let at = offset;
        for (const [n, name] of [
            [1, "map"],
            [2, "font"],
        ]) {
            if (parts.length <= n) break;
            at += parts[n - 1].length + 1;
            offsets[name] = at;
        }
        entries.push({
            raw,
            offset,
            offsets,
            ...(sound ?
                {
                    lang: parts[0],
                    ...(parts[1] === undefined ? {} : { map: parts[1] }),
                    ...(parts[2] === undefined ? {} : { font: parts[2] }),
                }
            :   {}),
        });
        offset += raw.length + 1;
    }
    return entries;
}

/**
 * The columns of a verse, the left first, each entry located in the opening
 * line.
 *
 * @param {object} block - A verse from {@link scanVerse}.
 * @param {string} opening - Its opening line.
 * @returns {Array<{key: string, entries: Array<ReturnType<typeof columnEntries>[number] & {column: number, columns: {lang: number, map?: number, font?: number}}>}>}
 *   1-based columns.
 */
export function verseColumns(block, opening) {
    return COLUMN_KEYS.filter((key) => Object.hasOwn(block.attributes, key)).map((key) => {
        const start = keyColumn(opening, key) + key.length + 1;
        const quoted = opening[start - 1] === '"' ? 1 : 0;
        return {
            key,
            entries: columnEntries(block.attributes[key]).map((entry) => ({
                ...entry,
                column: start + quoted + entry.offset,
                columns: Object.fromEntries(
                    Object.entries(entry.offsets).map(([name, at]) => [name, start + quoted + at]),
                ),
            })),
        };
    });
}

/**
 * The line that breaks a stanza in a verse in columns, `***`, also as the
 * rewrite of marked text escapes it.
 */
export const STANZA_BREAK = /^(?:\\?\*){3}$/;

/** A whole-line span, `[text]{attributes}`. */
const LINE_SPAN = /^\[(.*)\]\{([^{}]*)\}$/;

/**
 * The verse lines of a verse in columns: each blank-line group of span lines
 * is one verse line, and a line holding only `***` breaks the stanza.
 *
 * @param {object} block - A verse from {@link scanVerse}.
 * @param {string[]} lines - The source, by line.
 * @returns {Array<{stanzaBreak: true, line: number}|{stanzaBreak?: false, parts: Array<{line: number, column: number, text: string, textColumn: number, lang?: string, span: boolean, extra: boolean, indent: number}>}>}
 *   0-based lines, 1-based columns.
 */
export function verseGroups(block, lines) {
    const groups = [];
    let parts = [];
    const end = () => {
        if (parts.length) groups.push({ parts });
        parts = [];
    };
    const body = lines.slice(block.start + 1, block.end).filter((line) => line.trim());
    const baseline = body.length ? Math.min(...body.map((line) => /^ */.exec(line)[0].length)) : 0;
    for (let at = block.start + 1; at < block.end; at++) {
        const line = lines[at];
        if (!line.trim()) {
            end();
            continue;
        }
        if (line.trim() === "***") {
            end();
            groups.push({ stanzaBreak: true, line: at });
            continue;
        }
        const spaces = /^ */.exec(line)[0].length;
        const written = line.slice(spaces).trimEnd();
        const span = LINE_SPAN.exec(written);
        const parsed = span ? parseExtensionAttributes(span[2]) : undefined;
        parts.push({
            line: at,
            column: spaces + 1,
            indent: spaces - baseline,
            span: Boolean(span),
            text: span ? span[1] : written,
            textColumn: spaces + 1 + (span ? 1 : 0),
            lang: span ? parsed.values.lang : block.attributes.lang,
            extra:
                Boolean(parsed) &&
                (parsed.problems.length > 0 ||
                    Boolean(parsed.id) ||
                    parsed.classes.length > 0 ||
                    Object.keys(parsed.values).some((key) => key !== "lang") ||
                    parsed.values.lang === undefined),
        });
    }
    end();
    return groups;
}

/**
 * What is wrong with a verse in columns, each finding at its own text.
 *
 * @param {object} block - A verse from {@link scanVerse} stating a column.
 * @param {string[]} lines - The source, by line.
 * @returns {Array<{line: number, column: number, message: string}>} 1-based.
 */
function columnFindings(block, lines) {
    const errors = [];
    const opening = lines[block.start];
    const report = (line, column, message) => errors.push({ line: line + 1, column, message });
    for (const key of ["font", "map"])
        if (Object.hasOwn(block.attributes, key))
            report(
                block.start,
                keyColumn(opening, key),
                `a verse in columns sets each column's fonts and maps in \`col1=\` and \`col2=\`, not with \`${key}=\``,
            );
    if (block.classes.includes(COLUMNS_CLASS))
        report(
            block.start,
            keyColumn(opening, `.${COLUMNS_CLASS}`),
            `\`.${COLUMNS_CLASS}\` is the class the build gives a verse in columns; leave it out`,
        );
    const columns = verseColumns(block, opening);
    for (const { key, entries } of columns)
        for (const entry of entries)
            if (entry.lang === undefined)
                report(
                    block.start,
                    entry.column,
                    `\`${entry.raw}\` in \`${key}=\` is not an entry: an entry is \`language[/mapping[/font]]\``,
                );
    const named = new Map();
    for (const { key, entries } of columns)
        for (const entry of entries)
            if (entry.lang !== undefined && !named.has(entry.lang)) named.set(entry.lang, key);
    for (const group of verseGroups(block, lines)) {
        if (group.stanzaBreak) continue;
        const seen = new Set();
        let unlabelled = false;
        for (const part of group.parts) {
            if (part.indent > 0)
                report(part.line, part.column, "a line of a verse in columns is not indented");
            if (part.span && part.extra) {
                report(
                    part.line,
                    part.column,
                    "a line of a verse in columns is `[text]{lang=…}`, or plain text in the verse's `lang=`, and takes no other key",
                );
                if (part.lang === undefined) {
                    unlabelled = true;
                    continue;
                }
            }
            if (part.lang === undefined) {
                unlabelled = true;
                report(
                    part.line,
                    part.column,
                    "this line names no language: write it `[text]{lang=…}`, or give the verse `lang=`",
                );
                continue;
            }
            if (!named.has(part.lang))
                report(
                    part.line,
                    part.column,
                    `no column sets \`${part.lang}\`; a verse line gives the languages \`col1=\` and \`col2=\` name`,
                );
            else if (seen.has(part.lang))
                report(
                    part.line,
                    part.column,
                    `this verse line gives \`${part.lang}\` twice; give each language once`,
                );
            seen.add(part.lang);
        }
        if (unlabelled) continue;
        for (const [lang, key] of named)
            if (!seen.has(lang))
                report(
                    group.parts[0].line,
                    group.parts[0].column,
                    `this verse line has no \`${lang}\` line, which \`${key}=\` sets`,
                );
    }
    return errors;
}

/**
 * Whether text runs right to left: its first letter is in a right-to-left
 * block. A face's right-to-left code points sit in U+1E800–U+1EFFF.
 *
 * @param {string} text - Text, after any map.
 * @returns {boolean} Whether it starts right to left.
 */
export function rightToLeft(text) {
    const first = /[\p{L}\p{M}\p{Co}\p{Cn}]/u.exec(String(text).replace(/\{[^}]*\}/g, ""));
    return Boolean(
        first &&
        /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u.test(
            first[0],
        ),
    );
}

/** An attribute value as the shared attribute grammar reads it back. */
function attributeValue(value) {
    return /^[A-Za-z0-9_.:/@%+-]+$/.test(value) ? value : `"${value.replace(/[\\"]/g, "\\$&")}"`;
}

/**
 * Where a line of {@link expandVerseOrigins}'s output came from.
 *
 * @typedef {object} VerseOrigin
 * @property {number} line - The source line, 0-based.
 * @property {number} [textColumn] - For an entry's line, the 1-based source
 *   column of its text's first character.
 * @property {boolean} [span] - Whether the source line is a span, whose `[`
 *   sits before its text.
 * @property {number} [textLength] - The length of the entry's text.
 * @property {{line: number, columns: {lang: number, map?: number, font?: number}}} [entry] -
 *   Where the entry is written in the opening line.
 */

/**
 * Write each verse line of a sound verse in columns as one span per column
 * entry, the left column's entries first, each with the entry's language,
 * mapping and font. Every target runs it before marked text is rewritten, so
 * each entry is set exactly as a span with those keys is. The verse gains the
 * class {@link COLUMNS_CLASS}; a verse already carrying it, a verse with a
 * finding, and a verse without columns are left as written.
 *
 * @param {string} source - Markdown.
 * @returns {{markdown: string, origins: VerseOrigin[]}} The Markdown, and
 *   where each of its lines came from.
 */
export function expandVerseOrigins(source) {
    const text = String(source ?? "");
    const lines = text.split("\n");
    const identity = () => lines.map((_, line) => ({ line }));
    if (!/\bcol[12]=/.test(text)) return { markdown: text, origins: identity() };
    const { blocks, errors } = scanVerse(text);
    const output = [];
    const origins = [];
    let cursor = 0;
    const copy = (from, to) => {
        for (let line = from; line < to; line++) {
            output.push(lines[line]);
            origins.push({ line });
        }
    };
    for (const block of blocks) {
        if (!hasColumns(block) || block.classes.includes(COLUMNS_CLASS)) continue;
        if (errors.some((error) => error.line - 1 >= block.start && error.line - 1 <= block.end))
            continue;
        copy(cursor, block.start);
        const opening = lines[block.start];
        const close = opening.lastIndexOf("}");
        output.push(`${opening.slice(0, close)} .${COLUMNS_CLASS}${opening.slice(close)}`);
        origins.push({ line: block.start });
        const entries = verseColumns(block, opening).flatMap((column) => column.entries);
        let first = true;
        for (const group of verseGroups(block, lines)) {
            if (!first) {
                output.push(block.indent);
                origins.push({ line: block.start });
            }
            first = false;
            if (group.stanzaBreak) {
                output.push(`${block.indent}***`);
                origins.push({ line: group.line });
                continue;
            }
            for (const entry of entries) {
                const part = group.parts.find((candidate) => candidate.lang === entry.lang);
                const keys = [
                    `lang=${attributeValue(entry.lang)}`,
                    ...(entry.map === undefined ? [] : [`map=${attributeValue(entry.map)}`]),
                    ...(entry.font === undefined ? [] : [`font=${attributeValue(entry.font)}`]),
                ];
                output.push(`${block.indent}[${part.text}]{${keys.join(" ")}}`);
                origins.push({
                    line: part.line,
                    textColumn: part.textColumn,
                    indent: block.indent.length,
                    span: part.span,
                    textLength: part.text.length,
                    entry: { line: block.start, columns: entry.columns },
                });
            }
        }
        output.push(lines[block.end]);
        origins.push({ line: block.end });
        cursor = block.end + 1;
    }
    copy(cursor, lines.length);
    return { markdown: output.join("\n"), origins };
}

/**
 * {@link expandVerseOrigins}'s Markdown alone.
 *
 * @param {string} source - Markdown.
 * @returns {string} The Markdown with each verse in columns expanded.
 */
export function expandVerse(source) {
    return expandVerseOrigins(source).markdown;
}

/**
 * Where a position in {@link expandVerseOrigins}'s output was written.
 *
 * A position in an entry's text is the same character of the source line; a
 * position in its keys is the entry's part in the opening line that states
 * the key it falls in.
 *
 * @param {{line: number, column: number}} at - 1-based, in the output.
 * @param {string[]} expanded - The output, by line.
 * @param {VerseOrigin[]} origins - From {@link expandVerseOrigins}.
 * @returns {{line: number, column: number}} 1-based, in the source.
 */
export function sourcePosition(at, expanded, origins) {
    const origin = origins[at.line - 1];
    if (!origin) return at;
    if (origin.entry === undefined) return { line: origin.line + 1, column: at.column };
    const local = at.column - (origin.indent ?? 0);
    if (local <= origin.textLength + 1) {
        const column = origin.textColumn + local - 2;
        return {
            line: origin.line + 1,
            column: Math.max(origin.textColumn - (origin.span ? 1 : 0), column),
        };
    }
    const line = expanded[at.line - 1];
    const brace = line.lastIndexOf("{");
    let key = "lang";
    let best = -1;
    for (const name of ["lang", "map", "font"]) {
        const found = line.indexOf(`${name}=`, brace);
        if (found >= 0 && found <= at.column - 1 && found > best) {
            best = found;
            key = name;
        }
    }
    const column = origin.entry.columns[key] ?? origin.entry.columns.lang;
    return { line: origin.entry.line + 1, column };
}

/** Replace verse fences with HTML wrappers whose body remains inline Markdown.
 * @param {string} source - Authored Markdown.
 */
export function renderVerse(source) {
    const { errors } = scanVerse(source);
    source = expandVerse(source);
    const { blocks } = scanVerse(source),
        lines = String(source ?? "").split("\n"),
        output = [];
    let cursor = 0;
    const escape = (value) =>
        String(value)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    for (const block of blocks) {
        output.push(...lines.slice(cursor, block.start));
        const step = Number(block.attributes.numstep ?? 0) || 0;
        const columns = block.classes.includes(COLUMNS_CLASS);
        const attrs = [
            `class="${escape(["verse", ...block.classes, ...(step ? ["verse-numbered"] : [])].join(" "))}"`,
        ];
        if (block.id) attrs.push(`id="${escape(slugify(block.id))}"`);
        for (const [key, value] of Object.entries(block.attributes))
            if (!refusedAttributes({ [key]: value }).length)
                attrs.push(
                    `${["lang", "dir", "data-pagefind-ignore"].includes(key) ? key : `data-${key}`}="${escape(value)}"`,
                );
        let indent = block.indent;
        if (
            indent.length >= 4 &&
            !lines.slice(0, block.start).some((line) => /^ *(?:[-+*]|\d+[.)]) +/.test(line))
        )
            indent = "";
        output.push(
            "",
            `${indent}<div ${attrs.join(" ")}>`,
            "",
            ...(columns ? columnsMarkdown(block, lines, step) : verseMarkdown(block.body, step))
                .split("\n")
                .map((line) => (line ? indent + line : line)),
            "",
            `${indent}</div>`,
            "",
        );
        cursor = block.end + 1;
    }
    output.push(...lines.slice(cursor));
    return { markdown: output.join("\n"), errors };
}
