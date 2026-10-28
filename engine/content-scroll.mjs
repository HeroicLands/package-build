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
 * **The `scroll` fence**: text in a script written in vertical columns, read
 * from the right, as a handscroll unrolls.
 *
 * ````markdown
 * ```scroll {rows=25 cols=12 lang=tsu enc=tengchou}
 * chen teng chou hing
 * tan tsou dou rou
 *
 * gen chei chou tsuen
 * ```
 * ````
 *
 * - **The body is raw.** It is a code fence, so Markdown never reformats it.
 * - **A paragraph is a run of lines**, joined and reflowed as one text; a
 *   blank line starts the next paragraph, flush at the top of a fresh column.
 * - **`rows=`** is the characters in a column and **`cols=`** the columns in a
 *   panel, each a whole number above zero. Either may be left out.
 * - **`lang=`, `font=` and `enc=`** are read by
 *   {@link module:engine/content-scripts.scanRuns}, which maps the text and
 *   refuses a fence whose script its note does not state is written in
 *   columns.
 *
 * {@link renderScroll} writes the HTML the site, the preview and Foundry show:
 * a `.scroll` block whose stylesheet sets `writing-mode: vertical-rl`. The book
 * has no vertical writing and draws the columns as panel images; see
 * {@link scrollPanels} and {@link module:engine/font-outlines}.
 *
 * @module
 */

import { blockTokens } from "./markdown-blocks.mjs";
import { verseRegions } from "./verse-regions.mjs";

import { parseExtensionAttributes, refusedAttributes } from "./extension-attributes.mjs";

/**
 * The keys a scroll fence's attribute block takes. `lang`, `font` and `map`
 * are read by `scanRuns`; `data-pagefind-ignore` is written on the site by its
 * rewrite of a fence set in a face, and reaches the element as written.
 */
export const SCROLL_KEYS = Object.freeze([
    "rows",
    "cols",
    "lang",
    "font",
    "enc",
    "data-pagefind-ignore",
]);

/** The keys that size a scroll, each a whole number above zero. */
const SIZE_KEYS = Object.freeze({ rows: "characters", cols: "columns" });

/**
 * The distance from one column to the next, in ems: the character's one em
 * and a gap of half an em.
 */
export const SCROLL_PITCH = 1.5;

/**
 * The longest column the book sets when a fence states no `rows=`: each
 * paragraph is one column as long as the longest, up to this many characters.
 */
export const BOOK_SCROLL_ROWS = 40;

/** The class every scroll carries. */
export const SCROLL_CLASS = "scroll";

/**
 * One `scroll` fence.
 *
 * @typedef {object} Scroll
 * @property {number} start - The 0-based line of its opening.
 * @property {number} end - The 0-based line of its closing.
 * @property {string} fence - Its fence marker.
 * @property {string} indent - The opening line's indentation.
 * @property {Record<string, string>} attributes - Its `key=value` attributes.
 * @property {string[]} classes - Its classes.
 * @property {number|undefined} rows - Its `rows=`, where it is valid.
 * @property {number|undefined} cols - Its `cols=`, where it is valid.
 * @property {boolean} invalid - Whether its opening has a finding.
 */

/**
 * The 1-based columns of `key=` and of its value in an opening line.
 *
 * @param {string} line - The opening line.
 * @param {string} key - The key.
 * @returns {{key: number, value: number}} Its columns, or the brace's when it
 *   is not found.
 */
function keyColumns(line, key) {
    const from = Math.max(0, line.indexOf("{"));
    const match = new RegExp(`[\\s{]${key.replace(/[-]/g, "\\$&")}=`).exec(line.slice(from));
    if (!match) return { key: from + 1, value: from + 1 };
    const at = from + match.index + 1;
    const value = at + key.length + 1;
    return { key: at + 1, value: value + (line[value] === '"' ? 1 : 0) + 1 };
}

/**
 * Read every `scroll` fence in a source, and every fault in its opening.
 *
 * A fence inside a block quote or an HTML block is not read, and neither is a
 * fence quoted inside another fence. Verse lines are inline content.
 *
 * @param {string} source - Markdown.
 * @returns {{blocks: Scroll[], errors: Array<{line: number, column: number, message: string}>}}
 *   The fences, and each finding at its 1-based position.
 */
