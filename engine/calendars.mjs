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
 * ## The month structure is the calendar's, and an absent list bounds nothing
 *
 * An era moves where year 1 sits; it does not divide the year differently. The
 * division belongs to the calendar, which is a note declaring an **ordered
 * list** of months, each with a name and a day count. Position in the list is
 * position in the year, so a five-day month sits wherever its people put it and
 * needs no rule of its own.
 *
 * A date is bounded by the calendar it is written in, and a calendar whose list
 * nobody has written down bounds nothing — a toolchain that invented twelve
 * Gregorian months would refuse `667/2/30`, an ordinary date in a year of
 * twelve thirty-day months.
 *
 * ## The lunar phase takes a floored modulo, not JavaScript's
 *
 * `%` takes the dividend's sign, so a day before the epoch yields `-7` where
 * the phase is 23. {@link lunarPhase} is the one place that is written.
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

/** The signed year a reckoning counts at a canonical year, without year zero. */
export function eraYear(canonical, epoch = CANONICAL_EPOCH) {
    if (!Number.isSafeInteger(canonical) || !Number.isSafeInteger(epoch))
        throw new RangeError("era conversion needs whole canonical and epoch years");
    return canonical >= epoch ? canonical - epoch + 1 : canonical - epoch;
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
 * Days from an arbitrary canonical origin to a canonical year and day.
 *
 * Canonical years form a continuous integer line. Day one opens each year;
 * calendar month divisions play no part in this count.
 *
 * @param {number} year - Canonical year.
 * @param {number} day - Day of that year, starting at one.
 * @param {number} originYear - Canonical year whose first day is offset zero.
 * @param {number} daysPerYear - The world's authored year length.
 * @returns {number} Signed whole-day offset.
 */
export function canonicalDayOffset(year, day, originYear, daysPerYear) {
    if (
        !Number.isSafeInteger(year) ||
        !Number.isSafeInteger(originYear) ||
        !Number.isSafeInteger(daysPerYear) ||
        daysPerYear < 1 ||
        !Number.isSafeInteger(day) ||
        day < 1 ||
        day > daysPerYear
    ) {
        throw new RangeError(
            "a canonical date needs an integer year and a day in the world's year",
        );
    }
    const offset = (year - originYear) * daysPerYear + day - 1;
    if (!Number.isSafeInteger(offset))
        throw new RangeError("canonical day offset exceeds integer range");
    return offset;
}

/**
 * The canonical year and day at a signed offset from an arbitrary origin.
 * Flooring the division keeps the day within the year before the origin.
 *
 * @param {number} offset - Whole days from the origin.
 * @param {number} originYear - Canonical year whose first day is offset zero.
 * @param {number} daysPerYear - The world's authored year length.
 * @returns {{year: number, day: number}} Canonical year and day.
 */
export function canonicalDateFromOffset(offset, originYear, daysPerYear) {
    if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(originYear) ||
        !Number.isSafeInteger(daysPerYear) ||
        daysPerYear < 1
    ) {
        throw new RangeError("a canonical offset needs integer days, origin year, and year length");
    }
    const years = Math.floor(offset / daysPerYear);
    const year = originYear + years;
    if (!Number.isSafeInteger(year)) throw new RangeError("canonical year exceeds integer range");
    return { year, day: offset - years * daysPerYear + 1 };
}

/**
 * Print a calendar-neutral date as `<year>.<day>[:HHMMSS]`.
 *
 * @param {{year: number, day: number, seconds?: number}} date - Canonical date.
 * @param {number} daysPerYear - The world's authored year length.
 * @returns {string} The canonical spelling.
 */
export function formatCanonicalDate(date, daysPerYear) {
    canonicalDayOffset(date?.year, date?.day, date?.year, daysPerYear);
    if (date.seconds === undefined) return `${date.year}.${date.day}`;
    if (!Number.isSafeInteger(date.seconds) || date.seconds < 0 || date.seconds >= 86400) {
        throw new RangeError("canonical time is a whole second within one day");
    }
    const hour = String(Math.floor(date.seconds / 3600)).padStart(2, "0");
    const minute = String(Math.floor((date.seconds % 3600) / 60)).padStart(2, "0");
    const second = String(date.seconds % 60).padStart(2, "0");
    return `${date.year}.${date.day}:${hour}${minute}${second}`;
}

/**
 * Read the calendar-neutral `<year>.<day>[:HHMMSS]` spelling.
 *
 * This is distinct from an authored month date such as `720/6`; no calendar
 * month list is consulted to read a canonical day of year.
 *
 * @param {unknown} value - Canonical date text.
 * @param {number} daysPerYear - The world's authored year length.
 * @returns {{year: number, day: number, seconds?: number}|null} The date, or
 *   `null` when the spelling or a component is invalid.
 */
