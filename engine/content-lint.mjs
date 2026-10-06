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
 * These rules do not live in a consumer's `utils/`, which has two
 * consequences and no upside. `thalorna` and `kethira` notes were checked
 * by nothing at all, so the packages most likely to carry authoring mistakes
 * were the ones nothing inspected. And one rule with two implementations can
 * disagree without anything detecting it, which the canonical-separator
 * handling already did once on each side.
 *
 * Four rules, all about a note's identity:
 *
 * 1. **Shape** — a `shortcode` is strictly lowercase ASCII-alphanumeric. It is
 *    the identity key referenced from saved world data, and it is half of the
 *    `type-shortcode` address, whose parse depends on the separating hyphen
 *    being the only hyphen in the string.
 * 2. **Uniqueness** — `(type, shortcode)` names one note.
 * 3. **The package's own address** — exactly one note claims `/<package>/`,
 *    which is {@link checkHomepageCount}. It belongs here for the same
 *    reason the other two do: it is a statement about which note holds which
 *    address, it needs no `site:` configuration to decide, and a package with
 *    no front page is misconfigured whether or not anyone runs a site build.
 * 4. **The vocabulary a package's kind leaves it** — a package compiling no
 *    Foundry documents publishes `doc` and `homepage` notes and nothing else.
 *    It is here rather than with the claim check in `note-claims.mjs` because
 *    that check runs at compile, and this is the case where no compile runs.
 *
 * **Nothing here writes.** A check reports and an author fixes.
 *
 * **There is deliberately no third rule** requiring every note to repeat its
 * own `type-shortcode` address in a top-level `aliases:` list. It would serve
 * no build reader: both resolvers parse the hyphen
 * qualifier themselves. The field is retired, refused from
 * `retired-fields.mjs`.
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

import { ADDRESS_SEGMENT_PATTERN } from "./address-charset.mjs";
// The kind that compiles nothing, and the vocabulary that leaves a tree with.
import { DOCUMENTATION_KIND, compilesFoundryDocuments } from "../content-config.mjs";
import { DOCUMENTATION_NOTE_TYPES } from "./note-claims.mjs";
import { positionInFrontmatter } from "./diagnostics.mjs";
import { assertStatedScope } from "./helpers.mjs";
// The corpus, read from the one pass that derives it.
import { authoredFrontmatter, indexRecordsFor, isNoteRecord, noteFile } from "./content-index.mjs";
import { checkHomepageCount, isHomepage } from "./homepage.mjs";

/**
 * The shape every `shortcode` must match: lowercase ASCII letters and digits
 * only.
 *
 * This is {@link ADDRESS_SEGMENT_PATTERN}, not a second copy of it. A shortcode
 * is the last segment of a canonical address, and the rule it is held to is the
 * rule *every* segment is held to — so the two are one constant rather than two
 * free to drift apart. The name survives because this is where the rule
 * is applied to a note.
 *
 * Case is held to that rule with no exception: two shortcodes differing only
 * in case are two names nobody can tell apart, and `canonicalKey` lowercases
 * every address it builds regardless, so a mixed-case shortcode addresses the
 * same document as its lowercase spelling.
 *
 * A consuming system's *runtime* keeps its own copy of this pattern — it cannot
 * import a build-time dependency into shipped code — and is expected to pin the
 * two together with a test rather than trust that they still agree.
 */
export const SHORTCODE_PATTERN = ADDRESS_SEGMENT_PATTERN;

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
 * Collect the notes a lint pass reasons about, from the content index.
 *
 * Only notes carrying a `type` are content notes. Vault scaffolding —
 * `Templates/`, a `README`, a repository's own `CLAUDE.md` — has no type, is
 * neither addressed nor addressable, and would fail rules it can never satisfy.
 *
 * **Read from the index, not from a walk of this pass's own**. The
 * `lint` command already derives the index — its link check and its `sql`
 * tables are built from it — and then walked the tree a second time to get
 * here, so one command held two answers to "which files are the corpus?" and
 * compared findings drawn from both. It now holds one: the records are derived
 * once by the command and handed to every pass, this one included.
 *
 * The frontmatter is the note's own, recovered with
 * {@link module:engine/content-index.authoredFrontmatter} — a lint of what an
 * author wrote must not be handed the keys the index derived, or it would
 * report `address:` and `anchors:` as fields nobody may write.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} [opts]
 * @param {readonly string[]} [opts.skipDirectories] - The corpus scope, stated
 *   by the caller.
 * @param {object} [opts.config] - The resolved build configuration.
 * @param {readonly object[]} [opts.records] - Records the caller derived.
 * @param {object[]} [opts.problems] - Collects the notes the index cannot
 *   record, so one of them does not silence the lint.
 * @returns {Array<{fm: object, absPath: string, file: string}>} The notes, in
 *   path order so findings read top to bottom.
 */
