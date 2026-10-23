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

/** The authored verse lines, excluding blank lines and stanza separators. */
export function verseLines(body) {
    return String(body ?? "")
        .split("\n")
        .filter((line) => line.trim() && !STANZA_BREAK.test(line.trim()));
}

/**
 * Read one verse line. Marker offsets are zero-based in the authored line;
 * textColumn is the one-based column of its first non-space character.
 * Periods inside a span set indentation only when that span starts the line.
 */
export function verseLine(line) {
    const source = String(line ?? "");
    const spaces = /^ */.exec(source)[0].length;
    const written = source.slice(spaces).trimEnd();
    let markerStart = spaces;
    let markerLength = /^\.+/.exec(written)?.[0].length ?? 0;
    if (!markerLength) {
        const span = leadingSpan(written);
        const html = /^<span\b[^>]*>/.exec(written);
        const prefix =
            span ? 1
            : html ? html[0].length
            : 0;
        if (prefix) {
            markerStart += prefix;
            markerLength = /^\.+/.exec(written.slice(prefix))?.[0].length ?? 0;
        }
    }
    const start = markerStart - spaces;
    return {
        text: written.slice(0, start) + written.slice(start + markerLength),
        level: markerLength,
        markerStart,
        markerLength,
        textColumn: spaces + 1,
    };
}

/**
 * Blank lines divide verse groups. A standalone `***` is its own group and
 * separates stanzas. Each text line carries its period-based indentation.
 */
export function verseStanzas(body) {
    const groups = [];
    let group = [];
    const end = () => {
        if (group.length) groups.push(group);
        group = [];
    };
    for (const line of String(body ?? "").split("\n")) {
        if (!line.trim()) {
            end();
            continue;
        }
        if (STANZA_BREAK.test(line.trim())) {
            end();
            groups.push([{ text: "***", level: 0 }]);
            continue;
        }
        const { text, level } = verseLine(line);
        group.push({ text, level });
    }
    end();
    return groups;
}

/** A stanza separator group, independent of the surrounding verse lines. */
export const stanzaSeparator = (group) => group.length === 1 && STANZA_BREAK.test(group[0].text);

/** HTML indentation attributes; large levels retain their full authored depth. */
function indentStyle(level) {
    return level > 8 ? ` style="--verse-indent: ${level * 1.25}em"` : "";
}

