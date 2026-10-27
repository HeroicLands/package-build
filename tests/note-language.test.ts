/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectContentIndex } from "../engine/content-index.mjs";

/**
 * A note's language, derived at indexing: its own `data.lang`; else its
 * `data.culture`'s language; else its `data.parents`, nearest first, each
 * resolved by these same rules; else `en`. The codes are the parity fixture's
 * configured `languages:`, read rather than copied.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_LANGUAGES: Record<string, { tag: string; note?: string }> = YAML.parse(
    fs.readFileSync(path.join(here, "fixtures/parity/package-build.config.yaml"), "utf8"),
).languages;
const CODES = Object.keys(FIXTURE_LANGUAGES).filter((code) => code !== "en");
const [FIRST, SECOND, THIRD] = CODES;

const PKG = "langs";
let tmp: string;
let content: string;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "note-language-"));
    content = path.join(tmp, "content");
    fs.mkdirSync(content);
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

/** Write a note whose frontmatter is the given lines, with a one-line body. */
function note(rel: string, ...lines: string[]): string {
    const file = path.join(content, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `---\n${lines.join("\n")}\n---\n\nBody.\n`);
    return file;
}

function collect(problems: any[] = []) {
    return collectContentIndex(content, {
        contentPackage: PKG,
        skipDirectories: [],
        languages: FIXTURE_LANGUAGES,
        problems,
    });
}

function langOf(records: any[], type: string, shortcode: string): unknown {
    const record = records.find(
        (r) => r.type === type && r.shortcode === shortcode && !r.documents,
    );
    if (!record) throw new Error(`no ${type} record for ${shortcode}`);
    return record.lang;
}

describe("the fixture declares enough languages to tell the rules apart", () => {
    it("has three codes besides en", () => {
        expect(CODES.length).toBeGreaterThanOrEqual(3);
    });
});

