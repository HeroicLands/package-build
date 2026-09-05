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
 *    is a typo. So is a target that does not parse as an address at all.
 * 3. **An unlabelled link.** `[[x]]` addresses nothing: the alias namespace it
 *    used to name is retired (#180), and a shortcode is an address rather than
 *    prose, so the link has neither a resolvable target nor text to show. The
 *    correction is always `[[type-shortcode|Text]]`.
 * 4. **A wikilink authored in frontmatter.** Both builds walk a note's *body*
 *    and copy frontmatter through verbatim, so a link written in a
 *    `description` is never resolved and publishes as literal `[[…]]` text.
 *    Frontmatter is data: a `WikiLink` field is parsed by the address grammar
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
 * link graph returned here rather than implemented here (#20).
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { matchAllOutsideCode } from "./code-fences.mjs";
import { expandContentTables } from "./content-tables.mjs";
import { walkMarkdownTree } from "./helpers.mjs";
import { collectAnchors } from "./anchors.mjs";
import { hasDocEntry } from "./item-docs.mjs";
import { contentPackage } from "./content-package.mjs";
import { searchableFrontmatter } from "./note-package.mjs";
import {
    canonicalKey,
    loadForeignManifests,
    manifestsComplete,
    PACKAGE_BASE,
    readCanonicalKey,
} from "./kb-manifest.mjs";
import { frontmatterWikilinks, slugify } from "./web-wikilinks.mjs";
import { homepageAddresses, isHomepage } from "./homepage.mjs";
import { RETIRED_TYPES } from "./ids.mjs";
import { parseWikilink, WIKILINK } from "./wikilink-syntax.mjs";
import { readQualifier } from "./wikilinks.mjs";

/**
 * Every `{#anchor}` a note declares on a heading.
 *
 * **Read from the content index's reader, not a second one.** This module kept
 * its own until #243, and the two disagreed: it matched `{#([a-z0-9-]+)}` while
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
export function buildLinkIndex(contentBase, { manifestDir, skipDirectories } = {}) {
    const notes = [];
    const frontmatterLinks = [];
    const walkOpts = skipDirectories ? { skipDirectories } : undefined;

    for (const { frontmatter: fm, absPath } of walkMarkdownTree(contentBase, walkOpts)) {
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

    const packages = new Set([...(byKey.size ? [pkg] : []), ...foreign.packages]);

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
     *   occurrence: number, labelled: boolean}>} `target` is `""` for a
     *   same-page `[[#anchor]]`; `labelled` says whether the link carries the
     *   `|` every link must have (#180).
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
     * @returns {object|undefined} The note it addresses.
     */
    function resolveAddress(target) {
        const qualified = readQualifier(target, types, packages);
        if (!qualified || qualified.reason) return undefined;
        return byKey.get(
            qualified.package ?
                canonicalKey(qualified.package, qualified.type, qualified.shortcode)
            :   `${qualified.type}/${qualified.shortcode}`.toLowerCase(),
        );
    }

    /**
     * Every foreign manifest entry an address names, in package order.
     *
     * A **package-qualified** address names at most one, by construction. An
     * unqualified one names no package, so it resolves against any foreign one
     * that publishes it — and only when exactly one does. Two claimants make it
     * ambiguous, which is a different finding from resolving nowhere and has a
     * different fix, so the count is returned rather than collapsed here
     * (#184).
     *
     * @param {string} target - The link target.
     * @returns {object[]} The foreign entries, each carrying its `package`.
     */
    function foreignHits(target) {
        const q = readQualifier(target, types, packages);
        if (!q || q.reason) return [];
        if (q.package) {
            const one = foreign.index.get(canonicalKey(q.package, q.type, q.shortcode));
            return one ? [one] : [];
        }
        const type = String(q.type).toLowerCase();
        const shortcode = String(q.shortcode).toLowerCase();
        return [...foreign.index]
            .filter(([k]) => {
                const parts = readCanonicalKey(k);
                return parts?.type === type && parts.shortcode === shortcode;
            })
            .map(([, v]) => v);
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

    return {
        notes,
        frontmatterLinks,
        anchors,
        types,
        packages,
        /**
         * The one package this tree publishes. Distinct from `packages`, which
         * is the set an address may name and which a homepage-only tree leaves
         * this package out of, having no keyed note to put it there.
         */
        contentPackage: pkg,
        foreign,
        manifests: manifestsComplete(localPackages, foreign.packages),
        linksOf,
        /**
         * Resolve a link target the way both builds do, or `undefined`. Every
         * link is an address, so this is {@link resolveAddress} under the name
         * the walkers use (#180).
         */
        resolve: resolveAddress,
        resolveAddress,
        manifestHit,
        foreignHits,
        /** Whether a target reads as a qualified address at all. */
        isAddress: (target) => Boolean(readQualifier(target, types, packages)),
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
 * Every package landing this build can name, as `package` → base (#87).
 *
 * **A landing needs no manifest, and that is what makes it work.** The link
 * manifest indexes content notes, and a homepage is deliberately not one — it
 * compiles to no document and is entered in no manifest. The reading that
 * follows from this, and that left a hardcoded URL as the only authored form,
 * is that a landing therefore cannot be addressed. It does not follow: a
 * landing's address is not a *note's* address but the **package's**, and
 * {@link PACKAGE_BASE} already records where each package is served. That is a
 * frozen constant vendored into every repository, so consulting it walks no
 * tree, reads no manifest and builds no index — which is precisely why the
 * mechanism survives `homepage` mode, where the licensing fence means none of
 * those exist.
 *
 * The roster is consulted **for landings only**. Widening the package set the
 * other rules read would make them offer manifest-based advice about packages
 * no manifest is vendored for.
 *
 * @param {string} ownPackage - The package this build publishes.
 * @param {Iterable<string>} manifestPackages - Packages a vendored manifest
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
 * So a landing addresses the web the way the web does — markdown links and
 * `url:` fields — and nothing was looking at those. SoHL's landing pointed at
 * `kb/creature/` and `kb/character/` from the day those types merged into
 * `being`: two 404s on the package's front page, through every build.
 *
 * **What is checkable, stated plainly.** Only an address into this site is, and
 * only against facts this build already holds:
 *
 * - A **retired content type** in the path. The engine knows what used to exist
 *   and what replaced it, so this is a fact rather than a guess — and it is
 *   exactly the SoHL defect.
 * - A **hardcoded absolute URL** into this package's own prefix, or into one a
 *   vendored manifest names. Every one of them has a better form to write, which
 *   is why every one is reported — including a bare `/<package>/`, which names
 *   another package's landing (#87).
 *
 *   That last case was exempt until the better form was identified, on the
 *   reasoning that a landing is in no link manifest so nothing could resolve it.
 *   True, and beside the point: it does not need resolving. A landing's address
 *   *is* its package prefix, so `/<package>/` is the absolute URL with the host
 *   struck off — host-free, emitted verbatim, and needing no index, which is
 *   what lets it hold in homepage-only mode where the tree is never walked. The
 *   form was already accepted here; nothing had ever named it as the one to use.
 * - A **root-relative `url:`**, which the theme's `relURL` prefixes a second
 *   time. `href:` means "already resolved, use verbatim", so the same leading
 *   slash is correct there and is not reported.
 * - A **wikilink**, which nothing on this page will ever resolve.
 *
 * **What is not checkable, and is not attempted.** Whether an external URL
 * answers — there is no network at build time, and a build must not fail because
 * a third party is down. And whether a live in-site address names a page that
 * exists: several of the surfaces a landing routes to are produced by other
 * tools entirely (generated API documentation, hand-authored Hugo sections), so
 * this build does not hold the set of published pages and would report a working
 * link as dead.
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

        for (const { field, url, kind } of homepageAddresses(note.fm, note.body)) {
            // Counted for every address, checked or not, so the count is
            // the literal's nth appearance in the file rather than the nth
            // *finding* about it — two rules can fire on one address.
            const occurrence = at(url);
            const address = readAddress(url, packages);
            if (!address) continue;
            const { shape, segments, prefix } = address;

            // Landings first, and by the roster rather than by the manifest
            // package set: a landing is addressable in a repository that
            // vendors no manifest at all, which is the case the fence creates
            // and the case this rule exists for (#87).
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
                            `"${rest}/", which the landing resolves ` +
                            `against the site so the page follows the mount`
                    :   `hardcoded absolute URL into package "${prefix}" ` +
                            `— resolve it through that package's link ` +
                            `manifest, whose entries carry the address, so a ` +
                            `relocation does not leave this page behind`,
                );
            } else if (shape === "rooted" && kind === "url") {
                const rest = prefix ? segments.slice(1).join("/") : segments.join("/");
                report(
                    field,
                    url,
                    url,
                    occurrence,
                    // A `url:` is package-relative by construction, so it
                    // cannot address anything outside this package at all —
                    // there is no relative spelling of another package's root.
                    // `href:` is the field for an address already resolved.
                    !rest ?
                        `url "${url}" addresses ` +
                            (prefix ? `package "${prefix}"'s landing` : `the site root`) +
                            `, but a landing's url: is package-relative and ` +
                            `cannot leave this package — write ` +
                            `href: "${url}", which is used verbatim`
                    :   `url "${url}" is root-relative, but a landing's url: ` +
                            `is resolved against the site — write "${rest}/", ` +
                            `or href: for an address that is already resolved`,
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
 * (#180) has to become `[[type-shortcode|Text]]`; a labelled one whose target
 * resolves nowhere has a shortcode to fix. Reporting a bare `[[Name]]` as a
 * dead address would send an author hunting for a note that was never named.
 *
 * @param {ReturnType<typeof buildLinkIndex>} index - The built index.
 * @returns {{deadAnchors: object[], deadAddresses: object[],
 *   unlabelledLinks: object[], frontmatterLinks: object[],
 *   homepageLinks: object[], usedManifest: Set<string>}} The findings, and
 *   which addresses a foreign manifest answered. Each `deadAddresses` entry
 *   carries a `reason` from {@link LINK_FINDING_REASONS} —
 *   `"not-an-address"`, `"unknown-type"`, `"ambiguous"` (with the claiming
 *   `packages`), or `"unresolved"` — and every one of them is an **error**:
 *   the three resolvers agree on severity for every class (#184).
 */
export function auditLinks(index) {
    const { notes, anchors, linksOf, resolve, manifestHit, isAddress } = index;

    const deadAnchors = [];
    for (const note of notes) {
        for (const { target, anchor, text, occurrence, labelled } of linksOf(note)) {
            if (!anchor || !labelled) continue;
            const dest = target ? resolve(target) : note;
            // An unresolvable target is reported by the pass below; its anchor
            // has nothing to be checked against.
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
    const unlabelledLinks = [];
    const usedManifest = new Set();
    for (const note of notes) {
        for (const { target, anchor, text, occurrence, labelled } of linksOf(note)) {
            // The label is required whatever the link part is, an anchor
            // included — so this is tested before the same-page form (#180).
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
            // A manifest answers with the target package's own build output
            // rather than a reviewed guess.
            const hits = index.foreignHits(target);
            if (hits.length === 1) {
                usedManifest.add(target.toLowerCase());
                continue;
            }
            if (hits.length > 1) {
                // Two packages publish the short address, so it names neither.
                // Reported as its own class: "no document has that identity" is
                // false here — two do — and the fix is the qualified form
                // rather than a corrected shortcode (#184).
                deadAddresses.push({
                    ...at,
                    reason: "ambiguous",
                    packages: hits.map((h) => h.package).filter(Boolean),
                });
                continue;
            }
            const read = readQualifier(target, index.types, index.packages);
            deadAddresses.push({
                ...at,
                reason: read?.reason === "unknown-type" ? "unknown-type" : "unresolved",
            });
        }
    }

    return {
        deadAnchors,
        deadAddresses,
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
