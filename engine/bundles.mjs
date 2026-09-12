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
 * Adventure pack compiler — `type: bundle` notes → Foundry `Adventure`
 * documents.
 *
 * The specification and the vocabulary leave the type
 * declared and uncompiled: authoring one said so, in as many words. This is the
 * pass, and the two decisions it records are settled here.
 *
 * **Which pack.** Not the `adventures` **companion**. The scenes pass already
 * writes one Adventure per pinned place into that pack, and a companion is
 * written by another pass's pass — the router refuses a note that names one in
 * `pack:`, and it is right to. So a bundle lands in an ordinary Adventure pack,
 * routed and defaulted exactly as items and actors are, and the place-adventures
 * companion is left alone. A repository that authors bundles declares an
 * Adventure pack of its own; one that does not is told so by name, because
 * `bundle` is in `PACK_BY_TYPE` and the unclaimed-note check reads it.
 *
 * **What a `contents` address names: the note's own document.** That is already
 * the router's rule for `pack:`, so there is one answer and not two. One note
 * can compile into two documents — an item and the JournalEntry its prose
 * became — and the second is bundled only when the note names it by its own
 * `doc…` address, which is the address that already exists for it.
 * Nothing is inferred: naming `miscgear-bowlcer` puts the *item* in the bundle
 * and not its description page.
 *
 * **An Adventure holds copies, not references**, so `contents` resolves against
 * *compiled output* rather than against the content tree. That makes this pass
 * a reader of every other one, which it states in
 * {@link Bundles.readsPackOutputOf} rather than leaving to the order a
 * consumer happened to write its pack list in — the generator derives the
 * compile order from that declaration.
 *
 * **A pack's `system:` constrains what its Adventures may hold.** An
 * `Adventure` has no `system` field, so a bundle spanning two systems cannot be
 * one document that knows it spans them: it is one Adventure per system, and
 * the pack each is written to is what carries the system. Which packs a note
 * reaches is the shared routing field — `<system>.pack` overrides the top-level
 * `pack:` for that system, as everywhere else — and a document belonging to
 * neither `none` nor the pack's system is **left out rather than failing**,
 * with a warning naming it so the omission is never silent.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { BasePackCompiler } from "./base-compiler.mjs";
import {
    BUNDLE_TYPE,
    buildAdventure,
    bundleContents,
    missingMemberVerdict,
} from "./bundle-notes.mjs";
import { contentPackage } from "./content-package.mjs";
import { FOLDER_TYPE } from "./folder-notes.mjs";
import { HOMEPAGE_TYPE } from "./homepage.mjs";
import { itemDocEntryId } from "./item-docs.mjs";
import { folderField, md, resolveImg, resolveName } from "./helpers.mjs";
import { packForType } from "./ids.mjs";
import { readQualifier } from "./wikilinks.mjs";

/**
 * Load every compiled document a bundle may hold, keyed `<docType>/<id>`.
 *
 * Keyed by id rather than by address because that is what the note resolves to:
 * an address names a note, the note's id is derived once by `resolveNoteId`,
 * and every pass files its document under it. Matching on the id is therefore
 * an identity check rather than a second derivation that could disagree with
 * the first.
 *
 * A **folder** document is skipped. It is emitted into every pack that holds
 * something filed in it, so it is not one pack's document and has no
 * single note behind it; a bundle that wants folders is a question this pass
 * refuses rather than guesses at — see {@link Bundles#resolveAddress}.
 *
 * @param {Readonly<Record<string, readonly string[]>>} sourceDirs - The JSON
 *   directories of every pack whose output may be bundled, by document type.
 * @returns {Map<string, object>} The compiled documents.
 * @throws {Error} When a declared directory does not exist — the generator
 *   orders this pass last, so what reaches this is a run restricted to one
 *   pack, which reordering cannot fix.
 */
export function loadBundleSources(sourceDirs) {
    /** @type {Map<string, object>} */
    const documents = new Map();
    for (const [docType, dirs] of Object.entries(sourceDirs ?? {})) {
        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                throw new Error(
                    `Bundle source directory ${dir} does not exist — an ` +
                        `Adventure holds copies of compiled documents, so the ` +
                        `${docType} packs must be compiled before this one`,
                );
            }
            for (const name of fs.readdirSync(dir)) {
                if (!name.endsWith(".json")) continue;
                // A folder document is written per pack, not per note.
                if (name.startsWith("folder_")) continue;
                const doc = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
                if (!doc?._id) continue;
                documents.set(`${docType}/${doc._id}`, doc);
            }
        }
    }
    return documents;
}

export class Bundles extends BasePackCompiler {
    static id = "bundles";
    static label = "bundle";

    /**
     * Every document type a bundle can hold a copy of.
     *
     * The declaration the generator orders passes by: an Adventure holds
     * *compiled* documents, so every pass that produces one runs first. Stated
     * here, in the class that does the reading, rather than in each consuming
     * repository's pack list.
     *
     * @type {readonly string[]}
     */
    static readsPackOutputOf = Object.freeze(["Actor", "Item", "JournalEntry", "Macro", "Scene"]);

    /**
     * An Adventure carries an `img` — what Foundry shows on the import card.
     * There is no default for it: a bundle naming none ships a blank tile,
     * deliberately, since no stand-in artwork means "a set of documents".
     *
     * @type {readonly string[]}
     */
    static emitsArt = Object.freeze(["img"]);

    /**
     * The JSON directories this pass reads its members from, by document type.
     *
     * @type {Readonly<Record<string, readonly string[]>>}
     */
    bundleSourceDirs;

