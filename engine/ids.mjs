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
 * Every content type that compiles into a Foundry `Scene` — a **map note**
 * (#1525). The three differ only in derived canvas defaults, which is the map
 * compiler's business; everything else treats them alike.
 *
 * Declared in this leaf module because several passes that must not depend on
 * the map compiler need it: the pack router below, and the doc-carrying type
 * set in `item-docs.mjs` (a map note's prose becomes a JournalEntry, exactly as
 * an item's or a macro's does).
 *
 * @type {ReadonlySet<string>}
 */
export const MAP_TYPES = Object.freeze(new Set(["map"]));

/**
 * The map subTypes, which differ only in the canvas defaults derived for them.
 *
 * They were three *types* until #174, which cost three entries in the pack
 * router, three in the claims set and three in every consumer's section config
 * — for one idea that the specification had always described as one type.
 *
 * @type {readonly string[]}
 */
export const MAP_SUBTYPES = Object.freeze(["battlemap", "localmap", "regionalmap"]);

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
 * `doc` was the only member until #241. `place`, `lore` and `scenario` are in
 * the published content format and were declared for validation in #233, but
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
 * Content type → the pack its documents compile into, and the document type
 * that pack holds.
 *
 * These are pack **names**, not addresses. The package that owns the pack is
 * supplied by the caller, because it is a property of the repository doing the
 * building and not of the content: the same notes compiled by a different
 * repository belong to a different package. Baking the package into these
 * values is what made every link emitted by `sohl-thalorna` address the `sohl`
 * system (#1498) — correct here only by coincidence.
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
    // for one-shot import (#259). The conventional name is `adventures`, which
    // is also what the scenes pass calls its **companion**; the two are
    // different packs and a repository shipping both names them apart, since
    // the router refuses a note that addresses a companion.
    bundle: { pack: "adventures", docType: "Adventure" },
    ...Object.fromEntries(
        [...MAP_TYPES].map((type) => [type, { pack: "scenes", docType: "Scene" }]),
    ),
});

/**
 * Content types that no longer exist, and what replaced each one.
 *
 * `character` and `creature` were retired in favour of the single `being` they
 * had always compiled into (SoHL#1580). They are recorded here rather than
 * simply deleted because deleting them is the one change that fails *quietly*:
 * every type not named in {@link PACK_BY_TYPE} falls through to the open item
 * set below, so a note or a link left on the old spelling would be routed to
 * the items pack — a wrong answer, arrived at silently, which is exactly the
 * failure mode the open-set default exists to avoid for real item types.
 *
 * Keeping the names lets {@link assertTypeNotRetired} say what happened and
 * what to write instead. Entries stay for as long as content in the wild might
 * still carry them.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const RETIRED_TYPES = Object.freeze({
    character: "being",
    creature: "being",
    // The three map spellings, retired in favour of the single `map` whose
    // subType they became (#174). Recorded rather than deleted for the same
    // reason as the two above: an unnamed type falls through to the open item
    // set, so a note or link left on one would be routed to the items pack.
    battlemap: "map",
    localmap: "map",
    regionalmap: "map",
});

/**
 * Throw if `type` names a retired content type.
 *
 * @param {string} type - The note's declared `type`, or a link's qualifier.
 * @param {string} [where] - What carries it — a file path, a link target —
 *   appended to the message so the reader can go straight to it.
 * @throws {Error} Naming the replacement type.
 */
export function assertTypeNotRetired(type, where) {
    const replacement = RETIRED_TYPES[type];
    if (!replacement) return;
    throw new Error(
        `Content type "${type}" was retired in favour of "${replacement}"` +
            (where ? ` — ${where}` : "") +
            `. Both compiled to the same document, so the fix is mechanical: ` +
            `write "${replacement}".`,
    );
}

/* -------------------------------------------------------------------- */
/*  Renamed in favour of another type — the retirement window            */
/* -------------------------------------------------------------------- */

