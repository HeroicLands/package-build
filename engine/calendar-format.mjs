/* SPDX-License-Identifier: GPL-3.0-or-later */

import { dayOfYear } from "./calendars.mjs";

/** Calendaria's bare date, time, week, season, and zone tokens. */
export const CALENDAR_FORMAT_TOKENS = Object.freeze(
    new Set(
        "YYYY YY Y MMMM MMM MM Mo M EEEEE EEEE EEE EE E dddd ddd dd Do DDD DD D d e GGGG GGG GG G QQQQ QQQ QQ Q zzzz z ww w W HH H hh h mm m ss s A a".split(
            " ",
        ),
    ),
);

/** Calendaria's named fields inside brackets or braces. */
export const CALENDAR_CUSTOM_TOKENS = Object.freeze(
    new Set(
        "yearName namedWeek namedWeekAbbr namedDay namedDayAbbr era eraAbbr yearInEra yearInEraOrdinal season seasonAbbr moon moonIcon ch chAbbr cycle cycleName cycleRoman cycleYear approxTime approxDate meridiemFull".split(
            " ",
        ),
    ),
);

const TOKEN =
    /\[([^\]]+)]|{([^}]+)}|YYYY|YY|Y|MMMM|MMM|MM|Mo|M|EEEEE|EEEE|EEE|EE|E|dddd|ddd|dd|Do|DDD|DD|D|d|e|GGGG|GGG|GG|G|QQQQ|QQQ|QQ|Q|zzzz|z|ww|w|W|HH|H|hh|h|mm|m|ss|s|A|a/g;

/** Brackets and braces must close; `[[]` is a literal left bracket. */
export function calendarFormatSyntaxError(pattern) {
    for (let position = 0; position < pattern.length;) {
        if (pattern.startsWith("[[]", position)) {
            position += 3;
            continue;
        }
        const opener = pattern[position];
        if (opener === "[" || opener === "{") {
            const closer = opener === "[" ? "]" : "}";
            const end = pattern.indexOf(closer, position + 1);
            if (end < 0) return `calendar format has an unclosed ${opener}`;
            if (end === position + 1) return "calendar format has an empty bracket or brace";
            position = end + 1;
            continue;
        }
        if (opener === "]" || opener === "}") return `calendar format has an unmatched ${opener}`;
        position++;
    }
    return null;
}

/** Split a Calendaria pattern into tokens and literal text. */
export function calendarFormatSegments(pattern) {
    const segments = [];
    let cursor = 0;
    for (const match of String(pattern).matchAll(TOKEN)) {
        if (match.index > cursor)
            segments.push({ token: false, value: pattern.slice(cursor, match.index) });
        const custom = match[1] ?? match[2];
        if (custom !== undefined) {
            const base = custom.split(/[=|]/, 1)[0];
            if (CALENDAR_CUSTOM_TOKENS.has(base)) segments.push({ token: true, value: custom });
            else segments.push({ token: false, value: custom });
        } else segments.push({ token: true, value: match[0] });
        cursor = match.index + match[0].length;
    }
    if (cursor < pattern.length) segments.push({ token: false, value: pattern.slice(cursor) });
    return segments;
}

const READABLE_TOKENS = new Set([
    "Y",
    "YYYY",
    "M",
    "MM",
    "Mo",
    "MMM",
    "MMMM",
    "D",
    "DD",
    "Do",
    "DDD",
    "G",
    "GG",
    "GGG",
    "GGGG",
    "era",
    "eraAbbr",
    "yearInEra",
    "yearInEraOrdinal",
    "H",
    "HH",
    "h",
    "hh",
    "m",
    "mm",
    "s",
    "ss",
    "A",
    "a",
    "meridiemFull",
]);
const CLOCK_TOKENS = new Set(["H", "HH", "h", "hh", "m", "mm", "s", "ss"]);

