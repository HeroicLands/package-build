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
 * The rows of the SQL `events` relation: one per `data.events` entry of every
 * note that carries events, read from index records whose Addresses are
 * already strings.
 *
 * **Every row has every column.** The event keys come from
 * {@link module:engine/note-event-terms.EVENT_ENTRY_KEYS}, so a key no event in a
 * corpus writes is still a column, `NULL` in every row, and a fence naming it
 * binds rather than failing on a corpus that happens not to use it.
 *
 * **The dates are the ones the index resolved.** Each record carries
 * `resolvedDates.events`, position for position with `data.events`, and the
 * sort keys are read from it rather than parsed again here.
 *
 * **`whenText` and `untilText` are the dates as a reader of the owning note
 * sees them**: printed as the `dateformat` helper prints a date, in the
 * calendar the owning note resolves to — see
 * {@link module:engine/note-calendars} — else in the era the date itself
 * names. A date that does not resolve keeps its authored text.
 *
 * **`whenIn` and `untilIn` are the same dates in every calendar**: a struct
 * keyed by each calendar note's canonical Address, every calendar the corpus
 * holds or any note resolves to, so a query reads a date in the calendar it
 * chooses — `e.whenIn['thalorna-note-lore-commoncal']`. Every row carries every
 * key; a date a calendar cannot print reads there as it would in `whenText`
 * with no calendar, and an absent date is `NULL`. The event views select the
 * key of the page's calendar.
 *
 * @module
 */

import { ownDocumentSystem, renderAddress } from "./address.mjs";
import { printEventDateIn } from "./event-fields.mjs";
import { EVENT_ENTRY_KEYS } from "./note-event-terms.mjs";
import { calendarAddress } from "./reckoning-markers.mjs";

/** The columns a row carries besides the event's own keys, before them. */
const IDENTITY_COLUMNS = Object.freeze(["note", "address"]);

/** The sort keys a row carries, after the event's own keys. */
export const EVENT_SORT_COLUMNS = Object.freeze(["whenSort", "whenYear", "untilSort", "untilYear"]);

/** The printed dates a row carries, after the sort keys. */
export const EVENT_TEXT_COLUMNS = Object.freeze(["whenText", "untilText"]);

/** The dates a row carries in every calendar, after the printed ones. */
export const EVENT_CALENDAR_COLUMNS = Object.freeze(["whenIn", "untilIn"]);

/** Every column of the `events` relation, in order. */
export const EVENT_COLUMNS = Object.freeze([
    ...IDENTITY_COLUMNS,
    ...EVENT_ENTRY_KEYS,
    ...EVENT_SORT_COLUMNS,
    ...EVENT_TEXT_COLUMNS,
    ...EVENT_CALENDAR_COLUMNS,
]);

/** The keys whose authored value is a date, printed as the text it was written as. */
const DATE_KEYS = new Set(["when", "until"]);

/**
 * The owning note's canonical Address, as a string: the one the record
 * publishes, or — for a stub, which publishes none — the one its package,
 * type and shortcode spell.
 *
 * @param {Record<string, any>} record - An index record, Addresses as strings.
 * @returns {string|null} The Address, or `null` for a record naming no note.
 */
function noteAddressOf(record) {
    const canonical = record.address?.canonical;
    if (typeof canonical === "string" && canonical) return canonical;
    if (!record.package || !record.type || !record.shortcode) return null;
    return renderAddress({
        package: String(record.package),
        system: ownDocumentSystem(record.type),
        type: String(record.type),
        shortcode: String(record.shortcode),
    });
}

/**
 * A resolved date's position on the canonical axis: its `sort` where the
 * calendar fixes a day's fraction of the year, else its year. A year-0 date
 * recurs in every year and has no position.
 *
 * @param {object|undefined} date - A resolved date.
 * @returns {{sort: number|null, year: number|null}} The keys.
 */
function axisKeys(date) {
    if (!date?.known || !Number.isFinite(date.canonicalYear) || date.year === 0)
        return { sort: null, year: null };
    return {
        sort: Number.isFinite(date.sort) ? date.sort : date.canonicalYear,
        year: date.canonicalYear,
    };
}

/**
 * Every calendar a set of records can print an event's date in: each calendar
 * note's canonical Address, and every calendar a note resolves to.
 *
 * @param {Iterable<Record<string, any>>} records - Index records, every
 *   Address a string.
 * @returns {string[]} The calendars, sorted.
 */
export function eventCalendars(records) {
    const calendars = new Set();
    for (const record of records) {
        const resolved = calendarAddress(record?.resolvedCalendar);
        if (resolved) calendars.add(resolved);
        if (
            record?.type === "lore" &&
            String(record.subType ?? "").toLowerCase() === "calendar" &&
            record.package &&
            record.shortcode &&
            !record.documents
        )
            calendars.add(
                renderAddress({
                    package: String(record.package),
                    system: "note",
                    type: "lore",
                    shortcode: String(record.shortcode),
                }),
            );
    }
    return [...calendars].sort();
}

/**
 * The `events` rows of a set of index records.
 *
 * @param {Iterable<Record<string, any>>} records - Index records, every
 *   Address a string, already narrowed to the audience being published to.
 * @param {object} [dates] - The reckoning context the dates are printed in.
 * @param {readonly string[]} [calendars] - The calendars `whenIn` and
 *   `untilIn` are keyed by: {@link eventCalendars} of every record of the
 *   corpus, whatever the audience, so every surface's relation has the same
 *   keys. Absent, those of `records`.
 * @returns {object[]} One row per event entry, in record then entry order.
 */
export function eventRows(records, dates, calendars) {
    const rows = [];
    const all = [...records];
    const keys = calendars ?? eventCalendars(all);
    for (const record of all) {
        const events = record?.data?.events;
        if (!Array.isArray(events) || !events.length) continue;
        const note = noteAddressOf(record);
        if (!note) continue;
        const resolved =
            Array.isArray(record.resolvedDates?.events) ? record.resolvedDates.events : [];
        const calendar = calendarAddress(record.resolvedCalendar);
        events.forEach((entry, position) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
            const row = {
                note,
                address: typeof entry.id === "string" && entry.id ? `${note}#${entry.id}` : note,
            };
            for (const key of EVENT_ENTRY_KEYS) {
                const value = entry[key];
                row[key] =
                    value === undefined || value === null ? null
                    : DATE_KEYS.has(key) ? String(value)
                    : value;
            }
            const when = axisKeys(resolved[position]?.when);
            const until = axisKeys(resolved[position]?.until);
            row.whenSort = when.sort;
            row.whenYear = when.year;
            row.untilSort = until.sort;
            row.untilYear = until.year;
            for (const key of DATE_KEYS) {
                const date = resolved[position]?.[key];
                row[`${key}Text`] =
                    row[key] === null ? null : printEventDateIn(row[key], date, dates, calendar);
                row[`${key}In`] =
                    keys.length ?
                        Object.fromEntries(
                            keys.map((each) => [
                                each,
                                row[key] === null ?
                                    null
                                :   printEventDateIn(row[key], date, dates, each),
                            ]),
                        )
                    :   null;
            }
            rows.push(row);
        });
    }
    return rows;
}