/**
 * Content types that were **renamed**, and what each is called now.
 *
 * A retired type and a renamed one are different cases, and only the first can
 * be refused. `character` above was retired *outright* — nothing a note wrote
 * made it right, so {@link assertTypeNotRetired} throws. A renamed type has a
 * replacement, the two spellings mean the same thing, and a note carrying the
 * old one compiles into exactly the document it always did: refusing it would
 * fail a build over a note that is not wrong.
 *
 * So these retire in the three steps `package:` took (#56), and this table is
 * the **first**: both spellings resolve, the current one is canonical, and the
 * retired one is *reported* — never refused. The sweep of the content trees and
 * the refusal come after, once no tree writes the old name. That is the same
 * rule `RETIRED_FIELD_ALIASES` states for a renamed *field*, and for the same
 * reason: a consumer must be able to adopt the new toolchain before its content
 * moves, and there are some 31,000 references to move.
 *
 * **Why these three (#78).** `armorgear`, `concoctiongear` and `projectilegear`
 * named the *SoHL document subtype* a note happened to compile into rather than
 * the thing the note is about. A note's `type` sits outside the `sohl:` and
 * `hm3:` blocks precisely because it belongs to no system, and HM3 already
 * compiles a `projectile` into a `missilegear` — so the suffix was never a fact
 * about the note. `weapongear` keeps its name: SoHL and HM3 both call the
 * document that, and #78's table has no row for it.
 *
 * **Keyed by the retired spelling**, which is the opposite of
 * `RETIRED_FIELD_ALIASES`. The direction follows the operation: a field alias
 * is scoped by the schema that declares the *current* name, so that is what a
 * reader asks with; a type alias is applied to a value read off a note, so what
 * a reader has in hand is the retired spelling and what it needs is the
 * replacement.
 *
 * **The address is not normalised.** A note's canonical address — and therefore
 * its document id — carries its `type` as authored, so both spellings keep the
 * addresses they already publish and a tree that has not swept compiles
 * byte-identically. Renaming the type in a note *is* an address move, which is
 * the sweep's business and not this table's.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const RENAMED_TYPES = Object.freeze({
    armorgear: "armor",
    concoctiongear: "concoction",
    projectilegear: "projectile",
});

/**
 * The current spelling of a content type: itself, or what it was renamed to.
 *
 * Every table keyed by note type is keyed by the **current** name, and every
 * lookup goes through this — which is the whole of the window's behaviour, in
 * one function, so no two readers can disagree about which vocabulary a note
 * is held to.
 *
 * A non-string passes through untouched: callers hand this whatever the
 * frontmatter carried, and inventing a type for a number would hide the
 * missing-`type:` finding that belongs to the linter.
 *
 * @param {any} type - The type as authored, or as a link spells it.
 * @returns {any} The current spelling.
 */
export function currentType(type) {
    if (typeof type !== "string") return type;
    return RENAMED_TYPES[type] ?? type;
}

/**
 * What a note declaring a renamed type is told, in one place.
 *
 * Shared by every reporter, because an author meets whichever runs first and
 * they should read the same. It names the type to write rather than a value to
 * correct — no value makes the retired spelling right — and it says the note
 * compiles either way, so a reader knows this is a rename to schedule rather
 * than a build to unbreak.
 *
 * @param {string} retired - The spelling the note used.
 * @param {string} current - What to write instead.
 * @param {string} [where] - What carries it — a file path, a link target —
 *   appended to the message. Omit it where the caller emits through a
 *   diagnostic, whose locator already starts the line.
 * @returns {string} The message, unpunctuated at the end as a finding is.
 */
export function renamedTypeMessage(retired, current, where) {
    return (
        `content type "${retired}" was renamed to "${current}" — the suffix ` +
        `named a SoHL document subtype rather than the thing the note is ` +
        `about` +
        (where ? ` — ${where}` : "") +
        `. Both spellings compile to the same document, so the note is not ` +
        `wrong; write "${current}", and move every \`(type, shortcode)\` ` +
        `reference and wikilink to it in the same change. "${retired}" is ` +
        `refused in a later release`
    );
}

/** Where every other content type compiles: the items pack. */
export const ITEM_PACK = Object.freeze({ pack: "items", docType: "Item" });

/**
 * The pack a type's documents live in, in the conventional one-pack-per-type
 * layout.
 *
 * Item types are the open set — a new one is added whenever the system grows a
 * document type — so they are the **default** rather than an enumerated list. A
 * hand-maintained list is what made an entire content directory silently
 * unlinkable once (#1276); nothing to maintain, nothing to forget.
 *
 * The `docType` is the authority: it is a property of the *content type* and
 * holds however a repository names or splits its packs. The `pack` is the
 * conventional name only — a repository may rename its packs, or ship several
 * of one type (#1566), in which case the pack a particular note's document
 * lands in comes from `engine/pack-router.mjs` and is passed to
 * {@link compendiumUuid} explicitly. This module stays free of the
 * configuration so the link resolver above it can stay pure.
 *
 * @param {string} type - The target note's `type`.
 * @returns {{pack: string, docType: string}} The pack and document type.
 * @throws {Error} If `type` names a retired content type — see
 *   {@link RETIRED_TYPES}. The open-set default would otherwise route it to the
 *   items pack and say nothing.
 */
export function packForType(type) {
    assertTypeNotRetired(type);
    // Through {@link currentType} like every other type-keyed lookup, so the
    // rule holds without exception. None of today's renamed types is named in
    // `PACK_BY_TYPE` — all three are items and take the default — but a router
    // that read the authored spelling would be the one table left to remember
    // when the next rename lands.
    return PACK_BY_TYPE[currentType(type)] ?? ITEM_PACK;
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
 *   may ship several packs of one type and a UUID carries the pack name
 *   (#1566). Omitted only where there is no note to route — the conventional
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
