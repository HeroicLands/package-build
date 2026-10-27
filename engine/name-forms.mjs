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
 * A note's names, by language.
 *
 * `name` is `{full, <code>: [forms]}`. `full` is the English name a page,
 * a compendium entry and an index print. Every other name the subject goes by
 * is listed under the code of its language: a code `languages:` declares, or
 * `en`, which needs no declaration. The first form of a list is that
 * language's standard form, and `full` counts as an English form.
 *
 * `sort`, and a character's `given` and `clan`, are single strings and no
 * language's forms, so a configured language may not take one of those names.
 *
 * A leaf module, importing nothing.
 *
 * @module
 */

/**
 * A whole visible label as names are matched: NFC, straight apostrophes,
 * single spaces, trimmed, and case folded. Matching ignores case; a name is
 * displayed as it was written, never in this form.
 *
 * @param {string} text - A visible name, `full` or a form.
 * @returns {string} Its matching key.
 */
export function normalizeName(text) {
    return displayName(text).toLowerCase();
}

/**
 * A whole visible label as it is displayed: NFC, straight apostrophes, single
 * spaces and trimmed, its case as written.
 *
 * @param {string} text - A visible name, `full` or a form.
 * @returns {string} The label for display.
 */
export function displayName(text) {
    return text.normalize("NFC").replaceAll("’", "'").replace(/\s+/g, " ").trim();
}

/** The language every note falls back to, and a code no configuration need declare. */
export const FALLBACK_LANGUAGE = "en";

/** The single-string name keys every note accepts, in display order. */
export const NOTE_NAME_KEYS = Object.freeze(["full", "sort"]);

/** Additional name components accepted by an individual character. */
export const CHARACTER_NAME_KEYS = Object.freeze(["given", "clan"]);

/** Every `name` key that is not a language's list of forms. */
export const NAME_STRING_KEYS = Object.freeze([...NOTE_NAME_KEYS, ...CHARACTER_NAME_KEYS]);

const STRING_KEYS = new Set(NAME_STRING_KEYS);

/**
 * A note's form lists, in authored order: each key of `name` that is not one
 * of {@link NAME_STRING_KEYS} and holds a list, with its string forms.
 *
 * Read without the configuration, so a reader of an index gets every list a
 * note states; which codes a note may state is the frontmatter lint's
 * question, not a reader's.
 *
 * @param {unknown} name - A note's `name`.
 * @returns {Array<[string, string[]]>} `[code, forms]` pairs; a form that is
 *   not a nonempty string is left out, and so is a list left empty by that.
 */
export function nameFormLists(name) {
    if (!name || typeof name !== "object" || Array.isArray(name)) return [];
    const out = [];
    for (const [code, value] of Object.entries(name)) {
        if (STRING_KEYS.has(code) || !Array.isArray(value)) continue;
        const forms = value.filter((form) => typeof form === "string" && form.trim() !== "");
        if (forms.length) out.push([code, forms]);
    }
    return out;
}

/**
 * Every form a note's name lists, in authored order, without `full`.
 *
 * @param {unknown} name - A note's `name`.
 * @returns {string[]} The forms; empty where it lists none.
 */
export function nameFormsOf(name) {
    return nameFormLists(name).flatMap(([, forms]) => forms);
}
