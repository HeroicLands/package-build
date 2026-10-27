/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A note's dates print in its own calendar**: its `data.calendar`, else its
 * culture's, else — for a place — its parents', else the configured
 * `defaultCalendar`, else none. Parents naming two calendars are an error at
 * the place's `data.parents`. An event view prints every date in the calendar
 * of the page showing it, and `dateformat` with no calendar named uses the
 * note's.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectContentIndex } from "../engine/content-index.mjs";
import { expandContentTables } from "../engine/content-tables.mjs";
import { parseMarkdownFile } from "../engine/helpers.mjs";
import { noteInfobox } from "../engine/infobox.mjs";
import { renderMarkdownExpressions } from "../engine/markdown-expressions.mjs";
import { dataFields, NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { calendarAddress, reckoningContext } from "../engine/reckoning-markers.mjs";
import { openNotesDatabase, prepareTreeSqlTables } from "../engine/sql-tables.mjs";

const PKG = "demo";
const ALPHA = `${PKG}-note-lore-alpha`;
const BETA = `${PKG}-note-lore-beta`;
const GAMMA = `${PKG}-note-lore-gamma`;

let dir: string;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "note-calendars-"));
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

/** Write one note. */
function note(file: string, fm: Record<string, unknown>, body?: string): string {
    const full = path.join(dir, file);
    const name = { full: String(fm.shortcode) };
    fs.writeFileSync(
        full,
        `---\n${YAML.stringify({ name, ...fm })}---\n\n${body ?? `Prose about ${fm.shortcode}.\n`}`,
    );
    return full;
}

/** A calendar note whose eras are abbreviated `abbreviation`. */
function calendar(shortcode: string, abbreviation: string): void {
    note(`${shortcode}.md`, {
        type: "lore",
        subType: "calendar",
        shortcode,
        data: {
            epoch: "1.1",
            months: Array.from({ length: 12 }, (_, index) => ({
                name: `Month ${index + 1}`,
                days: index === 11 ? 35 : 30,
            })),
            eras: [
                {
                    shortcode: "before",
                    name: "Before",
                    abbreviation: `${abbreviation}B`,
                    start: null,
                },
                { shortcode: "after", name: "After", abbreviation, start: 1 },
            ],
        },
    });
}

/** The world, three calendars and a culture reckoning in beta. */
function setting(): void {
    note("World.md", {
        type: "place",
        subType: "world",
        shortcode: "wrld",
        data: { year: { days: 365 } },
    });
    calendar("alpha", "AL");
    calendar("beta", "BE");
    calendar("gamma", "GA");
    note("Folk.md", {
        type: "lore",
        subType: "culture",
        shortcode: "folk",
        data: { calendar: "beta", lang: "en" },
    });
    note("Plainfolk.md", {
        type: "lore",
        subType: "culture",
        shortcode: "plainfolk",
        data: { lang: "en" },
    });
}

/** A place with the given `data`. */
function place(shortcode: string, data: Record<string, unknown> = {}): string {
    return note(`${shortcode}.md`, { type: "place", subType: "region", shortcode, data });
}

/** Collect the tree as a reader does. */
function collect(problems: any[], extra: Record<string, unknown> = {}) {
    return collectContentIndex(dir, {
        contentPackage: PKG,
        skipDirectories: [],
        problems,
        ...extra,
    });
}

/** The resolved calendar of one note. */
function calendarOf(records: any[], type: string, shortcode: string): string | undefined {
    const record = records.find(
        (r) => r.type === type && r.shortcode === shortcode && !r.documents,
    );
    if (!record) throw new Error(`no ${type} ${shortcode}`);
    return calendarAddress(record.resolvedCalendar);
}

describe("data.calendar", () => {
    it("is declared on every note type, as a calendar lore Address", () => {
        for (const type of Object.keys(NOTE_VOCABULARY)) {
            const field = dataFields(type)?.find((one: any) => one.name === "calendar");
            expect(field, type).toBeDefined();
            expect(field.ref, type).toBe("lore");
        }
    });
});

