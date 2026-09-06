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
 * Bundles, as notes — the Foundry `Adventure` a `type: bundle` note compiles
 * into.
 *
 * An `Adventure` is badly named, and the name misled the first design: it is
 * not a story. `Adventure.contentFields` maps each `SetField` on the schema to
 * a document class, and importing one partitions its members by whether the
 * world's collection already holds that `_id`, then creates or updates each.
 * Afterwards the documents live independently and the Adventure has no further
 * role. **It is an installer** — a set of document *copies* packaged for
 * one-shot import (#259).
 *
 * That is the whole difference from a folder (#256), which is a live grouping
 * **by reference** that persists in the pack. A bundle carries copies and
 * exists to be imported once, so the two are not variations on one idea.
 *
 * The note type is `bundle` rather than `adventure` because the format prefers
 * the domain word wherever Foundry's misleads — a `Scene` is authored as a
 * `map` — and `collection` was refused because `DocumentCollection` is a real
 * Foundry class meaning very nearly the opposite. See `docs/content-format.md`
 * § `type: bundle`.
 *
 * This module is the framework-free half: what a bundle note *says*, and how a
 * set of already-compiled documents becomes an Adventure. The pass that walks
 * the tree and resolves what one note says about another is
 * {@link module:engine/bundles}.
 *
 * @module
 */

/**
 * The note type a bundle is authored as.
 *
 * @type {string}
 */
export const BUNDLE_TYPE = "bundle";

/**
 * Foundry's `Adventure.contentFields`, keyed by the document class each holds.
 *
 * Restated here rather than derived, because this build never loads Foundry:
 * the schema is read from `common/documents/adventure.mjs`, where every
 * `SetField` of an `EmbeddedDataField` is a content field and its name is the
 * key an importer partitions on. The inverse direction is the one a compiler
 * wants — it has a document type in hand and needs the field to file it under.
 *
 * The full set is listed, not only the five this build compiles, because the
 * map is a statement about Foundry rather than about this toolchain: a consumer
 * registering a compiler for `RollTable` needs no edit here.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const ADVENTURE_CONTENT_FIELD = Object.freeze({
    Actor: "actors",
    Combat: "combats",
    Item: "items",
    JournalEntry: "journal",
    Scene: "scenes",
    RollTable: "tables",
    Macro: "macros",
    Cards: "cards",
    Playlist: "playlists",
    Folder: "folders",
});

/**
 * The `data:` key a bundle lists its members under.
 *
 * @type {string}
 */
export const CONTENTS_FIELD = "contents";

/**
 * Strip the LevelDB keys from a document tree.
 *
 * An Adventure's members are **inline source data** in a `SetField`, not
 * sublevel documents, so they carry no `_key`: the compendium CLI's hierarchy
 * does not recurse into an adventure, and Foundry's schema has no such field to
 * hold one. A member that kept its key would ship a property the data model
 * refuses.
 *
 * Shared with the scenes pass, which bundles the Adventures that make a pinned
 * map's ids resolve — one rule about what an Adventure member may carry, stated
 * once.
 *
 * @param {*} value - A document, array, or scalar.
 * @returns {*} The same shape with every `_key` removed.
 */
export function stripAdventureKeys(value) {
    if (Array.isArray(value)) return value.map(stripAdventureKeys);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([k]) => k !== "_key")
                .map(([k, v]) => [k, stripAdventureKeys(v)]),
        );
    }
    return value;
}

/**
 * An authored address with any wikilink brackets and label stripped.
 *
 * The specification types `contents` as a `WikiLink[]`, and a frontmatter link
 * is written as a bare address — but `[[address]]` is what an author reaches
 * for, and it is what a folder note's `parent` already accepts. Accepting both
 * costs one regex and removes a failure whose message would have to explain the
 * difference.
 *
 * @param {unknown} value - As authored.
 * @returns {string|null} The bare address, or `null` for a blank entry.
 */
export function bareAddress(value) {
    if (value == null) return null;
    const text = String(value).trim();
    if (!text) return null;
    const unwrapped = text.replace(/^\[\[(.*)\]\]$/s, "$1");
    // A label is presentation; the address is everything before the pipe.
    const [target] = unwrapped.split("|");
    return target.trim() || null;
}

/**
 * The addresses a bundle note names, in the order it names them.
 *
 * `contents` is a `data:` property, which is where the specification's
 * `### type: bundle` table puts it — the closed container, so a misspelled
 * `content` is a finding rather than a silently empty Adventure. It is accepted
 * at the top level too, exactly as a folder note's `parent` is: an author
 * following #259's own example rather than the specification should get a
 * bundle, not a silent default.
 *
 * **Order is the author's**, and it is kept: an Adventure's `SetField` attaches
 * no meaning to member order, but the emitted JSON is compared between runs, so
 * a stable order is what keeps the same tree compiling to the same bytes.
 *
 * @param {object} fm - Parsed frontmatter.
 * @returns {string[]} The bare addresses. Empty when the note states none.
 * @throws {Error} When `contents` is neither absent nor a list — a scalar is a
 *   bundle of one written wrongly, and reading it as such would accept a shape
 *   the specification does not admit.
 */
