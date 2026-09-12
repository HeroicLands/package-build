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
 * The shape of a content-index record, and the accessors every reader of one
 * needs.
 *
 * **Why these live apart from the index that builds them.** Deriving records
 * reaches the pack router and the manifest emitter, and those reach the
 * compilers — so a module the compilers load cannot import
 * `engine/content-index.mjs` without closing a cycle, and
 * `engine/helpers.mjs` is exactly such a module. But nothing about *reading* a
 * record needs any of that machinery: these are pure functions over a plain
 * object, and `node:path` is the whole of their dependency.
 *
 * So the accessors sit here, where every reader can reach them, and
 * `engine/content-index.mjs` re-exports them — it is where callers have always
 * addressed them, and the split is an implementation detail of the import
 * graph rather than a second place to look.
 *
 * @module
 */

import path from "node:path";

/**
 * The keys the content index adds to a record, which a note therefore may not
 * carry itself.
 *
 * `package` is the note's distribution unit — the configured `contentPackage`,
 * since a note declaring its own is a hard error — and it matches what
 * the content-table expander puts on the same field, so a query reads the same
 * value from either. `file` namespaces the note's place in the tree, again
 * matching the expander's `file.*`.
 *
 * Both are checked rather than assumed: `folder` is real frontmatter on most
 * notes, so the neighbouring names are close enough to a real key that a silent
 * overwrite is a plausible future rather than a hypothetical one.
 *
 * @type {ReadonlyArray<string>}
 */
export const DERIVED_KEYS = Object.freeze([
    "package",
    "file",
    "address",
    "anchors",
    "nameAscii",
    "aliasesAscii",
    "foundry",
    "documentation",
    "documents",
]);

/**
 * The file a record was read from, as an absolute path.
 *
 * **The one composition, because there were four.** `file.path` is recorded
 * *relative* to the content root deliberately — an absolute one is a fact about
 * the machine that built the index, would differ between two checkouts of the
 * same tree, and would put someone's home directory in a published artifact. So
 * every pass that reads the index and then needs to open a note has to compose
 * the absolute form, and each of the readers converted for #243 had written its
 * own `path.join(base, ...record.file.path.split("/"))`. Four copies of one
 * rule is what #243 exists to remove, so here it is once.
 *
 * The split is on `"/"` rather than `path.sep` because the recorded path is
 * always POSIX — that is what makes the index identical on every platform.
 *
 * @param {string} contentBase - Root of the content tree the index was built from.
 * @param {object} record - An index record.
 * @returns {string} The note's absolute path.
 */
export function noteFile(contentBase, record) {
    return path.join(contentBase, ...String(record?.file?.path ?? "").split("/"));
}

/**
 * The note's own frontmatter, as authored, from an index record.
 *
 * The inverse of the record's spread, and exact rather than best-effort: a
 * record is the note's frontmatter plus {@link DERIVED_KEYS}, and a note that
 * authors one of those keys fails the walk — so removing them cannot remove
 * anything the note wrote. That enforced pairing is what lets a pass read the
 * corpus from the index and still lint, route or compile what the *author*
 * typed, rather than reasoning about `address:` and `anchors:` as though
 * someone had written them.
 *
 * Lives beside the list it is the inverse of, so the two cannot drift.
 *
 * @param {Record<string, any>} record - An index record.
 * @returns {Record<string, any>} The frontmatter, without the derived keys.
 */
export function authoredFrontmatter(record) {
    const fm = {};
    for (const [key, value] of Object.entries(record ?? {})) {
        if (!DERIVED_KEYS.includes(key)) fm[key] = value;
    }
    return fm;
}

/**
 * Whether a record is a note's, rather than a documentation journal's.
 *
 * An item note yields two records — itself and the JournalEntry its prose
 * compiles into — and the second is a document, not a note: it has no file of
 * its own to read, no frontmatter an author wrote, and its `type` is the
 * virtual `doc<type>` that `readQualifier` resolves rather than a type any tree
 * declares. A reader enumerating the corpus wants the notes; one resolving an
 * address wants both.
 *
 * @param {Record<string, any>} record - An index record.
 * @returns {boolean} True for a note's own record.
 */
export function isNoteRecord(record) {
    return !record?.documents;
}