describe("a note's calendar", () => {
    it("is its own data.calendar first, on any type", () => {
        setting();
        note("Aran.md", {
            type: "being",
            subType: "npc",
            shortcode: "aran",
            data: { calendar: "alpha", culture: "folk" },
        });
        note("Tale.md", {
            type: "lore",
            subType: "history",
            shortcode: "tale",
            data: { calendar: "alpha" },
        });
        const problems: any[] = [];
        const records = collect(problems, { defaultCalendar: "gamma" });
        expect(problems).toEqual([]);
        expect(calendarOf(records, "being", "aran")).toBe(ALPHA);
        expect(calendarOf(records, "lore", "tale")).toBe(ALPHA);
    });

    it("is its culture's next, ahead of a place's parents", () => {
        setting();
        place("north", { calendar: "alpha" });
        place("town", { culture: "folk", parents: ["north"] });
        note("Bryn.md", {
            type: "being",
            subType: "npc",
            shortcode: "bryn",
            data: { culture: "folk" },
        });
        const problems: any[] = [];
        const records = collect(problems, { defaultCalendar: "gamma" });
        expect(problems).toEqual([]);
        expect(calendarOf(records, "being", "bryn")).toBe(BETA);
        expect(calendarOf(records, "place", "town")).toBe(BETA);
        expect(calendarOf(records, "lore", "folk")).toBe(BETA);
    });

    it("is a place's parents' next, when its culture names none", () => {
        setting();
        place("north", { calendar: "alpha" });
        place("mid", { parents: ["north"] });
        place("town", { culture: "plainfolk", parents: ["mid"] });
        place("twice", { parents: ["north", "mid"] });
        const problems: any[] = [];
        const records = collect(problems, { defaultCalendar: "gamma" });
        expect(problems).toEqual([]);
        expect(calendarOf(records, "place", "mid")).toBe(ALPHA);
        expect(calendarOf(records, "place", "town")).toBe(ALPHA);
        expect(calendarOf(records, "place", "twice")).toBe(ALPHA);
    });

    it("is not taken from parents for any type but a place", () => {
        setting();
        note("Order.md", {
            type: "affiliation",
            subType: "order",
            shortcode: "order",
            data: { parents: ["folk"] },
        });
        const problems: any[] = [];
        const records = collect(problems, { defaultCalendar: "gamma" });
        expect(calendarOf(records, "affiliation", "order")).toBe(GAMMA);
    });

    it("is the default next", () => {
        setting();
        note("Cael.md", {
            type: "being",
            subType: "npc",
            shortcode: "cael",
            data: { culture: "plainfolk" },
        });
        note("Sword.md", { type: "lore", subType: "history", shortcode: "sword" });
        const problems: any[] = [];
        const records = collect(problems, { defaultCalendar: "gamma" });
        expect(problems).toEqual([]);
        expect(calendarOf(records, "being", "cael")).toBe(GAMMA);
        expect(calendarOf(records, "lore", "sword")).toBe(GAMMA);
    });

    it("is none without a default", () => {
        setting();
        note("Cael.md", { type: "being", subType: "npc", shortcode: "cael" });
        const problems: any[] = [];
        const records = collect(problems);
        expect(problems).toEqual([]);
        expect(calendarOf(records, "being", "cael")).toBeUndefined();
        expect(calendarOf(records, "lore", "folk")).toBe(BETA);
    });

    it("is the default, with no error, when no parent names a calendar", () => {
        setting();
        place("north");
        place("south", { culture: "plainfolk" });
        place("town", { parents: ["north", "south", "wrld"] });
        const problems: any[] = [];
        const records = collect(problems, { defaultCalendar: "gamma" });
        expect(problems).toEqual([]);
        expect(calendarOf(records, "place", "town")).toBe(GAMMA);
    });

    it("is an error at data.parents naming the place and both calendars when parents disagree", () => {
        setting();
        place("north", { calendar: "alpha" });
        place("south", { calendar: "beta" });
        const file = place("edge", { parents: ["north", "south"] });
        place("below", { parents: ["edge"] });
        const problems: any[] = [];
        const records = collect(problems, { defaultCalendar: "gamma" });
        const lines = fs.readFileSync(file, "utf8").split("\n");
        const line = lines.findIndex((text) => /^\s*parents:/.test(text)) + 1;
        expect(problems).toEqual([
            {
                file,
                line,
                column: lines[line - 1].indexOf("parents") + 1,
                severity: "error",
                message:
                    `place edge: data.parents resolve to different calendars ` +
                    `(${ALPHA} via north, ${BETA} via south); state data.calendar`,
            },
        ]);
        expect(calendarOf(records, "place", "edge")).toBe(GAMMA);
        // Reported once, where it is: a place below it takes the default.
        expect(calendarOf(records, "place", "below")).toBe(GAMMA);
    });

    it("throws the disagreement when no problems list is given", () => {
        setting();
        place("north", { calendar: "alpha" });
        place("south", { calendar: "beta" });
        place("edge", { parents: ["north", "south"] });
        expect(() =>
            collectContentIndex(dir, { contentPackage: PKG, skipDirectories: [] }),
        ).toThrow(/place edge: data\.parents resolve to different calendars/);
    });

    it("resolves a cycle through parents or cultures without looping", () => {
        setting();
        place("loopa", { parents: ["loopb"] });
        place("loopb", { parents: ["loopa"] });
        place("selfish", { parents: ["selfish"] });
        place("ringed", { parents: ["loopa"], culture: "plainfolk" });
        const problems: any[] = [];
        const records = collect(problems, { defaultCalendar: "gamma" });
        // The cycles are the language derivation's findings; the calendar adds none.
        expect(problems.map((p) => p.message)).toEqual([
            expect.stringMatching(/names place-loopb, which closes a parents cycle/),
            expect.stringMatching(/names place-loopa, which closes a parents cycle/),
            expect.stringMatching(/names place-selfish, which closes a parents cycle/),
        ]);
        for (const shortcode of ["loopa", "loopb", "selfish", "ringed"])
            expect(calendarOf(records, "place", shortcode), shortcode).toBe(GAMMA);
        const none = collect([]);
        expect(calendarOf(none, "place", "loopa")).toBeUndefined();
    });

    it("rejects a defaultCalendar naming no calendar note, at the configuration key", () => {
        setting();
        note("Tale.md", { type: "lore", subType: "history", shortcode: "tale" });
        const configFile = path.join(dir, "..", `${path.basename(dir)}.config.yaml`);
        fs.writeFileSync(configFile, "contentPackage: demo\ndefaultCalendar: tale\n");
        try {
            for (const named of ["nosuch", "tale"]) {
                const problems: any[] = [];
                collect(problems, { defaultCalendar: named, configFile });
                expect(problems).toEqual([
                    {
                        file: configFile,
                        line: 2,
                        column: 1,
                        severity: "error",
                        message:
                            `defaultCalendar ${named} names no calendar note in demo; ` +
                            "name the shortcode of a lore note with subType: calendar",
                    },
                ]);
            }
        } finally {
            fs.rmSync(configFile, { force: true });
        }
    });
});

