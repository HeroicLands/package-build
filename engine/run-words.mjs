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

import { lexiconsFromRecords } from "./encoding-lexicon.mjs";
import { wordBook } from "./word-book.mjs";
export { registeredNameWords, unknownWords, unknownWordMessage } from "./word-book.mjs";
/** @typedef {import("./word-book.mjs").WordBook} WordBook */

/**
 * Each configured language's word book: one per language whose `note` names a
 * language note. Its effective lexicon shares the renderer's nearest inherited
 * words, and derives forms and registered names from its own settings.
 *
 * @param {Iterable<Record<string, any>>|undefined} records - Index records.
 * @param {{languages?: Readonly<Record<string, {tag: string, note?: string}>>, contentPackage?: string}} config -
 *   The resolved configuration.
 * @returns {Map<string, WordBook>} The books by language name.
 */
export function wordBooksFromRecords(records, config = {}) {
    const list = [...(records ?? [])];
    const books = new Map();
    const lexicons = lexiconsFromRecords(list, config);
    for (const [name, lexicon] of lexicons) {
        books.set(name, wordBook(name, lexicon.data));
    }
    return books;
}
