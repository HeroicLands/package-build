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
 * **The Item pass, for any system** — everything about compiling a note into a
 * Foundry Item that is a fact about the *note format* rather than about a
 * particular game system (#139).
 *
 * `sohl/items.mjs` was the whole of it, and every system-specific thing in it
 * was reached through one module-level constant read off SoHL's map. That is
 * exactly the shape a second system needs, so the class moved here and the two
 * halves declare what differs:
 *
 * | stated by the subclass | what it decides |
 * | --- | --- |
 * | `static documentSubtypes` | the block its notes write, the types it claims, the subtype each becomes |
 * | `commonSystem()` | the `system` keys this system's compiler writes on every item |
 *
 * Everything else — claiming a note, looking the subtype up, resolving the art,
 * merging the authored `<system>.system` block, checking what was emitted
 * against the receiving schema, writing the envelope — is one implementation
 * serving both. That is not tidiness: it is the guarantee that a second
 * system's items are compiled by the code the first system's are, so a fix to
 * either is a fix to both.
 *
 * **The `system` block has two authors, and the split is deliberate.** The
 * declared fields come from the consuming repository's `itemBuilders` registry,
 * addressed by *this pass's system*, so a type both systems declare is built by
 * the right one. On top of that sits {@link SystemItemCompiler#commonSystem} —
 * the keys the compiler writes on its own initiative for every item of the
 * system, which no field declaration states and which nothing else could
 * therefore check. Both are checked against the receiving subtype's published
 * schema before the document is written.
 *
 * @module
 */

import log from "loglevel";

import { resolveName, resolveImg } from "./helpers.mjs";
import { BasePackCompiler } from "./base-compiler.mjs";
import { journalPageId, splitPages } from "./journals.mjs";
import { foundryPackageId } from "./content-package.mjs";
import { itemDocEntryId, itemDocPointer } from "./item-docs.mjs";
// The whitelist and the per-type `system` builders both come from the resolved
// configuration, so the types this pass claims and the builders it compiles
// them with are one table — the consuming repository's, not this package's
// (#1504/#1563).
import { itemTypes, itemBuilder, itemArt, itemFields } from "./item-registry.mjs";
// Which Foundry Item subtype a note's `type` compiles into. Looked up in the
// system's declared map, never inferred from the type itself (#79).
import { documentSubtype, subtypeRow } from "./document-subtypes.mjs";
// The note-level `<system>:` block: `<system>.system` onto the document's
// `system` verbatim, and `<system>.img` / `.effects` / `.flags` overriding
// their shared top-level forms for this system alone (#58).
import { blockField, blockProperty, claimedPaths, mergeSystemData } from "./system-block.mjs";

/**
 * The description an item carries: a pointer to its **item doc**, the
 * JournalEntry the journals pass compiles this same body into (#1348).
 *
 * The prose is not rendered into the item at all. Carrying it would duplicate
 * it onto every actor holding the item — 7.59 MB of copies across the actors
 * pack, of which 133 KB was distinct — where a link is 60 bytes and always
 * current. The two passes derive the target from the note's own id, so neither
 * has to see the other's output; both split the *converted* markdown, so an H1
 * carrying a wikilink names the same page on both sides.
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
export function itemDescription(markdown, fm, name) {
    if (!String(markdown).trim()) return "";
    const [leadPage] = splitPages(markdown, name);
    const pageId = journalPageId(itemDocEntryId(fm.id), leadPage, 0);
    return itemDocPointer(foundryPackageId(), fm.id, name, pageId);
}

/**
 * The Item compile pass of one game system.
 *
 * A subclass declares its {@link SystemItemCompiler.documentSubtypes} and, if
 * its system writes any, the {@link SystemItemCompiler#commonSystem} keys. It
 * declares nothing else: the class is abstract only in the sense that a map is
 * required, and instantiating it without one is a programming error rather than
 * a configuration one.
 */
export class SystemItemCompiler extends BasePackCompiler {
    static id = "items";
    static label = "item";

    /**
     * An Item **is** a system's data, so this pack takes only notes carrying
     * this system's block (#58).
     */
    static requiresSystemBlock = true;

    /**
     * The note-type → document-subtype map this pass compiles against.
     *
     * Stated by the class rather than reached for through a module import, so
     * every decision the pass makes — which notes it claims, which subtype each
     * becomes, which registry builds it, which block it reads — reads one
     * declaration. A second system replaces that declaration and nothing else.
     *
     * @type {import("./document-subtypes.mjs").DocumentSubtypeMap|undefined}
     */
    static documentSubtypes = undefined;

    /**
     * The frontmatter block this pass reads, and the registry it addresses.
     *
     * @returns {string} The system's block name.
     */
    get system() {
        const map = /** @type {typeof SystemItemCompiler} */ (this.constructor).documentSubtypes;
        if (!map) {
            throw new Error(
                `${this.constructor.name} declares no \`documentSubtypes\` — an ` +
                    `Item pass reads its system's map to know which notes it ` +
                    `claims and what each becomes.`,
            );
        }
        return map.block;
    }

    /**
     * How many of each item type this pass wrote, for the summary. Every type
     * is present from the start so the tally reads as a census of the
     * whitelist rather than of what happened to compile.
     *
     * @type {Record<string, number>}
     */
    counts = Object.fromEntries([...itemTypes()].map((t) => [t, 0]));

    /**
     * Every content type that compiles into an item **for this system**.
     *
     * The whitelist is the consuming repository's `itemBuilders` keys (#1504),
     * and the system's own map is a second filter on top of it: a type this
     * system maps onto some *other* document class is not an item however a
     * registry spells it, which is the "no wrongly-typed document" half of #79.
     * A type the map does not name at all is left to the registry — see
     * {@link SystemItemCompiler#itemSubtype}.
     *
     * @param {object} fm - The note's frontmatter.
     * @returns {boolean} True for a whitelisted item type.
     */
    selects(fm) {
        if (!fm.type || !itemTypes().has(fm.type)) return false;
        const map = /** @type {typeof SystemItemCompiler} */ (this.constructor).documentSubtypes;
        const row = subtypeRow(/** @type {never} */ (map), fm.type);
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
     * refusing it here would silently drop every document of a type this system
     * has no opinion about (#7/#1563).
     *
     * @param {object} fm - The note's frontmatter.
     * @returns {string} The document's `type`.
     */
    itemSubtype(fm) {
        const map = /** @type {typeof SystemItemCompiler} */ (this.constructor).documentSubtypes;
        const declared = documentSubtype(/** @type {never} */ (map), fm.type, fm, {
            absPath: this.currentNote?.absPath,
        });
        return declared ?? fm.type;
    }

    /** An item is named by its own type in the log, not by "item". */
    noteLabel(fm) {
        return fm.type;
    }

    /**
     * The `system` keys this system's compiler writes on **every** item, beside
     * whatever the type's declared fields emit.
     *
     * Nothing by default, which is the honest position for a system that has
     * not said otherwise: a key written here lands on every document of every
     * type, so inventing one that the receiving DataModel does not declare
     * would be a finding on the whole pack (#155).
     *
     * @param {object} fm - The note's frontmatter.
     * @param {object} at - What the pass already knows about this note.
     * @param {string} at.description - The pointer to the note's item doc.
     * @param {string} at.markdown - The note body, tables expanded and
     *   wikilinks resolved, for a system that reads an anchored section out of
     *   it.
     * @param {string} at.label - Human-readable context for error messages.
     * @returns {object} The shared `system` fields.
     */
    // eslint-disable-next-line no-unused-vars
    commonSystem(fm, { description, markdown, label }) {
        return {};
    }

    /**
     * Construct the full compendium envelope for one item.
     *
     * @param {object} fm - The note's frontmatter.
     * @param {string} markdown - The body, tables expanded and wikilinks
     *   resolved.
     * @returns {object} The item document, keyed for the pack.
     */
    buildEntry(fm, markdown) {
        const system = this.system;
        const type = fm.type;
        const name = resolveName(fm);
        const description = itemDescription(markdown, fm, name);
        const id = fm.id;
        const subType = this.itemSubtype(fm);
        const built = {
            ...this.commonSystem(fm, { description, markdown, label: `item "${name}"` }),
            ...itemBuilder(type, system)(fm),
        };
        // Whatever the note authors under `<system>.system`, at the DataModel's
        // own paths. A path a declared field already writes is left to that
        // field: its value came from the same authored place and went through
        // the field's own coercion (#58).
        mergeSystemData(built, fm, {
            block: system,
            claimed: claimedPaths(itemFields(type, system)),
        });
        this.reportUndeclaredSystemData(fm, system, "Item", subType);
        // And what *this* pass wrote on its own initiative, which no field
        // declaration states and so no other check can see (#155). Read off the
        // assembled block, so a key added to `commonSystem` is checked without
        // anyone remembering to list it.
        this.reportEmittedSystemData(built, {
            fm,
            block: system,
            documentType: "Item",
            subType,
            type,
            fields: itemFields(type, system),
        });

        const effects = blockProperty(fm, system, "effects");
        // Read through the system block like every other item field, so both
        // spellings work wherever a note already writes one. `packFolder` is a
        // path and `folder` an id; which it is comes from the field, never from
        // the string (#251).
        const packFolderPath = blockField(fm, system, "packFolder", null);
        const folder =
            packFolderPath ?
                this.folderResolver(packFolderPath, { isPath: true })
            :   this.folderResolver(blockField(fm, system, "folder", null));

        return {
            name,
            // The note's `type` addresses the builder and the default art —
            // both registries are keyed by content type — while the document's
            // own subtype comes from the system's map (#79).
            type: subType,
            // Nullish, not `||` (#218): `resolveImg` returns `null` for a
            // note that names no art and `""` for one that wants none, and only
            // the first may be replaced by the type's default.
            img: resolveImg(blockProperty(fm, system, "img")) ?? itemArt(type, system),
            _id: id,
            system: built,
            effects: Array.isArray(effects) ? [...effects] : [],
            // Whatever the note authors, and nothing else.
            flags: blockProperty(fm, system, "flags", {}),
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
