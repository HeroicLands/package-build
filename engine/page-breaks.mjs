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
    /^(?:[ \t]*(?:>[ \t]?|(?:[-+*]|\d{1,9}[.)])[ \t]+))*[ \t]*(---|\*\*\*|___)[ \t]+(\{[^\r\n]*\})[ \t]*$/;
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
    for (const token of blockTokens(text)) {
        if (!token.map) continue;
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
        const parsed = parseExtensionAttributes(match[2].slice(1, -1));
        if (match[1] !== "---" && !parsed.classes.includes("page-break")) continue;
        const column = lines[i].indexOf(match[1]) + 1;
        const attributeColumn = lines[i].indexOf("{") + 1;
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
        if (match[1] !== "---")
            errors.push({ line: i + 1, column, message: "only --- accepts {.page-break}" });
        if (
            nested.has(i) ||
            (i > 0 && lines[i - 1].trim()) ||
            (i + 1 < lines.length && lines[i + 1].trim())
        )
            errors.push({ line: i + 1, column, message: PLACEMENT });
        errors.push(...problems.map(at));
        if (match[1] === "---" && !problems.length && !errors.some((error) => error.line === i + 1))
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
