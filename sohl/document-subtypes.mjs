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
 * **SoHL's note-type → document-subtype map** — which Foundry document, and
 * which subtype of it, a note of each content type compiles into (#79).
 *
 * The mechanism is `engine/document-subtypes.mjs`; what a *game system* does
 * with it is here, which is the `engine/` ÷ `sohl/` line this package draws
 * everywhere else (#36). A second system declares its own map in its own half
 * and shares nothing but the mechanism.
 *
 * **Every row is written out, identity rows included.** `skill → skill` looks
 * like a row that could be derived from the item registry's keys, and deriving
 * it is precisely the defect this map exists to remove: the note vocabulary
 * and the document vocabulary would once again be the same identifier because
 * one list generated the other, and a rename on either side would follow
 * silently. Sixteen lines of data are the price of the two vocabularies being
 * separately stated.
 *
 * **Today every row is the identity, and that is a fact about SoHL rather than
 * a rule.** The renames the format calls for (`armorgear` → `armor`, and its
 * three siblings) are #78, deliberately deferred: they cost 30,741 embedded
 * `(type, shortcode)` references across four content repositories, and until
 * they land the compiled packs must not move by a byte. When one does land it
 * changes one row here and the notes that address it — a data change, not a
 * mechanism change, which is the whole point of having the map first.
 *
 * **What this map is not.** It says which document a note becomes, never what
 * that document contains: the `system` block comes from the item registry's
 * builders (`item-builders.mjs`), and an item's own `system.subType` field —
 * a skill's `physical` / `combattechnique`, an affliction's kind — is a
 * *data-model field*, unrelated to the document subtype named here.
 *
 * @module
 */

import { defineDocumentSubtypes } from "../engine/document-subtypes.mjs";

/**
 * Every content type SoHL compiles into a Foundry document, and what it
 * becomes.
 *
 * The Item rows are the thirteen types the item registry declares; the one
 * Actor row is `being`, which was two types (`character` and `creature`)
 * compiling to the same actor until they were retired in SoHL#1580. Types this
 * map does not name — `doc`, `macro`, the three map types — compile into
 * documents that carry no system subtype at all, so they have no row and never
 * needed one.
 *
 * @type {import("../engine/document-subtypes.mjs").DocumentSubtypeMap}
 */
export const SOHL_DOCUMENT_SUBTYPES = defineDocumentSubtypes({
    system: "sohl",
    types: {
        affiliation: { document: "Item", subType: "affiliation" },
        affliction: { document: "Item", subType: "affliction" },
        armorgear: { document: "Item", subType: "armorgear" },
        attribute: { document: "Item", subType: "attribute" },
        concoctiongear: { document: "Item", subType: "concoctiongear" },
        containergear: { document: "Item", subType: "containergear" },
        miscgear: { document: "Item", subType: "miscgear" },
        mystery: { document: "Item", subType: "mystery" },
        mysticalability: { document: "Item", subType: "mysticalability" },
        projectilegear: { document: "Item", subType: "projectilegear" },
        skill: { document: "Item", subType: "skill" },
        trauma: { document: "Item", subType: "trauma" },
        weapongear: { document: "Item", subType: "weapongear" },

        being: { document: "Actor", subType: "being" },
    },
});
