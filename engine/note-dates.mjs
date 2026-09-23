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
 * **A date on a note: one authored string, one grammar, one record.**
 *
 * ```text
 * [~] YYYY [/ MM [/ DD]] [ CAL ]
 * ```
 *
 * - `~` — approximate. It marks the value and does not change what it parses
 *   to, so a renderer can print `c. 2110 BF` from the same number it sorts on.
 * - `YYYY` — required, always written positive. The sign lives in the calendar.
 * - `MM`, `DD` — optional, in that order.
 * - `CAL` — an abbreviation from the declared registry; omitted, the package
 *   default.
 *
 * **Precision falls out of how much is written.** `984 BF` is a year, `689/6` a
 * month, `689/6/19` a day. There is no precision vocabulary, so there is
 * nothing to fall out of step with the value it describes.
 *
 * ## The rule to copy: print `text`, order on `sort`, do arithmetic on `commonYear`
 *
 * Every parsed date carries all three, because neither the string nor the
 * number is cheap to derive from the other at read time:
 *
 * ```yaml
 * text: "689/6/19"   # authored, verbatim — what a page prints
 * known: true        # what a query branches on
 * calendar: AF       # resolved, default applied
 * year: 689          # as authored, positive within its calendar
 * month: 6           # null where unwritten
 * day: 19            # null where unwritten
 * approximate: false # the `~`
 * precision: day     # derived: day | month | year
 * commonYear: 689    # signed, astronomical — arithmetic
 * sort: 689.0619     # total order across mixed precision — sorting
 * ```
 *
 * ## `unknown` is a value, and it is unordered
 *
 * `"unknown"` says the thing happened and the date is not recorded. It parses
 * to the same record with the year half empty — `known: false`, and **no
 * `commonYear` and no `sort`**.
 *
 * Both shortcuts past that are silently wrong, and this is the one place in the
 * scheme where a wrong implementation is invisible in the output. Normalising
 * to `0` sorts the ancient dead into the year 1 of the backward reckoning;
 * treating it as a null year and letting a comparison default it sorts them
 * into the present, beside the living. So anything that orders or filters on a
 * date leaves an unknown one out of the ordering and reports it as its own
 * group, and a range filter never matches it, because the record does not claim
 * a year and a filter must not claim one for it.
 *
 * ## Absence is not a finding, and neither is a bare value
 *
 * An absent value is a fact about the subject rather than a gap, so parsing
 * nothing yields nothing and reports nothing. A value written with no
 * abbreviation takes the package default silently: a corpus that has written
 * bare dates since it began is correct, and a toolchain that turned it red over
 * a token would be the thing that is wrong.
 *
 * @module
 */

import {
    astronomicalYear,
    calendarStructure,
    dateSortKey,
    unknownCalendarMessage,
} from "./calendars.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";

/**
 * The literal that says a thing happened and the date is not recorded.
 *
 * @type {string}
 */
export const UNKNOWN_DATE = "unknown";

/**
 * The grammar, as one expression.
 *
 * @type {RegExp}
 */
export const NOTE_DATE_PATTERN = /^(~)?\s*(\d+)(?:\/(\d+)(?:\/(\d+))?)?(?:\s+([A-Za-z]{1,8}))?$/;

/** A day written with no month — ungrammatical, and worth its own sentence. */
const DAY_WITHOUT_MONTH_PATTERN = /^(?:~)?\s*\d+\/\/\d+(?:\s+[A-Za-z]{1,8})?$/;

/** The record an unknown date parses to — every field but `text` and `known` empty. */
function unknownRecord() {
    return {
        text: UNKNOWN_DATE,
        known: false,
        calendar: null,
        year: null,
        month: null,
        day: null,
        approximate: false,
        precision: null,
        // Never 0 and never a defaulted null year: see the module docs.
        commonYear: null,
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
 * @param {object} options
 * @param {{default: string|null, registry: Readonly<Record<string, object>>}} options.calendars
 *   The resolved `calendars:` block.
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
    const { calendars, field, allowUnknown = true, file, raw, keyPath } = options ?? {};
    const registry = calendars?.registry ?? {};
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

    const match = NOTE_DATE_PATTERN.exec(text.trim());
    if (!match) {
        if (DAY_WITHOUT_MONTH_PATTERN.test(text.trim())) {
            return refuse(
                `${subject} writes a day with no month — a date is written to the ` +
                    `year, to the month or to the day, and each level needs the one ` +
                    `above it`,
            );
        }
        return refuse(
            `${subject} is not a date — write \`[~]YYYY[/MM[/DD]] [CAL]\`: a year ` +
                `written positive, optionally a month and a day, and the reckoning ` +
                `where it is not the package default`,
        );
    }

    const [, tilde, yearText, monthText, dayText, abbreviation] = match;
    const approximate = tilde === "~";
    const year = Number(yearText);
    const month = monthText === undefined ? null : Number(monthText);
    const day = dayText === undefined ? null : Number(dayText);

    const calendar = abbreviation ?? calendars?.default ?? null;
    if (calendar === null) {
        return refuse(
            `${subject} names no calendar and the package declares no default — ` +
                `write the abbreviation, or declare \`calendars.default\``,
        );
    }
    // `hasOwn`, not a bare lookup: a registry is an ordinary object, so
    // `toString` would otherwise resolve to a function and be read as a
    // reckoning.
    const spec = Object.hasOwn(registry, calendar) ? registry[calendar] : undefined;
    if (!spec) {
        // A bare value that resolved to a default nobody registered is a
        // configuration fault rather than the author's, and it reads as one.
        if (!abbreviation) {
            return refuse(
                `${subject} takes the default calendar \`${calendar}\`, which ` +
                    `\`calendars.registry\` does not declare`,
            );
        }
        return refuse(`${subject} ${unknownCalendarMessage(abbreviation, registry)}`);
    }

    // No year zero, in any reckoning: the years either side of an epoch are
    // both 1, and a year is always written positive.
    if (year < 1) {
        return refuse(
            `${subject} writes year ${year} — a year is always written positive, ` +
                `and no reckoning has a year zero: the years either side of an ` +
                `epoch are both 1`,
        );
    }

    const { months, monthDays } = calendarStructure(spec);
    if (month !== null && month < 1) {
        return refuse(`${subject} writes month ${month}, and a month is numbered from 1`);
    }
    // An upper bound is checked only where the reckoning states one. Twelve
    // Gregorian months assumed here would refuse `667/2/30`, which is a correct
    // date in a year of twelve thirty-day months.
    if (month !== null && months !== null && month > months) {
        return refuse(
            `${subject} writes month ${month}, and the ${spec.name} year has ` + `${months} months`,
        );
    }
    if (day !== null && day < 1) {
        return refuse(`${subject} writes day ${day}, and a day is numbered from 1`);
    }
    if (day !== null && monthDays !== null && day > monthDays) {
        return refuse(
            `${subject} writes day ${day}, and a ${spec.name} month has ` + `${monthDays} days`,
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

    const commonYear = astronomicalYear(year, spec);
    return {
        date: {
            text,
            known: true,
            calendar,
            year,
            month,
            day,
            approximate,
            precision,
            commonYear,
            sort: dateSortKey(commonYear, month, day),
        },
        findings,
    };
}
