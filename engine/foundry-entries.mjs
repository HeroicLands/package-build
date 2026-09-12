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
 * Emitting this package's cross-package link manifest.
 *
 * `engine/content-address.mjs` owns the address *grammar* — how a key is
 * version is read, how a foreign file resolves. This module owns the *pass*:
 * walking a content tree and deriving, for every note it publishes, the
 * addresses that entry states. The two halves were split across the format
 * module and a hand-written script in each consuming repository, which is how
 * the two scripts came to differ in ways nobody chose — one routes its UUIDs
 * through the pack router and one does not, and neither knew.
 *
 * **The base is not an input.** Both scripts built a site-absolute URL and
 * handed {@link buildManifest} the base it was built from, whose first act is
 * to strip that same prefix back off; the value never reached the file. So
 * nothing here composes one. An address is derived package-relative from the
 * start, by {@link packageAddress}, and the emitting build's mount point is not
 * a fact it has to be told.
 *
 * **An entry's `path` is derivable from the key it is filed under**.
 * `sohl-sohl-affliction-aconite` publishes at `affliction-aconite/` — the key
 * with its package and system segments dropped — because a page's URL *is* its
 * address; nothing in it comes from a display name, so a rename moves no URL and
 * no uniqueness check stands between the two. The system segment goes with the
 * package because a note publishes one page however many systems' documents it
 * compiles into. Every entry is
 * derivable that way since #204 retired the section landing, which was the one
 * that was not. The field is still written rather than left for a consumer to
 * compute, because an absent `path` already means something else entirely (a
 * package that publishes no pages).
 *
 * **The address is derived by one function, shared with the site build.** An
 * address is `(type, shortcode)` in both, so a manifest cannot assert an address
 * the site does not publish — the failure that resolves at build time and 404s
 * for the reader.
 *
 * **Anchors are computed, not approximated.** The pass that splits a note into
 * journal pages is {@link splitPages}, a pure function over the markdown body,
 * so running it costs a parse and no I/O. Both scripts already ran it. An entry
 * that silently lost its anchors would degrade every cross-package section link
 * in every consumer, so there is no mode in which they are skipped.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { canonicalKey, packageAddress } from "./content-address.mjs";
import { NO_SYSTEM, systemOf } from "./document-subtypes.mjs";
import {
    KNOWN_DOCUMENT_SUBTYPE_MAPS,
    NEVER_PACKED_TYPES,
    DERIVED_PACKED_TYPES,
} from "./note-claims.mjs";
import { walkMarkdownTree } from "./helpers.mjs";
import { resolveNoteId } from "./note-ids.mjs";
import { compendiumUuid, currentType, packForType, pageUuid } from "./ids.mjs";
import { hasDocEntry, itemDocEntryId } from "./item-docs.mjs";
import { isHomepage } from "./homepage.mjs";
import { assertNoDeclaredPackage } from "./note-package.mjs";
import { assertNoDeclaredFolder } from "./folder-notes.mjs";
import {
    assertNoAliasesField,
    assertNoDraftField,
    assertNoSectionField,
    assertNoTraitsField,
} from "./retired-fields.mjs";
import { journalPageId, splitPages } from "./journals.mjs";
import { routerFor } from "./pack-router.mjs";
import { loadPackConfig } from "./pack-config.mjs";
import { publishesContentPages } from "../content-config.mjs";

/**
 * The reserved anchor name for a journal's **first** page.
 *
 * Every journal has one and it is what an item's `docHtml` points at, but it
 * carries no authored `{#slug}` — so without a reserved name the one page that
 * always exists would be the one page the manifest could not address. It cannot
 * collide with an authored slug, which is `[a-z0-9-]+`.
 */
export const LEAD_ANCHOR = "$lead";

/**
 * Every page of a note's journal, as `anchorName → whole UUID`.
 *
 * Whole, not a fragment appended to the entry's UUID: nothing owns a page
 * address, so a complete link restates no fact, and it keeps the page-id hash
 * out of the published contract entirely — a consumer resolves
 * `[[docaffliction-aconite#crafting]]` with a lookup instead of reimplementing
 * a sha256/base64/truncate rule.
 *
 * @param {string} entryUuid - The journal entry's UUID.
 * @param {string} entryId - The entry's id, which page ids hash against.
 * @param {string} body - The note's markdown body.
 * @param {string} name - The note's name, used as the lead page's title.
 * @returns {Record<string, string>} The anchors.
 */
export function anchorsOf(entryUuid, entryId, body, name) {
    const anchors = {};
    splitPages(body, name).forEach((page, index) => {
        const uuid = pageUuid(entryUuid, journalPageId(entryId, page));
        if (index === 0) anchors[LEAD_ANCHOR] = uuid;
        if (page.anchorSlug) anchors[page.anchorSlug] = uuid;
    });
    return anchors;
}

