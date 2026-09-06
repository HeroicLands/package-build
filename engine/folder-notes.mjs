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
 * Folders, as notes.
 *
 * A `Folder` is a real Foundry document, and it was the last kind this package
 * compiled from bespoke configuration — `*-folders.yaml`, five files per tree —
 * rather than from a note. That was the one hole in the rule #243 establishes,
 * *the compiler follows the index*: a pass cannot follow the index for things
 * the index does not contain (#256).
 *
 * Three things follow from a folder being a note, and each is a defect that
 * becomes unrepresentable rather than a tidiness win:
 *
 * 1. **`parent` is an address**, resolved and checked like every other
 *    reference. A dangling parent stops being a special-cased
 *    `Unknown folder id` and becomes an ordinary dead-address finding.
 * 2. **Where a folder materialises is derived from what references it** (#257).
 *    A documentation journal is filed beside the item it describes, which used
 *    to mean passing the *items* pack's folder id into the *journals* pack —
 *    verbatim, validated nowhere, and correct only where the two folder files
 *    happened to mirror each other. They did in one tree of three. With one
 *    folder note and one address there is no second file to disagree with the
 *    first, so a pack cannot fail to declare a folder something in it points at.
 * 3. **The Foundry id is derived from the address** (#258), the way a
 *    `JournalEntryPage` id is already hashed from its anchor — with an authored
 *    `id` still winning, so a world already holding these folders keeps
 *    resolving them.
 *
 * A folder note is addressed `<package>-none-folder-<shortcode>`: **`none`**,
 * because a `Folder` is a core Foundry document like a `JournalEntry` or a
 * `Scene`, not a system's.
 *
 * **A folder note carries no prose.** It is structure, not content, so it wants
 * no documentation journal and takes no part in `docEntryTypes` — the one
 * decision #256 left open, settled the way it recommended.
 *
 * @module
 */

import path from "node:path";

import log from "loglevel";

import { NO_SYSTEM, canonicalKey } from "./content-address.mjs";
import { isAddressSegment } from "./address-charset.mjs";
import { makeId } from "./ids.mjs";

/**
 * The note type a folder is authored as.
 *
 * @type {string}
 */
export const FOLDER_TYPE = "folder";

/**
 * The id namespace a derived folder id is hashed under.
 *
 * Distinct from every other document's namespace so a folder and an item
 * sharing a shortcode cannot derive the same id — the collision would be
 * silent, since Foundry keys folders and documents in separate collections and
 * neither would complain.
 *
 * @type {string}
 */
export const FOLDER_ID_NAMESPACE = "folder";

/**
 * One folder note, read from the tree.
 *
 * @typedef {object} FolderNote
 * @property {string} shortcode - Its `(type, shortcode)` identity.
 * @property {string} address - The canonical `<pkg>-none-folder-<shortcode>`.
 * @property {string} name - The display name.
 * @property {string|null} color - CSS hex, or `null`.
 * @property {string|null} parent - The parent's authored address, or `null`.
 * @property {string} id - The Foundry id: authored, or derived from `address`.
 * @property {boolean} derivedId - Whether `id` was derived rather than authored.
 * @property {string} absPath - The file it was read from, for diagnostics.
 */

/**
 * Read one folder note's fields out of its frontmatter.
 *
 * `parent` and `color` are `data:` properties, which is where the
 * specification's `### type: folder` table puts them — the closed container,
 * so a misspelled `colour` is a finding rather than a theme parameter. They are
 * accepted at the top level too, because that is where #256's own example wrote
 * them and an author following the issue rather than the specification should
 * get a folder, not a silent default.
 *
 * @param {object} fm - Parsed frontmatter.
 * @returns {{parent: string|null, color: string|null}} The two fields.
 */
function folderFields(fm) {
    const data = fm?.data && typeof fm.data === "object" ? fm.data : {};
    const pick = (key) => {
        const value = data[key] ?? fm?.[key];
        if (value == null) return null;
        const text = String(value).trim();
        return text === "" ? null : text;
    };
    return { parent: pick("parent"), color: pick("color") };
}

/**
 * An authored `parent` with any wikilink brackets and label stripped.
 *
 * The specification types `parent` as a `WikiLink`, and a frontmatter link is
 * written as a bare address — but `[[address]]` is what an author reaches for,
 * and Obsidian wrote that form for years. Accepting both costs one regex and
 * removes a failure whose message would have to explain the difference.
 *
 * @param {string|null} value - As authored.
 * @returns {string|null} The bare address.
 */
export function bareAddress(value) {
    if (value == null) return null;
    const text = String(value).trim();
    if (!text) return null;
    const unwrapped = text.replace(/^\[\[(.*)\]\]$/s, "$1");
    // A label is presentation; the address is everything before the pipe.
    const [target] = unwrapped.split("|");
    return target.trim() || null;
}

/**
 * The canonical address of a folder note in this package.
 *
 * @param {string} pkg - The content package.
 * @param {string} shortcode - The folder's shortcode.
 * @returns {string} `<pkg>-none-folder-<shortcode>`.
 */
export function folderAddress(pkg, shortcode) {
    return canonicalKey(pkg, NO_SYSTEM, FOLDER_TYPE, shortcode);
}

/**
 * Collect every folder note in a content tree.
 *
 * The walk is the caller's to supply, so this stays testable without a tree on
 * disk and so one build cannot disagree with another about what the corpus is
 * (#243).
 *
 * @param {Iterable<{frontmatter: object|null, absPath: string}>} notes - As
 *   yielded by `walkMarkdownTree`.
 * @param {string} pkg - The content package, for the canonical address.
 * @returns {FolderNote[]} One record per folder note, in walk order.
 * @throws {Error} When a folder note is unusable on its own terms — no
 *   shortcode, a shortcode that is not an address segment, or no name.
 */
export function collectFolderNotes(notes, pkg) {
    /** @type {FolderNote[]} */
    const folders = [];
    for (const { frontmatter: fm, absPath } of notes) {
        if (!fm || String(fm.type ?? "").toLowerCase() !== FOLDER_TYPE) continue;

        const shortcode = fm.shortcode == null ? "" : String(fm.shortcode).trim();
        if (!shortcode) {
            throw Object.assign(new Error(`folder note has no shortcode: ${absPath}`), {
                absPath,
            });
        }
        // The charset rule is load-bearing here rather than tidy: the address
        // is parsed by counting separators, so a hyphenated shortcode would be
        // read back as two segments and resolve to nothing, reporting nothing
        // about why (#1397, #273).
        if (!isAddressSegment(shortcode)) {
            throw Object.assign(
                new Error(
                    `folder shortcode "${shortcode}" is not strictly ` +
                        `alphanumeric, so its address would not parse: ${absPath}`,
                ),
                { absPath },
            );
        }

        const name = fm.name?.full ?? path.basename(absPath, ".md").replace(/_/g, " ");
        if (!name) {
            throw Object.assign(new Error(`folder note "${shortcode}" has no name`), { absPath });
        }

        const { parent, color } = folderFields(fm);
        const address = folderAddress(pkg, shortcode);
        const authoredId = fm.id == null ? "" : String(fm.id).trim();

        folders.push({
            shortcode,
            address,
            name: String(name),
            color,
            parent: bareAddress(parent),
            // An authored id is kept, and a folder without one derives a
            // stable one from its address (#258). Keeping the authored id is
            // what makes this a build change rather than a world migration: a
            // world already holding these folders goes on resolving them.
            id: authoredId || makeId(FOLDER_ID_NAMESPACE, address),
            derivedId: !authoredId,
            absPath,
        });
    }
    return folders;
}

/**
 * Index folder notes by every form an author may address one by, and check the
 * invariants that make the index sound.
 *
 * Three keys per folder, and no more: the canonical address, the
 * `folder-<shortcode>` short form, and the bare shortcode. They are the
 * suffixes of the canonical address the grammar admits (#273) — a `packFolder`
 * or `parent` field supplies the type itself, so a bare shortcode is a complete
 * address there.
 *
 * @param {FolderNote[]} folders - From {@link collectFolderNotes}.
 * @returns {{byKey: Map<string, FolderNote>, folders: FolderNote[],
 *   resolve: (value: string) => FolderNote, ancestorsOf: (folder: FolderNote)
 *   => FolderNote[], parentOf: (folder: FolderNote) => FolderNote|null}}
 * @throws {Error} On a duplicate shortcode, a duplicate id, a dead `parent`,
 *   or a parent cycle.
 */
export function buildFolderNoteIndex(folders) {
    /** @type {Map<string, FolderNote>} */
    const byKey = new Map();
    /** @type {Map<string, FolderNote>} */
    const byShortcode = new Map();
    /** @type {Map<string, FolderNote>} */
    const byId = new Map();

    for (const folder of folders) {
        const key = folder.shortcode.toLowerCase();
        const clash = byShortcode.get(key);
        if (clash) {
            throw Object.assign(
                new Error(
                    `two folder notes share the shortcode "${folder.shortcode}" ` +
                        `— ${clash.absPath} and ${folder.absPath}`,
                ),
                { absPath: folder.absPath },
            );
        }
        byShortcode.set(key, folder);

        // A collision here is a build error rather than a last-write-wins: two
        // folders with one id are one folder in Foundry, and the documents
        // filed in the loser would land somewhere their author never named.
        const idClash = byId.get(folder.id);
        if (idClash) {
            const how =
                folder.derivedId && idClash.derivedId ?
                    "both derived from their addresses"
                :   "one of them authored";
            throw Object.assign(
                new Error(
                    `folder id "${folder.id}" is claimed twice (${how}) — ` +
                        `"${idClash.shortcode}" (${idClash.absPath}) and ` +
                        `"${folder.shortcode}" (${folder.absPath})`,
                ),
                { absPath: folder.absPath },
            );
        }
        byId.set(folder.id, folder);

        byKey.set(folder.address.toLowerCase(), folder);
        byKey.set(`${FOLDER_TYPE}-${folder.shortcode}`.toLowerCase(), folder);
        byKey.set(key, folder);
    }

    /**
     * The folder an address names.
     *
     * @param {string} value - A folder address, in any admitted form.
     * @returns {FolderNote} The folder.
     * @throws {Error} When nothing answers to it.
     */
    function resolve(value) {
        const address = bareAddress(value);
        if (!address) {
            throw new Error("a folder reference is blank");
        }
        const hit = byKey.get(address.toLowerCase());
        if (!hit) {
            const known = [...byShortcode.values()].map((f) => f.shortcode).sort();
            throw new Error(
                `no folder note is addressed "${address}" — this package ` +
                    `declares ${known.length} folder(s)` +
                    (known.length ? `: ${known.join(", ")}` : ""),
            );
        }
        return hit;
    }

    /**
     * A folder's parent, or `null` at the root.
     *
     * @param {FolderNote} folder - The folder.
     * @returns {FolderNote|null} Its parent.
     */
    function parentOf(folder) {
        if (!folder.parent) return null;
        try {
            return resolve(folder.parent);
        } catch (err) {
            throw Object.assign(
                new Error(`folder "${folder.shortcode}" names a parent that ${err.message}`),
                { absPath: folder.absPath },
            );
        }
    }

    /**
     * Every ancestor of a folder, nearest first.
     *
     * A folder cannot materialise without them: a `Folder` whose parent is
     * absent from the pack is an orphan Foundry renders at the root, so the
     * tree would be broken at the top rather than merely incomplete (#257).
     *
     * @param {FolderNote} folder - The folder.
     * @returns {FolderNote[]} Its ancestors.
     * @throws {Error} On a parent cycle.
     */
    function ancestorsOf(folder) {
        /** @type {FolderNote[]} */
        const chain = [];
        const seen = new Set([folder.address]);
        let current = parentOf(folder);
        while (current) {
            if (seen.has(current.address)) {
                throw Object.assign(
                    new Error(
                        `folder "${folder.shortcode}" sits in a parent cycle: ` +
                            `${[...seen, current.address].join(" → ")}`,
                    ),
                    { absPath: folder.absPath },
                );
            }
            seen.add(current.address);
            chain.push(current);
            current = parentOf(current);
        }
        return chain;
    }

    // Every parent is resolved and every chain walked once, here, so a dead or
    // circular `parent` is reported when the index is built rather than when
    // some note happens to reference the folder that carries it. A tree whose
    // folders are all reachable but one is still a broken tree.
    for (const folder of folders) ancestorsOf(folder);

    log.debug(`Folder notes: ${folders.length} folder(s) indexed`);
    return { byKey, folders, resolve, ancestorsOf, parentOf };
}

/**
 * The Foundry `Folder` document one folder note compiles to, for one pack.
 *
 * The same folder materialises in several packs — the items pack and the
 * journals pack both hold it when both hold something filed in it — and each
 * copy differs only in `type`, which is the document class the folder holds.
 * The `_id` is shared deliberately: a documentation journal filed beside its
 * item is the whole point, and two ids would put them in two folders that
 * merely looked alike.
 *
 * @param {FolderNote} folder - The folder note.
 * @param {FolderNote|null} parent - Its parent, already resolved.
 * @param {string} documentType - `"Item"`, `"JournalEntry"`, …
 * @param {object} stats - The `_stats` block every emitted document carries.
 * @returns {object} The Folder document.
 */
export function folderDocument(folder, parent, documentType, stats) {
    return {
        name: folder.name,
        sorting: "a",
        folder: parent ? parent.id : null,
        type: documentType,
        _id: folder.id,
        sort: 0,
        color: folder.color,
        flags: {},
        _stats: stats,
        _key: `!folders!${folder.id}`,
    };
}
