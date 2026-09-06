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
 * Which note-type → document-subtype maps this toolchain ships, and the two
 * questions asked of the *list* rather than of any one map.
 *
 * One frozen list, and the two lookups that need to choose among its members
 * before a map can be consulted at all. It lived in `note-claims.mjs` until #270,
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
 * The one local import is `document-subtypes.mjs`, which is the mechanism these
 * maps are instances of — every module that reaches this one already has it,
 * so nothing new is dragged along and no cycle is opened.
 *
 * @module
 */

import { referencedSubtype } from "./document-subtypes.mjs";
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

/**
 * The map one system ships, by its id.
 *
 * @param {string|undefined} system - The system id (`"sohl"`, `"hm3"`).
 * @returns {import("./document-subtypes.mjs").DocumentSubtypeMap|undefined} Its
 *   map, or `undefined` where this toolchain ships none for it.
 */
export function subtypeMapFor(system) {
    if (!system) return undefined;
    return KNOWN_DOCUMENT_SUBTYPE_MAPS.find((map) => map.system === system);
}

/**
 * The document subtype a note type compiles into for one system — the
 * translation the *schema* check needs, and the reason it needs one.
 *
 * A schema artifact is keyed by document subtype; a field declaration is keyed
 * by note type. Those were the same string until #78 renamed three of them, and
 * a check that went on joining them by name simply stopped reporting on
 * `armorgear` — a warning that vanishes is worse than one that fires, because
 * nothing says it went.
 *
 * Falls back to the note type on a one-to-many row, where nothing but a note
 * can say which subtype is meant and this has none: that is the answer the
 * identity default already gave, and HM3's four such rows all name the note
 * type among their subtypes.
 *
 * @param {string|undefined} system - The system whose schema is being checked.
 * @param {string} type - The note type a field declaration is keyed by.
 * @returns {string} The document subtype to look up.
 */
export function schemaSubtypeOf(system, type) {
    const map = subtypeMapFor(system);
    if (!map) return type;
    return referencedSubtype(map, type, "Item").subType ?? type;
}
