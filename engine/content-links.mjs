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
 * Resolving every link in a content tree, and reporting the ones that land
 * nowhere.
 *
 * Three link defects survive both content builds silently, so neither the pack
 * compilers nor a site build catches them:
 *
 * 1. **A dead `#anchor`.** A page id is derived by hashing the note id and the
 *    anchor slug; nothing checks that a heading declaring that slug exists. A
 *    link to an anchor nobody declares compiles cleanly, emits an enricher, and
 *    dead-ends for the reader.
 * 2. **A dead address.** Every link is an address, and one resolving to no note
 *    is a typo. So is a target that does not parse as an address at all. A
 *    written target expands to exactly one canonical address, from the
 *    position's own defaults — the package it omits is always this one — so a
 *    lookup finds one entry or none. There is no candidate set to disambiguate.
 * 3. **An unlabelled link.** `[[x]]` addresses nothing: the alias namespace it
 *    once named is retired, and a shortcode is an address rather than
 *    prose, so the link has neither a resolvable target nor text to show. The
 *    correction is always `[[type-shortcode|Text]]`.
 * 4. **A wikilink authored in frontmatter.** Both builds walk a note's *body*
 *    and copy frontmatter through verbatim, so a link written in a
 *    `description` is never resolved and publishes as literal `[[…]]` text.
 *    Frontmatter is data: an `Address` field is parsed by the address grammar
 *    and a bracketed link there is a finding naming the note and the field.
 *
 * **This resolves links the way the builds do**, calling the same
 * {@link readQualifier} and the same {@link parseWikilink} rather than a second
 * copy of either. It did carry its own copy of the wikilink pattern — the third
 * in this codebase, and the same drifted one that let an unclosed bracket
 * swallow a document — so the checker parsed more loosely than the compilers it
 * was checking.
 *
 * **What this deliberately does not do.** Corpus reachability — "every rules
 * document is reachable from the book's root" — is a statement about what one
 * package publishes, not about the note format, so it belongs with the
 * publishing it describes; so does a retired hostname. Both are served by the
 * link graph returned here rather than implemented here.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { matchAllOutsideCode } from "./code-fences.mjs";
import { expandContentTables } from "./content-tables.mjs";
import { collectAnchors } from "./anchors.mjs";
// The corpus, and everything derived from it, read from the one place that
// derives it. Nothing in the index's own import graph reaches this
// module, so this is a plain static import rather than the deferred one
// `sql-tables` needs to keep out of the compilers' cycle.
import {
    authoredFrontmatter,
    indexRecordsFor,
    isAssetRecord,
    isNoteRecord,
    noteFile,
} from "./content-index.mjs";
import { ASSET_TYPE_NAMES } from "./asset-types.mjs";
import { resolveEmbeds } from "./content-embeds.mjs";
import { foundryAddressProblem, servesFoundry } from "./pathnames.mjs";
import { hasDocEntry } from "./item-docs.mjs";
import { NO_SYSTEM, systemOf } from "./document-subtypes.mjs";
import { KNOWN_DOCUMENT_SUBTYPE_MAPS } from "./note-claims.mjs";
import { loadPackConfig } from "./pack-config.mjs";
import { searchableFrontmatter } from "./note-package.mjs";
import {
    blockSystem,
    canonicalKey,
    expandAddress,
    PACKAGE_BASE,
    readCanonicalKey,
} from "./content-address.mjs";
import { loadForeignIndexes, noContentIndexPackages } from "./metadata-index.mjs";
import { frontmatterWikilinks, slugify } from "./web-wikilinks.mjs";
import { homepageAddresses, isHomepage } from "./homepage.mjs";
import { RETIRED_TYPES } from "./ids.mjs";
import { parseWikilink, WIKILINK } from "./wikilink-syntax.mjs";
import { readQualifier } from "./wikilinks.mjs";

/**
 * Every `{#anchor}` a note declares on a heading.
 *
 * **Read from the content index's reader, not a second one.** This module kept
 * its own, and the two disagreed: it matched `{#([a-z0-9-]+)}` while
 * {@link module:engine/content-index.collectAnchors} matches `{#([^}]+)}`, so
 * an anchor with a capital in it — `{#CalendarFormat}` — existed for the index
 * and for the compiler and did not exist for the link checker. Nothing links to
 * one today, so the disagreement was latent; the first link to one would have
 * been reported dead against a heading plainly present in the file.
 *
 * The specification puts no charset on the id: "`#id` represents an id anchor
 * named `id`". The narrower pattern was this module's invention, which is the
 * argument for there being one reader rather than a well-chosen one.
 *
 * @param {string} body - The note's markdown body.
 * @returns {Set<string>} The declared anchor slugs.
 */
export function anchorsOf(body) {
    return new Set(collectAnchors(body).map((anchor) => anchor.slug));
}

