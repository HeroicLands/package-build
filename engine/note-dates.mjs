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
 * Parse authored note dates into records used by content checks and renderers.
 *
 * A neutral day is `<year>.<day>[:HHMMSS]`, where `day` is an ordinal within
 * the world's year. A named date is `datefrom <calendar> <date>`; its calendar
 * and era resolve the value on the neutral timeline. Either form accepts a
 * leading `~` for approximation. `unknown` is unordered.
 *
 * `text` keeps the authored spelling. `canonicalYear` and `sort` are set for
 * neutral and resolved named dates. Resolved dates also carry `canonicalDay`,
 * the ordinal day within the neutral year.
 *
 * @module
 */

import { ADDRESS_SEGMENT_PATTERN } from "./address-charset.mjs";
import { addressedCalendarDate } from "./calendar-human.mjs";
import {
    calendarStructure,
    canonicalDateFromOffset,
    canonicalDayOffset,
    canonicalYear,
    dateSortKey,
    dayOfYear,
    daysInMonth,
    eraYear,
    monthDayOfYear,
    parseCanonicalDate,
} from "./calendars.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";

/**
 * The literal that says a thing happened and the date is not recorded.
 *
 * @type {string}
 */
export const UNKNOWN_DATE = "unknown";

/**
 * One address segment, read out of the charset addresses are already held to
 * rather than restated — a second copy is one more thing to drift.
 */
const SEGMENT = ADDRESS_SEGMENT_PATTERN.source.replace(/^\^|\$$/g, "");

/** The era qualifier's body, without anchors, for composing into the grammar. */
const ERA = `(?:${SEGMENT}-){0,3}${SEGMENT}\\.${SEGMENT}`;

/**
 * What a date's trailing token may look like.
 *
 * A calendar note's address followed by `.<era shortcode>`. The `{0,3}`
 * repetition is the four address forms exactly — bare `shortcode`,
 * `type-shortcode`, `system-type-shortcode` and
 * `package-system-type-shortcode` — so the hyphen separates an address's
 * segments, the dot separates the address from the era, and the split needs no
 * lookahead.
 *
 * @type {RegExp}
 */
export const ERA_QUALIFIER_PATTERN = new RegExp(`^${ERA}$`);

/**
 * The grammar, as one expression.
 *
 * @type {RegExp}
 */
export const NOTE_DATE_PATTERN = new RegExp(
    `^(~)?\\s*(-?\\d+)(?:/(\\d+)(?:/(\\d+)(?::(\\d{6}))?)?)?(?:\\s+(${ERA}))?$`,
);

/** A calendar conversion written as a frontmatter date value. */
export const DATEFROM_PATTERN = /^datefrom\s+(\S+)\s+(.+)$/;

/** A day written with no month — ungrammatical, and worth its own sentence. */
const DAY_WITHOUT_MONTH_PATTERN = /^(?:~)?\s*-?\d+\/\/\d+(?:\s+\S+)?$/;

/** A trailing token carrying a dot that the era grammar still refuses. */
const MALFORMED_ERA_PATTERN = /^(?:~)?\s*-?\d+(?:\/\d+(?:\/\d+)?)?\s+\S*\.\S*$/;

/** A trailing word with no dot, which names nothing now that an era is addressed. */
const DOTLESS_TOKEN_PATTERN = /^(?:~)?\s*(-?\d+)((?:\/\d+(?:\/\d+)?)?)\s+[A-Za-z][A-Za-z0-9]*$/;

/** The record an unknown date parses to — every field but `text` and `known` empty. */
function unknownRecord() {
    return {
        text: UNKNOWN_DATE,
        known: false,
        era: null,
        year: null,
        month: null,
        day: null,
        approximate: false,
        precision: null,
        // Never 0 and never a defaulted null year: see the module docs.
        canonicalYear: null,
        sort: null,
    };
}

