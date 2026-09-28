/* SPDX-License-Identifier: GPL-3.0-or-later */

import { eraYear, formatCanonicalDate, parseCanonicalDate } from "./calendars.mjs";
import { addressedCalendarDate } from "./calendar-human.mjs";
import { calendarEras, eraCovering, formatNoteDate, parseNoteDate } from "./note-dates.mjs";

/** Convert a day in an addressed calendar to its canonical spelling. */
export function dateFromCalendar(reference, value, context) {
    const eras = calendarEras(reference, context);
    const text = String(value ?? "").trim();
    const approximate = text.startsWith("~");
    const named = addressedCalendarDate(approximate ? text.slice(1).trim() : text, eras);
    if (!named) throw new RangeError("datefrom needs a named calendar date precise to the day");
    const authored = `${approximate ? "~" : ""}${named}`;
    const parsed = parseNoteDate(authored, { ...context, allowUnknown: false });
    const error = parsed.findings.find((finding) => finding.severity === "error");
    if (error) throw new RangeError(error.message);
    const date = parsed.date;
    if (!date || date.precision !== "day" || !Number.isSafeInteger(date.canonicalDay))
        throw new RangeError("datefrom needs a calendar date precise to the day");
    if (!eras.includes(context.eras.get(date.qualifier)))
        throw new RangeError(`date belongs to a different calendar than ${reference}`);
    if (eraCovering(date, eras, context.daysPerYear) !== context.eras.get(date.qualifier))
        throw new RangeError(`date falls outside calendar ${reference}`);
    return `${date.approximate ? "~" : ""}${formatCanonicalDate(
        { year: eraYear(date.canonicalYear), day: date.canonicalDay, seconds: date.seconds },
        context.daysPerYear,
    )}`;
}

/** Convert a canonical day to the date in the covering era of a calendar. */
export function dateToCalendar(reference, value, context, formatName) {
    const text = String(value ?? "");
    const canonical = parseCanonicalDate(
        text.startsWith("~") ? text.slice(1) : text,
        context?.daysPerYear,
    );
    if (!canonical)
        throw new RangeError("dateto needs <year>.<day>[:HHMMSS] within the world's year");
    const parsed = parseNoteDate(value, context).date;
    const era = eraCovering(parsed, calendarEras(reference, context), context.daysPerYear);
    if (!era) throw new RangeError(`canonical date falls outside calendar ${reference}`);
    const printed = formatNoteDate(parsed, era, context.daysPerYear, formatName);
    if (!printed || printed.day === null)
        throw new RangeError(`canonical date cannot be expressed in calendar ${reference}`);
    return printed.text;
}
