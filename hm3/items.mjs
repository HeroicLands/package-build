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
 * **HM3's Item pass** — the two things about compiling a note into an HM3 Item
 * that are facts about HM3 rather than about the note format (#139).
 *
 * Everything else is {@link module:engine/item-compiler}'s, and is the same
 * code the SoHL pass runs: which notes are claimed, which subtype each becomes,
 * which registry builds it, the authored `hm3.system` passthrough, the schema
 * check, and the compendium envelope. A second system is a map and a handful of
 * emitted keys, which is the arrangement #79 and #58 were building towards.
 *
 * **What HM3's compiler writes on every item: one key, and only when there is
 * something to write.** The content format gives an item's `{#appearance}`
 * section a home in HM3 — `description` — and SoHL none, since no SoHL Item
 * subtype declares such a field. So the section is rendered here and nowhere
 * else. Where a note has no such section nothing is emitted at all, which
 * matters for `armorlocation`: it is the one HM3 subtype that extends the
 * Foundry base directly, declaring neither `description` nor `notes`, so an
 * unconditional key would be a finding on every armour-location document in the
 * pack.
 *
 * **There is no HM3 equivalent of `docHtml`.** SoHL points an item at the
 * JournalEntry its prose compiled into, and HM3's data model has nowhere to put
 * such a pointer; inventing one would emit a key Foundry discards at load
 * without a word. The prose still compiles into its JournalEntry — the journals
 * pass claims every doc-carrying type regardless of system — it simply is not
 * addressed from the item.
 *
 * @module
 */

import { renderSection } from "../engine/anchored-sections.mjs";
import { SystemItemCompiler } from "../engine/item-compiler.mjs";
import { HM3_DOCUMENT_SUBTYPES } from "./document-subtypes.mjs";

export class Hm3Items extends SystemItemCompiler {
    /**
     * HM3's note-type → document-subtype map — the one declaration that says
     * which block this pass reads, which notes it claims, and what each becomes
     * (#58/#79).
     *
     * @type {import("../engine/document-subtypes.mjs").DocumentSubtypeMap}
     */
    static documentSubtypes = HM3_DOCUMENT_SUBTYPES;

    /**
     * The `system.*` field HM3 writes on an item from the note's prose.
     *
     * @param {object} fm - The note's frontmatter.
     * @param {object} at - What the pass already knows about this note.
     * @param {string} at.markdown - The note body, tables expanded and
     *   wikilinks resolved.
     * @returns {object} The shared `system` fields — `description`, or nothing.
     */
    commonSystem(fm, { markdown }) {
        const description = renderSection(markdown, "appearance");
        return description ? { description } : {};
    }
}
