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
 * **HM3's note-type → document-subtype map** — which Foundry document, and
 * which subtype of it, a note of each content type compiles into for HârnMaster
 * 3 (#139).
 *
 * The mechanism is `engine/document-subtypes.mjs`, the same one SoHL's
 * declaration uses; the two halves share it and share nothing else. That is the
 * `engine/` ÷ system line this package draws everywhere (#36), and this file is
 * the first evidence that the line holds: a second system declared its map
 * without a line of the mechanism changing.
 *
 * **Where this map differs from SoHL's, and why that matters.**
 *
 * SoHL's map is the identity in every row, which is a fact about SoHL rather
 * than a rule (#79) — and while it stayed true nothing proved the map was doing
 * any work. HM3's is not. Four of its rows are one-to-many, one renames outright
 * (`projectilegear` → `missilegear`), and five of its type names are SoHL's own
 * with a *different data model* behind them. A build that inferred a subtype
 * from a note's `type` would be wrong on nine rows out of ten here, and — worse
 * — silently right-looking on the five shared names.
 *
 * **The five shared names.** `skill`, `weapongear`, `armorgear`,
 * `containergear` and `miscgear` are declared by both systems. A SoHL skill
 * stores `masteryLevelBase`; an HM3 skill stores `masteryLevel` and a `type` of
 * `"Craft"`/`"Physical"`/…. Name-matching between the two would not fail — it
 * would succeed wrongly, emitting a document Foundry accepts and then strips to
 * nothing at load. So each name resolves through *its own system's* map and is
 * built by *its own system's* registry, and the schema check reads that
 * system's published `schema.json`.
 *
 * **The four one-to-many rows are authored, never derived.** A note says which
 * HM3 subtype it is, in its own `hm3:` block, by writing `hm3.type`. Nothing is
 * inferred from the note's `subType`: an author who says nothing gets an error
 * naming the note and listing the permitted values, because a default would
 * pick one of them and be right about half the time.
 *
 * `hm3.type` is not a new spelling. `type` is already one of the properties a
 * system block may carry ({@link module:engine/system-block.BLOCK_DOCUMENT_PROPERTIES}),
 * meaning "this system's document type"; the discriminator is that property,
 * read where it was always going to be written.
 *
 * **What this map is not.** It says which document a note becomes, never what
 * that document contains: the `system` block comes from `item-builders.mjs`
 * here exactly as it does in `sohl/`.
 *
 * @module
 */

import { defineDocumentSubtypes } from "../engine/document-subtypes.mjs";

/**
 * The frontmatter key inside the `hm3:` block that resolves a one-to-many row.
 *
 * One key for all four rows, deliberately: an author who has learned it on a
 * weapon has learned it on a trauma. It is the block's `type` property — the
 * document type this system compiles the note into — which is what the content
 * format has always called it.
 *
 * @type {string}
 */
export const HM3_TYPE_KEY = "type";

/**
 * Every content type HM3 compiles into a Foundry document, and what it becomes.
 *
 * The Item rows are the nine types `item-builders.mjs` declares; the one Actor
 * row is `being`, which HM3 splits into `character` and `creature`. Types this
 * map does not name — `affiliation`, `affliction`, `attribute`,
 * `concoctiongear`, `mystery`, and every core type — compile into no HM3
 * document at all, silently and correctly: HM3 has no form of them, and a
 * finding on every such note would be the noise #79's rule exists to prevent.
 *
 * @type {import("../engine/document-subtypes.mjs").DocumentSubtypeMap}
 */
export const HM3_DOCUMENT_SUBTYPES = defineDocumentSubtypes({
    system: "hm3",
    types: {
        armorgear: { document: "Item", subType: "armorgear" },
        // HM3-only: SoHL resolves a hit location from a being's own body
        // structure, so it has no item of this kind and no note type for one.
        armorlocation: { document: "Item", subType: "armorlocation" },
        containergear: { document: "Item", subType: "containergear" },
        miscgear: { document: "Item", subType: "miscgear" },
        // The one outright rename. A note calls it a projectile; HM3 calls the
        // document a missile.
        projectilegear: { document: "Item", subType: "missilegear" },
        skill: { document: "Item", subType: "skill" },

        // ── the four one-to-many rows ───────────────────────────────────────
        // SoHL keeps one `mysticalability` with a `system.subType`; HM3 has
        // three separate documents, and nothing in the note's own subType
        // vocabulary partitions cleanly onto them.
        mysticalability: {
            document: "Item",
            discriminator: HM3_TYPE_KEY,
            subTypes: ["psionic", "spell", "invocation"],
        },
        // SoHL's `trauma` gathers eleven kinds of harm under one item; HM3 has
        // an `injury` for the physical and a `trait` for everything standing.
        trauma: {
            document: "Item",
            discriminator: HM3_TYPE_KEY,
            subTypes: ["injury", "trait"],
        },
        // SoHL distinguishes a weapon's uses with strike modes on one item; HM3
        // assumes one usage per document, so a thrown spear is a *second*
        // document. Which one a given note describes is the note's to say.
        weapongear: {
            document: "Item",
            discriminator: HM3_TYPE_KEY,
            subTypes: ["weapongear", "missilegear"],
        },

        being: {
            document: "Actor",
            discriminator: HM3_TYPE_KEY,
            subTypes: ["character", "creature"],
        },
    },
});
