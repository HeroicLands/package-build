/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { checkCalendarNote, compileCalendar } from "../engine/calendar-notes.mjs";
import { dateFromCalendar, dateToCalendar } from "../engine/date-conversion.mjs";
import { formatDateInCalendar, parseNoteDate } from "../engine/note-dates.mjs";
import { renderMarkdownExpressions } from "../engine/markdown-expressions.mjs";
import { resolveReckoningMarkers } from "../engine/reckoning-markers.mjs";

const months = [
    { name: "Floralis", abbreviation: "Flor", days: 180 },
    { name: "Janar", abbreviation: "Jana", days: 185 },
];
const world = { fm: { type: "place", data: { year: { days: 365 } } } };
const calendar = {
    file: "Calendar.md",
    raw: '---\nshortcode: commoncal\ntype: lore\nsubType: calendar\ndata:\n  epoch: "1.1"\n---\n',
    fm: {
        type: "lore",
        subType: "calendar",
        shortcode: "commoncal",
        name: { full: "Common Calendar" },
        data: {
            epoch: "1.1",
            months,
            weekdays: [
                { name: "Newday", abbreviation: "New" },
                { name: "Tillday", abbreviation: "Til" },
                { name: "Growday", abbreviation: "Gro" },
            ],
            formats: {
                std: "D MMMM [yearInEra] G",
                long: "EEEE, D MMMM [yearInEra] G",
            },
            eras: [
                { shortcode: "later", name: "Later Count", abbreviation: "LC", start: 100 },
                { shortcode: "before", name: "Before Reckoning", abbreviation: "BVR", start: null },
                { shortcode: "vr", name: "Vylarian Reckoning", abbreviation: "VR", start: 1 },
            ],
        },
    },
};

