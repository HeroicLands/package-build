/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **Mapping notes.** How a map rewrites text — the longest match, each
 * condition, pass-through and an empty `to` — what the lint says about a
 * malformed `data.map`, each finding at its key, and that `A` and `a` stay
 * two rows of the `maps` relation.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";

import { scanRuns } from "../engine/content-scripts.mjs";
import { collectContentIndex } from "../engine/content-index.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { openNotesDatabase } from "../engine/sql-tables.mjs";
import { MAP_COLUMNS, applyMap, compileMap, mapsFromRecords } from "../engine/text-maps.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const apply = (map: object, text: string) => applyMap(compileMap(map), text).text;

describe("applying a map", () => {
    it("takes the longest match", () => {
        const map = {
            name: "m",
            rows: [
                ["t", "1"],
                ["th", "2"],
                ["thr", "3"],
                ["h", "4"],
            ],
        };
        expect(apply(map, "th thr t h")).toBe("2 3 1 4");
    });

    it("writes and reads plane-15 code points whole, longest match first", () => {
        const map = compileMap({
            name: "m",
            vowels: "a",
            rows: [
                ["a", "\u{F0230}"],
                ["\u{F0201}", "b"],
                ["\u{F0201}\u{F0202}", "c"],
                { from: "y", to: "\u{F0237}", before: "consonant" },
            ],
        });
        expect(applyMap(map, "a\u{F0201}\u{F0202}\u{F0201}yt\u{F0203}")).toEqual({
            text: "\u{F0230}cb\u{F0237}t\u{F0203}",
            pieces: [
                { at: 0, from: "a", to: "\u{F0230}", row: true },
                { at: 1, from: "\u{F0201}\u{F0202}", to: "c", row: true },
                { at: 5, from: "\u{F0201}", to: "b", row: true },
                { at: 7, from: "y", to: "\u{F0237}", row: true },
                { at: 8, from: "t", to: "t", row: false },
                { at: 9, from: "\u{F0203}", to: "\u{F0203}", row: false },
            ],
        });
    });

    it("reads a row's plane-15 code point from a `\\U` escape", () => {
        const { map } = YAML.parse('map: {name: m, rows: [[a, "\\U000F0200"]]}');
        expect(apply(map, "a")).toBe("\u{F0200}");
    });

    it("passes a character no row matches through unchanged", () => {
        expect(apply({ name: "m", rows: [["a", "A"]] }, "a b, c!")).toBe("A b, c!");
    });

    it("writes nothing for an empty `to`", () => {
        expect(
            apply(
                {
                    name: "m",
                    rows: [
                        ["a", ""],
                        ["e", ""],
                    ],
                },
                "anlagh gera",
            ),
        ).toBe("nlgh gr");
    });

    it("keeps rows that differ only in case apart", () => {
        expect(
            apply(
                {
                    name: "m",
                    rows: [
                        ["A", "1"],
                        ["a", "2"],
                    ],
                },
                "Aa",
            ),
        ).toBe("12");
    });

    it("reads `before: vowel` and `before: consonant` from the map's vowels", () => {
        const map = {
            name: "m",
            vowels: "aeiou",
            rows: [
                ["y", "Y"],
                { from: "y", to: "I", before: "consonant" },
                { from: "y", to: "J", before: "vowel" },
            ],
        };
        expect(apply(map, "ya yt y. y")).toBe("Ja It Y. Y");
    });

    it("reads `at: start` and `at: end` at the edges, whitespace and punctuation", () => {
        const map = {
            name: "m",
            rows: [
                ["a", "a"],
                { from: "a", to: "S", at: "start" },
                { from: "a", to: "E", at: "end" },
            ],
        };
        expect(apply(map, "aba (aba) bab")).toBe("SbE (SbE) bab");
    });

    it("skips a row whose condition fails, for the next one that holds", () => {
        const map = {
            name: "m",
            vowels: "a",
            rows: [{ from: "ch", to: "X", before: "vowel" }, ["c", "c"], ["h", "h"]],
        };
        expect(apply(map, "cha chb")).toBe("Xa chb");
    });

    it("says where each piece came from", () => {
        const map = compileMap({
            name: "m",
            rows: [
                ["th", "T"],
                ["a", ""],
            ],
        });
        expect(applyMap(map, "tha b").pieces).toEqual([
            { at: 0, from: "th", to: "T", row: true },
            { at: 2, from: "a", to: "", row: true },
            { at: 3, from: " ", to: " ", row: false },
            { at: 4, from: "b", to: "b", row: false },
        ]);
    });
});

