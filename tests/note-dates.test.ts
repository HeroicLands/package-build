/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **One authored string, one parser, one record shape.**
 *
 * A date that normalises to the wrong integer is the failure nothing
 * downstream catches: the list still sorts, the page still prints, and five
 * people are a century out of place. So the worked table is the test rather
 * than an illustration, and every claim the format makes about a value — what
 * it prints as, what it orders by, what arithmetic it supports — is asserted
 * on the same row.
 *
 * **The conversion is piecewise on the sign**, which is what makes this guard
 * sharper than a table of positive years. Collapsed to a single branch it is
 * correct on one side of an epoch and off by one on the other, so the cases
 * below assert **adjacency across the epoch** — `canonicalYear(1)` less
 * `canonicalYear(-1)` is 1 — on the axis and on every era the fixture corpus
 * declares, so the branch is exercised against an epoch that is not the axis's
 * own.
 *
 * **The eras come from the fixture corpus, at runtime.** A second list written
 * out beside the table would be the thing that drifts: it would go on passing
 * while the corpus gained an era nothing here exercised. So the notes in
 * `tests/fixtures/eras` are read, their era rows collected and their epochs
 * derived through the parser itself — and an era the table never exercises
 * fails.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";
import YAML from "yaml";

import { CANONICAL_EPOCH, canonicalYear } from "../engine/calendars.mjs";
import { ERA_QUALIFIER_PATTERN, UNKNOWN_DATE, parseNoteDate } from "../engine/note-dates.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Twelve thirty-day months, which is what the corpora this parses for write. */
const CALENDAR = { months: 12, monthDays: 30 };

/** Parse against that structure, which is the only way this file parses. */
function parse(value: unknown, options: Record<string, unknown> = {}) {
    return parseNoteDate(value, { calendar: CALENDAR, ...options });
}

/**
 * Every era the fixture corpus declares, keyed as a date addresses it.
 *
 * The walk is the one the resolution pass will make: read each affiliation
 * note's `data.governance.eras`, key each row `<affiliation shortcode>.<era
 * shortcode>`, and take its epoch from its own `start` — which is parsed by
 * the parser under test, so a broken conversion cannot quietly supply a
 * correct epoch here.
 */
function fixtureEras(): Map<string, { name: string; start: string; epoch: number }> {
    const dir = path.join(HERE, "fixtures", "eras");
    const eras = new Map<string, { name: string; start: string; epoch: number }>();
    for (const file of fs.readdirSync(dir).sort()) {
        if (!file.endsWith(".md")) continue;
        const raw = fs.readFileSync(path.join(dir, file), "utf8");
        const fence = raw.match(/^---\n([\s\S]*?)\n---/);
        if (!fence) throw new Error(`${file} carries no frontmatter`);
        const note = YAML.parse(fence[1]) as {
            shortcode: string;
            data?: {
                governance?: { eras?: { shortcode: string; name: string; start: unknown }[] };
            };
        };
        for (const row of note.data?.governance?.eras ?? []) {
            const { date, findings } = parse(row.start);
            if (findings.length || !date) {
                throw new Error(`${file}: \`start: ${String(row.start)}\` does not parse`);
            }
            eras.set(`${note.shortcode}.${row.shortcode}`, {
                name: row.name,
                start: String(row.start),
                // An era's epoch is where its own year 1 sits on the axis.
                epoch: (date as { canonicalYear: number }).canonicalYear,
            });
        }
    }
    return eras;
}

const ERAS = fixtureEras();

/**
 * The worked table, row for row.
 *
 * `text` is what a page prints, `sort` is what a list orders by, and
 * `canonicalYear` is what arithmetic runs on — so every row states all three.
 */