    /**
     * @param {object} options - As {@link BasePackCompiler}, plus:
     * @param {Record<string, readonly string[]>} [options.bundleSourceDirs] -
     *   Each bundleable pack's JSON tree, by document type. Supplied by the
     *   generator from the configured pack list, so the dependency is stated
     *   rather than assumed from a sibling directory.
     */
    constructor({ bundleSourceDirs = {}, ...options }) {
        super(options);
        Object.defineProperty(this, "bundleSourceDirs", {
            value: Object.freeze(
                Object.fromEntries(
                    Object.entries(bundleSourceDirs).map(([type, dirs]) => [
                        type,
                        Object.freeze([...dirs]),
                    ]),
                ),
            ),
            writable: false,
        });
    }

    /**
     * @param {object} fm - The note's frontmatter.
     * @returns {boolean} True for a bundle note.
     */
    selects(fm) {
        return fm.type === BUNDLE_TYPE;
    }

    /** @inheritdoc */
    async prepare() {
        await super.prepare();
        this.members = loadBundleSources(this.bundleSourceDirs);
    }

    /**
     * The document one address in `contents` names.
     *
     * The address alone, resolved against the content tree — whether this pack
     * actually *holds* that document is the caller's question, and the answer
     * to it is what the system rule turns on.
     *
     * @param {string} address - One bare address from `contents`.
     * @param {string} bundleName - The bundle, for the message.
     * @returns {{docType: string, id: string, name: string}} The document the
     *   address names.
     * @throws {Error} When the address names nothing this build compiles.
     */
    resolveAddress(address, bundleName) {
        const index = this.linkIndex;
        const read = readQualifier(address, index.types, index.packages);
        if (!read || read.reason) {
            throw new Error(
                `bundle "${bundleName}" lists "${address}", which is not an ` +
                    `address — a member is named "<type>-<shortcode>", the ` +
                    `same form a wikilink uses`,
            );
        }
        // A member is a *copy*, so it has to be a document this build compiled.
        // A foreign package's address resolves to a UUID and to no JSON, which
        // is a different fact from a typo and is worth its own sentence.
        if (read.package && read.package !== contentPackage()) {
            throw new Error(
                `bundle "${bundleName}" lists "${address}", which belongs to ` +
                    `package "${read.package}" — an Adventure carries copies ` +
                    `of compiled documents, so a bundle can only hold this ` +
                    `package's own`,
            );
        }
        if (read.type === FOLDER_TYPE) {
            throw new Error(
                `bundle "${bundleName}" lists the folder "${address}". A ` +
                    `folder is not a member: it materialises in every pack ` +
                    `holding something filed in it, so it belongs to no ` +
                    `one pack and there is no single copy to bundle. List the ` +
                    `documents instead`,
            );
        }
        if (read.type === HOMEPAGE_TYPE || read.type === BUNDLE_TYPE) {
            throw new Error(
                `bundle "${bundleName}" lists "${address}", a ${read.type} — ` +
                    `which compiles into no document an Adventure can hold`,
            );
        }

        const note = index.byShortcode.get(`${read.type}/${read.shortcode}`);
        if (!note) {
            throw new Error(
                `bundle "${bundleName}" lists "${address}", which no note in ` +
                    `this tree publishes`,
            );
        }

        // The note's own document, which is the router's rule for `pack:` too.
        // Its documentation journal is a second document with a second address,
        // and is bundled only when the note names that one.
        const docType = read.itemDoc ? "JournalEntry" : packForType(read.type).docType;
        const id = read.itemDoc ? itemDocEntryId(note.id) : note.id;

        return { docType, id, name: note.name ?? address };
    }

    /**
     * One bundle note → one Adventure holding copies of what it names.
     *
     * @param {object} fm - The note's frontmatter.
     * @param {string} markdown - The body, tables expanded and wikilinks
     *   resolved.
     * @returns {object} The Adventure document.
     */
    buildEntry(fm, markdown) {
        const name = resolveName(fm);
        const { value: authoredFolder, isAddress: folderIsAddress } = folderField(fm);
        /** @type {Array<{docType: string, document: object}>} */
        const contents = [];

        for (const address of bundleContents(fm)) {
            const member = this.resolveAddress(address, name);
            const document = this.members.get(`${member.docType}/${member.id}`);
            if (!document) {
                // Another system's document, or none at all — and which it is
                // depends on whether this pack has a system to have scoped it
                // away. See `missingMemberVerdict`.
                if (missingMemberVerdict(this.packSystem) === "omit") {
                    this.noteWarn(
                        `bundle "${name}" leaves out "${address}": it publishes ` +
                            `no ${this.packSystem} ${member.docType}, and pack ` +
                            `"${this.packName}" declares ` +
                            `\`system: ${this.packSystem}\``,
                    );
                    continue;
                }
                throw new Error(
                    `bundle "${name}" lists "${address}", which resolves to ` +
                        `${member.docType} ${member.id} — and no compiled ` +
                        `${member.docType} pack holds it. The note publishes ` +
                        `nothing into a pack this bundle can read`,
                );
            }
            contents.push({ docType: member.docType, document });
        }

        return buildAdventure({
            id: fm.id,
            name,
            // Foundry shows this on the import card, so a bundle without one is
            // a blank tile. `null` rather than a stand-in: there is no sensible
            // default artwork for "a set of documents".
            img: resolveImg(fm.img),
            // A bundle is something you hand someone, so its prose belongs on
            // the document itself — `Adventure.description` is an `HTMLField`
            // Foundry renders on the import card. That is why a bundle earns no
            // separate documentation journal the way an item does: the document
            // it compiles into already has somewhere to put the prose.
            description: markdown.trim() ? md.render(markdown) : "",
            folder: this.folderResolver(authoredFolder, { isAddress: folderIsAddress }),
            flags: fm.flags,
            stats: this.stats,
            contents,
        });
    }
}