function collectNotes(contentBase, { skipDirectories, config, records, problems } = {}) {
    const notes = [];
    const corpus =
        records ??
        (assertStatedScope(skipDirectories, "collectNotes"),
        fs.existsSync(contentBase) ?
            indexRecordsFor({ contentBase, config, skipDirectories, problems })
        :   []);

    for (const record of corpus) {
        // A documentation journal is a document this tree emits, not a note in
        // it: it has no authored frontmatter for a lint to reason about.
        if (!isNoteRecord(record) || !record.type) continue;
        const absPath = noteFile(contentBase, record);
        notes.push({
            fm: authoredFrontmatter(record),
            absPath,
            file: path.relative(process.cwd(), absPath),
        });
    }
    for (let i = (problems?.length ?? 0) - 1; i >= 0; i--) {
        const problem = problems[i];
        if (!problem.identity) continue;
        notes.push({
            fm: problem.identity,
            absPath: problem.file,
            file: path.relative(process.cwd(), problem.file),
        });
        problems.splice(i, 1);
    }
    // The records already come in content-path order, so this only re-states
    // the guarantee findings depend on: they read top to bottom.
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
 * @param {object} [opts.config] - The resolved build configuration, which the
 *   corpus is derived against.
 * @param {readonly object[]} [opts.records] - Index records the caller already
 *   derived, so a command reads one corpus.
 * @param {object[]} [opts.problems] - Collects the notes the index cannot
 *   record, instead of letting one of them silence the lint.
 * @returns {{findings: Array<{file: string, line?: number, column?: number,
 *   severity: "error"|"warning", message: string}>, notes: number,
 *   keys: number}} The findings, and what was inspected to produce them.
 */
export function lintContentTree(
    contentBase,
    { skipDirectories, contentPackage, config, records, problems = [] } = {},
) {
    const findings = [];
    const notes = collectNotes(contentBase, { skipDirectories, config, records, problems });
    // Whether this package's note vocabulary is the narrowed one. Asked of the
    // configuration once rather than per note, and defaulted to the wide
    // vocabulary when a caller supplies none — an unconfigured lint holds a
    // tree to the rules every package shares.
    const narrowed =
        Boolean(config) && !compilesFoundryDocuments(/** @type {{packageKind: string}} */ (config));

    /** @type {Map<string, Array<{file: string, absPath: string}>>} */
    const byKey = new Map();
    for (const note of notes) {
        const { fm, absPath, file } = note;
        const shortcode = fm.shortcode;

        // Read only when there is something to say about the note, so a clean
        // tree costs one pass rather than two.
        const raw = () => fs.readFileSync(absPath, "utf8");

        // Rule 4, and it is the whole of the check for a package that compiles
        // nothing: no pass downstream would report the note, because the pass
        // that reports an unclaimed type is a compile pass and none runs.
        const type = typeof fm.type === "string" ? fm.type.trim() : "";
        if (narrowed && type && !DOCUMENTATION_NOTE_TYPES.has(type)) {
            findings.push({
                file,
                ...positionInFrontmatter(raw(), "type", type),
                severity: "error",
                message:
                    `\`type: ${type}\` compiles to a Foundry document, and a ` +
                    `\`${DOCUMENTATION_KIND}\` package compiles none — so the ` +
                    `note has no destination. Its vocabulary is ` +
                    `${[...DOCUMENTATION_NOTE_TYPES].map((t) => `\`${t}\``).join(" and ")}`,
            });
        }

        // Folder documents and keyless entries carry no address at all.
        if (!shortcode) continue;

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
                    `shortcode "${shortcode}" is not strictly alphanumeric — ` +
                    `lowercase letters and digits only (${ADDRESS_SEGMENT_PATTERN.source}); it ` +
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
    // The state that catches is an **empty walk**, not an empty key set.
    // Notes may be keyless: a folder document carries no `shortcode`, and a
    // tree of them is populated, correct, and unkeyed. Reporting that as a
    // missing checkout trains its author to stop reading the output — the one
    // thing this guard needs them to do. A tree holding notes is therefore a
    // tree; only a tree holding none is the absent one.
    //
    // A tree containing only a homepage still contains one note.
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
