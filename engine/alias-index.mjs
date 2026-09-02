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
 * The **alias** namespace: what a note can be called, and who may claim a name.
 *
 * A wikilink resolves through one of two namespaces, and the pipe chooses
 * which (#131): `[[x|…]]` is an *address*, parsed by the address grammar;
 * `[[x]]` is an *alias*, looked up here. This module owns the second half —
 * what goes into the index, how a key is spelled, and what happens when two
 * notes claim one name.
 *
 * **An alias is scoped to the claiming note's own type.** The key is
 * `(type, alias)`, so `Shock` may be a `skill` in one place and a `trauma` in
 * another without the two ever meeting. A link resolves against the *source*
 * note's type, which is why a bare name reaches a sibling and never a
 * cross-type target — that one is written as an address.
 *
 * **Three sources, all authored.** `aliases`, `name.aliases`, and `name.full`.
 * Each is something a person wrote down as a name for the note, which is
 * exactly what a bare `[[…]]` cites.
 *
 * **The filename is deliberately not one of them**, and it used to be — every
 * one of the three copies of this index added `basename(file, ".md")` with
 * underscores turned to spaces. That admitted keys no author could ever cite
 * and no author had ever written:
 *
 * - `_Introduction.md` yields the alias `" introduction"`, *with a leading
 *   space*. A wikilink target is trimmed, so nothing can ever match it. In one
 *   repository thirteen notes — one per documentation section — claimed that
 *   key, making it the largest alias collision in the corpus and every one of
 *   its claimants blameless.
 * - `README.md` yields `readme`, claimed once per section for the same reason.
 *
 * Since a collision is now a build failure rather than a silent deletion, an
 * index entry that cannot be cited can only ever *cause* one. Removing the
 * source was measured first, across all five content trees: not one link that
 * resolves today resolves through the filename alone, so nothing loses a
 * target — while the collision count falls without a note being edited.
 *
 * @module
 */

/**
 * Every alias a note claims, in the order the sources are consulted.
 *
 * @param {object} fm - Parsed frontmatter.
 * @returns {string[]} The claimed aliases, each a non-empty string.
 */
export function aliasesOf(fm) {
    return [
        ...(Array.isArray(fm?.aliases) ? fm.aliases : []),
        ...(Array.isArray(fm?.name?.aliases) ? fm.name.aliases : []),
        fm?.name?.full,
    ].filter((a) => typeof a === "string" && a);
}

/**
 * The index key one note's claim on one alias is filed under.
 *
 * Stated here so the three indexes — the pack build's, the site build's and
 * the link checker's — cannot spell it differently. All three already used
 * `type|alias`, lowercased; the risk was never that they disagreed today.
 *
 * @param {string} type - The claiming note's content type.
 * @param {string} alias - The alias, as authored.
 * @returns {string} The key.
 */
export function aliasKey(type, alias) {
    return `${String(type).trim()}|${String(alias).trim()}`.toLowerCase();
}

/**
 * One alias claimed by more than one note of a single type.
 *
 * @typedef {object} AliasCollision
 * @property {string} key - The index key, `type|alias`.
 * @property {string} type - The type both claimants share.
 * @property {string} alias - The alias, as the first claimant wrote it.
 * @property {unknown[]} claimants - Every note claiming it, in walk order.
 */

/**
 * Build the type-scoped alias index, and report every collision in it.
 *
 * **A collision resolves to nothing, and is reported naming every claimant.**
 * Both halves matter. Resolving to whichever note happened to be walked first
 * makes a link silently point at the wrong document, and which one it is
 * depends on directory order. Reporting it at the *citing* note blames a file
 * whose author did nothing wrong — whoever added the second claimant broke
 * every existing citation (#13) — so the claimants are kept rather than
 * discarded along with the entry.
 *
 * @template T
 * @param {Iterable<{type: string, aliases: Iterable<string>, value: T}>} entries
 *   One per note: the type that scopes its claims, the aliases it claims, and
 *   whatever the caller wants an alias to resolve to.
 * @param {object} [opts]
 * @param {(a: T, b: T) => boolean} [opts.same] - Whether two values are the
 *   same note. Defaults to identity; a caller whose values are freshly built
 *   records supplies its own.
 * @returns {{byKey: Map<string, T>, claims: Map<string, T[]>,
 *   collisions: AliasCollision[]}} `byKey` omits every colliding key, so a
 *   lookup in it can never resolve an ambiguous alias.
 */
export function indexAliases(entries, { same = Object.is } = {}) {
    const claims = new Map();
    /** The alias as first written, per key, for a message that reads. */
    const written = new Map();
    const typeOf = new Map();

    for (const { type, aliases, value } of entries) {
        for (const alias of aliases ?? []) {
            if (typeof alias !== "string" || !alias) continue;
            const key = aliasKey(type, alias);
            const claimants = claims.get(key);
            if (!claimants) {
                claims.set(key, [value]);
                written.set(key, alias);
                typeOf.set(key, String(type).toLowerCase());
            } else if (!claimants.some((c) => same(c, value))) {
                claimants.push(value);
            }
        }
    }

    const byKey = new Map();
    const collisions = [];
    for (const [key, claimants] of claims) {
        if (claimants.length === 1) {
            byKey.set(key, claimants[0]);
        } else {
            collisions.push({
                key,
                type: typeOf.get(key),
                alias: written.get(key),
                claimants,
            });
        }
    }

    return { byKey, claims, collisions };
}