describe("dates printed for a note", () => {
    it("print through dateformat in the note's calendar when no calendar is named", () => {
        setting();
        note("Bryn.md", {
            type: "being",
            subType: "npc",
            shortcode: "bryn",
            data: { culture: "folk", born: "300.25" },
        });
        note("Cael.md", {
            type: "being",
            subType: "npc",
            shortcode: "cael",
            data: { born: "300.25" },
        });
        const records = collect([], { defaultCalendar: "gamma" });
        const dates = reckoningContext({ notes: records });
        const fmOf = (shortcode: string) =>
            parseMarkdownFile(
                path.join(dir, `${shortcode[0].toUpperCase()}${shortcode.slice(1)}.md`),
            ).frontmatter;
        const render = (source: string, shortcode: string) =>
            renderMarkdownExpressions(source, { fm: fmOf(shortcode), dates });
        expect(render("{{dateformat data.born}}", "bryn")).toEqual({
            markdown: "25 Month 1 300 BE",
            findings: [],
        });
        expect(render("{{dateformat data.born}}", "cael").markdown).toBe("25 Month 1 300 GA");
        expect(render('{{dateformat "alpha" data.born}}', "bryn").markdown).toBe(
            "25 Month 1 300 AL",
        );
        expect(render('{{dateformat "300.25" "std"}}', "bryn").findings).toEqual([]);
        expect(render('{{dateformat "300.25"}}', "bryn").markdown).toBe("25 Month 1 300 BE");
    });

    it("print in the infobox in the note's calendar", () => {
        setting();
        note("Bryn.md", {
            type: "being",
            subType: "npc",
            shortcode: "bryn",
            data: { culture: "folk", born: "300.25" },
        });
        const records = collect([], { defaultCalendar: "gamma" });
        const dates = reckoningContext({ notes: records });
        const fm = parseMarkdownFile(path.join(dir, "Bryn.md")).frontmatter;
        const box = noteInfobox(fm, { dates, contentPackage: PKG });
        expect(JSON.stringify(box)).toContain("25 Month 1 300 BE");
    });
});

