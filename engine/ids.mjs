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
 * Deterministic document ids, derived by hashing rather than stored.
 *
 * Several pack-build passes must agree on an id without being able to see each
 * other's output — the items pass and the journals pass on an item doc's entry
 * id, a section link and the page it addresses on that page's id. They agree by
 * deriving the id from the same inputs, so the derivation has to be reachable
 * from every one of them.
 *
 * That is why this is its own module and not part of `helpers.mjs`: link
 * resolution needs it, and `helpers.mjs` imports the link resolver. A leaf with
 * no local imports can be depended on from anywhere without a cycle.
 */

import crypto from "crypto";

/**
 * Stable 16-char hex id derived from `${namespace}:${value}`. Use for deriving
 * page ids from heading text when no explicit id is supplied.
 *
 * @param {string} namespace - Keeps unrelated derivations from colliding.
 * @param {string} value - The input the id is a function of.
 * @returns {string} A 16-character hexadecimal Foundry id.
 */
export function makeId(namespace, value) {
    return crypto.createHash("sha1").update(`${namespace}:${value}`).digest("hex").slice(0, 16);
}

/**
 * Every content type that compiles into a Foundry `Scene` — a **map note**,
 * which carries its Scene as exported from Foundry.
 *
 * Declared in this leaf module because several passes need it: the pack router
 * below, the scenes pass, and the doc-carrying type set in `item-docs.mjs` (a
 * map note's prose becomes a JournalEntry, exactly as an item's or a macro's
 * does).
 *
 * @type {ReadonlySet<string>}
 */
export const MAP_TYPES = Object.freeze(new Set(["map"]));

/**
 * Whether a content note's type compiles into a Scene.
 *
 * @param {string} [type] - The note's `type` frontmatter.
 * @returns {boolean} True for a map type.
 */
export function isMapType(type) {
    return MAP_TYPES.has(String(type));
}

/**
 * The map subTypes. A subType says what kind of map a note is; every one
 * carries its Scene as exported from Foundry.
 *
 * @type {readonly string[]}
 */
export const MAP_SUBTYPES = Object.freeze(["battlemap", "localmap", "regionalmap", "totm"]);

/**
 * Content types whose whole document **is** a JournalEntry.
 *
 * Prose, and nothing else: each compiles into one journal entry of its own,
 * with no second document to point at. That is what separates them from the
 * doc-carrying types in `item-docs.mjs`, whose prose becomes a journal *beside*
 * an item, a macro or a scene — those are two documents, and the pair is
 * addressed as `<type>` and `doc<type>`. These are one, so there is no
 * `docplace` and nothing synthesizes one.
 *
 * `doc` was the only member until. `place`, `lore` and `scenario` are in
 * the published content format and are declared for validation, but
 * nothing routed them: a note of one lint-ed clean and then compiled into
 * nothing, because {@link PACK_BY_TYPE} did not name it and the open-set
 * default sent it to the items pack. `sohl-thalorna` could not compile a single
 * pack for exactly this reason — 450 notes, and the same 450 the linter had
 * reported before it learned the types.
 *
 * @type {ReadonlySet<string>}
 */
export const JOURNAL_TYPES = Object.freeze(new Set(["doc", "place", "lore", "scenario"]));

/**
 * The `pack:` value that routes a note's document into no compendium.
 *
 * One reading, on the key that already decides which compendium receives a
 * note: the note publishes to the site and compiles into nothing. Declared
 * here, beside the pack table, so the configuration can refuse a pack of this
 * name and the router can read the value from one spelling.
 *
 * @type {string}
 */
export const NO_PACK = "none";

/**
 * Content type → the pack its documents compile into, and the document type
 * that pack holds.
 *
 * These are pack **names**, not addresses. The package that owns the pack is
 * supplied by the caller, because it is a property of the repository doing the
 * building and not of the content: the same notes compiled by a different
 * repository belong to a different package. Baking the package into these
 * values is what made every link emitted by `sohl-thalorna` address the `sohl`
 * system — correct here only by coincidence.
 *
 * @type {Readonly<Record<string, {pack: string, docType: string}>>}
 */
export const PACK_BY_TYPE = Object.freeze({
    ...Object.fromEntries(
        [...JOURNAL_TYPES].map((type) => [type, { pack: "journals", docType: "JournalEntry" }]),
    ),
    macro: { pack: "macros", docType: "Macro" },
    being: { pack: "actors", docType: "Actor" },
    // A bundle is Foundry's `Adventure` — a set of document *copies* packaged
    // for one-shot import. The conventional name is `adventures`, which
    // is also what the scenes pass calls its **companion**; the two are
    // different packs and a repository shipping both names them apart, since
    // the router refuses a note that addresses a companion.
    bundle: { pack: "adventures", docType: "Adventure" },
    ...Object.fromEntries(
        [...MAP_TYPES].map((type) => [type, { pack: "scenes", docType: "Scene" }]),
    ),
});

/** Where every other content type compiles: the items pack. */
export const ITEM_PACK = Object.freeze({ pack: "items", docType: "Item" });

/**
 * The pack a type's documents live in, in the conventional one-pack-per-type
 * layout.
 *
 * Item types are the open set — a new one is added whenever the system grows a
 * document type — so they are the **default** rather than an enumerated list. A
 * hand-maintained list is what made an entire content directory silently
 * unlinkable once; nothing to maintain, nothing to forget.
 *
 * The `docType` is the authority: it is a property of the *content type* and
 * holds however a repository names or splits its packs. The `pack` is the
 * conventional name only — a repository may rename its packs, or ship several
 * of one type, in which case the pack a particular note's document
 * lands in comes from `engine/pack-router.mjs` and is passed to
 * {@link compendiumUuid} explicitly. This module stays free of the
 * configuration so the link resolver above it can stay pure.
 *
 * @param {string} type - The target note's `type`.
 * @returns {{pack: string, docType: string}} The pack and document type.
 */
export function packForType(type) {
    return PACK_BY_TYPE[type] ?? ITEM_PACK;
}

/**
 * A document's full compendium UUID.
 *
 * This is the one place a UUID is spelled. Every link is resolved by looking up
 * an address computed here — never by concatenating a prefix at the point of
 * use, which is how the package came to be hard-coded in two separate files.
 *
 * @param {string} packageId - The Foundry package that ships the pack, e.g.
 *   `sohl`. A system id or a module id; Foundry addresses both the same way.
 * @param {string} type - The note's content `type`.
 * @param {string} id - The document's id.
 * @param {string} [packName] - The pack the document actually landed in, from
 *   the pack router. Supplied wherever the note is known, because a repository
 *   may ship several packs of one type and a UUID carries the pack name.
 * Omitted only where there is no note to route — the conventional
 *   name from {@link packForType} then stands in.
 * @returns {string} `Compendium.<packageId>.<pack>.<DocumentType>.<id>`
 */
export function compendiumUuid(packageId, type, id, packName) {
    const { pack, docType } = packForType(type);
    return `Compendium.${packageId}.${packName || pack}.${docType}.${id}`;
}

/**
 * The UUID of a JournalEntry page.
 *
 * @param {string} entryUuid - The owning entry's UUID, from
 *   {@link compendiumUuid}.
 * @param {string} pageId - The page's id.
 * @returns {string} The page's UUID.
 */
export function pageUuid(entryUuid, pageId) {
    return `${entryUuid}.JournalEntryPage.${pageId}`;
}