export function bundleContents(fm) {
    const data = fm?.data && typeof fm.data === "object" ? fm.data : {};
    const authored = data[CONTENTS_FIELD] ?? fm?.[CONTENTS_FIELD];
    if (authored == null) return [];
    if (!Array.isArray(authored)) {
        throw new Error(
            `\`contents\` is a list of addresses, and this note writes a ` +
                `${typeof authored} — write \`contents:\` as a YAML list, one ` +
                `address per entry, even where the bundle holds only one`,
        );
    }
    const addresses = [];
    for (const entry of authored) {
        const address = bareAddress(entry);
        if (address) addresses.push(address);
    }
    return addresses;
}

/**
 * What a pass should do about a member its sources do not hold.
 *
 * The whole of the system rule, in one predicate, because it is a rule and not
 * an implementation detail. An `Adventure` has no `system` field, so a bundle
 * spanning two systems cannot be one document that knows it spans them: it is
 * one Adventure per system, and **the pack each is written to is what carries
 * the system**.
 *
 * The constraint is not computed from the member's *type* — that would be wrong
 * for the types both systems map, which is most of them: a `miscgear` is a SoHL
 * item **and** an HM3 item, so "which system does this type belong to" has no
 * single answer. It is read instead from what the pack can actually see. A pack
 * declaring `system: hm3` reads the HM3 packs and the system-neutral ones, so a
 * note that publishes no HM3 document is simply not in its sources — which is
 * the same fact, established where it is already true.
 *
 * - **The pack declares a system.** A member it cannot see is another system's,
 *   and is left **out** — reported, never silently, because an installer that
 *   quietly ships half its contents is worse than one that fails.
 * - **The pack declares none.** Nothing is scoped away, so there is no other
 *   system for the member to have gone to: its absence is a **failure**.
 *
 * @param {string|null|undefined} packSystem - The pack's declared `system:`.
 * @returns {"omit"|"fail"} What to do about a member the sources lack.
 */
export function missingMemberVerdict(packSystem) {
    return packSystem ? "omit" : "fail";
}

/**
 * Assemble one `Adventure` from a set of already-compiled documents.
 *
 * The members are **copies**, and they arrive compiled: this takes the JSON a
 * previous pass wrote and files each document under the content field its class
 * maps to. Nothing is derived from the content tree here, which is what keeps
 * this half framework-free and testable without one.
 *
 * @param {object} params
 * @param {string} params.id - The Adventure's `_id`.
 * @param {string} params.name - Its name.
 * @param {string|null} [params.img] - Its artwork, or `null`.
 * @param {string} [params.description] - The note's prose, already rendered.
 * @param {string} [params.caption] - The short caption Foundry shows on the
 *   import card. Blank unless a caller has one.
 * @param {string|null} [params.folder] - The folder id it is filed under.
 * @param {object} [params.flags] - Document flags.
 * @param {object} params.stats - The `_stats` block to stamp.
 * @param {ReadonlyArray<{docType: string, document: object}>} params.contents -
 *   The compiled documents it holds, each with the Foundry class it is.
 * @returns {object} The Adventure document, keyed for the pack.
 * @throws {Error} When a member's document class is not one an Adventure can
 *   hold — a defect in the caller rather than in the note.
 */
export function buildAdventure({
    id,
    name,
    img = null,
    description = "",
    caption = "",
    folder = null,
    flags,
    stats,
    contents = [],
}) {
    // Every content field, empty, so the emitted document states the whole
    // schema rather than only the parts this bundle happened to fill. Foundry
    // defaults an absent `SetField` anyway; writing them all makes two
    // Adventures diffable against each other.
    /** @type {Record<string, object[]>} */
    const held = {};
    for (const field of Object.values(ADVENTURE_CONTENT_FIELD)) held[field] = [];

    for (const { docType, document } of contents) {
        const field = ADVENTURE_CONTENT_FIELD[docType];
        if (!field) {
            throw new Error(
                `an Adventure cannot hold ${docType} documents — Foundry's ` +
                    `\`Adventure.contentFields\` names ` +
                    `${Object.keys(ADVENTURE_CONTENT_FIELD).join(", ")}`,
            );
        }
        held[field].push(stripAdventureKeys(document));
    }

    return {
        name,
        img,
        caption,
        description,
        ...held,
        folder,
        sort: 0,
        flags: flags || {},
        _id: id,
        _stats: stats,
        // The Foundry *collection* name, not the pack's: a pack directory may
        // be called anything (#1566), and the key names the collection the
        // record belongs to inside it.
        _key: `!adventures!${id}`,
    };
}
