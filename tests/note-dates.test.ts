/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **One authored string, one parser, one record shape.**
 *
 * A date that parses to the wrong integer is the failure nothing downstream
 * catches: the list still sorts, the page still prints, and five people are a
 * century out of place. So the worked table is the test rather than an
 * illustration, and every claim the format makes about a value — what it
 * prints as, what it orders by, what arithmetic it supports — is asserted on
 * the same row.
 *
 * **The calendars come from a resolved configuration, at runtime.** A second
 * list written out beside the table would be the thing that drifts: it would
 * go on passing while the registry gained a reckoning nothing here exercised.
 * So the registry is declared once, handed to `defineConfig`, and read back
 * out — and a calendar the table never exercises fails.
 */

import { describe, it, expect } from "vitest";

import { defineConfig } from "../content-config.mjs";
import { astronomicalYear, isCalendarAbbreviation } from "../engine/calendars.mjs";
import { UNKNOWN_DATE, parseNoteDate } from "../engine/note-dates.mjs";

/**
 * The reckonings the setting carries, declared the way a package declares them.
 *
 * `M` deliberately states no month structure, which is what the
 * out-of-range cases below read as "no upper bound to check" rather than as a
 * bound to invent.
 */
const CALENDARS = {
    default: "AF",
    registry: {
        AF: {
            name: "After the Founding",
            epoch: 1,
            direction: "forward",
            months: 12,
            monthDays: 30,
        },
        BF: {
            name: "Before the Founding",
            epoch: 0,
            direction: "backward",
            months: 12,
            monthDays: 30,
        },
        ST: { name: "Sep Tepy", epoch: -2109, direction: "forward", months: 12, monthDays: 30 },
        M: { name: "Mādhavendra count", epoch: -479, direction: "forward" },
    },
};

/** The resolved configuration, which is where the parser's registry comes from. */
const config = defineConfig({
    rootDir: "/repo",
    contentPackage: "acme",
    foundryPackage: "acme",
    packageKind: "systems",
    stats: { lastModifiedBy: "acmebuilder0000" },
    packs: [{ name: "items", type: "Item" }],
    calendars: CALENDARS,
});

const calendars = config.calendars;

/** Parse against the resolved registry, which is the only way this file parses. */
function parse(value: unknown, options: Record<string, unknown> = {}) {
    return parseNoteDate(value, { calendars, ...options });
}

/**
 * The worked table, row for row.
 *
 * `text` is what a page prints, `sort` is what a list orders by, and
 * `commonYear` is what arithmetic runs on — so every row states all three.
 */
const WORKED = [
    {
        authored: "689/6/19",
        record: {
            text: "689/6/19",
            known: true,
            calendar: "AF",
            year: 689,
            month: 6,
            day: 19,
            approximate: false,
            precision: "day",
            commonYear: 689,
            sort: 689.0619,
        },
    },
    {
        authored: "689/6",
        record: {
            text: "689/6",
            known: true,
            calendar: "AF",
            year: 689,
            month: 6,
            day: null,
            approximate: false,
            precision: "month",
            commonYear: 689,
            sort: 689.06,
        },
    },
    {
        authored: "984 BF",
        record: {
            text: "984 BF",
            known: true,
            calendar: "BF",
            year: 984,
            month: null,
            day: null,
            approximate: false,
            precision: "year",
            commonYear: -983,
            sort: -983,
        },
    },
    {
        authored: "~984 BF",
        record: {
            text: "~984 BF",
            known: true,
            calendar: "BF",
            year: 984,
            month: null,
            day: null,
            approximate: true,
            precision: "year",
            commonYear: -983,
            sort: -983,
        },
    },
    {
        authored: "~2110 BF",
        record: {
            text: "~2110 BF",
            known: true,
            calendar: "BF",
            year: 2110,
            month: null,
            day: null,
            approximate: true,
            precision: "year",
            commonYear: -2109,
            sort: -2109,
        },
    },
    {
        authored: "5274 BF",
        record: {
            text: "5274 BF",
            known: true,
            calendar: "BF",
            year: 5274,
            month: null,
            day: null,
            approximate: false,
            precision: "year",
            commonYear: -5273,
            sort: -5273,
        },
    },
    {
        authored: "2427 BF",
        record: {
            text: "2427 BF",
            known: true,
            calendar: "BF",
            year: 2427,
            month: null,
            day: null,
            approximate: false,
            precision: "year",
            commonYear: -2426,
            sort: -2426,
        },
    },
    {
        authored: "10000 BF",
        record: {
            text: "10000 BF",
            known: true,
            calendar: "BF",
            year: 10000,
            month: null,
            day: null,
            approximate: false,
            precision: "year",
            commonYear: -9999,
            sort: -9999,
        },
    },
    {
        authored: "2830 ST",
        record: {
            text: "2830 ST",
            known: true,
            calendar: "ST",
            year: 2830,
            month: null,
            day: null,
            approximate: false,
            precision: "year",
            commonYear: 720,
            sort: 720,
        },
    },
    {
        authored: "1200 M",
        record: {
            text: "1200 M",
            known: true,
            calendar: "M",
            year: 1200,
            month: null,
            day: null,
            approximate: false,
            precision: "year",
            commonYear: 720,
            sort: 720,
        },
    },
    {
        authored: 720,
        record: {
            text: "720",
            known: true,
            calendar: "AF",
            year: 720,
            month: null,
            day: null,
            approximate: false,
            precision: "year",
            commonYear: 720,
            sort: 720,
        },
    },
    {
        authored: "1 AF",
        record: {
            text: "1 AF",
            known: true,
            calendar: "AF",
            year: 1,
            month: null,
            day: null,
            approximate: false,
            precision: "year",
            commonYear: 1,
            sort: 1,
        },
    },
    {
        authored: "1 BF",
        record: {
            text: "1 BF",
            known: true,
            calendar: "BF",
            year: 1,
            month: null,
            day: null,
            approximate: false,
            precision: "year",
            commonYear: 0,
            sort: 0,
        },
    },
] as const;

