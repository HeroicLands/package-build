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
 * Scenes pack compiler — map notes in `assets/content/` → Foundry `Scene`
 * documents, and the `Adventure` bundles that make their pins resolve.
 *
 * A map note carries its Scene as exported from Foundry, at `data.scene`. The
 * build never constructs a Scene: {@link module:engine/exported-scene} passes
 * the export through, applying `data.fixup` and binding pins marked `#anchor`
 * to the note's own journal pages.
 *
 * **Two outputs, for two different jobs.**
 *
 * - The **`scenes` pack** holds every map note's Scene. It is what a wikilink
 *   to a map addresses, and what a GM browses.
 * - The **`adventures` pack** holds one Adventure per *place* — the map notes
 *   sharing a `data.place`, defaulting to the note's own shortcode — bundling
 *   those scenes with the JournalEntries their prose compiled into. A Scene
 *   whose pins open this note's pages **must** be imported this way:
 *   `Adventure#importContent` creates with `keepId: true`, and a pin's
 *   `Note.entryId` / `pageId` are id-based. Dragged out of the bare `scenes`
 *   pack, a pinned scene lands with pins pointing at ids no document in the
 *   world carries.
 *
 * Not a standalone script — exports the `Scenes` compiler class, imported and
 * driven by `engine/generate.mjs`.
 *
 * The walk itself — filtering by type, expanding tables, converting
 * wikilinks, writing the JSON and counting errors — belongs to
 * {@link sohl.utils.packs.BasePackCompiler}; this module states only what makes
 * this pass its own.
 */

import log from "loglevel";

import { folderField, resolveName, resolveImg } from "./helpers.mjs";
import { BasePackCompiler } from "./base-compiler.mjs";
// What an Adventure member may carry is one rule, and the module that owns the
// Adventure states it: the scenes pass bundles its pinned places, and the
// bundles pass compiles a note into one.
import { stripAdventureKeys } from "./bundle-notes.mjs";
import { buildJournalEntry } from "./journals.mjs";
import { isMapType, makeId } from "./ids.mjs";
import { renderAddress } from "./address.mjs";
import { itemDocEntryId } from "./item-docs.mjs";
import { artPathname, pathnameRoles } from "./art-fields.mjs";
import { buildExportedScene } from "./exported-scene.mjs";

/**
 * Scenes pack compiler.
 *
 * Compiles every map note's exported Scene, and writes one Adventure per place
 * whose scenes carry pins, bundling those scenes with the JournalEntries their
 * prose compiled into.
 */
export class Scenes extends BasePackCompiler {
    static id = "scenes";
    static label = "map";

    /**
     * A map's Scene is exported from Foundry and names its own art, so no art
     * slot a note authors reaches it.
     *
     * @type {readonly string[]}
     */
    static emitsArt = Object.freeze([]);

    /** @type {string} */
    adventureDir;

    /**
     * Adventures this pass bundled, for the summary.
     *
     * @type {number}
     */
    adventureCount = 0;

    constructor({
        contentBase,
        assetsBase,
        dest,
        skipDirectories,
        companionDests = {},
        folderResolver = () => null,
        packName,
        corpus,
    }) {
        super({ contentBase, assetsBase, dest, folderResolver, skipDirectories, packName, corpus });
        if (!companionDests.adventures) {
            throw new Error("Scenes compiler requires an `adventures` companion destination");
        }
        Object.defineProperty(this, "adventureDir", {
            value: companionDests.adventures,
            writable: false,
        });
    }

    /**
     * @param {object} fm - The note's frontmatter.
     * @returns {boolean} True for a map note.
     */
    selects(fm) {
        return isMapType(fm.type);
    }

    /**
     * Start each compile with no places accumulated.
     *
     * @returns {Promise<void>}
     */
    async prepare() {
        await super.prepare();
        /** place key → `{key, name, scenes: [], journal: [], pinned}` */
        this.places = new Map();
    }

