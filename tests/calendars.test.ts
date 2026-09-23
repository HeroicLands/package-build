/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **The calendar registry, and the contract that declares it.**
 *
 * A reckoning is data. Nothing in the toolchain names one, so a setting that
 * keeps a fifth count of years declares it in `calendars:` and every date
 * written in it parses — which is only true while the declaration is validated
 * where it is written rather than discovered by a build that stamps nothing.
 *
 * The cases below are about that declaration: what a reckoning must state, what
 * it may leave out, and what an epoch and a direction buy once both are stated.
 */

import { describe, it, expect } from "vitest";

import { defineConfig } from "../content-config.mjs";
import {
    CALENDAR_DIRECTIONS,
    astronomicalYear,
    calendarStructure,
    dateSortKey,
    unknownCalendarMessage,
} from "../engine/calendars.mjs";

/** A minimal configuration, with whatever `calendars:` a case is about. */
function build(calendars?: unknown) {
    return defineConfig({
        rootDir: "/repo",
        contentPackage: "acme",
        foundryPackage: "acme",
        packageKind: "systems",
        stats: { lastModifiedBy: "acmebuilder0000" },
        packs: [{ name: "items", type: "Item" }],
        ...(calendars === undefined ? {} : { calendars }),
    });
}

/** A registry of one, so a case states only what it is about. */
function registry(spec: Record<string, unknown> = {}) {
    return { AF: { name: "After the Founding", epoch: 1, direction: "forward", ...spec } };
}

describe("a package that declares no calendars", () => {
    it("resolves an empty registry and no default", () => {
        // Most packages date nothing, and a resolved shape that is always there
        // is what keeps every reader from testing for the block first.
        expect(build().calendars).toEqual({ default: null, registry: {} });
    });

    it("is frozen, so a reckoning cannot be added by writing to the registry", () => {
        const { calendars } = build({ default: "AF", registry: registry() });
        expect(Object.isFrozen(calendars)).toBe(true);
        expect(Object.isFrozen(calendars.registry)).toBe(true);
        expect(Object.isFrozen(calendars.registry.AF)).toBe(true);
    });
});

describe("what a reckoning must state", () => {
    it("takes a name, an epoch and a direction", () => {
        const { calendars } = build({ default: "AF", registry: registry() });
        expect(calendars.default).toBe("AF");
        expect(calendars.registry.AF).toEqual({
            name: "After the Founding",
            epoch: 1,
            direction: "forward",
            months: null,
            monthDays: null,
        });
    });

    it("refuses an epoch that is not an integer", () => {
        // The epoch is a year, and a fractional or absent one would convert
        // every date written in the reckoning to a number nobody can read.
        for (const epoch of [undefined, null, "1", 1.5]) {
            expect(() => build({ registry: registry({ epoch }) })).toThrow(
                /`calendars\.registry\.AF\.epoch` must be an integer/,
            );
        }
    });

    it("takes a negative epoch, which is how a later reckoning states its own year 1", () => {
        const { calendars } = build({
            registry: { ST: { name: "Sep Tepy", epoch: -2109, direction: "forward" } },
        });
        expect(calendars.registry.ST.epoch).toBe(-2109);
    });

    it("refuses a direction outside the two", () => {
        expect(() => build({ registry: registry({ direction: "backwards" }) })).toThrow(
            /`calendars\.registry\.AF\.direction` must be one of: forward, backward/,
        );
        // Guards the guard: a set that lost a member would make the refusal
        // above pass while accepting less than the contract says it accepts.
        expect([...CALENDAR_DIRECTIONS].sort()).toEqual(["backward", "forward"]);
    });

    it("refuses an abbreviation a date string could not carry", () => {
        for (const bad of ["after-founding", "A F", "AF1", ""]) {
            expect(() => build({ registry: { [bad]: registry().AF } })).toThrow(
                /`calendars\.registry` declares/,
            );
        }
    });

    it("refuses a key it does not recognise", () => {
        expect(() => build({ registry: registry({ leapYears: 4 }) })).toThrow(
            /`calendars\.registry\.AF\.leapYears` is not a recognized option/,
        );
        expect(() => build({ registry: registry(), era: "x" })).toThrow(
            /`calendars\.era` is not a recognized option/,
        );
    });

    it("requires a registry once the block is written at all", () => {
        expect(() => build({ default: "AF" })).toThrow(/`calendars\.registry` must be a mapping/);
    });
});