describe("calendar year eras and named formats", () => {
    const index = { notes: [world, calendar] };

    it("starts calendar day one at an offset epoch and emits named days and seasons", () => {
        const offsetCalendar = {
            ...calendar,
            fm: {
                ...calendar.fm,
                data: {
                    ...calendar.fm.data,
                    epoch: 1.91,
                    seasons: [
                        { name: "Spring", abbreviation: "Spr", start: 1 },
                        { name: "Summer", abbreviation: "Sum", start: 181 },
                    ],
                    namedDays: [{ name: "New Year's Day", abbreviation: "NY", day: 1 }],
                    formats: {
                        std: "MM/DD/Y GGG",
                        long: "D MMMM Y GGG",
                        festival: "[namedDay] QQQQ",
                    },
                },
            },
        };
        const offsetIndex = { notes: [world, offsetCalendar] };
        expect(checkCalendarNote(offsetCalendar, { index: offsetIndex })).toEqual([]);
        const context = { ...resolveReckoningMarkers(offsetIndex, 365), daysPerYear: 365 };
        expect(dateToCalendar("commoncal", "1.91", context)).toBe("01/01/1 VR");
        expect(dateFromCalendar("commoncal", "01/01/1 VR", context)).toBe("1.91");
        expect(parseNoteDate("datefrom commoncal 1 VR", context).date?.precision).toBe("year");
        expect(parseNoteDate("datefrom commoncal 01/1 VR", context).date?.precision).toBe("month");
        expect(dateToCalendar("commoncal", "1.91", context, "festival")).toBe(
            "New Year's Day Spring",
        );
        expect(dateToCalendar("commoncal", "1.271", context, "festival")).toBe(" Summer");
        const definition = compileCalendar({
            note: offsetCalendar,
            invariants: { year: { days: 365 } },
            dateContext: context,
        });
        expect(definition.epochDayOffset).toBe(-90);
        expect(definition.days.names).toEqual([
            { name: "New Year's Day", abbreviation: "NY", dayNumber: 1 },
        ]);
        expect(definition.seasons.values).toEqual([
            { name: "Spring", abbreviation: "Spr", dayStart: 0, dayEnd: 179 },
            { name: "Summer", abbreviation: "Sum", dayStart: 180, dayEnd: 364 },
        ]);
        expect(definition.dateFormats.short).toBe("MM/DD/Y GGG");
        expect(definition.eras.before).toBeUndefined();
    });

    it("prints the null-start era with a positive year for authored historical dates", () => {
        const historical = {
            ...calendar,
            fm: {
                ...calendar.fm,
                data: {
                    ...calendar.fm.data,
                    formats: { std: "MM/DD/Y GGG" },
                },
            },
        };
        const context = {
            ...resolveReckoningMarkers({ notes: [world, historical] }, 365),
            daysPerYear: 365,
        };
        expect(dateToCalendar("commoncal", "-50.2", context)).toBe("01/02/50 BVR");
        expect(dateFromCalendar("commoncal", "01/02/50 BVR", context)).toBe("-50.2");
    });

    it("rejects out-of-order seasons and named days outside the world year", () => {
        const invalid = {
            ...calendar,
            fm: {
                ...calendar.fm,
                data: {
                    ...calendar.fm.data,
                    seasons: [
                        { name: "Summer", start: 92 },
                        { name: "Spring", start: 1 },
                    ],
                    namedDays: [{ name: "Festival", day: 366 }],
                },
            },
        };
        const findings = checkCalendarNote(invalid, { index: { notes: [world, invalid] } });
        expect(findings.map((finding) => finding.message)).toEqual(
            expect.arrayContaining([
                expect.stringContaining("season starts must increase within the year"),
                expect.stringContaining("named days need distinct days within the year"),
            ]),
        );
        expect(() =>
            compileCalendar({ note: invalid, invariants: { year: { days: 365 } } }),
        ).toThrow(/season starts/);
    });

    it("lets the final season continue through the start of the next year", () => {
        const seasonal = {
            ...calendar,
            fm: {
                ...calendar.fm,
                data: {
                    ...calendar.fm.data,
                    seasons: [
                        { name: "Summer", start: 92 },
                        { name: "Winter", start: 274 },
                    ],
                    formats: { std: "MM/DD/Y GGG", season: "QQQQ" },
                },
            },
        };
        const seasonalIndex = { notes: [world, seasonal] };
        expect(checkCalendarNote(seasonal, { index: seasonalIndex })).toEqual([]);
        const context = { ...resolveReckoningMarkers(seasonalIndex, 365), daysPerYear: 365 };
        expect(dateToCalendar("commoncal", "1.1", context, "season")).toBe("Winter");
        expect(dateToCalendar("commoncal", "1.92", context, "season")).toBe("Summer");
        const definition = compileCalendar({
            note: seasonal,
            invariants: { year: { days: 365 } },
        });
        expect(definition.seasons.values[1]).toMatchObject({ dayStart: 273, dayEnd: 90 });
    });

    it("resolves unordered year starts and a backward era from the calendar epoch", () => {
        const context = { ...resolveReckoningMarkers(index, 365), daysPerYear: 365 };
        expect(context.findings).toEqual([]);
        expect(dateToCalendar("commoncal", "-50.2", context)).toBe("2 Floralis 50 BVR");
        expect(dateFromCalendar("commoncal", "2 Floralis 50 BVR", context)).toBe("-50.2");
        expect(dateToCalendar("commoncal", "100.1", context)).toBe("1 Floralis 1 LC");
        expect(dateFromCalendar("commoncal", "1 Floralis 1 LC", context)).toBe("100.1");
        expect(parseNoteDate("datefrom commoncal 2 Floralis 50 BVR", context).date).toMatchObject({
            canonicalYear: -49,
            canonicalDay: 2,
        });
    });

    it("uses another named format and emits Calendaria year starts", () => {
        const context = { ...resolveReckoningMarkers(index, 365), daysPerYear: 365 };
        expect(dateToCalendar("commoncal", "1.1", context, "long")).toBe("Newday, 1 Floralis 1 VR");
        expect(dateToCalendar("commoncal", "2.1", context, "long")).toBe(
            "Growday, 1 Floralis 2 VR",
        );
        expect(
            renderMarkdownExpressions('{{dateformat "commoncal" "1.1" "long"}}', {
                dates: context,
            }),
        ).toEqual({
            markdown: "Newday, 1 Floralis 1 VR",
            findings: [],
        });
        const unknown = renderMarkdownExpressions('{{dateformat "commoncal" "1.1" "missing"}}', {
            dates: context,
            file: "Note.md",
            bodyLine: 7,
        });
        expect(unknown.findings[0]).toMatchObject({ file: "Note.md", line: 7, severity: "error" });
        expect(unknown.findings[0].message).toContain("missing");
        const definition = compileCalendar({
            note: calendar,
            invariants: { year: { days: 365 } },
            dateContext: context,
        });
        expect(definition.eras.vr.startYear).toBe(1);
        expect(definition.eras.later.startYear).toBe(100);
        expect(definition.dateFormats.short).toBe("D MMMM [yearInEra] G");
        expect(
            dateFromCalendar(
                "commoncal",
                dateToCalendar("commoncal", "1.1:143005", context),
                context,
            ),
        ).toBe("1.1:143005");
    });

    it("requires one null era and one year-one era, and rejects duplicate starts", () => {
        const bad = {
            ...calendar,
            fm: {
                ...calendar.fm,
                data: {
                    ...calendar.fm.data,
                    eras: [
                        { shortcode: "a", start: null },
                        { shortcode: "b", start: null },
                        { shortcode: "c", start: 2 },
                        { shortcode: "d", start: 2 },
                    ],
                },
            },
        };
        const findings = checkCalendarNote(bad, { index: { notes: [world, bad] } });
        expect(findings.map((item) => item.message).join(" ")).toMatch(/start: 1|year 1/);
        expect(findings.map((item) => item.message).join(" ")).toMatch(/null|before/);
        expect(findings.map((item) => item.message).join(" ")).toMatch(/duplicate|share/);
        expect(() => compileCalendar({ note: bad, invariants: { year: { days: 365 } } })).toThrow(
            /data.eras/,
        );
        const fractional = {
            ...calendar,
            fm: {
                ...calendar.fm,
                data: {
                    ...calendar.fm.data,
                    eras: [
                        { shortcode: "before", start: null },
                        { shortcode: "vr", start: 1.1 },
                    ],
                },
            },
        };
        expect(() =>
            compileCalendar({ note: fractional, invariants: { year: { days: 365 } } }),
        ).toThrow(/positive year starts/);
    });

    it("requires an invertible standard format while accepting named display formats", () => {
        const bad = {
            ...calendar,
            fm: {
                ...calendar.fm,
                data: {
                    ...calendar.fm.data,
                    formats: { std: "YY MMMM", long: "EEEE, D MMMM [yearInEra] G" },
                },
            },
        };
        expect(
            checkCalendarNote(bad, { index: { notes: [world, bad] } })
                .map((finding) => finding.message)
                .join(" "),
        ).toContain("standard calendar format");
        const ambiguous = {
            ...bad,
            fm: { ...bad.fm, data: { ...bad.fm.data, formats: { std: "YMD" } } },
        };
        expect(
            checkCalendarNote(ambiguous, { index: { notes: [world, ambiguous] } })
                .map((finding) => finding.message)
                .join(" "),
        ).toContain("ambiguous adjacent numeric tokens");
        const alternate = {
            ...calendar,
            fm: {
                ...calendar.fm,
                data: {
                    ...calendar.fm.data,
                    formats: { first: "D MMMM [yearInEra] G", long: "EEEE, D MMMM [yearInEra] G" },
                },
            },
        };
        const context = {
            ...resolveReckoningMarkers({ notes: [alternate] }, 365),
            daysPerYear: 365,
        };
        expect(dateFromCalendar("commoncal", "1 Floralis 1 VR", context)).toBe("1.1");
    });

    it("reads adjacent Calendaria tokens in the standard format", () => {
        const numeric = {
            ...calendar,
            fm: {
                ...calendar.fm,
                data: {
                    ...calendar.fm.data,
                    formats: { std: "YYYYMMDD" },
                },
            },
        };
        const context = { ...resolveReckoningMarkers({ notes: [numeric] }, 365), daysPerYear: 365 };
        expect(checkCalendarNote(numeric, { index: { notes: [world, numeric] } })).toEqual([]);
        expect(dateToCalendar("commoncal", "326.23", context)).toBe("03260123");
        expect(dateFromCalendar("commoncal", "03260123", context)).toBe("326.23");
        expect(parseNoteDate("datefrom commoncal 032601", context).date).toMatchObject({
            precision: "month",
            canonicalYear: 326,
        });
        expect(parseNoteDate("datefrom commoncal 0326", context).date).toMatchObject({
            precision: "year",
            canonicalYear: 326,
        });
    });

    it("preserves year, month, day, and clock precision in the standard format", () => {
        const context = { ...resolveReckoningMarkers(index, 365), daysPerYear: 365 };
        const year = parseNoteDate("datefrom commoncal 50 VR", context).date;
        const month = parseNoteDate("datefrom commoncal Floralis 50 VR", context).date;
        const day = parseNoteDate("datefrom commoncal 23 Floralis 50 VR", context).date;
        const second = parseNoteDate("datefrom commoncal 23 Floralis 50 VR 14:30:05", context).date;
        const approximate = parseNoteDate("~datefrom commoncal Floralis 50 VR", context).date;
        expect([year.precision, month.precision, day.precision, second.precision]).toEqual([
            "year",
            "month",
            "day",
            "day",
        ]);
        expect(second.seconds).toBe(52205);
        expect(approximate.approximate).toBe(true);
        expect(formatDateInCalendar(approximate, "commoncal", context)?.text).toBe(
            "~Floralis 50 VR",
        );
        expect(formatDateInCalendar(year, "commoncal", context)?.text).toBe("50 VR");
        expect(formatDateInCalendar(year, "commoncal", context, "long")?.text).toBe("50 VR");
        expect(formatDateInCalendar(month, "commoncal", context)?.text).toBe("Floralis 50 VR");
        expect(formatDateInCalendar(month, "commoncal", context, "long")?.text).toBe(
            "Floralis 50 VR",
        );
        expect(formatDateInCalendar(day, "commoncal", context)?.text).toBe("23 Floralis 50 VR");
        expect(formatDateInCalendar(second, "commoncal", context)?.text).toBe(
            "23 Floralis 50 VR 14:30:05",
        );
    });

    it("reads a standard format with clock tokens at day and second precision", () => {
        const timed = {
            ...calendar,
            fm: {
                ...calendar.fm,
                data: {
                    ...calendar.fm.data,
                    formats: { std: "D MMMM [yearInEra] G HH:mm:ss" },
                },
            },
        };
        const context = { ...resolveReckoningMarkers({ notes: [timed] }, 365), daysPerYear: 365 };
        expect(dateToCalendar("commoncal", "50.23:143005", context)).toBe(
            "23 Floralis 50 VR 14:30:05",
        );
        expect(dateFromCalendar("commoncal", "23 Floralis 50 VR 14:30:05", context)).toBe(
            "50.23:143005",
        );
        const day = parseNoteDate("datefrom commoncal 23 Floralis 50 VR", context).date;
        expect(day).toMatchObject({ precision: "day" });
        expect(day.seconds).toBeUndefined();
        expect(formatDateInCalendar(day, "commoncal", context)?.text).toBe("23 Floralis 50 VR");
    });
});
