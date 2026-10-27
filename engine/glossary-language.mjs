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
 * The language a glossary term is in. The first match wins:
 *
 * 1. the entry's own `language`;
 * 2. the note it is written on, when that note is a language;
 * 3. the language note of the code the content index derived for the note it
 *    is written on, its `lang` — see {@link module:engine/note-language}.
 *
 * The lint and the `glossary` relation both resolve through here, each handing
 * over how it reads an Address, looks a note up and finds a code's note.
 *
 * A leaf module, importing nothing.
 *
 * @module
 */

/** A note's parsed frontmatter, whichever shape the caller hands over. */
const payload = (note) => note?.fm ?? note ?? {};

/** A note's type or subType, lowercased. */
const lower = (value) => String(value ?? "").toLowerCase();

/**
 * How a caller reads Addresses and finds notes.
 *
 * @typedef {object} GlossaryLanguageReader
 * @property {(value: unknown, type: string) => string|undefined} keyOf - A
 *   value's canonical Address in the `note` system, read with `type` as the
 *   default type, or `undefined` where it is no Address.
 * @property {(code: string) => string|undefined} noteOf - The Address of a
 *   language code's note, or `undefined` where no note is configured for it.
 * @property {string} [self] - The owning note's own Address, for a language.
 */

/**
 * The language a note is in, as the content index derived it.
 *
 * @param {object} note - An index record, or a link-index note carrying it.
 * @returns {string|undefined} The code.
 */
export function noteLang(note) {
    const lang = note?.lang;
    return typeof lang === "string" && lang ? lang : undefined;
}

/**
 * The language a glossary entry resolves to.
 *
 * @param {object|undefined} entry - The entry, or nothing for the note's own
 *   language.
 * @param {object} owner - The note the entry is written on.
 * @param {GlossaryLanguageReader} reader - How to read Addresses and notes.
 * @returns {string|undefined} The language's Address, or `undefined` where the
 *   chain finds none.
 */
export function glossaryLanguage(entry, owner, { keyOf, noteOf, self }) {
    const own = keyOf(entry?.language, "skill");
    if (own) return own;
    const fm = payload(owner);
    if (lower(fm.type) === "skill" && lower(fm.subType) === "language") return self;
    const code = noteLang(owner);
    return code ? noteOf(code) : undefined;
}
