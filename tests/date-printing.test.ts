/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { canonicalYear, eraYear } from "../engine/calendars.mjs";
import { eraCovering, formatNoteDate, parseNoteDate } from "../engine/note-dates.mjs";
import { resolveReckoningMarkers } from "../engine/reckoning-markers.mjs";
import { buildIndexRecord } from "../engine/content-index.mjs";
import { noteInfobox } from "../engine/infobox.mjs";
import { resolvedDateFields } from "../engine/note-dates.mjs";
import { checkCalendarChoice } from "../engine/calendar-choice.mjs";
import { parseAddress } from "../engine/address.mjs";
import { dateFromCalendar, dateToCalendar } from "../engine/date-conversion.mjs";

const months = Array.from({ length: 12 }, (_, i) => ({
    name: `Month ${i + 1}`,
    days: i === 11 ? 35 : 30,
}));
const index = {
    notes: [
        {
            fm: {
                package: "thalorna",
                shortcode: "vrcal",
                type: "lore",
                subType: "calendar",
                data: {
                    months,
                    eras: [
                        {
                            shortcode: "founding",
                            marker: "VR",
                            start: 1,
                            label: { after: "{date} AF", before: "{date} BF" },
                        },
                    ],
                },
            },
        },
        {
            fm: {
                package: "thalorna",
                shortcode: "latercal",
                type: "lore",
                subType: "calendar",
                data: {
                    months,
                    eras: [
                        {
                            shortcode: "later",
                            marker: "LR",
                            start: "701.1",
                            end: "730.365",
                            label: "Year {date} of the Later Count",
                        },
                    ],
                },
            },
        },
    ],
};

