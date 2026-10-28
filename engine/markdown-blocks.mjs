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
 * The block structure of a Markdown source, in the renderer's grammar.
 *
 * Several scanners ask only where a source's fences, code blocks, raw HTML and
 * quotes lie, each reading block tokens' `type`, `map` and `level` and nothing
 * else. Inline parsing fills only an `inline` token's `children`, so this
 * parser skips it, and the block tokens it yields are the ones a full parse
 * yields. The scanners commonly ask about the same source in turn, so the most
 * recent sources' tokens are kept.
 *
 * @module
 */

import MarkdownIt from "markdown-it";
import { verseDivPlugin } from "./verse-regions.mjs";

/** The renderer's block grammar, with inline parsing and its passes switched off. */
const parser = new MarkdownIt({ html: true }).use(verseDivPlugin);
parser.core.ruler.disable(["inline", "linkify", "replacements", "smartquotes", "text_join"]);

/** How many recent sources keep their tokens. */
const RECENT = 16;

/** @type {Map<string, import("markdown-it").Token[]>} */
const recent = new Map();

/**
 * The block tokens of a Markdown source. The array is shared between callers
 * and must not be modified; an `inline` token carries no `children`.
 *
 * @param {unknown} source - Markdown.
 * @returns {readonly import("markdown-it").Token[]} The block tokens, in order.
 */
export function blockTokens(source) {
    const text = String(source ?? "");
    const hit = recent.get(text);
    if (hit) {
        recent.delete(text);
        recent.set(text, hit);
        return hit;
    }
    const tokens = parser.parse(text, { verseSource: text });
    recent.set(text, tokens);
    if (recent.size > RECENT) recent.delete(recent.keys().next().value);
    return tokens;
}
