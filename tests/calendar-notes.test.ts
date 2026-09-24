/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A calendar note, the world's own facts, and the one object emitted from
 * both.**
 *
 * The guards here divide in two. The **checks** hold a tree to what a calendar
 * may say: the months add up to the year the world keeps, the family is written
 * on a calendar and nowhere else, a world fact is written on a body, and a
 * package states one year and one moon.
 *
 * The **emitters** are held to what a consumer reads. Three of those guards are
 * derived rather than written out: the envelope is the definition, every day
 * boundary agrees with the total, and every key the vocabulary declares reaches
 * the definition — that last one by compiling with the key and without it, so a
 * branch nobody wrote fails here rather than shipping.
 *
 * What none of them proves is schema conformance itself. This package carries
 * no Foundry stubs by design, so a `CalendarData` cannot be constructed here;
 * the consumer build and the Foundry container prove that half.
 */

import YAML from "yaml";
import { describe, it, expect } from "vitest";

import {
    CALENDAR_FIELDS,
    calendariaEnvelope,
    checkCalendarNote,
    checkWorldFacts,
    compileCalendar,
    compileCalendars,
    quarterDays,
    worldInvariants,
} from "../engine/calendar-notes.mjs";
import { daysInYear, monthStarts } from "../engine/calendars.mjs";

/**
 * The core fields a calendar definition must carry.
 *
 * Read off `client/data/calendar.mjs`'s `defineSchema`: each is `required` and
 * either non-nullable or carries no initial, so a definition omitting one
 * reaches validation with nothing to fall back on. `months`, `days` and
 * `seasons` are collections and are named by their `values` array.
 */
const COMPULSORY_CORE = [
    "name",
    "years.yearZero",
    "years.firstWeekday",
    "months.values",
    "days.values",
    "days.daysPerYear",
    "days.hoursPerDay",
    "days.minutesPerHour",
    "days.secondsPerMinute",
] as const;

/** Read a dotted path out of an emitted definition. */
function at(object: unknown, path: string): unknown {
    return path
        .split(".")
        .reduce<unknown>(
            (held, key) =>
                held && typeof held === "object" ?
                    (held as Record<string, unknown>)[key]
                :   undefined,
            object,
        );
}

/** A note as the link index hands one over: parsed frontmatter beside its text. */
function note(fm: Record<string, unknown>, file = "Calendar.md") {
    const raw = `---\n${YAML.stringify(fm)}---\n\nProse.\n`;
    return { file, rel: file, fm, raw, body: "Prose.", type: String(fm.type ?? "") };
}

/** Twelve months of the Common Calendar's lengths, summing to 365. */
const COMMON_MONTHS = [30, 31, 30, 31, 30, 31, 30, 30, 31, 30, 31, 30].map((days, i) => ({
    name: `Month ${i + 1}`,
    abbreviation: `M${i + 1}`,
    days,
}));

/** The world note every case below is compiled against. */
function worldNote(data: Record<string, unknown> = {}) {
    return note(
        {
            type: "place",
            subType: "world",
            shortcode: "worldthlrn",
            name: { full: "The World of Thalorna" },
            data: {
                year: { days: 365, hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60 },
                present: "720",
                ...data,
            },
        },
        "World.md",
    );
}

/** The moon note, with the orbit and the cycle the world's own note states. */
function moonNote(data: Record<string, unknown> = {}) {
    return note(
        {
            type: "place",
            subType: "world",
            shortcode: "vaelith",
            name: { full: "Vaelith" },
            data: {
                body: {
                    diameterKm: 3800,
                    orbitalRadiusKm: 388600,
                    orbit: "circular",
                    inclined: true,
                },
                moon: { cycle: 30, newOn: "720/1/1", eclipses: "rare" },
                ...data,
            },
        },
        "Vaelith.md",
    );
}

/** A calendar note, with whatever `data:` a case is about. */
function calendarNote(data: Record<string, unknown> = {}, file = "Common_Calendar.md") {
    return note(
        {
            type: "lore",
            subType: "calendar",
            shortcode: "commoncal",
            name: { full: "The Common Calendar" },
            description: "The reckoning eight polities keep.",
            data: { epoch: "720/1/1", months: COMMON_MONTHS, ...data },
        },
        file,
    );
}