const WORKED = [
    {
        authored: "689/6/19",
        record: {
            text: "689/6/19",
            known: true,
            era: null,
            year: 689,
            month: 6,
            day: 19,
            approximate: false,
            precision: "day",
            canonicalYear: 689,
            sort: 689.0619,
        },
    },
    {
        authored: "689/6",
        record: {
            text: "689/6",
            known: true,
            era: null,
            year: 689,
            month: 6,
            day: null,
            approximate: false,
            precision: "month",
            canonicalYear: 689,
            sort: 689.06,
        },
    },
    {
        authored: "-984",
        record: {
            text: "-984",
            known: true,
            era: null,
            year: -984,
            month: null,
            day: null,
            approximate: false,
            precision: "year",
            canonicalYear: -983,
            sort: -983,
        },
    },
    {
        authored: "~-984",
        record: {
            text: "~-984",
            known: true,
            era: null,
            year: -984,
            month: null,
            day: null,
            approximate: true,
            precision: "year",
            canonicalYear: -983,
            sort: -983,
        },
    },
    {
        authored: "~-2110",
        record: {
            text: "~-2110",
            known: true,
            era: null,
            year: -2110,
            month: null,
            day: null,
            approximate: true,
            precision: "year",
            canonicalYear: -2109,
            sort: -2109,
        },
    },
    {
        authored: "-5274",
        record: {
            text: "-5274",
            known: true,
            era: null,
            year: -5274,
            month: null,
            day: null,
            approximate: false,
            precision: "year",
            canonicalYear: -5273,
            sort: -5273,
        },
    },
    {
        authored: "-10000",
        record: {
            text: "-10000",
            known: true,
            era: null,
            year: -10000,
            month: null,
            day: null,
            approximate: false,
            precision: "year",
            canonicalYear: -9999,
            sort: -9999,
        },
    },
    {
        authored: 720,
        record: {
            text: "720",
            known: true,
            era: null,
            year: 720,
            month: null,
            day: null,
            approximate: false,
            precision: "year",
            canonicalYear: 720,
            sort: 720,
        },
    },
    {
        authored: "1",
        record: {
            text: "1",
            known: true,
            era: null,
            year: 1,
            month: null,
            day: null,
            approximate: false,
            precision: "year",
            canonicalYear: 1,
            sort: 1,
        },
    },
    {
        authored: "-1",
        record: {
            text: "-1",
            known: true,
            era: null,
            year: -1,
            month: null,
            day: null,
            approximate: false,
            precision: "year",
            canonicalYear: 0,
            sort: 0,
        },
    },
] as const;

/**
 * One row per era the setting keeps, written the way a note writes it.
 *
 * Hand-written on purpose: the set of eras is derived from the corpus at
 * runtime and compared against the set these rows exercise, so an era declared
 * and never written here fails rather than shipping unexercised.
 */
const ERA_WORKED = [
    { authored: "720 vylarinmpr.founding", era: "vylarinmpr.founding", year: 720, axis: 720 },
    { authored: "2830 empirtkhpr.septepy", era: "empirtkhpr.septepy", year: 2830, axis: 720 },
    {
        authored: "1200 trimurtisampradaya.madhavendra",
        era: "trimurtisampradaya.madhavendra",
        year: 1200,
        axis: 720,
    },
    {
        authored: "3 tanvurempr.flamingdragon",
        era: "tanvurempr.flamingdragon",
        year: 3,
        axis: 691,
    },
    { authored: "5 tanvurempr.zhuklung", era: "tanvurempr.zhuklung", year: 5, axis: 699 },
] as const;

/**
 * What the retired spelling wrote, and what writes it now.
 *
 * The retired arithmetic is restated here rather than imported, because that
 * is the claim: a registry entry of an epoch and a direction, two branches,
 * against one function and a sign. Every dated value the corpora carry is the
 * `AF` row with a positive year; every negative year the history records is a
 * `BF` row.
 */