describe("a run through a plane-15 map", () => {
    const face = {
        slug: "f",
        family: "F",
        class: "hl-f",
        direction: "ltr",
        features: [],
        draws: new Set([0xf0200]),
    };
    const maps = mapsFromRecords([
        {
            type: "doc",
            data: {
                map: {
                    name: "m",
                    rows: [
                        ["ka", "\u{F0200}"],
                        ["t", "\u{F0201}"],
                    ],
                },
            },
        },
    ]);

    it("locates an undrawn plane-15 character at the character it came from, in UTF-16 columns", () => {
        const source = "Said [ka t ka \u{F0205} x]{font=f map=m lang=und .nativefont}.";
        const found = scanRuns(source, { faces: new Map([["f", face]]), maps });
        expect(found.errors).toEqual([
            {
                line: 1,
                column: source.indexOf("t ka") + 1,
                message: "`t` maps to U+F0201 in the map `m`, which the font `f` does not draw",
            },
            {
                line: 1,
                column: source.indexOf("\u{F0205}") + 1,
                message:
                    "`\u{F0205}` (U+F0205) is not drawn by the font `f`, and the map `m` has no row for it",
            },
            {
                line: 1,
                column: 18,
                message:
                    "`x` (U+0078) is not drawn by the font `f`, and the map `m` has no row for it",
            },
        ]);
    });
});

describe("a run through a map", () => {
    const face = {
        slug: "f",
        family: "F",
        class: "hl-f",
        direction: "ltr",
        features: [],
        draws: new Set([0xf0200, 0xf0201]),
    };
    const maps = mapsFromRecords([
        {
            type: "doc",
            data: {
                map: {
                    name: "m",
                    rows: [
                        ["ka", "\u{F0200}"],
                        ["t", "\u{F0201}"],
                    ],
                },
            },
        },
    ]);

    it("locates an undrawn character at the source character it came from", () => {
        const found = scanRuns("Said [ka t\\*ka x]{font=f map=m lang=und .nativefont}.", {
            faces: new Map([["f", face]]),
            maps,
        });
        expect(found.errors).toEqual([
            {
                line: 1,
                column: 12,
                message:
                    "`*` (U+002A) is not drawn by the font `f`, and the map `m` has no row for it",
            },
            {
                line: 1,
                column: 16,
                message:
                    "`x` (U+0078) is not drawn by the font `f`, and the map `m` has no row for it",
            },
        ]);
    });
});

/** The lint's findings for a doc note's `data`, as `line:column: message`. */
const lint = (data: { map?: Record<string, unknown> }, index?: object) => {
    // Every map lists a face, last, so the other keys keep their lines.
    const listed =
        data.map && !("fonts" in data.map) ?
            { ...data, map: { ...data.map, fonts: [{ font: "semaron-kuriale" }] } }
        :   data;
    const fm = {
        type: "doc",
        subType: "reference",
        shortcode: "m",
        name: { full: "M" },
        data: listed,
    };
    return lintNote(
        { file: "map.md", fm, type: "doc", raw: `---\n${YAML.stringify(fm)}---\n` },
        {
            schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
            vocabulary: NOTE_VOCABULARY,
            index,
        },
    )
        .filter((finding: { message: string }) => finding.message.includes("data.map"))
        .map(
            (finding: { line?: number; column?: number; message: string }) =>
                `${finding.line}:${finding.column}: ${finding.message}`,
        );
};