describe("the worked table", () => {
    for (const { authored, record } of WORKED) {
        it(`\`${authored}\` parses to the stated record`, () => {
            const { date, findings } = parse(authored);
            expect(findings).toEqual([]);
            expect(date).toEqual(record);
        });
    }

    it("exercises every registered calendar, read from the resolved configuration", () => {
        // The guard against the second list. A reckoning added to the registry
        // and never written into the table would otherwise ship unparsed and
        // untested, which is precisely the case a hand-written `["AF", "BF"]`
        // here would go on passing through.
        const exercised = new Set(WORKED.map(({ record }) => record.calendar));
        expect([...exercised].sort()).toEqual(Object.keys(calendars.registry).sort());
    });

    it("reads a registry worth checking", () => {
        // Guards the guard: an empty registry would let the agreement above
        // pass by comparing two empty sets.
        expect(Object.keys(calendars.registry).length).toBeGreaterThan(3);
        expect(calendars.default).toBe("AF");
    });
});

describe("the two conversions the setting states", () => {
    it("`2830 ST` is the same year as `720`", () => {
        // "The current year is approximately 2,830 ST (corresponding to 720 AF
        // in the western calendar)."
        expect(parse("2830 ST").date?.commonYear).toBe(720);
        expect(parse("720 AF").date?.commonYear).toBe(720);
        expect(parse("720").date?.commonYear).toBe(720);
    });

    it("`1200 M` is the present", () => {
        // "M 1 falls in 480 BF. A date given in M converts to the Common
        // Calendar by the rule AF year = M year − 480."
        expect(parse("1200 M").date?.commonYear).toBe(720);
        expect(parse("1 M").date?.commonYear).toBe(parse("480 BF").date?.commonYear);
    });

    it("has no year zero: `1 BF` and `1 AF` are adjacent", () => {
        expect(parse("1 BF").date?.commonYear).toBe(0);
        expect(parse("1 AF").date?.commonYear).toBe(1);
    });

    it("subtracts across the epoch without a special case", () => {
        // What `commonYear` is for: a life that begins before the founding and
        // ends after it is one subtraction.
        const born = parse("20 BF").date?.commonYear as number;
        const died = parse("35 AF").date?.commonYear as number;
        expect(died - born).toBe(54);
    });

    it("converts by the epoch rule rather than by a table", () => {
        for (const [abbreviation, spec] of Object.entries(calendars.registry)) {
            expect(parse(`7 ${abbreviation}`).date?.commonYear).toBe(astronomicalYear(7, spec));
        }
    });
});