describe("a note's derived language", () => {
    it("is its own data.lang", () => {
        note(
            "Beings/ada.md",
            "type: being",
            "subType: npc",
            "shortcode: ada",
            `data: {lang: ${FIRST}, archetypes: [commoner]}`,
        );
        const problems: any[] = [];
        expect(langOf(collect(problems), "being", "ada")).toBe(FIRST);
        expect(problems).toEqual([]);
    });

    it("is its culture's language", () => {
        note(
            "Lore/folk.md",
            "type: lore",
            "subType: culture",
            "shortcode: folk",
            `data: {lang: ${SECOND}}`,
        );
        note(
            "Beings/ada.md",
            "type: being",
            "subType: npc",
            "shortcode: ada",
            "data: {culture: lore-folk, archetypes: [commoner]}",
        );
        const problems: any[] = [];
        const records = collect(problems);
        expect(langOf(records, "being", "ada")).toBe(SECOND);
        expect(langOf(records, "lore", "folk")).toBe(SECOND);
        expect(problems).toEqual([]);
    });

    it("takes its culture before its parents", () => {
        note(
            "Lore/folk.md",
            "type: lore",
            "subType: culture",
            "shortcode: folk",
            `data: {lang: ${SECOND}}`,
        );
        note("Places/realm.md", "type: place", "shortcode: realm", `data: {lang: ${THIRD}}`);
        note(
            "Places/town.md",
            "type: place",
            "shortcode: town",
            "data: {culture: lore-folk, parents: [realm]}",
        );
        expect(langOf(collect(), "place", "town")).toBe(SECOND);
    });

    it("follows a two-level parents chain, nearest first", () => {
        note("Places/realm.md", "type: place", "shortcode: realm", `data: {lang: ${THIRD}}`);
        note("Places/march.md", "type: place", "shortcode: march", "data: {parents: [realm]}");
        note("Places/town.md", "type: place", "shortcode: town", "data: {parents: [march]}");
        note("Places/other.md", "type: place", "shortcode: other", `data: {lang: ${FIRST}}`);
        note("Places/fort.md", "type: place", "shortcode: fort", "data: {parents: [march, other]}");
        const problems: any[] = [];
        const records = collect(problems);
        expect(langOf(records, "place", "march")).toBe(THIRD);
        expect(langOf(records, "place", "town")).toBe(THIRD);
        expect(langOf(records, "place", "fort")).toBe(THIRD);
        expect(problems).toEqual([]);
    });

    it("passes over a parent that resolves to nothing", () => {
        note("Places/wild.md", "type: place", "shortcode: wild", "data: {}");
        note("Places/realm.md", "type: place", "shortcode: realm", `data: {lang: ${THIRD}}`);
        note("Places/town.md", "type: place", "shortcode: town", "data: {parents: [wild, realm]}");
        const records = collect();
        expect(langOf(records, "place", "town")).toBe(THIRD);
        expect(langOf(records, "place", "wild")).toBe("en");
    });

    it("reads a culture's language through its parent cultures", () => {
        note(
            "Lore/elder.md",
            "type: lore",
            "subType: culture",
            "shortcode: elder",
            `data: {lang: ${FIRST}}`,
        );
        note(
            "Lore/young.md",
            "type: lore",
            "subType: culture",
            "shortcode: young",
            "data: {parents: [lore-elder]}",
        );
        note(
            "Affiliations/guild.md",
            "type: affiliation",
            "subType: guild",
            "shortcode: guild",
            "data: {culture: lore-young}",
        );
        const problems: any[] = [];
        const records = collect(problems);
        expect(langOf(records, "lore", "young")).toBe(FIRST);
        expect(langOf(records, "affiliation", "guild")).toBe(FIRST);
        expect(problems).toEqual([]);
    });

    it("falls back to en", () => {
        note("Lore/tale.md", "type: lore", "shortcode: tale", "name: {full: A Tale}");
        note("Docs/guide.md", "type: doc", "shortcode: guide", "name: {full: Guide}");
        const records = collect();
        expect(langOf(records, "lore", "tale")).toBe("en");
        expect(langOf(records, "doc", "guide")).toBe("en");
    });

    it("accepts en as a stated code although the configuration need not declare it", () => {
        note("Lore/tale.md", "type: lore", "shortcode: tale", "data: {lang: en}");
        const problems: any[] = [];
        expect(langOf(collect(problems), "lore", "tale")).toBe("en");
        expect(problems).toEqual([]);
    });

    it("reports each parents entry on a cycle, at the entry, and does not hang", () => {
        const a = note("Places/a.md", "type: place", "shortcode: a", "data: {parents: [b]}");
        const b = note("Places/b.md", "type: place", "shortcode: b", "data: {parents: [a]}");
        const problems: any[] = [];
        const records = collect(problems);
        expect(langOf(records, "place", "a")).toBe("en");
        expect(langOf(records, "place", "b")).toBe("en");
        const cycles = problems.filter((p) => /cycle/.test(p.message));
        expect(cycles.map((p) => [p.file, p.line, p.column, p.severity])).toEqual([
            [a, 4, 18, "error"],
            [b, 4, 18, "error"],
        ]);
    });

    it("reports a cycle a culture's language keeps the walk from reaching", () => {
        note(
            "Lore/folk.md",
            "type: lore",
            "subType: culture",
            "shortcode: folk",
            `data: {lang: ${FIRST}}`,
        );
        const order = note(
            "Affiliations/order.md",
            "type: affiliation",
            "subType: order",
            "shortcode: order",
            "data: {culture: lore-folk, parents: [order]}",
        );
        const problems: any[] = [];
        expect(langOf(collect(problems), "affiliation", "order")).toBe(FIRST);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatchObject({ file: order, severity: "error" });
        expect(problems[0].message).toMatch(/closes a parents cycle/);
    });

    it("reports a data.lang that names no declared code, at its value", () => {
        const file = note("Lore/tale.md", "type: lore", "shortcode: tale", "data: {lang: zzq}");
        const problems: any[] = [];
        const records = collect(problems);
        expect(langOf(records, "lore", "tale")).toBe("en");
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatchObject({ file, line: 4, column: 14, severity: "error" });
        expect(problems[0].message).toContain("zzq");
    });

    it("reports a culture that resolves to no language, at the note's data.culture value", () => {
        note("Lore/folk.md", "type: lore", "subType: culture", "shortcode: folk", "data: {}");
        const file = note(
            "Beings/ada.md",
            "type: being",
            "subType: npc",
            "shortcode: ada",
            "data: {culture: lore-folk, archetypes: [commoner]}",
        );
        const problems: any[] = [];
        const records = collect(problems);
        expect(langOf(records, "being", "ada")).toBe("en");
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatchObject({ file, line: 5, column: 17, severity: "error" });
        expect(problems[0].message).toContain("lore-folk");
    });

    it("is published on every note record", () => {
        note("Lore/tale.md", "type: lore", "shortcode: tale");
        note("Places/realm.md", "type: place", "shortcode: realm", `data: {lang: ${THIRD}}`);
        const notes = collect().filter((r: any) => typeof r.shortcode === "string" && !r.asset);
        expect(notes.length).toBeGreaterThan(0);
        for (const record of notes) expect(typeof record.lang).toBe("string");
    });
});
