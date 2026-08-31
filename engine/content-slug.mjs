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
 * The URL segment of a content note — derived from its name.
 *
 * Content notes carry no authored `slug`: it was a hand-maintained second
 * spelling of something already determined, free to drift from the page it
 * named. The URL is derived instead.
 *
 * It is derived from the **name**, deliberately not from the `shortcode`, even
 * though `(type, shortcode)` is unique by rule and would be a tempting key. A
 * shortcode is *identity*: it is referenced from saved world data — actions,
 * cohorts, expressions, archetypes, pack lookups — so binding the public URL to
 * it would make a cosmetic URL change into a data migration. A URL is
 * presentation, and it should read like one (`/creature/nusvorroth/`, not
 * `/creature/nsvrroth/`). Renames are what a URL must survive, and they do:
 * every change appends to the legacy-URL map, which emits a redirect.
 *
 * **One normalisation, for every slug this build makes.** {@link slugify} is it.
 * Two things are layered on top of it for **document identity** only, in
 * {@link contentSlug}:
 *
 * - it must produce something, and throws when a name yields no slug;
 * - it **abbreviates** — see {@link ABBREVIATIONS}.
 *
 * Abbreviation stops at the document's own address on purpose. A heading anchor
 * is not a name the build invents: an author writes the matching key by hand —
 * a map note pins `locations.stair-foot` at a heading called *Stair Foot* — so a
 * slug that silently became `stair-ft` would break a reference nobody could
 * have predicted. The same goes for a pack filename, which is only ever read
 * back by the unpacker. Shortening either buys nothing and costs the author's
 * ability to guess the key.
 *
 * This header used to claim the opposite — that anchor slugs, filename slugs and
 * this one were deliberately separate operations. Three of them had drifted into
 * dropping non-ASCII letters instead of transliterating them, so `Kûrbúl Helm`
 * addressed a page at `kurbul-helm` while its pack file was `k-rb-l-helm` and a
 * link to a heading of the same name pointed at `#k-rb-l-helm`. Twenty-two of
 * this repository's notes were affected. That was not a design; it was three
 * copies of a regex, and the differences between them were all mistakes.
 *
 * What the rule does, and why:
 *
 * - **Transliterate, don't discard.** `unidecode` carries every non-ASCII letter
 *   to its ASCII sense — `æ` → `ae`, `þ` → `th`, `œ` → `oe`, `ß` → `ss`,
 *   `ö` → `o`, `¾` → `3/4`. A rule that merely strips them turns a name into
 *   punctuation.
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

import { abbreviateTokens } from "./abbreviations.mjs";

/**
 * The URL segment for one content note.
 *
 * The name is **transliterated** before it is reduced, so an accented character
 * is carried across rather than dropped — dropping is what turned `Nüsvōrroth`
 * into `n-sv-rroth` and forced a hand-written slug. Ligatures expand the way a
 * reader would spell them out: `þ`→`th`, `æ`→`ae`, `œ`→`oe`, `ß`→`ss`, `ĳ`→`ij`,
 * `ﬁ`→`fi`, and eth (`ð`) follows the Icelandic convention of a bare `d`.
 *
 * Two reductions are ours rather than the transliterator's:
 *
 * - **apostrophes are removed**, not treated as separators (`Armorer's Kit` →
 *   `armorers-kit`), matching the URLs these pages already publish at;
 * - **a fraction keeps its digits together** — a vulgar fraction expands to
 *   `3/4`, and the solidus would otherwise split it into `3-4`, so a slash
 *   *between digits* is closed up (`Kûrbúl ¾-Helm` → `kurbul-34-helm`).
 *
 * @param {string | undefined} name - The note's display name (`name.full`),
 *   which a malformed note may not have at all.
 * @returns {string} The URL segment (never empty).
 * @throws {Error} When there is no name, or the name carries no URL-safe
 *   characters — either way the note cannot be addressed, which is a content
 *   error rather than something to paper over with a fallback.
 */
export function slugify(text) {
    const raw = typeof text === "string" ? text.trim() : "";
    if (!raw) return "";
    const tokens = unidecode(raw)
        .toLowerCase()
        // An apostrophe marks a pronunciation break, not a word boundary:
        // `Kenbet\u2019Pat` is one name said with a catch in it, so it elides
        // rather than becoming a hyphen.
        .replace(/['\u2019]/g, "")
        // A vulgar fraction transliterates to its digits (`\u00be` \u2192 `3/4`); the
        // solidus between them is not a word boundary either.
        .replace(/(\d)\/(\d)/g, "$1$2")
        .split(/[^a-z0-9]+/)
        .filter(Boolean);

    return tokens.join("-");
}

/**
 * The URL segment a content note publishes at.
 *
 * {@link slugify} with the rule that a document *must* be addressable: a note
 * that yields no slug is a content error, not something to paper over with a
 * fallback, because the alternative is a page nobody can reach.
 *
 * @param {string | undefined} name - The note's display name (`name.full`),
 *   which a malformed note may not have at all.
 * @returns {string} The URL segment (never empty).
 * @throws {Error} When there is no name, or the name carries no URL-safe
 *   characters.
 */
export function contentSlug(name) {
    const raw = typeof name === "string" ? name.trim() : "";
    if (!raw) {
        throw new Error("content note has no name, so it has no URL");
    }
    const normalised = slugify(raw);
    const slug = abbreviateTokens(normalised.split("-").filter(Boolean)).join("-");
    if (!slug) {
        throw new Error(`name "${raw}" has no URL-safe characters, so it cannot address a page`);
    }
    return slug;
}

/**
 * Find pages that would publish to the same URL.
 *
 * Nothing constrains two notes in one section from sharing a name, and a
 * collision silently overwrites one page with the other. This turns it into a
 * build failure that names every claimant, so the fix is a more specific title.
 * (The content tree has no collisions today.)
 *
 * @param {Array<{sec: string, slug: string, src: string}>} pages
 * @returns {Array<{url: string, sources: string[]}>} One entry per collision, in
 *   first-claim order; empty when every URL is unique.
 */
export function findSlugCollisions(pages) {
    const byUrl = new Map();
    for (const { sec, slug, src } of pages) {
        const url = `/${sec}/${slug}/`;
        if (!byUrl.has(url)) byUrl.set(url, []);
        byUrl.get(url).push(src);
    }
    return [...byUrl.entries()]
        .filter(([, sources]) => sources.length > 1)
        .map(([url, sources]) => ({ url, sources }));
}