/** A verse is inline Markdown even when it starts with block syntax. */
export function inlineVerse(text) {
    return String(text)
        .replace(/^(#{1,6}\s|>\s|[-+*]\s|:{1,2}\s|`{3,}|~{3,}|-{3,}\s*$)/, "\\$1")
        .replace(/^(\d+)([.)])\s/, "$1\\$2 ");
}

/**
 * Keep blank-line verse groups as paragraphs and each text line a hard break.
 * A standalone `***` emits a separate stanza gap.
 * The surrounding renderer still sees the entire note, so links and footnote
 * definitions remain in scope. The span carries the indent for each line.
 */
export function verseMarkdown(body, step = 0) {
    let count = 0;
    return verseStanzas(body)
        .map((stanza) =>
            stanzaSeparator(stanza) ?
                '<span class="verse-stanza-break" aria-hidden="true"></span>'
            :   stanza
                    .map(({ text, level }) => {
                        const number = lineNumber(++count, step);
                        return `<span class="verse-line${level ? ` i${level}` : ""}"${indentStyle(level)}>${number === undefined || number === "" ? "" : `<span class="verse-number">${number}</span>`}${inlineVerse(text)}</span>`;
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
 * The numbered-column rows, each holding its logical line number and each
 * column’s physical readings stacked in authored order,
 * the first in the normal tone and each later one `verse-secondary`. A part
 * whose text runs right to left carries `dir="rtl"`. A row is a line of a
 * paragraph, and a paragraph a stanza, so each part stays inline Markdown.
 *
 * @param {object} block - A numbered-column verse from {@link scanVerse}.
 * @param {string[]} lines - The source, by line.
 * @param {number} step - The verse's `numstep`.
 * @returns {string} The rows as Markdown with inline HTML.
 */
function columnsMarkdown(block, lines, step) {
    const width = verseColumnCount(block);
    const stanzas = [[]];
    let count = 0;
    for (const group of verseGroups(block, lines)) {
        if (group.stanzaBreak) {
            stanzas.push(['<span class="verse-stanza-break" aria-hidden="true"></span>'], []);
            continue;
        }
        const number = lineNumber(++count, step);
        const cells = Array.from({ length: width }, (_, column) => {
            const parts = group.parts.filter((part) => part.column === column + 1);
            return (
                '<span class="verse-column">' +
                parts
                    .map(
                        ({ text, indent }, index) =>
                            `<span class="verse-part${index ? " verse-secondary" : ""}${indent ? ` i${indent}` : ""}"${indentStyle(indent)}${rightToLeft(text) ? ' dir="rtl"' : ""}>${inlineVerse(text)}</span>`,
                    )
                    .join("") +
                "</span>"
            );
        });
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
import { spanMarkdownPlugin } from "./content-spans.mjs";
import { parseExtensionAttributes, refusedAttributes } from "./extension-attributes.mjs";

const structureParser = new MarkdownIt({ html: true });
const lineParser = new MarkdownIt({ html: true }).use(spanMarkdownPlugin);

/** The structural first span of a line, with its source ranges and keys. */
function leadingSpan(text) {
    if (!text.startsWith("[")) return undefined;
    const tokens = lineParser.parseInline(text, {})[0]?.children ?? [];
    return tokens.find((token) => token.meta?.span && token.meta.start === 0);
}

/** The layout class the build gives a verse whose cols count exceeds one. */
export const COLUMNS_CLASS = "verse-columns";

/**
 * The keys a verse fence's attribute block takes. `lang`, `font` and `map`
 * are read by `scanRuns` in content-scripts.mjs; `dir`, and on the site
 * `data-pagefind-ignore`, are written by its rewrite of a fence set in one of
 * the faces, and reach the element as they are written.
 */
export const VERSE_KEYS = Object.freeze([
    "form",
    "scan",
    "lang",
    "font",
    "map",
    "numstep",
    "cols",
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
            if (!VERSE_KEYS.includes(key))
                errors.push({
                    line: i + 1,
                    column: keyColumn(lines[i], key),
                    message: `${key}= is not a verse attribute`,
                });
            else if (
                key === "cols" &&
                (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
            )
                errors.push({
                    line: i + 1,
                    column: keyColumn(lines[i], key) + key.length + 1,
                    message: "verse cols= is a positive whole number",
                });
            else if (key === "numstep" && !/^\d+$/.test(value))
                errors.push({
                    line: i + 1,
                    column: keyColumn(lines[i], key),
                    message: "verse numstep= numbers every Nth line: a whole number, 0 for none",
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

/** The number of verse columns; an omitted or invalid count uses the ordinary layout. */
export function verseColumnCount(block) {
    const raw = block.attributes?.cols;
    const value = Number(raw ?? 1);
    return /^[1-9]\d*$/.test(String(raw ?? 1)) && Number.isSafeInteger(value) ? value : 1;
}

/** Whether a verse uses the numbered multi-column protocol. */
export function hasColumns(block) {
    return verseColumnCount(block) > 1;
}

/** A line separating stanzas, including escaped output from a native run. */
export const STANZA_BREAK = /^(?:\\?\*){3}$/;

/**
 * Blank-separated multi-column rows with ordered physical parts. Text retains
 * its authored inline markup and spacing after the numeric prefix. All source
 * offsets are measured before prefixes or indentation periods are removed.
 *
 * @param {object} block - A verse from scanVerse.
 * @param {string[]} lines - The complete source, by line.
 * @returns {Array<{stanzaBreak: true, line: number}|{stanzaBreak?: false, parts: Array<{column: number, line: number, sourceColumn: number, textColumn: number, text: string, indent: number, markerStart: number, markerLength: number, prefixLength: number}>}>}
 */
export function verseGroups(block, lines) {
    const groups = [];
    let parts = [];
    const end = () => {
        if (parts.length) groups.push({ parts });
        parts = [];
    };
    for (let at = block.start + 1; at < block.end; at++) {
        const line = lines[at];
        if (!line.trim()) {
            end();
            continue;
        }
        if (STANZA_BREAK.test(line.trim())) {
            end();
            groups.push({ stanzaBreak: true, line: at });
            continue;
        }
        const spaces = /^ */.exec(line)[0].length;
        const prefix = hasColumns(block) ? /^(\d+)( +)/.exec(line.slice(spaces)) : undefined;
        const prefixLength = prefix?.[0].length ?? 0;
        const contentStart = spaces + prefixLength;
        const parsed = verseLine(line.slice(contentStart));
        parts.push({
            column: prefix ? Number(prefix[1]) : 1,
            line: at,
            sourceColumn: spaces + 1,
            textColumn: contentStart + 1,
            text: parsed.text,
            indent: parsed.level,
            markerStart: contentStart + parsed.markerStart,
            markerLength: parsed.markerLength,
            prefixLength,
        });
    }
    end();
    return groups;
}

/** Locate an invalid numbered line without changing its authored text. */
function columnFindings(block, lines) {
    const errors = [];
    const width = verseColumnCount(block);
    const opening = lines[block.start];
    const report = (line, column, message) => errors.push({ line: line + 1, column, message });
    if (block.classes.includes(COLUMNS_CLASS))
        report(
            block.start,
            keyColumn(opening, `.${COLUMNS_CLASS}`),
            `\`.${COLUMNS_CLASS}\` is the class the build gives a verse in columns; leave it out`,
        );
    for (const group of verseGroups(block, lines)) {
        if (group.stanzaBreak) continue;
        let previous = 0;
        for (const part of group.parts) {
            if (!part.prefixLength) {
                report(
                    part.line,
                    part.sourceColumn,
                    "a verse with cols>1 starts each content line with a column number and spaces",
                );
                continue;
            }
            if (!part.text.trim())
                report(
                    part.line,
                    part.sourceColumn,
                    "a numbered verse line needs content after its column number",
                );
            if (!Number.isSafeInteger(part.column) || part.column < 1 || part.column > width)
                report(
                    part.line,
                    part.sourceColumn,
                    `column ${part.column} is outside 1..${width}`,
                );
            else if (part.column < previous)
                report(
                    part.line,
                    part.sourceColumn,
                    "column numbers must not decrease within a verse row",
                );
            previous = part.column;
        }
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
    const first = /[\p{L}\p{M}\p{Co}\p{Cn}]/u.exec(
        String(text)
            .replace(/<[^>]*>/g, "")
            .replace(/\{[^}]*\}/g, ""),
    );
    return Boolean(
        first &&
        /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u.test(
            first[0],
        ),
    );
}

/** Replace verse fences with HTML wrappers whose body remains inline Markdown.
 * @param {string} source - Authored Markdown.
 */
export function renderVerse(source) {
    const { errors } = scanVerse(source);
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
        const columns = hasColumns(block);
        const attrs = [
            `class="${escape(["verse", ...block.classes, ...(columns ? [COLUMNS_CLASS] : []), ...(step ? ["verse-numbered"] : [])].join(" "))}"`,
        ];
        if (columns) attrs.push(`style="--verse-columns: ${verseColumnCount(block)}"`);
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