/**
 * Read a content tree into the index a link resolves against.
 *
 * **The corpus comes from the content index, not from a walk of this module's
 * own**. Every pass used to answer "which files are the content?" for
 * itself and throw the answer away; this one now reads
 * {@link module:engine/content-index.indexRecordsFor}, which is the same
 * derivation the published artifact and the compilers are driven from. So a
 * note the index records is a note the link check sees, and the addresses and
 * anchors it resolves against are the ones every other pass will emit — rather
 * than a second derivation that agrees with them only by inspection. That was
 * not hypothetical: this module carried its own anchor reader until the anchor
 * anchor half, and the two disagreed about which anchors existed.
 *
 * **The file is opened for its bytes and nothing else.** The index deliberately
 * carries no note *body*, and a link lives in the body — so each note is read
 * once, here, for the prose. Everything *about* the note — its frontmatter, its
 * addresses, its anchors — is already in the record, and none of it is derived
 * a second time. That is one read per note rather than the two this module did
 * before, since the walk read the file and it then read it again for the raw
 * text.
 *
 * The index mirrors what both builds construct, including the two addresses a
 * doc-carrying note answers to: `type/shortcode` for the document, and
 * `doc<type>/shortcode` for the JournalEntry its prose compiles into. Once a
 * manifest publishes `doc<type>` entries that prefix is a *known type*, and the
 * virtual reading that used to answer for it no longer fires — a real type owns
 * its own name — so the note is indexed under both.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} [opts]
 * @param {object} [opts.config] - The resolved build configuration, whose
 *   fetched dependency indexes foreign addresses resolve through, and
 *   whose `contentPackage` every local address is built from. Omitted, the
 *   ambient configuration is resolved and no cross-package address resolves.
 * @param {readonly string[]} [opts.skipDirectories] - The walk's scope, passed
 *   on to the index rather than defaulted away.
 * @param {Map<string, object[]>} [opts.sqlTables] - Prepared `sql` results, by
 *   note path.
 * @param {object[]} [opts.records] - Index records the caller already derived,
 *   so a command that also needs them — every one of them does, to answer its
 *   `sql` tables — enumerates the corpus once rather than twice.
 * @param {object[]} [opts.problems] - Collects the notes the index cannot
 *   record, as diagnostics, instead of letting one of them abort the check
 *   before it has reported anything else.
 * @returns {object} The notes, the index, and the resolvers built over it.
 */
