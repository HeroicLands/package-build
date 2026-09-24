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
 * **The middle state of `age`: absent beside a dated `born`, it follows from
 * the date.**
 *
 * `age` is a three-state override — authored it wins, absent beside a dated
 * `born` it is computed, absent beside `born: unknown` or an absent `born` it
 * stays unknown. This module builds the middle state, which nothing else in
 * the toolchain does: `born` and `age` are read straight through to every
 * compiled surface exactly as authored, unless a note's own package states the
 * day the setting stops.
 *
 * ## Where the present comes from
 *
 * A world's `present` is a fact about the world, not about a calendar or a
 * build configuration — it is `data.present` on the package's own `place` note
 * of `subType: world` (or `celestial`), read through
 * {@link module:engine/calendar-notes.worldInvariants}. A package with no such
 * note states no present, computes no age, and says nothing about it: the
 * absence is silent, exactly as a package that declares no calendar is asked
 * no calendar questions.
 *
 * ## The arithmetic is on two dates, not on two years
 *
 * A year subtracted from a year is wrong whenever the birthday has not yet
 * happened in the present's year — the common shape, not the exception. So
 * {@link computeAge} compares `born`'s month and day against `present`'s,
 * **ordinally**, and drops a year where born's has not yet arrived. That
 * ordinal comparison needs no month-length table: two dates written in one
 * calendar order the same way whether the comparison counts days-of-year
 * through the calendar's month lengths or simply reads `(month, day)` as a
 * pair, because a calendar's months keep the same lengths every year — this
 * package's calendars carry no leap rule (`calendar-notes.mjs`'s
 * `years.leapYear` is always `null`). So the comparison is calendar-agnostic
 * by construction, and correct for a twelve-month calendar of thirty-day
 * months, a ten-month calendar, or none at all — a bare `born` with no era
 * names no calendar to consult in the first place.
 *
 * ## `~` follows the convention {@link module:engine/note-dates} sets
 *
 * A date's `~` marks the value approximate without changing what it parses to,
 * so a renderer keeps the authored text and a comparison still has a number.
 * {@link parseAgeMagnitude} draws the same distinction for `age` — the tilde,
 * the magnitude — without routing through {@link module:engine/note-dates}
 * itself: `age` is a plain count of years, not a date, so it has no month, no
 * day, no era, and — unlike a date — no refusal of `0`. Reusing the date
 * grammar's month/day/era machinery here would accept an age nothing about the
 * field means, and refuse the one age an infant can have.
 *
 * @module
 */

import { worldInvariants } from "./calendar-notes.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { parseNoteDate } from "./note-dates.mjs";
// `born`'s retired spelling is still read during its retirement window — see
// `docs/content-format.md`'s "`birthday:` is the retired spelling of `born:`"
// — so a being on the old spelling still computes an age rather than reading
// as never born.
import { readAliasedField } from "./retired-fields.mjs";

/** The note type this module's derivation and check apply to. */
const BEING_TYPE = "being";

/** Whether a note's type — read either directly or through its frontmatter — is `being`. */
function isBeingType(type) {
    return String(type ?? "").toLowerCase() === BEING_TYPE;
}

/** The `data:` map of a note's frontmatter, or `undefined` where there is none to read. */
function dataOf(fm) {
    const data = fm?.data;
    return data && typeof data === "object" && !Array.isArray(data) ? data : undefined;
}

/**
 * `~34`'s tilde and its magnitude — the same distinction a date's `~` draws,
 * asked of a plain count of years rather than of a calendar date.
 *
 * A whole, non-negative number only: an age is never fractional and never
 * before an epoch, so neither a date's sign nor its month/day/era grammar
 * belongs here.
 *
 * @type {RegExp}
 */
const AGE_MAGNITUDE_PATTERN = /^(~)?\s*(\d+)\s*$/;

/**
 * Parse an authored `age` into its estimate mark and its magnitude.
 *
 * @param {unknown} raw - The authored value — `34`, `"34"` or `"~34"`.
 * @returns {{approximate: boolean, value: number}|null} The parts, or `null`
 *   for a value that does not read as a plain count of years.
 */
export function parseAgeMagnitude(raw) {
    if (typeof raw !== "number" && typeof raw !== "string") return null;
    const match = AGE_MAGNITUDE_PATTERN.exec(String(raw).trim());
    if (!match) return null;
    const [, tilde, digits] = match;
    return { approximate: tilde === "~", value: Number(digits) };
}

/**
 * The age two dates imply, in whole years, computed from the dates themselves
 * rather than from the years alone.
 *
 * @param {unknown} bornRaw - The being's authored `born`, or `undefined`/`null`
 *   where it wrote none.
 * @param {unknown} presentRaw - The package's `data.present`, as
 *   {@link module:engine/calendar-notes.worldInvariants} read it, or
 *   `undefined`/`null` where the package states none.
 * @returns {number|null} The age, or `null` where `born` is `unknown` or
 *   absent, where no present is declared, or where either date fails to parse.
 */
