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
 * A neutral date is `<year>[.<day>[:HHMMSS]]`, where `day` is an ordinal
 * within the world's year. A bare year spans that year; a day spans that day;
 * a clock time identifies a second. A named date uses the `datefrom` form;
 * its calendar and era resolve the value on the neutral timeline.
 * Either form accepts `~` for uncertainty beyond its stated interval.
 * `unknown` is unordered.
 *
 * `text` keeps the authored spelling. `canonicalYear` and `sort` are set for
 * neutral and resolved named dates. A neutral year retains `precision: "year"`
 * and has no `canonicalDay`; day one is used only to calculate its bounds.
 *
 * **Year 0 means any year**, and is accepted only where a caller passes
 * `allowZeroYear` — a `lore` event's `when`. `when: "0.5"` is the fifth day of
 * the year, in every year: the value carries `year: 0` and a `canonicalDay`,
 * but no `canonicalYear` and no `sort`, since it names no point on the axis
 * and cannot date its own note. Every other field keeps the ordinary
 * refusal, and a bare `0` with no day is refused everywhere — any year with
 * no day names nothing.
 *
 * @module
 */

import { ADDRESS_SEGMENT_PATTERN } from "./address-charset.mjs";
import { addressedCalendarDate } from "./calendar-human.mjs";
import {
    calendarFormatHasClock,
    formatCalendarPattern,
    selectCalendarFormat,
} from "./calendar-format.mjs";
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
 * Whether a number-valued date may have lost a trailing zero off its day.
 *
 * YAML reads an unquoted `<year>.<day>` as a float, and a float carries no
 * trailing zero: `born: 667.130` and `born: 667.13` both arrive as `667.13`.
 * The authored digits are unrecoverable by then, so the question a reader needs
 * answered is whether a longer day was *possible* — and it was exactly when the
 * value with one more zero on the end still names a day the world's year holds.
 *
 * One zero settles it. A second only makes the day ten times longer again, so a
 * value whose single-zero expansion already falls outside the year has no
 * reading but the one it was handed.
 *
 * **The world's year length is what makes the question answerable**, so a tree
 * whose notes declare none gets no claim either way — the same rule the upper
 * bound on a day follows. Refusing every float there would red a whole corpus
 * over a test nothing could evaluate.
 *
 * @param {number} value - The authored value, as YAML parsed it.
 * @param {number|undefined} daysPerYear - The world's year length.
 * @returns {boolean} True when the authored day is ambiguous.
 */