/**
 * Parse one authored date.
 *
 * Every field that holds a date — a birth, a death, an event's start and its
 * end — parses through here, so there is one grammar to write, test, document
 * and teach.
 *
 * Findings are returned rather than thrown, because a corpus pass wants every
 * bad value in one run rather than the first. Each carries the `file` it was
 * given and, where `raw` and `keyPath` locate the value, its line and column;
 * a position that cannot be established honestly is dropped rather than
 * defaulted, which is what keeps `file:line:column:` parseable.
 *
 * @param {unknown} value - The authored value. A number is what YAML hands
 *   back for a bare year, so it is accepted and stringified.
 * @param {object} [options]
 * @param {{months?: readonly object[]|null}} [options.calendar] - The calendar
 *   the value is written in, as its note declares it. Its ordered month list
 *   bounds a written month and a written day, the day against the length of
 *   the month it names. A calendar that declares no list bounds nothing.
 * @param {Map<string, object>} [options.markers] - Resolved era markers from
 *   the corpus, each carrying its calendar and canonical start.
 * @param {Map<string, object>} [options.eras] - Resolved calendar eras, keyed
 *   by their addressed qualifier.
 * @param {boolean} [options.ignoreEraBounds=false] - Parse a calendar row's
 *   own boundary in a referenced era without applying that era's note span.
 * @param {number} [options.daysPerYear] - The world's year length, required for
 *   canonical days and named dates.
 * @param {string} [options.field] - The key that carried it, named in every
 *   message. Omitted, a message names the value alone.
 * @param {boolean} [options.allowUnknown=true] - Whether `"unknown"` is a
 *   permitted value here. It is not, in a field whose absence already says the
 *   date is unrecorded.
 * @param {string} [options.file] - The note, for the diagnostics.
 * @param {string} [options.raw] - The note's full contents, to locate the value.
 * @param {ReadonlyArray<string|number>} [options.keyPath] - Path to the key
 *   within the frontmatter, for the same.
 * @returns {{date: object|null, findings: object[]}} The record, or `null` when
 *   the value is absent or refused, and every finding the value earned.
 */
