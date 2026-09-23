/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **The canonical axis, and the small block of configuration that is not about
 * it.**
 *
 * A reckoning is an era, declared by the affiliation that proclaimed it, and
 * its epoch is the `start` written on that note. So nothing here registers a
 * calendar: what configuration states is how the package's year is divided and
 * what date it calls the present, both of which a note could not say.
 *
 * The arithmetic is one function with two branches, and the branches are the
 * year-zero hole. The cases below assert it from both sides of an epoch,
 * because a collapse to either branch is correct on one side and off by one on
 * the other.
 */

import { describe, it, expect } from "vitest";

import { defineConfig } from "../content-config.mjs";
import {
    CANONICAL_EPOCH,
    calendarStructure,
    canonicalYear,
    dateSortKey,
} from "../engine/calendars.mjs";

/** A minimal configuration, with whatever `calendar:` a case is about. */
function build(calendar?: unknown) {
    return defineConfig({
        rootDir: "/repo",
        contentPackage: "acme",
        foundryPackage: "acme",
        packageKind: "systems",
        stats: { lastModifiedBy: "acmebuilder0000" },
        packs: [{ name: "items", type: "Item" }],
        ...(calendar === undefined ? {} : { calendar }),
    });
}

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

describe("the `calendar` block", () => {
    it("resolves to nothing declared when a package declares none", () => {
        // Most packages date nothing, and a resolved shape that is always
        // there is what keeps every reader from testing for the block first.
        expect(build().calendar).toEqual({ months: null, monthDays: null, present: null });
    });

    it("is frozen, so a bound cannot be added by writing to it", () => {
        const { calendar } = build({ months: 12, monthDays: 30 });
        expect(Object.isFrozen(calendar)).toBe(true);
    });

    it("carries the bounds and the present it declares", () => {
        expect(build({ months: 12, monthDays: 30, present: "720/6/19" }).calendar).toEqual({
            months: 12,
            monthDays: 30,
            present: "720/6/19",
        });
    });

    it("refuses a bound that is not a positive integer", () => {
        for (const months of [0, -1, 12.5, "12"]) {
            expect(() => build({ months })).toThrow(
                /`calendar\.months` must be a positive integer/,
            );
        }
        expect(() => build({ monthDays: 0 })).toThrow(
            /`calendar\.monthDays` must be a positive integer/,
        );
    });

    it("refuses a key it does not recognise", () => {
        expect(() => build({ registry: {} })).toThrow(
            /`calendar\.registry` is not a recognized option \(expected one of: months, monthDays, present\)/,
        );
    });

    it("refuses a block that is not a mapping", () => {
        expect(() => build("720/6/19")).toThrow(/`calendar` must be a mapping/);
    });
});

describe("`calendar.present`", () => {
    it("is read through the parser a note's dates go through", () => {
        // One grammar, so a present written the way a date is written needs no
        // second reader and cannot drift from one.
        expect(build({ present: "720" }).calendar.present).toBe("720");
        expect(build({ present: 720 }).calendar.present).toBe("720");
        expect(build({ present: "~-2500" }).calendar.present).toBe("~-2500");
    });

    it("may be said in an era, for a package whose present is best said that way", () => {
        expect(build({ present: "2830 empirtkhpr.septepy" }).calendar.present).toBe(
            "2830 empirtkhpr.septepy",
        );
    });

    it("is checked against the bounds the same block declares", () => {
        expect(() => build({ months: 12, monthDays: 30, present: "720/13/1" })).toThrow(
            /`calendar\.present`.*writes month 13/,
        );
        // With no bound declared there is nothing to check against, which is
        // the same rule a note's dates are read under.
        expect(build({ present: "720/13/1" }).calendar.present).toBe("720/13/1");
    });

    it("refuses year zero, the retired trailing token and a value that is no date", () => {
        expect(() => build({ present: "0" })).toThrow(/writes year 0/);
        expect(() => build({ present: "720 AF" })).toThrow(/names no era/);
        expect(() => build({ present: "midsummer" })).toThrow(/is not a date/);
    });

    it("refuses `unknown`, because a package that has no present leaves it out", () => {
        expect(() => build({ present: "unknown" })).toThrow(
            /`calendar\.present` must be a date — a package that states no present/,
        );
    });

    it("is absent, not empty, when the package states none", () => {
        expect(build({ months: 12 }).calendar.present).toBeNull();
    });
});

describe("the month structure a package declares", () => {
    it("states nothing when the block is absent", () => {
        expect(calendarStructure(build().calendar)).toEqual({ months: null, monthDays: null });
    });

    it("is carried through when declared", () => {
        expect(calendarStructure(build({ months: 12, monthDays: 30 }).calendar)).toEqual({
            months: 12,
            monthDays: 30,
        });
    });

    it("reads nothing out of nothing rather than throwing", () => {
        expect(calendarStructure(undefined)).toEqual({ months: null, monthDays: null });
    });
});
