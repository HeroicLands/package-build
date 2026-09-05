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
 * The note types the **engine** declares — the ones whose vocabulary is a fact
 * about the note format rather than about any game system (#51).
 *
 * `sohl/note-schemas.mjs` is the other half, and the line between them is the
 * `engine/` ÷ `sohl/` line everywhere else in this package: note-format
 * knowledge here, game-system knowledge there. It is not a permission boundary
 * between consumers — every content project authors the full vocabulary — but it
 * is a reachability one in exactly one direction. A package that declares no
 * `itemBuilders` (`HarnMaster-3-FoundryVTT`, and every HM3 module) uses only the
 * packaging half of the toolchain, so a type declared in the SoHL registry would
 * be unavailable to it. These are the types every package has, whatever it
 * ships.
 *
 * One entry today. A consumer merges it under its own registry —
 * `{ ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS }` — so a game system may extend
 * these but the engine's declaration stands wherever no registry is configured.
 *
 * @module
 */

import { HOMEPAGE_FIELDS, HOMEPAGE_TYPE } from "./homepage.mjs";

/**
 * Every engine-level content type, and what a note of that type may write.
 *
 * @type {Readonly<Record<string, readonly import("./field-spec.mjs").FieldSpec[]>>}
 */
/**
 * A note that compiles to a JournalEntry and nothing else.
 *
 * Empty on purpose, and the emptiness is the declaration. `place`, `lore` and
 * `scenario` produce prose — the JournalEntry every note produces — so none of
 * them writes a `sohl:` field, and the authored corpus agrees: across
 * `sohl-thalorna`'s 249 places, 180 lore notes and 21 scenarios, not one
 * carries a `sohl:` block. Everything they *do* declare is `data:`, which is
 * the closed container `engine/note-vocabulary.mjs` holds them to.
 *
 * Declaring the type with no fields is what distinguishes **a type with no
 * vocabulary** from **a type that is unknown** — two different findings, and
 * only the second is a mistake. Until this landed the specification declared
 * all three and nothing implemented them, so a note using one was reported as
 * having no schema and then *skipped entirely*: `lintNote` returns after that
 * finding, so the note's `data:`, `subType`, references and system block all
 * went unexamined (#231).
 *
 * @type {readonly import("./field-spec.mjs").FieldSpec[]}
 */
const JOURNAL_ONLY_FIELDS = Object.freeze([]);

/**
 * An `armorlocation` note — an HM3 item, and no part of the SoHL registry.
 *
 * It lives here rather than in `sohl/` for the reachability reason that
 * governs this whole file: a package declaring no `itemBuilders` never loads
 * the SoHL registry, and HM3 packages are exactly the ones that author this
 * type.
 *
 * @type {readonly import("./field-spec.mjs").FieldSpec[]}
 */
const ARMORLOCATION_FIELDS = Object.freeze([]);

/**
 * A `folder` note — the compendium folder itself, as a note.
 *
 * A `Folder` is a real Foundry document, and was the one kind this package
 * compiled from bespoke configuration rather than from a note (#254). It
 * declares no system-block fields: a folder belongs to no game system, which is
 * why its canonical address carries `none`, and everything it says — its parent
 * and its colour — is a `data` property, declared in the vocabulary.
 *
 * @type {readonly import("./field-spec.mjs").FieldSpec[]}
 */
const FOLDER_FIELDS = Object.freeze([]);

/**
 * Every engine-level content type, and what a note of that type may write.
 *
 * @type {Readonly<Record<string, readonly import("./field-spec.mjs").FieldSpec[]>>}
 */
export const ENGINE_NOTE_SCHEMAS = Object.freeze({
    [HOMEPAGE_TYPE]: HOMEPAGE_FIELDS,
    place: JOURNAL_ONLY_FIELDS,
    lore: JOURNAL_ONLY_FIELDS,
    scenario: JOURNAL_ONLY_FIELDS,
    armorlocation: ARMORLOCATION_FIELDS,
    folder: FOLDER_FIELDS,
});
