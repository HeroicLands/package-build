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
 * 3. on an affiliation, its own `data.language`, then the nearest parent
 *    affiliation's (breadth first, parents in the order listed), then its
 *    culture's `data.language`;
 * 4. on a culture, its own `data.language`.
 *
 * An affiliation's culture is the one the index resolves for it, its own or
 * one inherited through its parents, and a culture's language includes one it
 * inherits from its parent cultures. The lint and the `glossary` relation both
 * resolve through here, each handing over how it reads an Address and looks a
 * note up.
 *
 * A leaf module, importing nothing.
 *
 * @module
 */

/** A note's parsed frontmatter, whichever shape the caller hands over. */
const payload = (note) => note?.fm ?? note ?? {};

/** A note's `data`, or an empty map. */
const dataOf = (note) => {
    const data = payload(note).data;
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
};

/** A note's type or subType, lowercased. */
const lower = (value) => String(value ?? "").toLowerCase();

/**
 * How a caller reads Addresses and finds notes.
 *
 * @typedef {object} GlossaryLanguageReader
 * @property {(value: unknown, type: string) => string|undefined} keyOf - A
 *   value's canonical Address in the `note` system, read with `type` as the
 *   default type, or `undefined` where it is no Address.
 * @property {(key: string) => object|undefined} lookup - The note an Address
 *   names, or `undefined` where none is known.
 * @property {string} [self] - The owning note's own Address, for a language.
 */

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
export function glossaryLanguage(entry, owner, { keyOf, lookup, self }) {
    const own = keyOf(entry?.language, "skill");
    if (own) return own;
    const fm = payload(owner);
    const type = lower(fm.type);
    if (type === "skill" && lower(fm.subType) === "language") return self;
    if (type === "lore" && lower(fm.subType) === "culture")
        return keyOf(dataOf(owner).language, "skill");
    if (type !== "affiliation") return undefined;

    const seen = new Set();
    let level = [owner];
    while (level.length) {
        const next = [];
        for (const body of level) {
            if (seen.has(body)) continue;
            seen.add(body);
            const language = keyOf(dataOf(body).language, "skill");
            if (language) return language;
            for (const parent of Array.isArray(dataOf(body).parents) ? dataOf(body).parents : []) {
                const key = keyOf(parent, "affiliation");
                const target = key ? lookup(key) : undefined;
                if (target && lower(payload(target).type) === "affiliation") next.push(target);
            }
        }
        level = next;
    }
    const culture = keyOf(dataOf(owner).culture, "lore");
    const target = culture ? lookup(culture) : undefined;
    return target ? keyOf(dataOf(target).language, "skill") : undefined;
}
