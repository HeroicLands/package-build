/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **The canonical axis, the month list, and the moon.**
 *
 * A reckoning is an era, declared on the note about the calendar that counts
 * those years, and its epoch is the `start` written on that row. Nothing here
 * is configured: a calendar's months, its eras and the world's year are all
 * authored content.
 *
 * The year conversion is one function with two branches, and the branches are
 * the year-zero hole. The cases below assert it from both sides of an epoch,
 * because a collapse to either branch is correct on one side and off by one on
 * the other — and the lunar phase is asserted the same way, because a
 * truncated modulo has exactly that shape of error.
 */

import { describe, it, expect } from "vitest";

import {
    CANONICAL_EPOCH,
    calendarStructure,
    canonicalYear,
    dateSortKey,
    dayOfYear,
    daysInMonth,
    daysInYear,
    lunarPhase,
    monthStarts,
} from "../engine/calendars.mjs";

describe("the axis", () => {
    it("is its own epoch, by definition rather than by declaration", () => {
        expect(CANONICAL_EPOCH).toBe(1);
        expect(canonicalYear(1)).toBe(1);
        expect(canonicalYear(1, CANONICAL_EPOCH)).toBe(canonicalYear(1));
    });

    it("has no year zero: authored -1 and 1 are adjacent", () => {
        expect(canonicalYear(-1)).toBe(0);
        expect(canonicalYear(1)).toBe(1);
        expect(canonicalYear(1) - canonicalYear(-1)).toBe(1);
    });

    it("walks the authored numbering onto a line that has a zero", () => {
        expect([-3, -2, -1, 1, 2, 3].map((year) => canonicalYear(year))).toEqual([
            -2, -1, 0, 1, 2, 3,
        ]);
    });
});

describe("an era's epoch", () => {
    // Where an era's own year 1 sits on the axis, which is the whole of what
    // conversion needs from it.
    const EPOCHS = [1, -2109, -479, 689, 695];

    for (const epoch of EPOCHS) {
        it(`puts year 1 at ${epoch} and year -1 immediately before it`, () => {
            expect(canonicalYear(1, epoch)).toBe(epoch);
            expect(canonicalYear(-1, epoch)).toBe(epoch - 1);
            expect(canonicalYear(1, epoch) - canonicalYear(-1, epoch)).toBe(1);
        });
    }

    it("reads epochs on both sides of the axis's own", () => {
        // Guards the guard: epochs of one sign would let a collapsed
        // conversion pass every case above.
        expect(EPOCHS.some((epoch) => epoch < 0)).toBe(true);
        expect(EPOCHS.some((epoch) => epoch > CANONICAL_EPOCH)).toBe(true);
    });

    it("converts the two years the setting states, neither fitted", () => {
        // "The current year is approximately 2,830 ST (corresponding to 720 AF
        // in the western calendar)", against a Sep Tepy starting -2110.
        expect(canonicalYear(-2110)).toBe(-2109);
        expect(canonicalYear(2830, -2109)).toBe(720);
        // "M 1 falls in 480 BF", against a count starting -480.
        expect(canonicalYear(-480)).toBe(-479);
        expect(canonicalYear(1200, -479)).toBe(720);
    });
});

describe("the sort key", () => {
    it("folds month and day into a fraction without losing the year", () => {
        expect(dateSortKey(689, 6, 19)).toBe(689.0619);
        expect(dateSortKey(689, 6, null)).toBe(689.06);
        expect(dateSortKey(689, null, null)).toBe(689);
    });

    it("runs months and days forward inside a year before the epoch", () => {
        expect(dateSortKey(-983, 6, null)).toBe(-982.94);
        expect(dateSortKey(-983, null, null)).toBeLessThan(dateSortKey(-983, 1, null));
    });
});