function dayCouldHaveLostAZero(value, daysPerYear) {
    if (Number.isInteger(value)) return false;
    const fraction = String(Math.abs(value)).split(".")[1] ?? "";
    // An exponent-form string carries no day at all.
    if (!/^\d+$/.test(fraction)) return false;
    const tenfold = Number(`${fraction}0`);
    if (!Number.isSafeInteger(tenfold)) return false;
    if (!Number.isSafeInteger(daysPerYear) || daysPerYear < 1) return false;
    return tenfold <= daysPerYear;
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
        // Narrows the year-0 refusal for exactly one caller: an `events`
        // entry's `when`, where year 0 means "this day, every year" rather
        // than a point on the axis. Every other field keeps the refusal.
        allowZeroYear = false,
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

    // An unquoted `<year>.<day>` reaches here as a float, and YAML has already
    // dropped a trailing zero off the day: `667.13` and `667.130` arrive as one
    // value, so nothing downstream can tell day 13 from day 130. Refused where
    // the lost zero would still name a day inside the world's year, and read as
    // written where no such day exists — `675.281` cannot have been `675.2810`.
    if (typeof value === "number" && dayCouldHaveLostAZero(value, daysPerYear)) {
        const grown = `${text}0`;
        return refuse(
            `${subject} is a number, and a day's trailing zero is lost before a date ` +
                `is read — \`${text}\` and \`${grown}\` reach this check as one value. ` +
                `Quote a canonical date that states a day, \`"${text}"\` or ` +
                `\`"${grown}"\`, so the digits the note states are the digits the ` +
                `build reads`,
        );
    }

    const resolveEra = (parsed, reckoning, label) => {
        if (parsed.year < 1) return refuse(`${subject} needs a positive year in ${label}`);
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
        const yearOffset = reckoning.beforeEra ? -parsed.year : parsed.year - 1;
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
    // Negative zero (`-0.<day>`) is refused unconditionally — it is the same
    // year as bare `0` written the other way, and `allowZeroYear` means only
    // "any year", never "any year, backwards". A bare positive `0.<day>` is
    // refused everywhere except the one caller that passes `allowZeroYear`.
    if (
        /^-0+\.\d+(?::\d{6})?$/.test(unmarked) ||
        (!allowZeroYear && /^0+\.\d+(?::\d{6})?$/.test(unmarked))
    )
        return refuse(
            `${subject} writes year 0, and no reckoning has one — the years either ` +
                `side of an epoch are -1 and 1`,
        );
    if (field && !/^-?\d+(?:\.\d+(?::\d{6})?)?$/.test(unmarked))
        return refuse(
            `${subject} is not a frontmatter date — write ` +
                "`<year>[.<day>[:HHMMSS]]` or `datefrom <calendar> <date>`",
        );
    if (unmarked.includes(".")) {
        const canonical = parseCanonicalDate(unmarked, daysPerYear ?? Number.MAX_SAFE_INTEGER);
        if (canonical && canonical.year === 0) {
            // Year 0 means "this day, every year" — it names no point on the
            // axis, so it carries no `canonicalYear` and no `sort`: nothing
            // orders it and it cannot date its note, the same silence
            // `unknown` keeps for the fields that carry no axis position.
            return {
                date: {
                    text,
                    known: true,
                    era: null,
                    year: 0,
                    month: null,
                    day: canonical.day,
                    approximate: approximateInput,
                    precision: "day",
                    canonicalDay: canonical.day,
                    spanDays: 1,
                    ...(canonical.seconds === undefined ? {} : { seconds: canonical.seconds }),
                },
                findings,
            };
        }
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
                    canonicalYear: canonicalYear(canonical.year),
                    canonicalDay: canonical.day,
                    spanDays: 1,
                    ...(canonical.seconds === undefined ? {} : { seconds: canonical.seconds }),
                    sort:
                        Number.isSafeInteger(daysPerYear) ?
                            canonicalYear(canonical.year) +
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
                `\`<year>[.<day>[:HHMMSS]]\` or ` +
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
export function formatDateInCalendar(date, reference, context, formatName) {
    const eras = calendarEras(reference, context);
    const chosen = eraCovering(date, eras, context?.daysPerYear);
    const name = String(reference ?? "");
    if (context?.eras?.get(name)?.era && chosen === null)
        throw new RangeError(`date falls outside calendar era ${name}`);
    return formatNoteDate(date, chosen, context?.daysPerYear, formatName);
}

/** Print a resolved date in one era, retaining its authored precision. */
export function formatNoteDate(date, era, daysPerYear, formatName) {
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
    const year = target.beforeEra ? -cycle : cycle + 1;
    if (year < 1) return null;
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
    let text = `${date.approximate ? "~" : ""}${day === null ? "" : `${day} `}${monthName ? `${monthName} ` : ""}${year} ${eraName}${clock}`;
    if (target.calendar?.formats) {
        const { pattern } = selectCalendarFormat(target.calendar, formatName);
        const hasClock = calendarFormatHasClock(pattern);
        const rendered = formatCalendarPattern(
            pattern,
            {
                calendar: target.calendar,
                era: target,
                eraYear: year,
                calendarYear: target.beforeEra ? -year : target.startYear + year - 1,
                month,
                day,
                dayOfYear: (((delta % daysPerYear) + daysPerYear) % daysPerYear) + 1,
                seconds: date.seconds,
                canonicalOffset: start,
                calendarEpochOffset: target.calendarEpochOffset,
            },
            date.precision,
            date.seconds !== undefined,
        );
        text = `${date.approximate ? "~" : ""}${rendered}${date.seconds !== undefined && !hasClock ? clock : ""}`;
    }
    const digits = `${Math.abs(year)}${month === null ? "" : `/${month}`}${day === null ? "" : `/${day}${clock.replaceAll(":", "").replace(/^ /, ":")}`}`;
    const label =
        typeof target.label === "string" ?
            target.label
        :   target.label?.[year < 0 ? "before" : "after"];
    const prose =
        target.calendar?.formats ? null
        : typeof label === "string" && label.includes("{date}") ?
            label.replace("{date}", `${date.approximate ? "~" : ""}${digits}`)
        :   null;
    return { era, year, month, day, text, prose };
}

/**
 * The occurrences of one recurring series overlapping a bound.
 *
 * **No materialized occurrence list.** An annual series anchored centuries
 * back has thousands of occurrences to the present, and the only questions a
 * build asks are "is this year one of them" and "which is next" — so an
 * omitted bound answers with a single occurrence rather than every one a live
 * series could have:
 *
 * - `to` omitted: the first occurrence at or after `from` (default, the
 *   anchor's own year) — "next".
 * - `from` omitted, `to` given: the last occurrence at or before `to` —
 *   "the greatest occurrence at or before `until`".
 * - Both given: every occurrence between them, inclusive — a membership
 *   probe is `from === to`.
 *
 * **The lower bound is not optional.** A candidate year before the anchor's
 * own year is never an occurrence, however a bare modulo would read it: `%`
 * takes the sign of its dividend in both JavaScript and SQL, so a year
 * exactly one period before the anchor would otherwise match. `k` is clamped
 * at zero rather than left to run negative.
 *
 * **The period advances the canonical year, never the era-relative year.**
 * `date.canonicalYear` is already on the continuous axis `canonicalYear`
 * builds — era year `-1` sits immediately before era year `1`, but canonical
 * year `0` is an ordinary integer between them — so stepping by whole
 * multiples of `every` on `canonicalYear` crosses an epoch with no special
 * case. Counting in era-relative years instead would need a correction at
 * every crossing and silently loses one year each time it is forgotten.
 *
 * **Precision, approximation and the day of year carry through untouched.**
 * Every occurrence is the anchor's own record with only `canonicalYear`
 * advanced, so a day-precision anchor's `canonicalDay` — including one inside
 * a short intercalary month — names the same day of every occurrence, and an
 * approximate anchor's occurrences are approximate too.
 *
 * @param {object} date - The anchor's resolved record
 *   ({@link parseNoteDate}), carrying a real `canonicalYear`. A year-0 "any
 *   year" anchor carries none and has no series through this function — its
 *   `recurs` is refused, and its own next occurrence is computed directly
 *   from the day of year alone.
 * @param {{every?: number, on?: object[]}} [recurs] - The declared
 *   recurrence: a whole-year period, or an enumeration of further resolved
 *   date records (each already carrying its own `canonicalYear`). Neither
 *   admits the other.
 * @param {object} [bounds]
 * @param {number} [bounds.from] - The lower bound, inclusive, as a canonical
 *   year.
 * @param {number} [bounds.to] - The upper bound, inclusive, as a canonical
 *   year.
 * @returns {object[]} Occurrence records, in increasing order.
 */
export function occurrencesOf(date, recurs, { from, to } = {}) {
    if (!date?.known || !Number.isSafeInteger(date.canonicalYear)) return [];
    const anchor = date.canonicalYear;

    if (Array.isArray(recurs?.on)) {
        if (from === undefined && to === undefined) return [date];
        const series = [date, ...recurs.on]
            .filter((occ) => occ?.known && Number.isSafeInteger(occ.canonicalYear))
            .sort((a, b) => a.canonicalYear - b.canonicalYear);
        const inRange = series.filter(
            (occ) =>
                (from === undefined || occ.canonicalYear >= from) &&
                (to === undefined || occ.canonicalYear <= to),
        );
        if (from === undefined) return inRange.slice(-1);
        if (to === undefined) return inRange.slice(0, 1);
        return inRange;
    }

    const every = recurs?.every;
    if (!Number.isSafeInteger(every) || every < 1) {
        const solo = (from === undefined || anchor >= from) && (to === undefined || anchor <= to);
        return solo ? [date] : [];
    }

    const lowestK = from === undefined ? 0 : Math.max(0, Math.ceil((from - anchor) / every));
    if (to === undefined) return [{ ...date, canonicalYear: anchor + lowestK * every }];

    const highestK = Math.floor((to - anchor) / every);
    if (highestK < lowestK) return [];
    if (from === undefined) return [{ ...date, canonicalYear: anchor + highestK * every }];

    const out = [];
    for (let k = lowestK; k <= highestK; k += 1)
        out.push({ ...date, canonicalYear: anchor + k * every });
    return out;
}

/** A resolved date's printed form, in the era its own value selects. */
function withMarkerProse(date, context) {
    const era =
        date.marker ? context?.markers?.get(date.marker)
        : date.qualifier ? context?.eras?.get(date.qualifier)
        : null;
    const printable = formatNoteDate(date, era, context?.daysPerYear);
    return { ...date, prose: printable?.prose ?? null };
}

/**
 * A resolved date's printed form, re-selecting the era that covers its own
 * position rather than keeping whatever era its anchor was authored in.
 *
 * `when`/`until`/`on` are checked exactly as `born`/`died` are: an
 * era-qualified value carries a `marker` or a `qualifier`, which names the
 * calendar as well as the era, and a bare canonical value carries neither and
 * prints bare. What is new here is that a *generated* occurrence keeps the
 * anchor's marker or qualifier — advancing the year only — so that calendar's
 * **whole** era list is swept through {@link eraCovering} for the
 * occurrence's own position, rather than assuming it stays in the era the
 * anchor was in. A later occurrence may therefore print in a different era
 * than its anchor, or print bare where no count was proclaimed for that year;
 * neither is a finding, since nobody authored the occurrence.
 *
 * @param {object} date - The resolved date, generated or authored.
 * @param {object} [context] - As {@link resolvedDateFields} reads it.
 * @returns {object} The date, carrying `prose`.
 */
function withSweptEraProse(date, context, { generated = false } = {}) {
    if (!date?.known) return { ...date, prose: null };
    const anchorEra =
        date.marker ? context?.markers?.get(date.marker)
        : date.qualifier ? context?.eras?.get(date.qualifier)
        : null;
    let era = null;
    if (anchorEra?.calendarShortcode) {
        try {
            const calendarRows = calendarEras(anchorEra.calendarShortcode, context);
            era = eraCovering(date, calendarRows, context?.daysPerYear);
        } catch {
            // Ambiguous or overlapping eras are a corpus defect reported
            // where the eras themselves are declared; an occurrence prints
            // bare rather than failing a build over a note that authored
            // nothing wrong.
            era = null;
        }
    }
    const printable = formatNoteDate(date, era, context?.daysPerYear);
    return {
        ...date,
        prose: printable?.prose ?? null,
        // `formatNoteDate`'s own bare `text` echoes `date.text` — the
        // anchor's authored spelling, which a *generated* occurrence has
        // outgrown. Only a generated occurrence with no era to print in
        // needs a text of its own, built from its own canonical year.
        ...(generated && !era ?
            {
                text:
                    (date.approximate ? "~" : "") +
                    (date.precision === "day" && Number.isSafeInteger(date.canonicalDay) ?
                        `${eraYear(date.canonicalYear)}.${date.canonicalDay}`
                    :   String(eraYear(date.canonicalYear))),
            }
        :   {}),
    };
}

/** The package's declared present, resolved to a date record, or `null`. */
function resolvedPresent(context) {
    if (context?.present === undefined || context?.present === null) return null;
    const date = parseNoteDate(context.present, { ...context, allowUnknown: false }).date;
    return date?.known ? date : null;
}

/**
 * One `data.events` entry, resolved: its own `when`, `until`, `recurs` and
 * `next`.
 *
 * `recurs.first` and `recurs.last` are canonical years rather than the
 * fractional `sort` a day-precision date carries, because `every` counts
 * whole years — a SQL fence testing membership with
 * `(year - recurs.first) % recurs.every = 0 AND year >= recurs.first` reads
 * them as the plain integers they are.
 *
 * @param {unknown} entry - The authored `{ when, until?, recurs? }`.
 * @param {object} [context] - As {@link resolvedDateFields} reads it.
 * @returns {object} The resolved entry; a key is present only where the note
 *   authored or the build computed something for it.
 */
function resolveEventEntry(entry, context) {
    const row = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
    const out = {};

    const when = parseNoteDate(row.when, {
        ...context,
        allowUnknown: true,
        allowZeroYear: true,
    }).date;
    if (when?.known) out.when = withSweptEraProse(when, context);

    const until = parseNoteDate(row.until, { ...context, allowUnknown: false }).date;
    if (until?.known) out.until = withSweptEraProse(until, context);

    if (!when?.known) return out;

    // Year 0: an annual day-of-year marker, recurring by construction. Its
    // own next occurrence is computed directly from the day of year rather
    // than through `occurrencesOf`, which needs a real anchor year — and it
    // carries no `recurs` record, since the entry is already annual.
    if (when.year === 0) {
        const present = resolvedPresent(context);
        if (present && Number.isSafeInteger(when.canonicalDay)) {
            const dueThisYear =
                !Number.isSafeInteger(present.canonicalDay) ||
                present.canonicalDay <= when.canonicalDay;
            const year = dueThisYear ? present.canonicalYear : present.canonicalYear + 1;
            if (!out.until || year <= out.until.canonicalYear) {
                out.next = withSweptEraProse({ ...when, canonicalYear: year }, context, {
                    generated: true,
                });
            }
        }
        return out;
    }

    const recurs = row.recurs;
    if (!recurs || typeof recurs !== "object" || Array.isArray(recurs)) return out;

    const recursOut = {};
    let series;
    // An enumeration is bounded by construction — its own last entry — so
    // `last` is never null for `on`; a period is live unless `until` bounds
    // it, so `last` is null exactly where there is no `until` to bound it.
    if (Number.isInteger(recurs.every) && recurs.every >= 1) {
        recursOut.every = recurs.every;
        series = { every: recurs.every };
        recursOut.last =
            out.until ?
                (occurrencesOf(when, series, { to: out.until.canonicalYear }).at(-1)
                    ?.canonicalYear ?? null)
            :   null;
    } else if (Array.isArray(recurs.on)) {
        const onDates = recurs.on
            .map((raw) => parseNoteDate(raw, { ...context, allowUnknown: false }).date)
            .filter((parsedOn) => parsedOn?.known);
        recursOut.on = onDates.map((onDate) => withSweptEraProse(onDate, context));
        series = { on: onDates };
        recursOut.last =
            onDates.length ? onDates[onDates.length - 1].canonicalYear : when.canonicalYear;
    } else {
        return out;
    }

    recursOut.first = when.canonicalYear;
    out.recurs = recursOut;

    const present = resolvedPresent(context);
    if (present?.known) {
        const candidate = occurrencesOf(when, series, { from: present.canonicalYear })[0];
        if (candidate && (!out.until || candidate.canonicalYear <= out.until.canonicalYear)) {
            out.next = withSweptEraProse(candidate, context, { generated: true });
        }
    }
    return out;
}

/** Normalize a note's declared dates for indexes and generated pages. */
export function resolvedDateFields(fm, context) {
    if (fm?.type === "lore") {
        const events = Array.isArray(fm.data?.events) ? fm.data.events : [];
        const resolved = events.map((entry) => resolveEventEntry(entry, context));
        return resolved.length ? { events: resolved } : {};
    }
    const fields =
        fm?.type === "being" ?
            [
                ["born", fm.data?.born],
                ["died", fm.data?.died],
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
            out[key] = withMarkerProse(parsed.date, context);
        }
    }
    return out;
}
