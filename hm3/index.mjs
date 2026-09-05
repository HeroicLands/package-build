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
 * The HM3-specific half of the toolchain: the knowledge of the HârnMaster 3
 * data model that a generic content module must never receive (#139).
 *
 * The second half, and the first evidence that `engine/` ÷ system is a real
 * line rather than an aspiration: HM3's item-type registry and its builders,
 * its note-type → document-subtype map, its two compilers and its default-art
 * map live here, and nothing in `@heroiclands/package-build/engine` exports any
 * of it. It imports nothing from `sohl/` and `sohl/` imports nothing from it —
 * the only thing the two share is the engine between them.
 *
 * A consuming repository that ships content for both systems names both
 * registries — `itemBuilders: [sohl, hm3]` — and declares one pack per system
 * per document type. Everything after that is the engine's: which system's map
 * claims a note, which system's builder shapes it, which system's schema it is
 * checked against, and which system's version stamps it.
 *
 * Namespaced rather than flattened, for the reason the engine barrel gives.
 *
 * @module
 */

/** The item-type registry: every type that compiles into an HM3 Item, and its builder. */
export * as itemBuilders from "./item-builders.mjs";

/** The `hm3:` frontmatter vocabulary of every HM3 item type. */
export * as itemFields from "./item-fields.mjs";

/** This system's note-type → document-subtype map, one-to-many rows and all (#139). */
export * as documentSubtypes from "./document-subtypes.mjs";

/** The Item compiler. */
export * as items from "./items.mjs";

/** The Actor compiler. */
export * as actors from "./actors.mjs";

// Flat as well as namespaced, matching the SoHL barrel: the default-art map is
// the one export a Foundry runtime would import by name.
export { HM3_DEFAULT_ITEM_ART, hm3DefaultItemArt } from "./default-item-art.mjs";
