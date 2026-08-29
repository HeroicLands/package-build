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
export const ENGINE_NOTE_SCHEMAS = Object.freeze({
    [HOMEPAGE_TYPE]: HOMEPAGE_FIELDS,
});