/** A standard format must identify one calendar day and be readable without context. */
export function readableCalendarFormatError(pattern) {
    const segments = calendarFormatSegments(pattern);
    const tokens = segments.filter((segment) => segment.token).map((segment) => segment.value);
    const unsupported = tokens.find((token) => !READABLE_TOKENS.has(token));
    if (unsupported) return `standard calendar format cannot read token ${unsupported}`;
    const variableDigits = new Set(["Y", "M", "D", "H", "h", "m", "s", "yearInEra"]);
    if (
        segments.some(
            (segment, index) =>
                segment.token &&
                variableDigits.has(segment.value) &&
                segments[index + 1]?.token &&
                variableDigits.has(segments[index + 1].value),
        )
    )
        return "standard calendar format has ambiguous adjacent numeric tokens";
    if (!tokens.some((token) => ["Y", "YYYY", "yearInEra", "yearInEraOrdinal"].includes(token)))
        return "standard calendar format needs Y, YYYY, or [yearInEra]";
    if (tokens.includes("yearInEra") || tokens.includes("yearInEraOrdinal")) {
        if (!tokens.some((token) => ["G", "GG", "GGG", "GGGG", "era", "eraAbbr"].includes(token)))
            return "standard calendar format needs an era label with [yearInEra]";
    }
    if (
        !tokens.includes("DDD") &&
        (!tokens.some((token) => ["D", "DD", "Do"].includes(token)) ||
            !tokens.some((token) => ["M", "MM", "Mo", "MMM", "MMMM"].includes(token)))
    )
        return "standard calendar format needs DDD or both month and day";
    return null;
}

/** Whether a selected pattern prints clock components. */
export function calendarFormatHasClock(pattern) {
    return calendarFormatSegments(pattern).some(
        (segment) => segment.token && CLOCK_TOKENS.has(segment.value),
    );
}

/** Keep the fields named by an authored date's precision. */
export function calendarPatternSegmentsForPrecision(
    pattern,
    precision = "day",
    includeClock = true,
) {
    const segments = calendarFormatSegments(pattern).map((segment) => ({ ...segment }));
    const drop = new Set([
        ...(!includeClock ?
            ["H", "HH", "h", "hh", "m", "mm", "s", "ss", "A", "a", "meridiemFull"]
        :   []),
        ...(precision === "year" || precision === "month" ?
            [
                "E",
                "EE",
                "EEE",
                "EEEE",
                "EEEEE",
                "d",
                "dd",
                "ddd",
                "dddd",
                "e",
                "w",
                "ww",
                "W",
                "namedDay",
                "namedDayAbbr",
                "namedWeek",
                "namedWeekAbbr",
                "Q",
                "QQ",
                "QQQ",
                "QQQQ",
                "season",
                "seasonAbbr",
            ]
        :   []),
        ...(precision === "year" || precision === "month" ? ["D", "DD", "Do", "DDD"] : []),
        ...(precision === "year" ? ["M", "MM", "Mo", "MMM", "MMMM"] : []),
    ]);
    for (let index = 0; index < segments.length;) {
        if (!segments[index].token || !drop.has(segments[index].value)) {
            index++;
            continue;
        }
        const before = segments[index - 1];
        const after = segments[index + 1];
        if (before && !before.token && before.value) before.value = "";
        else if (after && !after.token) after.value = "";
        segments.splice(index, 1);
    }
    return segments;
}

/** Choose an authored named format, with `std` as the preferred default. */
export function selectCalendarFormat(calendar, name) {
    const formats = calendar?.formats;
    const names =
        formats && typeof formats === "object" && !Array.isArray(formats) ?
            Object.keys(formats)
        :   [];
    if (names.length === 0) {
        if (name && name !== "std") throw new RangeError(`calendar format ${name} does not exist`);
        return { name: "std", pattern: "D MMMM [yearInEra] G" };
    }
    const selected = name ?? (names.includes("std") ? "std" : names[0]);
    if (!Object.hasOwn(formats, selected))
        throw new RangeError(`calendar format ${selected} does not exist`);
    return { name: selected, pattern: formats[selected] };
}

const pad = (value, width) =>
    `${value < 0 ? "-" : ""}${String(Math.abs(value)).padStart(width, "0")}`;
const ordinal = (value) => {
    const mod100 = value % 100;
    const suffix =
        mod100 >= 11 && mod100 <= 13 ? "th"
        : value % 10 === 1 ? "st"
        : value % 10 === 2 ? "nd"
        : value % 10 === 3 ? "rd"
        : "th";
    return `${value}${suffix}`;
};