export function parseNoteDate(value, options) {
    const {
        calendar,
        markers,
        eras,
        ignoreEraBounds = false,
        daysPerYear,
        field,
        allowUnknown = true,
        file,
        raw,
        keyPath,
    } = options ?? {};
    const findings = [];

    // Absence is a fact about the subject, not a gap — nothing to parse and
    // nothing to say about it.
    if (value === null || value === undefined) return { date: null, findings };

    const at = () => ({
        ...(file === undefined ? {} : { file }),
        ...(raw !== undefined && keyPath !== undefined ?
            positionOfFrontmatterPath(raw, keyPath)
        :   {}),
    });
    const authored = typeof value === "number" || typeof value === "string";
    // A YAML scalar reaches here as a string or, for a bare year, as a number.
    // Anything else is not a date, and the message shows what it was rather
    // than an empty pair of backticks.
    const text = authored ? String(value) : "";
    const shown = authored ? text : JSON.stringify(value);
    const subject = field ? `\`${field}: ${shown}\`` : `\`${shown}\``;
    const refuse = (message) => {
        findings.push({ ...at(), severity: "error", message });
        return { date: null, findings };
    };

    const resolveEra = (parsed, reckoning, label) => {
        if (!ignoreEraBounds && parsed.year < 0 && reckoning.firstEra === false)
            return refuse(
                `${subject} counts backward from ${label}, but only the first era of a calendar may do so`,
            );
        if (!Number.isSafeInteger(daysPerYear) || daysPerYear < 1)
            return refuse(`${subject} needs the world's year length to resolve ${label}`);
        const { months } = calendarStructure(reckoning.calendar);
        if (!months) return refuse(`${subject} names ${label}, whose calendar declares no months`);
        if (parsed.month !== null && parsed.month > months.length)
            return refuse(
                `${subject} writes month ${parsed.month}, and ${label} keeps ${months.length} months`,
            );
        const length = parsed.month === null ? null : daysInMonth(reckoning.calendar, parsed.month);
        if (parsed.day !== null && length !== null && parsed.day > length)
            return refuse(
                `${subject} writes day ${parsed.day}, and month ${parsed.month} is ${length} days long`,
            );
        const ordinal = dayOfYear(months, parsed.month ?? 1, parsed.day ?? 1);
        const start = canonicalDayOffset(reckoning.epochYear, reckoning.epochDay, 1, daysPerYear);
        const yearOffset = parsed.year > 0 ? parsed.year - 1 : parsed.year;
        const offset = start + yearOffset * daysPerYear + ordinal - 1;
        if (!Number.isSafeInteger(offset))
            return refuse(`${subject} lies outside the supported canonical day range`);
        const spanDays =
            parsed.precision === "year" ? daysPerYear
            : parsed.precision === "month" ? length
            : 1;
        if (
            !ignoreEraBounds &&
            reckoning.endOffset !== undefined &&
            offset + spanDays - 1 > reckoning.endOffset
        )
            return refuse(`${subject} lies after the end of ${label}`);
        const canonical = canonicalDateFromOffset(offset, 1, daysPerYear);
        return {
            date: {
                ...parsed,
                text,
                era: reckoning.era,
                qualifier: reckoning.qualifier,
                canonicalYear: canonical.year,
                canonicalDay: canonical.day,
                spanDays,
                sort:
                    canonical.year +
                    (canonical.day - 1 + (parsed.seconds ?? 0) / 86400) / daysPerYear,
            },
            findings,
        };
    };

    if (text.trim() === UNKNOWN_DATE) {
        if (allowUnknown) return { date: unknownRecord(), findings };
        return refuse(
            `${subject} — \`${UNKNOWN_DATE}\` records that something happened and ` +
                `the date is not known, which only a field whose absence means it ` +
                `never happened has any use for. \`${field ?? "this field"}\` is not ` +
                `one, so leave it out instead`,
        );
    }

    const trimmed = text.trim();
    const approximateInput = trimmed.startsWith("~");
    const unmarked = approximateInput ? trimmed.slice(1).trim() : trimmed;
    const conversion = DATEFROM_PATTERN.exec(unmarked);
    if (conversion) {
        try {
            const [, reference, human] = conversion;
            const addressed = addressedCalendarDate(
                human.trim(),
                calendarEras(reference, { eras }),
            );
            if (!addressed) return refuse(`${subject} needs a named calendar date`);
            const parsed = parseNoteDate(`${approximateInput ? "~" : ""}${addressed}`, {
                markers,
                eras,
                daysPerYear,
                ignoreEraBounds,
                allowUnknown: false,
                file,
                raw,
                keyPath,
            });
            if (!parsed.date || parsed.findings.some((item) => item.severity === "error"))
                return parsed;
            return { date: { ...parsed.date, text }, findings: parsed.findings };
        } catch (err) {
            return refuse(`${subject} cannot resolve its calendar date: ${err.message}`);
        }
    }
    if (/^-?0+\.\d+(?::\d{6})?$/.test(unmarked))
        return refuse(
            `${subject} writes year 0, and no reckoning has one — the years either ` +
                `side of an epoch are -1 and 1`,
        );
    if (field && !/^-?\d+\.\d+(?::\d{6})?$/.test(unmarked))
        return refuse(
            `${subject} is not a frontmatter date — write ` +
                "`<year>.<day>[:HHMMSS]` or `datefrom <calendar> <date>`",
        );
    if (unmarked.includes(".")) {
        const canonical = parseCanonicalDate(unmarked, daysPerYear ?? Number.MAX_SAFE_INTEGER);
        if (canonical) {
            return {
                date: {
                    text,
                    known: true,
                    era: null,
                    year: canonical.year,
                    month: null,
                    day: canonical.day,
                    approximate: approximateInput,
                    precision: "day",
                    canonicalYear: canonical.year,
                    canonicalDay: canonical.day,
                    spanDays: 1,
                    ...(canonical.seconds === undefined ? {} : { seconds: canonical.seconds }),
                    sort:
                        Number.isSafeInteger(daysPerYear) ?
                            canonical.year +
                            (canonical.day - 1 + (canonical.seconds ?? 0) / 86400) / daysPerYear
                        :   null,
                },
                findings,
            };
        }
        if (/^-?\d+\.\d+/.test(trimmed))
            return refuse(
                `${subject} is not a canonical date — write \`<year>.<day>[:HHMMSS]\` with a day inside the world's year`,
            );
    }
    const match = NOTE_DATE_PATTERN.exec(trimmed);
    if (!match) {
        if (DAY_WITHOUT_MONTH_PATTERN.test(trimmed)) {
            return refuse(
                `${subject} writes a day with no month — a date is written to the ` +
                    `year, to the month or to the day, and each level needs the one ` +
                    `above it`,
            );
        }
        if (MALFORMED_ERA_PATTERN.test(trimmed)) {
            return refuse(
                `${subject} — an era is written ` +
                    `\`<calendar shortcode>.<era shortcode>\`, lowercase letters ` +
                    `and digits only`,
            );
        }
        if (DOTLESS_TOKEN_PATTERN.test(trimmed)) {
            // The message an author who learned a retired spelling meets. No
            // table says which direction that spelling counted, so it states
            // the rule rather than guessing a concrete replacement.
            return refuse(
                `${subject} names no era — a reckoning is written ` +
                    `\`<calendar shortcode>.<era shortcode>\`: a year before ` +
                    `an era's epoch is written negative, and a year after it ` +
                    `simply drops the token`,
            );
        }
        return refuse(
            `${subject} is not a date — write ` +
                `\`<year>.<day>[:HHMMSS]\` or ` +
                `\`datefrom <calendar> <date>\``,
        );
    }

    const [, tilde, yearText, monthText, dayText, timeText, era] = match;
    const approximate = tilde === "~";
    const year = Number(yearText);
    const month = monthText === undefined ? null : Number(monthText);
    const day = dayText === undefined ? null : Number(dayText);
    const seconds =
        timeText === undefined ? undefined : (
            Number(timeText.slice(0, 2)) * 3600 +
            Number(timeText.slice(2, 4)) * 60 +
            Number(timeText.slice(4, 6))
        );
    if (
        !Number.isSafeInteger(year) ||
        (month !== null && !Number.isSafeInteger(month)) ||
        (day !== null && !Number.isSafeInteger(day))
    )
        return refuse(
            `${subject} needs whole year, month, and day numbers inside the supported range`,
        );

    // No year zero, in any reckoning: the years either side of an epoch are -1
    // and 1. `-0` is the same year written the other way and is refused with it.
    if (year === 0) {
        return refuse(
            `${subject} writes year 0, and no reckoning has one — the years either ` +
                `side of an epoch are -1 and 1`,
        );
    }
    if (
        timeText !== undefined &&
        (Number(timeText.slice(0, 2)) > 23 ||
            Number(timeText.slice(2, 4)) > 59 ||
            Number(timeText.slice(4, 6)) > 59)
    )
        return refuse(`${subject} needs a 24-hour time in HHMMSS form`);

    const { months } = calendarStructure(calendar);
    if (month !== null && month < 1) {
        return refuse(`${subject} writes month ${month}, and a month is numbered from 1`);
    }
    // An upper bound is checked only where the calendar states its months.
    // Twelve Gregorian months assumed here would refuse `667/2/30`, which is a
    // correct date in a year of twelve thirty-day months.
    if (month !== null && months !== null && month > months.length) {
        return refuse(
            `${subject} writes month ${month}, and the calendar it is written in ` +
                `keeps ${months.length} months`,
        );
    }
    if (day !== null && day < 1) {
        return refuse(`${subject} writes day ${day}, and a day is numbered from 1`);
    }
    // Per month, because the months differ: a five-day month sits in the list
    // wherever its people put it, and a bound taken from the longest month
    // would accept a date that calendar has no day for.
    const length = month !== null ? daysInMonth(calendar, month) : null;
    if (day !== null && length !== null && day > length) {
        const named = months?.[month - 1]?.name;
        return refuse(
            `${subject} writes day ${day}, and ${named ? `${named}` : `month ${month}`} ` +
                `is ${length} days long`,
        );
    }

    const precision =
        day !== null ? "day"
        : month !== null ? "month"
        : "year";
    if (approximate && precision === "day") {
        findings.push({
            ...at(),
            severity: "warning",
            message:
                `${subject} marks a day approximate, which is nearly always a slip ` +
                `— drop the \`~\`, or write the month or the year the date is ` +
                `approximate to`,
        });
    }

    const date = {
        text,
        known: true,
        era: era ?? null,
        year,
        month,
        day,
        ...(seconds === undefined ? {} : { seconds }),
        approximate,
        precision,
    };
    // A named era's epoch is a fact the corpus states, so the numbers derived
    // from it are written by the pass that resolves it and are absent until
    // then. A bare value is already on the axis.
    if (era !== undefined && eras) {
        const reckoning = eras.get(era);
        if (reckoning?.ambiguous)
            return refuse(
                `${subject} names ambiguous calendar era ${era}; qualify its package and system`,
            );
        if (!reckoning) return refuse(`${subject} names unknown calendar era ${era}`);
        return resolveEra(date, reckoning, `calendar era ${era}`);
    }
    if (era === undefined) {
        date.canonicalYear = canonicalYear(year);
        if (precision === "year" && Number.isSafeInteger(daysPerYear)) date.spanDays = daysPerYear;
        date.sort =
            dateSortKey(date.canonicalYear, month, day) +
            (seconds ?? 0) / 86400 / (daysPerYear ?? 1);
    }
    return { date, findings };
}

