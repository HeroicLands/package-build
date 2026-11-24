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

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

import { GENERATED_SECTIONS } from "../engine/generated-sections.mjs";
import { ALERT_TYPES } from "../engine/content-alerts.mjs";

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** The text from a heading to the next heading of the same or higher level. */
function sectionOf(source: string, heading: string): string {
    const start = source.indexOf(`\n${heading}\n`);
    expect(start, `${heading} exists`).toBeGreaterThan(-1);
    const level = heading.match(/^#+/)![0].length;
    const rest = source.slice(start + heading.length + 2);
    const end = rest.search(new RegExp(`^#{1,${level}} `, "m"));
    return end < 0 ? rest : rest.slice(0, end);
}

/** The anchor column of every row of the first table in a text, in order. */
function tableAnchors(text: string): string[] {
    return [...text.matchAll(/^\|[^|\n]*\|\s*`([a-z]+)`\s*\|/gm)].map((match) => match[1]);
}

const slugs = GENERATED_SECTIONS.map((section) => section.slug);

describe("the generated sections are documented as the code builds them", () => {
    it("has a non-trivial set of sections", () => {
        expect(slugs.length).toBeGreaterThan(8);
        expect(slugs).toContain("settlements");
        expect(slugs).toContain("settlementindex");
    });

    it("lists every section, in order, in the format reference table", () => {
        const text = sectionOf(read("docs/reference/format-details.md"), "#### Generated sections");
        expect(tableAnchors(text)).toEqual(slugs);
    });

    it("names every section in the site guide's list of unreachable-page sections", () => {
        const text = read("docs/guides/site.md").replace(/\s+/g, " ");
        const list = text.match(/sections generated after a note's text \(([^)]*)\)/)![1];
        for (const section of GENERATED_SECTIONS)
            expect(list, `${section.heading} is listed`).toContain(section.heading);
    });

    it("names every section in the authoring guide", () => {
        const text = sectionOf(
            read("docs/authoring/links-and-markup.md"),
            "### Sections the build adds",
        );
        const following = sectionOf(
            read("docs/authoring/links-and-markup.md"),
            "### Sections the build adds about events",
        );
        const named = new Set(
            [...`${text}\n${following}`.matchAll(/`([a-z]+)`/g)].map((match) => match[1]),
        );
        for (const slug of slugs) expect(named.has(slug), `${slug} is named`).toBe(true);
        const table = tableAnchors(text);
        for (const anchor of table) expect(slugs).toContain(anchor);
        expect(table).toEqual(slugs.filter((slug) => table.includes(slug)));
    });
});

describe("the alert prose names the markers the scanner accepts", () => {
    const markers = Object.keys(ALERT_TYPES).map((name) => `[!${name.toUpperCase()}]`);

    it("has a non-trivial set of alert types", () => {
        expect(markers.length).toBeGreaterThanOrEqual(4);
    });

    it("lists exactly the accepted markers in the content-format summary", () => {
        const line = read("docs/content-format.md")
            .split("\n")
            .find((entry) => entry.startsWith("Blockquote alerts use"))!;
        expect(line).toBeDefined();
        const found = [...line.matchAll(/`(\[![^\]`]*\])`/g)].map((match) => match[1]);
        expect(found).toEqual(markers);
    });

    it("lists exactly the accepted markers and titles in the authoring guide", () => {
        const text = sectionOf(read("docs/authoring/links-and-markup.md"), "### Alerts");
        const rows = [...text.matchAll(/^\| `(\[![^\]`]*\])`\s*\| (\w+)\s*\|/gm)];
        expect(rows.map((row) => row[1])).toEqual(markers);
        for (const row of rows)
            expect(row[2]).toBe(ALERT_TYPES[row[1].slice(2, -1).toLowerCase()].title);
        const blocks = [...text.matchAll(/^> \[!([A-Za-z]*)\]\s*$/gm)].map((match) => match[1]);
        expect(blocks).toEqual(markers.map((marker) => marker.slice(2, -1)));
    });

    it("lists exactly the accepted markers in the format reference", () => {
        const text = sectionOf(read("docs/reference/format-details.md"), "##### Alerts");
        const blocks = [...text.matchAll(/^> \[!([A-Za-z]*)\]\s*$/gm)].map((match) => match[1]);
        expect(blocks).toEqual(markers.map((marker) => marker.slice(2, -1)));
        for (const marker of markers) expect(text).toContain(`\`${marker}\``);
        expect(text).not.toContain(":::info");
        expect(text).not.toContain("unknown alert types");
    });

    it("does not describe fenced info or warn boxes in the content-format summary", () => {
        expect(read("docs/content-format.md")).not.toMatch(/`:::info`|`:::warn`/);
    });
});