/** Format calendar date components with Calendaria's documented tokens. */
export function formatCalendarPattern(pattern, parts, precision = "day", includeClock = true) {
    const segments = calendarPatternSegmentsForPrecision(pattern, precision, includeClock);
    const unsupported = segments.find(
        (segment) =>
            (segment.token &&
                [
                    "z",
                    "zzzz",
                    "moon",
                    "moonIcon",
                    "ch",
                    "chAbbr",
                    "cycle",
                    "cycleName",
                    "cycleRoman",
                    "cycleYear",
                    "approxTime",
                    "approxDate",
                    "yearName",
                    "namedWeek",
                    "namedWeekAbbr",
                ].includes(segment.value.split(/[=|]/, 1)[0])) ||
            (segment.token && segment.value.includes("=")),
    );
    if (unsupported)
        throw new RangeError(
            `calendar format token ${unsupported.value} needs Calendaria runtime data`,
        );
    const calendar = parts.calendar ?? {};
    const month = calendar.months?.[parts.month - 1];
    const weekdays = Array.isArray(calendar.weekdays) ? calendar.weekdays : [];
    const dayOffset = parts.canonicalOffset - parts.calendarEpochOffset;
    const weekday =
        weekdays.length ? ((dayOffset % weekdays.length) + weekdays.length) % weekdays.length : 0;
    const weekdayName = weekdays[weekday]?.name ?? "";
    const weekdayAbbr = weekdays[weekday]?.abbreviation ?? weekdayName.slice(0, 3);
    const seconds = parts.seconds ?? 0;
    const hour = Math.floor(seconds / 3600);
    const minute = Math.floor(seconds / 60) % 60;
    const second = seconds % 60;
    const hour12 = hour % 12 || 12;
    const year = parts.era?.beforeEra ? parts.eraYear : parts.calendarYear;
    const era = parts.era;
    const eraName = era?.name ?? "";
    const eraAbbr =
        era?.abbreviation ??
        era?.marker ??
        (eraName ? eraName.slice(0, 2) : era?.era?.split(".").at(-1));
    const seasons = Array.isArray(calendar.seasons) ? calendar.seasons : [];
    const datedSeason = seasons.findLastIndex((item) => parts.dayOfYear >= item.start);
    const seasonIndex = datedSeason < 0 && seasons.length ? seasons.length - 1 : datedSeason;
    const season = seasons[seasonIndex];
    const namedDay = (Array.isArray(calendar.namedDays) ? calendar.namedDays : []).find(
        (item) => item.day === parts.dayOfYear,
    );
    const values = {
        Y: year,
        YY: String(Math.abs(year) % 100).padStart(2, "0"),
        YYYY: pad(year, 4),
        M: parts.month,
        MM: pad(parts.month, 2),
        MMM: month?.abbreviation ?? month?.name?.slice(0, 3) ?? "",
        MMMM: month?.name ?? "",
        Mo: ordinal(parts.month),
        D: parts.day,
        DD: pad(parts.day, 2),
        Do: ordinal(parts.day),
        DDD: pad(parts.dayOfYear, 3),
        E: weekdayAbbr,
        EE: weekdayAbbr,
        EEE: weekdayAbbr,
        EEEE: weekdayName,
        EEEEE: weekdayName.slice(0, 1),
        e: weekday,
        d: weekday,
        dd: weekdayAbbr.slice(0, 2),
        ddd: weekdayAbbr,
        dddd: weekdayName,
        w: Math.ceil(parts.dayOfYear / (weekdays.length || 7)),
        ww: pad(Math.ceil(parts.dayOfYear / (weekdays.length || 7)), 2),
        W: Math.ceil(parts.day / (weekdays.length || 7)),
        H: hour,
        HH: pad(hour, 2),
        h: hour12,
        hh: pad(hour12, 2),
        m: minute,
        mm: pad(minute, 2),
        s: second,
        ss: pad(second, 2),
        A: hour < 12 ? "AM" : "PM",
        a: hour < 12 ? "am" : "pm",
        G: eraAbbr,
        GG: eraAbbr,
        GGG: eraAbbr,
        GGGG: eraName,
        Q: seasonIndex < 0 ? "" : seasonIndex + 1,
        QQ: seasonIndex < 0 ? "" : pad(seasonIndex + 1, 2),
        QQQ: season?.abbreviation ?? "",
        QQQQ: season?.name ?? "",
        z: "",
        zzzz: "",
        era: eraName,
        eraAbbr,
        yearInEra: parts.eraYear,
        yearInEraOrdinal: ordinal(parts.eraYear),
        season: season?.name ?? "",
        seasonAbbr: season?.abbreviation ?? "",
        namedDay: namedDay?.name ?? "",
        namedDayAbbr: namedDay?.abbreviation ?? namedDay?.name?.slice(0, 3) ?? "",
        meridiemFull: hour < 12 ? "AM" : "PM",
    };
    return segments
        .map((segment) => {
            if (!segment.token) return segment.value;
            const [key, fallback] = segment.value.split("|", 2);
            if (fallback !== undefined) return String(values[key] || values[fallback] || fallback);
            return String(values[key] ?? "");
        })
        .join("");
}