describe("an event view", () => {
    /** The expanded body of one note, every generated section included. */
    async function expanded(records: any[], file: string): Promise<string> {
        const db = await openNotesDatabase(records);
        try {
            const prepared = await prepareTreeSqlTables(dir, {
                records,
                config: { contentPackage: PKG } as any,
                database: { ...db, stubsExcluded: async () => 0 },
            });
            const absPath = path.join(dir, file);
            const { markdown, errors } = expandContentTables(parseMarkdownFile(absPath).body, {
                source: file,
                sqlTables: prepared.get(absPath),
            });
            expect(errors).toEqual([]);
            return markdown;
        } finally {
            await db.close();
        }
    }

    it("prints an event owned by a note in another calendar in the page's", async () => {
        setting();
        place("north", { calendar: "alpha" });
        place("south");
        note("Tale.md", {
            type: "lore",
            subType: "history",
            shortcode: "tale",
            data: {
                calendar: "beta",
                events: [
                    { when: 250, summary: "North is walled.", where: { locus: ["north"] } },
                    { when: 260, summary: "South is walled.", where: { locus: ["south"] } },
                ],
            },
        });
        const records = collect([], { defaultCalendar: "gamma" });
        const north = await expanded(records, "north.md");
        expect(north).toContain("North is walled.");
        expect(north).toContain("250 AL");
        expect(north).not.toContain("250 BE");
        const south = await expanded(records, "south.md");
        expect(south).toContain("260 GA");
        const db = await openNotesDatabase(records);
        try {
            const { rows } = await db.query(
                `SELECT whenText, whenIn['${GAMMA}'] AS gamma FROM events WHERE summary = 'North is walled.'`,
            );
            expect(rows).toEqual([{ whenText: "250 BE", gamma: "250 GA" }]);
        } finally {
            await db.close();
        }
    });

    it("prints each event in its owner's calendar on a page with none", async () => {
        setting();
        place("north");
        note("Tale.md", {
            type: "lore",
            subType: "history",
            shortcode: "tale",
            data: {
                calendar: "beta",
                events: [{ when: 250, summary: "North is walled.", where: { locus: ["north"] } }],
            },
        });
        const records = collect([]);
        expect(await expanded(records, "north.md")).toContain("250 BE");
    });
});