describe("ordering", () => {
    it("sorts a backward reckoning by year, not by the digits", () => {
        // The reason a string sort is wrong: 984 BF precedes 100 BF.
        const earlier = parse("984 BF").date?.sort as number;
        const later = parse("100 BF").date?.sort as number;
        expect(earlier).toBeLessThan(later);
    });

    it("sorts months and days forward inside a backward year", () => {
        const year = parse("984 BF").date?.sort as number;
        const month = parse("984/1 BF").date?.sort as number;
        const later = parse("984/6 BF").date?.sort as number;
        const next = parse("983 BF").date?.sort as number;
        expect(year).toBeLessThan(month);
        expect(month).toBeLessThan(later);
        expect(later).toBeLessThan(next);
    });

    it("sorts mixed precision without a three-key comparator", () => {
        const values = ["689/6/19", "689/6", "689", "688/12/30", "690"];
        const sorted = values
            .map((text) => ({ text, sort: parse(text).date?.sort as number }))
            .sort((a, b) => a.sort - b.sort)
            .map(({ text }) => text);
        expect(sorted).toEqual(["688/12/30", "689", "689/6", "689/6/19", "690"]);
    });
});

describe("`unknown`", () => {
    it("is a value, not a failure", () => {
        const { date, findings } = parse(UNKNOWN_DATE);
        expect(findings).toEqual([]);
        expect(date).toEqual({
            text: "unknown",
            known: false,
            calendar: null,
            year: null,
            month: null,
            day: null,
            approximate: false,
            precision: null,
            commonYear: null,
            sort: null,
        });
    });

    it("carries no `commonYear` and no `sort`, so nothing orders it", () => {
        // Normalising it to 0 would sort the ancient dead into 1 BF; letting a
        // comparison default it would sort them beside the living. Both are
        // invisible in the output, which is why they are asserted rather than
        // reasoned about.
        const { date } = parse(UNKNOWN_DATE);
        expect(date?.commonYear).toBeNull();
        expect(date?.sort).toBeNull();
        expect(date?.commonYear).not.toBe(0);
        expect(date?.sort).not.toBe(0);
    });

    it("drops out of an ordering rather than landing at one end", () => {
        const values = ["984 BF", "unknown", "689"];
        const ordered = values
            .map((text) => ({ text, sort: parse(text).date?.sort }))
            .filter((row) => row.sort != null)
            .sort((a, b) => (a.sort as number) - (b.sort as number))
            .map(({ text }) => text);
        expect(ordered).toEqual(["984 BF", "689"]);
    });

    it("is refused where absence already says it", () => {
        const { date, findings } = parse(UNKNOWN_DATE, { allowUnknown: false, field: "when" });
        expect(date).toBeNull();
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toContain("`when: unknown`");
    });
});

