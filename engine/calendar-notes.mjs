/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A calendar is a note, the world's facts are a note, and one object is
 * emitted from both.**
 *
 * ## Two layers, and the whole arrangement is the distinction
 *
 * A **world fact** is how long the year is, how the day divides, and how the
 * moon moves. Every people on the world lives under the same ones, so no
 * calendar may restate them: they are read from the package's `place` notes —
 * `data.year` and `data.present` from the world, `data.moon` from the moon —
 * and written by the emitters.
 *
 * A **calendar** is one people's division of those days: the months they name,
 * the weekdays if they keep any, the seasons they mark, and the eras they count
 * years in. That is a `lore` note with `subType: calendar`, and its whole
 * authorable surface is {@link CALENDAR_FIELDS}.
 *
 * Because the invariants are unauthorable, **the sum guard is the only
 * arithmetic a calendar note is held to**: the months must add up to the year
 * the world keeps. A list that does not is not a different calendar, it is a
 * calendar that fails to describe the world — which is what the finding says.
 *
 * ## A package with no world note has no calendar mechanism
 *
 * `daysPerYear` comes from `data.year.days` on the package's own world note. A
 * package that declares none — every Hârn package this toolchain builds —
 * compiles no calendars and is asked no questions about one. A package that
 * declares a moon and no year is refused: a cycle of thirty days has no year to
 * be measured against.
 *
 * ## One definition, two readers
 *
 * The emitted definition is written in **array shape** — `months.values`,
 * `days.values`, `seasons.values` as arrays, which is Foundry core's
 * `ArrayField` shape.
 *
 * - **Core takes it and prunes what it does not know.** `SchemaField#clean`
 *   discards every key outside the schema before validation, by default and
 *   silently (`common/data/fields.mjs`, `DataModel.cleanData` passing
 *   `prune: true`), so `eras`, `moons`, `epochDayOffset` and `metadata` cost a
 *   core consumer nothing.
 * - **Calendaria takes the same object and converts the arrays**, in
 *   `migrateData`, ahead of validation, on exactly those three collections.
 *
 * So one artefact serves both, and two artefacts drifting is a failure mode
 * this pair does not have. What no test here can prove is schema conformance
 * itself — this package's testing carries no Foundry stubs on purpose — so the
 * consumer build and the Foundry container prove that, and the shapes below
 * claim no more than the emitters produce.
 *
 * @module
 */

import { dayOfYear, daysInYear } from "./calendars.mjs";
import { positionInFrontmatter, positionOfFrontmatterPath } from "./diagnostics.mjs";
import { parseNoteDate } from "./note-dates.mjs";

/** The `lore` subType whose notes are calendars. */
export const CALENDAR_SUBTYPE = "calendar";

/**
 * The `place` subTypes a world fact may be written on.
 *
 * `world` is a body people stand on; `celestial` is one they only look at. A
 * region, a settlement, a site, a structure or a feature is somewhere *in* a
 * world and states nothing about the world's year.
 *
 * @type {readonly string[]}
 */
export const INVARIANT_SUBTYPES = Object.freeze(["world", "celestial"]);

/**
 * The `data:` keys a calendar note may write — the closed list, in authored
 * order.
 *
 * Every key in either target schema that is not here is either a world fact,
 * read from a `place` note and written by the emitters, or omitted because no
 * calendar has declared one.
 *
 * @type {readonly object[]}
 */
export const CALENDAR_FIELDS = Object.freeze([
    {
        name: "epoch",
        shape: "a date",
        kind: "string",
        describe: "Which in-world day the world's clock reads zero on — `720/1/1`.",
    },
    {
        name: "months",
        shape: "list of `{ name, abbreviation?, days }`",
        kind: "list",
        describe:
            "The months this calendar keeps, in order — position in the list is " +
            "position in the year, and the day counts sum to the world's year.",
    },
    {
        name: "weekdays",
        shape: "list of `{ name, abbreviation? }`",
        kind: "list",
        describe:
            "The days of the week this calendar names, in order. A calendar with " +
            "no week writes none.",
    },
    {
        name: "seasons",
        shape: "list of `{ name, abbreviation?, monthStart?, monthEnd?, dayStart?, dayEnd? }`",
        kind: "list",
        describe: "The seasons this calendar marks, bounded by month or by day of year.",
    },
    {
        name: "eras",
        shape: "list of `{ shortcode, name, abbreviation?, proclaimedBy?, start, end? }`",
        kind: "list",
        describe:
            "The year-counts kept in this calendar. A date names one by writing " +
            "`<calendar shortcode>.<era shortcode>`.",
    },
]);

