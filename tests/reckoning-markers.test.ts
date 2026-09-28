/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { checkCalendarNote, compileCalendar } from "../engine/calendar-notes.mjs";
import { dateFromCalendar, dateToCalendar } from "../engine/date-conversion.mjs";
import { parseNoteDate } from "../engine/note-dates.mjs";
import { reckoningContext, resolveReckoningMarkers } from "../engine/reckoning-markers.mjs";

const months = [
    { name: "First", days: 180 },
    { name: "Second", days: 185 },
];
const world = { fm: { type: "place", subType: "world", data: { year: { days: 365 } } } };
function calendar(eras, pkg = "thalorna", epoch = "1.1") {
    return {
        file: `${pkg}-Calendar.md`,
        raw: "",
        fm: {
            package: pkg,
            shortcode: "commoncal",
            type: "lore",
            subType: "calendar",
            data: { epoch, months, formats: { std: "D MMMM [yearInEra] G" }, eras },
        },
    };
}
const eras = [
    { shortcode: "later", name: "Later", abbreviation: "LR", marker: "LR", start: 701 },
    { shortcode: "before", name: "Before", abbreviation: "BVR", start: null },
    { shortcode: "founding", name: "Founding", abbreviation: "VR", marker: "VR", start: 1 },
];

describe("reckoning markers", () => {
    it("sorts era starts, counts backward from year one, and bounds each era", () => {
        const context = {
            ...resolveReckoningMarkers({ notes: [calendar(eras)] }, 365),
            daysPerYear: 365,
        };
        expect(context.findings).toEqual([]);
        expect(dateToCalendar("commoncal", "-50.2", context)).toBe("2 First 50 BVR");
        expect(dateFromCalendar("commoncal", "2 First 50 BVR", context)).toBe("-50.2");
        expect(dateToCalendar("commoncal", "701.1", context)).toBe("1 First 1 LR");
        expect(dateFromCalendar("commoncal", "1 First 1 LR", context)).toBe("701.1");
        expect(parseNoteDate("701 commoncal.founding", context).findings[0].message).toContain(
            "end",
        );
        expect(parseNoteDate("-1 commoncal.later", context).findings[0].message).toContain(
            "positive year",
        );
        expect(context.markers.get("VR")?.era).toBe("commoncal.founding");
    });

    it("anchors calendar year one to the canonical epoch", () => {
        const note = calendar(eras, "thalorna", "720.10");
        const context = { ...resolveReckoningMarkers({ notes: [note] }, 365), daysPerYear: 365 };
        expect(context.findings).toEqual([]);
        expect(dateFromCalendar("commoncal", "1 First 1 VR", context)).toBe("720.10");
        expect(dateToCalendar("commoncal", "720.10", context)).toBe("1 First 1 VR");
        const compiled = compileCalendar({
            note,
            invariants: { year: { days: 365 } },
            dateContext: context,
        });
        expect(compiled.years.yearZero).toBe(1);
        expect(compiled.eras.founding.startYear).toBe(1);
        expect(compiled.eras.later.startYear).toBe(701);
    });

    it("keeps addressed eras distinct across packages", () => {
        const context = {
            ...resolveReckoningMarkers({ notes: [calendar(eras), calendar(eras, "sohl")] }, 365),
            daysPerYear: 365,
        };
        expect(
            parseNoteDate("19 thalorna-note-lore-commoncal.founding", context).date,
        ).toMatchObject({ canonicalYear: 19 });
        expect(parseNoteDate("20 commoncal.founding", context).findings[0].message).toContain(
            "ambiguous calendar era",
        );
    });

    it("reports duplicate markers, starts, missing eras, and explicit ends", () => {
        const bad = calendar([
            { shortcode: "before", start: null },
            { shortcode: "again", start: null },
            { shortcode: "later", marker: "VR", start: 2 },
            { shortcode: "same", marker: "VR", start: 2, end: "3.1" },
        ]);
        const findings = resolveReckoningMarkers({ notes: [bad] }, 365)
            .findings.map((finding) => finding.message)
            .join(" ");
        for (const phrase of ["start: 1", "start: null", "share start", "marker VR", "omit end"])
            expect(findings).toContain(phrase);
    });

    it("reads the std format and rejects dates outside an era", () => {
        const context = {
            ...resolveReckoningMarkers({ notes: [calendar(eras)] }, 365),
            daysPerYear: 365,
        };
        expect(parseNoteDate("datefrom commoncal 14 First 700 VR", context).date).toMatchObject({
            canonicalYear: 700,
            canonicalDay: 14,
        });
        expect(parseNoteDate("datefrom commoncal 14 First 1 LR", context).date).toMatchObject({
            canonicalYear: 701,
            canonicalDay: 14,
        });
        expect(
            parseNoteDate("datefrom commoncal 14 First 701 VR", context).findings[0].message,
        ).toContain("end");
        expect(
            parseNoteDate("datefrom commoncal 14 First 1 XX", context).findings[0].message,
        ).toContain("XX");
    });

    it("checks authored data against the same resolved context", () => {
        const note = calendar(eras);
        const index = { notes: [world, note] };
        expect(reckoningContext(index).findings).toEqual([]);
        expect(checkCalendarNote(note, { index })).toEqual([]);
    });
});