    /**
     * Compile one map note's exported Scene, and accumulate the place it
     * belongs to — a map's Scene and the JournalEntry its prose compiles into
     * ship together in an Adventure, which is the only import that preserves
     * the ids its pins address.
     *
     * @param {object} fm - The note's frontmatter.
     * @param {string} markdown - The body, tables expanded and wikilinks
     *   resolved.
     * @returns {object} The Scene document.
     */
    compileNote(fm, markdown) {
        const name = resolveName(fm);
        const hasBody = Boolean(String(markdown).trim());
        // The markdown this pass reads has already had its embeds rewritten
        // into ordinary images, each `src` the pathname `pathnameRoles` keys
        // its roles by — see {@link module:engine/journals.Journals#buildEntry},
        // which derives this same journal's pages the same way.
        const roles = pathnameRoles(this.linkIndex);
        const resolveRole = (pathname) => roles.get(pathname);
        // The same doc-entry id the journals pass derives, from the shared
        // `docEntryTypes` arrangement — so neither pass has to read the
        // other's output.
        const entryId = hasBody ? itemDocEntryId(fm.id) : undefined;
        const scene = buildExportedScene(fm, markdown, {
            journalEntryId: entryId,
            stats: this.stats,
            resolveAddress: (address) => {
                const result = artPathname(this.linkIndex, address, "image");
                if (!result.resolved || !result.pathname) {
                    throw new Error(
                        `Scene fixup address "${address}" cannot resolve to an asset: ${result.reason ?? "no pathname"}`,
                    );
                }
                return resolveImg(result.pathname);
            },
        });
        this.writeEntry(scene);

        // The journal the pins point at, derived here exactly as the journals
        // pass derives it, so the Adventure bundles the same document that
        // pack ships.
        const { value: authoredFolder } = folderField(fm);
        const journal =
            hasBody ?
                buildJournalEntry({
                    id: entryId,
                    name,
                    markdown,
                    leadName: name,
                    resolveRole,
                    // As in the journals pass: an address resolves in the pack
                    // that emits it, which is what makes the folder
                    // materialise there too.
                    folder: this.folderResolver(authoredFolder, { isAddress: true }),
                })
            :   null;

        // The compile hands `data.place` over as its resolved Address, and the
        // rendered form keys the place.
        const place = fm.data?.place;
        const placeKey =
            place && typeof place === "object" && place.type && place.shortcode ?
                renderAddress(place)
            : typeof place === "string" && place ? place
            : fm.shortcode;
        if (!this.places.has(placeKey)) {
            this.places.set(placeKey, {
                key: placeKey,
                // Named after the first map of the place to compile.
                name,
                pinned: false,
                scenes: [],
                journal: [],
            });
        }
        const entry = this.places.get(placeKey);
        entry.scenes.push(stripAdventureKeys(scene));
        if (journal) entry.journal.push(stripAdventureKeys(journal));
        if (Array.isArray(scene.notes) && scene.notes.length) entry.pinned = true;
        return scene;
    }

    /**
     * Bundle each pinned place into an Adventure, once every map of it has
     * compiled.
     *
     * @returns {Promise<void>}
     */
    async finish() {
        this.adventureCount = 0;
        for (const place of this.places.values()) {
            // A scene that references nothing ships fine as a plain `scenes`
            // entry; only pins need the id-preserving import an Adventure gives.
            if (!place.pinned) continue;
            this.writeTo(this.adventureDir, this.#buildAdventure(place));
            this.adventureCount++;
        }
    }

    /** @inheritdoc */
    reportCompiled(stats) {
        log.info(`Compiled ${stats.compiled} scene(s) and ${this.adventureCount} adventure(s)`);
    }

    /**
     * Bundle one place's scenes and journals into an Adventure.
     *
     * @param {object} place - The accumulated place.
     * @returns {object} The Adventure document, keyed for the pack.
     */
    #buildAdventure(place) {
        const id = makeId("map-adventure", place.key);
        return {
            name: place.name,
            img: null,
            caption: "",
            description: "",
            actors: [],
            combats: [],
            items: [],
            journal: place.journal,
            scenes: place.scenes,
            tables: [],
            macros: [],
            cards: [],
            playlists: [],
            folders: [],
            folder: null,
            sort: 0,
            flags: {},
            _id: id,
            _stats: this.stats,
            _key: `!adventures!${id}`,
        };
    }
}
