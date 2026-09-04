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
 * Emitting this package's content index (#224).
 *
 * Every content build already walks the whole note tree and parses every note's
 * frontmatter — the pack compilers, the site build, and the content-table
 * expander each do it — and every one of them throws the result away when it
 * finishes. So nothing outside a build can ask a question about the content:
 * "which beings carry no `kbcat`?", "what does this table actually select?",
 * "did that type rename leave anything behind?" have no answer short of writing
 * a throwaway script that re-walks the tree. Eight dead Bestiary tables shipped
 * for weeks behind exactly that gap (#223).
 *
 * This module publishes the walk. One line of JSON per note, in
 * [JSON Lines](https://jsonlines.org/) — the whole frontmatter, plus where the
 * note sits in the tree.
 *
 * **The record is the note, not a projection of it.** Frontmatter is
 * heterogeneous and open: in `sohl` it spreads 242 distinct leaf paths unevenly
 * over 15 types, from 9 on a `macro` to 72 on a `being`, and adding a field to
 * one type is ordinary authoring. Any format that fixes a column set would turn
 * that authoring into a schema migration, so nothing here selects, flattens, or
 * renames — a reader addresses `sohl.body.weight.base` because that is what the
 * note says, which is also, not by accident, exactly what a `dataview` query
 * writes.
 *
 * **JSON Lines rather than a database.** The artifact has to survive its build
 * and be usable by anything — a person with `jq`, an editor, a CI check,
 * another package's build. A line-per-note text file needs no server, no
 * driver, and no schema; it diffs in a pull request, so a migration that
 * quietly empties a category shows up as a diff rather than as a silently
 * different binary; and it is readable by every language without an install.
 * SQL is not forfeited by the choice — DuckDB reads JSON Lines directly, with
 * nested access — whereas a stored schema would forfeit the open shape.
 *
 * **Byte-stable, because it is meant to be rebuilt.** {@link emitContentIndex}
 * is reachable on its own (`content-build content-index`) and costs a
 * frontmatter parse, not a build, so the honest expectation is that anyone
 * regenerates it whenever they want rather than treating it as precious. That
 * only holds if two runs over an unchanged tree produce an identical file, so
 * records are ordered by content path with the note id breaking any tie — the
 * same total order {@link selectRows} imposes for the same reason — and every
 * object's keys are sorted, at every depth. A walk order is a directory-read
 * order, and directory-read order is not a fact about the content.
 *
 * **Derived, never a source.** The index is written under `build/`, is
 * gitignored with the rest of it, and nothing may be authored against it. It is
 * emphatically not in `paths.stage`: that tree is mirrored destructively into a
 * Foundry data root, so anything left there ships inside the installed system
 * to every player, and a build artifact has no business there.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { walkMarkdownTree } from "./helpers.mjs";
import { loadPackConfig } from "./pack-config.mjs";

/**
 * The keys this module adds to a record, which a note therefore may not carry
 * itself.
 *
 * `package` is the note's distribution unit — the configured `contentPackage`,
 * since a note declaring its own is a hard error (package-build#56) — and it
 * matches what the content-table expander puts on the same field, so a query
 * reads the same value from either. `file` namespaces the note's place in the
 * tree, again matching the expander's `file.*`.
 *
 * Both are checked rather than assumed: `folder` is real frontmatter on most
 * notes, so the neighbouring names are close enough to a real key that a silent
 * overwrite is a plausible future rather than a hypothetical one.
 *
 * @type {ReadonlyArray<string>}
 */
export const DERIVED_KEYS = Object.freeze(["package", "file"]);

/**
 * Recursively sort an object's keys, so serialization is order-independent.
 *
 * Arrays keep their order — it is authored — but every object inside one is
 * sorted too. Anything that is not a plain object is returned as it is.
 *
 * @param {unknown} value - The value to normalize.
 * @returns {unknown} The value with every plain object's keys in sorted order.
 */
export function sortKeysDeep(value) {
    if (Array.isArray(value)) return value.map(sortKeysDeep);
    if (value === null || typeof value !== "object") return value;
    // A Date or any other exotic object would lose itself in a rebuild from
    // entries, and YAML frontmatter can produce one.
    if (Object.getPrototypeOf(value) !== Object.prototype) return value;
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
    return out;
}

/**
 * Build one index record from a note's frontmatter and its place in the tree.
 *
 * @param {object} options - Options.
 * @param {Record<string, any>} options.frontmatter - The note's parsed frontmatter.
 * @param {string} options.relPath - Its path below the content root, POSIX-separated.
 * @param {string} options.contentPackage - The package the tree compiles as.
 * @returns {Record<string, any>} The record, keys sorted at every depth.
 * @throws {Error} When the note carries a key this module derives, which would
 *   otherwise be overwritten without a word.
 */
export function buildIndexRecord({ frontmatter, relPath, contentPackage }) {
    for (const key of DERIVED_KEYS) {
        if (Object.hasOwn(frontmatter ?? {}, key)) {
            throw new Error(
                `${relPath}: \`${key}:\` is derived by the content index and ` +
                    `cannot be authored — rename the frontmatter field`,
            );
        }
    }

    const posix = relPath.split(path.sep).join("/");
    const folder = posix.includes("/") ? posix.slice(0, posix.lastIndexOf("/")) : "";

    return /** @type {Record<string, any>} */ (
        sortKeysDeep({
            ...frontmatter,
            package: contentPackage,
            file: {
                path: posix,
                folder,
                name: path.basename(posix, ".md"),
            },
        })
    );
}

/**
 * Read a content tree into index records, in the order they will be written.
 *
 * @param {string} contentBase - The content tree to walk.
 * @param {object} options - Options.
 * @param {string} options.contentPackage - The package the tree compiles as.
 * @param {Array<string>} [options.skipDirectories] - Directory names to skip.
 * @returns {Array<Record<string, any>>} The records, in a total order that does
 *   not depend on directory-read order.
 */
export function collectContentIndex(contentBase, { contentPackage, skipDirectories }) {
    const records = [];
    const walkOpts = skipDirectories ? { skipDirectories } : {};

    for (const { frontmatter, absPath } of walkMarkdownTree(contentBase, walkOpts)) {
        records.push(
            buildIndexRecord({
                frontmatter: frontmatter ?? {},
                relPath: path.relative(contentBase, absPath),
                contentPackage,
            }),
        );
    }

    // Content path, then the note id. The walk yields in directory-read order,
    // which is not a fact about the content, and a rebuild that reorders lines
    // would make every regeneration look like a change.
    records.sort(
        (a, b) =>
            String(a.file.path).localeCompare(String(b.file.path), "en") ||
            String(a.id ?? "").localeCompare(String(b.id ?? ""), "en"),
    );
    return records;
}

/**
 * Serialize records as JSON Lines.
 *
 * @param {Array<Record<string, any>>} records - From {@link collectContentIndex}.
 * @returns {string} One compact JSON object per line, newline-terminated. An
 *   empty set serializes to the empty string rather than to a lone newline, so
 *   the file is exactly the lines it holds.
 */
export function serializeContentIndex(records) {
    if (records.length === 0) return "";
    return `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;
}

/**
 * Emit this package's content index.
 *
 * @param {object} [options] - Options.
 * @param {string} [options.contentBase] - The content tree; defaults to the
 *   configured `paths.content`.
 * @param {string} [options.outDir] - Where to write; defaults to the configured
 *   `paths.contentIndex`.
 * @param {object} [options.config] - A resolved configuration; loaded when omitted.
 * @returns {{file: string, notes: number, bytes: number}} Where it was written,
 *   how many notes it holds, and its size.
 * @throws {Error} When the content tree is absent, or when it yields no note at
 *   all — an empty index is indistinguishable from a mis-pointed tree, and a
 *   reader would take it as the authoritative statement that this package has
 *   no content.
 */
export function emitContentIndex({ contentBase, outDir, config } = {}) {
    const resolved = config ?? loadPackConfig();
    const tree = contentBase ?? resolved.paths.content;
    const dir = outDir ?? resolved.paths.contentIndex;
    const contentPackage = resolved.contentPackage;

    if (!fs.existsSync(tree)) {
        throw new Error(`no content tree at ${tree}`);
    }

    const records = collectContentIndex(tree, {
        contentPackage,
        skipDirectories: resolved.skipDirectories,
    });
    if (records.length === 0) {
        throw new Error(
            `${tree} yielded no notes, so the index would state that this ` +
                `package has no content`,
        );
    }

    const text = serializeContentIndex(records);
    const file = path.join(dir, `${contentPackage}.jsonl`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, text);

    return { file, notes: records.length, bytes: Buffer.byteLength(text) };
}
