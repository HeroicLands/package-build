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
 * Linting a content tree's **addresses** — the rules every package's notes are
 * authored against, wherever those notes live.
 *
 * These rules used to live in the SoHL repository's `utils/`, which had two
 * consequences and no upside (#20). `thalorna` and `kethira` notes were checked
 * by nothing at all, so the packages most likely to carry authoring mistakes
 * were the ones nothing inspected. And one rule with two implementations can
 * disagree without anything detecting it, which the canonical-separator
 * handling already did once on each side.
 *
 * Three rules, all about a note's identity:
 *
 * 1. **Shape** — a `shortcode` is strictly ASCII-alphanumeric. It is the
 *    identity key referenced from saved world data, and it is half of the
 *    `type-shortcode` address, whose parse depends on the separating hyphen
 *    being the only hyphen in the string.
 * 2. **Uniqueness** — `(type, shortcode)` names one note.
 * 3. **The package's own address** — exactly one note claims `/<package>/`,
 *    which is {@link checkHomepageCount} (#52). It belongs here for the same
 *    reason the other two do: it is a statement about which note holds which
 *    address, it needs no `site:` configuration to decide, and a package with
 *    no front page is misconfigured whether or not anyone runs a site build.
 *
 * **Nothing here writes.** A check reports and an author fixes.
 *
 * **A third rule was retired (#79).** Every note used to be required to repeat
 * its own `type-shortcode` address in the top-level `aliases:` list. That
 * served exactly one reader — **Obsidian**, so `[[type-shortcode]]` resolved in
 * the editor — and nothing else ever read it: both resolvers parse the hyphen
 * qualifier themselves, and the alias list feeds only the bare-alias fallback
 * index. The project no longer authors in Obsidian, so the rule required a line
 * of frontmatter per note for a reader that does not exist. Removing it was
 * verified output-neutral beforehand: across 1,735 stripped notes,
 * `package compile` produced byte-identical `build/packs-json` and the site
 * build byte-identical `site/content`.
 *
 * **What is deliberately absent.** Corpus reachability — "every Rules document
 * is reachable from the book's root" — is a statement about what one package
 * publishes, not about the note format, and belongs with the publishing it
 * describes. So do retired hostnames.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { positionInFrontmatter } from "./diagnostics.mjs";
import { walkMarkdownTree } from "./helpers.mjs";
import { checkHomepageCount, isHomepage } from "./homepage.mjs";

/**
 * The shape every `shortcode` must match: ASCII letters and digits only.
 *
 * Case is deliberately **not** constrained: hundreds of authored shortcodes are
 * mixed-case and collide with nothing, so tightening that is a separate
 * decision from this one.
 *
 * A consuming system's *runtime* keeps its own copy of this pattern — it cannot
 * import a build-time dependency into shipped code — and is expected to pin the
 * two together with a test rather than trust that they still agree.
 */
export const SHORTCODE_PATTERN = /^[A-Za-z0-9]+$/;

/**
 * Whether a value is a well-formed shortcode.
 *
 * A blank value is **not** valid here. Blank is handled separately wherever a
 * key is derived from a document's name, so this predicate answers only "is
 * this an acceptable key", never "is this key present".
 *
 * @param {unknown} value - The candidate shortcode.
 * @returns {boolean} `true` when it matches {@link SHORTCODE_PATTERN}.
 */
export function isValidShortcode(value) {
    return typeof value === "string" && SHORTCODE_PATTERN.test(value);
}

/**
 * Collect the notes a lint pass reasons about.
 *
 * Only notes carrying a `type` are content notes. Vault scaffolding —
 * `Templates/`, a `README`, a repository's own `CLAUDE.md` — has no type, is
 * neither addressed nor addressable, and would fail rules it can never satisfy.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} [opts]
 * @param {readonly string[]} [opts.skipDirectories] - Passed to the walk.
 * @returns {Array<{fm: object, absPath: string, file: string}>} The notes, in
 *   path order so findings read top to bottom.
 */
function collectNotes(contentBase, { skipDirectories } = {}) {
    const notes = [];
    const walkOpts = skipDirectories ? { skipDirectories } : undefined;
    for (const { frontmatter: fm, absPath } of walkMarkdownTree(contentBase, walkOpts)) {
        if (!fm || !fm.type) continue;
        notes.push({
            fm,
            absPath,
            file: path.relative(process.cwd(), absPath),
        });
    }
    notes.sort((a, b) => (a.absPath < b.absPath ? -1 : 1));
    return notes;
}

/**
 * Lint every address in a content tree.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} [opts]
 * @param {readonly string[]} [opts.skipDirectories] - Directory names the walk
 *   ignores. Defaults to the configured list.
 * @param {string} [opts.contentPackage] - The package this tree builds, for the
 *   homepage rule. Dropped from that finding when unknown rather than guessed.
 * @returns {{findings: Array<{file: string, line?: number, column?: number,
 *   severity: "error"|"warning", message: string}>, notes: number,
 *   keys: number}} The findings, and what was inspected to produce them.
 */
export function lintContentTree(contentBase, { skipDirectories, contentPackage } = {}) {
    const findings = [];
    const notes = collectNotes(contentBase, { skipDirectories });

    /** @type {Map<string, Array<{file: string, absPath: string}>>} */
    const byKey = new Map();

    for (const { fm, absPath, file } of notes) {
        const shortcode = fm.shortcode;
        // Folder documents and keyless entries carry no address at all.
        if (!shortcode) continue;

        // Read only when there is something to say about the note, so a clean
        // tree costs one pass rather than two.
        const raw = () => fs.readFileSync(absPath, "utf8");

        const key = `${fm.type}:${shortcode}`;
        const seen = byKey.get(key);
        if (seen) seen.push({ file, absPath });
        else byKey.set(key, [{ file, absPath }]);

        if (!isValidShortcode(shortcode)) {
            findings.push({
                file,
                ...positionInFrontmatter(raw(), "shortcode", String(shortcode)),
                severity: "error",
                message:
                    `shortcode "${shortcode}" is not strictly alphanumeric; it ` +
                    `is the identity key and half of the ` +
                    `"${fm.type}-${shortcode}" address, whose parse needs the ` +
                    `separator to be the only hyphen`,
            });
        }
    }

    // "Every one of nothing is unique" is a vacuous pass, and it is exactly
    // what a tree that failed to check out produces — so the lint would go
    // green on the one state it most needs to catch.
    //
    // The state that catches is an **empty walk**, not an empty key set (#77).
    // A note may be keyless by design: a homepage carries no `shortcode`
    // because it is addressed by the package rather than by a slug, so a
    // package in `publish.site: homepage` mode has a content tree that is
    // populated, correct, and permanently unkeyed. Reporting that as a missing
    // checkout trains its author to stop reading the output — the one thing
    // this guard needs them to do. A tree holding notes is therefore a tree;
    // only a tree holding none is the absent one.
    if (notes.length === 0) {
        findings.push({
            file: path.relative(process.cwd(), contentBase) || contentBase,
            severity: "error",
            message:
                "holds no content notes, so every rule here is vacuous — " +
                "check that the content tree is present and that this is its root",
        });
        return { findings, notes: 0, keys: 0 };
    }

    // Deliberately after that return: a tree nobody has established exists has
    // no homepage either, and saying so is noise about the second problem when
    // the first is "check that the content tree is present".
    findings.push(
        ...checkHomepageCount(
            notes.filter((n) => isHomepage(n.fm)),
            { contentBase, contentPackage },
        ),
    );

    for (const [key, files] of byKey) {
        if (files.length < 2) continue;
        // Reported once per offending note rather than once per key: each note
        // is a place an author has to go and edit, and a finding naming only
        // the key sends them hunting for the other one.
        for (const { file, absPath } of files) {
            const others = files.filter((f) => f.file !== file).map((f) => f.file);
            findings.push({
                file,
                ...positionInFrontmatter(fs.readFileSync(absPath, "utf8"), "shortcode"),
                severity: "error",
                message:
                    `duplicate address "${key}", also declared by ` +
                    `${others.join(", ")}; a document is addressed by ` +
                    `(type, shortcode) across every pack of its document type, ` +
                    `so routing them to different packs does not separate them`,
            });
        }
    }

    return { findings, notes: notes.length, keys: byKey.size };
}
