/* SPDX-License-Identifier: GPL-3.0-or-later */

import { formatCanonicalDate, parseCanonicalDate } from "./calendars.mjs";
import { calendarEras, eraCovering, formatNoteDate, parseNoteDate } from "./note-dates.mjs";

/** Convert a day in an addressed calendar to its canonical spelling. */
export function dateFromCalendar(reference, value, context) {
    const eras = calendarEras(reference, context);
    const text = String(value ?? "").trim();
    const explicit = /^([A-Z][A-Z0-9]*)\(/.test(text) || /\s+\S+\.\S+$/.test(text);
    if (!explicit && eras.length !== 1)
        throw new RangeError(`calendar ${reference} has multiple eras; name the era in the date`);
    const authored = explicit ? text : `${text} ${eras[0].qualifier}`;
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
    return formatCanonicalDate(
        { year: date.canonicalYear, day: date.canonicalDay, seconds: date.seconds },
        context.daysPerYear,
    );
}

/** Convert a canonical day to the date in the covering era of a calendar. */
export function dateToCalendar(reference, value, context) {
    const canonical = parseCanonicalDate(value, context?.daysPerYear);
    if (!canonical)
        throw new RangeError("dateto needs <year>.<day>[:HHMMSS] within the world's year");
    const parsed = parseNoteDate(value, context).date;
    const era = eraCovering(parsed, calendarEras(reference, context), context.daysPerYear);
    if (!era) throw new RangeError(`canonical date falls outside calendar ${reference}`);
    const result = formatNoteDate(parsed, era, context.daysPerYear);
    if (!result)
        throw new RangeError(`canonical date cannot be expressed in calendar ${reference}`);
    return result.text;
}
