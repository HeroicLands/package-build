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
 * The id a note's document is filed under, and the one rule that decides it.
 *
 * A note used to author its `id` — an opaque 16-character string, 6,343 of them
 * across the four content trees, each a *second* identity for a thing that
 * already had one. The note's canonical address (`sohl-none-miscgear-bowlcer`)
 * says everything the id said, is readable, and is the identity `content-lint`
 * already guards: a duplicate address is a build error, while a duplicate `id`
 * was checked nowhere. So the derived id inherits a guarantee, where the
 * authored one had none.
 *
 * **An authored `id` always wins.** That is the pattern the map compiler
 * already uses and documents — `regionDocId(sceneId, key, pinned)` returns
 * `pinned || makeId(…)` — and it is the correction lever an author needs when a
 * document must keep its identity across a shortcode rename.
 *
 * **This is one function because every pass must agree.** Half a dozen corpus
 * readers ask what a note's document id is — the pack passes, the wikilink
 * index, the content index, the Foundry-address pass, the address diff — and
 * they never see each other's answer. They agreed before because they all read
 * one authored field; they agree now because they all call this.
 *
 * `maps` and `pkg` are parameters with defaults rather than values resolved
 * inside, so a test can pose a package and a registry this toolchain does not
 * ship without a configuration on disk.
 *
 * @module
 */

import { documentId } from "./content-address.mjs";
import { systemOf } from "./document-subtypes.mjs";
import { contentPackage } from "./content-package.mjs";
import { KNOWN_DOCUMENT_SUBTYPE_MAPS } from "./subtype-registry.mjs";
// The folder id's derivation, taken from the pass that owns it rather than
// restated here — see the `folder` branch below. `folder-notes.mjs` reaches
// only `content-address`, `address-charset`, `ids` and `retired-fields`, none
// of which reach this module, so the direction closes no cycle.
import { FOLDER_TYPE, folderDocId } from "./folder-notes.mjs";

/**
 * A frontmatter value read as a non-blank string, or `undefined`.
 *
 * A blank `id:` is not a pin. It is an author who deleted the value and left
 * the key, and treating `""` as pinned would file the document under the empty
 * string — which the LevelDB packer reports only as an opaque key collision.
 *
 * @param {unknown} value - The authored value.
 * @returns {string|undefined} The trimmed value, or `undefined` when blank.
 */
function text(value) {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
}

/**
 * The document id a note compiles under: its pin, or its address.
 *
 * **One type hashes its address differently, and that is not an exception to
 * the rule but an application of it.** A `Folder` is a document of its own
 * class, and its id is hashed under the `folder` namespace so that a folder and
 * an item sharing a shortcode cannot derive one id — a collision Foundry would
 * not report, since it keys folders and documents in separate collections.
 * So the answer for a folder comes from
 * {@link module:engine/folder-notes.folderDocId}, the pass that emits those
 * documents, rather than from a second derivation here.
 *
 * That this function ever answered differently was invisible from inside a
 * build — no pass reads a folder's id from here — and surfaced only in the
 * content index, which is read from outside and had no way to be checked
 * against what shipped.
 *
 * Returns `undefined` for a file with **no address** — no `type`, or no
 * `shortcode`. Such a file is not an addressable note, so it has no document
 * and inventing an id for one would file it under nothing. Every caller already
 * had to handle an absent id (that is what the authored field's absence meant),
 * so this reports the same thing rather than throwing where a walk used to
 * skip; whether an id is *required* stays each pass's own decision
 * (`BasePackCompiler.requiresId`).
 *
 * @param {object|null|undefined} fm - Parsed frontmatter.
 * @param {object} [opts]
 * @param {string} [opts.pkg] - The owning content package. Defaults to the
 *   configured one, which is the only package a tree's notes belong to.
 * @param {readonly object[]} [opts.maps] - The document-subtype maps, which
 *   decide the address's `<system>` segment.
 * @returns {string|undefined} The document's `_id`, or `undefined` when the
 *   note has no address to derive one from.
 */
export function noteDocId(fm, { pkg, maps = KNOWN_DOCUMENT_SUBTYPE_MAPS } = {}) {
    if (!fm || typeof fm !== "object") return undefined;
    const pinned = text(fm.id);
    if (pinned) return pinned;
    const type = text(fm.type);
    const shortcode = text(fm.shortcode);
    if (!type || !shortcode) return undefined;
    const owner = pkg ?? contentPackage();
    // Lowercased because `collectFolderNotes` matches the type that way, and
    // the two must answer alike about the same note or the divergence this
    // branch closes reopens under a capitalised `type: Folder`.
    if (type.toLowerCase() === FOLDER_TYPE) return folderDocId(owner, shortcode);
    return documentId(owner, systemOf(type, maps), type, shortcode);
}

/**
 * Fill a note's `id` in place, so everything downstream reads one value.
 *
 * The corpus readers each hold their own parsed frontmatter and each ask for
 * `fm.id` in several places; normalising the field once, where the note is
 * read, is what makes "the id is derived" true for all of them rather than for
 * whichever ones remembered to derive it. Idempotent, and a no-op for a note
 * that authored an id or has no address.
 *
 * @param {object|null|undefined} fm - Parsed frontmatter, mutated in place.
 * @param {object} [opts] - As {@link noteDocId}.
 * @returns {object|null|undefined} `fm`, for chaining.
 */
export function resolveNoteId(fm, opts) {
    if (!fm || typeof fm !== "object") return fm;
    const id = noteDocId(fm, opts);
    if (id) fm.id = id;
    return fm;
}
