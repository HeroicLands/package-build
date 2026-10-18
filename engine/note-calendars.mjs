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
 * **The calendar a note's dates print in.** A note's calendar is the first of:
 *
 * 1. its own `data.calendar`, on any type;
 * 2. its culture's calendar: the culture note its `data.culture` names,
 *    resolved by these same rules;
 * 3. for a `place`, its `data.parents`, each resolved by these same rules. Two
 *    or more distinct calendars among them are an error at the place's
 *    `data.parents`, fixed by stating `data.calendar` on the place;
 * 4. the package's configured `defaultCalendar`;
 * 5. otherwise none, and a date prints as it was written.
 *
 * Steps 2 and 3 take only a calendar some note states: a culture or parent
 * that itself falls through to the default contributes nothing, so parents
 * that all fall through give the default and raise no error. A note met again
 * while it is being resolved — a cycle through `data.parents` or
 * `data.culture` — contributes nothing either, and the chain goes on to the
 * default.
 *
 * The content index writes the result onto each note record as
 * `resolvedCalendar`, the calendar note's Address, and
 * every reader of a note's calendar reads it from there: the event views, the
 * `dateformat` helper and the infobox's dates.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { canonicalKey, isAddressTuple, readCanonicalKey, renderAddress } from "./address.mjs";
import { isAddressSegment } from "./address-charset.mjs";
import { AddressLink } from "./address-values.mjs";
import { formatDiagnostic, positionOfFrontmatterPath, positionOfYamlPath } from "./diagnostics.mjs";
import { isNoteRecord, noteFile } from "./index-records.mjs";
import { noteCalendarKey } from "./reckoning-markers.mjs";
import { NOTE_SYSTEM } from "./systems.mjs";

/** The configuration key naming the calendar of last resort. */
export const DEFAULT_CALENDAR_KEY = "defaultCalendar";

/**
 * The canonical key an Address names, without any anchor.
 *
 * @param {unknown} value - A tuple, an {@link AddressLink}, or anything else.
 * @returns {string|undefined} The key, or `undefined` for anything else.
 */
function addressKey(value) {
    const tuple = value instanceof AddressLink ? value.target : value;
    return isAddressTuple(tuple) ? renderAddress(tuple) : undefined;
}

/**
 * Whether a record is a calendar note.
 *
 * @param {Record<string, any>|undefined} record - An index record.
 * @returns {boolean} Whether it is a `lore` note with `subType: calendar`.
 */
function isCalendarNote(record) {
    return record?.type === "lore" && String(record.subType ?? "").toLowerCase() === "calendar";
}

/**
 * The canonical key of the calendar `defaultCalendar` names, or why it names none.
 *
 * @param {unknown} shortcode - The configured value.
 * @param {string} contentPackage - The package the shortcode is read in.
 * @param {(key: string) => Record<string, any>|undefined} recordOf - A local
 *   note by canonical key.
 * @returns {{key?: string, problem?: string}} The calendar, or the problem.
 */
function defaultCalendarKey(shortcode, contentPackage, recordOf) {
    if (shortcode === undefined || shortcode === null) return {};
    const named = String(shortcode);
    const key =
        isAddressSegment(named) ?
            canonicalKey(contentPackage, NOTE_SYSTEM, "lore", named)
        :   undefined;
    if (key && isCalendarNote(recordOf(key))) return { key };
    return {
        problem:
            `${DEFAULT_CALENDAR_KEY} ${named} names no calendar note in ${contentPackage}; ` +
            `name the shortcode of a lore note with subType: calendar`,
    };
}

