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
 * The infobox declarations this toolchain ships, one per system.
 *
 * Separate from `engine/infobox.mjs` for the reason
 * `engine/subtype-registry.mjs` is separate from
 * `engine/document-subtypes.mjs`: the mechanism is the engine's and the
 * declarations are the systems', and a mechanism that imported its own
 * consumers could not be imported by them.
 *
 * @module
 */

import { subtypeRow } from "./document-subtypes.mjs";
import { assertInfoboxSet, buildInfoboxes } from "./infobox.mjs";
import { packRouter } from "./pack-router.mjs";
import { carriesSystemBlock, resolveFieldValue } from "./system-block.mjs";
import { DEFAULT_DOCUMENT_SUBTYPES, KNOWN_DOCUMENT_SUBTYPE_MAPS } from "./subtype-registry.mjs";
import { SOHL_INFOBOX } from "../sohl/infobox.mjs";
import { HM3_INFOBOX } from "../hm3/infobox.mjs";

/**
 * Every system's infobox declaration, in the order a page shows them.
 *
 * The order matches {@link module:engine/subtype-registry.KNOWN_DOCUMENT_SUBTYPE_MAPS},
 * because the box set is derived from those maps and a reader meeting two
 * pages of one type should meet the boxes in one order.
 *
 * @type {readonly object[]}
 */
export const KNOWN_INFOBOXES = Object.freeze([SOHL_INFOBOX, HM3_INFOBOX]);

/**
 * One system's declaration, by its id.
 *
 * @param {string|undefined} system - The system id.
 * @returns {object|undefined} Its declaration, or `undefined` where this
 *   toolchain ships none for it.
 */
export function infoboxFor(system) {
    if (!system) return undefined;
    return KNOWN_INFOBOXES.find((entry) => entry.system === system);
}

/**
 * Whether one system compiles a document for one note.
 *
 * This is what a system box's _available_ asserts, and it is the compile's own
 * question rather than a reading of the frontmatter.
 *
 * Three statements answer it, and they are the three the compile itself
 * follows:
 *
 * 1. **The note's block.** A system block is what makes a game document, so a
 *    note carrying nothing for this system compiles into no document of it
 *    anywhere — the rule
 *    {@link module:engine/base-compiler.BasePackCompiler#eligibleFor} applies,
 *    asked here from outside.
 * 2. **The map** says which document class this system makes of the note's
 *    type. No row, no document — and no box either, which is why a caller
 *    reaching here already has one.
 * 3. **The router** says which pack that document goes to, read from the pack
 *    list this build is driven by, and **that pack's `system:`** decides whose
 *    it is. Declaring one, it writes that system's data. Declaring none, it is
 *    compiled by the fallback pass, which reads
 *    {@link module:engine/subtype-registry.DEFAULT_DOCUMENT_SUBTYPES} alone —
 *    so a tree with no HM3 pack ships no HM3 document however a note is
 *    written.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {object} map - The system's note-type → document-subtype map.
 * @param {object} router - The pack router this build is driven by.
 * @returns {boolean} True when this system compiles a document for this note.
 */
export function compilesSystemDocument(fm, map, router) {
    if (!carriesSystemBlock(fm, map.block)) return false;

    const row = subtypeRow(map, fm?.type);
    if (!row?.document) return false;

    const packName = router.resolveOrNull(fm, row.document, map.system);
    if (!packName) return false;

    const packSystem = router.systemOf(packName);
    if (!packSystem) return map.system === DEFAULT_DOCUMENT_SUBTYPES.system;
    return packSystem === map.system;
}

/**
 * Every box one note carries, wired to the registries this toolchain ships.
 *
 * The one call each medium makes. What varies between them is the resolver —
 * a website has URLs, a compendium has UUIDs, the book has its own labels —
 * and nothing else, which is what keeps the three showing the same panel.
 *
 * @param {object} fm - The note's frontmatter.
 * @param {object} [options] - Options.
 * @param {(ref: unknown, hint?: object) => object|undefined} [options.resolve] -
 *   Resolves a reference to `{name, url?, uuid?, address?, subType?}`.
 * @param {object} [options.router] - The pack router deciding which system
 *   compiles a document for this note. Defaults to the consuming repository's.
 * @returns {object[]} The boxes, in the order every medium renders them.
 * @throws {Error} When the built set disagrees with what the note's type maps
 *   to — see {@link module:engine/infobox.assertInfoboxSet}.
 */
export function noteInfoboxes(fm, { resolve, router = packRouter() } = {}) {
    const boxes = buildInfoboxes(fm, {
        maps: KNOWN_DOCUMENT_SUBTYPE_MAPS,
        providers: KNOWN_INFOBOXES,
        compilesDocument: (note, map) => compilesSystemDocument(note, map, router),
        resolveField: resolveFieldValue,
        resolve,
    });
    return /** @type {object[]} */ (
        assertInfoboxSet(boxes, fm, { maps: KNOWN_DOCUMENT_SUBTYPE_MAPS })
    );
}
