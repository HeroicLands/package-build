/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A `lore` note's recurring dates: the grammar's year-0 exception, the
 * arithmetic that finds an occurrence, and the findings that refuse a
 * malformed `recurs`.**
 */

import YAML from "yaml";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { canonicalYear, eraYear } from "../engine/calendars.mjs";
import { occurrencesOf, parseNoteDate, resolvedDateFields } from "../engine/note-dates.mjs";
import { checkLoreEvents } from "../engine/lore-events.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { openNotesDatabase, runSqlQuery } from "../engine/sql-tables.mjs";

/** A note as the link index hands one over, with a real frontmatter fence. */
function note(fm: Record<string, unknown>, file = "Note.md") {
    const raw = `---\n${YAML.stringify(fm)}---\n\nProse.\n`;
    return { file, raw, fm, type: String(fm.type ?? "") };
}

const opts = { schemas: NOTE_SCHEMAS as any, vocabulary: NOTE_VOCABULARY };
const messages = (findings: Array<{ message: string }>) => findings.map((f) => f.message);

describe("year 0 — any year", () => {
    it("is refused on every field except one that passes allowZeroYear", () => {
        const plain = parseNoteDate("0.5", { field: "died" });
        expect(plain.date).toBeNull();
        expect(plain.findings[0].message).toContain("writes year 0");
    });

    it("is accepted on the one field that passes allowZeroYear", () => {
        const { date, findings } = parseNoteDate("0.5", { allowZeroYear: true });
        expect(findings).toEqual([]);
        expect(date).toMatchObject({ known: true, year: 0, day: 5, canonicalDay: 5 });
    });

    it("carries no canonicalYear and no sort, so it cannot date its note", () => {
        const { date } = parseNoteDate("0.5", { allowZeroYear: true });
        expect(date).not.toHaveProperty("canonicalYear");
        expect(date).not.toHaveProperty("sort");
    });

    it("refuses negative zero even with allowZeroYear — it is not 'any year, backwards'", () => {
        const { date, findings } = parseNoteDate("-0.5", { allowZeroYear: true });
        expect(date).toBeNull();
        expect(findings[0].message).toContain("writes year 0");
    });

    it("refuses a bare 0 with no day, allowZeroYear or not — any year with no day names nothing", () => {
        for (const allowZeroYear of [false, true]) {
            const { date, findings } = parseNoteDate("0", { allowZeroYear });
            expect(date).toBeNull();
            expect(findings[0].message).toContain("writes year 0");
        }
    });
});

