/* SPDX-License-Identifier: GPL-3.0-or-later */

import { calendarStructure } from "./calendars.mjs";
import {
    calendarFormatHasClock,
    parseCalendarPattern,
    selectCalendarFormat,
} from "./calendar-format.mjs";

/** The labels a human date may use to name one era. */
export function eraNames(era) {
    return [
        era.abbreviation,
        era.name,
        era.name?.slice(0, 2),
        era.marker,
        era.era.split(".").at(-1),
        era.era,
    ].filter((value) => typeof value === "string" && value.trim());
}

/** Translate a named date into the addressed form read by the date parser. */
export function addressedCalendarDate(text, eras) {
    if (eras[0]?.calendar?.formats && Object.keys(eras[0].calendar.formats).length) {
        const calendar = eras[0].calendar;
        const { pattern } = selectCalendarFormat(calendar);
        const trailingClock =
            calendarFormatHasClock(pattern) ? null : /^(.*) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
        const fields = parseCalendarPattern(
            pattern,
            trailingClock ? trailingClock[1] : text,
            calendar,
        );
        if (trailingClock) {
            fields.hour = Number(trailingClock[2]);
            fields.minute = Number(trailingClock[3]);
            fields.second = Number(trailingClock[4]);
        }
        const named =
            fields.eraLabel === undefined ?
                null
            :   eras.filter((era) =>
                    eraNames(era).some(
                        (name) => name.toLowerCase() === fields.eraLabel.toLowerCase(),
                    ),
                );
        if (named && named.length !== 1)
            throw new RangeError(`date names unknown or ambiguous era ${fields.eraLabel}`);
        const selected =
            named?.[0] ??
            (fields.calendarYear === undefined ?
                null
            :   [...eras]
                    .sort((a, b) => (b.startYear ?? -Infinity) - (a.startYear ?? -Infinity))
                    .find((era) => era.startYear === null || fields.calendarYear >= era.startYear));
        if (!selected) throw new RangeError("date needs an era in this calendar");
        const year =
            fields.eraYear ??
            (selected.beforeEra ?
                fields.calendarYear
            :   fields.calendarYear - selected.startYear + 1);
        if (!Number.isSafeInteger(year) || year < 1)
            throw new RangeError("date names a year outside its era");
        if (
            fields.calendarYear !== undefined &&
            fields.eraYear !== undefined &&
            (selected.beforeEra ? year : selected.startYear + year - 1) !== fields.calendarYear
        )
            throw new RangeError("calendar year and era year disagree");
        const clock =
            fields.hour === undefined ?
                ""
            :   `:${String(fields.hour).padStart(2, "0")}${String(fields.minute ?? 0).padStart(2, "0")}${String(fields.second ?? 0).padStart(2, "0")}`;
        return `${year}${fields.month === undefined ? "" : `/${fields.month}`}${fields.day === undefined ? "" : `/${fields.day}${clock}`} ${selected.qualifier}`;
    }
    const first = /^(\d{1,2})\s+(.+)$/.exec(text);
    let day = null;
    let rest = text;
    if (first) {
        const firstWord = first[2].split(/[\s,]/)[0].toLowerCase();
        const hasMonth = (calendarStructure(eras[0].calendar).months ?? []).some((month) =>
            [month.name, month.abbreviation].some(
                (name) => typeof name === "string" && name.toLowerCase().startsWith(firstWord),
            ),
        );
        if (hasMonth) {
            day = first[1];
            rest = first[2];
        }
    }
    const months = calendarStructure(eras[0].calendar).months ?? [];
    const matchingMonths = months.flatMap((month, index) =>
        [month.name, month.abbreviation]
            .filter((name) => typeof name === "string" && name)
            .filter((name) => rest.toLowerCase().startsWith(name.toLowerCase()))
            .filter((name) => /^[\s,]/.test(rest.slice(name.length)))
            .map((name) => ({ name, number: index + 1 })),
    );
    if (day !== null && matchingMonths.length === 0)
        throw new RangeError("date names no month in this calendar");
    const longest = Math.max(0, ...matchingMonths.map((month) => month.name.length));
    const choices = [
        ...new Set(
            matchingMonths
                .filter((month) => month.name.length === longest)
                .map((month) => month.number),
        ),
    ];
    if (choices.length > 1) throw new RangeError("date names an ambiguous month");
    const monthName = matchingMonths.find((month) => month.name.length === longest)?.name;
    const afterMonth = monthName ? rest.slice(monthName.length).replace(/^,?\s+/, "") : rest;
    const match = /^(~?-?\d+)(?:\s+(.+?))?(?:\s+(\d{2}:\d{2}:\d{2}))?$/.exec(afterMonth);
    if (!match) return null;
    const [, year, eraName, clock] = match;
    const selected =
        eraName === undefined && eras.length === 1 ? eras[0]
        : eraName === undefined ? null
        : (() => {
                const found = eras.filter((era) =>
                    eraNames(era).some((name) => name.toLowerCase() === eraName.toLowerCase()),
                );
                if (found.length > 1) throw new RangeError(`date names ambiguous era ${eraName}`);
                return found[0] ?? null;
            })();
    if (!selected)
        throw new RangeError(
            eraName === undefined ?
                "date needs an era in this calendar"
            :   `date names unknown era ${eraName}`,
        );
    const time = clock ? `:${clock.replaceAll(":", "")}` : "";
    return `${year}${choices.length ? `/${choices[0]}` : ""}${day === null ? "" : `/${day}${time}`} ${selected.qualifier}`;
}