export function parseCanonicalDate(value, daysPerYear) {
    if (typeof value !== "string") return null;
    const match = /^(-?\d+)\.(\d+)(?::(\d{2})(\d{2})(\d{2}))?$/.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const day = Number(match[2]);
    if (
        !Number.isSafeInteger(year) ||
        !Number.isSafeInteger(day) ||
        !Number.isSafeInteger(daysPerYear) ||
        daysPerYear < 1 ||
        day < 1 ||
        day > daysPerYear
    ) {
        return null;
    }
    if (match[3] === undefined) return { year, day };
    const hour = Number(match[3]);
    const minute = Number(match[4]);
    const second = Number(match[5]);
    if (hour > 23 || minute > 59 || second > 59) return null;
    return { year, day, seconds: hour * 3600 + minute * 60 + second };
}

/**
 * One month of a calendar, as the note declares it.
 *
 * @typedef {object} CalendarMonth
 * @property {string} name - What the month is called.
 * @property {string} [abbreviation] - A short form, where the note gives one.
 * @property {number} days - How many days it holds.
 */

/**
 * The months a calendar keeps, or `null` where it declares none.
 *
 * Separate from the check that reads it so a caller can ask what a calendar
 * divides its year into without phrasing a finding about it. An empty list
 * reads as no list: a calendar that declares nothing and one that declares
 * nothing in a pair of brackets divide the year identically.
 *
 * @param {{months?: readonly CalendarMonth[]|null}} [calendar] - The calendar
 *   the date is written in, as its note declares it.
 * @returns {{months: readonly CalendarMonth[]|null}} What it divides the year
 *   into.
 */
export function calendarStructure(calendar) {
    const written = calendar?.months;
    if (!Array.isArray(written) || written.length === 0) return { months: null };
    return { months: written };
}

/**
 * How long one month of a calendar is, or `null` where the calendar is silent.
 *
 * @param {{months?: readonly CalendarMonth[]|null}|undefined} calendar - The calendar.
 * @param {number} month - The month, numbered from 1.
 * @returns {number|null} Its length in days, or `null`.
 */
export function daysInMonth(calendar, month) {
    const { months } = calendarStructure(calendar);
    if (!months || month < 1 || month > months.length) return null;
    const days = months[month - 1]?.days;
    return typeof days === "number" ? days : null;
}

/**
 * How many days the months add up to.
 *
 * The number a calendar's list claims the year is. Whether that is the year the
 * world keeps is a question about the world, and is asked elsewhere.
 *
 * @param {readonly CalendarMonth[]} months - The ordered month list.
 * @returns {number} The sum of their day counts.
 */
export function daysInYear(months) {
    return months.reduce((sum, month) => sum + (Number(month?.days) || 0), 0);
}

/**
 * The day of the year each month opens on, in order, numbered from 1.
 *
 * The sum read as a sequence rather than as a total. Two lists holding the same
 * numbers in a different order sum alike and open their months on different
 * days, which is the error a total cannot see.
 *
 * @param {readonly CalendarMonth[]} months - The ordered month list.
 * @returns {number[]} One entry per month: the day of the year it begins on.
 */
export function monthStarts(months) {
    const starts = [];
    let day = 1;
    for (const month of months) {
        starts.push(day);
        day += Number(month?.days) || 0;
    }
    return starts;
}

/**
 * Which day of the year a written month and day land on, numbered from 1.
 *
 * @param {readonly CalendarMonth[]} months - The ordered month list.
 * @param {number} month - The month, numbered from 1.
 * @param {number} day - The day within it, numbered from 1.
 * @returns {number} The day of the year.
 */
export function dayOfYear(months, month, day) {
    return monthStarts(months)[month - 1] + day - 1;
}

/**
 * Recover a calendar's month and day from an ordinal day of its year.
 *
 * @param {readonly CalendarMonth[]} months - The ordered month list.
 * @param {number} ordinal - Day of year, starting at one.
 * @returns {{month: number, day: number}|null} The named day, or `null` outside the year.
 */
export function monthDayOfYear(months, ordinal) {
    if (!Number.isSafeInteger(ordinal) || ordinal < 1) return null;
    let remaining = ordinal;
    for (let position = 0; position < months.length; position++) {
        const length = Number(months[position]?.days);
        if (!Number.isSafeInteger(length) || length < 1) return null;
        if (remaining <= length) return { month: position + 1, day: remaining };
        remaining -= length;
    }
    return null;
}

/**
 * How far into its cycle a moon is on a given day.
 *
 * **Floored, not truncated.** JavaScript's `%` takes the dividend's sign, so a
 * day seven before the epoch yields `-7` where the phase is 23 — a value that
 * is right on one side of the epoch and wrong on the other, which is invisible
 * in any list that does not span it.
 *
 * @param {number} dayNumber - The day, on whatever continuous day count the
 *   caller keeps.
 * @param {number} epochDay - The day of that same count on which the moon was
 *   new.
 * @param {number} cycle - The cycle's length in days.
 * @returns {number} Days into the cycle, `0` to `cycle - 1`.
 */
export function lunarPhase(dayNumber, epochDay, cycle) {
    return (((dayNumber - epochDay) % cycle) + cycle) % cycle;
}