describe("occurrencesOf", () => {
    /** An anchor at a large negative canonical year, every 5 years. */
    const anchor = parseNoteDate("-15.5", { daysPerYear: 365 }).date as any;

    it("has a well-known negative canonical year to build the guard on", () => {
        expect(anchor.known).toBe(true);
        expect(anchor.canonicalYear).toBe(-14);
    });

    it("the lower bound: a year before the anchor by an exact multiple of the period matches nothing", () => {
        // `(90 - 100) % 10` is `0` in JavaScript — `%` takes the sign of its
        // dividend — so a bare modulo reads a year ten below the anchor as a
        // match. The guard is the `>=` comparison, proven here against a
        // fresh anchor at canonical year 100.
        const hundred = parseNoteDate("100.1", { daysPerYear: 365 }).date as any;
        expect(hundred.canonicalYear).toBe(100);
        expect((90 - 100) % 10).toBe(-0);
        expect(occurrencesOf(hundred, { every: 10 }, { from: 90, to: 90 })).toEqual([]);
        expect(occurrencesOf(hundred, { every: 10 }, { from: 100, to: 100 })).toHaveLength(1);
    });

    it("advances the canonical year across the epoch with no special case", () => {
        // Every step is exactly 5 years, including the one that crosses from
        // canonical -4 to 1 — there is no canonical year 0 to skip, so there
        // is nothing for a correct implementation to special-case.
        const series = occurrencesOf(anchor, { every: 5 }, { from: -14, to: 6 });
        expect(series.map((occ) => occ.canonicalYear)).toEqual([-14, -9, -4, 1, 6]);
    });

    it("counting in era-relative years instead fails — it loses a year crossing the epoch", () => {
        // The bug this guards against: converting the anchor to its
        // era-relative year, stepping *there*, and converting each step back
        // — composing the axis conversion in the wrong place. `eraYear` and
        // `canonicalYear` are the production functions; composed this way
        // they diverge from stepping `canonicalYear` directly once the
        // period has crossed the epoch more than once.
        const every = 5;
        const wrongAuthored = eraYear(anchor.canonicalYear) + 4 * every;
        const wrongCanonical = canonicalYear(wrongAuthored);
        const correct = occurrencesOf(anchor, { every }, { from: anchor.canonicalYear, to: 6 }).at(
            -1,
        )?.canonicalYear;
        expect(correct).toBe(6);
        expect(wrongCanonical).toBe(5);
        expect(wrongCanonical).not.toBe(correct);
    });

    it("`to` omitted answers 'next': the first occurrence at or after `from`", () => {
        expect(occurrencesOf(anchor, { every: 5 }, { from: 0 })).toEqual([
            { ...anchor, canonicalYear: 1 },
        ]);
        expect(occurrencesOf(anchor, { every: 5 }, {})).toEqual([anchor]);
    });

    it("`from` omitted answers the last occurrence at or before `to`, without enumerating the series", () => {
        expect(occurrencesOf(anchor, { every: 5 }, { to: 6 })).toEqual([
            { ...anchor, canonicalYear: 6 },
        ]);
        expect(occurrencesOf(anchor, { every: 5 }, { to: -15 })).toEqual([]);
    });

    it("carries precision, approximation and the day of year through untouched", () => {
        const dayPrecise = parseNoteDate("412.6", { daysPerYear: 365 }).date as any;
        const [occurrence] = occurrencesOf(dayPrecise, { every: 3 }, { from: 415, to: 415 });
        expect(occurrence).toMatchObject({
            canonicalYear: 415,
            canonicalDay: 6,
            precision: "day",
            approximate: false,
        });

        const approximate = parseNoteDate("~412", { daysPerYear: 365 }).date as any;
        const [approxOccurrence] = occurrencesOf(
            approximate,
            { every: 10 },
            { from: 422, to: 422 },
        );
        expect(approxOccurrence.approximate).toBe(true);

        // A short, five-day intercalary month: the anchor's day of year sits
        // inside it, and every occurrence recurs on that same day with no
        // special case for the month being short.
        const intercalary = parseNoteDate("412.366", { daysPerYear: 730 }).date as any;
        expect(occurrencesOf(intercalary, { every: 7 }, { from: 419, to: 419 })[0]).toMatchObject({
            canonicalYear: 419,
            canonicalDay: 366,
        });
    });

    it("an enumerated `on` series is a filter over its own dates, not an arithmetic one", () => {
        const when = parseNoteDate("412.1", { daysPerYear: 365 }).date as any;
        const on = ["689.5", "1203.9"].map(
            (value) => parseNoteDate(value, { daysPerYear: 365 }).date as any,
        );
        const series = { on };
        expect(occurrencesOf(when, series, { from: 1000 })).toEqual([on[1]]);
        expect(occurrencesOf(when, series, { to: 1000 })).toEqual([on[0]]);
        expect(occurrencesOf(when, series, { from: 2000 })).toEqual([]);
        expect(occurrencesOf(when, series, {})).toEqual([when]);
    });
});

