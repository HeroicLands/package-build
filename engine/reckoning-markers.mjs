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
import { DATEFROM_PATTERN, parseNoteDate } from "./note-dates.mjs";
import { eraNames } from "./calendar-human.mjs";
import { addressSuffixes, renderAddress } from "./address-render.mjs";

/**
 * Resolve every declared reckoning marker against its calendar and era start.
 * The marker names one era, while the calendar supplies the month layout.
 *
 * @param {{notes?: readonly object[]}} index - The corpus link index.
 * @param {number} daysPerYear - The world's year length.
 * @returns {{eras: Map<string, object>, markers: Map<string, object>, findings: object[]}} Resolved eras, markers, and errors.
 */
export function resolveReckoningMarkers(index, daysPerYear) {
    const declared = new Map();
    const qualifiers = new Map();
    const markerKeys = new Map();
    const eras = new Map();
    const markers = new Map();
    const findings = [];
    const failed = new Set();
    const visiting = [];

    const location = (row, key) => ({
        ...(row.note.file === undefined ? {} : { file: row.note.file }),
        ...(row.note.raw === undefined ?
            {}
        :   positionOfFrontmatterPath(row.note.raw, ["data", "eras", row.position, key])),
    });
    const finding = (row, key, message) =>
        findings.push({
            ...location(row, key),
            severity: "error",
            message,
        });
    const alias = (qualifier, key) => {
        if (qualifiers.has(qualifier) && qualifiers.get(qualifier) !== key)
            qualifiers.set(qualifier, null);
        else qualifiers.set(qualifier, key);
    };

    for (const note of index?.notes ?? []) {
        const fm = note?.fm ?? note?.frontmatter ?? note;
        if (fm?.type !== "lore" || fm?.subType !== "calendar") continue;
        const rows = fm.data?.eras;
        if (!Array.isArray(rows)) continue;
        rows.forEach((era, position) => {
            if (
                !era ||
                typeof era.shortcode !== "string" ||
                !era.shortcode ||
                typeof fm.shortcode !== "string" ||
                !fm.shortcode
            )
                return;
            const pkg = fm.package ?? note.package ?? index?.contentPackage;
            const short = `${fm.shortcode}.${era.shortcode}`;
            const key =
                pkg ?
                    renderAddress({ package: pkg, system: "note", type: "lore", shortcode: short })
                :   short;
            const row = {
                key,
                era: short,
                calendar: fm.data,
                marker: era.marker,
                calendarShortcode: fm.shortcode,
                name: era.name,
                abbreviation: era.abbreviation,
                label: era.label,
                start: era.start,
                end: era.end,
                note,
                position,
            };
            if (declared.has(key)) {
                return;
            }
            declared.set(key, row);
            alias(short, key);
            if (pkg) {
                alias(
                    renderAddress({ package: pkg, system: "note", type: "lore", shortcode: short }),
                    key,
                );
                alias(`note-lore-${short}`, key);
                alias(`lore-${short}`, key);
            }
            if (era.marker === undefined) return;
            if (typeof era.marker !== "string" || !/^[A-Z][A-Z0-9]*$/.test(era.marker)) {
                finding(
                    row,
                    "marker",
                    "an era marker is uppercase letters and digits, starting with a letter",
                );
                return;
            }
            if (markerKeys.has(era.marker)) {
                finding(row, "marker", `reckoning marker ${era.marker} is declared more than once`);
                return;
            }
            markerKeys.set(era.marker, key);
        });
    }

    for (const [qualifier, key] of qualifiers)
        if (key === null) eras.set(qualifier, { ambiguous: true });

    function resolve(key) {
        if (key === null || !declared.has(key) || failed.has(key)) return null;
        const row = declared.get(key);
        if (eras.has(key)) return eras.get(key);
        if (visiting.includes(key)) {
            const members = [...visiting.slice(visiting.indexOf(key)), key].map(
                (member) => declared.get(member).era,
            );
            finding(row, "start", `calendar era cycle includes ${members.join(" → ")}`);
            for (const member of visiting.slice(visiting.indexOf(key))) failed.add(member);
            return null;
        }
        visiting.push(key);
        if (row.start === undefined || row.start === null) {
            finding(row, "start", `calendar era ${row.era} needs a start`);
            failed.add(key);
        }
        const source = typeof row.start === "string" ? row.start.trim() : "";
        const marker = /^([A-Z][A-Z0-9]*)\(/.exec(source)?.[1];
        const qualifier = /\s+([^\s]+\.[^\s]+)$/.exec(source)?.[1];
        const conversion = DATEFROM_PATTERN.exec(source);
        const convertedRef = conversion?.[1];
        const convertedDate = conversion?.[2];
        const convertedRows =
            convertedRef ?
                [...declared.values()].filter((candidate) => {
                    const fm = candidate.note.fm ?? candidate.note.frontmatter ?? candidate.note;
                    const pkg = fm.package ?? candidate.note.package ?? index?.contentPackage;
                    if (!pkg) return convertedRef === candidate.calendarShortcode;
                    return addressSuffixes({
                        package: pkg,
                        system: "note",
                        type: "lore",
                        shortcode: candidate.calendarShortcode,
                    }).includes(convertedRef);
                })
            :   [];
        const convertedTargets = convertedRows.filter((candidate) =>
            eraNames(candidate).some((name) =>
                convertedDate?.toLowerCase().endsWith(` ${name.toLowerCase()}`),
            ),
        );
        if (convertedTargets.length === 0 && convertedRows.length === 1)
            convertedTargets.push(convertedRows[0]);
        const dependency =
            marker ? markerKeys.get(marker)
            : qualifier ? qualifiers.get(qualifier)
            : convertedTargets.length === 1 ? convertedTargets[0].key
            : null;
        if (dependency && !failed.has(key)) resolve(dependency);
        if (!failed.has(key)) {
            const parsed = parseNoteDate(row.start, {
                markers,
                eras,
                daysPerYear,
                field: "data.eras.start",
                allowUnknown: false,
                ...location(row, "start"),
                raw: row.note.raw,
                keyPath: ["data", "eras", row.position, "start"],
            });
            findings.push(...parsed.findings);
            if (
                Number.isSafeInteger(parsed.date?.canonicalYear) &&
                parsed.findings.every((item) => item.severity !== "error")
            ) {
                const entry = {
                    era: row.era,
                    qualifier: row.key,
                    marker: row.marker,
                    firstEra: row.position === 0,
                    calendar: row.calendar,
                    calendarShortcode: row.calendarShortcode,
                    name: row.name,
                    abbreviation: row.abbreviation,
                    label: row.label,
                    epochYear: parsed.date.canonicalYear,
                    epochDay: parsed.date.canonicalDay ?? 1,
                };
                if (Number.isSafeInteger(daysPerYear) && daysPerYear > 0)
                    entry.startOffset = canonicalDayOffset(
                        entry.epochYear,
                        entry.epochDay,
                        1,
                        daysPerYear,
                    );
                eras.set(key, entry);
                for (const [name, owner] of qualifiers) if (owner === key) eras.set(name, entry);
                if (row.marker && markerKeys.get(row.marker) === key)
                    markers.set(row.marker, entry);
            } else failed.add(key);
        }
        visiting.pop();
        return eras.get(key) ?? null;
    }
    for (const key of declared.keys()) resolve(key);
    for (const row of declared.values()) {
        const entry = eras.get(row.key);
        if (!entry || row.end === undefined || row.end === null) continue;
        const parsed = parseNoteDate(row.end, {
            markers,
            eras,
            daysPerYear,
            field: "data.eras.end",
            allowUnknown: false,
            file: row.note.file,
            raw: row.note.raw,
            keyPath: ["data", "eras", row.position, "end"],
        });
        findings.push(...parsed.findings);
        if (!Number.isSafeInteger(parsed.date?.canonicalYear)) continue;
        if (!Number.isSafeInteger(daysPerYear) || daysPerYear < 1) {
            finding(
                row,
                "end",
                `calendar era ${row.era} needs the world's year length to bound its end`,
            );
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
                (daysInMonth(
                    markers.get(parsed.date.marker)?.calendar ??
                        eras.get(parsed.date.qualifier)?.calendar,
                    parsed.date.month,
                ) ?? 1) - 1
            :   0;
        const endOffset = firstEndDay + extraDays;
        const startOffset = canonicalDayOffset(entry.epochYear, entry.epochDay, 1, daysPerYear);
        if (endOffset < startOffset) {
            finding(row, "end", `calendar era ${row.era} ends before its start`);
            continue;
        }
        entry.endOffset = endOffset;
    }
    const calendars = new Map();
    for (const row of declared.values()) {
        const rows = calendars.get(row.note) ?? [];
        rows.push(row);
        calendars.set(row.note, rows);
    }
    for (const rows of calendars.values()) {
        for (let position = 0; position < rows.length; position++) {
            const row = rows[position];
            const entry = eras.get(row.key);
            if (!entry || !Number.isSafeInteger(entry.startOffset)) continue;
            entry.firstEra = position === 0;
            const next = rows[position + 1];
            if (!next) continue;
            const following = eras.get(next.key);
            if (!following || !Number.isSafeInteger(following.startOffset)) continue;
            if (following.startOffset <= entry.startOffset) {
                finding(
                    next,
                    "start",
                    `calendar eras ${row.era} and ${next.era} must begin in increasing order`,
                );
                continue;
            }
            if (entry.endOffset !== undefined && entry.endOffset >= following.startOffset) {
                finding(next, "start", `calendar eras ${row.era} and ${next.era} overlap`);
                continue;
            }
            if (entry.endOffset === undefined) entry.endOffset = following.startOffset - 1;
        }
    }
    return { eras, markers, findings };
}

/** One resolved date context per corpus index, shared by its note checks. */
const contexts = new WeakMap();

/**
 * Read the world's year length and its era markers from one corpus index.
 *
 * @param {{notes?: readonly object[]}|undefined} index - The corpus index.
 * @returns {{eras: Map<string, object>, markers: Map<string, object>, daysPerYear: number|undefined, findings: object[]}}
 */
export function reckoningContext(index) {
    if (!index || typeof index !== "object")
        return { eras: new Map(), markers: new Map(), daysPerYear: undefined, findings: [] };
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
