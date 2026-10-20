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
 * **What a word is in running text.** A word is a maximal run of letters,
 * combining marks and digits, and an apostrophe (`'` or `’`), a hyphen or an
 * en dash joins two such runs into one word: `k'aralzon`, `Arzen-Thalor`.
 * Anything else, whitespace and punctuation included, sits between words.
 *
 * The name catalog reads a label's last word by it, and a mapped run reads
 * each word it looks up in a lexicon by it.
 *
 * @module
 */

/** One word; global, so `matchAll` walks every word of a text. */
export const WORD = /[\p{L}\p{M}\p{N}]+(?:[’'–-][\p{L}\p{M}\p{N}]+)*/gu;
