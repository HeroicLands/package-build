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
 * What an inline `{{ref "<event address>" field="<key>"}}` reads: every note's
 * events, by the note's Address, and how one field of one event prints.
 *
 * **One index for every surface.** The website, the Foundry compile and the
 * book each build it from the same content-index records and the same fetched
 * dependency indexes, so a reference prints the same text on all three.
 *
 * @module
 */

import { ownDocumentSystem, parseAddress, readCanonicalKey, renderAddress } from "./address.mjs";
import { formatNoteDate, parseNoteDate } from "./note-dates.mjs";
import { NOTE_VOCABULARY } from "./note-vocabulary.mjs";

/** The fields of an event an inline reference may print, in the order a message names them. */
export const EVENT_REFERENCE_FIELDS = Object.freeze(["when", "until", "kind", "summary", "name"]);

/**
 * @typedef {object} EventView
 * @property {string} [id] - The event's `id`.
 * @property {object} entry - The event entry as the index holds it.
 * @property {object|null} when - Its resolved `when`, or `null`.
 * @property {object|null} until - Its resolved `until`, or `null`.
 */

/**
 * @typedef {object} EventNote
 * @property {string} target - The note's canonical Address.
 * @property {EventView[]} events - Its events, in entry order.
 * @property {Array<{slug: string, kind?: string}>} anchors - Every anchor it declares.
 */

/**
 * Every note's events, by Address, from this package's index records and the
 * fetched indexes of its dependencies.
 *
 * @param {Iterable<Record<string, any>>} records - This package's content-index records.
 * @param {object} [options]
 * @param {string} [options.contentPackage] - The package a written Address
 *   without one defaults to.
 * @param {Map<string, object>} [options.foreignIndex] - The merged fetched
 *   indexes, as `loadForeignIndexes` returns them.
 * @param {object} [options.dates] - The reckoning context, for a record that
 *   carries no resolved dates.
 * @returns {{note: (written: string) => EventNote|undefined,
 *   own: (fm: object) => EventNote|undefined}} The lookup: `note` from a
 *   written Address, anchor already removed, to the note it names, and `own`
 *   from a note of this package's frontmatter to that note.
 */
export function eventNoteIndex(records, { contentPackage, foreignIndex, dates } = {}) {
    /** @type {Map<string, EventNote>} */
    const byKey = new Map();
    const types = new Set(Object.keys(NOTE_VOCABULARY));
    const packages = new Set(contentPackage ? [contentPackage] : []);
    const keysOf = (tuple) => [
        renderAddress({ ...tuple, system: "note" }),
        renderAddress({ ...tuple, system: ownDocumentSystem(tuple.type) }),
    ];

    for (const record of records ?? []) {
        if (!record?.package || !record.type || !record.shortcode || record.documents) continue;
        packages.add(String(record.package));
        const tuple = {
            package: String(record.package),
            type: String(record.type),
            shortcode: String(record.shortcode),
        };
        const entries = Array.isArray(record.data?.events) ? record.data.events : [];
        const resolved = record.resolvedDates?.events ?? [];
        const parse = (value) =>
            value == null ? null : (
                (parseNoteDate(value, { ...dates, allowUnknown: true, allowZeroYear: true }).date ??
                null)
            );
        const events = entries.map((entry, position) => ({
            ...(typeof entry?.id === "string" ? { id: entry.id } : {}),
            entry: entry ?? {},
            when: resolved[position]?.when ?? parse(entry?.when),
            until: resolved[position]?.until ?? parse(entry?.until),
        }));
        const anchors =
            Array.isArray(record.anchors) ?
                record.anchors
            :   events.filter((one) => one.id).map((one) => ({ slug: one.id, kind: "event" }));
        const note = { target: renderAddress({ ...tuple, system: "note" }), events, anchors };
        for (const key of keysOf(tuple)) byKey.set(key, note);
    }

    for (const [key, value] of foreignIndex ?? []) {
        const tuple = readCanonicalKey(key);
        if (!tuple) continue;
        packages.add(tuple.package);
        if (value?.type) types.add(String(value.type));
        const note = {
            target: renderAddress({ ...tuple, system: "note" }),
            events: (Array.isArray(value?.events) ? value.events : []).map((event) => ({
                ...(typeof event?.id === "string" ? { id: event.id } : {}),
                entry: event?.entry ?? {},
                when: event?.when ?? null,
                until: event?.until ?? null,
            })),
            anchors: Array.isArray(value?.noteAnchors) ? value.noteAnchors : [],
        };
        for (const one of keysOf(tuple)) if (!byKey.has(one)) byKey.set(one, note);
    }

    return {
        note(written) {
            const tuple = parseAddress(
                written,
                { package: contentPackage ?? "local", system: "note", types, packages },
                { declared: true },
            );
            if (tuple.reason) return undefined;
            return byKey.get(renderAddress({ ...tuple, system: "note" }));
        },
        own(fm) {
            if (!fm?.type || !fm?.shortcode) return undefined;
            return byKey.get(
                renderAddress({
                    package: contentPackage ?? "local",
                    system: "note",
                    type: String(fm.type),
                    shortcode: String(fm.shortcode),
                }),
            );
        },
    };
}

/**
 * A date as a note prints one: in the era its own marker or qualifier names,
 * where the reckoning knows that era, else as written — `~` kept either way.
 *
 * @param {unknown} written - The date as the event writes it.
 * @param {object|null} date - The resolved date.
 * @param {object} [dates] - The reckoning context.
 * @returns {string} The printed date.
 */
export function printEventDate(written, date, dates) {
    if (!date?.known) return String(written);
    const era =
        date.marker ? dates?.markers?.get(date.marker)
        : date.qualifier ? dates?.eras?.get(date.qualifier)
        : null;
    const printable = era ? formatNoteDate(date, era, dates?.daysPerYear) : null;
    return printable?.prose ?? printable?.text ?? date.prose ?? date.text ?? String(written);
}

/**
 * One field of one event, as the text a reference prints, or why it cannot.
 *
 * @param {EventView} event - The event.
 * @param {string} field - One of {@link EVENT_REFERENCE_FIELDS}.
 * @param {object} [dates] - The reckoning context.
 * @returns {{text: string}|{missing: true}} The text, or that the event states
 *   no such field.
 */
export function eventFieldText(event, field, dates) {
    const entry = event.entry ?? {};
    if (field === "when" || field === "until") {
        const written = entry[field];
        if (written === undefined || written === null || written === "") return { missing: true };
        return { text: printEventDate(written, event[field], dates) };
    }
    if (field === "name") {
        const name =
            Array.isArray(entry.names) ? entry.names.find((one) => one?.name)?.name : undefined;
        return typeof name === "string" && name ? { text: name } : { missing: true };
    }
    const value = entry[field];
    return typeof value === "string" && value ? { text: value } : { missing: true };
}