/** The link index, as far as any of this reads one. */
function index(...notes: ReturnType<typeof note>[]) {
    return { notes };
}

/* --------------------------------------------------------------------- */
/*  The guard that is the only arithmetic                                 */
/* --------------------------------------------------------------------- */

describe("the months sum to the year the world keeps", () => {
    it("says nothing about a list that describes the world", () => {
        const calendar = calendarNote();
        expect(checkCalendarNote(calendar, { index: index(worldNote(), calendar) })).toEqual([]);
    });

    it("refuses a list that does not, naming the world rather than the addition", () => {
        const short = calendarNote({
            months: Array.from({ length: 12 }, (_, i) => ({ name: `Month ${i + 1}`, days: 30 })),
        });
        const findings = checkCalendarNote(short, { index: index(worldNote(), short) });
        expect(findings.map((f) => f.severity)).toEqual(["error"]);
        expect(findings[0].message).toBe(
            "`data.months` sums to 360, and the year is 365 days — a calendar names " +
                "the same days differently, it does not keep a different number of them",
        );
    });

    it("is positioned on the list, because nothing says which entry was mistyped", () => {
        const short = calendarNote({
            months: [...COMMON_MONTHS.slice(0, 11), { name: "Month 12", days: 29 }],
        });
        const [finding] = checkCalendarNote(short, { index: index(worldNote(), short) });
        expect(finding.file).toBe("Common_Calendar.md");
        const line = short.raw.split("\n")[finding.line - 1];
        expect(line).toContain("months:");
    });

    it("checks no sum where the package states no year", () => {
        // A package with no world note has no calendar mechanism, which is the
        // right answer for a package building somebody else's setting.
        const short = calendarNote({ months: [{ name: "Month 1", days: 10 }] });
        expect(checkCalendarNote(short, { index: index(short) })).toEqual([]);
    });

    it("checks no sum where the calendar states no months", () => {
        const bare = calendarNote({ months: undefined });
        const findings = checkCalendarNote(bare, { index: index(worldNote(), bare) });
        expect(findings.map((f) => f.message)).toEqual([
            "a calendar divides the year and says where the count begins, so this " +
                "note must state `data.months`",
        ]);
    });

    it("counts a short month as the days it holds, wherever it sits in the list", () => {
        const khazryn = calendarNote(
            {
                months: [
                    ...Array.from({ length: 12 }, (_, i) => ({ name: `Month ${i + 1}`, days: 30 })),
                    { name: "Hamaspathmaedaya", days: 5 },
                ],
            },
            "Khazryn_Calendar.md",
        );
        expect(checkCalendarNote(khazryn, { index: index(worldNote(), khazryn) })).toEqual([]);
    });
});

/* --------------------------------------------------------------------- */
/*  What may write the family, and where                                  */
/* --------------------------------------------------------------------- */

describe("the family belongs to a calendar note and to no other lore note", () => {
    it("requires a calendar to state its months and its epoch", () => {
        const bare = note({
            type: "lore",
            subType: "calendar",
            shortcode: "khazryncal",
            name: { full: "The Khazryn Calendar" },
        });
        expect(
            checkCalendarNote(bare, { index: index(worldNote(), bare) }).map((f) => f.message),
        ).toEqual([
            "a calendar divides the year and says where the count begins, so this " +
                "note must state `data.months`",
            "a calendar divides the year and says where the count begins, so this " +
                "note must state `data.epoch`",
        ]);
    });

    it("refuses every family key on a lore note of another genre", () => {
        const history = note({
            type: "lore",
            subType: "history",
            shortcode: "vylarinfnd",
            name: { full: "The Founding" },
            data: { epoch: "720/1/1", months: COMMON_MONTHS, eras: [] },
        });
        const findings = checkCalendarNote(history, { index: index(worldNote(), history) });
        expect(findings.map((f) => f.severity)).toEqual(["error", "error", "error"]);
        expect(findings[0].message).toContain("`data.epoch` is a calendar's");
        expect(findings[0].message).toContain("`subType` is not `calendar`");
    });

    it("says nothing about a lore note that writes none of it", () => {
        const history = note({
            type: "lore",
            subType: "history",
            shortcode: "vylarinfnd",
            name: { full: "The Founding" },
        });
        expect(checkCalendarNote(history, { index: index(worldNote(), history) })).toEqual([]);
    });

    it("asks nothing of a note that is not lore", () => {
        expect(checkCalendarNote(worldNote(), { index: index(worldNote()) })).toEqual([]);
    });

    it("refuses two eras of one calendar sharing a shortcode", () => {
        const twice = calendarNote({
            eras: [
                { shortcode: "founding", name: "After the Founding", start: 1 },
                { shortcode: "founding", name: "After the Refounding", start: 400 },
            ],
        });
        const findings = checkCalendarNote(twice, { index: index(worldNote(), twice) });
        expect(findings.map((f) => f.severity)).toEqual(["error"]);
        expect(findings[0].message).toContain('already counts an era called "founding"');
    });

    it("refuses an era row that states no shortcode to address it by", () => {
        const unnamed = calendarNote({ eras: [{ name: "After the Founding", start: 1 }] });
        const findings = checkCalendarNote(unnamed, { index: index(worldNote(), unnamed) });
        expect(findings[0].message).toContain("`<calendar shortcode>.<era shortcode>`");
    });
});