/** Select the single era covering the full precision of a resolved date. */
export function eraCovering(date, eraRows, daysPerYear) {
    if (
        !date?.known ||
        !Number.isSafeInteger(date.canonicalYear) ||
        !Number.isSafeInteger(daysPerYear) ||
        !Number.isSafeInteger(date.spanDays)
    )
        return null;
    const start = canonicalDayOffset(date.canonicalYear, date.canonicalDay ?? 1, 1, daysPerYear);
    const end = start + date.spanDays - 1;
    const matches = [...new Set(eraRows ?? [])].filter(
        (era) =>
            Number.isSafeInteger(era?.startOffset) &&
            (era.firstEra === true || era.startOffset <= start) &&
            (era.endOffset === undefined || end <= era.endOffset),
    );
    if (matches.length > 1)
        throw new RangeError(
            `date is covered by overlapping eras ${matches.map((era) => era.era).join(", ")}`,
        );
    return matches[0] ?? null;
}

/** Resolve a calendar or one of its eras from an Address or shortcode. */
export function calendarEras(reference, context) {
    const name = String(reference ?? "");
    const rows = [...new Set(context?.eras?.values() ?? [])].filter(
        (era) => era && !era.ambiguous && era.era,
    );
    const explicit = context?.eras?.get(name);
    if (explicit?.ambiguous) throw new RangeError(`calendar era ${name} is ambiguous`);
    if (explicit?.era) return [explicit];
    const calendars = new Map();
    for (const era of rows) {
        const full = era.qualifier.slice(0, -(era.era.split(".").at(-1).length + 1));
        const short = era.calendarShortcode;
        if ([full, short, `lore-${short}`, `note-lore-${short}`].includes(name)) {
            const list = calendars.get(full) ?? [];
            list.push(era);
            calendars.set(full, list);
        }
    }
    if (calendars.size === 0) throw new RangeError(`calendar ${name} does not resolve`);
    if (calendars.size > 1)
        throw new RangeError(`calendar ${name} is ambiguous; use its full Address`);
    return [...calendars.values()][0];
}