describe("the month structure", () => {
    it("is optional, and states nothing when omitted", () => {
        const { calendars } = build({ registry: registry() });
        expect(calendarStructure(calendars.registry.AF)).toEqual({
            months: null,
            monthDays: null,
        });
    });

    it("is carried through when declared", () => {
        const { calendars } = build({ registry: registry({ months: 12, monthDays: 30 }) });
        expect(calendarStructure(calendars.registry.AF)).toEqual({ months: 12, monthDays: 30 });
    });

    it("refuses a bound that is not a positive integer", () => {
        for (const months of [0, -1, 12.5, "12"]) {
            expect(() => build({ registry: registry({ months }) })).toThrow(
                /`calendars\.registry\.AF\.months` must be a positive integer/,
            );
        }
        expect(() => build({ registry: registry({ monthDays: 0 }) })).toThrow(
            /`calendars\.registry\.AF\.monthDays` must be a positive integer/,
        );
    });
});

describe("the default", () => {
    it("may be left out, so every date names its own reckoning", () => {
        expect(build({ registry: registry() }).calendars.default).toBeNull();
    });

    it("must name something the registry declares", () => {
        // A default nobody registered would apply silently to every bare value
        // and resolve to nothing, which is the plausible lie this refuses.
        expect(() => build({ default: "QF", registry: registry() })).toThrow(
            /`calendars\.default` names `QF`, which `calendars\.registry` does not declare\. Declared: AF/,
        );
        expect(() => build({ default: "QF", registry: {} })).toThrow(/the registry is empty/);
        // An ordinary object carries `toString`, so a bare `in` would accept it
        // as a reckoning and hand the parser a function.
        expect(() => build({ default: "toString", registry: registry() })).toThrow(
            /`calendars\.default` names `toString`/,
        );
    });
});

describe("the arithmetic", () => {
    it("puts a forward reckoning's year 1 at its epoch", () => {
        const spec = { epoch: -2109, direction: "forward" };
        expect(astronomicalYear(1, spec)).toBe(-2109);
        expect(astronomicalYear(2830, spec)).toBe(720);
    });

    it("counts a backward reckoning towards its epoch", () => {
        const spec = { epoch: 0, direction: "backward" };
        expect(astronomicalYear(1, spec)).toBe(0);
        expect(astronomicalYear(984, spec)).toBe(-983);
        // A larger written year is an earlier year, which is the whole reason
        // the direction is declared rather than inferred from the sign.
        expect(astronomicalYear(984, spec)).toBeLessThan(astronomicalYear(100, spec));
    });

    it("folds month and day into a sort key without losing the year", () => {
        expect(dateSortKey(689, 6, 19)).toBe(689.0619);
        expect(dateSortKey(689, 6, null)).toBe(689.06);
        expect(dateSortKey(689, null, null)).toBe(689);
        expect(dateSortKey(-983, 6, null)).toBe(-982.94);
    });
});

describe("the unregistered-abbreviation message", () => {
    it("lists what is registered, read from the registry it is about", () => {
        const { calendars } = build({
            default: "AF",
            registry: {
                ...registry(),
                BF: { name: "Before the Founding", epoch: 0, direction: "backward" },
            },
        });
        const message = unknownCalendarMessage("QF", calendars.registry);
        expect(message).toContain('names calendar "QF"');
        expect(message).toContain("registered: AF, BF");
    });

    it("says so when nothing is registered, rather than trailing off", () => {
        expect(unknownCalendarMessage("QF", {})).toContain("no calendar is registered");
    });
});
