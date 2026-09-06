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
 * Which note-type → document-subtype maps this toolchain ships.
 *
 * One frozen list, and nothing else. It lived in `note-claims.mjs` until #270,
 * which is where the *questions* asked of it live — but that module imports
 * half the engine, so anything needing the bare list had to take all of it, and
 * `helpers.mjs` could not take it at all: `note-claims.mjs` imports
 * `walkMarkdownTree` from there, so the dependency would have closed a cycle.
 *
 * That is the same reason `engine/ids.mjs` is its own module, and the same
 * reason {@link module:engine/document-subtypes.systemOf} requires its maps as
 * an argument rather than defaulting to them: a leaf with no local imports can
 * be depended on from anywhere. `note-claims.mjs` re-exports this so no
 * consumer had to move.
 *
 * @module
 */

import { SOHL_DOCUMENT_SUBTYPES } from "../sohl/document-subtypes.mjs";
import { HM3_DOCUMENT_SUBTYPES } from "../hm3/document-subtypes.mjs";

/**
 * The note-type → document-subtype maps this toolchain ships.
 *
 * Two, since `hm3/` landed (#139) — and it joined this list rather than the
 * claim table growing a second copy of the same fact, which is what the list
 * was for.
 *
 * The union is what makes the vocabulary wider than any one repository's
 * configuration: `armorlocation` is a real content type because HM3 maps it,
 * however a given repository is configured, so a tree full of them is a
 * repository that has not finished configuring itself rather than an author who
 * invented a word.
 *
 * `engine/` importing from `sohl/` is the arrangement `generate.mjs` already
 * has — its `COMPILERS` table names the SoHL compilers by class — and for the
 * same reason: the engine owns the *mechanism* that asks each system what it
 * compiles, and the systems own the answers.
 *
 * @type {readonly import("./document-subtypes.mjs").DocumentSubtypeMap[]}
 */
export const KNOWN_DOCUMENT_SUBTYPE_MAPS = Object.freeze([
    SOHL_DOCUMENT_SUBTYPES,
    HM3_DOCUMENT_SUBTYPES,
]);