const RETIRED = [
    { retired: { year: 720, epoch: 1, direction: "forward" }, authored: "720" },
    { retired: { year: 1, epoch: 1, direction: "forward" }, authored: "1" },
    { retired: { year: 689, epoch: 1, direction: "forward" }, authored: "689" },
    { retired: { year: 984, epoch: 0, direction: "backward" }, authored: "-984" },
    { retired: { year: 1, epoch: 0, direction: "backward" }, authored: "-1" },
    { retired: { year: 5274, epoch: 0, direction: "backward" }, authored: "-5274" },
    { retired: { year: 2427, epoch: 0, direction: "backward" }, authored: "-2427" },
    { retired: { year: 10000, epoch: 0, direction: "backward" }, authored: "-10000" },
    { retired: { year: 2110, epoch: 0, direction: "backward" }, authored: "-2110" },
    { retired: { year: 7300, epoch: 0, direction: "backward" }, authored: "-7300" },
    { retired: { year: 9280, epoch: 0, direction: "backward" }, authored: "-9280" },
    { retired: { year: 73, epoch: 0, direction: "backward" }, authored: "-73" },
    { retired: { year: 220, epoch: 1, direction: "forward" }, authored: "220" },
    { retired: { year: 520, epoch: 1, direction: "forward" }, authored: "520" },
] as const;

/** What a registry entry used to mean, as two branches on a declared direction. */
function retiredYear({
    year,
    epoch,
    direction,
}: {
    year: number;
    epoch: number;
    direction: string;
}): number {
    return direction === "backward" ? epoch - (year - 1) : epoch + (year - 1);
}

describe("the fixture corpus", () => {
    it("declares eras worth deriving from", () => {
        // Guards the guard: an empty or single-epoch corpus would let the
        // adjacency cases below pass without ever meeting an epoch of its own.
        expect(ERAS.size).toBeGreaterThan(3);
        const epochs = [...ERAS.values()].map(({ epoch }) => epoch);
        expect(epochs.filter((epoch) => epoch < 0).length).toBeGreaterThan(0);
        expect(epochs.filter((epoch) => epoch !== CANONICAL_EPOCH).length).toBeGreaterThan(2);
    });

    it("keys every era by an address a date can write", () => {
        for (const key of ERAS.keys()) {
            expect(ERA_QUALIFIER_PATTERN.test(key), key).toBe(true);
        }
    });
});

describe("the worked table", () => {
    for (const { authored, record } of WORKED) {
        it(`\`${authored}\` parses to the stated record`, () => {
            const { date, findings } = parse(authored);
            expect(findings).toEqual([]);
            expect(date).toEqual(record);
        });
    }
});

describe("adjacency across the epoch", () => {
    it("puts authored -1 immediately before authored 1 on the axis", () => {
        const before = parse("-1").date?.canonicalYear as number;
        const after = parse("1").date?.canonicalYear as number;
        expect(after - before).toBe(1);
    });

    it("walks the authored numbering onto the axis without a year zero", () => {
        const authored = [-3, -2, -1, 1, 2, 3];
        expect(authored.map((year) => parse(String(year)).date?.canonicalYear)).toEqual([
            -2, -1, 0, 1, 2, 3,
        ]);
    });

    for (const [key, { epoch, name }] of ERAS) {
        it(`puts -1 immediately before 1 in ${name} (\`${key}\`)`, () => {
            // The sign branch, met against an epoch that is not the axis's. A
            // conversion collapsed to one branch is right on one side of this
            // epoch and off by one on the other.
            expect(canonicalYear(1, epoch) - canonicalYear(-1, epoch)).toBe(1);
        });
    }

    it("has no epoch at which the two branches agree to collapse", () => {
        // Stated as the property rather than as a row, so a table that lost a
        // row cannot leave the claim untested.
        for (const epoch of [...ERAS.values()].map(({ epoch }) => epoch).concat(CANONICAL_EPOCH)) {
            expect(canonicalYear(1, epoch)).toBe(epoch);
            expect(canonicalYear(-1, epoch)).toBe(epoch - 1);
        }
    });
});