describe("checkLoreEvents", () => {
    const calendar = { type: "lore", subType: "history", shortcode: "found" };

    it("recurs present with no when", () => {
        const n = note({ ...calendar, data: { events: [{ recurs: { every: 1 } }] } });
        const findings = checkLoreEvents(n, {});
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toContain("needs a `when`");
    });

    it("recurs declaring neither every nor on", () => {
        const n = note({ ...calendar, data: { events: [{ when: "412.1", recurs: {} }] } });
        expect(messages(checkLoreEvents(n, {}))[0]).toContain("needs `every` or `on`");
    });

    it("recurs declaring both every and on", () => {
        const n = note({
            ...calendar,
            data: { events: [{ when: "412.1", recurs: { every: 1, on: ["413.1"] } }] },
        });
        expect(messages(checkLoreEvents(n, {}))[0]).toContain("exactly one of `every` or `on`");
    });

    it("recurs.every not a whole number >= 1", () => {
        for (const bad of [0, -1, 1.5, "annual"]) {
            const n = note({
                ...calendar,
                data: { events: [{ when: "412.1", recurs: { every: bad } }] },
            });
            expect(messages(checkLoreEvents(n, {}))[0], String(bad)).toContain("`recurs.every`");
        }
    });

    it("an on entry at or before when", () => {
        const n = note({
            ...calendar,
            data: { events: [{ when: "412.1", recurs: { on: ["412.1"] } }] },
        });
        expect(messages(checkLoreEvents(n, {}))[0]).toContain("at or before `when`");
    });

    it("on entries out of order", () => {
        const n = note({
            ...calendar,
            data: { events: [{ when: "412.1", recurs: { on: ["413.1", "412.5"] } }] },
        });
        const found = messages(checkLoreEvents(n, {}));
        expect(found.some((m) => m.includes("not strictly increasing"))).toBe(true);
    });

    it("until present beside recurs.on", () => {
        const n = note({
            ...calendar,
            data: { events: [{ when: "412.1", until: "999.1", recurs: { on: ["413.1"] } }] },
        });
        const found = messages(checkLoreEvents(n, {}));
        expect(found.some((m) => m.includes("refused beside `recurs.on`"))).toBe(true);
    });

    it("recurs beside a when of year 0", () => {
        const n = note({ ...calendar, data: { events: [{ when: "0.5", recurs: { every: 1 } }] } });
        expect(messages(checkLoreEvents(n, {}))[0]).toContain("year 0");
    });

    it("until is allowed beside a when of year 0", () => {
        const n = note({ ...calendar, data: { events: [{ when: "0.5", until: "999.1" }] } });
        expect(checkLoreEvents(n, {})).toEqual([]);
    });

    it("positions a finding at the entry that carries the fault", () => {
        const n = note({
            ...calendar,
            data: {
                events: [{ when: "412.1" }, { when: "413.1", recurs: { every: 0 } }],
            },
        });
        const [finding] = checkLoreEvents(n, {});
        expect(finding.line).toBeGreaterThan(0);
        // The second entry's fault, not the first's — a position on the list
        // would land on the same line for either.
        const lines = n.raw.split("\n");
        const firstEntryLine = lines.findIndex((l) => l.includes("412.1"));
        expect(finding.line as number).toBeGreaterThan(firstEntryLine + 1);
    });

    it("recurs on a type declaring no occurrence family — the ordinary unknown-key finding", () => {
        const n = note({ type: "place", subType: "settlement", data: { recurs: { every: 1 } } });
        const findings = lintNote(n, opts);
        expect(
            findings.some(
                (f) =>
                    f.message.includes("not a `data:` property declared by place") &&
                    f.message.includes("recurs"),
            ),
        ).toBe(true);
    });

    it("recurs beside born or died — the same ordinary unknown-key finding", () => {
        const n = note({
            type: "being",
            name: { full: "Aran" },
            data: { born: "412.1", recurs: { every: 1 } },
        });
        const findings = lintNote(n, opts);
        expect(
            findings.some(
                (f) =>
                    f.message.includes("not a `data:` property declared by being") &&
                    f.message.includes("recurs"),
            ),
        ).toBe(true);
    });

    it("the retired container still written", () => {
        const n = note({
            ...calendar,
            data: { event: { kind: "founding", when: "412.1" } },
        });
        const findings = lintNote(n, opts);
        const retired = findings.find((f) => f.message.includes("`data.event`"));
        expect(retired).toBeDefined();
        expect(retired?.severity).toBe("error");
        expect(retired?.message).toContain("write `data.events`");
    });
});

