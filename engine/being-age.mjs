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

/** Authored ages and setting-wide current-date age calculations. @module */

import { DEFAULT_CURRENT_DATE } from "./current-date.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { parseNoteDate } from "./note-dates.mjs";
import { reckoningContext } from "./reckoning-markers.mjs";

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
 * @param {unknown} presentRaw - The configured neutral current date.
 * @returns {number|null} The age, or `null` where `born` is `unknown` or
 *   absent or future, or where either date fails to parse.
 */
export function computeAge(bornRaw, presentRaw, dateContext = {}) {
    if (bornRaw === undefined || bornRaw === null) return null;
    if (presentRaw === undefined || presentRaw === null) return null;

    const born = parseNoteDate(bornRaw, { ...dateContext, allowUnknown: true }).date;
    if (!born || !born.known || born.canonicalYear == null) return null;

    const present = parseNoteDate(presentRaw, { ...dateContext, allowUnknown: false }).date;
    if (!present || !present.known || present.canonicalYear == null) return null;

    // A resolved marker supplies a canonical day. An unmarked slash date uses
    // its written month and day. Missing parts read as the first day that the
    // value can name.
    const bornOrdinal =
        born.canonicalDay ?? (born.month === null ? 1 : (born.month ?? 1) * 100 + (born.day ?? 1));
    const presentOrdinal =
        present.canonicalDay ??
        (present.month === null ? 1 : (present.month ?? 1) * 100 + (present.day ?? 1));
    const notYetHappened = bornOrdinal > presentOrdinal;

    const age = present.canonicalYear - born.canonicalYear - (notYetHappened ? 1 : 0);
    return age < 0 ? null : age;
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
 * @param {unknown} presentRaw - The configured neutral current date.
 * @returns {void}
 */
export function applyComputedBeingAge(fm, presentRaw, dateContext = {}) {
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

    const born = data?.born;
    const computed = computeAge(born, presentRaw, dateContext);
    if (computed !== null) data.age = computed;
}

/**
 * Check an authored age against the birth date and configured current date.
 *
 * Registered as `being`'s whole-note `check` in `note-vocabulary.mjs`, run the
 * way `checkPlace` and `checkCalendarNote` are — beside every other check the
 * closed `data:` container earns, with the same `index`.
 *
 * An unknown or absent birth date supplies no computed age to compare.
 *
 * @param {object} note - The note, as the link index hands it over.
 * @param {object} [opts]
 * @param {object} [opts.index] - Calendar context for authored birth dates.
 * @param {string} [opts.currentDate="720.1"] - The configured neutral current date.
 * @returns {object[]} Findings — at most one `warning`, naming both values.
 */
export function checkBeingAge(note, { index, currentDate = DEFAULT_CURRENT_DATE } = {}) {
    if (!isBeingType(note?.type ?? note?.fm?.type)) return [];
    const data = dataOf(note?.fm);
    if (!data) return [];

    const bornRaw = data.born;
    const ageRaw = data.age;
    if (ageRaw === undefined || ageRaw === null || ageRaw === "") return [];
    const computed = computeAge(bornRaw, currentDate, reckoningContext(index));
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