describe("the findings", () => {
    it("refuses an unparseable string", () => {
        for (const bad of ["hello", "689/", "689/6/19/4", "689 6 19", "-689", "689-6-19"]) {
            const { date, findings } = parse(bad, { field: "died" });
            expect(date, `\`${bad}\` should not parse`).toBeNull();
            expect(findings.map((f) => f.severity)).toEqual(["error"]);
        }
    });

    it("refuses an unregistered abbreviation, and lists the registered ones", () => {
        const { date, findings } = parse("984 QF", { field: "died" });
        expect(date).toBeNull();
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toContain("`died: 984 QF`");
        expect(findings[0].message).toContain("QF");
        // Derived from the registry, so a new reckoning appears in the message
        // the day it is declared.
        for (const abbreviation of Object.keys(calendars.registry)) {
            expect(findings[0].message).toContain(abbreviation);
        }
    });

    it("refuses a month outside the calendar's own year", () => {
        const { date, findings } = parse("689/13/1", { field: "born" });
        expect(date).toBeNull();
        expect(findings.map((f) => f.severity)).toEqual(["error"]);
        expect(findings[0].message).toContain("`born: 689/13/1`");
    });

    it("refuses a day outside the month's length", () => {
        const { date, findings } = parse("689/1/31", { field: "born" });
        expect(date).toBeNull();
        expect(findings.map((f) => f.severity)).toEqual(["error"]);
    });

    it("accepts a day the declared month length allows", () => {
        // Thirty days to the month, which is what the corpus writes: `667/2/30`
        // is a real value and a Gregorian table would refuse it.
        expect(parse("667/2/30").findings).toEqual([]);
        expect(parse("667/2/30").date?.day).toBe(30);
    });

    it("checks no upper bound a registry does not state", () => {
        // `M` declares no month structure, so there is nothing to check
        // against and a bound is dropped rather than guessed.
        expect(parse("1200/13/31 M").findings).toEqual([]);
        expect(parse("1200/13/31 M").date?.month).toBe(13);
    });

    it("refuses a day written with no month", () => {
        const { date, findings } = parse("689//19", { field: "born" });
        expect(date).toBeNull();
        expect(findings.map((f) => f.severity)).toEqual(["error"]);
    });

    it("refuses a year of zero or below, in any reckoning", () => {
        for (const bad of ["0", "0 BF", "0/6/19"]) {
            const { date, findings } = parse(bad);
            expect(date, `\`${bad}\` should not parse`).toBeNull();
            expect(findings.map((f) => f.severity)).toEqual(["error"]);
        }
    });

    it("warns on a `~` written to the day, and still parses it", () => {
        const { date, findings } = parse("~689/6/19", { field: "born" });
        expect(findings.map((f) => f.severity)).toEqual(["warning"]);
        expect(date?.approximate).toBe(true);
        expect(date?.precision).toBe("day");
        expect(date?.commonYear).toBe(689);
    });

    it("does not warn on a `~` written to the month or the year", () => {
        expect(parse("~689/6").findings).toEqual([]);
        expect(parse("~689").findings).toEqual([]);
    });

    it("names the value and drops a position it cannot establish", () => {
        const [finding] = parse("984 QF", {
            field: "died",
            file: "Characters/Meshara.md",
        }).findings;
        expect(finding.file).toBe("Characters/Meshara.md");
        expect(finding).not.toHaveProperty("line");
        expect(finding).not.toHaveProperty("column");
    });

    it("locates the value in the note that wrote it", () => {
        const raw = ["---", "type: being", "data:", "  died: 984 QF", "---", "", "Body."].join(
            "\n",
        );
        const [finding] = parse("984 QF", {
            field: "died",
            file: "Characters/Meshara.md",
            raw,
            keyPath: ["data", "died"],
        }).findings;
        expect(finding.line).toBe(4);
        expect(finding.column).toBe(9);
    });
});

describe("the default calendar", () => {
    it("applies silently, so a bare value is not a finding", () => {
        // Every populated value in the corpus is bare, and requiring the token
        // would turn a correct tree red over a convention it has always kept.
        const { date, findings } = parse("689/6/19");
        expect(findings).toEqual([]);
        expect(date?.calendar).toBe("AF");
    });

    it("leaves what was authored in `text`, token or none", () => {
        expect(parse("689/6/19").date?.text).toBe("689/6/19");
        expect(parse("689/6/19 AF").date?.text).toBe("689/6/19 AF");
    });
});

describe("a value with nothing to parse against", () => {
    it("says nothing about an absent value, because absence is a fact", () => {
        for (const nothing of [null, undefined]) {
            expect(parse(nothing)).toEqual({ date: null, findings: [] });
        }
    });

    it("refuses a value that is not a string or a number", () => {
        for (const bad of [true, {}, []]) {
            expect(parse(bad).findings.map((f) => f.severity)).toEqual(["error"]);
        }
    });

    it("refuses a bare value where no default is declared", () => {
        const { date, findings } = parseNoteDate("689", {
            calendars: { default: null, registry: calendars.registry },
            field: "born",
        });
        expect(date).toBeNull();
        expect(findings[0].message).toContain("declares no default");
    });

    it("refuses a default the registry does not declare", () => {
        const { date, findings } = parseNoteDate("689", {
            calendars: { default: "QF", registry: calendars.registry },
            field: "born",
        });
        expect(date).toBeNull();
        expect(findings[0].message).toContain("`calendars.registry` does not declare");
    });
});

describe("the abbreviation charset", () => {
    it("accepts the abbreviations the setting writes", () => {
        for (const abbreviation of Object.keys(calendars.registry)) {
            expect(isCalendarAbbreviation(abbreviation)).toBe(true);
        }
    });

    it("refuses anything a date string could not carry unambiguously", () => {
        for (const bad of ["", "1", "A1", "A F", "af-common", null, undefined, 12]) {
            expect(isCalendarAbbreviation(bad)).toBe(false);
        }
    });
});
