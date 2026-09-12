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
 * **SoHL's Item pass** — the two things about compiling a note into a SoHL Item
 * that are facts about SoHL rather than about the note format.
 *
 * Everything else lives in {@link module:engine/item-compiler}: claiming a
 * note, looking its subtype up in the system's map, dispatching to the
 * consumer's registry, merging the authored `sohl.system` block, checking what
 * was emitted against the receiving schema, and writing the envelope. That was
 * all here until a second system needed it, and it reached its
 * system-specific facts through one constant read off SoHL's own map — which is
 * why lifting it cost a subclass rather than a rewrite.
 *
 * What stays:
 *
 * - **The map**, declared in `document-subtypes.mjs` and named here, which
 *   decides which notes this pass claims and what each one becomes.
 * - **`commonSystem`** — `shortcode`, `templatePriority`, `actionDefs`, `notes` and
 *   `docHtml`, which SoHL's compiler writes on every item of every type and no
 *   field declaration states.
 *
 * Not a standalone script — exports the `Items` compiler class, imported and
 * driven by `engine/generate.mjs`.
 *
 * @module
 */

import { systemTemplatePriority } from "../engine/helpers.mjs";
import { SystemItemCompiler } from "../engine/item-compiler.mjs";
import { SOHL_DOCUMENT_SUBTYPES } from "./document-subtypes.mjs";

export class Items extends SystemItemCompiler {
    /**
     * SoHL's note-type → document-subtype map — the one declaration that says
     * which block this pass reads, which notes it claims, and what each becomes.
     *
     * @type {import("../engine/document-subtypes.mjs").DocumentSubtypeMap}
     */
    static documentSubtypes = SOHL_DOCUMENT_SUBTYPES;

    /**
     * The `system` keys this pass derives from the note.
     *
     * `docHtml` holds the `@UUID` of the JournalEntry the note's prose compiled
     * into, so a note writing prose there ships a string where every reader
     * expects a pointer. `notes` is a play-time scratchpad the compiler writes
     * empty, so an authored one ships a note's content as a GM's jottings.
     *
     * @type {readonly {key: string, from: string}[]}
     */
    static derivedSystemKeys = Object.freeze([
        { key: "docHtml", from: "the note's own body" },
        { key: "notes", from: "the note's own body" },
    ]);

    /**
     * The `system.*` fields SoHL writes on every item, whatever its type:
     * shortcode, templatePriority, actionDefs, notes, docHtml.
     *
     * @param {object} fm - The note's frontmatter.
     * @param {object} at - What the pass already knows about this note.
     * @param {string} at.description - The pointer to the note's item doc.
     * @param {string} at.label - Human-readable context for error messages.
     * @returns {object} The shared `system` fields.
     */
    commonSystem(fm, { description, label }) {
        return {
            shortcode: fm.shortcode,
            // Required nullable number: a priority, or `null` for a document
            // that is not a template (the archetype contract).
            // `system.archetype` is the legacy spelling; the receiving
            // schema declares only the new name, so the emitted key moves with
            // it — an undeclared `system` key is discarded at construction
            // without a warning.
            templatePriority: systemTemplatePriority(fm, label),
            actionDefs: Array.isArray(fm.actionDefs) ? fm.actionDefs : [],
            notes: "",
            docHtml: description || "",
        };
    }
}
