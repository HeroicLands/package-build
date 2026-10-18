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
 * The key a name-ordered list files a note under, and the ASCII fold ordering
 * compares it on. A leaf module, so every list that orders notes by name can
 * read the key without importing the content index.
 *
 * @module
 */

import unidecode from "unidecode";

/**
 * A note's display name reduced to printable 7-bit ASCII.
 *
 * Content names carry the setting's orthography — `Kûrbúl Helm`, `Hârn`,
 * `Kèthîra` — and nobody types them. A reader searching the index, or an editor
 * completing a wikilink, needs a form that matches what a keyboard produces, so
 * the record states one rather than leaving every consumer to invent it (and to
 * invent a *different* one, which is how two searches over the same data come
 * to disagree).
 *
 * **Transliterated, not stripped.** `unidecode` — the same table
 * {@link slugify} already runs, so an ASCII name and a slug can never disagree
 * about a character — carries a letter across rather than deleting it:
 * diacritics fold (`â`→`a`, `è`→`e`), ligatures expand (`æ`→`ae`, `Œ`→`OE`,
 * `ß`→`ss`), the runic letters spell out (`þ`→`th`, `Þ`→`Th`, `ð`→`d`), and
 * even a vulgar fraction becomes readable (`¾`→`3/4`). Deleting them instead
 * would collapse `Kûrbúl` to `Krbl`, which is worse than the original.
 *
 * Anything still outside printable ASCII after that becomes a space, and runs
 * of whitespace collapse — a space rather than nothing, so a character that
 * transliterates away cannot silently weld two words together.
 *
 * The value is emitted even when it equals the name, so a consumer matching on
 * it never has to branch on whether the name happened to be ASCII already.
 *
 * @param {unknown} name - The note's `name.full`.
 * @returns {string|null} The ASCII form, or `null` when there is no name, or
 *   nothing printable survives.
 */
export function asciiName(name) {
    if (typeof name !== "string") return null;
    const folded = unidecode(name)
        .replace(/[^\x20-\x7E]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return folded === "" ? null : folded;
}

/**
 * The name a note files under: its `name.sort` when it declares one, otherwise
 * its `name.full`.
 *
 * @param {unknown} record - An index record or a note's frontmatter.
 * @returns {string|undefined} The unfolded key, or `undefined` for a record
 *   with no name.
 */
export function nameSortOf(record) {
    const name = /** @type {any} */ (record)?.name;
    for (const candidate of [name?.sort, name?.full]) {
        if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
    return undefined;
}

/**
 * The key a name-ordered list compares notes on: {@link nameSortOf} folded to
 * printable ASCII by {@link asciiName}, so an accented sort key files beside
 * its base letters. Case is left for the caller, which decides whether its
 * comparison ignores it.
 *
 * @param {unknown} record - An index record or a note's frontmatter.
 * @returns {string} The key, or "" for a record with no name.
 */
export function nameSortKey(record) {
    const key = nameSortOf(record);
    if (key === undefined) return "";
    return asciiName(key) ?? key;
}
