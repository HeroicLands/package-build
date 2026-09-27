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
 * the world's year. A marked date is `<marker>(<year>[/<month>[/<day>]])`.
 * The marker selects one era and its calendar's ordered month list; the era's
 * start places its year one on the neutral timeline. A bare year is year
 * precision, and `unknown` is unordered. The parser also accepts unmarked
 * slash dates and addressed era qualifiers.
 *
 * `text` keeps the authored spelling. `canonicalYear` and `sort` are set for
 * neutral and resolved marked dates. A marked date also carries
 * `canonicalDay`, the ordinal day within its neutral year. An addressed era
 * qualifier carries no resolved year until a caller supplies its era facts.
 *
 * @module
 */

import { ADDRESS_SEGMENT_PATTERN } from "./address-charset.mjs";
import {
    calendarStructure,
    canonicalDateFromOffset,
    canonicalDayOffset,
    canonicalYear,
    dateSortKey,
    dayOfYear,
    daysInMonth,
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
    `^(~)?\\s*(-?\\d+)(?:/(\\d+)(?:/(\\d+))?)?(?:\\s+(${ERA}))?$`,
);

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
 * @param {number} [options.daysPerYear] - The world's year length, required for
 *   canonical days and marked dates.
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
    const marked = /^([A-Z][A-Z0-9]*)\((.*)\)$/.exec(trimmed);
    if (marked) {
        const [, marker, payload] = marked;
        const reckoning = markers?.get(marker);
        if (!reckoning) return refuse(`${subject} names unknown reckoning marker ${marker}`);
        if (!Number.isSafeInteger(daysPerYear) || daysPerYear < 1)
            return refuse(`${subject} needs the world's year length to resolve ${marker}`);
        const parsed = parseNoteDate(payload, {
            calendar: reckoning.calendar,
            field,
            allowUnknown: false,
            file,
            raw,
            keyPath,
        });
        if (parsed.findings.some((finding) => finding.severity === "error") || !parsed.date)
            return { date: null, findings: parsed.findings };
        if (!parsed.date.known)
            return refuse(`${subject} wraps an unknown date; write \`unknown\` by itself`);
        if (parsed.date.era !== null)
            return refuse(
                `${subject} names two reckonings; the payload of ${marker} is a calendar date`,
            );
        if (parsed.date.canonicalDay !== undefined)
            return refuse(
                `${subject} puts a canonical day inside ${marker}; write its calendar month and day`,
            );
        const { months } = calendarStructure(reckoning.calendar);
        if (!months) return refuse(`${subject} names ${marker}, whose calendar declares no months`);
        const ordinal = dayOfYear(months, parsed.date.month ?? 1, parsed.date.day ?? 1);
        const start = canonicalDayOffset(reckoning.epochYear, reckoning.epochDay, 1, daysPerYear);
        const yearOffset = parsed.date.year > 0 ? parsed.date.year - 1 : parsed.date.year;
        const offset = start + yearOffset * daysPerYear + ordinal - 1;
        if (!Number.isSafeInteger(offset))
            return refuse(`${subject} lies outside the supported canonical day range`);
        if (reckoning.endOffset !== undefined && offset > reckoning.endOffset)
            return refuse(`${subject} lies after the end of reckoning marker ${marker}`);
        const canonical = canonicalDateFromOffset(offset, 1, daysPerYear);
        return {
            date: {
                ...parsed.date,
                text,
                era: reckoning.era,
                marker,
                canonicalYear: canonical.year,
                canonicalDay: canonical.day,
                sort: canonical.year + (canonical.day - 1) / daysPerYear,
            },
            findings: parsed.findings,
        };
    }

    if (trimmed.includes(".")) {
        const canonical = parseCanonicalDate(trimmed, daysPerYear);
        if (canonical) {
            return {
                date: {
                    text,
                    known: true,
                    era: null,
                    year: canonical.year,
                    month: null,
                    day: canonical.day,
                    approximate: false,
                    precision: "day",
                    canonicalYear: canonical.year,
                    canonicalDay: canonical.day,
                    ...(canonical.seconds === undefined ? {} : { seconds: canonical.seconds }),
                    sort:
                        canonical.year +
                        (canonical.day - 1 + (canonical.seconds ?? 0) / 86400) / daysPerYear,
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
                `\`<marker>(<year>[/<month>[/<day>]])\``,
        );
    }

    const [, tilde, yearText, monthText, dayText, era] = match;
    const approximate = tilde === "~";
    const year = Number(yearText);
    const month = monthText === undefined ? null : Number(monthText);
    const day = dayText === undefined ? null : Number(dayText);
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
        approximate,
        precision,
    };
    // A named era's epoch is a fact the corpus states, so the numbers derived
    // from it are written by the pass that resolves it and are absent until
    // then. A bare value is already on the axis.
    if (era === undefined) {
        date.canonicalYear = canonicalYear(year);
        date.sort = dateSortKey(date.canonicalYear, month, day);
    }
    return { date, findings };
}
