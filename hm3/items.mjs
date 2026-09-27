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
 * HM3's Item compiler uses the shared note-to-Item pass. It puts the pointer
 * to the note's `{#description}` JournalEntryPage in `system.description` when
 * the Item subtype declares that field. `armorlocation` has no description.
 * The shared `data.templatePriority` is recorded in HM3 flags.
 *
 * @module
 */

import { SystemItemCompiler } from "../engine/item-compiler.mjs";
import { HM3_DOCUMENT_SUBTYPES } from "./document-subtypes.mjs";
import { templateFlags } from "./template-priority.mjs";

/**
 * HM3's Item compile pass.
 *
 * Declares HM3's note-type → document-subtype map, which decides the notes this
 * pass claims and what each becomes, the one `system` key HM3 writes as a page pointer,
 * and the template-priority flag HM3's data model has no field for. Everything
 * else is {@link module:engine/item-compiler}'s.
 */
export class Hm3Items extends SystemItemCompiler {
    /**
     * HM3's note-type → document-subtype map — the one declaration that says
     * which block this pass reads, which notes it claims, and what each becomes.
     *
     * @type {import("../engine/document-subtypes.mjs").DocumentSubtypeMap}
     */
    static documentSubtypes = HM3_DOCUMENT_SUBTYPES;

    /**
     * The `system` keys this pass derives from the note.
     *
     * `description` points to the note's `{#description}` page. A note
     * authoring it writes into a key the compiler derives from the shared body.
     *
     * @type {readonly {key: string, from: string}[]}
     */
    static derivedSystemKeys = Object.freeze([
        { key: "description", from: "the note's `{#description}` page" },
    ]);

    /**
     * The `system.*` field HM3 writes from the shared item-doc pointer.
     *
     * @param {object} fm - The note's frontmatter.
     * @param {object} at - What the pass already knows about this note.
     * @param {string} at.description - The resolved JournalEntryPage pointer.
     * @returns {object} The shared `system` fields — `description`, or nothing.
     */
    commonSystem(fm, { description }) {
        return description && this.itemSubtype(fm) !== "armorlocation" ? { description } : {};
    }

    /**
     * The `flags` HM3 writes on an item: whatever the note authors, plus the
     * template priority.
     *
     * The same statement the Actor pass records, through the same
     * {@link module:hm3/template-priority.templateFlags} — see that module for
     * why the priority lives in flags at all, and for what its absence here
     * cost.
     *
     * @param {object} fm - The note's frontmatter.
     * @returns {object} The flags to emit.
     */
    commonFlags(fm) {
        return templateFlags(fm, this.system);
    }
}