/**
 * The manifest entries a single note produces.
 *
 * An item note produces **two**: the item, and separately the JournalEntry its
 * prose compiles into. They are two documents with two UUIDs, so they get two
 * addresses; the item's entry points at the other by address rather than
 * repeating its UUID, because the doc entry owns that fact. A `macro`
 * note is the same arrangement, which is why the type set comes from
 * {@link hasDocEntry} rather than being spelled here — the journals compiler
 * reads the same one, so a manifest cannot claim documentation nothing compiled.
 *
 * @param {object} fm - Parsed frontmatter.
 * @param {string} name - The note's display name.
 * @param {string} address - The note's package-relative address.
 * @param {string} body - The note's markdown body.
 * **Each entry carries the `id` of the document it addresses**, not only its
 * UUID. The two are one fact — a UUID ends in the id — but only the entry knows
 * which derivation produced it: an item's is its note's `fm.id`, and its
 * documentation journal's is {@link itemDocEntryId} of that. Stating it here is
 * what lets the content index publish an identity it did not re-derive.
 *
 * @param {object} ctx - Resolved identities: `{ contentPackage,
 *   foundryPackageId, packRouter }`.
 * @returns {Array<object>} One or two entries, in {@link buildManifest}'s shape.
 */
export function entriesForNote(fm, name, address, body, ctx) {
    const { contentPackage, foundryPackageId, packRouter } = ctx;
    const key = canonicalKey(
        contentPackage,
        systemOf(fm.type, KNOWN_DOCUMENT_SUBTYPE_MAPS),
        fm.type,
        fm.shortcode,
    );
    // `buildManifest` records `packageRelative(url, base)`, so the pair it is
    // given has to round-trip. The address is already package-relative, so the
    // honest pair is the address under a base of `"/"` — which strips straight
    // back off. Composing a real mount point here and removing it again is what
    // the two consumer scripts did, and the value provably never reached the
    // file.
    const url = `/${address}`;

    // A published address must name the pack the document actually shipped in:
    // a consumer resolves the UUID verbatim, and a repository may ship several
    // packs of one type.
    const uuidFor = (type, id, routeFm) =>
        // A type this cannot name a single compendium document for has no UUID
        // to publish, whatever id it derives. That used to follow from such a
        // note authoring no `id:`; since #270 every addressable note derives
        // one, so "has an id" stopped being evidence a document exists and the
        // rule is stated where it belongs — beside the addresses — rather than
        // resting on an absent field. `collectFoundryEntries` skips such a note
        // outright; the content index calls this function directly, so the
        // guard has to live on this side of it.
        //
        // Two sets, for opposite reasons (see `note-claims.mjs`). A **homepage**
        // is in no pack: it compiles to a page and there is nothing to address.
        // A **folder** may be in several — it materialises in every pack holding
        // a document that references it — so no one UUID identifies it,
        // and its id is hashed under the `folder` namespace against its own
        // address rather than under `document`. Emitting one would publish an
        // `Item` UUID for a `Folder`, at an id no document carries.
        id && !NEVER_PACKED_TYPES.has(String(type)) && !DERIVED_PACKED_TYPES.has(String(type)) ?
            compendiumUuid(
                foundryPackageId,
                type,
                id,
                routeFm ?
                    packRouter.resolveOrNull(routeFm, packForType(type).docType)
                :   packRouter.defaultOf("JournalEntry"),
            )
        :   undefined;

    const carriesDoc =
        ctx.docEntryTypes ?
            ctx.docEntryTypes.has(String(currentType(fm.type)))
        :   hasDocEntry(fm.type);
    if (carriesDoc) {
        // `NO_SYSTEM`, whatever the item is: a documentation journal is a
        // JournalEntry, which no game system defines, and there is one of them
        // however many system blocks the note carries.
        const docKey = canonicalKey(contentPackage, NO_SYSTEM, `doc${fm.type}`, fm.shortcode);
        const docEntryId = fm.id ? itemDocEntryId(fm.id) : undefined;
        const docUuid = uuidFor("doc", docEntryId);
        return [
            {
                key,
                fm,
                name,
                url,
                id: fm.id,
                uuid: uuidFor(fm.type, fm.id, fm),
                doc: docKey,
            },
            {
                key: docKey,
                fm,
                name,
                // On the web the item note renders as one page which *is* its
                // documentation, so both addresses resolve to the same URL.
                url,
                // The journal's **own** id, which is not the item's: the
                // content index publishes it beside the UUID, so an entry the
                // index gives an identity to states both halves of it rather
                // than leaving a consumer to parse the id back out of the
                // UUID's last segment.
                id: docEntryId,
                uuid: docUuid,
                anchors: docUuid ? anchorsOf(docUuid, docEntryId, body ?? "", name) : undefined,
            },
        ];
    }

    // Everything else is one document. A `doc` note compiles into a journal in
    // its own right, so its anchors sit on its own entry.
    const own = uuidFor(fm.type, fm.id, fm);
    return [
        {
            key,
            fm,
            name,
            url,
            id: fm.id,
            uuid: own,
            anchors: own && fm.type === "doc" ? anchorsOf(own, fm.id, body ?? "", name) : undefined,
        },
    ];
}