export function scanScrolls(source) {
    const text = String(source ?? "");
    const blocks = [];
    const errors = [];
    if (!/^ *(?:`{3,}|~{3,}) *scroll(?:\s|$)/m.test(text)) return { blocks, errors };
    const lines = text.split(/\r?\n/);
    const literalLines = new Set(
        verseRegions(text).flatMap((region) =>
            Array.from({ length: region.end - region.start + 1 }, (_, i) => region.start + i),
        ),
    );
    for (const token of blockTokens(text)) {
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
                if (opening.scroll) {
                    const block = { ...opening.scroll, end: i };
                    if (!lines.slice(block.start + 1, i).some((line) => line.trim()))
                        errors.push({
                            line: block.start + 1,
                            column: block.indent.length + 1,
                            message: "scroll fence is empty",
                        });
                    blocks.push(block);
                }
                opening = null;
            }
            continue;
        }
        if (!match) continue;
        const info = match[2].trim();
        opening = { fence: match[1], scroll: undefined };
        if (info.split(/\s/)[0] !== "scroll") continue;
        const indent = /^ */.exec(lines[i])[0];
        const scroll = {
            start: i,
            end: i,
            fence: match[1],
            indent,
            attributes: {},
            classes: [],
            rows: undefined,
            cols: undefined,
            invalid: false,
        };
        opening.scroll = scroll;
        const raw = info.slice("scroll".length).trim();
        const at = { line: i + 1, column: indent.length + 1 };
        if (raw && !/^\{[^}\n]*\}$/.test(raw)) {
            errors.push({ ...at, message: "scroll attributes need {…} braces" });
            scroll.invalid = true;
            continue;
        }
        const parsed = parseExtensionAttributes(raw ? raw.slice(1, -1) : "");
        scroll.attributes = parsed.values;
        scroll.classes = parsed.classes;
        const problems = [...parsed.problems, ...refusedAttributes(parsed.values)];
        if (parsed.id) problems.push("a scroll fence takes no `#id`");
        for (const message of problems) errors.push({ ...at, message });
        if (problems.length) scroll.invalid = true;
        for (const [key, value] of Object.entries(parsed.values)) {
            const columns = keyColumns(lines[i], key);
            if (!SCROLL_KEYS.includes(key)) {
                errors.push({
                    line: i + 1,
                    column: columns.key,
                    message: `\`${key}=\` is not a scroll attribute; a scroll takes \`rows=\`, \`cols=\`, \`lang=\`, \`font=\` and \`enc=\``,
                });
                scroll.invalid = true;
            } else if (Object.hasOwn(SIZE_KEYS, key)) {
                if (/^[1-9]\d*$/.test(value)) scroll[key] = Number(value);
                else {
                    errors.push({
                        line: i + 1,
                        column: columns.value,
                        message: `\`${key}=${value}\` is not a number of ${SIZE_KEYS[key]}: \`${key}=\` is a whole number above zero`,
                    });
                    scroll.invalid = true;
                }
            }
        }
    }
    if (opening?.scroll)
        errors.push({
            line: opening.scroll.start + 1,
            column: opening.scroll.indent.length + 1,
            message: "scroll fence needs a closing code fence",
        });
    errors.sort((a, b) => a.line - b.line || a.column - b.column);
    return { blocks, errors };
}

/**
 * A scroll's paragraphs: each run of nonblank lines, its lines trimmed and
 * joined by a space.
 *
 * @param {string[]} lines - The body's lines.
 * @returns {string[]} The paragraphs, in order.
 */
export function scrollParagraphs(lines) {
    const paragraphs = [];
    let current = [];
    for (const line of [...lines, ""]) {
        if (line.trim()) {
            current.push(line.trim());
            continue;
        }
        if (current.length) paragraphs.push(current.join(" "));
        current = [];
    }
    return paragraphs;
}

/** The emphasis tags the rewrite of marked text writes, which a scroll keeps. */
const EMPHASIS_TAG = /(<(?:em|strong)(?: class="emph-(?:rubric|overline)")?>|<\/(?:em|strong)>)/;

/** HTML-escape text. */
const escapeHtml = (value) =>
    String(value)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

/**
 * A paragraph's text as HTML: escaped, with the emphasis tags marked text is
 * rewritten with kept as tags.
 *
 * @param {string} text - The paragraph.
 * @returns {string} Its HTML.
 */
function paragraphHtml(text) {
    return text
        .split(EMPHASIS_TAG)
        .map((part, at) => (at % 2 ? part : escapeHtml(part)))
        .join("");
}

/**
 * Replace each well-formed `scroll` fence with the HTML block the site, the
 * preview and Foundry show: a `<div class="scroll">` holding a `<p>` for each
 * paragraph, its size carried as `--scroll-rows` and `--scroll-cols`. A fence
 * with a finding in its opening is left as a code fence.
 *
 * @param {string} source - Markdown, its marked text already rewritten.
 * @returns {{markdown: string}} The Markdown.
 */
export function renderScroll(source) {
    const text = String(source ?? "");
    const { blocks } = scanScrolls(text);
    if (!blocks.length) return { markdown: text };
    const lines = text.split("\n");
    const output = [];
    let cursor = 0;
    for (const block of blocks) {
        if (block.invalid) continue;
        output.push(...lines.slice(cursor, block.start));
        const attrs = [`class="${escapeHtml([SCROLL_CLASS, ...block.classes].join(" "))}"`];
        const entries = Object.entries(block.attributes);
        const ordered = [
            ...entries.filter(([key]) => key === "lang"),
            ...entries.filter(([key]) => key !== "lang"),
        ];
        for (const [key, value] of ordered)
            attrs.push(
                `${["lang", "data-pagefind-ignore"].includes(key) ? key : `data-${key}`}="${escapeHtml(value)}"`,
            );
        const style = [
            ...(block.rows === undefined ? [] : [`--scroll-rows: ${block.rows}`]),
            ...(block.cols === undefined ? [] : [`--scroll-cols: ${block.cols}`]),
        ];
        if (style.length) attrs.push(`style="${style.join("; ")}"`);
        let indent = block.indent;
        if (
            indent.length >= 4 &&
            !lines.slice(0, block.start).some((line) => /^ *(?:[-+*]|\d+[.)]) +/.test(line))
        )
            indent = "";
        output.push(
            "",
            `${indent}<div ${attrs.join(" ")}>`,
            ...scrollParagraphs(lines.slice(block.start + 1, block.end)).map(
                (paragraph) => `${indent}<p>${paragraphHtml(paragraph)}</p>`,
            ),
            `${indent}</div>`,
            "",
        );
        cursor = block.end + 1;
    }
    output.push(...lines.slice(cursor));
    return { markdown: output.join("\n") };
}