describe("printable reckoning dates", () => {
    const context = { ...resolveReckoningMarkers(index, 365), daysPerYear: 365 };
    const vr = context.markers.get("VR");
    const lr = context.markers.get("LR");

    it("converts exact days in both directions and keeps the era in the output", () => {
        expect(dateFromCalendar("vrcal", "VR(720/5/14)", context)).toBe("720.134");
        expect(dateFromCalendar("vrcal", "720/5/14", context)).toBe("720.134");
        expect(dateToCalendar("vrcal", "720.134:120305", context)).toBe("VR(720/5/14:120305)");
        expect(dateFromCalendar("vrcal", "VR(720/5/14:120305)", context)).toBe("720.134:120305");
        expect(() => dateFromCalendar("latercal", "VR(720/5/14)", context)).toThrow(
            /different calendar/,
        );
        expect(() => dateFromCalendar("vrcal", "VR(720/5)", context)).toThrow(/precise to the day/);
        expect(() => dateToCalendar("latercal", "740.134", context)).toThrow(/outside calendar/);
    });

    it("inverts every signed year without producing year zero", () => {
        for (const epoch of [-2109, -479, 1, 689, 695])
            for (const year of [-100, -2, -1, 1, 2, 100]) {
                const result = eraYear(canonicalYear(year, epoch), epoch);
                expect(result).toBe(year);
                expect(result).not.toBe(0);
            }
    });

    it("round trips positive and negative years with precision and labels", () => {
        for (const authored of [
            "VR(720)",
            "VR(720/5)",
            "VR(720/5/14)",
            "VR(-1/12/30)",
            "VR(~-480)",
        ]) {
            const parsed = parseNoteDate(authored, context);
            expect(parsed.findings.filter((f) => f.severity === "error")).toEqual([]);
            const printed = formatNoteDate(parsed.date, vr, 365);
            expect(printed?.text).toBe(authored);
            expect(printed?.year).not.toBe(0);
            expect(parseNoteDate(printed?.text, context).date?.canonicalYear).toBe(
                parsed.date?.canonicalYear,
            );
        }
        expect(formatNoteDate(parseNoteDate("VR(-1)", context).date, vr, 365)?.prose).toBe("1 BF");
        expect(formatNoteDate(parseNoteDate("VR(~720)", context).date, vr, 365)?.prose).toBe(
            "~720 AF",
        );
        expect(formatNoteDate(parseNoteDate("unknown", context).date, vr, 365)).toBeNull();
    });

    it("selects one era, converts its year, and leaves gaps without a claimed count", () => {
        const date = parseNoteDate("VR(720/5/14)", context).date;
        expect(eraCovering(date, [lr], 365)).toBe(lr);
        const printed = formatNoteDate(date, lr, 365);
        expect(printed?.text).toBe("LR(20/5/14)");
        expect(printed?.prose).toBe("Year 20/5/14 of the Later Count");
        const gap = parseNoteDate("VR(740/5/14)", context).date;
        expect(eraCovering(gap, [lr], 365)).toBeNull();
        expect(formatNoteDate(gap, null, 365)?.text).toBe("VR(740/5/14)");
    });

    it("refuses overlapping claims rather than choosing one", () => {
        const date = parseNoteDate("VR(720/5/14)", context).date;
        expect(() => eraCovering(date, [vr, { ...lr, era: "other", firstEra: true }], 365)).toThrow(
            /overlapping eras/,
        );
    });

    it("uses one normalized record in the index and prints its label in the infobox", () => {
        const fm = {
            shortcode: "aran",
            type: "being",
            name: { full: "Aran" },
            data: { born: "VR(720/5/14)", died: "unknown" },
        };
        const resolved = resolvedDateFields(fm, context);
        const record = buildIndexRecord({
            frontmatter: fm,
            relPath: "Aran.md",
            contentPackage: "thalorna",
            dateContext: context,
        });
        expect(record.resolvedDates).toEqual(resolved);
        expect(resolved.born).toMatchObject({ canonicalYear: 720, canonicalDay: 134 });
        expect(resolved.born.prose).toBe("720/5/14 AF");
        expect(resolved.died).toMatchObject({ known: false, sort: null });
        expect(noteInfobox(fm, { dates: context }).sections[0].rows).toContainEqual({
            label: "Born",
            kind: "text",
            value: "720/5/14 AF",
        });
    });

    it("prints a being's date in its explicitly chosen calendar", () => {
        const fm = {
            type: "being",
            name: { full: "Aran" },
            data: {
                calendar: parseAddress("thalorna-note-lore-latercal", {
                    types: new Set(["lore"]),
                    packages: new Set(["thalorna"]),
                }),
                born: "VR(720/5/14)",
            },
        };
        expect(noteInfobox(fm, { dates: context }).sections[0].rows).toContainEqual({
            label: "Born",
            kind: "text",
            value: "Year 20/5/14 of the Later Count",
        });
    });

    it("preserves clock time when converting a canonical day", () => {
        const dated = parseNoteDate("720.134:143005", context).date;
        expect(formatNoteDate(dated, lr, 365)?.text).toBe("LR(20/5/14:143005)");
        expect(parseNoteDate("LR(20/5/14:143005)", context).date).toMatchObject({
            canonicalYear: 720,
            canonicalDay: 134,
            seconds: 52205,
        });
        const fm = {
            type: "being",
            name: { full: "Aran" },
            data: { calendar: "latercal", born: "720.134:143005" },
        };
        expect(noteInfobox(fm, { dates: context }).sections[0].rows).toContainEqual({
            label: "Born",
            kind: "text",
            value: "Year 20/5/14:143005 of the Later Count",
        });
    });

    it("prints a place's present in its chosen calendar", () => {
        const fm = {
            type: "place",
            subType: "world",
            name: { full: "World" },
            data: { calendar: "latercal", present: "720.134:143005" },
        };
        expect(noteInfobox(fm, { dates: context }).sections[0].rows).toContainEqual({
            label: "Present",
            kind: "text",
            value: "Year 20/5/14:143005 of the Later Count",
        });
    });

    it("validates the chosen calendar's lore subtype", () => {
        const note = {
            file: "Aran.md",
            raw: "---\ndata:\n  calendar: lore-vrcal\n---\n",
            fm: { type: "being", data: { calendar: "lore-vrcal" } },
        };
        const index = {
            contentPackage: "thalorna",
            types: new Set(["lore"]),
            packages: new Set(["thalorna"]),
            addressHit: () => ({ fm: { type: "lore", subType: "culture" } }),
        };
        expect(checkCalendarChoice(note, { index })).toEqual([
            expect.objectContaining({
                file: "Aran.md",
                line: 3,
                severity: "error",
                message: expect.stringContaining("not calendar"),
            }),
        ]);
    });
});