describe("equivalence with the retired spelling", () => {
    for (const { retired, authored } of RETIRED) {
        const spelling = `${retired.year} ${retired.direction === "backward" ? "BF" : "AF"}`;
        it(`\`${spelling}\` and \`${authored}\` are one year`, () => {
            expect(parse(authored).date?.canonicalYear).toBe(retiredYear(retired));
        });
    }

    it("leaves every bare value in the corpora where it was", () => {
        // Every dated value in every tree that authors one is a bare
        // `YYYY/MM/DD` in the range below, and each meant `AF` — `epoch: 1,
        // direction: forward`. Bare now means the axis, whose epoch is 1 by
        // definition, so the two arithmetics are the same function.
        for (let year = 412; year <= 1711; year += 1) {
            const value = `${year}/6/19`;
            expect(parse(value).date?.canonicalYear, value).toBe(
                retiredYear({ year, epoch: 1, direction: "forward" }),
            );
            expect(parse(value).date?.year, value).toBe(year);
        }
    });

    it("reads a table that spans both sides of the epoch", () => {
        // Guards the guard: rows on one side only would pass against a
        // single-branch conversion.
        const years = RETIRED.map(({ retired }) => retiredYear(retired));
        expect(years.some((year) => year > 0)).toBe(true);
        expect(years.some((year) => year < 0)).toBe(true);
    });
});

describe("a date written in an era", () => {
    for (const { authored, era, year } of ERA_WORKED) {
        it(`\`${authored}\` carries its qualifier and no guessed number`, () => {
            const { date, findings } = parse(authored);
            expect(findings).toEqual([]);
            expect(date).toEqual({
                text: authored,
                known: true,
                era,
                year,
                month: null,
                day: null,
                approximate: false,
                precision: "year",
            });
            // Absent, never null: a record carrying `known: true` beside a null
            // year and a null sort is the `unknown` record written twice, which
            // is the one confusion invisible in the output.
            expect(date).not.toHaveProperty("canonicalYear");
            expect(date).not.toHaveProperty("sort");
        });
    }

    for (const { authored, era, axis } of ERA_WORKED) {
        it(`\`${authored}\` lands on ${axis} once its era is resolved`, () => {
            const epoch = ERAS.get(era)?.epoch as number;
            const { year } = parse(authored).date as { year: number };
            expect(canonicalYear(year, epoch)).toBe(axis);
        });
    }

    it("exercises every era the corpus declares", () => {
        // The guard against the second list. An era added to the corpus and
        // never written into the table above would otherwise ship unexercised,
        // which a hand-copied list here would go on passing through.
        const exercised = new Set(ERA_WORKED.map(({ era }) => era));
        expect([...exercised].sort()).toEqual([...ERAS.keys()].sort());
    });

    it("takes a month and a day, and a year before the era began", () => {
        expect(parse("720/12/10 vylarinmpr.founding").date).toMatchObject({
            era: "vylarinmpr.founding",
            year: 720,
            month: 12,
            day: 10,
            precision: "day",
        });
        expect(parse("-5 tanvurempr.flamingdragon").date).toMatchObject({
            era: "tanvurempr.flamingdragon",
            year: -5,
        });
    });

    it("takes every address form the era grammar admits", () => {
        for (const qualifier of [
            "tanvurempr.flamingdragon",
            "affiliation-tanvurempr.flamingdragon",
            "none-affiliation-tanvurempr.flamingdragon",
            "thalorna-none-affiliation-tanvurempr.flamingdragon",
        ]) {
            expect(parse(`3 ${qualifier}`).date?.era, qualifier).toBe(qualifier);
        }
    });

    it("refuses a fifth address segment, which is no address form", () => {
        expect(parse("3 x-thalorna-none-affiliation-tanvurempr.flaming").date).toBeNull();
    });
});

describe("year zero", () => {
    // Every form it can be written in, bare and inside an era, each its own
    // case so a conversion that admits one of them names which.
    const FORMS = [
        "0",
        "-0",
        "0/6/19",
        "-0/6/19",
        "~0",
        "~-0",
        "0 vylarinmpr.founding",
        "-0 empirtkhpr.septepy",
        0,
    ];

    for (const bad of FORMS) {
        it(`refuses \`${bad}\``, () => {
            const { date, findings } = parse(bad, { field: "died" });
            expect(date).toBeNull();
            expect(findings.map((f) => f.severity)).toEqual(["error"]);
            expect(findings[0].message).toContain("writes year 0");
            expect(findings[0].message).toContain("the years either side of an epoch are -1 and 1");
        });
    }

    it("leaves the years either side of it alone", () => {
        expect(parse("-1").date?.year).toBe(-1);
        expect(parse("1").date?.year).toBe(1);
    });
});

