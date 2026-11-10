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
 * The primary note of an image: the being or affiliation it shows.
 *
 * An image's provenance takes `hl:name` and `hl:primarynote` from the single
 * being or affiliation note that names it, through an art slot, an
 * embed or a body image. This module answers that question from the content
 * index alone, so nothing is typed in by hand and no note file is read: the
 * type, `name.full`, Address and the images each note names
 * (`namedImages`) all come from its index record.
 *
 * A note of any other type (a place, an item) that names the image
 * is not a primary note and does not compete with one.
 *
 * @module engine/art-primary-note
 */

import { renderAddress, readCanonicalKey } from "./address.mjs";
import { isNoteRecord } from "./index-records.mjs";

/** The note types whose images carry a primary note. */
export const PRIMARY_NOTE_TYPES = Object.freeze(["being", "affiliation"]);

/**
 * A primary note.
 *
 * @typedef {object} PrimaryNote
 * @property {string} address - The note's canonical Address.
 * @property {string} type - `being` or `affiliation`.
 * @property {string} name - The note's `name.full`.
 */

/**
 * What {@link resolvePrimaryNote} answers.
 *
 * @typedef {{note: PrimaryNote}
 *   | {reason: "no-note"|"not-being-or-affiliation"|"several-notes",
 *      notes?: string[]}} PrimaryNoteResult
 *
 * `no-note`: no note names the image. `not-being-or-affiliation`: only notes of
 * other types name it. `several-notes`: more than one being or affiliation
 * names it, listed in `notes`. The note's `name` is empty when it has no
 * `name.full`.
 */

/**
 * A canonical Address as text, whichever form the record holds it in.
 *
 * @param {unknown} value - A canonical Address as a string, a tuple or a published
 *   `{address, anchor, anchorKind}` object.
 * @returns {string|undefined} The text.
 */
function addressText(value) {
    const written = typeof value?.address === "string" ? value.address : value;
    const tuple = readCanonicalKey(written);
    return tuple ? renderAddress(tuple) : undefined;
}

/**
 * Read the notes and the images they name out of the content index.
 *
 * Only index records are read: each note's type, `name.full`, Address and
 * `namedImages` (see {@link module:engine/art-naming.namedImages}). No source
 * note is opened.
 *
 * @param {readonly Record<string, any>[]} records - The content index records,
 *   from {@link module:engine/content-index.indexRecordsFor}.
 * @returns {{notes: Map<string, {address: string, type: string, name: string}>,
 *   naming: Map<string, Set<string>>}} The note records by Address, and for each
 *   image Address the Addresses of the notes naming it.
 */
export function buildPrimaryNoteIndex(records = []) {
    const notes = new Map();
    const naming = new Map();
    for (const record of records) {
        if (!isNoteRecord(record) || !record.address) continue;
        const address = addressText(record.address.canonical);
        if (!address) continue;
        notes.set(address, {
            address,
            type: String(record.type ?? ""),
            name: typeof record.name?.full === "string" ? record.name.full : "",
        });
        for (const named of record.namedImages ?? []) {
            const image = addressText(named);
            if (!image) continue;
            if (!naming.has(image)) naming.set(image, new Set());
            naming.get(image).add(address);
        }
    }
    return { notes, naming };
}

/**
 * The primary note of an image, or why it has none.
 *
 * @param {ReturnType<typeof buildPrimaryNoteIndex>} index - From
 *   {@link buildPrimaryNoteIndex}.
 * @param {string|object} imageAddress - The image's canonical Address.
 * @returns {PrimaryNoteResult} The single being or affiliation note naming the
 *   image, or the reason there is none.
 */
export function resolvePrimaryNote(index, imageAddress) {
    const names = index.naming.get(addressText(imageAddress) ?? "");
    if (!names || names.size === 0) return { reason: "no-note" };
    const primary = [...names]
        .map((address) => index.notes.get(address))
        .filter((note) => PRIMARY_NOTE_TYPES.includes(note.type))
        .sort((a, b) => (a.address < b.address ? -1 : 1));
    if (primary.length === 0) return { reason: "not-being-or-affiliation" };
    if (primary.length > 1) {
        return { reason: "several-notes", notes: primary.map((note) => note.address) };
    }
    return { note: primary[0] };
}
