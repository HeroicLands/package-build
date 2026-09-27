/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { parseNoteDate } from "../engine/note-dates.mjs";
import { computeAge } from "../engine/being-age.mjs";
import { checkCalendarNote, compileCalendar } from "../engine/calendar-notes.mjs";
import { monthDayOfYear } from "../engine/calendars.mjs";
import { reckoningContext, resolveReckoningMarkers } from "../engine/reckoning-markers.mjs";

const months = [
    { name: "First", days: 30 },
    { name: "Second", days: 31 },
    { name: "Third", days: 30 },
    { name: "Fourth", days: 31 },
    { name: "Fifth", days: 30 },
    { name: "Sixth", days: 31 },
    { name: "Seventh", days: 30 },
    { name: "Eighth", days: 30 },
    { name: "Ninth", days: 31 },
    { name: "Tenth", days: 30 },
    { name: "Eleventh", days: 31 },
    { name: "Twelfth", days: 30 },
];

function calendar(eras: object[]) {
    return {
        type: "lore",
        fm: { shortcode: "commoncal", type: "lore", subType: "calendar", data: { months, eras } },
        file: "Common_Calendar.md",
        raw: "",
    };
}

describe("reckoning markers", () => {
    it("resolves an era marker through its calendar without claiming the calendar has one era", () => {
        const index = {
            notes: [
                calendar([
                    { shortcode: "founding", marker: "VR", start: 1 },
                    { shortcode: "later", marker: "LR", start: "701.1" },
                ]),
            ],
        };
        const { markers, findings } = resolveReckoningMarkers(index, 365);
        expect(findings).toEqual([]);
        expect(markers.get("VR")?.era).toBe("commoncal.founding");
        expect(markers.get("LR")?.era).toBe("commoncal.later");
        expect(parseNoteDate("VR(720/5/14)", { markers, daysPerYear: 365 }).date).toMatchObject({
            text: "VR(720/5/14)",
            era: "commoncal.founding",
            year: 720,
            month: 5,
            day: 14,
            canonicalYear: 720,
            canonicalDay: 136,
        });
        expect(parseNoteDate("LR(20/5/14)", { markers, daysPerYear: 365 }).date).toMatchObject({
            canonicalYear: 720,
            canonicalDay: 136,
        });
        expect(computeAge("VR(676/12/5)", "VR(720/1/1)", { markers, daysPerYear: 365 })).toBe(43);
    });

    it("keeps partial precision and refuses an unknown marker", () => {
        const { markers } = resolveReckoningMarkers(
            { notes: [calendar([{ shortcode: "founding", marker: "VR", start: 1 }])] },
            365,
        );
        expect(parseNoteDate("VR(720)", { markers, daysPerYear: 365 }).date).toMatchObject({
            precision: "year",
            canonicalYear: 720,
        });
        expect(parseNoteDate("VR(720/5)", { markers, daysPerYear: 365 }).date).toMatchObject({
            precision: "month",
            canonicalDay: 123,
        });
        expect(parseNoteDate("XX(720/5/14)", { markers, daysPerYear: 365 }).findings).toEqual([
            expect.objectContaining({ severity: "error", message: expect.stringContaining("XX") }),
        ]);
        expect(parseNoteDate("720.136:235959", { daysPerYear: 365 }).date).toMatchObject({
            canonicalYear: 720,
            canonicalDay: 136,
            seconds: 86399,
        });
    });

    it("reports duplicate markers and circular era starts", () => {
        const duplicate = resolveReckoningMarkers(
            {
                notes: [
                    calendar([
                        { shortcode: "founding", marker: "VR", start: 1 },
                        { shortcode: "another", marker: "VR", start: "701.1" },
                    ]),
                ],
            },
            365,
        );
        expect(duplicate.findings).toEqual([
            expect.objectContaining({ severity: "error", message: expect.stringContaining("VR") }),
        ]);
        const circular = resolveReckoningMarkers(
            { notes: [calendar([{ shortcode: "founding", marker: "VR", start: "VR(1/1/1)" }])] },
            365,
        );
        expect(circular.findings).toEqual([
            expect.objectContaining({
                severity: "error",
                message: expect.stringContaining("cycle"),
            }),
        ]);
    });

    it("resolves a chain of four eras and bounds a date by its era end", () => {
        const { markers, findings } = resolveReckoningMarkers(
            {
                notes: [
                    calendar([
                        { shortcode: "founding", marker: "VR", start: 1 },
                        { shortcode: "later", marker: "LR", start: "VR(701/1/1)" },
                        { shortcode: "east", marker: "ER", start: "LR(20/1/1)" },
                        { shortcode: "queen", marker: "QR", start: "ER(2/1/1)", end: "QR(3)" },
                    ]),
                ],
            },
            365,
        );
        expect(findings).toEqual([]);
        expect(parseNoteDate("QR(1/1/1)", { markers, daysPerYear: 365 }).date).toMatchObject({
            canonicalYear: 721,
            canonicalDay: 1,
        });
        expect(parseNoteDate("QR(3/12/30)", { markers, daysPerYear: 365 }).findings).toEqual([]);
        expect(parseNoteDate("QR(4/1/1)", { markers, daysPerYear: 365 }).findings).toEqual([
            expect.objectContaining({ severity: "error", message: expect.stringContaining("end") }),
        ]);
    });

    it("keeps compiled calendar years and era starts stable with marked source dates", () => {
        const note = calendar([
            { shortcode: "founding", marker: "VR", start: 1 },
            { shortcode: "another", start: "VR(-480)" },
        ]);
        note.fm.data.epoch = "VR(720/1/1)";
        const world = {
            type: "place",
            fm: {
                type: "place",
                subType: "world",
                data: { year: { days: 365 }, present: "VR(720)" },
            },
        };
        const index = { notes: [world, note] };
        const dates = reckoningContext(index);
        expect(checkCalendarNote(note, { index })).toEqual([]);
        const compiled = compileCalendar({
            note,
            invariants: { year: { days: 365 } },
            dateContext: dates,
        });
        expect(compiled.years.yearZero).toBe(720);
        expect(compiled.epochDayOffset).toBe(0);
        expect(compiled.eras.another.start).toBe("-480");
        expect(monthDayOfYear(months, 136)).toEqual({ month: 5, day: 14 });
        const otherCalendar = calendar([]);
        otherCalendar.fm.data.months = [{ name: "Whole Year", days: 365 }];
        const otherCompiled = compileCalendar({
            note: otherCalendar,
            invariants: {
                year: { days: 365 },
                moon: { cycle: 30, newOn: "VR(720/5/14)" },
                moonName: "Moon",
            },
            dateContext: dates,
        });
        expect(otherCompiled.moons.Moon.referenceDate).toEqual({ year: 720, month: 1, day: 136 });
    });
});