describe("the months a calendar keeps", () => {
    it("reads nothing out of nothing rather than throwing", () => {
        expect(calendarStructure(undefined)).toEqual({ months: null });
        expect(calendarStructure({})).toEqual({ months: null });
    });

    it("reads an empty list as no list, because both divide the year alike", () => {
        expect(calendarStructure({ months: [] })).toEqual({ months: null });
    });

    it("carries the list through, in the order the note wrote it", () => {
        const months = [
            { name: "Aran", days: 30 },
            { name: "Hamaspath", days: 5 },
        ];
        expect(calendarStructure({ months }).months).toBe(months);
    });

    it("answers how long one month is, and nothing for a month it has not got", () => {
        const calendar = {
            months: [
                { name: "Aran", days: 30 },
                { name: "Hamaspath", days: 5 },
            ],
        };
        expect(daysInMonth(calendar, 1)).toBe(30);
        expect(daysInMonth(calendar, 2)).toBe(5);
        expect(daysInMonth(calendar, 3)).toBeNull();
        expect(daysInMonth({}, 1)).toBeNull();
    });
});

describe("what a month list adds up to, and where each month opens", () => {
    /** The Common Calendar: seven thirties and five thirty-ones, summing to 365. */
    const COMMON = [30, 31, 30, 31, 30, 31, 30, 30, 31, 30, 31, 30].map((days, i) => ({
        name: `Month ${i + 1}`,
        days,
    }));

    it("sums the list", () => {
        expect(daysInYear(COMMON)).toBe(365);
        expect(daysInYear([])).toBe(0);
    });

    it("reads the same sum as a sequence, which is what an ordering error moves", () => {
        expect(monthStarts(COMMON)).toEqual([
            1, 31, 62, 92, 123, 153, 184, 214, 244, 275, 305, 336,
        ]);
        // The same twelve numbers in a different order sum alike and open
        // their months on different days.
        const shuffled = [...COMMON].reverse();
        expect(daysInYear(shuffled)).toBe(daysInYear(COMMON));
        expect(monthStarts(shuffled)).not.toEqual(monthStarts(COMMON));
    });

    it("places a written month and day in the year", () => {
        expect(dayOfYear(COMMON, 1, 1)).toBe(1);
        expect(dayOfYear(COMMON, 4, 1)).toBe(92);
        expect(dayOfYear(COMMON, 12, 30)).toBe(365);
    });

    it("places a day in a short month that sits in the middle of the list", () => {
        const khazryn = [
            ...Array.from({ length: 12 }, (_, i) => ({ name: `Month ${i + 1}`, days: 30 })),
            { name: "Hamaspathmaedaya", days: 5 },
        ];
        expect(daysInYear(khazryn)).toBe(365);
        expect(dayOfYear(khazryn, 13, 5)).toBe(365);
    });
});

describe("how far into its cycle a moon is", () => {
    it("takes a floored modulo, not JavaScript's", () => {
        // Seven days before the epoch the moon is 23 days into its cycle, and
        // `%` alone says -7 — right on one side of the epoch and wrong on the
        // other, which no single-year fixture can see.
        expect(lunarPhase(-7, 0, 30)).toBe(23);
        expect(((-7 % 30) + 30) % 30).toBe(23);
        expect(lunarPhase(7, 0, 30)).toBe(7);
        expect(lunarPhase(0, 0, 30)).toBe(0);
        expect(lunarPhase(30, 0, 30)).toBe(0);
        expect(lunarPhase(-30, 0, 30)).toBe(0);
    });

    it("reproduces the six-year cycle in full, which one year cannot", () => {
        // 365 days and a thirty-day cycle: the phase on 1/1 advances five days
        // a year and comes back round at the sixth. An off-by-one in the
        // modulo passes a single year and fails this.
        const epochDay = 0;
        const firstOfYear = (year: number) => (year - 720) * 365;
        expect(
            [720, 721, 722, 723, 724, 725, 726].map((y) =>
                lunarPhase(firstOfYear(y), epochDay, 30),
            ),
        ).toEqual([0, 5, 10, 15, 20, 25, 0]);
    });

    it("runs the same table backwards through the epoch", () => {
        const firstOfYear = (year: number) => (year - 720) * 365;
        expect(
            [719, 718, 717, 716, 715, 714].map((y) => lunarPhase(firstOfYear(y), 0, 30)),
        ).toEqual([25, 20, 15, 10, 5, 0]);
    });
});