describe("a world fact is written on a body", () => {
    it("says nothing about a world note that states its own year", () => {
        expect(checkWorldFacts(worldNote(), { index: index(worldNote()) })).toEqual([]);
    });

    it("accepts a celestial body, which is the subType for what is only observed", () => {
        const sun = note({
            type: "place",
            subType: "celestial",
            shortcode: "solthlrn",
            name: { full: "The Sun" },
            data: { body: { diameterKm: 1390000, orbit: "circular", inclined: false } },
        });
        expect(checkWorldFacts(sun, { index: index(worldNote(), sun) })).toEqual([]);
    });

    it("refuses a world fact on a place inside a world", () => {
        const region = note({
            type: "place",
            subType: "region",
            shortcode: "ankaris",
            name: { full: "Ankaris" },
            data: { year: { days: 365 } },
        });
        const findings = checkWorldFacts(region, { index: index(region) });
        expect(findings.map((f) => f.severity)).toEqual(["error"]);
        expect(findings[0].message).toContain("this is a region within one");
    });

    it("refuses two notes stating a year, because two years is two settings", () => {
        const second = worldNote();
        const other = note(
            {
                type: "place",
                subType: "world",
                shortcode: "worldother",
                name: { full: "Another World" },
                data: { year: { days: 300 } },
            },
            "Other.md",
        );
        const findings = checkWorldFacts(second, { index: index(second, other) });
        expect(findings.map((f) => f.severity)).toEqual(["error"]);
        expect(findings[0].message).toContain("a package states one year");
        expect(findings[0].message).toContain("Other.md");
    });

    it("refuses a moon with no year to be measured against, naming the year", () => {
        const moon = moonNote();
        const findings = checkWorldFacts(moon, { index: index(moon) });
        expect(findings.map((f) => f.severity)).toEqual(["error"]);
        expect(findings[0].message).toContain("no note in this package states `data.year`");
    });

    it("accepts a moon beside a year", () => {
        expect(checkWorldFacts(moonNote(), { index: index(worldNote(), moonNote()) })).toEqual([]);
    });

    it("reads the present through the parser a note's dates go through", () => {
        const wrong = worldNote({ present: "midsummer" });
        const findings = checkWorldFacts(wrong, { index: index(wrong) });
        expect(findings.map((f) => f.severity)).toEqual(["error"]);
        expect(findings[0].message).toContain("is not a date");
    });

    it("refuses `unknown` as a present, because a setting has one", () => {
        const wrong = worldNote({ present: "unknown" });
        expect(checkWorldFacts(wrong, { index: index(wrong) })[0].message).toContain(
            "`data.present: unknown`",
        );
    });
});

/* --------------------------------------------------------------------- */
/*  What a package with no world note does                                */
/* --------------------------------------------------------------------- */

