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
 * [~] [-] YYYY [/ MM [/ DD]] [ ERA ]
 *
 * ERA : (?:[a-z0-9]+-){0,3}[a-z0-9]+ . [a-z0-9]+
 * ```
 *
 * - `~` — approximate. It marks the value and does not change what it parses
 *   to, so a renderer can print `c. -2110` from the same number it sorts on.
 *   It precedes the sign: `~-2500`, never `-~2500`.
 * - `-` — before the epoch the year is counted from. There is no year zero, so
 *   `-1` sits immediately before `1`.
 * - `YYYY` — required.
 * - `MM`, `DD` — optional, in that order.
 * - `ERA` — an affiliation's address plus `.<era shortcode>`, in the four
 *   address forms {@link ERA_QUALIFIER_PATTERN} admits. Omitted, the date sits
 *   on the canonical axis and is attributed to nobody.
 *
 * **Precision falls out of how much is written.** `-984` is a year, `689/6` a
 * month, `689/6/19` a day. There is no precision vocabulary, so there is
 * nothing to fall out of step with the value it describes.
 *
 * ## A trailing token is only ever an era
 *
 * It has exactly one shape and it always contains exactly one dot, so **a
 * trailing token at all means the value needs the corpus, and no token means
 * it is already on the axis** — which is readable off the string, before
 * anything is resolved.
 *
 * ## The rule to copy: print `text`, order on `sort`, do arithmetic on `canonicalYear`
 *
 * Every parsed date carries all three, because neither the string nor the
 * number is cheap to derive from the other at read time:
 *
 * ```yaml
 * text: "689/6/19"   # authored, verbatim — what a page prints
 * known: true        # what a query branches on
 * era: null          # the reckoning named, or null for the canonical axis
 * year: 689          # as authored, signed, within its own reckoning
 * month: 6           # null where unwritten
 * day: 19            # null where unwritten
 * approximate: false # the `~`
 * precision: day     # derived: day | month | year
 * canonicalYear: 689 # signed — arithmetic
 * sort: 689.0619     # total order across mixed precision — sorting
 * ```
 *
 * `era` is `null` for a bare value and there is no substitute for it: the
 * canonical axis is not a reckoning anybody keeps and has no address, so
 * filling the field would state an identification that is not true.
 *
 * ## A number is written only where there is one to write
 *
 * A date naming an era carries the qualifier and **no `canonicalYear` and no
 * `sort` keys at all** until the era is resolved against the corpus. They are
 * absent rather than null, because a record carrying `known: true` beside a
 * null year and a null sort is indistinguishable from the `unknown` record
 * below — which is the one shape whose confusion is invisible in the output.
 *
 * ## `unknown` is a value, and it is unordered
 *
 * `"unknown"` says the thing happened and the date is not recorded. It parses
 * to the same record with the year half empty — `known: false`, and **a null
 * `canonicalYear` and a null `sort`**.
 *
 * Both shortcuts past that are silently wrong. Normalising it to `0` sorts the
 * ancient dead into the year immediately before the epoch; treating it as a
 * null year and letting a comparison default it sorts them into the present,
 * beside the living. So anything that orders or filters on a date leaves an
 * unknown one out of the ordering and reports it as its own group, and a range
 * filter never matches it, because the record does not claim a year and a
 * filter must not claim one for it.
 *
 * ## Absence is not a finding, and neither is a bare value
 *
 * An absent value is a fact about the subject rather than a gap, so parsing
 * nothing yields nothing and reports nothing. A bare value is the canonical
 * axis, always, and it is silent: an unattributed date is the honest form for
 * a date an author is placing rather than a record somebody in the setting
 * kept.
 *
 * @module
 */

import { ADDRESS_SEGMENT_PATTERN } from "./address-charset.mjs";
import { calendarStructure, canonicalYear, dateSortKey } from "./calendars.mjs";
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
 * An affiliation's address followed by `.<era shortcode>`. The `{0,3}`
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
 * @param {{months?: number|null, monthDays?: number|null}} [options.calendar]
 *   The resolved `calendar:` block, whose `months` and `monthDays` bound a
 *   written month and day. An absent bound is not applied.
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
    const { calendar, field, allowUnknown = true, file, raw, keyPath } = options ?? {};
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
                    `\`<affiliation shortcode>.<era shortcode>\`, lowercase letters ` +
                    `and digits only`,
            );
        }
        if (DOTLESS_TOKEN_PATTERN.test(trimmed)) {
            // The message an author who learned a retired spelling meets. No
            // table says which direction that spelling counted, so it states
            // the rule rather than guessing a concrete replacement.
            return refuse(
                `${subject} names no era — a reckoning is written ` +
                    `\`<affiliation shortcode>.<era shortcode>\`: a year before ` +
                    `an era's epoch is written negative, and a year after it ` +
                    `simply drops the token`,
            );
        }
        return refuse(
            `${subject} is not a date — write ` +
                `\`[~][-]YYYY[/MM[/DD]] [<affiliation shortcode>.<era shortcode>]\`: ` +
                `a year, negative where it falls before the epoch it is counted ` +
                `from, optionally a month and a day, and an era where the date is a ` +
                `reckoning somebody kept`,
        );
    }

    const [, tilde, yearText, monthText, dayText, era] = match;
    const approximate = tilde === "~";
    const year = Number(yearText);
    const month = monthText === undefined ? null : Number(monthText);
    const day = dayText === undefined ? null : Number(dayText);

    // No year zero, in any reckoning: the years either side of an epoch are -1
    // and 1. `-0` is the same year written the other way and is refused with it.
    if (year === 0) {
        return refuse(
            `${subject} writes year 0, and no reckoning has one — the years either ` +
                `side of an epoch are -1 and 1`,
        );
    }

    const { months, monthDays } = calendarStructure(calendar);
    if (month !== null && month < 1) {
        return refuse(`${subject} writes month ${month}, and a month is numbered from 1`);
    }
    // An upper bound is checked only where the package states one. Twelve
    // Gregorian months assumed here would refuse `667/2/30`, which is a correct
    // date in a year of twelve thirty-day months.
    if (month !== null && months !== null && month > months) {
        return refuse(
            `${subject} writes month ${month}, and \`calendar.months\` declares a ` +
                `year of ${months}`,
        );
    }
    if (day !== null && day < 1) {
        return refuse(`${subject} writes day ${day}, and a day is numbered from 1`);
    }
    if (day !== null && monthDays !== null && day > monthDays) {
        return refuse(
            `${subject} writes day ${day}, and \`calendar.monthDays\` declares a ` +
                `month of ${monthDays}`,
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
