/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { canonicalDayOffset, daysInMonth } from "./calendars.mjs";
import { parseNoteDate } from "./note-dates.mjs";

/**
 * Resolve every declared reckoning marker against its calendar and era start.
 * The marker names one era, while the calendar supplies the month layout.
 *
 * @param {{notes?: readonly object[]}} index - The corpus link index.
 * @param {number} daysPerYear - The world's year length.
 * @returns {{markers: Map<string, object>, findings: object[]}} Resolved markers and errors.
 */
export function resolveReckoningMarkers(index, daysPerYear) {
    const declared = new Map();
    const markers = new Map();
    const findings = [];

    for (const note of index?.notes ?? []) {
        const fm = note?.fm ?? note?.frontmatter ?? note;
        if (fm?.type !== "lore" || fm?.subType !== "calendar") continue;
        const eras = fm.data?.eras;
        if (!Array.isArray(eras)) continue;
        eras.forEach((row, position) => {
            if (row?.marker === undefined) return;
            const marker = row.marker;
            const at = {
                ...(note.file === undefined ? {} : { file: note.file }),
                ...(note.raw === undefined ?
                    {}
                :   positionOfFrontmatterPath(note.raw, ["data", "eras", position, "marker"])),
            };
            if (typeof marker !== "string" || !/^[A-Z][A-Z0-9]*$/.test(marker)) {
                findings.push({
                    ...at,
                    severity: "error",
                    message:
                        "an era marker is uppercase letters and digits, starting with a letter",
                });
                return;
            }
            if (declared.has(marker)) {
                findings.push({
                    ...at,
                    severity: "error",
                    message: `reckoning marker ${marker} is declared more than once`,
                });
                return;
            }
            declared.set(marker, {
                marker,
                era: `${fm.shortcode}.${row.shortcode}`,
                calendar: fm.data,
                start: row.start,
                end: row.end,
                note,
                position,
            });
        });
    }

    const visiting = new Set();
    const failed = new Set();
    function resolve(marker) {
        if (markers.has(marker)) return markers.get(marker);
        if (failed.has(marker)) return null;
        const row = declared.get(marker);
        if (!row) return null;
        if (visiting.has(marker)) {
            findings.push({
                ...(row.note.file === undefined ? {} : { file: row.note.file }),
                severity: "error",
                message: `reckoning marker cycle includes ${[...visiting, marker].join(" → ")}`,
            });
            failed.add(marker);
            return null;
        }
        visiting.add(marker);
        if (row.start === undefined || row.start === null) {
            findings.push({
                ...(row.note.file === undefined ? {} : { file: row.note.file }),
                severity: "error",
                message: `reckoning marker ${marker} needs an era start`,
            });
            failed.add(marker);
        }
        const dependency =
            typeof row.start === "string" ? /^([A-Z][A-Z0-9]*)\(/.exec(row.start)?.[1] : null;
        if (dependency && !failed.has(marker)) resolve(dependency);
        if (!failed.has(marker)) {
            const parsed = parseNoteDate(row.start, {
                markers,
                daysPerYear,
                field: "data.eras.start",
                allowUnknown: false,
                file: row.note.file,
                raw: row.note.raw,
                keyPath: ["data", "eras", row.position, "start"],
            });
            findings.push(...parsed.findings);
            if (
                parsed.date?.known &&
                Number.isSafeInteger(parsed.date.canonicalYear) &&
                parsed.findings.every((f) => f.severity !== "error")
            ) {
                const entry = {
                    era: row.era,
                    calendar: row.calendar,
                    epochYear: parsed.date.canonicalYear,
                    epochDay: parsed.date.canonicalDay ?? 1,
                };
                markers.set(marker, entry);
            } else {
                if (parsed.date && parsed.findings.length === 0)
                    findings.push({
                        ...(row.note.file === undefined ? {} : { file: row.note.file }),
                        severity: "error",
                        message: `reckoning marker ${marker} needs a canonically resolved era start`,
                    });
                failed.add(marker);
            }
        }
        visiting.delete(marker);
        return markers.get(marker) ?? null;
    }
    for (const marker of declared.keys()) resolve(marker);
    for (const [marker, row] of declared) {
        const entry = markers.get(marker);
        if (!entry || row.end === undefined || row.end === null) continue;
        const parsed = parseNoteDate(row.end, {
            markers,
            daysPerYear,
            field: "data.eras.end",
            allowUnknown: false,
            file: row.note.file,
            raw: row.note.raw,
            keyPath: ["data", "eras", row.position, "end"],
        });
        findings.push(...parsed.findings);
        if (!Number.isSafeInteger(parsed.date?.canonicalYear)) {
            if (parsed.date && parsed.findings.length === 0)
                findings.push({
                    ...(row.note.file === undefined ? {} : { file: row.note.file }),
                    severity: "error",
                    message: `reckoning marker ${marker} needs a canonically resolved era end`,
                });
            continue;
        }
        const firstEndDay = canonicalDayOffset(
            parsed.date.canonicalYear,
            parsed.date.canonicalDay ?? 1,
            1,
            daysPerYear,
        );
        const extraDays =
            parsed.date.precision === "year" ? daysPerYear - 1
            : parsed.date.precision === "month" ?
                (daysInMonth(markers.get(parsed.date.marker)?.calendar, parsed.date.month) ?? 1) - 1
            :   0;
        const endOffset = firstEndDay + extraDays;
        const startOffset = canonicalDayOffset(entry.epochYear, entry.epochDay, 1, daysPerYear);
        if (endOffset < startOffset) {
            findings.push({
                ...(row.note.file === undefined ? {} : { file: row.note.file }),
                severity: "error",
                message: `reckoning marker ${marker} ends before its era starts`,
            });
            continue;
        }
        entry.endOffset = endOffset;
    }
    return { markers, findings };
}

/** One resolved date context per corpus index, shared by its note checks. */
const contexts = new WeakMap();

/**
 * Read the world's year length and its era markers from one corpus index.
 *
 * @param {{notes?: readonly object[]}|undefined} index - The corpus index.
 * @returns {{markers: Map<string, object>, daysPerYear: number|undefined, findings: object[]}}
 */
export function reckoningContext(index) {
    if (!index || typeof index !== "object")
        return { markers: new Map(), daysPerYear: undefined, findings: [] };
    const cached = contexts.get(index);
    if (cached) return cached;
    const world = (index.notes ?? []).find((note) => {
        const fm = note?.fm ?? note?.frontmatter ?? note;
        return fm?.type === "place" && fm?.data?.year?.days;
    });
    const fm = world?.fm ?? world?.frontmatter ?? world;
    const daysPerYear = fm?.data?.year?.days;
    const context = { ...resolveReckoningMarkers(index, daysPerYear), daysPerYear };
    contexts.set(index, context);
    return context;
}