/**
 * The `data:` keys a world or a celestial body may write.
 *
 * Four groups, and which note carries which is a fact about the body rather
 * than a convention: a planet states its own size, tilt, year and present; a
 * moon states its own size, orbit and cycle.
 *
 * @type {readonly object[]}
 */
export const INVARIANT_FIELDS = Object.freeze([
    {
        name: "world.equatorialCircumferenceKm",
        shape: "number",
        kind: "number",
        describe: "The distance round the body at its equator, in kilometres.",
    },
    {
        name: "world.surfaceGravityG",
        shape: "number",
        kind: "number",
        describe: "Surface gravity, as a multiple of Earth's.",
    },
    {
        name: "world.axialTiltDegrees",
        shape: "number",
        kind: "number",
        describe: "The tilt of the axis, in degrees — what makes the body have seasons.",
    },
    {
        name: "year.days",
        shape: "number",
        kind: "number",
        describe: "How many days the body's year holds. Every calendar's months sum to it.",
    },
    {
        name: "year.hoursPerDay",
        shape: "number",
        kind: "number",
        describe: "How many hours the day divides into.",
    },
    {
        name: "year.minutesPerHour",
        shape: "number",
        kind: "number",
        describe: "How many minutes the hour divides into.",
    },
    {
        name: "year.secondsPerMinute",
        shape: "number",
        kind: "number",
        describe: "How many seconds the minute divides into.",
    },
    {
        name: "present",
        shape: "a date",
        kind: "string",
        describe: "The day the setting stops and play begins — what an age is computed against.",
    },
    {
        name: "body.diameterKm",
        shape: "number",
        kind: "number",
        describe: "The body's diameter, in kilometres.",
    },
    {
        name: "body.orbitalRadiusKm",
        shape: "number",
        kind: "number",
        describe: "How far the body orbits from the one it circles, in kilometres.",
    },
    {
        name: "body.orbit",
        shape: "string",
        kind: "string",
        describe: "The orbit's shape — `circular` means the cycle never varies.",
    },
    {
        name: "body.inclined",
        shape: "boolean",
        kind: "boolean",
        describe: "Whether the orbit is inclined to the plane the world orbits in.",
    },
    {
        name: "moon.cycle",
        shape: "number",
        kind: "number",
        describe: "How many days the body takes to return to the same phase.",
    },
    {
        name: "moon.newOn",
        shape: "a date",
        kind: "string",
        describe: "A day the body was new, written in the reference calendar.",
    },
    {
        name: "moon.eclipses",
        shape: "string",
        kind: "string",
        describe:
            "How often the body eclipses or is eclipsed — `never`, `rare`, " +
            "`occasional` or `frequent`.",
    },
]);

/** First segment of every calendar key, for the check that refuses them elsewhere. */
const CALENDAR_KEYS = Object.freeze(CALENDAR_FIELDS.map((field) => field.name));

/** First segment of every world-fact key, for the check that scopes them. */
const INVARIANT_KEYS = Object.freeze([
    ...new Set(INVARIANT_FIELDS.map((field) => field.name.split(".")[0])),
]);