describe("the retired trailing token", () => {
    it("refuses `984 BF` and names the replacement", () => {
        const { date, findings } = parse("984 BF", { field: "died" });
        expect(date).toBeNull();
        expect(findings.map((f) => f.severity)).toEqual(["error"]);
        expect(findings[0].message).toBe(
            "`died: 984 BF` names no era — a reckoning is written " +
                "`<affiliation shortcode>.<era shortcode>`, and a year before an era's " +
                "epoch is written negative: `-984`",
        );
    });

    it("refuses every dotless word, whatever it spells", () => {
        for (const bad of ["720 AF", "2830 ST", "1200 M", "689/6/19 AF"]) {
            const { date, findings } = parse(bad);
            expect(date, `\`${bad}\` should not parse`).toBeNull();
            expect(findings.map((f) => f.severity)).toEqual(["error"]);
            expect(findings[0].message).toContain("names no era");
        }
    });

    it("carries the month and the day into the replacement it names", () => {
        expect(parse("689/6/19 AF").findings[0].message).toContain("`-689/6/19`");
    });

    it("says something else when the token carries a dot it should not", () => {
        for (const bad of [
            "3 Tanvurempr.Flamingdragon",
            "3 tanvurempr..flaming",
            "984 .founding",
        ]) {
            const { date, findings } = parse(bad);
            expect(date, `\`${bad}\` should not parse`).toBeNull();
            expect(findings[0].message).toContain("lowercase letters and digits only");
        }
    });
});

