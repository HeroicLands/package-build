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
 * Four rules, all about a note's identity:
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
 * 4. **Vacated addresses** — a `renamedFrom:` entry names an address this note
 *    used to hold and nothing holds now (#278). It is the same statement as
 *    rule 2 read backwards, and it needs the same whole-tree view: an entry can
 *    only be checked against every *other* note's address, and two notes
 *    claiming one predecessor is the uniqueness rule applied to the past.
 *
 * **Nothing here writes.** A check reports and an author fixes.
 *
 * **A third rule was retired (#79).** Every note used to be required to repeat
 * its own `type-shortcode` address in the top-level `aliases:` list. That
 * served exactly one reader — **Obsidian**, so `[[type-shortcode]]` resolved in
 * the editor — and nothing else ever read it: both resolvers parse the hyphen
 * qualifier themselves. The project no longer authors in Obsidian, so the rule
 * required a line of frontmatter per note for a reader that does not exist. The
 * field itself is retired now (#180), refused from `retired-fields.mjs`. Removing it was
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

import { ADDRESS_SEGMENT_PATTERN } from "./address-charset.mjs";
import { positionInFrontmatter } from "./diagnostics.mjs";
import { assertStatedScope } from "./helpers.mjs";
// The corpus, read from the one pass that derives it (#243).
import { authoredFrontmatter, indexRecordsFor, isNoteRecord } from "./content-index.mjs";
import { checkHomepageCount, isHomepage } from "./homepage.mjs";
import { declaresRenamedFrom, renamedFrom, renamedFromEntries } from "./note-renames.mjs";

/**
 * The shape every `shortcode` must match: ASCII letters and digits only.
 *
 * This is {@link ADDRESS_SEGMENT_PATTERN}, not a second copy of it. A shortcode
 * is the last segment of a canonical address, and the rule it is held to is the
 * rule *every* segment is held to — so the two are one constant rather than two
 * free to drift apart (#59). The name survives because this is where the rule
 * is applied to a note.
 *
 * Case is deliberately **not** constrained: hundreds of authored shortcodes are
 * mixed-case and collide with nothing, so tightening that is a separate
 * decision from this one.
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
 * **Read from the index, not from a walk of this pass's own** (#243). The
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
        const absPath = path.join(contentBase, ...String(record.file.path).split("/"));
        notes.push({
            fm: authoredFrontmatter(record),
            absPath,
            file: path.relative(process.cwd(), absPath),
        });
    }
    // The records already come in content-path order, so this only re-states
    // the guarantee findings depend on: they read top to bottom.
    notes.sort((a, b) => (a.absPath < b.absPath ? -1 : 1));
    return notes;
}

/**
 * What one note's `renamedFrom:` says, checked against itself (#278).
 *
 * The entries a note can be wrong about on its own: a value that is not a
 * shortcode, one naming the address the note holds *now*, one written twice.
 * Every one of them is silent without a check — a malformed entry is skipped by
 * the diff, so the author who wrote it sees the rename they were trying to
 * announce reported as a withdrawal anyway, with nothing saying why.
 *
 * The cross-note questions are not here, because one note cannot answer them:
 * whether an entry names an address some *other* note still publishes, and
 * whether two notes claim one predecessor, both need the whole tree and are
 * asked in {@link lintContentTree} once it has one.
 *
 * @param {object} note - The note, as {@link collectNotes} yields it.
 * @param {() => string} raw - Reads the file, deferred so a clean note costs
 *   nothing.
 * @returns {Array<object>} The findings.
 */
function checkRenamedFrom({ fm, file }, raw) {
    if (!declaresRenamedFrom(fm)) return [];
    const findings = [];
    const at = (value) => positionInFrontmatter(raw(), "renamedFrom", value);
    const shortcode = typeof fm.shortcode === "string" ? fm.shortcode.trim() : "";

    // A rename is a statement about where this note's address moved *to*, so a
    // note with no address of its own has made no such statement. Reported
    // before the entries: telling the author their entries are fine would be
    // the less useful half of the answer.
    if (!shortcode) {
        return [
            {
                file,
                ...at(undefined),
                severity: "error",
                message:
                    "`renamedFrom` names the address this note used to hold, " +
                    "but the note declares no `shortcode`, so it holds none now " +
                    "and nothing was renamed",
            },
        ];
    }

    const seen = new Set();
    for (const entry of renamedFromEntries(fm)) {
        // Not `String(entry)`: the point is that the author wrote something
        // that is not a shortcode, and rendering a list as `a,b` would show
        // them a string they never typed.
        if (typeof entry !== "string" || !entry.trim()) {
            findings.push({
                file,
                ...at(undefined),
                severity: "error",
                message:
                    `\`renamedFrom\` takes shortcodes, and one entry is ` +
                    `${entry === "" || (typeof entry === "string" && !entry.trim()) ? "blank" : `a ${typeof entry}`}; ` +
                    `it is skipped, so the rename it was meant to announce is ` +
                    `still reported as a withdrawal`,
            });
            continue;
        }
        const value = entry.trim();
        if (!isValidShortcode(value)) {
            findings.push({
                file,
                ...at(value),
                severity: "error",
                message:
                    `\`renamedFrom: ${value}\` is not strictly alphanumeric, so ` +
                    `it is not an address this package ever published — a ` +
                    `shortcode is held to one charset whether it is current or past`,
            });
            continue;
        }
        if (value === shortcode) {
            findings.push({
                file,
                ...at(value),
                severity: "error",
                message:
                    `\`renamedFrom: ${value}\` is this note's own shortcode, so ` +
                    `it declares a rename from itself; name the shortcode it ` +
                    `was published under before, or drop the key`,
            });
            continue;
        }
        if (seen.has(value)) {
            findings.push({
                file,
                ...at(value),
                // The declaration still works — the reader de-duplicates — so
                // this is tidiness, and failing a build over it would red a
                // tree whose renames are all correctly announced.
                severity: "warning",
                message: `\`renamedFrom: ${value}\` is listed twice; the repeat says nothing new`,
            });
            continue;
        }
        seen.add(value);
    }
    return findings;
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
 *   derived, so a command reads one corpus (#243).
 * @param {object[]} [opts.problems] - Collects the notes the index cannot
 *   record, instead of letting one of them silence the lint.
 * @returns {{findings: Array<{file: string, line?: number, column?: number,
 *   severity: "error"|"warning", message: string}>, notes: number,
 *   keys: number}} The findings, and what was inspected to produce them.
 */
export function lintContentTree(
    contentBase,
    { skipDirectories, contentPackage, config, records, problems } = {},
) {
    const findings = [];
    const notes = collectNotes(contentBase, { skipDirectories, config, records, problems });

    /** @type {Map<string, Array<{file: string, absPath: string}>>} */
    const byKey = new Map();
    /** @type {Map<string, Array<{file: string, absPath: string, shortcode: string}>>} */
    const claimedPredecessors = new Map();

    for (const note of notes) {
        const { fm, absPath, file } = note;
        const shortcode = fm.shortcode;

        // Read only when there is something to say about the note, so a clean
        // tree costs one pass rather than two.
        const raw = () => fs.readFileSync(absPath, "utf8");

        // Before the keyless `continue` below, because a note declaring a
        // rename while carrying no address of its own is exactly one of the
        // things this reports — and reaching it after the skip would mean it
        // never ran on the case that needs it most.
        findings.push(...checkRenamedFrom(note, raw));
        if (shortcode) {
            // The de-duplicated reader, not the raw entries: a note that listed
            // one predecessor twice has made one claim, and indexing it twice
            // would make the note collide with itself and be reported as two
            // notes claiming one address.
            for (const value of renamedFrom(fm)) {
                if (value === shortcode) continue;
                const claim = `${fm.type}:${value}`;
                const seen = claimedPredecessors.get(claim);
                if (seen) seen.push({ file, absPath, shortcode });
                else claimedPredecessors.set(claim, [{ file, absPath, shortcode }]);
            }
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
    // Notes may be keyless: a folder document carries no `shortcode`, and a
    // tree of them is populated, correct, and unkeyed. Reporting that as a
    // missing checkout trains its author to stop reading the output — the one
    // thing this guard needs them to do. A tree holding notes is therefore a
    // tree; only a tree holding none is the absent one.
    //
    // The homepage used to be the headline example, because it was addressed
    // by the package rather than by a slug — so a `publish.site: homepage`
    // package had a tree with exactly one note and no key at all. It carries an
    // address like every other note now (#182); the guard is unchanged, because
    // what it reads was never the key count.
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

    // The two questions about a declared rename that need the whole tree
    // (#278). Both are the uniqueness rule above, applied to the past: an
    // address has one holder, so it has one successor and it cannot be both
    // vacated and occupied.
    for (const [claim, claimants] of claimedPredecessors) {
        const live = byKey.get(claim);
        if (live) {
            for (const { file, absPath } of claimants) {
                findings.push({
                    file,
                    ...positionInFrontmatter(
                        fs.readFileSync(absPath, "utf8"),
                        "renamedFrom",
                        claim.slice(claim.indexOf(":") + 1),
                    ),
                    severity: "error",
                    message:
                        `\`renamedFrom\` claims "${claim}", which ` +
                        `${live.map((f) => f.file).join(", ")} still publishes; ` +
                        `that address was never vacated, so nothing was renamed ` +
                        `away from it`,
                });
            }
        }
        if (claimants.length < 2) continue;
        // Named on every claimant rather than once on the address, for the same
        // reason a duplicate address is: each is a file an author has to open,
        // and a finding naming only the address sends them hunting for the rest.
        for (const { file, absPath, shortcode } of claimants) {
            const others = claimants.filter((c) => c.file !== file);
            findings.push({
                file,
                ...positionInFrontmatter(
                    fs.readFileSync(absPath, "utf8"),
                    "renamedFrom",
                    claim.slice(claim.indexOf(":") + 1),
                ),
                severity: "error",
                message:
                    `"${claim}" is claimed as a predecessor by more than one ` +
                    `note — this one (now "${shortcode}") and ` +
                    `${others.map((c) => `${c.file} (now "${c.shortcode}")`).join(", ")}; ` +
                    `an address had one holder, so it has one successor`,
            });
        }
    }

    return { findings, notes: notes.length, keys: byKey.size };
}