/** The `data:` map of a note, or an empty one. */
function dataOf(note) {
    const data = note?.fm?.data;
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

/** A note's type, lower-cased, whether the walk recorded it or only the frontmatter did. */
function typeOf(note) {
    return String(note?.type ?? note?.fm?.type ?? "").toLowerCase();
}

/** A note's subType, lower-cased. */
function subTypeOf(note) {
    return String(note?.fm?.subType ?? "").toLowerCase();
}

/** Which of a key list a note actually writes. */
function keysWritten(note, keys) {
    const data = dataOf(note);
    return keys.filter((key) => data[key] !== undefined && data[key] !== null);
}

/**
 * The world facts a package declares, read from its own notes.
 *
 * Nothing here is configured and nothing is assumed: a package with no world
 * note has no year, and every question that depends on one goes unasked.
 *
 * @param {object} [index] - The link index, holding every note in the package.
 * @returns {{year: object|null, present: unknown, moon: object|null,
 *   body: object|null, moonName: string|null, yearNote: object|null,
 *   moonNote: object|null}} What the package's notes state.
 */
export function worldInvariants(index) {
    const empty = {
        year: null,
        present: null,
        moon: null,
        body: null,
        moonName: null,
        yearNote: null,
        moonNote: null,
    };
    if (!index) return empty;
    const found = { ...empty };
    for (const note of index.notes ?? []) {
        if (typeOf(note) !== "place") continue;
        const data = dataOf(note);
        if (!found.yearNote && data.year && typeof data.year === "object") {
            found.year = data.year;
            found.present = data.present ?? null;
            found.yearNote = note;
        }
        if (!found.moonNote && data.moon && typeof data.moon === "object") {
            found.moon = data.moon;
            found.body = data.body && typeof data.body === "object" ? data.body : null;
            found.moonName = String(note.fm?.name?.full ?? "") || null;
            found.moonNote = note;
        }
    }
    return found;
}

/**
 * Every `place` note in the package carrying one of the world-fact groups.
 *
 * Sorted by path so a package declaring two reports the same pair whichever
 * order the corpus walk happened to take.
 *
 * @param {object} index - The link index.
 * @param {string} key - The group — `year` or `moon`.
 * @returns {object[]} The notes, by path.
 */
function notesCarrying(index, key) {
    const carrying = [];
    for (const note of index.notes ?? []) {
        if (typeOf(note) !== "place") continue;
        const held = dataOf(note)[key];
        if (held && typeof held === "object") carrying.push(note);
    }
    return carrying.sort((a, b) => String(a.rel ?? a.file).localeCompare(String(b.rel ?? b.file)));
}

/** A finding positioned at a `data:` key of a note. */
function atData(note, keyPath, severity, message) {
    return {
        file: note.file,
        ...positionOfFrontmatterPath(note.raw ?? "", ["data", ...keyPath], { key: true }),
        severity,
        message,
    };
}

/**
 * Check a `place` note's world facts.
 *
 * Declared on `place` beside its tenure check, so the lint runs both with the
 * same index. Four rules, and each is a fact about the setting rather than
 * about the file:
 *
 * - a world fact is written on a body — a `world` or a `celestial` — and
 *   nowhere else;
 * - a package states **one** year, because two years is two settings and
 *   nothing can choose between them;
 * - a package states **one** moon, for the same reason;
 * - a moon with no year is refused, because a cycle measured in days has
 *   nothing to be measured against.
 *
 * `data.present` is read through the parser a note's dates go through, with the
 * corpus in hand, so a present written in an era resolves where it is written.
 *
 * @param {object} note - The note, as the link index hands it over.
 * @param {object} [opts]
 * @param {object} [opts.index] - The link index, holding every note.
 * @returns {object[]} Findings.
 */
export function checkWorldFacts(note, { index } = {}) {
    if (typeOf(note) !== "place") return [];
    const findings = [];
    const written = keysWritten(note, INVARIANT_KEYS);
    if (written.length === 0) return findings;

    const subType = subTypeOf(note);
    if (!INVARIANT_SUBTYPES.includes(subType)) {
        for (const key of written) {
            findings.push(
                atData(
                    note,
                    [key],
                    "error",
                    `\`data.${key}\` states a fact about a body, and this is a ` +
                        `${subType || "place"} within one — write it on the ` +
                        `\`world\` or \`celestial\` note whose subject the body is`,
                ),
            );
        }
        return findings;
    }

    if (written.includes("present")) {
        const { findings: dated } = parseNoteDate(dataOf(note).present, {
            field: "data.present",
            allowUnknown: false,
            file: note.file,
            raw: note.raw,
            keyPath: ["data", "present"],
        });
        findings.push(...dated);
    }

    // The corpus questions, which need every note and so are asked only where
    // the caller handed one over.
    if (!index) return findings;

    for (const key of ["year", "moon"]) {
        if (!written.includes(key)) continue;
        const carrying = notesCarrying(index, key);
        if (carrying.length < 2) continue;
        const others = carrying
            .filter((other) => other !== note)
            .map((other) => other.rel ?? other.file);
        findings.push(
            atData(
                note,
                [key],
                "error",
                `a package states one ${key === "year" ? "year" : "moon"}, and ` +
                    `${others.join(", ")} states one too — two is two settings, and ` +
                    `nothing can say which one a calendar is written against`,
            ),
        );
    }

    if (written.includes("moon") && notesCarrying(index, "year").length === 0) {
        findings.push(
            atData(
                note,
                ["moon"],
                "error",
                "a cycle of days has no year to be measured against: no note in " +
                    "this package states `data.year`, so nothing says how long the " +
                    "year this moon runs against is",
            ),
        );
    }

    return findings;
}

/**
 * Check a `lore` note's calendar declaration.
 *
 * Both halves of one sentence, and the second is the half that keeps the family
 * from leaking: a calendar note must carry its months and its epoch, and a lore
 * note that is not a calendar must carry none of the family at all.
 *
 * The sum is the only arithmetic. It runs where the package states a year and
 * the note states months, and nowhere else — neither fires on a package that
 * declared nothing.
 *
 * A calendar note **cannot** restate a world fact, and it needs no rule of its
 * own to stop it: `data.year`, `data.moon`, `data.world` and `data.body` are
 * declared on `place` and not on `lore`, so the closed `data:` container
 * already refuses them by the rule it refuses every undeclared key by.
 *
 * @param {object} note - The note, as the link index hands it over.
 * @param {object} [opts]
 * @param {object} [opts.index] - The link index, for the world's year.
 * @returns {object[]} Findings.
 */
export function checkCalendarNote(note, { index } = {}) {
    if (typeOf(note) !== "lore") return [];
    const findings = [];
    const written = keysWritten(note, CALENDAR_KEYS);

    if (subTypeOf(note) !== CALENDAR_SUBTYPE) {
        for (const key of written) {
            findings.push(
                atData(
                    note,
                    [key],
                    "error",
                    `\`data.${key}\` is a calendar's, and this note's \`subType\` is ` +
                        `not \`calendar\` — move it to the note about the calendar, ` +
                        `which every body keeping that calendar can then link to`,
                ),
            );
        }
        return findings;
    }

    for (const required of ["months", "epoch"]) {
        if (written.includes(required)) continue;
        findings.push({
            file: note.file,
            ...positionInFrontmatter(note.raw ?? "", "subType", undefined, { topLevel: true }),
            severity: "error",
            message:
                `a calendar divides the year and says where the count begins, so ` +
                `this note must state \`data.${required}\``,
        });
    }

    findings.push(...checkMonthSum(note, index));
    findings.push(...checkEraShortcodes(note));
    return findings;
}

/**
 * The sum-to-the-world's-year finding.
 *
 * Positioned on the list rather than on an entry: the pass holds a column of
 * numbers and no way to know which one was mistyped, and a position pointed at
 * the wrong entry is worse than a position on the list.
 *
 * The message states what is wrong with the world rather than with the
 * addition, because the remedy is to decide which month is the wrong length and
 * not to make the column balance.
 *
 * @param {object} note - The calendar note.
 * @param {object} [index] - The link index.
 * @returns {object[]} Findings.
 */
function checkMonthSum(note, index) {
    const months = dataOf(note).months;
    if (!Array.isArray(months) || months.length === 0) return [];
    const days = worldInvariants(index).year?.days;
    if (typeof days !== "number") return [];
    const sum = daysInYear(months);
    if (sum === days) return [];
    return [
        atData(
            note,
            ["months"],
            "error",
            `\`data.months\` sums to ${sum}, and the year is ${days} days — a ` +
                `calendar names the same days differently, it does not keep a ` +
                `different number of them`,
        ),
    ];
}

/**
 * One calendar must not count two eras by the same name.
 *
 * A shortcode is unique within its `(type, package)` by construction, so a
 * qualified era name cannot collide across calendars and there is no
 * corpus-wide sweep to run. What is left is local, and verifiable against this
 * note alone.
 *
 * @param {object} note - The calendar note.
 * @returns {object[]} Findings.
 */
function checkEraShortcodes(note) {
    const eras = dataOf(note).eras;
    if (!Array.isArray(eras)) return [];
    const seen = new Set();
    const findings = [];
    eras.forEach((era, position) => {
        const shortcode = String(era?.shortcode ?? "");
        if (!shortcode) {
            findings.push(
                atData(
                    note,
                    ["eras", position],
                    "error",
                    "an era is addressed `<calendar shortcode>.<era shortcode>`, so " +
                        "every row states a `shortcode` of its own",
                ),
            );
            return;
        }
        if (seen.has(shortcode)) {
            findings.push(
                atData(
                    note,
                    ["eras", position],
                    "error",
                    `this calendar already counts an era called "${shortcode}", and a ` +
                        `date naming it would name both`,
                ),
            );
        }
        seen.add(shortcode);
    });
    return findings;
}

/**
 * The four days the year turns on, by day of year.
 *
 * The year opens on the first of the first month, and the year's length sets
 * the spacing; nothing else is consulted. A body's tilt is what makes seasons
 * exist at all, and it is read by nobody — a quarter day is where the calendar
 * opens plus a quarter of the year, to the nearest whole day, because a day is
 * the smallest thing a calendar can name.
 *
 * @param {number} daysPerYear - The world's year.
 * @returns {number[]} Four day-of-year numbers, in order from the year's start.
 */
export function quarterDays(daysPerYear) {
    return [0, 1, 2, 3].map((quarter) => Math.round(1 + (daysPerYear * quarter) / 4));
}

/** Drop the keys whose value is `undefined`, so an omitted field is absent. */
function written(object) {
    return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

/** A month's name, abbreviation and length, plus its position and its kind. */
function monthValues(months) {
    const lengths = months.map((month) => Number(month?.days) || 0);
    // Calendaria's own bundled calendars mark a short month this way, and it is
    // display metadata rather than arithmetic: a month shorter than the length
    // most months share is the days a people keeps outside their months.
    const modal = [...lengths]
        .sort(
            (a, b) => lengths.filter((l) => l === b).length - lengths.filter((l) => l === a).length,
        )
        .at(0);
    return months.map((month, position) =>
        written({
            name: String(month?.name ?? ""),
            abbreviation:
                month?.abbreviation === undefined ? undefined : String(month.abbreviation),
            ordinal: position + 1,
            days: lengths[position],
            // `leapDays` is never written. A world with no leap rule has no
            // second length for a month, and a value that could disagree with
            // `days` is one that eventually will.
            type: lengths[position] < modal ? "intercalary" : undefined,
        }),
    );
}

/** A weekday's name, abbreviation and position. An empty list stays empty. */
function weekdayValues(weekdays) {
    return (Array.isArray(weekdays) ? weekdays : []).map((day, position) =>
        written({
            name: String(day?.name ?? ""),
            abbreviation: day?.abbreviation === undefined ? undefined : String(day.abbreviation),
            ordinal: position + 1,
        }),
    );
}

/** A season's name and whichever pair of bounds the note wrote. */
function seasonValues(seasons) {
    return (Array.isArray(seasons) ? seasons : []).map((season) =>
        written({
            name: String(season?.name ?? ""),
            abbreviation:
                season?.abbreviation === undefined ? undefined : String(season.abbreviation),
            monthStart: season?.monthStart,
            monthEnd: season?.monthEnd,
            dayStart: season?.dayStart,
            dayEnd: season?.dayEnd,
        }),
    );
}

/** The era rows, keyed by shortcode, with the addressing segments dropped. */
function eraEntries(eras) {
    const entries = {};
    for (const era of Array.isArray(eras) ? eras : []) {
        const shortcode = String(era?.shortcode ?? "");
        if (!shortcode) continue;
        entries[shortcode] = written({
            name: String(era?.name ?? ""),
            abbreviation: era?.abbreviation === undefined ? undefined : String(era.abbreviation),
            start: era?.start === undefined ? undefined : String(era.start),
            end: era?.end === undefined ? undefined : String(era.end),
        });
    }
    return entries;
}

/**
 * The moon entry, from the moon's own note and nothing else.
 *
 * Every value is the world fact stated in the target's vocabulary, and where
 * the setting models nothing the target's own way of saying nothing is written:
 * eclipses that nobody computes are `eclipseMode` with no `nodalPeriod`, and a
 * circular orbit is a cycle that never varies.
 *
 * @param {object} moon - `data.moon`, from the moon note.
 * @param {object|null} body - `data.body`, from the same note.
 * @param {string} name - What the body is called.
 * @returns {object|null} The entry, keyed by the body's name, or `null`.
 */
function moonEntries(moon, body, name) {
    if (!moon || !name) return null;
    const date = parseNoteDate(moon.newOn, { allowUnknown: false }).date;
    return {
        [name]: written({
            name,
            cycleLength: Number(moon.cycle),
            referenceDate:
                date ? written({ year: date.year, month: date.month, day: date.day }) : undefined,
            // A circular orbit is a cycle of exactly its length, every time.
            cycleVariance: String(body?.orbit ?? "") === "circular" ? 0 : undefined,
            phaseMode: "fixed",
            eclipseMode: moon.eclipses === undefined ? undefined : String(moon.eclipses),
            // Stated rather than fabricated: an inclined orbit makes eclipses
            // uncommon, and nothing in the setting says when one falls, so
            // there is no period to write.
            nodalPeriod: null,
        }),
    };
}

/**
 * Compile one calendar note and the package's world facts into one definition.
 *
 * The object both consumers read: array-shaped for core's `ArrayField`
 * collections, carrying the keys core prunes and Calendaria keeps.
 *
 * @param {object} opts
 * @param {object} opts.note - The calendar note.
 * @param {object} opts.invariants - What {@link worldInvariants} read.
 * @param {string} [opts.contentPackage] - The package shipping the note, which
 *   is a fact about the tree rather than about the note: a note never declares
 *   its own package.
 * @returns {object} The definition.
 */
export function compileCalendar({ note, invariants, contentPackage }) {
    const data = dataOf(note);
    const year = invariants?.year ?? {};
    const months = Array.isArray(data.months) ? data.months : [];
    const epoch = parseNoteDate(data.epoch, { allowUnknown: false }).date;
    const shortcode = String(note.fm?.shortcode ?? "");
    const name = String(note.fm?.name?.full ?? "");
    const description = String(note.fm?.description ?? "");
    const moons = moonEntries(invariants?.moon, invariants?.body ?? null, invariants?.moonName);
    const author = contentPackage ? String(contentPackage) : undefined;

    return written({
        name,
        description,
        years: {
            // The year the epoch falls in is the year a reader is shown at the
            // world's own zero.
            yearZero: epoch?.year ?? 0,
            // Required, non-nullable and with no initial, so it must be
            // written; with no weekdays it indexes nothing and 0 is the only
            // defensible value.
            firstWeekday: 0,
            // A world with no leap rule states that it has none, rather than
            // leaving a shape for one to be inferred into.
            leapYear: null,
        },
        months: { values: monthValues(months) },
        days: written({
            values: weekdayValues(data.weekdays),
            daysPerYear: year.days,
            hoursPerDay: year.hoursPerDay,
            minutesPerHour: year.minutesPerHour,
            secondsPerMinute: year.secondsPerMinute,
        }),
        seasons: { values: seasonValues(data.seasons) },
        // How far into the year the world's zero falls. `1/1` is none.
        epochDayOffset:
            epoch && months.length ? dayOfYear(months, epoch.month ?? 1, epoch.day ?? 1) - 1 : 0,
        eras: eraEntries(data.eras),
        moons: moons ?? undefined,
        metadata: written({
            id: shortcode || undefined,
            description,
            author,
        }),
    });
}

/**
 * Wrap a definition in the envelope a Calendaria settings import reads.
 *
 * `calendarData` is the definition unchanged — the importer derives an id from
 * its `name` and creates a custom calendar from it — so the envelope adds a
 * header and nothing else. That is what makes the two artefacts assertable
 * against each other rather than merely similar.
 *
 * @param {object} definition - What {@link compileCalendar} produced.
 * @param {object} opts
 * @param {string} opts.version - The Calendaria version this was generated
 *   against, which the importer records.
 * @param {string} opts.exportedAt - When, as an ISO 8601 instant.
 * @returns {object} The envelope.
 */
export function calendariaEnvelope(definition, { version, exportedAt }) {
    return {
        version,
        exportedAt,
        settings: {},
        calendarData: definition,
    };
}

/**
 * Every calendar a package declares, compiled.
 *
 * A package whose notes state no year declares no calendars and is asked
 * nothing about one, which is the right answer for a package that builds a
 * setting somebody else wrote down.
 *
 * @param {object} [index] - The link index, holding every note.
 * @param {object} [opts]
 * @param {string} [opts.contentPackage] - The package shipping the tree.
 * @returns {{calendars: object[], invariants: object}} One compiled definition
 *   per calendar note, and the facts they were compiled against.
 */
export function compileCalendars(index, { contentPackage } = {}) {
    const invariants = worldInvariants(index);
    if (!invariants.year) return { calendars: [], invariants };
    const calendars = [];
    for (const note of index?.notes ?? []) {
        if (typeOf(note) !== "lore" || subTypeOf(note) !== CALENDAR_SUBTYPE) continue;
        calendars.push(compileCalendar({ note, invariants, contentPackage }));
    }
    return { calendars, invariants };
}