describe("ordering", () => {
    it("sorts a year before the epoch below one after it", () => {
        expect(parse("-984").date?.sort as number).toBeLessThan(parse("-100").date?.sort as number);
        expect(parse("-1").date?.sort as number).toBeLessThan(parse("1").date?.sort as number);
    });

    it("sorts months and days forward inside a year before the epoch", () => {
        const year = parse("-984").date?.sort as number;
        const month = parse("-984/1").date?.sort as number;
        const later = parse("-984/6").date?.sort as number;
        const next = parse("-983").date?.sort as number;
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

    it("subtracts across the epoch without a special case", () => {
        // What `canonicalYear` is for: a life that begins before the epoch and
        // ends after it is one subtraction.
        const born = parse("-20").date?.canonicalYear as number;
        const died = parse("35").date?.canonicalYear as number;
        expect(died - born).toBe(54);
    });
});

describe("`unknown`", () => {
    it("is a value, not a failure", () => {
        const { date, findings } = parse(UNKNOWN_DATE);
        expect(findings).toEqual([]);
        expect(date).toEqual({
            text: "unknown",
            known: false,
            era: null,
            year: null,
            month: null,
            day: null,
            approximate: false,
            precision: null,
            canonicalYear: null,
            sort: null,
        });
    });

    it("carries no `canonicalYear` and no `sort`, so nothing orders it", () => {
        // Normalising it to 0 would sort the ancient dead into the year before
        // the epoch; letting a comparison default it would sort them beside the
        // living. Both are invisible in the output, which is why they are
        // asserted rather than reasoned about.
        const { date } = parse(UNKNOWN_DATE);
        expect(date?.canonicalYear).toBeNull();
        expect(date?.sort).toBeNull();
        expect(date?.canonicalYear).not.toBe(0);
        expect(date?.sort).not.toBe(0);
    });

    it("drops out of an ordering rather than landing at one end", () => {
        const values = ["-984", "unknown", "689"];
        const ordered = values
            .map((text) => ({ text, sort: parse(text).date?.sort }))
            .filter((row) => row.sort != null)
            .sort((a, b) => (a.sort as number) - (b.sort as number))
            .map(({ text }) => text);
        expect(ordered).toEqual(["-984", "689"]);
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
        for (const bad of [
            "hello",
            "689/",
            "689/6/19/4",
            "689 6 19",
            "689-6-19",
            "+689",
            "- 689",
            "2830 Sep Tepy",
            "984 BF.",
        ]) {
            const { date, findings } = parse(bad, { field: "died" });
            expect(date, `\`${bad}\` should not parse`).toBeNull();
            expect(findings.map((f) => f.severity)).toEqual(["error"]);
        }
    });

    it("refuses a month outside the year the package declares", () => {
        const { date, findings } = parse("689/13/1", { field: "born" });
        expect(date).toBeNull();
        expect(findings.map((f) => f.severity)).toEqual(["error"]);
        expect(findings[0].message).toContain("`born: 689/13/1`");
        expect(findings[0].message).toContain("`calendar.months`");
    });

    it("refuses a month or a day of zero, which no bound has to declare", () => {
        expect(parse("689/0/1").findings[0].message).toContain("a month is numbered from 1");
        expect(parse("689/1/0").findings[0].message).toContain("a day is numbered from 1");
    });

    it("refuses a day outside the month's length", () => {
        const { date, findings } = parse("689/1/31", { field: "born" });
        expect(date).toBeNull();
        expect(findings.map((f) => f.severity)).toEqual(["error"]);
        expect(findings[0].message).toContain("`calendar.monthDays`");
    });

    it("accepts a day the declared month length allows", () => {
        // Thirty days to the month, which is what the corpus writes: `667/2/30`
        // is a real value and a Gregorian table would refuse it.
        expect(parse("667/2/30").findings).toEqual([]);
        expect(parse("667/2/30").date?.day).toBe(30);
    });

    it("checks no upper bound the package does not state", () => {
        // A package declaring no `calendar` block bounds a month below and not
        // above, because a bound it never stated is one nothing could check.
        const bare = parseNoteDate("1200/13/31", {});
        expect(bare.findings).toEqual([]);
        expect(bare.date?.month).toBe(13);
    });

    it("refuses a day written with no month", () => {
        for (const bad of ["689//19", "-689//19"]) {
            const { date, findings } = parse(bad, { field: "born" });
            expect(date, bad).toBeNull();
            expect(findings[0].message).toContain("writes a day with no month");
        }
    });

    it("warns on a `~` written to the day, and still parses it", () => {
        const { date, findings } = parse("~689/6/19", { field: "born" });
        expect(findings.map((f) => f.severity)).toEqual(["warning"]);
        expect(date?.approximate).toBe(true);
        expect(date?.precision).toBe("day");
        expect(date?.canonicalYear).toBe(689);
    });

    it("does not warn on a `~` written to the month or the year", () => {
        expect(parse("~689/6").findings).toEqual([]);
        expect(parse("~689").findings).toEqual([]);
        expect(parse("~-689").findings).toEqual([]);
    });

    it("takes the `~` before the sign and not after it", () => {
        expect(parse("~-2500").date?.approximate).toBe(true);
        expect(parse("-~2500").date).toBeNull();
    });

    it("names the value and drops a position it cannot establish", () => {
        const [finding] = parse("984 BF", {
            field: "died",
            file: "Characters/Meshara.md",
        }).findings;
        expect(finding.file).toBe("Characters/Meshara.md");
        expect(finding).not.toHaveProperty("line");
        expect(finding).not.toHaveProperty("column");
    });

    it("locates the value in the note that wrote it", () => {
        const raw = ["---", "type: being", "data:", "  died: 984 BF", "---", "", "Body."].join(
            "\n",
        );
        const [finding] = parse("984 BF", {
            field: "died",
            file: "Characters/Meshara.md",
            raw,
            keyPath: ["data", "died"],
        }).findings;
        expect(finding.line).toBe(4);
        expect(finding.column).toBe(9);
    });
});

describe("a bare value", () => {
    it("is the canonical axis, silently", () => {
        // Every dated value in every tree that authors one is bare, and
        // requiring an era would turn four correct trees red over a convention
        // they have kept since they were written.
        const { date, findings } = parse("689/6/19");
        expect(findings).toEqual([]);
        expect(date?.era).toBeNull();
    });

    it("leaves what was authored in `text`", () => {
        expect(parse("689/6/19").date?.text).toBe("689/6/19");
        expect(parse("~-984").date?.text).toBe("~-984");
    });
});

describe("a value with nothing to parse", () => {
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
});
