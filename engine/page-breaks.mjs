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

/** Authored book page breaks and their positioned syntax findings. @module */

import { blockTokens } from "./markdown-blocks.mjs";
import { scanBlocks } from "./content-blocks.mjs";
import { parseExtensionAttributes, refusedAttributes } from "./extension-attributes.mjs";

/** A standalone attributed break, including Markdown container prefixes. */
const BREAK_LINE =
    /^(?<prefix>(?:[ \t]*(?:>[ \t]?|(?:[-+*]|\d{1,9}[.)])[ \t]+|\[\^[^\]\s]+\]:[ \t]*))*[ \t]*)(?<marker>---|\*\*\*|___)[ \t]+(?<attributes>\{[^\r\n]*\})[ \t]*$/;
const PLACEMENT = "a page break stands between blocks at the top level of a note";

/**
 * Read page-break markers before any surface rewrites their source.
 * Code, HTML examples and entire verse divs remain literal. Parser ranges
 * retain list and quote membership, including lazy continuation lines.
 * @param {string} source - Authored Markdown body.
 * @returns {{breaks: Array<{line: number, column: number}>, errors: Array<{line: number, column: number, message: string}>}}
 */
export function scanPageBreaks(source) {
    const text = String(source ?? "");
    const lines = text.split(/\r?\n/);
    if (!lines.some((line) => BREAK_LINE.test(line))) return { breaks: [], errors: [] };
    const literal = new Set();
    const nested = new Set();
    let footnoteDepth = 0;
    for (const token of blockTokens(text, { footnotes: true })) {
        if (token.type === "footnote_reference_open") footnoteDepth++;
        if (token.type === "footnote_reference_close") footnoteDepth--;
        if (!token.map) continue;
        if (footnoteDepth)
            for (let line = token.map[0]; line < token.map[1]; line++) nested.add(line);
        const target =
            ["fence", "code_block", "html_block", "verse_div"].includes(token.type) ? literal
            : ["blockquote_open", "list_item_open"].includes(token.type) ? nested
            : undefined;
        if (target) for (let line = token.map[0]; line < token.map[1]; line++) target.add(line);
    }
    for (const block of scanBlocks(text).blocks)
        for (let line = block.start + 1; line < block.end; line++) nested.add(line);
    const breaks = [],
        errors = [];
    for (let i = 0; i < lines.length; i++) {
        if (literal.has(i)) continue;
        const match = BREAK_LINE.exec(lines[i]);
        if (!match) continue;
        const { prefix, marker, attributes } = match.groups;
        const parsed = parseExtensionAttributes(attributes.slice(1, -1));
        if (marker !== "---" && !parsed.classes.includes("page-break")) continue;
        const column = prefix.length + 1;
        const attributeColumn = lines[i].lastIndexOf(attributes) + 1;
        const at = (message) => ({ line: i + 1, column: attributeColumn, message });
        const problems = [...parsed.problems, ...refusedAttributes(parsed.values)];
        if (
            parsed.classes.some((name) => name !== "page-break") ||
            (!parsed.classes.length &&
                !parsed.id &&
                !Object.keys(parsed.values).length &&
                !problems.length)
        )
            problems.push("a page break accepts only .page-break");
        if (parsed.id) problems.push("a page break does not accept an id");
        if (Object.keys(parsed.values).length)
            problems.push("a page break does not accept attributes");
        if (marker !== "---")
            errors.push({ line: i + 1, column, message: "only --- accepts {.page-break}" });
        if (
            nested.has(i) ||
            (i > 0 && lines[i - 1].trim()) ||
            (i + 1 < lines.length && lines[i + 1].trim())
        )
            errors.push({ line: i + 1, column, message: PLACEMENT });
        errors.push(...problems.map(at));
        if (marker === "---" && !problems.length && !errors.some((error) => error.line === i + 1))
            breaks.push({ line: i + 1, column });
    }
    return { breaks, errors };
}

/**
 * Omit valid page breaks on a screen, preserving the surrounding block boundaries.
 * @param {string} source - Markdown body.
 * @returns {string} Markdown without valid page-break lines.
 */
export function omitPageBreaks(source) {
    const lines = String(source ?? "").split("\n");
    for (const marker of scanPageBreaks(source).breaks) lines[marker.line - 1] = "";
    return lines.join("\n");
}

/**
 * Preserve refused markers as literal Markdown before the book slices blocks.
 * A slice must not make a marker eligible by discarding its original neighbour.
 * Findings are collected from the original source before this rewrite.
 * @param {string} source - Complete Markdown body, before splitting containers.
 * @returns {string} Markdown with invalid markers escaped for literal rendering.
 */
export function escapeInvalidPageBreaks(source) {
    const text = String(source ?? "");
    const refused = new Set(scanPageBreaks(text).errors.map((error) => error.line));
    if (!refused.size) return text;
    return text
        .split("\n")
        .map((line, i) => {
            if (!refused.has(i + 1)) return line;
            const match = BREAK_LINE.exec(line.replace(/\r$/, ""));
            const prefix = match.groups.prefix;
            return `${prefix}\\${line.slice(prefix.length)}`;
        })
        .join("\n");
}

/**
 * Produce the book's page-break token, leaving ordinary thematic breaks alone.
 * @param {import("markdown-it")} md - The book parser.
 * @returns {void}
 */
export function pageBreakPlugin(md) {
    md.block.ruler.before("hr", "page_break", (state, startLine, _endLine, silent) => {
        if (state.env.pageBreaks === false) return false;
        const line = state.src.slice(state.bMarks[startLine], state.eMarks[startLine]);
        if (!BREAK_LINE.test(line)) return false;
        if (!scanPageBreaks(state.src).breaks.some((marker) => marker.line === startLine + 1))
            return false;
        if (silent) return true;
        const token = state.push("page_break", "", 0);
        token.map = [startLine, startLine + 1];
        state.line = startLine + 1;
        return true;
    });
}