/**
 * Write each note's resolved calendar into its record, as `resolvedCalendar`.
 *
 * Reads each note's authored `data.calendar`, `data.culture` and
 * `data.parents`, so it runs before the index writes a resolved culture over
 * `data.culture`. A culture or parent in another package contributes the
 * calendar its published entry states in `data.calendar`, and nothing else.
 *
 * @param {Array<Record<string, any>>} records - Index records, every Address a
 *   tuple. Records that are not notes are passed over.
 * @param {object} options - Options.
 * @param {string} options.contentPackage - The package the records belong to.
 * @param {string} [options.defaultCalendar] - The configured calendar of last
 *   resort, a calendar note's shortcode.
 * @param {string} [options.configFile] - The configuration file, where an
 *   unknown `defaultCalendar` is reported.
 * @param {string} [options.contentBase] - The content tree, for opening a note
 *   to locate a finding.
 * @param {(key: string) => Record<string, any>|undefined} [options.foreignRecord] -
 *   Another package's entry for a canonical address.
 * @param {object[]} [options.problems] - Receives each finding. Omitted, the
 *   findings are collected and one Error lists them all.
 * @param {Map<string, {raw: string}>} [options.parsed] - Notes already read, keyed by file.
 * @returns {Array<Record<string, any>>} The same records.
 * @throws {Error} When `problems` is omitted and anything is reported.
 */