/**
 * Every note this package publishes, as manifest entries.
 *
 * Every note in the tree is this package's, so nothing here selects by package:
 * the key's first segment is `contentPackage`. A note still declaring the
 * retired `package:` or `draft:` field **throws** rather than being skipped —
 * skipping one silently is how a whole tree came to be filtered out of a
 * manifest that then claimed the package published nothing, and it is what let
 * a drafted note's inbound links look like links to a note that never existed.
 *
 * A note that has no address is **reported, not guessed** — the finding carries
 * the file and the reason, so a caller can print it or fail on it. Inventing an
 * address would put an entry in the manifest asserting a page that does not
 * exist.
 *
 * @param {string} contentBase - Absolute path to the content tree.
 * @param {object} ctx - `{ contentPackage, foundryPackageId, packRouter }`.
 * @returns {{entries: Array<object>, notes: number,
 *   skipped: Array<{file: string, reason: string}>}}
 */
export function collectFoundryEntries(contentBase, ctx) {
    const entries = [];
    const skipped = [];
    // Counted separately because they are genuinely different numbers: an item
    // note yields two entries, so reporting one as the other overstates how
    // much of the tree is published.
    let notes = 0;
    for (const { frontmatter: fm, body, absPath } of walkMarkdownTree(contentBase, {
        skipDirectories: ctx.skipDirectories,
    })) {
        if (!fm) continue;
        // Its authored pin, or the id derived from its canonical address.
        // Resolved before anything reads `fm.id`, so the UUID this
        // pass publishes is the one the pack passes compiled under.
        resolveNoteId(fm, { pkg: ctx.contentPackage });
        const rel = path.relative(contentBase, absPath);
        assertNoDeclaredPackage(fm, {
            file: rel,
            absPath,
            configured: ctx.contentPackage,
        });
        assertNoDeclaredFolder(fm, { file: rel, absPath });
        assertNoDraftField(fm, { file: rel, absPath });
        assertNoAliasesField(fm, { file: rel, absPath });
        assertNoSectionField(fm, { file: rel, absPath });
        assertNoTraitsField(fm, { file: rel, absPath });
        if (!fm.type || !fm.shortcode) continue;
        // A homepage is addressed like every other note since #182, and a
        // shortcode alone would now put it here. It stays out for the reason it
        // always did, which that change does not touch: a manifest entry is how
        // another package resolves a **document**, and a homepage compiles into
        // none — the same ground `id` is refused on. A cross-package link to a
        // package's front page is its bare `/<package>/` address, which needs
        // no index.
        if (isHomepage(fm)) continue;

        const name = fm.name?.full ?? path.basename(absPath, ".md");

        let address;
        try {
            address = packageAddress(fm);
        } catch (err) {
            skipped.push({ file: rel, reason: err.message });
            continue;
        }
        notes += 1;
        entries.push(...entriesForNote(fm, name, address, body ?? "", ctx));
    }
    return { entries, notes, skipped };
}

/**
 * The identities an emission runs against, from configuration.
 *
 * Resolved in one place and passed down, rather than read at each use, so the
 * pass itself is a pure function of its context and a test can drive it without
 * standing up a configuration.
 *
 * @param {object} [config] - A resolved configuration; loaded when omitted.
 * @returns {{contentPackage: string, foundryPackageId: string, packRouter: object,
 *   web: boolean, skipDirectories: readonly string[]}}
 */
export function foundryIdentities(config = loadPackConfig()) {
    return {
        contentPackage: config.contentPackage,
        foundryPackageId: config.foundryPackage,
        packRouter: routerFor(config),
        // Carried in the context rather than read from the global config at the
        // call site, so the pass really is a pure function of what it is handed
        // — which is what lets the content index drive the same derivation with
        // a configuration it resolved itself.
        docEntryTypes: config.docEntryTypes,
    };
}

/**
 * The identities an emission runs against, from configuration.
 *
 * {@link foundryIdentities} plus what only a *manifest* emission needs. The
 * split is what lets the content index derive the same Foundry addresses from
 * the same code without also depending on whether the package publishes pages,
 * which is no part of a UUID.
 *
 * @param {object} [config] - A resolved configuration; loaded when omitted.
 * @returns {{contentPackage: string, foundryPackageId: string, packRouter: object,
 *   web: boolean, skipDirectories: readonly string[]}}
 */
export function entryContext(config = loadPackConfig()) {
    return {
        ...foundryIdentities(config),
        web: publishesContentPages(config),
        // The walk's own configuration, threaded through rather than left to
        // its default, so a caller that passes a config drives every read.
        skipDirectories: config.skipDirectories,
    };
}
