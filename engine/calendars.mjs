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
 * **The reckonings a package dates by, and the arithmetic that puts them on one
 * line.**
 *
 * A setting keeps several counts of years at once — one from a founding, one
 * from a mythological unification, one from a philosophical standardisation —
 * and a note writes a date in whichever its subject keeps. Two of them run
 * forward and one runs backward, so `984 BF` precedes `100 BF` and a string
 * sort is wrong in the one direction nobody looks at.
 *
 * So every authored year normalises to a single signed number, and every
 * reckoning states the one fact that conversion needs: **the astronomical value
 * of its own year 1**.
 *
 * ```text
 * forward  C:  astronomical = epoch(C) + (year - 1)
 * backward C:  astronomical = epoch(C) - (year - 1)
 * ```
 *
 * The internal representation is **astronomical** — there is no year-zero hole,
 * so the year 1 of a backward reckoning epoched at 0 is `0` and its year 984 is
 * `-983`, and subtraction across the epoch is ordinary integer arithmetic rather
 * than a special case somebody forgets.
 *
 * **A reckoning is declared, never built in.** The registry arrives from
 * `calendars:` in the consuming package's configuration; nothing in the
 * toolchain matches on an abbreviation, and the ones written in the examples
 * here are a consuming setting's own. A list written into code stops working the
 * day a setting declares its fifth reckoning.
 *
 * **The month structure is optional, and an absent one checks nothing.** A
 * reckoning that states `months` and `monthDays` gets its year bounded; one that
 * states neither is bounded below and not above, because a toolchain that
 * invented twelve Gregorian months would refuse `667/2/30` — a date a real
 * corpus writes, in a year of twelve thirty-day months.
 *
 * @module
 */

/**
 * Which way a reckoning counts from its own year 1.
 *
 * `forward` is the ordinary case. `backward` is a count *towards* an epoch —
 * "before the founding" — where a larger written year is an earlier year.
 *
 * @type {readonly string[]}
 */
export const CALENDAR_DIRECTIONS = Object.freeze(["forward", "backward"]);

/**
 * What an abbreviation may look like.
 *
 * It is the trailing token of a date string, so it has to be unmistakable
 * against the digits it follows: letters only, so nothing in `2830 ST` is
 * ambiguous about where the year stops. One to eight of them, which fits every
 * reckoning a setting has ever abbreviated and refuses a sentence written where
 * a token belongs.
 *
 * @type {RegExp}
 */
export const CALENDAR_ABBREVIATION_PATTERN = /^[A-Za-z]{1,8}$/;

/**
 * Whether a value could be a calendar abbreviation.
 *
 * @param {unknown} value - The candidate.
 * @returns {boolean} `true` when it matches {@link CALENDAR_ABBREVIATION_PATTERN}.
 */
export function isCalendarAbbreviation(value) {
    return typeof value === "string" && CALENDAR_ABBREVIATION_PATTERN.test(value);
}

/**
 * The astronomical year a written year lands on.
 *
 * The one conversion, and the reason a registry entry states an epoch rather
 * than a formula: a reckoning differs from its neighbours in where its year 1
 * sits and which way it counts, and nothing else.
 *
 * @param {number} year - The year as authored, positive within its reckoning.
 * @param {{epoch: number, direction: string}} spec - The registry entry.
 * @returns {number} The signed astronomical year — `1 BF` is `0`.
 */
export function astronomicalYear(year, spec) {
    const offset = year - 1;
    return spec.direction === "backward" ? spec.epoch - offset : spec.epoch + offset;
}

/**
 * The total-order key a date sorts on.
 *
 * Month and day fold into the fraction, so a mixed-precision list sorts stably
 * against a single number instead of a three-key comparator. The arithmetic is
 * done in ten-thousandths and divided once, because `year + 6 / 100 + 19 /
 * 10000` accumulates a rounding error and `689.0619` is a value a reader
 * compares against by eye.
 *
 * A coarser value sorts **before** the finer values inside it: `689` precedes
 * `689/1`, which is the ordering a reader expects of a year whose month nobody
 * wrote. The fraction is added in both directions, so months and days run
 * forward inside a backward reckoning's year, which is how those calendars are
 * actually kept.
 *
 * @param {number} commonYear - The astronomical year.
 * @param {number|null} month - The month, or `null`.
 * @param {number|null} day - The day, or `null`.
 * @returns {number} The sort key.
 */
export function dateSortKey(commonYear, month, day) {
    return (commonYear * 10000 + (month ?? 0) * 100 + (day ?? 0)) / 10000;
}

/**
 * What an author writing an unregistered abbreviation is told.
 *
 * The registered list is read from the registry it is about rather than
 * restated, so a reckoning declared in configuration appears in this sentence
 * the same day.
 *
 * @param {string} value - The abbreviation the note wrote.
 * @param {Readonly<Record<string, object>>} registry - The declared reckonings.
 * @returns {string} The message, with no trailing period.
 */
export function unknownCalendarMessage(value, registry) {
    const registered = Object.keys(registry ?? {});
    return (
        `names calendar "${value}", which no registered calendar answers to — ` +
        (registered.length ?
            `registered: ${registered.join(", ")}`
        :   `no calendar is registered, so add one under \`calendars.registry\``)
    );
}

/**
 * The bounds a reckoning states for a month, or `null` where it states none.
 *
 * Separate from the check that reads it so a caller can ask what a reckoning
 * declares without phrasing a finding about it.
 *
 * @param {{months?: number|null, monthDays?: number|null}} spec - The entry.
 * @returns {{months: number|null, monthDays: number|null}} What it declares.
 */
export function calendarStructure(spec) {
    return { months: spec?.months ?? null, monthDays: spec?.monthDays ?? null };
}
