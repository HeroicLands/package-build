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
 * One normalisation, for every slug this build makes.
 *
 * {@link slugify} reduces a piece of prose — a heading, a document name — to a
 * URL-safe token. It is **not** how a page is addressed: a note's URL is its
 * address, `type-shortcode`, derived in `engine/content-address.mjs` and
 * touching no display string at all (#181).
 *
 * That used to be the other way round. This module carried a `contentSlug` that
 * derived a page's URL from `name.full`, abbreviating it through a table of 200
 * words so the result stayed short, and a `findSlugCollisions` to catch the two
 * notes that would then claim one URL. Its own header justified the readability
 * cost with a rename-survival story — *"every change appends to the legacy-URL
 * map, which emits a redirect"* — and no such map was ever written, in this
 * package or in any consumer. So a rename silently 404'd every existing link,
 * a display string was load-bearing, and a uniqueness check was needed to keep
 * it correct. An address has none of those properties, so all three went.
 *
 * What is left is the normalisation the rest of the build still needs, in the
 * two places it was always right for:
 *
 * - **heading anchors**, where an author writes the matching key by hand — a map
 *   note pins `locations.stair-foot` at a heading called *Stair Foot*;
 * - **pack filenames**, read back only by the unpacker.
 *
 * Neither is abbreviated, and neither ever was: abbreviation existed solely to
 * shorten a name-derived URL, so it left with it.
 *
 * What the rule does, and why:
 *
 * - **Transliterate, don't discard.** `unidecode` carries every non-ASCII letter
 *   to its ASCII sense — `æ` → `ae`, `þ` → `th`, `œ` → `oe`, `ß` → `ss`,
 *   `ö` → `o`, `¾` → `3/4`. A rule that merely strips them turns a name into
 *   punctuation, which is how `Kûrbúl Helm` once became `k-rb-l-helm`.
 * - **An apostrophe elides.** `’` and `'` mark a pronunciation break — a glottal
 *   stop — inside one word, so `Kenbet’Pat` is `kenbetpat`, not `kenbet-pat`.
 * - **Everything else non-alphanumeric becomes a hyphen**, collapsed and
 *   trimmed.
 *
 * `slugifyShortcode` in the SoHL runtime is genuinely a different operation and
 * stays separate: it runs the other way, suggesting a shortcode *from* a name
 * when an item is created.
 *
 * Plain ESM with no Foundry and no filesystem access, so it is unit-testable.
 */

import unidecode from "unidecode";

/**
 * The URL-safe token a piece of prose reduces to.
 *
 * The text is **transliterated** before it is reduced, so an accented character
 * is carried across rather than dropped. Ligatures expand the way a reader would
 * spell them out: `þ`→`th`, `æ`→`ae`, `œ`→`oe`, `ß`→`ss`, `ĳ`→`ij`, `ﬁ`→`fi`,
 * and eth (`ð`) follows the Icelandic convention of a bare `d`.
 *
 * Two reductions are ours rather than the transliterator's:
 *
 * - **apostrophes are removed**, not treated as separators (`Armorer's Kit` →
 *   `armorers-kit`);
 * - **a fraction keeps its digits together** — a vulgar fraction expands to
 *   `3/4`, and the solidus would otherwise split it into `3-4`, so a slash
 *   *between digits* is closed up (`Kûrbúl ¾-Helm` → `kurbul-34-helm`).
 *
 * @param {string | undefined} text - The prose to reduce.
 * @returns {string} The token, or `""` when the text carries nothing URL-safe.
 *   Empty is an ordinary answer here: nothing is addressed by a slug any more,
 *   so an anchor that reduces to nothing is the caller's to judge.
 */
export function slugify(text) {
    const raw = typeof text === "string" ? text.trim() : "";
    if (!raw) return "";
    const tokens = unidecode(raw)
        .toLowerCase()
        // An apostrophe marks a pronunciation break, not a word boundary:
        // `Kenbet’Pat` is one name said with a catch in it, so it elides
        // rather than becoming a hyphen.
        .replace(/['\u2019]/g, "")
        // A vulgar fraction transliterates to its digits (`¾` → `3/4`); the
        // solidus between them is not a word boundary either.
        .replace(/(\d)\/(\d)/g, "$1$2")
        .split(/[^a-z0-9]+/)
        .filter(Boolean);

    return tokens.join("-");
}
