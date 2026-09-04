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
 * Emitting this package's cross-package link manifest (#58).
 *
 * `engine/kb-manifest.mjs` owns the *format* — what an entry may say, how a
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
 * a fact it has to be told (#1465).
 *
 * **An entry's `path` is derivable from the key it is filed under** (#181).
 * `sohl-affliction-aconite` publishes at `affliction-aconite/`, because a page's
 * URL *is* its address; nothing in it comes from a display name, so a rename
 * moves no URL and no uniqueness check stands between the two. The field is
 * still written rather than left for a consumer to compute, because a landing
 * page is the one entry that is not derivable — it addresses its section under
 * the configured mount — and because an absent `path` already means something
 * else entirely (a package that publishes no pages).
 *
 * **The address scheme is configuration, and it is shared with the site build.**
 * Where the content tree mounts inside the package and which note is a section's
 * landing page differ between repositories and are both load-bearing — `sohl`
 * records `kb/rules/` for the landing of its rules section and `thalorna`
 * records `affiliation/` for its own. Reading one setting here and in the page
 * emitter is what stops a manifest asserting an address the site does not
 * publish, which resolves at build time and 404s for the reader.
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

import { packageAddress } from "./content-address.mjs";
import { canonicalKey, writeManifests } from "./kb-manifest.mjs";
import { walkMarkdownTree } from "./helpers.mjs";
import { compendiumUuid, packForType, pageUuid } from "./ids.mjs";
import { hasDocEntry, itemDocEntryId } from "./item-docs.mjs";
import { isHomepage } from "./homepage.mjs";
import { assertNoDeclaredPackage } from "./note-package.mjs";
import {
    assertNoAliasesField,
    assertNoDraftField,
    assertNoSectionField,
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
        const uuid = pageUuid(entryUuid, journalPageId(entryId, page, index));
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
 * repeating its UUID, because the doc entry owns that fact (#1499). A `macro`
 * note is the same arrangement (#1514), which is why the type set comes from
 * {@link hasDocEntry} rather than being spelled here — the journals compiler
 * reads the same one, so a manifest cannot claim documentation nothing compiled.
 *
 * @param {object} fm - Parsed frontmatter.
 * @param {string} name - The note's display name.
 * @param {string} address - The note's package-relative address.
 * @param {string} body - The note's markdown body.
 * @param {object} ctx - Resolved identities: `{ contentPackage,
 *   foundryPackageId, packRouter }`.
 * @returns {Array<object>} One or two entries, in {@link buildManifest}'s shape.
 */
export function entriesForNote(fm, name, address, body, ctx) {
    const { contentPackage, foundryPackageId, packRouter } = ctx;
    const key = canonicalKey(contentPackage, fm.type, fm.shortcode);
    // `buildManifest` records `packageRelative(url, base)`, so the pair it is
    // given has to round-trip. The address is already package-relative, so the
    // honest pair is the address under a base of `"/"` — which strips straight
    // back off. Composing a real mount point here and removing it again is what
    // the two consumer scripts did, and the value provably never reached the
    // file.
    const url = `/${address}`;

    // A published address must name the pack the document actually shipped in:
    // a consumer resolves the UUID verbatim, and a repository may ship several
    // packs of one type (#1566).
    const uuidFor = (type, id, routeFm) =>
        id ?
            compendiumUuid(
                foundryPackageId,
                type,
                id,
                routeFm ?
                    packRouter.resolveOrNull(routeFm, packForType(type).docType)
                :   packRouter.defaultOf("JournalEntry"),
            )
        :   undefined;

    if (hasDocEntry(fm.type)) {
        const docKey = canonicalKey(contentPackage, `doc${fm.type}`, fm.shortcode);
        const docEntryId = fm.id ? itemDocEntryId(fm.id) : undefined;
        const docUuid = uuidFor("doc", docEntryId);
        return [
            {
                key,
                fm,
                name,
                url,
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
            uuid: own,
            anchors: own && fm.type === "doc" ? anchorsOf(own, fm.id, body ?? "", name) : undefined,
        },
    ];
}

/**
 * Every note this package publishes, as manifest entries.
 *
 * Every note in the tree is this package's, so nothing here selects by package:
 * the key's first segment is `contentPackage` (#56). A note still declaring the
 * retired `package:` or `draft:` field **throws** rather than being skipped —
 * skipping one silently is how a whole tree came to be filtered out of a
 * manifest that then claimed the package published nothing, and it is what let
 * a drafted note's inbound links look like links to a note that never existed
 * (#69).
 *
 * A note that has no address is **reported, not guessed** — the finding carries
 * the file and the reason, so a caller can print it or fail on it. Inventing an
 * address would put an entry in the manifest asserting a page that does not
 * exist.
 *
 * @param {string} contentBase - Absolute path to the content tree.
 * @param {object} ctx - `{ contentPackage, foundryPackageId, packRouter,
 *   scheme }`.
 * @returns {{entries: Array<object>, notes: number,
 *   skipped: Array<{file: string, reason: string}>}}
 */
export function collectManifestEntries(contentBase, ctx) {
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
        const rel = path.relative(contentBase, absPath);
        assertNoDeclaredPackage(fm, {
            file: rel,
            absPath,
            configured: ctx.contentPackage,
        });
        assertNoDraftField(fm, { file: rel, absPath });
        assertNoAliasesField(fm, { file: rel, absPath });
        assertNoSectionField(fm, { file: rel, absPath });
        if (!fm.type || !fm.shortcode) continue;
        // A homepage is addressed like every other note since #182, and a
        // shortcode alone would now put it here. It stays out for the reason it
        // always did, which that change does not touch: a manifest entry is how
        // another package resolves a **document**, and a homepage compiles into
        // none — the same ground `id` is refused on. A cross-package link to a
        // package's front page is its bare `/<package>/` address, which needs
        // no index.
        if (isHomepage(fm)) continue;

        const base = path.basename(absPath);
        const name = fm.name?.full ?? path.basename(absPath, ".md");

        let address;
        try {
            address = packageAddress(fm, {
                isReadme: base.toLowerCase() === "readme.md",
                scheme: ctx.scheme,
            });
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
 * The identities and scheme an emission runs against, from configuration.
 *
 * Resolved in one place and passed down, rather than read at each use, so the
 * pass itself is a pure function of its context and a test can drive it without
 * standing up a configuration.
 *
 * @param {object} [config] - A resolved configuration; loaded when omitted.
 * @returns {{contentPackage: string, foundryPackageId: string, packRouter: object,
 *   scheme: {prefix: string, landing: string}, web: boolean,
 *   skipDirectories: readonly string[]}}
 */
export function manifestContext(config = loadPackConfig()) {
    return {
        contentPackage: config.contentPackage,
        foundryPackageId: config.foundryPackage,
        packRouter: routerFor(config),
        scheme: config.publish.address,
        web: publishesContentPages(config),
        // The walk's own configuration, threaded through rather than left to
        // its default, so a caller that passes a config drives every read.
        skipDirectories: config.skipDirectories,
    };
}

/**
 * Emits this package's link manifest.
 *
 * One package, because a configuration declares exactly one `contentPackage`
 * and nothing in the surface can express a second. {@link writeManifests} keeps
 * its package→entries map — it is the general writer — but there is no setting
 * here to choose with.
 *
 * @param {object} [options] - Options.
 * @param {string} [options.contentBase] - The content tree; defaults to the
 *   configured `paths.content`.
 * @param {string} [options.outDir] - Where to write; defaults to the configured
 *   `paths.manifestOut`.
 * @param {object} [options.config] - A resolved configuration; loaded when
 *   omitted.
 * @returns {{written: Array<{package: string, file: string, count: number}>,
 *   entries: number, notes: number,
 *   skipped: Array<{file: string, reason: string}>}}
 * @throws {Error} When the repository does not declare that it publishes a
 *   manifest, when the tree is absent, or when it yields no published note — a
 *   manifest claiming this package publishes nothing is worse than none, since
 *   a consumer reads it as authoritative and turns every link into this package
 *   into a reported typo.
 */
export function emitLinkManifest({ contentBase, outDir, config } = {}) {
    const resolved = config ?? loadPackConfig();
    const tree = contentBase ?? resolved.paths.content;
    const dir = outDir ?? resolved.paths.manifestOut;
    const ctx = manifestContext(resolved);

    // A repository that has not declared it publishes a manifest must not
    // produce one: the file is vendored by consumers and read as authoritative,
    // so emitting it is a statement about this package rather than a local
    // convenience. Checked here rather than in the command, so a library caller
    // cannot route around the declaration.
    if (!resolved.publish.manifests.publish) {
        throw new Error(
            `this repository does not publish a link manifest — set ` +
                `\`publish.manifests.publish: true\` in its content-build ` +
                `configuration to change that`,
        );
    }

    if (!fs.existsSync(tree)) {
        throw new Error(`no content tree at ${tree}`);
    }

    const { entries, notes, skipped } = collectManifestEntries(tree, ctx);
    if (entries.length === 0) {
        throw new Error(
            `${tree} yielded no published notes, so the manifest would ` +
                `claim this package publishes nothing`,
        );
    }

    const written = writeManifests(
        new Map([[ctx.contentPackage, entries]]),
        dir,
        // The one surviving role of a base: `undefined` is the statement "this
        // build publishes no pages", and no entry then carries a `path`
        // (#1516). The value itself cancels — every address above is already
        // package-relative — so it is a sentinel, not a location.
        ctx.web ? { [ctx.contentPackage]: "/" } : undefined,
        { [ctx.contentPackage]: ctx.foundryPackageId },
    );

    return { written, entries: entries.length, notes, skipped };
}