/** Read the invertible date fields of one Calendaria pattern. */
export function parseCalendarPattern(pattern, text, calendar) {
    const error = readableCalendarFormatError(pattern);
    if (error) throw new RangeError(error);
    let captures = [];
    const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const capture = (token) => {
        if (["YYYY"].includes(token)) return "(-?\\d{4,})";
        if (["Y", "yearInEra"].includes(token)) return "(-?\\d+)";
        if (["MM", "DD", "HH", "hh", "mm", "ss", "YY"].includes(token)) return "(\\d{2})";
        if (token === "DDD") return "(\\d{3})";
        if (["M", "D", "H", "h", "m", "s"].includes(token)) return "(\\d{1,2})";
        if (["Mo", "Do", "yearInEraOrdinal"].includes(token)) return "(\\d+(?:st|nd|rd|th))";
        return "(.+?)";
    };
    let match = null;
    for (const [precision, includeClock] of [
        ["day", true],
        ["day", false],
        ["month", false],
        ["year", false],
    ]) {
        captures = [];
        const regex = calendarPatternSegmentsForPrecision(pattern, precision, includeClock)
            .map((segment) => {
                if (!segment.token) return escape(segment.value);
                captures.push(segment.value);
                return capture(segment.value);
            })
            .join("");
        match = new RegExp(`^${regex}$`, "u").exec(text);
        if (match) break;
    }
    if (!match) throw new RangeError(`date does not match calendar format ${pattern}`);
    const fields = {};
    const set = (key, value) => {
        if (fields[key] !== undefined && fields[key] !== value)
            throw new RangeError(`date gives conflicting ${key} values`);
        fields[key] = value;
    };
    const namedMonth = (value) => {
        const found = (calendar.months ?? [])
            .map((item, index) => ({ item, number: index + 1 }))
            .filter(({ item }) =>
                [item.name, item.abbreviation].some(
                    (name) =>
                        typeof name === "string" && name.toLowerCase() === value.toLowerCase(),
                ),
            );
        if (found.length !== 1)
            throw new RangeError(`date names unknown or ambiguous month ${value}`);
        return found[0].number;
    };
    captures.forEach((token, index) => {
        const value = match[index + 1];
        if (["Y", "YY", "YYYY"].includes(token)) set("calendarYear", Number(value));
        else if (["yearInEra", "yearInEraOrdinal"].includes(token))
            set("eraYear", Number.parseInt(value, 10));
        else if (["M", "MM", "Mo"].includes(token)) set("month", Number.parseInt(value, 10));
        else if (["MMM", "MMMM"].includes(token)) set("month", namedMonth(value));
        else if (["D", "DD", "Do"].includes(token)) set("day", Number.parseInt(value, 10));
        else if (token === "DDD") set("dayOfYear", Number(value));
        else if (["G", "GG", "GGG", "GGGG", "era", "eraAbbr"].includes(token))
            set("eraLabel", value);
        else if (["H", "HH", "h", "hh"].includes(token)) set("hour", Number(value));
        else if (["m", "mm"].includes(token)) set("minute", Number(value));
        else if (["s", "ss"].includes(token)) set("second", Number(value));
        else if (["A", "a", "meridiemFull"].includes(token)) set("meridiem", value);
    });
    if (!Number.isSafeInteger(fields.calendarYear) && !Number.isSafeInteger(fields.eraYear))
        throw new RangeError("calendar format must provide Y, YY, YYYY, or [yearInEra]");
    if (fields.day !== undefined && fields.month === undefined && fields.dayOfYear === undefined)
        throw new RangeError("calendar date gives a day without a month");
    if (fields.dayOfYear !== undefined) {
        let remaining = fields.dayOfYear;
        for (const [index, month] of (calendar.months ?? []).entries()) {
            if (remaining <= month.days) {
                set("month", index + 1);
                set("day", remaining);
                break;
            }
            remaining -= month.days;
        }
    }
    if (fields.hour !== undefined) {
        if (/^(pm)$/i.test(fields.meridiem ?? "") && fields.hour < 12) fields.hour += 12;
        if (/^(am)$/i.test(fields.meridiem ?? "") && fields.hour === 12) fields.hour = 0;
    }
    return fields;
}

/** Convert a calendar month/day into its one-based day of year. */
export function calendarOrdinal(calendar, month, day) {
    return dayOfYear(calendar.months ?? [], month, day);
}
