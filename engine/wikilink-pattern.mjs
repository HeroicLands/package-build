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

/** The dependency-free lexical wikilink pattern. @module */

/**
 * A wikilink, as authored.
 *
 * **Newlines are excluded deliberately.** A link is written on one line; an
 * unclosed `[[` is a typo, and the alternative is letting it swallow arbitrary
 * prose in search of a closer. Erring towards "not a link" leaves the author's
 * text as written, which is the safe direction for a rewriter.
 *
 * **A leading `!` makes it an embed, not a link**, and the lookbehind is what
 * keeps every reader from seeing one as the other. Stated here rather than in
 * each reader for the reason the rest of this module exists: the checker, the
 * resolver and the embed reader all match on this pattern, and a copy of the
 * exclusion in each is a place for it to be forgotten. An embed's
 * own grammar is {@link module:engine/content-embeds}.
 */
export const WIKILINK = /(?<!!)\[\[([^\]\n]+)\]\](?:\{(?:[^{}"\n]|"(?:\\.|[^"\\\n])*")*\})?/g;