describe("a package that states no year has no calendar mechanism", () => {
    it("reads no invariants out of a tree that declares none", () => {
        expect(worldInvariants(index()).year).toBeNull();
        expect(worldInvariants(undefined).year).toBeNull();
    });

    it("compiles no calendars and reports nothing", () => {
        const calendar = calendarNote();
        expect(compileCalendars(index(calendar)).calendars).toEqual([]);
    });

    it("compiles every calendar a tree with a year declares", () => {
        const calendar = calendarNote();
        const second = calendarNote({}, "Khazryn_Calendar.md");
        const { calendars } = compileCalendars(index(worldNote(), calendar, second), {
            contentPackage: "thalorna",
        });
        expect(calendars).toHaveLength(2);
        expect(calendars[0].metadata.author).toBe("thalorna");
    });
});

/* --------------------------------------------------------------------- */
/*  What the emitters produce                                             */
/* --------------------------------------------------------------------- */

describe("the definition core reads", () => {
    const invariants = worldInvariants(index(worldNote(), moonNote()));
    const definition = compileCalendar({
        note: calendarNote(),
        invariants,
        contentPackage: "thalorna",
    });

    it("writes every compulsory core field", () => {
        for (const path of COMPULSORY_CORE) {
            expect(at(definition, path), path).toBeDefined();
        }
    });

    it("takes the year's length and the day's divisions from the world note", () => {
        expect(definition.days.daysPerYear).toBe(365);
        expect(definition.days.hoursPerDay).toBe(24);
        expect(definition.days.minutesPerHour).toBe(60);
        expect(definition.days.secondsPerMinute).toBe(60);
    });

    it("states that there is no leap rule, and writes no month a second length", () => {
        expect(definition.years.leapYear).toBeNull();
        for (const month of definition.months.values) {
            expect(Object.keys(month)).not.toContain("leapDays");
        }
    });

    it("carries the months in order, each with its name, its position and its length", () => {
        expect(definition.months.values.map((m: { ordinal: number }) => m.ordinal)).toEqual(
            COMMON_MONTHS.map((_, i) => i + 1),
        );
        expect(definition.months.values.map((m: { days: number }) => m.days)).toEqual(
            COMMON_MONTHS.map((m) => m.days),
        );
        expect(definition.months.values[0].abbreviation).toBe("M1");
    });

    it("marks a month shorter than the rest as the days outside the months", () => {
        const khazryn = compileCalendar({
            note: calendarNote({
                months: [
                    ...Array.from({ length: 12 }, (_, i) => ({ name: `Month ${i + 1}`, days: 30 })),
                    { name: "Hamaspathmaedaya", days: 5 },
                ],
            }),
            invariants,
        });
        expect(khazryn.months.values.at(-1).type).toBe("intercalary");
        expect(khazryn.months.values[0].type).toBeUndefined();
    });

    it("carries no weekday where the calendar names none", () => {
        // Core's `days.values` is an `ArrayField` with the default `min: 0`, so
        // an empty list validates; `dayOfWeek` is derived from it and read by
        // nothing in core.
        expect(definition.days.values).toEqual([]);
        expect(definition.years.firstWeekday).toBe(0);
    });

    it("carries the weekdays where it names some", () => {
        const weekly = compileCalendar({
            note: calendarNote({
                weekdays: [{ name: "Oneday", abbreviation: "On" }, { name: "Twoday" }],
            }),
            invariants,
        });
        expect(weekly.days.values).toEqual([
            { name: "Oneday", abbreviation: "On", ordinal: 1 },
            { name: "Twoday", ordinal: 2 },
        ]);
    });

    it("puts the epoch's year where a reader is shown the world's zero", () => {
        expect(definition.years.yearZero).toBe(720);
        expect(definition.epochDayOffset).toBe(0);
    });
});

describe("what the definition adds for Calendaria, and core prunes", () => {
    const invariants = worldInvariants(index(worldNote(), moonNote()));

    it("keys the eras by shortcode and drops the addressing segments", () => {
        const definition = compileCalendar({
            note: calendarNote({
                eras: [
                    {
                        shortcode: "founding",
                        name: "After the Founding",
                        abbreviation: "AF",
                        proclaimedBy: "vylarinmpr",
                        start: 1,
                    },
                ],
            }),
            invariants,
        });
        expect(definition.eras).toEqual({
            founding: { name: "After the Founding", abbreviation: "AF", start: "1" },
        });
    });

    it("writes the moon from the moon's note, and says nothing it was not told", () => {
        const definition = compileCalendar({ note: calendarNote(), invariants });
        expect(definition.moons).toEqual({
            Vaelith: {
                name: "Vaelith",
                cycleLength: 30,
                referenceDate: { year: 720, month: 1, day: 1 },
                cycleVariance: 0,
                phaseMode: "fixed",
                eclipseMode: "rare",
                nodalPeriod: null,
            },
        });
    });

    it("emits no moon for a setting that has none", () => {
        const definition = compileCalendar({
            note: calendarNote(),
            invariants: worldInvariants(index(worldNote())),
        });
        expect(definition.moons).toBeUndefined();
    });
});

