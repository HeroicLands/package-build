/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { emitCalendarArtifacts } from "../engine/calendar-artifacts.mjs";

let root: string;
let config: any;

function note(file: string, frontmatter: Record<string, unknown>) {
    const location = path.join(root, "assets/content", file);
    fs.mkdirSync(path.dirname(location), { recursive: true });
    fs.writeFileSync(
        location,
        `---\nshortcode: ${String(frontmatter.shortcode ?? "")}\ntype: ${frontmatter.type}\nsubType: ${frontmatter.subType ?? ""}\n---\n`,
    );
    return { ...frontmatter, file: { path: file } };
}

function index(records: object[]) {
    const location = path.join(root, "build/content-index/demo-metadata.jsonl");
    fs.mkdirSync(path.dirname(location), { recursive: true });
    fs.writeFileSync(location, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

function world() {
    return note("World.md", {
        type: "place",
        subType: "world",
        shortcode: "world",
        name: { full: "World" },
        data: { year: { days: 365, hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60 } },
    });
}

function calendar(shortcode: string, file = `${shortcode}.md`) {
    return note(file, {
        type: "lore",
        subType: "calendar",
        shortcode,
        name: { full: shortcode },
        data: { epoch: "720.1", months: [{ name: "Year", days: 365 }] },
    });
}

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "calendar-artifacts-"));
    config = {
        rootDir: root,
        contentPackage: "demo",
        paths: { content: "assets/content", contentIndex: "build/content-index" },
    };
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("calendar artifact emission", () => {
    it("emits paired, byte-stable files for each calendar", () => {
        index([world(), calendar("first"), calendar("second")]);
        const first = emitCalendarArtifacts({ config, calendariaVersion: "1.4.2" });
        expect(first).toMatchObject({ calendars: 2, files: 4 });
        const files = fs.readdirSync(first.directory).sort();
        expect(files).toEqual([
            "first.calendaria.json",
            "first.json",
            "second.calendaria.json",
            "second.json",
        ]);
        const bytes = files.map((file) =>
            fs.readFileSync(path.join(first.directory, file), "utf8"),
        );
        for (const shortcode of ["first", "second"]) {
            const definition = JSON.parse(
                fs.readFileSync(path.join(first.directory, `${shortcode}.json`), "utf8"),
            );
            const envelope = JSON.parse(
                fs.readFileSync(path.join(first.directory, `${shortcode}.calendaria.json`), "utf8"),
            );
            expect(envelope.calendarData).toEqual(definition);
            expect(envelope.exportedAt).toBe("1970-01-01T00:00:00.000Z");
            expect(definition.years.yearZero).toBe(720);
            expect(definition.days.daysPerYear).toBe(365);
        }
        emitCalendarArtifacts({ config, calendariaVersion: "1.4.2" });
        expect(
            files.map((file) => fs.readFileSync(path.join(first.directory, file), "utf8")),
        ).toEqual(bytes);
    });

    it("emits an empty directory for a package with no calendars", () => {
        index([world()]);
        const result = emitCalendarArtifacts({ config, calendariaVersion: "1.4.2" });
        expect(result.calendars).toBe(0);
        expect(fs.readdirSync(result.directory)).toEqual([]);
    });

    it("refuses a missing world year and a colliding calendar shortcode", () => {
        index([calendar("first")]);
        expect(() => emitCalendarArtifacts({ config, calendariaVersion: "1.4.2" })).toThrow(
            /world note/,
        );
        index([world(), calendar("first"), calendar("first", "duplicate.md")]);
        expect(() => emitCalendarArtifacts({ config, calendariaVersion: "1.4.2" })).toThrow(
            /duplicate\.md:2:1: error: calendar shortcode first also occurs/,
        );
    });

    it("locates a calendar without a usable shortcode", () => {
        index([world(), calendar("")]);
        expect(() => emitCalendarArtifacts({ config, calendariaVersion: "1.4.2" })).toThrow(
            /\.md:2:1: error: calendar shortcode must contain/,
        );
    });

    it("refuses a missing content index with the rebuild command", () => {
        expect(() => emitCalendarArtifacts({ config, calendariaVersion: "1.4.2" })).toThrow(
            /content-build content-index/,
        );
    });

    it("refuses an empty content index", () => {
        index([]);
        expect(() => emitCalendarArtifacts({ config, calendariaVersion: "1.4.2" })).toThrow(
            /content index contains no notes/,
        );
    });
});
