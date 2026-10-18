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

import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import {
    canonicalDateFromOffset,
    canonicalDayOffset,
    canonicalYear,
    parseCanonicalDate,
} from "./calendars.mjs";
import { renderAddress } from "./address-render.mjs";

/** Resolve calendar eras on the canonical day axis. */
export function resolveReckoningMarkers(index, daysPerYear) {
    const eras = new Map();
    const markers = new Map();
    const findings = [];
    const qualifiers = new Map();
    const markerOwners = new Map();
    const calendarRows = [];

    const location = (note, position, key) => ({
        ...(note.file === undefined ? {} : { file: note.file }),
        ...(note.raw === undefined ?
            {}
        :   positionOfFrontmatterPath(note.raw, ["data", "eras", position, key])),
    });
    const error = (note, position, key, message) =>
        findings.push({ ...location(note, position, key), severity: "error", message });

    for (const note of index?.notes ?? []) {
        const fm = note?.fm ?? note?.frontmatter ?? note;
        if (fm?.type !== "lore" || fm?.subType !== "calendar") continue;
        const data = fm.data ?? {};
        const rows = data.eras;
        if (!Array.isArray(rows)) continue;
        if (!Number.isSafeInteger(daysPerYear) || daysPerYear < 1) continue;
        const epochText = String(data.epoch ?? "");
        const epoch = parseCanonicalDate(epochText, daysPerYear);
        if (!epoch || epoch.year === 0 || epoch.seconds !== undefined) {
            findings.push({
                ...(note.file === undefined ? {} : { file: note.file }),
                ...(note.raw === undefined ?
                    {}
                :   positionOfFrontmatterPath(note.raw, ["data", "epoch"])),
                severity: "error",
                message:
                    "data.epoch must be a canonical <year>.<day> anchoring calendar year 1, day 1",
            });
            continue;
        }
        const epochOffset = canonicalDayOffset(
            canonicalYear(epoch.year),
            epoch.day,
            1,
            daysPerYear,
        );
        const pkg = note.package ?? index?.contentPackage;
        const declared = [];
        for (const [position, era] of rows.entries()) {
            if (!era || typeof era.shortcode !== "string" || !era.shortcode || !fm.shortcode)
                continue;
            const short = `${fm.shortcode}.${era.shortcode}`;
            const key =
                pkg ?
                    renderAddress({ package: pkg, system: "note", type: "lore", shortcode: short })
                :   short;
            const row = {
                key,
                era: short,
                calendar: data,
                calendarShortcode: fm.shortcode,
                note,
                position,
                start: era.start,
                name: era.name,
                abbreviation: era.abbreviation,
                marker: era.marker,
                label: era.label,
            };
            declared.push(row);
            const aliases = [short, `lore-${short}`, `note-lore-${short}`];
            for (const alias of aliases) {
                if (qualifiers.has(alias) && qualifiers.get(alias) !== key)
                    qualifiers.set(alias, null);
                else qualifiers.set(alias, key);
            }
            if (era.marker !== undefined) {
                if (typeof era.marker !== "string" || !/^[A-Z][A-Z0-9]*$/.test(era.marker))
                    error(
                        note,
                        position,
                        "marker",
                        "an era marker needs uppercase letters and digits",
                    );
                else if (markerOwners.has(era.marker))
                    error(
                        note,
                        position,
                        "marker",
                        `reckoning marker ${era.marker} is declared more than once`,
                    );
                else markerOwners.set(era.marker, key);
            }
            if (era.end !== undefined)
                error(
                    note,
                    position,
                    "end",
                    "an era ends when the next calendar year era begins; omit end",
                );
        }
        calendarRows.push({ note, declared, epochOffset });
    }

    for (const { note, declared, epochOffset } of calendarRows) {
        const nullRows = declared.filter((row) => row.start === null);
        const firstRows = declared.filter((row) => row.start === 1);
        if (nullRows.length !== 1)
            error(
                note,
                nullRows[0]?.position ?? 0,
                "start",
                "a calendar needs exactly one start: null era before year 1",
            );
        if (firstRows.length !== 1)
            error(
                note,
                firstRows[0]?.position ?? 0,
                "start",
                "a calendar needs exactly one era with start: 1",
            );
        const byStart = new Map();
        for (const row of declared) {
            // A fractional start is the inner-key check's one finding.
            if (typeof row.start === "number" && !Number.isInteger(row.start)) continue;
            if (row.start !== null && (!Number.isSafeInteger(row.start) || row.start < 1)) {
                error(
                    note,
                    row.position,
                    "start",
                    "an era start is null or a positive integer calendar year",
                );
                continue;
            }
            if (byStart.has(row.start)) {
                error(note, row.position, "start", `calendar eras cannot share start ${row.start}`);
                continue;
            }
            byStart.set(row.start, row);
        }
        const ordered = [...byStart.values()].sort((a, b) =>
            a.start === null ? -1
            : b.start === null ? 1
            : a.start - b.start,
        );
        for (const [position, row] of ordered.entries()) {
            const startOffset =
                row.start === null ? epochOffset : epochOffset + (row.start - 1) * daysPerYear;
            if (!Number.isSafeInteger(startOffset)) {
                error(
                    note,
                    row.position,
                    "start",
                    "era start lies outside the supported day range",
                );
                continue;
            }
            const startDate = canonicalDateFromOffset(startOffset, 1, daysPerYear);
            const next = ordered[position + 1];
            const endOffset = next ? epochOffset + (next.start - 1) * daysPerYear - 1 : undefined;
            const entry = {
                era: row.era,
                qualifier: row.key,
                marker: row.marker,
                firstEra: row.start === null,
                beforeEra: row.start === null,
                startYear: row.start,
                calendar: row.calendar,
                calendarShortcode: row.calendarShortcode,
                name: row.name,
                abbreviation: row.abbreviation,
                label: row.label,
                epochYear: startDate.year,
                epochDay: startDate.day,
                calendarEpochOffset: epochOffset,
                startOffset,
                ...(endOffset === undefined ? {} : { endOffset }),
            };
            eras.set(row.key, entry);
            if (row.marker && markerOwners.get(row.marker) === row.key)
                markers.set(row.marker, entry);
        }
    }
    for (const [alias, key] of qualifiers) {
        if (key === null) eras.set(alias, { ambiguous: true });
        else if (eras.has(key)) eras.set(alias, eras.get(key));
    }
    return { eras, markers, findings };
}