describe("the envelope a Calendaria import reads", () => {
    it("carries the definition and nothing else, byte for byte", () => {
        const definition = compileCalendar({
            note: calendarNote(),
            invariants: worldInvariants(index(worldNote(), moonNote())),
            contentPackage: "thalorna",
        });
        const envelope = calendariaEnvelope(definition, {
            version: "1.2.3",
            exportedAt: "2026-01-01T00:00:00.000Z",
        });
        expect(JSON.stringify(envelope.calendarData)).toBe(JSON.stringify(definition));
        expect(Object.keys(envelope)).toEqual([
            "version",
            "exportedAt",
            "settings",
            "calendarData",
        ]);
        expect(envelope.settings).toEqual({});
    });
});

/* --------------------------------------------------------------------- */
/*  The derived guards                                                    */
/* --------------------------------------------------------------------- */

describe("every day boundary agrees with the total", () => {
    it("opens each month where walking the year puts it", () => {
        const definition = compileCalendar({
            note: calendarNote(),
            invariants: worldInvariants(index(worldNote())),
        });
        const lengths = definition.months.values.map((m: { days: number }) => m.days);
        let day = 1;
        for (const [position, start] of monthStarts(
            lengths.map((days: number) => ({ days })),
        ).entries()) {
            expect(start, `month ${position + 1}`).toBe(day);
            day += lengths[position];
        }
        // The sum read as a total, which is the same statement from the far end.
        expect(day - 1).toBe(definition.days.daysPerYear);
    });

    it("walks a short month sitting in the middle of the list", () => {
        const months = [
            { name: "Aran", days: 30 },
            { name: "Hamaspath", days: 5 },
            ...Array.from({ length: 11 }, (_, i) => ({ name: `Month ${i + 3}`, days: 30 })),
        ];
        expect(daysInYear(months)).toBe(365);
        expect(monthStarts(months).slice(0, 4)).toEqual([1, 31, 36, 66]);
    });
});

describe("every key the vocabulary declares reaches the definition", () => {
    const invariants = worldInvariants(index(worldNote(), moonNote()));
    /** A note writing every key the family declares, so nothing is untested. */
    const full = {
        epoch: "720/1/1",
        months: COMMON_MONTHS,
        weekdays: [{ name: "Oneday", abbreviation: "On" }],
        seasons: [{ name: "Spring", monthStart: 1, monthEnd: 3 }],
        eras: [{ shortcode: "founding", name: "After the Founding", abbreviation: "AF", start: 1 }],
    };

    it("writes the family out at runtime rather than from a second list", () => {
        // Guards the guard: a key added to the vocabulary with no value here
        // would make every comparison below compare two identical objects.
        expect(Object.keys(full).sort()).toEqual(
            CALENDAR_FIELDS.map((field: { name: string }) => field.name).sort(),
        );
    });

    for (const field of CALENDAR_FIELDS as readonly { name: string }[]) {
        it(`changes the definition when \`data.${field.name}\` is dropped`, () => {
            const withIt = compileCalendar({ note: calendarNote(full), invariants });
            const without = { ...full, [field.name]: undefined };
            const withoutIt = compileCalendar({ note: calendarNote(without), invariants });
            expect(JSON.stringify(withoutIt)).not.toBe(JSON.stringify(withIt));
        });
    }
});

describe("the four days the year turns on", () => {
    it("falls out of the year's length, with no physical constant consumed", () => {
        expect(quarterDays(365)).toEqual([1, 92, 184, 275]);
    });

    it("lands each of them on the first of a month of the Common Calendar", () => {
        const starts = monthStarts(COMMON_MONTHS);
        for (const quarter of quarterDays(365)) expect(starts).toContain(quarter);
    });
});
