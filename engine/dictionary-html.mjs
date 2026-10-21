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
 * **Dictionary rows in finished HTML.** {@link groupDictionaryLists} gives a
 * definition list written as HTML the rows and the `dictionary` class that
 * {@link module:engine/definition-list.dictionaryListPlugin} gives one written
 * in Markdown, so both read the same on a page.
 *
 * The page is read as tokens, and a stack of open elements gives each nested
 * list its own rows. Comments, `script`, `style`, `pre` and `textarea` are
 * opaque: a literal example inside one is left as written. A list that already
 * has rows keeps them.
 *
 * @module
 */

/** One token: a comment, an opaque element, a declaration, a tag, text, or a bare `<`. */
const TOKEN =
    /<!--[^]*?-->|<script\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[^]*?<\/script\s*>|<style\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[^]*?<\/style\s*>|<pre\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[^]*?<\/pre\s*>|<textarea\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[^]*?<\/textarea\s*>|<![^>]*>|<\/?[a-z][a-z0-9:-]*(?:[^"'<>]|"[^"]*"|'[^']*')*>|[^<]+|</gi;

/** Elements with no closing tag. */
const VOID = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
]);

/** Add the `dictionary` class to a `<dl …>` opening tag. */
function withDictionaryClass(token) {
    if (
        /\sclass\s*=\s*["'](?:[^"']*\s)?dictionary(?:\s|["'])/i.test(token) ||
        /\sclass\s*=\s*dictionary(?:\s|>)/i.test(token)
    )
        return token;
    if (/\sclass\s*=\s*["']/i.test(token))
        return token.replace(/(\sclass\s*=\s*["'])/i, "$1dictionary ");
    if (/\sclass\s*=/i.test(token))
        return token.replace(/(\sclass\s*=\s*)([^\s>]+)/i, '$1"dictionary $2"');
    return token.replace(/^<dl/i, '<dl class="dictionary"');
}

/**
 * Group each term of every definition list with its definitions.
 *
 * @param {string} html - A page's HTML.
 * @returns {string} The HTML with a `dictionary` class on each `dl` and a `div`
 *   around each term and the definitions that follow it.
 */
export function groupDictionaryLists(html) {
    const source = String(html ?? "");
    if (!/<dl(?:\s|>)/i.test(source)) return source;
    const tokens = source.match(TOKEN) ?? [];
    const parts = [];
    const lists = [];
    const elements = [];
    tokens.forEach((original, i) => {
        let token = original;
        const previous = tokens[i - 1];
        const next = tokens[i + 1];
        // Whitespace between a term and its definition, and between a definition's
        // opening and its first paragraph, would add a word space to a fixed gap.
        if (
            lists.length &&
            i > 0 &&
            next !== undefined &&
            /^\s+$/.test(token) &&
            ((/^<\/dt\s*>$/i.test(previous) && /^<dd(?:\s|>)/i.test(next)) ||
                (/^<dd(?:\s[^>]*)?>$/i.test(previous) && /^<p(?:\s|>)/i.test(next)))
        )
            token = "";
        const opaque = /^<(?:!--|script\b|style\b|pre\b|textarea\b)/i.test(token);
        if (!opaque && /^<\/?[a-z]/i.test(token)) {
            const tag = token.replace(/^<\/?([a-z][a-z0-9:-]*)[^]*$/i, "$1").toLowerCase();
            const closing = token.startsWith("</");
            if (tag === "dl" && !closing) {
                lists.push({ row: false });
                token = withDictionaryClass(token);
            } else if (tag === "dt" && !closing && lists.length && elements.at(-1) === "dl") {
                const list = lists.at(-1);
                if (list.row) parts.push("</div>");
                parts.push("<div>");
                list.row = true;
            } else if (tag === "dl" && closing && lists.length) {
                const list = lists.at(-1);
                if (list.row) parts.push("</div>");
                lists.pop();
            }
            if (closing) {
                if (elements.length) elements.pop();
            } else if (!(/\/\s*>$/.test(token) || VOID.has(tag))) {
                elements.push(tag);
            }
        }
        parts.push(token);
    });
    return parts.join("");
}