export function computeAge(bornRaw, presentRaw) {
    if (bornRaw === undefined || bornRaw === null) return null;
    if (presentRaw === undefined || presentRaw === null) return null;

    const born = parseNoteDate(bornRaw, { allowUnknown: true }).date;
    if (!born || !born.known || born.canonicalYear == null) return null;

    const present = parseNoteDate(presentRaw, { allowUnknown: false }).date;
    if (!present || !present.known || present.canonicalYear == null) return null;

    // Ordinal position within the year, day of year or not: see the module
    // doc for why `(month, day)` alone orders correctly here. Missing month or
    // day reads as the year's first day — the earliest a birthday could fall —
    // so a `born` written to less precision than `present` never counts as
    // "not yet happened".
    const bornOrdinal = (born.month ?? 1) * 100 + (born.day ?? 1);
    const presentOrdinal = (present.month ?? 1) * 100 + (present.day ?? 1);
    const notYetHappened = bornOrdinal > presentOrdinal;

    return present.canonicalYear - born.canonicalYear - (notYetHappened ? 1 : 0);
}

/**
 * Fill in a being's computed `age`, and the numeric companion an estimate
 * carries beside it — mutating the frontmatter object handed in, never a file
 * on disk.
 *
 * Every caller holds a frontmatter object that was parsed fresh from a note's
 * text for its own pass — the content index, a compiled document, a rendered
 * page — and none of those objects round-trips back to the `.md` file. So
 * patching `data.age` in place here is exactly as safe as reading it, and
 * reaches every surface that reads `data:` after this runs, with the note
 * itself untouched.
 *
 * @param {object} fm - A note's frontmatter, as freshly parsed.
 * @param {unknown} presentRaw - The package's declared present, or
 *   `undefined`/`null` where it states none.
 * @returns {void}
 */
export function applyComputedBeingAge(fm, presentRaw) {
    if (!isBeingType(fm?.type)) return;
    const data = dataOf(fm);
    if (!data) return;

    const authored = data.age;
    if (authored !== undefined && authored !== null && authored !== "") {
        // An authored age always wins — the value itself is never touched.
        // `~34` is kept exactly as written; its normalised number is added
        // beside it, the way a date's `canonicalYear` sits beside its `text`.
        const parsed = parseAgeMagnitude(authored);
        if (parsed?.approximate) data.ageYears = parsed.value;
        return;
    }

    const born = readAliasedField(fm, "born", { inData: true });
    const computed = computeAge(born, presentRaw);
    if (computed !== null) data.age = computed;
}

/**
 * A being's `data.present`, read from every `place` note a batch of records or
 * frontmatter objects carries.
 *
 * Two shapes reach this by way of two thin adapters, because the callers that
 * need a present hold their notes two different ways: a flat index record
 * (`type` and `data` at the top level) and a raw walk's `{frontmatter}` pair.
 * Neither shape is the `{fm, type}` pair {@link worldInvariants} reads, so each
 * adapter states the one conversion its caller needs rather than asking every
 * caller to know it.
 *
 * @param {readonly object[]|undefined} records - Flat index records — a
 *   content-index record, or anything else spreading a note's frontmatter to
 *   its own top level.
 * @returns {unknown} The present, or `null` where no `place` note in the batch
 *   declares one.
 */
export function presentAmongRecords(records) {
    return worldInvariants({
        notes: (records ?? []).map((record) => ({ fm: record, type: record?.type })),
    }).present;
}

/**
 * The present read from a batch of raw frontmatter objects.
 *
 * @param {readonly (object|null|undefined)[]|undefined} frontmatters - One
 *   entry per note walked, as parsed — never a record.
 * @returns {unknown} The present, or `null` where none is declared.
 */
export function presentAmongFrontmatters(frontmatters) {
    return worldInvariants({
        notes: (frontmatters ?? []).map((fm) => ({ fm, type: fm?.type })),
    }).present;
}

/**
 * Check a being's authored `age` against what `born` and the package's present
 * compute.
 *
 * Registered as `being`'s whole-note `check` in `note-vocabulary.mjs`, run the
 * way `checkPlace` and `checkCalendarNote` are — beside every other check the
 * closed `data:` container earns, with the same `index`.
 *
 * Two silences, both deliberate: beside `born: unknown` or an absent `born`
 * there is nothing to disagree with, and a package that declares no present
 * computes no age to disagree with either — both cases are read by
 * {@link computeAge} returning `null`, and neither says a word.
 *
 * @param {object} note - The note, as the link index hands it over —
 *   {@link module:engine/calendar-notes.worldInvariants}'s `index.notes` shape.
 * @param {object} [opts]
 * @param {object} [opts.index] - The link index, holding the package's `place`
 *   notes. Its absence skips the check, the way a reference check with no
 *   index skips reporting every reference as dead.
 * @returns {object[]} Findings — at most one `warning`, naming both values.
 */
export function checkBeingAge(note, { index } = {}) {
    if (!isBeingType(note?.type ?? note?.fm?.type)) return [];
    const data = dataOf(note?.fm);
    if (!data) return [];

    const bornRaw = readAliasedField(note?.fm, "born", { inData: true });
    const ageRaw = data.age;
    if (ageRaw === undefined || ageRaw === null || ageRaw === "") return [];
    if (!index) return [];

    const present = worldInvariants(index).present;
    const computed = computeAge(bornRaw, present);
    if (computed === null) return [];

    const authored = parseAgeMagnitude(ageRaw);
    if (!authored || authored.value === computed) return [];

    return [
        {
            file: note.file,
            ...positionOfFrontmatterPath(note.raw ?? "", ["data", "age"], { key: true }),
            severity: "warning",
            message:
                `\`data.age: ${JSON.stringify(ageRaw)}\` disagrees with ` +
                `\`data.born: ${JSON.stringify(bornRaw)}\`, which computes to ${computed}`,
        },
    ];
}