describe("resolvedDateFields for lore events", () => {
    it("resolves when, until and a periodic recurs", () => {
        const fm = {
            type: "lore",
            shortcode: "found",
            data: {
                events: [{ when: "412.1", until: "612.1", recurs: { every: 1 } }],
            },
        };
        const resolved = resolvedDateFields(fm, { daysPerYear: 365 });
        expect(resolved.events).toHaveLength(1);
        const [entry] = resolved.events;
        expect(entry.when).toMatchObject({ canonicalYear: 412, canonicalDay: 1 });
        expect(entry.until).toMatchObject({ canonicalYear: 612 });
        expect(entry.recurs).toEqual({ every: 1, first: 412, last: 612 });
    });

    it("computes last from an enumeration's final entry, and never copies it from until", () => {
        const fm = {
            type: "lore",
            shortcode: "found",
            data: {
                events: [{ when: "412.1", recurs: { on: ["689.1", "1203.1"] } }],
            },
        };
        const resolved = resolvedDateFields(fm, { daysPerYear: 365 });
        expect(resolved.events[0].recurs.last).toBe(1203);
        expect(resolved.events[0].recurs.on).toHaveLength(2);
    });

    it("last is null where the series is live", () => {
        const fm = {
            type: "lore",
            shortcode: "found",
            data: { events: [{ when: "412.1", recurs: { every: 10 } }] },
        };
        const resolved = resolvedDateFields(fm, { daysPerYear: 365 });
        expect(resolved.events[0].recurs.last).toBeNull();
    });

    it("computes next against a declared present", () => {
        const fm = {
            type: "lore",
            shortcode: "found",
            data: { events: [{ when: "412.1", recurs: { every: 10 } }] },
        };
        const resolved = resolvedDateFields(fm, { daysPerYear: 365, present: "707.1" });
        expect(resolved.events[0].next).toMatchObject({ canonicalYear: 712 });
    });

    it("next is absent where the package declares no present", () => {
        const fm = {
            type: "lore",
            shortcode: "found",
            data: { events: [{ when: "412.1", recurs: { every: 10 } }] },
        };
        const resolved = resolvedDateFields(fm, { daysPerYear: 365 });
        expect(resolved.events[0]).not.toHaveProperty("next");
    });

    it("next is absent rather than null-filled where an until-bounded series has ended", () => {
        const fm = {
            type: "lore",
            shortcode: "found",
            data: { events: [{ when: "412.1", until: "500.1", recurs: { every: 10 } }] },
        };
        const resolved = resolvedDateFields(fm, { daysPerYear: 365, present: "707.1" });
        expect(resolved.events[0]).not.toHaveProperty("next");
    });

    it("computes a year-0 entry's next directly from the day of year, with no recurs record", () => {
        const fm = {
            type: "lore",
            shortcode: "found",
            data: { events: [{ when: "0.5" }] },
        };
        const beforeDay = resolvedDateFields(fm, { daysPerYear: 365, present: "707.2" });
        expect(beforeDay.events[0]).not.toHaveProperty("recurs");
        expect(beforeDay.events[0].next).toMatchObject({ canonicalYear: 707 });

        const afterDay = resolvedDateFields(fm, { daysPerYear: 365, present: "707.9" });
        expect(afterDay.events[0].next).toMatchObject({ canonicalYear: 708 });
    });

    it("a note's first entry stating a real year carries one, and a year-0 entry beside it does not", () => {
        const fm = {
            type: "lore",
            shortcode: "found",
            data: { events: [{ when: "0.5" }, { when: "412.1" }] },
        };
        const resolved = resolvedDateFields(fm, { daysPerYear: 365 });
        expect(resolved.events[0].when).not.toHaveProperty("canonicalYear");
        expect(resolved.events[1].when).toMatchObject({ canonicalYear: 412 });
    });
});

describe("the membership lower bound, mirrored in SQL", () => {
    // A flat `recurs.first` / `recurs.every` pair, standing in for the
    // columns a real `resolvedDates.events[].recurs` record carries — the
    // point under test is DuckDB's `%`, not the index's nesting.
    let db: any;
    beforeAll(async () => {
        db = await openNotesDatabase([
            {
                type: "lore",
                shortcode: "found",
                package: "sohl",
                name: { full: "The Founding" },
                address: { canonical: "sohl-lore-found", slug: "lore-found" },
                file: { path: "Lore/Founding.md", folder: "Lore", name: "Founding" },
                tags: [],
                recurs: { first: 100, every: 10 },
            },
        ]);
    }, 60_000);
    afterAll(async () => {
        await db?.close();
    });

    it("a bare modulo matches a year before the anchor by an exact multiple of the period", async () => {
        const { rows } = await runSqlQuery(
            db,
            "SELECT shortcode FROM notes WHERE (90 - recurs.first) % recurs.every = 0",
        );
        expect(rows).toHaveLength(1);
    });

    it("the lower bound guard excludes it", async () => {
        const { rows } = await runSqlQuery(
            db,
            "SELECT shortcode FROM notes " +
                "WHERE (90 - recurs.first) % recurs.every = 0 AND 90 >= recurs.first",
        );
        expect(rows).toHaveLength(0);
    });

    it("the guard admits a true member", async () => {
        const { rows } = await runSqlQuery(
            db,
            "SELECT shortcode FROM notes " +
                "WHERE (120 - recurs.first) % recurs.every = 0 AND 120 >= recurs.first",
        );
        expect(rows).toHaveLength(1);
    });
});
