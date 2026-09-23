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
 * **The axis every date normalises onto, and the one function that puts a
 * reckoning on it.**
 *
 * A setting keeps several counts of years at once, each proclaimed by a body
 * that has a note — a founding, a first occasion, a reign. A date either names
 * one of them or names none, in which case it sits on the **canonical axis**.
 *
 * ## The canonical axis is an authoring device, not a calendar
 *
 * The axis is the line of integers dates written by peoples who never met are
 * compared on. Nobody in a setting keeps it, no body stands behind it, and no
 * shortcode addresses it: a date is on the axis exactly when it names no era.
 * A reckoning whose year 1 happens to sit where the axis's year 1 sits
 * coincides with it numerically and is still that people's own count.
 *
 * ## There is no year zero, and one function converts
 *
 * The authored numbering skips zero — `-1` sits immediately before `1` — while
 * the normalised value does not, so that arithmetic across an epoch is one
 * subtraction rather than a special case somebody forgets.
 *
 * ```text
 * authored        …  -3   -2   -1    1    2    3  …
 * canonicalYear   …  -2   -1    0    1    2    3  …
 * ```
 *
 * ```text
 * canonicalYear(y, E) = E + (y > 0 ? y - 1 : y)
 * ```
 *
 * `E` is where a reckoning's year 1 sits on the axis — the `canonicalYear` of
 * an era's own `start`. The axis is the same function with `E` of
 * {@link CANONICAL_EPOCH}, which holds by definition: the axis's year 1 is the
 * axis's year 1.
 *
 * **The conversion is piecewise on the sign**, and that is the property worth
 * guarding. Collapsed to a single branch it is correct on one side of an epoch
 * and off by one on the other, which is invisible in any list that does not
 * span it.
 *
 * ## The month structure is the package's, and an absent bound checks nothing
 *
 * An era moves where year 1 sits; it does not divide the year differently. So
 * the subdivision is declared once for the package, in `calendar.months` and
 * `calendar.monthDays`, and a package that declares neither is bounded below
 * and not above — a toolchain that invented twelve Gregorian months would
 * refuse `667/2/30`, which is an ordinary date in a year of twelve thirty-day
 * months.
 *
 * @module
 */

/**
 * Where the canonical axis's own year 1 sits — on itself.
 *
 * It takes no configuration entry and no era row, because it is true by
 * definition rather than by declaration.
 *
 * @type {number}
 */
export const CANONICAL_EPOCH = 1;

/**
 * The year on the canonical axis that a written year lands on.
 *
 * The whole of the conversion. A reckoning differs from its neighbours in
 * where its year 1 sits and in nothing else, so an era states one number and
 * this states what to do with it.
 *
 * The two branches are the year-zero hole: the authored numbering has no year
 * 0, so a positive year is one place closer to the epoch than its magnitude
 * suggests and a negative year is exactly its magnitude below it.
 *
 * @param {number} year - The year as authored, signed, within its own
 *   reckoning. Never 0 — the authored numbering has no such year.
 * @param {number} [epoch] - Where that reckoning's year 1 sits on the axis.
 *   Omitted, the axis itself.
 * @returns {number} The signed year on the axis — authored `-1` is `0`.
 */
export function canonicalYear(year, epoch = CANONICAL_EPOCH) {
    return epoch + (year > 0 ? year - 1 : year);
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
 * wrote.
 *
 * @param {number} year - The year on the canonical axis.
 * @param {number|null} month - The month, or `null`.
 * @param {number|null} day - The day, or `null`.
 * @returns {number} The sort key.
 */
export function dateSortKey(year, month, day) {
    return (year * 10000 + (month ?? 0) * 100 + (day ?? 0)) / 10000;
}

/**
 * The bounds a package states for a month, or `null` where it states none.
 *
 * Separate from the check that reads it so a caller can ask what a package
 * declares without phrasing a finding about it.
 *
 * @param {{months?: number|null, monthDays?: number|null}} [calendar] - The
 *   resolved `calendar:` block.
 * @returns {{months: number|null, monthDays: number|null}} What it declares.
 */
export function calendarStructure(calendar) {
    return { months: calendar?.months ?? null, monthDays: calendar?.monthDays ?? null };
}