/** Print a resolved date using the era active in one addressed calendar. */
export function formatDateInCalendar(date, reference, context) {
    const eras = calendarEras(reference, context);
    const chosen = eraCovering(date, eras, context?.daysPerYear);
    const name = String(reference ?? "");
    if (context?.eras?.get(name)?.era && chosen === null)
        throw new RangeError(`date falls outside calendar era ${name}`);
    return formatNoteDate(date, chosen, context?.daysPerYear);
}

/** Print a resolved date in one era, retaining its authored precision. */
export function formatNoteDate(date, era, daysPerYear) {
    if (!date?.known || !Number.isSafeInteger(date.canonicalYear)) return null;
    if (!era) return { era: null, year: eraYear(date.canonicalYear), text: date.text, prose: null };
    if (!Number.isSafeInteger(daysPerYear) || !Number.isSafeInteger(date.spanDays)) return null;
    const target = era;
    const start = canonicalDayOffset(date.canonicalYear, date.canonicalDay ?? 1, 1, daysPerYear);
    if (start < target.startOffset && target.firstEra !== true) return null;
    if (target.endOffset !== undefined && start + date.spanDays - 1 > target.endOffset) return null;
    const epoch =
        target.startOffset ??
        canonicalDayOffset(target.epochYear, target.epochDay ?? 1, 1, daysPerYear);
    const delta = start - epoch;
    const cycle = Math.floor(delta / daysPerYear);
    const year = cycle >= 0 ? cycle + 1 : cycle;
    if (Math.floor((delta + date.spanDays - 1) / daysPerYear) !== cycle) return null;

    let month = null;
    let day = null;
    if (date.precision !== "year") {
        const months = calendarStructure(target.calendar).months;
        if (!months) return null;
        const ordinal = (((delta % daysPerYear) + daysPerYear) % daysPerYear) + 1;
        const named = monthDayOfYear(months, ordinal);
        if (!named) return null;
        month = named.month;
        if (date.precision === "month") {
            if (named.day !== 1 || date.spanDays !== daysInMonth(target.calendar, month))
                return null;
        } else day = named.day;
    }
    const clock =
        date.seconds === undefined ?
            ""
        :   ` ${String(Math.floor(date.seconds / 3600)).padStart(2, "0")}:` +
            `${String(Math.floor(date.seconds / 60) % 60).padStart(2, "0")}:` +
            `${String(date.seconds % 60).padStart(2, "0")}`;
    const monthName =
        month === null ? null : calendarStructure(target.calendar).months?.[month - 1]?.name;
    const eraName =
        target.abbreviation || target.marker || target.name || target.era.split(".").at(-1);
    const text = `${date.approximate ? "~" : ""}${day === null ? "" : `${day} `}${monthName ? `${monthName} ` : ""}${year} ${eraName}${clock}`;
    const digits = `${Math.abs(year)}${month === null ? "" : `/${month}`}${day === null ? "" : `/${day}${clock.replaceAll(":", "").replace(/^ /, ":")}`}`;
    const label =
        typeof target.label === "string" ?
            target.label
        :   target.label?.[year < 0 ? "before" : "after"];
    const prose =
        typeof label === "string" && label.includes("{date}") ?
            label.replace("{date}", `${date.approximate ? "~" : ""}${digits}`)
        :   null;
    return { era, year, month, day, text, prose };
}

/** Normalize a note's declared dates for indexes and generated pages. */
export function resolvedDateFields(fm, context) {
    const fields =
        fm?.type === "being" ?
            [
                ["born", fm.data?.born],
                ["died", fm.data?.died],
            ]
        : fm?.type === "lore" ?
            [
                ["when", fm.data?.event?.when],
                ["until", fm.data?.event?.until],
            ]
        :   [];
    const out = {};
    for (const [key, value] of fields) {
        if (value === undefined || value === null) continue;
        const parsed = parseNoteDate(value, {
            ...context,
            allowUnknown: key === "born" || key === "died",
        });
        if (parsed.date && !parsed.findings.some((finding) => finding.severity === "error")) {
            const era =
                parsed.date.marker ? context?.markers?.get(parsed.date.marker)
                : parsed.date.qualifier ? context?.eras?.get(parsed.date.qualifier)
                : null;
            const printable = formatNoteDate(parsed.date, era, context?.daysPerYear);
            out[key] = { ...parsed.date, prose: printable?.prose ?? null };
        }
    }
    return out;
}
