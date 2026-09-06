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
 * The shortcodes a note declares it used to be published under (#278).
 *
 * A package's `(type, shortcode)` addresses are a published interface, and
 * `addresses diff` reports what a build stopped publishing — telling a
 * **rename** from a **withdrawal** by matching document ids across two
 * releases. #270 removed the property that rested on. An id is now derived from
 * the canonical address, which carries the shortcode, so renaming a shortcode
 * moves the id too: both sides of the join move together, the match finds
 * nothing, and a rename is reported as a withdrawal with no successor named.
 *
 * **The remaining lever needed foresight, which is the wrong thing to ask for.**
 * An authored `id:` still wins, and pinning one does keep a document's identity
 * across a rename — but it has to be written *before* the rename, by an author
 * who does not yet know they will make one. An author who has just renamed a
 * shortcode knows exactly what the old one was, and that is the only moment
 * anyone does.
 *
 * So a note states it:
 *
 * ```yaml
 * type: weapongear
 * shortcode: Taburi
 * renamedFrom: Tabri
 * ```
 *
 * **A declaration is an assertion, not a match, and the diagnostic says which
 * it had.** That distinction is the whole ethos of `address-diff.mjs`: it
 * refuses to guess a successor from a similar-looking string, because a wrong
 * one sends the reader to the wrong fix. An author's declaration is neither a
 * guess nor an identity match — it is testimony from the one party that knows —
 * so it is used, attributed, and never silently blended with an id match.
 *
 * **It is a list, because renames chain.** The diff is release-to-release and a
 * shortcode may be renamed more than once between two releases; a baseline
 * several releases back published a name two renames ago. A single value would
 * report that as a withdrawal again, which is the bug this closes.
 *
 * **It is transient.** Once every baseline a build is compared against post-dates
 * the rename, the declaration has nothing left to say and may be deleted. That
 * is the difference from an `id:` pin, which is permanent, opaque, and a second
 * identity for a thing that already has one (#270).
 *
 * **It is one key per note, at the top level, however many systems the note
 * compiles into.** A shortcode is the note's, not a system block's: a note
 * carrying `sohl:` and `hm3:` blocks compiles into two documents that share one
 * shortcode, so a rename moves both and one declaration covers both.
 *
 * This module reads the key and says nothing about whether the values are
 * *sound* — that a value is a well-formed shortcode, is not the note's own, and
 * does not name an address some live note still publishes are cross-note
 * questions, and `engine/content-lint.mjs` owns them. Composing a value into an
 * address key is likewise not here: the diff defines that space and spells the
 * key once, in `engine/address-diff.mjs`.
 *
 * @module
 */

/**
 * The `renamedFrom:` entries a note authors, exactly as authored.
 *
 * Scalar or list, because one predecessor is the overwhelmingly common case and
 * requiring `- ` on it would be friction with nothing behind it; both normalize
 * here so no reader has to ask which form it got.
 *
 * Entries are returned **unvalidated** — a number, a nested list, a blank
 * string all come back as they were written. The lint needs to see them to
 * report them, and a reader that quietly dropped them would report a correct
 * tree clean while a typo silently did nothing.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter.
 * @returns {readonly unknown[]} The authored entries, in authored order; empty
 *   when the note declares none.
 */
export function renamedFromEntries(fm) {
    if (!fm || typeof fm !== "object") return [];
    const raw = /** @type {{renamedFrom?: unknown}} */ (fm).renamedFrom;
    if (raw == null) return [];
    return Array.isArray(raw) ? raw : [raw];
}

/**
 * The well-formed shortcodes among a note's `renamedFrom:` entries.
 *
 * Trimmed, de-duplicated, and in authored order. Anything that is not a
 * non-blank string is skipped rather than coerced: it is reported by the lint,
 * and a diff that guessed at what a number meant would claim a rename nobody
 * declared.
 *
 * De-duplicating here rather than leaving it to callers is not tidiness — the
 * predecessor index is a map, so a repeated entry would otherwise be indexed
 * twice and the second write would look like a conflicting claim.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter.
 * @returns {string[]} The declared predecessor shortcodes.
 */
export function renamedFrom(fm) {
    const seen = new Set();
    for (const entry of renamedFromEntries(fm)) {
        if (typeof entry !== "string") continue;
        const trimmed = entry.trim();
        if (trimmed) seen.add(trimmed);
    }
    return [...seen];
}

/**
 * Whether a note declares the key at all, however malformed its value.
 *
 * Separate from {@link renamedFrom} returning nothing, because the two mean
 * opposite things to a lint: a note declaring no key is silent and correct,
 * while one declaring `renamedFrom: []` — or a single blank string — has said
 * something that does nothing, which is worth a word.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter.
 * @returns {boolean} `true` when the key is present and not null.
 */
export function declaresRenamedFrom(fm) {
    if (!fm || typeof fm !== "object") return false;
    return /** @type {{renamedFrom?: unknown}} */ (fm).renamedFrom != null;
}