describe("the lint of `data.map`", () => {
    it("accepts a well-formed map", () => {
        expect(
            lint({
                map: {
                    name: "vyl-semaron",
                    vowels: "aeiou",
                    rows: [
                        ["a", "\u{F0230}"],
                        { from: "y", to: "\u{F0237}", before: "consonant" },
                        ["'", ""],
                    ],
                },
            }),
        ).toEqual([]);
    });

    it("reports a malformed name", () => {
        expect(lint({ map: { name: "Vyl_Semaron", rows: [] } })).toEqual([
            "9:11: `data.map.name` is `Vyl_Semaron`; a map's name is lowercase letters, digits and `-`",
        ]);
    });

    it("reports each malformed row at the row, its key or its value", () => {
        expect(
            lint({
                map: {
                    name: "m",
                    vowels: "a",
                    rows: [
                        ["a"],
                        ["", "x"],
                        "a",
                        { from: "a" },
                        { to: "x" },
                        { from: "a", to: "b", when: "start" },
                        { from: "a", to: "b", before: "liquid" },
                        { from: "a", to: "b", at: "middle" },
                        { from: "a", to: "" },
                    ],
                },
            }),
        ).toEqual([
            '15:9: `data.map.rows[2]` should be `[from, to]` or `{ from, to, before?, at? }`, but reads "a"',
            "16:9: `data.map.rows[3]` must state `to` — a string, which may be empty",
            "17:9: `data.map.rows[4]` must state `from` — a string of one or more characters",
            '20:9: "when" is not a key of `data.map.rows[5]`; it takes only `from`, `to`, `before`, `at`',
            '23:17: `data.map.rows[6].before` should be `vowel` or `consonant`, but reads "liquid"',
            '26:13: `data.map.rows[7].at` should be `start` or `end`, but reads "middle"',
            "12:9: `data.map.rows[0]` is a list, and a row written as a list is two strings, `[from, to]`",
            "13:9: `data.map.rows[1]` has an empty `from`; a row matches one or more characters",
        ]);
    });

    it("reports `before` on a map that states no vowels", () => {
        expect(
            lint({ map: { name: "m", rows: [{ from: "y", to: "i", before: "consonant" }] } }),
        ).toEqual([
            "13:9: `data.map.rows[0]` has `before: consonant`, and the map states no `vowels` to read it by",
        ]);
    });

    it("reports a name another note declares", () => {
        const index = {
            notes: [
                { file: "map.md", fm: { data: { map: { name: "m" } } } },
                { file: "other.md", fm: { data: { map: { name: "m" } } } },
            ],
        };
        expect(lint({ map: { name: "m", rows: [] } }, index)).toEqual([
            "9:11: `data.map.name` is `m`, which other.md also declares; a map's name is unique",
        ]);
    });

    it("reports a key the map does not declare, and a missing one", () => {
        expect(lint({ map: { name: "m", row: [] } })).toEqual([
            '10:5: "row" is not a key of `data.map`; it takes only `name`, `logographic`, `vowels`, `rows`, `fonts`. Did you mean "rows"?',
            "8:3: `data.map` must state `rows` — list of `[from, to]` or `{ from, to, before?, at? }`",
        ]);
    });
});

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("the maps relation", () => {
    it("keeps rows that differ only in case as rows, with their conditions and their face", async () => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maps-index-")));
        roots.push(root);
        const content = path.join(root, "demo");
        fs.mkdirSync(content, { recursive: true });
        const fm = {
            type: "doc",
            subType: "reference",
            shortcode: "vylsemaron",
            name: { full: "Vylari in Semaron" },
            data: {
                map: {
                    name: "vyl-semaron",
                    vowels: "aeiouAEIOU",
                    rows: [
                        ["A", "\u{F0200}"],
                        ["a", "\u{F0230}"],
                        { from: "y", to: "\u{F0237}", before: "consonant" },
                    ],
                    fonts: [{ font: "semaron-kuriale", rows: [["a", ""]] }],
                },
            },
        };
        fs.writeFileSync(
            path.join(content, "Map.md"),
            `---\n${YAML.stringify(fm)}---\n\nVylari spelled in Semaron Kuriale.\n`,
        );
        const records = collectContentIndex(content, {
            contentPackage: "demo",
            skipDirectories: [],
        });
        expect([...mapsFromRecords(records).keys()]).toEqual(["vyl-semaron"]);
        const db = await openNotesDatabase(records);
        try {
            const schema = await db.query("DESCRIBE maps");
            expect(schema.rows.map((row: { column_name: string }) => row.column_name)).toEqual([
                ...MAP_COLUMNS,
            ]);
            expect(
                (await db.query('SELECT * FROM maps ORDER BY font NULLS FIRST, "row"')).rows,
            ).toEqual([
                {
                    owner: "demo-note-doc-vylsemaron",
                    name: "vyl-semaron",
                    font: null,
                    row: 1n,
                    from: "A",
                    to: "\u{F0200}",
                    before: null,
                    at: null,
                },
                {
                    owner: "demo-note-doc-vylsemaron",
                    name: "vyl-semaron",
                    font: null,
                    row: 2n,
                    from: "a",
                    to: "\u{F0230}",
                    before: null,
                    at: null,
                },
                {
                    owner: "demo-note-doc-vylsemaron",
                    name: "vyl-semaron",
                    font: null,
                    row: 3n,
                    from: "y",
                    to: "\u{F0237}",
                    before: "consonant",
                    at: null,
                },
                {
                    owner: "demo-note-doc-vylsemaron",
                    name: "vyl-semaron",
                    font: "semaron-kuriale",
                    row: 1n,
                    from: "a",
                    to: "",
                    before: null,
                    at: null,
                },
            ]);
        } finally {
            await db.close();
        }
    });

    it("has its typed columns when no note declares a map", async () => {
        const db = await openNotesDatabase([]);
        try {
            const schema = await db.query("DESCRIBE maps");
            expect(
                schema.rows.map(({ column_name, column_type }: any) => [column_name, column_type]),
            ).toEqual([
                ["owner", "VARCHAR"],
                ["name", "VARCHAR"],
                ["font", "VARCHAR"],
                ["row", "BIGINT"],
                ["from", "VARCHAR"],
                ["to", "VARCHAR"],
                ["before", "VARCHAR"],
                ["at", "VARCHAR"],
            ]);
        } finally {
            await db.close();
        }
    });
});
