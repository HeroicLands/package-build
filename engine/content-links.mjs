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
 * 2. **A dead address.** A *qualified* `type-shortcode` target resolving to no
 *    note is a typo. A bare `[[Name]]` that finds nothing is not — that is a
 *    worldbuilding placeholder by long-standing convention, and is left alone.
 * 3. **A wikilink authored in frontmatter.** Both builds walk a note's *body*
 *    and copy frontmatter through verbatim, so a link written in a
 *    `description` is never resolved and publishes as literal `[[…]]` text.
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
 * link graph returned here rather than implemented here (#20).
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { matchAllOutsideCode } from "./code-fences.mjs";
import { expandContentTables } from "./content-tables.mjs";
import { walkMarkdownTree } from "./helpers.mjs";
import { hasDocEntry } from "./item-docs.mjs";
import { contentPackage } from "./content-package.mjs";
import { searchableFrontmatter } from "./note-package.mjs";
import {
    canonicalKey,
    loadForeignManifests,
    manifestsComplete,
    readCanonicalKey,
} from "./kb-manifest.mjs";
import { frontmatterWikilinks, slugify } from "./web-wikilinks.mjs";
import { parseWikilink, WIKILINK } from "./wikilink-syntax.mjs";
import { readQualifier } from "./wikilinks.mjs";

/**
 * Every `{#anchor}` a note declares on a heading.
 *
 * @param {string} body - The note's markdown body.
 * @returns {Set<string>} The declared anchor slugs.
 */
export function anchorsOf(body) {
    const found = new Set();
    for (const line of String(body ?? "").split("\n")) {
        const m = /^#{1,6}\s+.*\{#([a-z0-9-]+)\}\s*$/.exec(line.trim());
        if (m) found.add(m[1]);
    }
    return found;
}

/**
 * Load a content tree and build the index a link resolves against.
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
 * @param {string} [opts.manifestDir] - Where vendored foreign manifests live.
 *   Omitted, no cross-package address resolves.
 * @param {readonly string[]} [opts.skipDirectories] - Passed to the walk.
 * @returns {object} The notes, the index, and the resolvers built over it.
 */
export function buildLinkIndex(
    contentBase,
    { manifestDir, skipDirectories } = {},
) {
    const notes = [];
    const frontmatterLinks = [];
    const walkOpts = skipDirectories ? { skipDirectories } : undefined;

    for (const { frontmatter: fm, absPath } of walkMarkdownTree(
        contentBase,
        walkOpts,
    )) {
        if (!fm || typeof fm.type !== "string") continue;
        // The raw text is kept beside the parsed body: a consumer's own checks
        // may need what frontmatter carried, which the body has dropped.
        const raw = fs.readFileSync(absPath, "utf8");
        const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
        const note = {
            file: absPath,
            rel: path.relative(contentBase, absPath).split(path.sep).join("/"),
            fm,
            body,
            raw,
            type: fm.type.toLowerCase(),
        };
        for (const hit of frontmatterWikilinks(fm)) {
            frontmatterLinks.push({ note, ...hit });
        }
        notes.push(note);
    }

    const byKey = new Map();
    const byAlias = new Map();
    const aliasCollide = new Set();

    // The one package every note in this tree belongs to. Taken from the
    // configuration, never from a note: `package:` is retired, so there is no
    // second source an address could disagree with (#56).
    const pkg = contentPackage();

    for (const note of notes) {
        const { fm, type } = note;
        if (typeof fm.shortcode === "string" && fm.shortcode) {
            byKey.set(`${type}/${fm.shortcode}`.toLowerCase(), note);
            // The canonical, fully qualified address alongside the short one,
            // so a package-qualified link checks the same way a bare one does.
            byKey.set(canonicalKey(pkg, type, fm.shortcode), note);
            if (hasDocEntry(type)) {
                byKey.set(`doc${type}/${fm.shortcode}`.toLowerCase(), note);
                byKey.set(canonicalKey(pkg, `doc${type}`, fm.shortcode), note);
            }
        }
        const aliases = [
            ...(Array.isArray(fm.aliases) ? fm.aliases : []),
            ...(Array.isArray(fm.name?.aliases) ? fm.name.aliases : []),
            fm.name?.full,
            path.basename(note.file, ".md").replace(/_/g, " "),
        ].filter((a) => typeof a === "string" && a);
        for (const a of aliases) {
            const k = `${type}|${a}`.toLowerCase();
            if (aliasCollide.has(k)) continue;
            const cur = byAlias.get(k);
            if (cur && cur !== note) {
                byAlias.delete(k);
                aliasCollide.add(k);
            } else if (!cur) {
                byAlias.set(k, note);
            }
        }
    }

    const types = new Set(notes.map((n) => n.type));

    // A foreign package may use a type this tree has never seen, so its types
    // join `types` — otherwise `readQualifier` reads the link as prose and it
    // is never checked at all.
    const localPackages = new Set([pkg]);
    const foreign =
        manifestDir ?
            loadForeignManifests(manifestDir, localPackages)
        :   { index: new Map(), packages: new Set(), stale: [] };
    for (const v of foreign.index.values()) if (v.type) types.add(v.type);

    const packages = new Set([
        ...(byKey.size ? [pkg] : []),
        ...foreign.packages,
    ]);

    /** The searchable universe a `dataview` table draws its rows from. */
    const tableDocs = notes.map((n) => ({
        // Package present for a `WHERE … package = "…"` clause, synthesised
        // rather than authored — see {@link searchableFrontmatter} (#56).
        fm: searchableFrontmatter(n.fm, pkg),
        path: n.rel,
        tld: n.rel.split("/")[0],
        folder: path.dirname(n.rel).split("/").pop(),
    }));

    const anchors = new Map(notes.map((n) => [n, anchorsOf(n.body)]));

    /**
     * Every wikilink in a note body, with its `dataview` tables expanded.
     *
     * @param {object} note - A note from this index.
     * @returns {Array<{target: string, anchor: string, text: string,
     *   occurrence: number}>} `target` is `""` for a same-page `[[#anchor]]`.
     */
    function linksOf(note) {
        let body = note.body;
        if (/^[ \t]*(?:`{3,}|~{3,})[ \t]*dataview\b/im.test(body)) {
            body = expandContentTables(body, {
                // Unfiltered: every note in the tree is this package's, so
                // there is no other package's note to exclude (#56).
                docs: tableDocs,
                linkable: (d) => Boolean(d.fm.shortcode),
                source: note.file,
            }).markdown;
        }
        const out = [];
        // How many times each authored link has been seen, so two identical
        // links in one note are reported at their own positions.
        const seen = new Map();
        // Code is verbatim, so a `[[…]]` inside a fence, an indented block or
        // an inline span is not a link — the compilers make none of it either.
        for (const [all, rawInner] of matchAllOutsideCode(
            body,
            new RegExp(WIKILINK.source, "g"),
        )) {
            const { target, anchor } = parseWikilink(rawInner);
            const occurrence = (seen.get(all) ?? 0) + 1;
            seen.set(all, occurrence);
            // `text` is the link exactly as authored, which is what locates it
            // in the file. A link a table generated is not in the file at all,
            // so the search simply fails and a finding names the file.
            out.push({ target, anchor, text: all, occurrence });
        }
        return out;
    }

    /**
     * Resolve a link target the way both builds do, or `undefined`.
     *
     * The qualifier is read with {@link readQualifier} rather than a second
     * copy of the rule, so this cannot drift from what the builds do — the two
     * separators, the first-hyphen split, and the known-type condition that
     * keeps a hyphenated *name* an alias.
     *
     * That condition is why the type-scoped alias index is not enough alone: it
     * reaches only a target of the source's **own** type, so a cross-type
     * `[[type-shortcode#anchor]]` would resolve to nothing and its anchor go
     * unchecked — silently, since an unresolvable target is treated as
     * external.
     *
     * @param {object} note - The note the link is written in.
     * @param {string} target - The link target.
     * @returns {object|undefined} The note it addresses.
     */
    function resolve(note, target) {
        const direct =
            byAlias.get(`${note.type}|${target}`.toLowerCase()) ??
            byKey.get(target.toLowerCase());
        if (direct) return direct;
        const qualified = readQualifier(target, types, packages);
        if (!qualified || qualified.reason) return undefined;
        return byKey.get(
            qualified.package ?
                canonicalKey(
                    qualified.package,
                    qualified.type,
                    qualified.shortcode,
                )
            :   `${qualified.type}/${qualified.shortcode}`.toLowerCase(),
        );
    }

    /**
     * The manifest entry a qualified address names in another package, or null.
     *
     * @param {string} target - The link target.
     * @returns {object|null} The foreign entry.
     */
    function manifestHit(target) {
        const q = readQualifier(target, types, packages);
        if (!q || q.reason) return null;
        if (q.package) {
            return (
                foreign.index.get(
                    canonicalKey(q.package, q.type, q.shortcode),
                ) ?? null
            );
        }
        // A bare address names no package, so it resolves against any foreign
        // one that publishes it. Claimed by two, it is ambiguous and the author
        // must write the qualified form.
        const type = String(q.type).toLowerCase();
        const shortcode = String(q.shortcode).toLowerCase();
        const hits = [...foreign.index].filter(([k]) => {
            const parts = readCanonicalKey(k);
            return parts?.type === type && parts.shortcode === shortcode;
        });
        return hits.length === 1 ? hits[0][1] : null;
    }

    return {
        notes,
        frontmatterLinks,
        anchors,
        types,
        packages,
        foreign,
        manifests: manifestsComplete(localPackages, foreign.packages),
        linksOf,
        resolve,
        manifestHit,
        /** Whether a target reads as a qualified address at all. */
        isAddress: (target) => Boolean(readQualifier(target, types, packages)),
    };
}

/**
 * Every link in a tree that lands nowhere.
 *
 * @param {ReturnType<typeof buildLinkIndex>} index - The built index.
 * @returns {{deadAnchors: object[], deadAddresses: object[],
 *   frontmatterLinks: object[], usedManifest: Set<string>}} The findings, and
 *   which addresses a foreign manifest answered.
 */
export function auditLinks(index) {
    const { notes, anchors, linksOf, resolve, manifestHit, isAddress } = index;

    const deadAnchors = [];
    for (const note of notes) {
        for (const { target, anchor, text, occurrence } of linksOf(note)) {
            if (!anchor) continue;
            const dest = target ? resolve(note, target) : note;
            // An unresolvable target is an external reference, not this
            // check's business.
            if (!dest) continue;
            if (!anchors.get(dest).has(slugify(anchor))) {
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
    const usedManifest = new Set();
    for (const note of notes) {
        for (const { target, text, occurrence } of linksOf(note)) {
            if (!target) continue; // a same-page `[[#anchor]]`
            // Only a *qualified* target is an address. A bare `[[Name]]` that
            // finds nothing is a worldbuilding placeholder by long-standing
            // convention, and is deliberately left alone.
            if (!isAddress(target)) continue;
            if (resolve(note, target)) continue;
            // A manifest answers with the target package's own build output
            // rather than a reviewed guess.
            if (manifestHit(target)) {
                usedManifest.add(target.toLowerCase());
                continue;
            }
            deadAddresses.push({ note, target, text, occurrence });
        }
    }

    return {
        deadAnchors,
        deadAddresses,
        frontmatterLinks: index.frontmatterLinks,
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
        throw new Error(
            `no note at ${root}, so the corpus has no page to be read from`,
        );
    }

    const reached = new Set([rootNote]);
    const queue = [rootNote];
    while (queue.length) {
        const note = queue.shift();
        if (stopAt(note)) continue;
        for (const { target } of index.linksOf(note)) {
            if (!target) continue;
            const dest = index.resolve(note, target);
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
