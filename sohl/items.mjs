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
 * Items pack compiler — produces JSON pack files for the single "items"
 * Foundry compendium from markdown notes in the `assets/content/` tree.
 *
 * The content root (`contentBase`) is walked recursively; any `.md` file whose
 * frontmatter declares a recognized `type:` is compiled into one JSON entry.
 * Files outside the whitelist (blog posts, rules text, templates) are
 * silently skipped.
 *
 * Type-specific `system.*` fields come from the nested `sohl:` block in
 * vault frontmatter, read via `sohlField()`. The body is **not** rendered
 * here: it compiles into the item's doc in the journals pack, and
 * `system.docHtml` becomes a pointer to it (see `item-docs.mjs`). Folder
 * assignment is deferred — every item currently emits `folder: null`.
 *
 * Not a standalone script — exports the `Items` compiler class, imported and
 * driven by `packages/content-build/engine/generate.mjs` (via `npm run build:compiledb`).
 *
 * The walk itself — filtering by type, expanding tables, converting
 * wikilinks, writing the JSON and counting errors — belongs to {@link sohl.utils.packs.BasePackCompiler}; this module
 * states only what makes this pass its own (#1509).
 */

import log from "loglevel";

import {
    sohlField,
    resolveName,
    resolveImg,
    defaultStats,
    withArchetypeFlag,
} from "../engine/helpers.mjs";
import { BasePackCompiler } from "../engine/base-compiler.mjs";
// Per-type default art lives in one framework-free module shared with the
// runtime (`SohlItem.getDefaultArtwork`), so the two can't drift — see #932.
// It lives in the build package, not `src/`: a relative path out of the package
// resolves to garbage once this pipeline runs from `node_modules` (#1510).
import { journalPageId, splitPages } from "../engine/journals.mjs";
import { foundryPackageId } from "../engine/content-package.mjs";
import { itemDocEntryId, itemDocPointer } from "../engine/item-docs.mjs";
// The whitelist and the per-type `system` builders both come from the resolved
// configuration, so the types this pass claims and the builders it compiles
// them with are one table — the consuming repository's, not this package's
// (#1504/#1563).
import { itemTypes, itemBuilder, itemArt } from "../engine/item-registry.mjs";
// Which Foundry Item subtype a note's `type` compiles into. Looked up in the
// system's declared map, never inferred from the type itself (#79).
import { documentSubtype, subtypeRow } from "../engine/document-subtypes.mjs";
import { SOHL_DOCUMENT_SUBTYPES } from "./document-subtypes.mjs";
// The note-level `sohl:` block: `sohl.system` onto the document's `system`
// verbatim, and `sohl.img` / `sohl.effects` / `sohl.flags` overriding their
// shared top-level forms for this system alone (#58).
import { blockProperty, claimedPaths, mergeSystemData } from "../engine/system-block.mjs";
import { itemFields } from "../engine/item-registry.mjs";

/**
 * The description an item carries: a pointer to its **item doc**, the
 * JournalEntry the journals pass compiles this same body into (#1348).
 *
 * The prose is not rendered here at all. Carrying it would duplicate it onto
 * every actor holding the item — 7.59 MB of copies across the actors pack, of
 * which 133 KB was distinct — where a link is 60 bytes and always current. The
 * two passes derive the target from the note's own id, so neither has to see
 * the other's output; both split the *converted* markdown, so an H1 carrying a
 * wikilink names the same page on both sides.
 *
 * An item with no prose points at nothing, exactly as the journals pass writes
 * no entry for it.
 *
 * @param {string} markdown - The note body, tables expanded and wikilinks
 *   resolved.
 * @param {object} fm - The note's frontmatter.
 * @param {string} name - The item's name.
 * @returns {string} The pointer, or "" for a note with no body.
 */
function itemDescription(markdown, fm, name) {
    if (!String(markdown).trim()) return "";
    const [leadPage] = splitPages(markdown, name);
    const pageId = journalPageId(itemDocEntryId(fm.id), leadPage, 0);
    return itemDocPointer(foundryPackageId(), fm.id, name, pageId);
}

/**
 * Build the `system.*` fields shared by every item type:
 *   shortcode, actionDefs, notes, docHtml.
 */
function commonSystem(fm, description) {
    return {
        shortcode: fm.shortcode,
        actionDefs: Array.isArray(fm.actionDefs) ? fm.actionDefs : [],
        notes: "",
        docHtml: description || "",
    };
}

/* -------------------------------------------------------------------- */
/*  Synthesized Active Effects                                          */
/* -------------------------------------------------------------------- */

/* -------------------------------------------------------------------- */
/*  Compiler                                                            */
/* -------------------------------------------------------------------- */

/**
 * The system this pass compiles for — the block its notes write, and the
 * registry its builders come from.
 *
 * Read from the map rather than spelled here, so the block name, the subtype
 * map and the registry key are one statement (#58/#79).
 *
 * @type {string}
 */
const SYSTEM = SOHL_DOCUMENT_SUBTYPES.block;

export class Items extends BasePackCompiler {
    static id = "items";
    static label = "item";

    /**
     * An Item **is** a system's data, so this pack takes only notes carrying
     * this system's block (#58).
     */
    static requiresSystemBlock = true;

    /**
     * How many of each item type this pass wrote, for the summary. Every type
     * is present from the start so the tally reads as a census of the
     * whitelist rather than of what happened to compile.
     *
     * @type {Record<string, number>}
     */
    counts = Object.fromEntries([...itemTypes()].map((t) => [t, 0]));

    /**
     * Every content type that compiles into an item.
     *
     * The whitelist is the consuming repository's `itemBuilders` keys (#1504),
     * and the system's own map is a second filter on top of it: a type SoHL
     * maps onto some *other* document class is not an item however a registry
     * spells it, which is the "no wrongly-typed document" half of #79. A type
     * the map does not name at all is left to the registry — see
     * {@link Items#itemSubtype}.
     *
     * @param {object} fm - The note's frontmatter.
     * @returns {boolean} True for a whitelisted item type.
     */
    selects(fm) {
        if (!fm.type || !itemTypes().has(fm.type)) return false;
        const row = subtypeRow(SOHL_DOCUMENT_SUBTYPES, fm.type);
        return !row || row.document === "Item";
    }

    /**
     * The Foundry Item subtype a note compiles into.
     *
     * **Looked up, not inferred.** For every type this system declares, the
     * emitted subtype is the map's, so the note vocabulary and the document
     * vocabulary are two separately-stated things rather than one string
     * written twice (#79).
     *
     * **A type the map does not name belongs to the consumer**, and its
     * registry entry is the declaration: a repository shipping an item type of
     * its own writes it once, in the `itemBuilders` table of its
     * `package-build.config.yaml`, and that key is what the document is a
     * subtype of. That is an authored statement in the consumer's own
     * configuration, not a coincidence inside this package's source — and
     * refusing it here would silently drop every document of a type SoHL has
     * no opinion about (#7/#1563).
     *
     * @param {object} fm - The note's frontmatter.
     * @returns {string} The document's `type`.
     */
    itemSubtype(fm) {
        const declared = documentSubtype(SOHL_DOCUMENT_SUBTYPES, fm.type, fm, {
            absPath: this.currentNote?.absPath,
        });
        return declared ?? fm.type;
    }

    /** An item is named by its own type in the log, not by "item". */
    noteLabel(fm) {
        return fm.type;
    }

    /**
     * Construct the full compendium envelope for one item, including
     * synthesized Active Effects where applicable.
     *
     * @param {object} fm - The note's frontmatter.
     * @param {string} markdown - The body, tables expanded and wikilinks
     *   resolved.
     * @returns {object} The item document, keyed for the pack.
     */
    buildEntry(fm, markdown) {
        const type = fm.type;
        const name = resolveName(fm);
        const description = itemDescription(markdown, fm, name);
        const id = fm.id;
        const subType = this.itemSubtype(fm);
        const system = {
            ...commonSystem(fm, description),
            ...itemBuilder(type, SYSTEM)(fm),
        };
        // Whatever the note authors under `sohl.system`, at the DataModel's own
        // paths. A path a declared field already writes is left to that field:
        // its value came from the same authored place and went through the
        // field's own coercion (#58).
        mergeSystemData(system, fm, {
            block: SYSTEM,
            claimed: claimedPaths(itemFields(type, SYSTEM)),
        });
        this.reportUndeclaredSystemData(fm, SYSTEM, "Item", subType);

        const effects = blockProperty(fm, SYSTEM, "effects");
        const folderId = sohlField(fm, "folder", null);
        const folder = this.folderResolver(folderId);

        return {
            name,
            // The note's `type` addresses the builder and the default art —
            // both registries are keyed by content type — while the document's
            // own subtype comes from the system's map (#79).
            type: subType,
            img: resolveImg(blockProperty(fm, SYSTEM, "img")) || itemArt(type, SYSTEM),
            _id: id,
            system,
            effects: Array.isArray(effects) ? [...effects] : [],
            // `sohl.archetype` (required nullable number) drives
            // `flags.sohl.docArchetype` (#640 / archetype contract #604).
            flags: withArchetypeFlag(fm, blockProperty(fm, SYSTEM, "flags"), `item "${name}"`),
            _stats: this.stats,
            ownership: { default: 0 },
            folder,
            _key: `!items!${id}`,
        };
    }

    /** @inheritdoc */
    onCompiled(fm) {
        this.counts[fm.type]++;
    }

    /** @inheritdoc */
    reportCompiled(stats) {
        log.info(`Compiled ${stats.compiled} items:`);
        for (const [t, n] of Object.entries(this.counts)) {
            if (n > 0) log.info(`  ${t}: ${n}`);
        }
    }

    /** @inheritdoc */
    reportDetail(stats) {
        log.debug(`Skipped ${stats.skippedOther} non-item file(s) (no recognized type)`);
    }
}
