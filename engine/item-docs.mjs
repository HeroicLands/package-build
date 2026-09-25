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
 * **Item docs** — an item's prose compiled as a JournalEntry, with the item
 * keeping only a pointer to it.
 *
 * An item note's body describes what the thing *is*. That is documentation, and
 * documentation belongs in the journals pack, so each item note compiles into a
 * JournalEntry and the item's `system.docHtml` becomes nothing but a `@UUID`
 * link to that entry's first page — the description-as-pointer convention,
 * which {@link sohl.utils.descriptionLinkTarget} recognises and
 * Display Description follows.
 *
 * The prose then exists once. Previously every actor carrying an item carried
 * its own copy of that item's description: 7.59 MB across the actors pack, of
 * which only 133 KB was distinct text. Nothing about actors changes —
 * they embed whatever the item carries, and what the item carries is now a link.
 *
 * **Two passes, no shared state.** The items pass writes the pointer; the
 * journals pass writes the entry it points at. Neither can see the other's
 * output, so both derive the same ids from the item note's own id — the same
 * technique {@link anchorPageId} uses to let a section link and its page agree.
 *
 * **The shape generalises.** A `macro` note is the same arrangement: it
 * compiles into a Macro, and its prose into a JournalEntry addressed
 * `docmacro/<shortcode>`. So is a **map note**, which compiles into a
 * Scene and whose prose becomes the place description its map pins point at.
 * {@link docEntryTypes} is the one set both the compilers and the
 * link manifest read to know which types work this way.
 *
 * Plain ESM with no Foundry and no filesystem access, so it is unit-testable.
 */

import { compendiumUuid, makeId, pageUuid } from "./ids.mjs";
import { itemTypes } from "./item-registry.mjs";
import { packRouter } from "./pack-router.mjs";

/**
 * Every content type that compiles into an item — and therefore into an item
 * doc. Re-exported here rather than restated because both passes need it: the
 * items pass to know what to compile, the journals pass to know whose prose it
 * is holding.
 *
 * It is the consuming repository's `itemBuilders` keys, resolved once in
 * `item-registry.mjs` alongside the builder lookup the Item compiler dispatches
 * through — one object, so the whitelist and the table cannot disagree.
 */
export { itemTypes };

/**
 * The doc-carrying types, under the names the compilers hold them by.
 *
 * The set is what decides whether `doc<type>` is a legal type segment, so it is
 * stated in `engine/address.mjs` beside the grammar that reads one and read from
 * there by the journals pass and the link manifest — one set, so an authored
 * `doc<type>` address and the entry it names cannot disagree about which types
 * have one.
 */
export { docEntryTypes, hasDocEntry } from "./address.mjs";

/**
 * The id of the JournalEntry a note's prose compiles into — an item's, or a
 * macro's.
 *
 * Derived from the note's own id so that the pass writing the document and the
 * pass writing its documentation agree without either reading the other's
 * output. It is deliberately not the note's id itself: the two documents are
 * distinct, live in different packs, and sharing an id would make either one's
 * UUID ambiguous to read.
 *
 * The `"item-doc"` hash namespace is **frozen**: it is baked into every entry
 * id already shipped, and every `@UUID` pointing at one. It names where the
 * derivation started, not what may use it.
 *
 * @param {string} itemId - The note's `id` frontmatter.
 * @returns {string} A 16-character Foundry id.
 */
export function itemDocEntryId(itemId) {
    return makeId("item-doc", itemId);
}

/**
 * The description an item carries in place of its prose: a `@UUID` link to the
 * first page of its item doc, and nothing else.
 *
 * "Nothing else" is the whole convention — a description that is *only* a link
 * is a pointer, and anything alongside it would make it ordinary prose that
 * happens to contain a link, which the runtime would then show verbatim.
 *
 * @param {string} packageId - The Foundry package shipping the journals pack.
 *   Supplied rather than assumed.
 * @param {string} itemId - The item note's `id` frontmatter.
 * @param {string} name - The item's name, used as the link's label. It shows
 *   only if the target ever fails to resolve, where a broken link naming the
 *   item beats a bare UUID.
 * @param {string} firstPageId - The id of the entry's first page, from
 *   {@link journalPageId}.
 * @returns {string} The pointer to store in `system.docHtml`.
 */
export function itemDocPointer(packageId, itemId, name, firstPageId) {
    // An item doc is a *derived* document: it lands in the default
    // JournalEntry pack whatever Item pack the item itself was routed to.
    const entryUuid = compendiumUuid(
        packageId,
        "doc",
        itemDocEntryId(itemId),
        packRouter().defaultOf("JournalEntry"),
    );
    return `@UUID[${pageUuid(entryUuid, firstPageId)}]{${name}}`;
}
