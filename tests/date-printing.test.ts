/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { canonicalYear, eraYear } from "../engine/calendars.mjs";
import {
    calendarEras,
    eraCovering,
    formatNoteDate,
    occurrencesOf,
    parseNoteDate,
} from "../engine/note-dates.mjs";
import { resolveReckoningMarkers } from "../engine/reckoning-markers.mjs";
import { buildIndexRecord } from "../engine/content-index.mjs";
import { noteInfobox } from "../engine/infobox.mjs";
import { resolvedDateFields } from "../engine/note-dates.mjs";
import { checkCalendarChoice } from "../engine/calendar-choice.mjs";
import { parseAddress } from "../engine/address.mjs";
import { dateFromCalendar, dateToCalendar } from "../engine/date-conversion.mjs";

const months = Array.from({ length: 12 }, (_, i) => ({
    name: i === 3 ? "Taranis" : `Month ${i + 1}`,
    days:
        i === 1 ? 31
        : i === 3 ? 29
        : i === 11 ? 35
        : 30,
}));
const index = {
    notes: [
        {
            package: "thalorna",
            fm: {
                shortcode: "vrcal",
                type: "lore",
                subType: "calendar",
                data: {
                    epoch: "1.1",
                    months,
                    eras: [
                        { shortcode: "before", name: "Before", abbreviation: "BF", start: null },
                        {
                            shortcode: "founding",
                            marker: "VR",
                            abbreviation: "VR",
                            start: 1,
                            label: { after: "{date} AF", before: "{date} BF" },
                        },
                    ],
                },
            },
        },
        {
            package: "thalorna",
            fm: {
                shortcode: "latercal",
                type: "lore",
                subType: "calendar",
                data: {
                    epoch: "1.1",
                    months,
                    eras: [
                        { shortcode: "before", name: "Before", abbreviation: "BL", start: null },
                        { shortcode: "early", name: "Early", abbreviation: "ER", start: 1 },
                        {
                            shortcode: "later",
                            marker: "LR",
                            start: 701,
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
        expect(dateFromCalendar("vrcal", "23 Taranis 326 VR", context)).toBe("326.114");
        expect(dateToCalendar("vrcal", "326.114", context)).toBe("23 Taranis 326 VR");
        expect(dateFromCalendar("vrcal", "~23 Taranis 326 VR", context)).toBe("~326.114");
        expect(dateToCalendar("vrcal", "~326.114", context)).toBe("~23 Taranis 326 VR");
        expect(parseNoteDate("datefrom vrcal 23 Taranis 326 VR", context).date).toMatchObject({
            canonicalYear: 326,
            canonicalDay: 114,
        });
        expect(parseNoteDate("~datefrom vrcal 23 Taranis 326 VR", context).date).toMatchObject({
            canonicalYear: 326,
            canonicalDay: 114,
            approximate: true,
        });
        expect(dateFromCalendar("vrcal", "14 Month 5 720 VR", context)).toBe("720.134");
        expect(dateToCalendar("vrcal", "720.134:120305", context)).toBe(
            "14 Month 5 720 VR 12:03:05",
        );
        expect(dateFromCalendar("vrcal", "14 Month 5 720 VR 12:03:05", context)).toBe(
            "720.134:120305",
        );
        expect(() => dateFromCalendar("latercal", "14 Month 5 720 VR", context)).toThrow(
            /unknown era/,
        );
        expect(() => dateFromCalendar("vrcal", "Month 5 720 VR", context)).toThrow(
            /precise to the day/,
        );
        expect(dateToCalendar("latercal", "740.134", context)).toBe("14 Month 5 40 LR");
    });

    it("accepts only canonical or named frontmatter dates and preserves approximation", () => {
        for (const input of [
            "326",
            326,
            "-300",
            "~326",
            "326.114",
            "-300.1",
            "326.114:143005",
            "~326.114",
            "datefrom vrcal 326 VR",
            "~datefrom vrcal 23 Taranis 326 VR",
            "unknown",
        ]) {
            const result = parseNoteDate(input, { ...context, field: "data.born" });
            expect(result.findings.filter((finding) => finding.severity === "error")).toEqual([]);
            expect(result.date).not.toBeNull();
        }
        for (const input of [
            "326/4/23",
            "VR(326/4/23)",
            "326 vrcal.founding",
            "datefrom vrcal 326/4/23 VR",
        ]) {
            const result = parseNoteDate(input, { ...context, field: "data.born" });
            expect(result.date).toBeNull();
            expect(result.findings.some((finding) => finding.severity === "error")).toBe(true);
        }
        expect(
            parseNoteDate("~326.114", { ...context, field: "data.born" }).date?.approximate,
        ).toBe(true);
        expect(parseNoteDate("326", { ...context, field: "data.born" }).date).toMatchObject({
            text: "326",
            precision: "year",
            approximate: false,
            canonicalYear: 326,
            spanDays: 365,
        });
        expect(parseNoteDate("326", { ...context, field: "data.born" }).date).not.toHaveProperty(
            "canonicalDay",
        );
        expect(parseNoteDate("~326", { ...context, field: "data.born" }).date).toMatchObject({
            precision: "year",
            approximate: true,
            spanDays: 365,
        });
        expect(parseNoteDate("326.1", { ...context, field: "data.born" }).date).toMatchObject({
            precision: "day",
            approximate: false,
            spanDays: 1,
        });
        expect(
            parseNoteDate("~datefrom vrcal 23 Taranis 326 VR", { ...context, field: "data.born" })
                .date?.approximate,
        ).toBe(true);
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
            "datefrom vrcal 720 VR",
            "datefrom vrcal Month 5 720 VR",
            "datefrom vrcal 14 Month 5 720 VR",
            "datefrom vrcal 30 Month 12 1 BF",
            "~datefrom vrcal 480 BF",
        ]) {
            const parsed = parseNoteDate(authored, context);
            expect(parsed.findings.filter((f) => f.severity === "error")).toEqual([]);
            const printed = formatNoteDate(
                parsed.date,
                context.eras.get(parsed.date.qualifier),
                365,
            );
            expect(printed?.text).toMatch(/VR|BF/);
            expect(printed?.year).not.toBe(0);
            expect(
                parseNoteDate(`datefrom vrcal ${printed?.text}`, context).date?.canonicalYear,
            ).toBe(parsed.date?.canonicalYear);
        }
        expect(
            formatNoteDate(
                parseNoteDate("datefrom vrcal 1 BF", context).date,
                context.eras.get("vrcal.before"),
                365,
            )?.text,
        ).toBe("1 BF");
        expect(
            formatNoteDate(parseNoteDate("~datefrom vrcal 720 VR", context).date, vr, 365)?.prose,
        ).toBe("~720 AF");
        expect(formatNoteDate(parseNoteDate("unknown", context).date, vr, 365)).toBeNull();
    });

    it("preserves a canonical year's interval in the index and calendar display", () => {
        const authored = parseNoteDate(720, { ...context, field: "data.born" }).date;
        expect(authored).toMatchObject({
            text: "720",
            precision: "year",
            spanDays: 365,
            approximate: false,
        });
        expect(authored).not.toHaveProperty("canonicalDay");
        expect(formatNoteDate(authored, vr, 365)?.text).toBe("720 VR");
        const resolved = resolvedDateFields(
            { type: "being", data: { born: 720, died: "~720" } },
            context,
        );
        expect(resolved.born).toMatchObject({ precision: "year", spanDays: 365 });
        expect(resolved.died).toMatchObject({ precision: "year", approximate: true });
        expect(resolved.born.sort).toBeLessThan(
            parseNoteDate("720.2", { ...context, field: "data.born" }).date.sort,
        );
    });

    it("selects one era and converts its year without a gap between eras", () => {
        const date = parseNoteDate("datefrom vrcal 14 Month 5 720 VR", context).date;
        expect(eraCovering(date, [lr], 365)).toBe(lr);
        const printed = formatNoteDate(date, lr, 365);
        expect(printed?.text).toBe("14 Month 5 20 LR");
        expect(printed?.prose).toBe("Year 20/5/14 of the Later Count");
        const later = parseNoteDate("datefrom vrcal 14 Month 5 740 VR", context).date;
        expect(eraCovering(later, [lr], 365)).toBe(lr);
        expect(formatNoteDate(later, lr, 365)?.text).toBe("14 Month 5 40 LR");
    });

    it("refuses overlapping claims rather than choosing one", () => {
        const date = parseNoteDate("datefrom vrcal 14 Month 5 720 VR", context).date;
        expect(() => eraCovering(date, [vr, { ...lr, era: "other", firstEra: true }], 365)).toThrow(
            /overlapping eras/,
        );
    });

    it("uses one normalized record in the index and prints its label in the infobox", () => {
        const fm = {
            shortcode: "aran",
            type: "being",
            name: { full: "Aran" },
            data: { born: "datefrom vrcal 14 Month 5 720 VR", died: "unknown" },
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
                born: "datefrom vrcal 14 Month 5 720 VR",
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
        expect(formatNoteDate(dated, lr, 365)?.text).toBe("14 Month 5 20 LR 14:30:05");
        expect(
            parseNoteDate("datefrom latercal 14 Month 5 20 LR 14:30:05", context).date,
        ).toMatchObject({
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

describe("a recurring event's occurrences, each selecting its own era", () => {
    const context = { ...resolveReckoningMarkers(index, 365), daysPerYear: 365 };
    // Derived from the fixture corpus at runtime, the way `resolvedDateFields`
    // composes `occurrencesOf` with `calendarEras` and `eraCovering`: an era
    // added to `latercal` and never exercised below fails this suite.
    const latercalEras = calendarEras("latercal", context);

    it("declares the three eras this suite exercises", () => {
        expect(latercalEras.map((era) => era.era).sort()).toEqual(
            ["latercal.before", "latercal.early", "latercal.later"].sort(),
        );
    });

    it("selects a different era for an earlier and a later occurrence of the same series", () => {
        const anchor = parseNoteDate("20 latercal.early", context).date;
        const [early, stillEarly, later] = occurrencesOf(
            anchor,
            { every: 350 },
            { from: 20, to: 720 },
        );
        expect([early, stillEarly, later].map((occ) => occ.canonicalYear)).toEqual([20, 370, 720]);

        expect(formatNoteDate(early, eraCovering(early, latercalEras, 365), 365)?.text).toContain(
            "ER",
        );
        expect(
            formatNoteDate(stillEarly, eraCovering(stillEarly, latercalEras, 365), 365)?.text,
        ).toContain("ER");
        expect(formatNoteDate(later, eraCovering(later, latercalEras, 365), 365)?.text).toContain(
            "LR",
        );
    });

    it("selects the era that opens the axis for an anchor dated before it", () => {
        const anchor = parseNoteDate("400 latercal.before", context).date;
        const [occurrence] = occurrencesOf(anchor, { every: 1 }, { from: anchor.canonicalYear });
        const era = eraCovering(occurrence, latercalEras, 365);
        expect(era?.era).toBe("latercal.before");
    });

    it("prints bare rather than failing, where a generated occurrence outruns the eras it is checked against", () => {
        // A generated occurrence is never a finding — not even one that
        // outruns every era it is checked against, as this one does by
        // construction: only `early` is offered, and the occurrence lies
        // past where `early` ends.
        const anchor = parseNoteDate("20 latercal.early", context).date;
        const [farFuture] = occurrencesOf(anchor, { every: 350 }, { from: 720, to: 720 });
        const early = latercalEras.find((era) => era.era === "latercal.early");
        expect(eraCovering(farFuture, [early], 365)).toBeNull();
        expect(formatNoteDate(farFuture, null, 365)?.prose).toBeNull();
    });
});