export function buildLinkIndex(
    contentBase,
    { config, skipDirectories, sqlTables, records, problems } = {},
) {
    const notes = [];
    const frontmatterLinks = [];

    // The one package every note in this tree belongs to. Taken from the
    // configuration this build resolved — never from a note (`package:` is
    // retired, so there is no second source an address could disagree with)
    // and never from the ambient one, which is a different configuration
    // whenever a test injects one, `PACKAGE_BUILD_CONFIG` names one, or the
    // command runs from a worktree.
    const resolved = config ?? loadPackConfig();
    const pkg = resolved.contentPackage;

    const indexRecords =
        records ?? indexRecordsFor({ contentBase, config: resolved, skipDirectories, problems });

    const byKey = new Map();
    /**
     * Canonical address to the **stub** that would hold it.
     *
     * A stub has no page, so nothing may link to one — but it is a note the
     * tree holds, and keeping it here is what lets the checker say so. The
     * diagnostic names the note and reports that it has no body, where a link
     * resolving against nothing at all can only say "resolves to no note".
     *
     * Kept beside {@link byKey} rather than in it, because the two answer
     * different questions: `byKey` is what a **page** link may reach, and a
     * stub is reachable only as **data** — a border's far side, a reference
     * naming an item to stand beside. That is the whole boundary, and it is
     * drawn here rather than per field.
     */
    const byStub = new Map();
    /** Canonical address to asset record, for the files this package ships. */
    const byAssetKey = new Map();
    const anchors = new Map();

    for (const record of indexRecords) {
        // An asset's record addresses a file rather than a note: there is no
        // body to read links out of and no anchor to resolve one against, so it
        // is keyed for resolution and nothing else. Keyed here rather than
        // alongside the notes because `byKey` holds notes, and a caller that
        // reaches for `.fm` or `.body` on one must not be handed a file.
        if (isAssetRecord(record)) {
            if (record.address?.canonical) byAssetKey.set(record.address.canonical, record);
            continue;
        }
        // A documentation journal has a record of its own but no file and no
        // authored frontmatter — it is a document this tree emits, not a note
        // in it. Its addresses are keyed below, from the note it documents.
        if (!isNoteRecord(record) || typeof record.type !== "string") continue;

        const fm = authoredFrontmatter(record);
        const rel = record.file.path;
        const absPath = noteFile(contentBase, record);
        // The raw text is kept beside the parsed body: a consumer's own checks
        // may need what frontmatter carried, which the body has dropped.
        const raw = fs.readFileSync(absPath, "utf8");
        const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
        const type = record.type.toLowerCase();
        const note = { file: absPath, rel, fm, body, raw, type };

        for (const hit of frontmatterWikilinks(fm)) {
            frontmatterLinks.push({ note, ...hit });
        }
        notes.push(note);

        // The anchors the index recorded, rather than a second reading of the
        // same headings — the disagreement the anchor half removes.
        anchors.set(note, new Set((record.anchors ?? []).map((a) => a.slug)));

        if (typeof fm.shortcode === "string" && fm.shortcode) {
            // Canonical addresses only. Every written target expands to one
            // before lookup, so there is nothing left for a short key to
            // answer — and the short key was harmful: `type/shortcode` is
            // system-blind, set with a plain `Map.set`, so two notes in one
            // package sharing a `(type, shortcode)` across systems silently
            // overwrote each other in that slot while both canonical keys sat
            // correctly beside it.
            //
            // Taken from the record, which is where the address rule is applied
            // once for the whole build.
            const canonical =
                record.address?.canonical ??
                canonicalKey(pkg, systemOf(type, KNOWN_DOCUMENT_SUBTYPE_MAPS), type, fm.shortcode);
            // A note with no address publishes no page, so its identity is
            // filed where a link cannot reach it and a reference still can.
            const into = record.address ? byKey : byStub;
            into.set(canonical, note);
            if (hasDocEntry(type)) {
                // A documentation journal is `none`: no game system defines a
                // JournalEntry, and one note has one of them however many
                // system blocks it carries.
                into.set(canonicalKey(pkg, NO_SYSTEM, `doc${type}`, fm.shortcode), note);
            }
        }
    }

    // The types a link may name, which are the ones notes declare. A
    // documentation journal's `doc<type>` is deliberately not among them: it is
    // virtual, and `readQualifier` resolves it from the base type rather than
    // from a type any tree declares.
    //
    // The **asset** types join unconditionally, whether or not this tree holds
    // a file of each. They are a closed vocabulary rather than a census of what
    // was found, and the difference is the whole diagnostic: an unknown type
    // does not parse, so a tree with no `audio/` directory would read
    // `audio-swoosh` as prose and say nothing, where an address the vocabulary
    // knows and nothing answers is reported as the dead reference it is.
    const types = new Set([...notes.map((n) => n.type), ...ASSET_TYPE_NAMES]);

    // A foreign package may use a type this tree has never seen, so its types
    // join `types` — otherwise `readQualifier` reads the link as prose and it
    // is never checked at all.
    const localPackages = new Set([pkg]);
    const foreign =
        config ?
            loadForeignIndexes(config, localPackages)
        :   { index: new Map(), packages: new Set(), stale: [] };
    for (const v of foreign.index.values()) if (v.type) types.add(v.type);

    // A stub counts. It publishes no page, so nothing may *link* to one, but its
    // address is a name the tree holds and a reference reaches it — a border's
    // far side is the case that matters. Leaving this package out of the set
    // whenever every note it holds is a stub would make a fully qualified local
    // address unreadable in precisely the tree whose relations need it.
    const packages = new Set([...(byKey.size || byStub.size ? [pkg] : []), ...foreign.packages]);
    // Packages declared `contentIndex: false` — a Foundry dependency only, with
    // no fetched index. A link naming one is refused with a diagnostic that
    // names the key, rather than reading as an undeclared package or a typo.
    const noIndexPackages = config ? noContentIndexPackages(config) : new Set();

    // The address space an `![[…]]` embed resolves against, shaped as every
    // other asset resolver reads one so the checker cannot answer an authored
    // embed differently from the builds that emit it.
    const assetIndex = {
        types,
        packages,
        contentPackage: pkg,
        assets: byAssetKey,
        foreign: foreign.index,
    };

    /** The searchable universe a `dataview` table draws its rows from. */
    const tableDocs = notes.map((n) => ({
        // Package present for a `WHERE … package = "…"` clause, synthesised
        // rather than authored — see {@link searchableFrontmatter}.
        fm: searchableFrontmatter(n.fm, pkg),
        path: n.rel,
        tld: n.rel.split("/")[0],
        folder: path.dirname(n.rel).split("/").pop(),
    }));

    /**
     * One note's body with its `dataview` and `sql` tables expanded.
     *
     * The body every body-level check reads, so a link and an embed in one note
     * are found in the same text — a generated table is as free to carry either
     * as prose is.
     *
     * @param {object} note - A note from this index.
     * @returns {string} The markdown.
     */
    function expandedBody(note) {
        const body = note.body;
        if (!/^[ \t]*(?:`{3,}|~{3,})[ \t]*(?:dataview|sql)\b/im.test(body)) return body;
        return expandContentTables(body, {
            // Unfiltered: every note in the tree is this package's, so
            // there is no other package's note to exclude.
            docs: tableDocs,
            linkable: (d) => Boolean(d.fm.shortcode),
            source: note.file,
            // A `sql` table's links are checked like an authored one's, so
            // its rows are prepared ahead of this walk — see
            // {@link module:engine/sql-tables.prepareTreeSqlTables}.
            sqlTables: sqlTables?.get(note.file),
        }).markdown;
    }

    /**
     * Every `![[…]]` embed in a note body, resolved against the files this tree
     * and its dependencies ship.
     *
     * @param {object} note - A note from this index.
     * @returns {Array<{text: string, occurrence: number, reason?: string,
     *   target?: string, type?: string, message?: string}>} One entry per
     *   defect, in the shape the finding reporter reads.
     */
    function embedsOf(note) {
        const { unresolved, problems, images } = resolveEmbeds(expandedBody(note), {
            index: assetIndex,
        });
        // **The address an embed resolved to, held to the Foundry surface.** An
        // embed becomes the ordinary image every surface renders, so a file
        // the website serves and the book stages can still be one no Foundry
        // install carries — and the journal would take the pathname as
        // authored. Reported against the embed the note actually wrote, which
        // is what a reader can open and edit. A build that installs nothing in
        // Foundry has no such surface and is not asked.
        const dead =
            servesFoundry(resolved) ?
                images
                    .map((image) => ({
                        text: image.link,
                        message: foundryAddressProblem(image.pathname, resolved),
                    }))
                    .filter((finding) => finding.message)
            :   [];
        const seen = new Map();
        /**
         * @param {string} text - The embed exactly as authored.
         * @returns {number} Its nth appearance in the note.
         */
        const at = (text) => {
            const occurrence = (seen.get(text) ?? 0) + 1;
            seen.set(text, occurrence);
            return occurrence;
        };
        return [
            ...unresolved.map((u) => ({
                text: u.link,
                target: u.target,
                reason: u.reason,
                ...(u.type ? { type: u.type } : {}),
            })),
            ...problems.map((problem) => ({
                text: problem.link,
                message: problem.message,
            })),
            ...dead,
        ].map((finding) => ({ ...finding, occurrence: at(finding.text) }));
    }

    /**
     * Every wikilink in a note body, with its `dataview` tables expanded.
     *
     * An `![[…]]` embed is not one: it names a file rather than a note, and
     * {@link module:engine/wikilink-syntax.WIKILINK} excludes it so that no
     * reader can take one for the other.
     *
     * @param {object} note - A note from this index.
     * @returns {Array<{target: string, anchor: string, text: string,
     *   occurrence: number, labelled: boolean}>} `target` is `""` for a
     *   same-page `[[#anchor]]`; `labelled` says whether the link carries the
     *   `|` every link must have.
     */
    function linksOf(note) {
        const body = expandedBody(note);
        const out = [];
        // How many times each authored link has been seen, so two identical
        // links in one note are reported at their own positions.
        const seen = new Map();
        // Code is verbatim, so a `[[…]]` inside a fence, an indented block or an
        // inline span is not a link — the compilers make none of it either.
        for (const [all, rawInner] of matchAllOutsideCode(body, new RegExp(WIKILINK.source, "g"))) {
            const parsed = parseWikilink(rawInner);
            const { target, anchor } = parsed;
            const occurrence = (seen.get(all) ?? 0) + 1;
            seen.set(all, occurrence);
            // `text` is the link exactly as authored, which is what locates it
            // in the file. A link a table generated is not in the file at all,
            // so the search simply fails and a finding names the file.
            out.push({
                target,
                anchor,
                text: all,
                occurrence,
                labelled: parsed.labelled,
            });
        }
        return out;
    }

    /**
     * The note an **address** names, or `undefined`.
     *
     * The qualifier is read with {@link readQualifier} rather than a second
     * copy of the rule, so this cannot drift from what the builds do — the two
     * separators, the first-hyphen split, and the optional leading package
     * segment.
     *
     * @param {string} target - The link target, anchor already removed.
     * @param {string} [keyPath] - The dotted frontmatter key path the link sits
     *   under, which supplies the system an omitted segment defaults to — see
     *   {@link blockSystem}. Body prose has none.
     * @returns {object|undefined} The note it addresses.
     */
    function resolveAddress(target, keyPath) {
        const qualified = readQualifier(target, types, packages, noIndexPackages);
        if (!qualified || qualified.reason) return undefined;
        // Every omitted segment defaults from where the link is written,
        // so the target expands to exactly one canonical address and this is a
        // plain lookup. There is no candidate set, and therefore no single-hit
        // rule and no ambiguity to report.
        //
        // It replaced a system-blind short key, `type/shortcode`, populated by
        // plain `Map.set` — so two notes in one package sharing a
        // `(type, shortcode)` across systems silently overwrote each other, and
        // a bare link resolved to whichever was indexed second.
        const canonical = expandAddress(qualified, { package: pkg, system: blockSystem(keyPath) });
        // Assets are consulted after notes and never instead of them: the two
        // namespaces cannot collide — an address carries its type — so the order
        // is about which map holds the answer, not about precedence.
        return byKey.get(canonical) ?? byAssetKey.get(canonical);
    }

    /**
     * The **stub** an address names, or `undefined`.
     *
     * Asked only after {@link resolveAddress} has answered nothing, and read
     * exactly as it reads: same qualifier, same defaults, same expansion. What
     * it buys is the diagnostic — a link into a stub is refused because there
     * is no page to reach, and the message can name the file the author has to
     * open rather than saying the address resolves nowhere.
     *
     * @param {string} target - The link target, anchor already removed.
     * @param {string} [keyPath] - The dotted frontmatter key path the link sits
     *   under; body prose has none.
     * @returns {object|undefined} The stub it addresses.
     */
    function stubAt(target, keyPath) {
        const qualified = readQualifier(target, types, packages, noIndexPackages);
        if (!qualified || qualified.reason) return undefined;
        return byStub.get(expandAddress(qualified, { package: pkg, system: blockSystem(keyPath) }));
    }

    /**
     * Every foreign manifest entry an address names, in package order.
     *
     * A written target is a **partial** address, so this matches on the
     * segments it supplies and wildcards the rest. A target naming a
     * package necessarily names its system too — omission runs left to right —
     * so the fully qualified form matches at most one entry; a shorter one
     * names no package, and resolves against any foreign package that
     * publishes it. Either way only exactly one hit resolves. Two claimants make it ambiguous, which is a different finding
     * from resolving nowhere and has a different fix, so the count is returned
     * rather than collapsed here.
     *
     * @param {string} target - The link target.
     * @param {string} [keyPath] - The dotted frontmatter key path the link sits
     *   under, which supplies the system an omitted segment defaults to — see
     *   {@link blockSystem}. Body prose has none.
     * @returns {object[]} The foreign entries, each carrying its `package`.
     */
    function foreignHits(target, keyPath) {
        const q = readQualifier(target, types, packages, noIndexPackages);
        if (!q || q.reason) return [];
        // An omitted package means *this* package, so a short form
        // addresses nothing foreign and never reaches a dependency's index.
        // Reaching another package is the fully qualified form's job, and
        // saying so is the whole point: a link that resolved into `sohl` only
        // because no local note claimed the address was resolving by accident,
        // and would have retargeted silently the day one did.
        if (!q.package) return [];
        const hit = foreign.index.get(
            expandAddress(q, { package: q.package, system: blockSystem(keyPath) }),
        );
        return hit ? [hit] : [];
    }

    /**
     * The manifest entry a qualified address names in another package, or null.
     *
     * The single-hit reading of {@link foreignHits}: an address two packages
     * publish names neither.
     *
     * @param {string} target - The link target.
     * @returns {object|null} The foreign entry.
     */
    function manifestHit(target) {
        const hits = foreignHits(target);
        return hits.length === 1 ? hits[0] : null;
    }

    /**
     * The note, asset, stub or foreign entry an **address** names, or
     * `undefined`.
     *
     * The same rule as {@link resolveAddress} — read with {@link readQualifier},
     * expanded with {@link expandAddress} against this index's own package and
     * the citing block's system — consulted against every source this index
     * holds rather than only the notes a page link may reach: a stub the tree
     * holds and a fetched foreign package both answer here, where neither
     * answers a page link. A caller with its own position-specific default
     * type — a place's `to`, whose default is `place` rather than anything
     * this index states — parses and expands the value itself and hands this
     * the canonical string it already computed; every segment that string
     * states overrides the default that would otherwise apply, so it round-trips
     * to itself and this is a plain keyed lookup either way.
     *
     * @param {string} target - The address, or a short form read against this
     *   index's own defaults.
     * @param {string} [keyPath] - The dotted frontmatter key path the value
     *   sits under; body prose has none. Ignored once `target` is already
     *   canonical.
     * @returns {object|undefined} The entry.
     */
    function addressHit(target, keyPath) {
        const qualified = readQualifier(target, types, packages, noIndexPackages);
        if (!qualified || qualified.reason) return undefined;
        const canonical = expandAddress(qualified, { package: pkg, system: blockSystem(keyPath) });
        // Stubs and foreign entries answer here and nowhere else in this
        // index: a reference names an item to stand beside rather than a
        // document to point at, so a border with a stub — or a place in a
        // dependency — on the far side is a valid statement about the world.
        return (
            byKey.get(canonical) ??
            byAssetKey.get(canonical) ??
            byStub.get(canonical) ??
            foreign.index.get(canonical)
        );
    }

    /**
     * The note, asset, stub or foreign entry a **Shortcode** names, or `null`.
     *
     * A `code:` field's value is a Shortcode, not an address — one segment,
     * persisted verbatim and resolved at runtime against the items embedded on
     * one actor, where packages do not exist. So `type` and `shortcode` are
     * searched for directly rather than assembled into a written form and read
     * back through the address grammar: a Shortcode never reaches that grammar,
     * by {@link module:engine/address}'s own contract. It resolves in any
     * reachable package, because the value comes from every package the actor
     * draws on — package and system are never part of the search, not defaulted
     * out of it.
     *
     * @param {string} type - The field's declared `code:`.
     * @param {string} shortcode - The value as authored, already checked
     *   against the shortcode charset.
     * @returns {object|null} The first entry naming the pair, from local notes,
     *   local assets, local stubs, or a fetched foreign index, in that order.
     */
    function shortcodeHit(type, shortcode) {
        const wantType = String(type).toLowerCase();
        const wantCode = String(shortcode).toLowerCase();
        for (const [key, value] of [...byKey, ...byAssetKey, ...byStub, ...foreign.index]) {
            const parts = readCanonicalKey(key);
            if (parts && parts.type === wantType && parts.shortcode === wantCode) return value;
        }
        return null;
    }

    return {
        notes,
        frontmatterLinks,
        anchors,
        types,
        packages,
        /** Packages declared `contentIndex: false`, a Foundry dependency only. */
        noIndexPackages,
        /**
         * The files this package ships, by canonical address. Separate from the
         * notes because the two record shapes are read differently, and exposed
         * because a pass resolving art needs the address set without walking the
         * index again.
         */
        assets: byAssetKey,
        /**
         * The address space an `![[…]]` embed resolves against.
         */
        assetIndex,
        /**
         * The one package this tree publishes. Distinct from `packages`, which
         * is the set an address may name and which a homepage-only tree leaves
         * this package out of, having no keyed note to put it there.
         */
        contentPackage: pkg,
        foreign,
        linksOf,
        embedsOf,
        /**
         * Resolve a link target the way both builds do, or `undefined`. Every
         * link is an address, so this is {@link resolveAddress} under the name
         * the walkers use.
         */
        resolve: resolveAddress,
        resolveAddress,
        /** The stub an address names, for the refusal that says which file. */
        stubAt,
        manifestHit,
        foreignHits,
        addressHit,
        shortcodeHit,
        /** Whether a target reads as a qualified address at all. */
        isAddress: (target) => Boolean(readQualifier(target, types, packages, noIndexPackages)),
    };
}

/**
 * The site this project publishes on, as a host pattern.
 *
 * Hardcoded, as it is in {@link module:engine/homepage} already: every package's
 * address is `https://www.heroiclands.org/<contentPackage>/`, and the whole
 * point of the rule below is that an author *should not* be writing that host
 * into a page. A configurable host would be a second place to write down the
 * thing being discouraged.
 *
 * @type {RegExp}
 */
const SITE_HOST = /^(?:[a-z0-9-]+\.)*heroiclands\.org$/i;

/**
 * Every package front page this build can name, as `package` → base.
 *
 * **A front page needs no manifest, and that is what makes it work.** A
 * homepage compiles to no document and is entered in no manifest, but its
 * address is not a *note's* address but the **package's** — it is the mount's
 * `_index.md`, published at `/<package>/` — and {@link PACKAGE_BASE} already
 * records where each package is served. That is a frozen constant compiled
 * into every build, so consulting it walks no tree, reads no manifest and
 * builds no index — which is precisely why the mechanism survives `homepage`
 * mode, where the licensing fence means none of those exist.
 *
 * The roster is consulted **for front pages only**. Widening the package set the
 * other rules read would make them offer manifest-based advice about packages
 * no index has been fetched for.
 *
 * @param {string} ownPackage - The package this build publishes.
 * @param {Iterable<string>} manifestPackages - Packages a fetched index
 *   names, which are addressable whether or not the roster lists them.
 * @returns {Map<string, string>} Package to base, each base slash-terminated.
 */
function landingBases(ownPackage, manifestPackages) {
    const bases = new Map();
    // Convention first, roster second, so a package the roster relocates is
    // recorded at the relocated base rather than the default one.
    for (const pkg of [ownPackage, ...manifestPackages]) {
        if (pkg) bases.set(pkg, `/${pkg}/`);
    }
    for (const [pkg, base] of Object.entries(PACKAGE_BASE)) {
        if (typeof base === "string" && base.endsWith("/")) {
            bases.set(pkg, base);
        }
    }
    return bases;
}

/**
 * The package whose landing an address names, or `null`.
 *
 * Matches the whole path, not a prefix: `/sohl/` is the landing, `/sohl/kb/`
 * is a page inside the package and belongs to the manifest rules instead.
 *
 * @param {string} url - The authored address.
 * @param {Map<string, string>} bases - From {@link landingBases}.
 * @returns {{pkg: string, base: string}|null} The package and its base.
 */
function landingTarget(url, bases) {
    const value = String(url ?? "").trim();
    if (!value || !/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        return null;
    }
    if (!/^https?:$/.test(parsed.protocol)) return null;
    if (!SITE_HOST.test(parsed.hostname)) return null;
    const pathname = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
    for (const [pkg, base] of bases) {
        if (pathname === base) return { pkg, base };
    }
    return null;
}

/**
 * How an authored address resolves, or `null` for one nothing here can judge.
 *
 * Three shapes reach the site and one does not, and the distinction is the
 * whole of what is checkable. An address into this site can be reasoned about
 * from the package roster alone; an address to `github.com`, `kelestia.com` or
 * `discord.gg` cannot be reasoned about at all without fetching it, and a build
 * must not depend on a third party being up.
 *
 * @param {string} url - The authored address.
 * @param {ReadonlySet<string>} packages - Package prefixes this build can name.
 * @returns {{shape: string, segments: string[], prefix: string|null}|null} The
 *   shape, the path segments, and the package prefix the address starts with.
 */
function readAddress(url, packages) {
    const value = String(url ?? "").trim();
    if (!value || value.startsWith("#")) return null;

    let segments;
    let shape;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
        let parsed;
        try {
            parsed = new URL(value);
        } catch {
            return null;
        }
        if (!/^https?:$/.test(parsed.protocol)) return null;
        if (!SITE_HOST.test(parsed.hostname)) return null;
        shape = "absolute";
        segments = parsed.pathname.split("/").filter(Boolean);
    } else if (value.startsWith("/")) {
        shape = "rooted";
        segments = value.split("?")[0].split("#")[0].split("/").filter(Boolean);
    } else {
        shape = "relative";
        segments = value.split("?")[0].split("#")[0].split("/").filter(Boolean);
    }

    const prefix = shape !== "relative" && packages.has(segments[0]) ? segments[0] : null;
    return { shape, segments, prefix };
}

/**
 * Every defect in the addresses a package homepage carries.
 *
 * **Why the homepage needs its own audit at all.** Every other note addresses
 * the corpus with wikilinks, which {@link auditLinks} resolves. A homepage does
 * not and cannot: it is published *verbatim* by every publishing mode, including
 * the homepage-only mode two fan-licensed packages ship under, where the content
 * tree is never walked and there is no index for a wikilink to resolve against.
 * So a homepage addresses the web the way the web does — markdown links in its
 * body — and this is what looks at those. A dead link on the page a reader
 * arrives at is the one nothing else would report.
 *
 * **What is checkable, stated plainly.** Only an address into this site is, and
 * only against facts this build already holds:
 *
 * - A **retired content type** in the path. The engine knows the retired names
 *   and what replaced it, so this is a fact rather than a guess.
 * - A **hardcoded absolute URL** into this package's own prefix, or into one a
 *   fetched index names. Every one of them has a better form to write, which
 *   is why every one is reported — including a bare `/<package>/`, which names
 *   another package's front page. A front page's address *is* its package
 *   prefix, so `/<package>/` is the absolute URL with the host struck off —
 *   host-free, emitted verbatim, and needing no index, which is what lets it
 *   hold in homepage-only mode where the tree is never walked.
 * - A **wikilink**, which nothing on this page will ever resolve.
 *
 * **What is not checkable, and is not attempted.** Whether an external URL
 * answers — there is no network at build time, and a build must not fail because
 * a third party is down. And whether a live in-site address names a page that
 * exists: several of the surfaces a homepage routes to are produced by other
 * tools entirely (generated API documentation, say), so this build does not
 * hold the set of published pages and would report a working link as dead.
 *
 * @param {ReturnType<typeof buildLinkIndex>} index - The built index.
 * @returns {Array<{note: object, field: string, url: string, text: string,
 *   occurrence: number, message: string}>} One finding per defect, `text` and
 *   `occurrence` locating it in the note's raw source.
 */
export function auditHomepageLinks(index) {
    const findings = [];
    const packages = new Set([index.contentPackage, ...index.packages]);
    const bases = landingBases(index.contentPackage, index.packages);

    for (const note of index.notes) {
        if (!isHomepage(note.fm)) continue;

        // How many times each literal has been seen, so two identical
        // addresses are located at their own positions.
        const seen = new Map();
        const at = (text) => {
            const occurrence = (seen.get(text) ?? 0) + 1;
            seen.set(text, occurrence);
            return occurrence;
        };
        const report = (field, url, text, occurrence, message) =>
            findings.push({ note, field, url, text, occurrence, message });

        for (const [all, rawInner] of matchAllOutsideCode(
            note.body,
            new RegExp(WIKILINK.source, "g"),
        )) {
            const { target } = parseWikilink(rawInner);
            report(
                "body",
                target,
                all,
                at(all),
                `wikilink ${all} on the package homepage — a homepage is ` +
                    `published verbatim in every publishing mode, so nothing ` +
                    `resolves it; write a markdown link, package-relative`,
            );
        }

        for (const { field, url } of homepageAddresses(note.body)) {
            // Counted for every address, checked or not, so the count is
            // the literal's nth appearance in the file rather than the nth
            // *finding* about it — two rules can fire on one address.
            const occurrence = at(url);
            const address = readAddress(url, packages);
            if (!address) continue;
            const { shape, segments, prefix } = address;

            // Landings first, and by the roster rather than by the manifest
            // package set: a landing is addressable in a repository that
            // has fetched no index at all, which is the case the fence creates
            // and the case this rule exists for.
            const landing = landingTarget(url, bases);
            if (landing) {
                report(
                    field,
                    url,
                    url,
                    occurrence,
                    `hardcoded absolute URL to ` +
                        (landing.pkg === index.contentPackage ?
                            `this package's own landing`
                        :   `package "${landing.pkg}"'s landing`) +
                        ` — write "${landing.base}", which names no host, is ` +
                        `emitted verbatim, and resolves through the package ` +
                        `roster rather than through an index, so it holds ` +
                        `where no content tree is walked`,
                );
            } else if (shape === "absolute" && prefix) {
                const rest = segments.slice(1).join("/");
                report(
                    field,
                    url,
                    url,
                    occurrence,
                    prefix === index.contentPackage ?
                        `hardcoded absolute URL into this package's own ` +
                            `address — write the package-relative ` +
                            `"${rest}/", which a browser resolves against ` +
                            `the homepage's own address, the package root`
                    :   `hardcoded absolute URL into package "${prefix}" ` +
                            `— resolve it through that package's link ` +
                            `manifest, whose entries carry the address, so a ` +
                            `relocation does not leave this page behind`,
                );
            }

            // The retired-type rule reads the path *inside* the package, so an
            // address that named one is fixed the same way wherever it was
            // written.
            const inPackage = prefix ? segments.slice(1) : segments;
            for (const [i, segment] of inPackage.entries()) {
                // `hasOwn`, not a plain lookup: a path segment spelled
                // `constructor` would otherwise inherit a truthy answer from
                // `Object.prototype` and be reported as retired.
                if (!Object.hasOwn(RETIRED_TYPES, segment)) continue;
                const replacement = RETIRED_TYPES[segment];
                const fixed = [...inPackage];
                fixed[i] = replacement;
                report(
                    field,
                    url,
                    url,
                    occurrence,
                    `address "${url}" names content type "${segment}", ` +
                        `retired in favour of "${replacement}" — both ` +
                        `compiled to the same document, so the fix is ` +
                        `mechanical: "${fixed.join("/")}/"`,
                );
            }
        }
    }

    return findings;
}

/**
 * Every link in a tree that lands nowhere.
 *
 * **How the link is *written* is a separate finding from where it points**, and
 * the two are kept apart because the corrections differ. An unlabelled link
 * has to become `[[type-shortcode|Text]]`; a labelled one whose target
 * resolves nowhere has a shortcode to fix. Reporting a bare `[[Name]]` as a
 * dead address would send an author hunting for a note that was never named.
 *
 * @param {ReturnType<typeof buildLinkIndex>} index - The built index.
 * @returns {{deadAnchors: object[], deadAddresses: object[],
 *   unlabelledLinks: object[], frontmatterLinks: object[],
 *   homepageLinks: object[], usedManifest: Set<string>}} The findings, and
 *   which addresses a foreign manifest answered. Each `deadAddresses` entry
 *   carries a `reason` from {@link LINK_FINDING_REASONS} — `"not-an-address"`,
 *   `"unknown-type"`, `"no-content-index"`, `"stub"` (with the stub's path) or
 *   `"unresolved"`, never `"ambiguous"`: every target here expands to one
 *   canonical address before anything is looked up, so there is no candidate
 *   set for two packages to claim — and every reason is an **error**: the
 *   three resolvers agree on severity for every class.
 */
export function auditLinks(index) {
    const { notes, anchors, linksOf, embedsOf, resolve, manifestHit, isAddress } = index;

    // An embed names a file, and is checked here rather than by the image pass
    // because its grammar is the wikilink's: the same short-form ladder, the
    // same package defaults and the same findings vocabulary.
    const deadEmbeds = [];
    for (const note of notes) {
        for (const finding of embedsOf(note)) deadEmbeds.push({ note, ...finding });
    }

    const deadAnchors = [];
    for (const note of notes) {
        for (const { target, anchor, text, occurrence, labelled } of linksOf(note)) {
            if (!anchor || !labelled) continue;
            const dest = target ? resolve(target) : note;
            // An unresolvable target is reported by the pass below; its anchor
            // has nothing to be checked against. Neither has a file: an asset
            // resolves but has no body, so it declares the empty set of anchors
            // and every `#section` on one is dead.
            if (!dest) continue;
            if (!(anchors.get(dest) ?? new Set()).has(slugify(anchor))) {
                deadAnchors.push({
                    note,
                    link: `${target}#${anchor}`,
                    dest,
                    text,
                    occurrence,
                });
            }
        }
    }

    const deadAddresses = [];
    const unlabelledLinks = [];
    const usedManifest = new Set();
    for (const note of notes) {
        for (const { target, anchor, text, occurrence, labelled } of linksOf(note)) {
            // The label is required whatever the link part is, an anchor
            // included — so this is tested before the same-page form.
            if (!labelled) {
                unlabelledLinks.push({
                    note,
                    target: target || (anchor ? `#${anchor}` : ""),
                    text,
                    occurrence,
                    // Carried like every other finding's, so a reporter reads
                    // one field rather than knowing which list it drew from.
                    reason: "unlabelled",
                });
                continue;
            }
            if (!target) continue; // a same-page `[[#anchor|Text]]`
            const at = { note, target, text, occurrence };

            if (!isAddress(target)) {
                deadAddresses.push({ ...at, reason: "not-an-address" });
                continue;
            }
            if (index.resolveAddress(target)) continue;
            // A stub is in the index, so the refusal can name it. Asked before
            // the foreign manifests, because a local note is what the author
            // meant and reporting it as an unresolved foreign address would
            // send them looking in the wrong package.
            const stub = index.stubAt?.(target);
            if (stub) {
                deadAddresses.push({ ...at, reason: "stub", stub: stub.rel });
                continue;
            }
            // A manifest answers with the target package's own build output
            // rather than a reviewed guess. `manifestHit` is a keyed lookup —
            // a fully qualified target names one package, so there is nothing
            // left to disambiguate, and no ambiguity finding this resolver can
            // report.
            if (manifestHit(target)) {
                usedManifest.add(target.toLowerCase());
                continue;
            }
            const read = readQualifier(target, index.types, index.packages, index.noIndexPackages);
            deadAddresses.push({
                ...at,
                reason:
                    read?.reason === "unknown-type" ? "unknown-type"
                    : read?.reason === "no-content-index" ? "no-content-index"
                    : "unresolved",
            });
        }
    }

    return {
        deadAnchors,
        deadAddresses,
        deadEmbeds,
        unlabelledLinks,
        frontmatterLinks: index.frontmatterLinks,
        homepageLinks: auditHomepageLinks(index),
        usedManifest,
    };
}

/**
 * Walk a corpus from its root and report what nothing links to.
 *
 * A documentation set is a **book, not a pile of notes**: it has a page one,
 * and everything in it should follow from that page by reading. A note with no
 * inbound link still compiles into a pack and still publishes — it is simply
 * impossible to arrive at. Nothing else in either build notices, because every
 * other check asks whether a link *lands*, never whether a document is
 * *reached*.
 *
 * **Which documents belong to the corpus is the caller's to say.** A
 * repository's corpora are its own — one publishes rules and a user guide,
 * another a setting gazetteer — so `scope` decides membership and this decides
 * only reachability. Links out of the corpus are followed as real links; they
 * are simply not pages of it.
 *
 * **`stopAt` marks a page walked *to* but not *through*.** An index page links
 * to nearly everything it covers, so traversing one makes the whole check
 * vacuous: a chapter could stop linking one of its own pages and the walk would
 * still reach it by way of the index. Reachability has to hold along the
 * reading path, which is why the exception exists and why it is deliberately
 * narrow.
 *
 * @param {ReturnType<typeof buildLinkIndex>} index - The built index.
 * @param {object} opts
 * @param {string} opts.root - The corpus's entry page, as a tree-relative path.
 * @param {(note: object) => boolean} opts.scope - Whether a note belongs to the
 *   corpus.
 * @param {(note: object) => boolean} [opts.stopAt] - Whether a note is walked
 *   to but not through.
 * @returns {{root: object, reached: Set<object>, orphans: object[]}} The root,
 *   everything reached from it, and the corpus members that were not.
 * @throws {Error} When no note sits at `root` — a corpus with no page one
 *   cannot be walked, and silently reporting every page as an orphan would
 *   bury the actual mistake.
 */
export function walkReachability(index, { root, scope, stopAt = () => false }) {
    const rootNote = index.notes.find((n) => n.rel === root);
    if (!rootNote) {
        throw new Error(`no note at ${root}, so the corpus has no page to be read from`);
    }

    const reached = new Set([rootNote]);
    const queue = [rootNote];
    while (queue.length) {
        const note = queue.shift();
        if (stopAt(note)) continue;
        for (const { target, labelled } of index.linksOf(note)) {
            if (!target || !labelled) continue;
            const dest = index.resolve(target);
            if (!dest || !scope(dest) || reached.has(dest)) continue;
            reached.add(dest);
            queue.push(dest);
        }
    }

    return {
        root: rootNote,
        reached,
        orphans: index.notes.filter((n) => scope(n) && !reached.has(n)),
    };
}