/**
 * One character of a scroll as the book draws it.
 *
 * @typedef {object} ScrollCell
 * @property {string} text - The character, one code point.
 * @property {string} roman - The source text it was written from: the text of
 *   the piece of the map it begins, with the text of any piece before it that
 *   wrote nothing; `""` for a later character of the same piece.
 * @property {"rubric"|"overline"} [emphasis] - The convention it is set by.
 */

/**
 * A scroll's text, as the book lays it out.
 *
 * @typedef {object} ScrollLayout
 * @property {ScrollCell[][]} paragraphs - Each paragraph's characters.
 * @property {import("./script-fonts.mjs").Face|undefined} face - The face it
 *   is drawn in.
 */

/**
 * Lay a scroll's paragraphs into columns and the columns into panels.
 *
 * Each paragraph starts a fresh column, filled from the top, `rows` characters
 * to a column; the columns are read from the right and grouped `cols` to a
 * panel. Without `rows`, a column is as long as the longest paragraph, up to
 * {@link BOOK_SCROLL_ROWS}; without `cols`, each column is a panel of its own,
 * so the book sets as many beside one another as fit its measure.
 *
 * @param {ScrollCell[][]} paragraphs - The characters of each paragraph.
 * @param {{rows?: number, cols?: number}} size - The fence's size.
 * @returns {{rows: number, panels: ScrollCell[][][]}} The column length, and
 *   each panel's columns, the first column the rightmost.
 */
export function scrollPanels(paragraphs, { rows, cols } = {}) {
    const longest = Math.max(1, ...paragraphs.map((cells) => cells.length));
    const length = rows ?? Math.min(longest, BOOK_SCROLL_ROWS);
    const columns = [];
    for (const cells of paragraphs)
        for (let at = 0; at < cells.length; at += length)
            columns.push(cells.slice(at, at + length));
    const width = cols ?? 1;
    const panels = [];
    for (let at = 0; at < columns.length; at += width) panels.push(columns.slice(at, at + width));
    return { rows: length, panels };
}

/**
 * The roman text a panel was written from, as its alt text: each paragraph's
 * source text, a space between paragraphs, its spacing collapsed.
 *
 * @param {ScrollCell[][]} panel - The panel's columns.
 * @param {ScrollCell[][]} paragraphs - The scroll's paragraphs, so a column
 *   that begins a paragraph is told from one that continues it.
 * @returns {string} The text.
 */
export function panelRoman(panel, paragraphs) {
    const firsts = new Set(paragraphs.map((cells) => cells[0]));
    let out = "";
    for (const column of panel) {
        if (out && firsts.has(column[0])) out += " ";
        for (const cell of column) out += cell.roman;
    }
    return out.replace(/\s+/g, " ").trim();
}
