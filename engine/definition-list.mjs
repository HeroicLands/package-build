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

/** Semantic dictionary rows for HTML definition lists. @module */

/**
 * Group each term and its definitions without reparsing their Markdown tokens.
 * Register after markdown-it-deflist; nested blocks and footnotes retain their
 * document context.
 * @param {import("markdown-it")} md - An HTML Markdown parser with definition lists.
 */
export function dictionaryListPlugin(md) {
    md.core.ruler.push("dictionary_list_rows", (state) => {
        const output = [],
            lists = [];
        const row = (nesting) => {
            const token = new state.Token(
                nesting === 1 ? "dictionary_row_open" : "dictionary_row_close",
                "div",
                nesting,
            );
            token.block = true;
            output.push(token);
        };
        for (const token of state.tokens) {
            if (token.type === "dl_open") {
                if (!(token.attrGet("class") ?? "").split(/\s+/).includes("dictionary"))
                    token.attrJoin("class", "dictionary");
                lists.push({ row: false });
            } else if (token.type === "dt_open" && lists.length) {
                const list = lists.at(-1);
                if (list.row) row(-1);
                row(1);
                list.row = true;
            } else if (token.type === "dd_open" && lists.length) {
                // A loose definition begins with an inline first paragraph.
                token.block = false;
            } else if (token.type === "dt_close" && lists.length) {
                // Inter-tag whitespace would add a word space to the fixed gap.
                token.block = false;
            } else if (token.type === "dl_close" && lists.length) {
                if (lists.pop().row) row(-1);
            }
            output.push(token);
        }
        state.tokens = output;
    });
}