/**
 * The key a note's resolved calendar is filed under: its type and shortcode.
 *
 * @param {object|undefined} fm - A note's frontmatter or record.
 * @returns {string|undefined} The key.
 */
export function noteCalendarKey(fm) {
    return fm?.type && fm?.shortcode ? `${fm.type}\u0000${fm.shortcode}` : undefined;
}

/**
 * A record's `resolvedCalendar` as its canonical Address string: an Address
 * tuple, as a record in memory carries it, or the string an encoded record
 * carries.
 *
 * @param {unknown} value - The value.
 * @returns {string|undefined} The Address, or `undefined` for none.
 */
export function calendarAddress(value) {
    if (typeof value === "string") return value || undefined;
    return value && typeof value === "object" && "shortcode" in value ?
            renderAddress(/** @type {any} */ (value))
        :   undefined;
}

/**
 * Each note's resolved calendar, by {@link noteCalendarKey}, from the
 * `resolvedCalendar` the content index writes on a record.
 *
 * @param {Iterable<object>|undefined} notes - Index records, or
 *   `{ fm, resolvedCalendar }` entries.
 * @returns {Map<string, string>} Note key to the calendar's canonical Address.
 */
export function noteCalendarMap(notes) {
    const out = new Map();
    for (const note of notes ?? []) {
        const calendar = calendarAddress(note?.resolvedCalendar);
        if (!calendar) continue;
        const key = noteCalendarKey(note?.fm ?? note?.frontmatter ?? note);
        if (key && !out.has(key)) out.set(key, calendar);
    }
    return out;
}

/** One resolved date context per corpus index. */
const contexts = new WeakMap();

/**
 * Read the world's year length and resolve every calendar era in one corpus.
 *
 * The context also carries `noteCalendars`, each note's resolved calendar by
 * note, read from the `resolvedCalendar` the content index writes on a record;
 * {@link module:engine/note-calendars.noteCalendar} reads it.
 */
export function reckoningContext(index) {
    if (!index || typeof index !== "object")
        return {
            eras: new Map(),
            markers: new Map(),
            daysPerYear: undefined,
            findings: [],
            noteCalendars: new Map(),
        };
    const cached = contexts.get(index);
    if (cached) return cached;
    const world = (index.notes ?? []).find((note) => {
        const fm = note?.fm ?? note?.frontmatter ?? note;
        return fm?.type === "place" && fm?.data?.year?.days;
    });
    const fm = world?.fm ?? world?.frontmatter ?? world;
    const daysPerYear = fm?.data?.year?.days;
    const context = {
        ...resolveReckoningMarkers(index, daysPerYear),
        daysPerYear,
        noteCalendars: noteCalendarMap(index.notes),
    };
    contexts.set(index, context);
    return context;
}