export function resolveNoteCalendars(
    records,
    { contentPackage, defaultCalendar, configFile, contentBase, foreignRecord, problems, parsed },
) {
    const notes = new Map();
    for (const record of records) {
        if (!isNoteRecord(record) || !isAddressSegment(String(record.shortcode ?? ""))) continue;
        const key = canonicalKey(contentPackage, NOTE_SYSTEM, record.type, record.shortcode);
        if (!notes.has(key)) notes.set(key, record);
    }
    const findings = [];

    const fallback = defaultCalendarKey(defaultCalendar, contentPackage, (key) => notes.get(key));
    if (fallback.problem) {
        const file = configFile ?? "package-build.config.yaml";
        const source =
            configFile && /\.ya?ml$/.test(configFile) && fs.existsSync(configFile) ?
                fs.readFileSync(configFile, "utf8")
            :   undefined;
        findings.push({
            file,
            ...(source ? positionOfYamlPath(source, [DEFAULT_CALENDAR_KEY], { key: true }) : {}),
            severity: "error",
            message: fallback.problem,
        });
    }

    const memo = new Map();
    const inProgress = new Set();

    /**
     * The calendar some note states for a source Address, local or foreign.
     *
     * @param {unknown} value - A `data.culture` or `data.parents` Address.
     * @returns {string|undefined} The calendar's canonical key.
     */
    const statedThrough = (value) => {
        const key = addressKey(value);
        if (!key) return undefined;
        const tuple = value instanceof AddressLink ? value.target : value;
        if (tuple.package === contentPackage) {
            const record = notes.get(
                canonicalKey(contentPackage, NOTE_SYSTEM, tuple.type, tuple.shortcode),
            );
            return record ? resolve(record) : undefined;
        }
        return addressKey(foreignRecord?.(key)?.data?.calendar);
    };

    /**
     * Report parents that disagree.
     *
     * @param {Record<string, any>} record - The place.
     * @param {Array<{key: string, via: unknown}>} distinct - The calendars and
     *   the parent each came through.
     */
    const conflict = (record, distinct) => {
        const file = contentBase ? noteFile(contentBase, record) : record.file?.path;
        const raw =
            parsed?.get(file)?.raw ??
            (contentBase && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined);
        let position = positionOfFrontmatterPath(raw, ["data", "parents"], { key: true });
        if (position.line === undefined)
            position = positionOfFrontmatterPath(raw, ["data"], { key: true });
        const via = (value) => {
            const tuple = value instanceof AddressLink ? value.target : value;
            return tuple.package === contentPackage ? tuple.shortcode : addressKey(tuple);
        };
        const named = distinct.map(({ key, via: source }) => `${key} via ${via(source)}`);
        findings.push({
            file,
            ...position,
            severity: "error",
            message:
                `place ${record.shortcode}: data.parents resolve to different calendars ` +
                `(${named.join(", ")}); state data.calendar`,
        });
    };

    /**
     * The calendar a note states through its own field, its culture or — for a
     * place — its parents, ignoring the default.
     *
     * @param {Record<string, any>} record - The note.
     * @returns {string|undefined} The calendar's canonical key.
     */
    const resolveRecord = (record) => {
        const own = addressKey(record.data?.calendar);
        if (own) return own;
        const culture = statedThrough(record.data?.culture);
        if (culture) return culture;
        if (record.type !== "place") return undefined;
        const parents = Array.isArray(record.data?.parents) ? record.data.parents : [];
        const distinct = new Map();
        for (const parent of parents) {
            const calendar = statedThrough(parent);
            if (calendar && !distinct.has(calendar)) distinct.set(calendar, parent);
        }
        if (distinct.size > 1) {
            conflict(
                record,
                [...distinct].map(([key, via]) => ({ key, via })),
            );
            return undefined;
        }
        return distinct.keys().next().value;
    };

    /**
     * A local note's stated calendar, memoised; a note already being resolved
     * is a cycle and states nothing.
     *
     * @param {Record<string, any>} record - The note.
     * @returns {string|undefined} The calendar's canonical key.
     */
    const resolve = (record) => {
        if (memo.has(record)) return memo.get(record);
        if (inProgress.has(record)) return undefined;
        inProgress.add(record);
        const result = resolveRecord(record);
        inProgress.delete(record);
        memo.set(record, result);
        return result;
    };

    // Walked in address order, so which note of a cycle is met first is a fact
    // about the content rather than about directory-read order.
    const calendars = new Map();
    for (const key of [...notes.keys()].sort())
        calendars.set(key, resolve(notes.get(key)) ?? fallback.key);
    // A note's second record — an item's documentation journal — is the same
    // note, and reads in the same calendar.
    for (const record of records) {
        if (!isNoteRecord(record) || !isAddressSegment(String(record.shortcode ?? ""))) continue;
        const calendar = calendars.get(
            canonicalKey(contentPackage, NOTE_SYSTEM, record.type, record.shortcode),
        );
        if (calendar) record.resolvedCalendar = readCanonicalKey(calendar);
        else delete record.resolvedCalendar;
    }

    findings.sort(
        (a, b) =>
            String(a.file).localeCompare(String(b.file), "en") ||
            (a.line ?? 0) - (b.line ?? 0) ||
            (a.column ?? 0) - (b.column ?? 0),
    );
    if (problems) problems.push(...findings);
    else if (findings.length)
        throw Object.assign(new Error(findings.map(formatDiagnostic).join("\n")), {
            located: true,
        });
    return records;
}

/**
 * The configuration file in a package root, where a configured value is
 * reported.
 *
 * @param {string|undefined} rootDir - The package root.
 * @param {readonly string[]} names - The file names a configuration may take.
 * @returns {string|undefined} The first that exists.
 */
export function configFileIn(rootDir, names) {
    if (!rootDir) return undefined;
    for (const name of names) {
        const file = path.join(rootDir, name);
        if (fs.existsSync(file)) return file;
    }
    return undefined;
}

/**
 * The calendar a note's dates print in: the one the content index resolved for
 * it, where the reckoning context carries it, else the note's own
 * `data.calendar`.
 *
 * @param {object|undefined} fm - The note's frontmatter.
 * @param {{noteCalendars?: Map<string, string>}} [dates] - The reckoning context.
 * @returns {string|undefined} The calendar's Address or shortcode.
 */
export function noteCalendar(fm, dates) {
    const key = noteCalendarKey(fm);
    const resolved = key ? dates?.noteCalendars?.get(key) : undefined;
    if (resolved) return resolved;
    const own = fm?.data?.calendar;
    if (own === undefined || own === null || own === "") return undefined;
    return addressKey(own) ?? String(own);
}
