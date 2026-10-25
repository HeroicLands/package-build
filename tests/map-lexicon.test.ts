/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A mapped run reads its language's dictionary first.** A word whose lexicon
 * entry states a native form for the run's map, and for its font where one is
 * stated, is written by it; every other word, and everything between words,
 * is spelled by the rows, the font's own rows before the shared ones. The
 * checks on `data.map.fonts` and on a word's `native`, the `natives` relation,
 * and the `transliterate` and `lexicon` commands, which share the build's code
 * path.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import YAML from "yaml";

import { renderRuns, runContext, scanRuns } from "../engine/content-scripts.mjs";
import { collectContentIndex } from "../engine/content-index.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import {
    NATIVE_COLUMNS,
    checkLexiconNatives,
    checkMapFonts,
    languageNoteFindings,
    lexiconEntries,
    transliterate,
} from "../engine/map-lexicon.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { openNotesDatabase } from "../engine/sql-tables.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { SUBPROCESS_TEST_TIMEOUT, subprocessTimeout } from "./subprocess-timeout.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "..", "bin", "package-build.mjs");

/** A face drawing the given characters. */
const face = (slug: string, chars: string) => ({
    slug,
    family: slug,
    class: `hl-${slug}`,
    direction: "ltr",
    features: [],
    draws: new Set(Array.from(chars, (char) => char.codePointAt(0))),
});

/** The roman letters of the test map, each on its own code point. */
const LETTERS = "zaronkl";
const P = (char: string) => String.fromCodePoint(0xf0200 + LETTERS.indexOf(char));
const CAP = (char: string) => String.fromCodePoint(0xf0210 + LETTERS.indexOf(char));
/** The rows' spelling of a lowercase word. */
const rowsOf = (word: string) => Array.from(word, P).join("");

/** The mapping note's `data.map`: shared rows, and `g` writes `o` its own way. */
const MAP = {
    name: "m",
    vowels: "aeiou",
    fonts: [{ font: "f" }, { font: "g", rows: [["o", "\u{F0224}"]] }],
    rows: [
        ...Array.from(LETTERS, (char) => [char, P(char)]),
        ...Array.from(LETTERS, (char) => [char.toUpperCase(), CAP(char)]),
    ],
};

/** `zaron` is an exception in every font, and its native form starts as the rows do. */
const ZARON_NATIVE = `${P("z")}\u{F02F0}${P("n")}`;
/** `karalzon` is an exception in the font `g` only. */
const KARALZON_G = "\u{F02F1}";
/** `orlan` is an exception whose native form does not start as the rows do. */
const ORLAN_NATIVE = "\u{F02F2}";

const WORDS = [
    {
        form: "zaron",
        class: "n",
        field: "Law",
        gloss: "an oath",
        native: [{ map: "m", text: ZARON_NATIVE }],
    },
    {
        form: "karalzon",
        class: "n",
        field: "Law",
        gloss: "the kept fire",
        native: [{ map: "m", font: "g", text: KARALZON_G }],
    },
    {
        form: "orlan",
        class: "n",
        field: "Law",
        gloss: "a gate",
        native: [{ map: "m", text: ORLAN_NATIVE }],
    },
    { form: "lonak", class: "n", field: "Law", gloss: "a road" },
];

const languageRecord = {
    type: "skill",
    subType: "language",
    shortcode: "vylarilng",
    address: { canonical: "demo-note-skill-vylarilng" },
    data: {
        roman: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ,",
        fields: [{ name: "Law", holds: "law" }],
        grammar: { plural: [{ ending: "", becomes: "s" }] },
        words: WORDS,
    },
};
const mapRecord = {
    type: "doc",
    subType: "reference",
    shortcode: "mapm",
    address: { canonical: "demo-note-doc-mapm" },
    data: { map: MAP },
};

const ALL = Array.from(LETTERS, P).join("") + Array.from(LETTERS, CAP).join("") + ",s";
const config = {
    contentPackage: "demo",
    languages: {
        vyl: { tag: "art-x-vyl", note: "skill-vylarilng" },
        khel: { tag: "art-x-khel" },
    },
};

const ctx = {
    ...runContext(config, [languageRecord, mapRecord]),
    faces: new Map([
        ["f", face("f", ALL + ZARON_NATIVE + ORLAN_NATIVE)],
        ["g", face("g", ALL + ZARON_NATIVE + ORLAN_NATIVE + KARALZON_G + "\u{F0224}")],
    ]),
};

/** The set text inside the one span a source renders to. */
const built = (source: string) => {
    const out = renderRuns(source, ctx).markdown;
    const inner = /\[(.*)\]\{/.exec(out)?.[1];
    return (inner ?? out).replace(/\\(.)/g, "$1");
};

describe("a mapped run with a language", () => {
    it("writes an exception by the lexicon and every other word by the rows", () => {
        expect(built("[zaron lonak]{lang=vyl font=f map=m .nativefont}")).toBe(
            `${ZARON_NATIVE} ${rowsOf("lonak")}`,
        );
    });

    it("spells a derived form by the rows", () => {
        expect(built("[zarons]{lang=vyl font=f map=m .nativefont}")).toBe(rowsOf("zaron") + "s");
    });

    it("takes a native form stated for the run's font over the shared one, and only in that font", () => {
        expect(built("[karalzon]{lang=vyl font=g map=m .nativefont}")).toBe(KARALZON_G);
        expect(built("[karalzon]{lang=vyl font=f map=m .nativefont}")).toBe(rowsOf("karalzon"));
    });

    it("tries the font's own rows before the shared rows", () => {
        expect(built("[lonak]{lang=vyl font=g map=m .nativefont}")).toBe(
            `${P("l")}\u{F0224}${P("n")}${P("a")}${P("k")}`,
        );
    });

    it("capitalises an exception by mapping its capital through the rows", () => {
        expect(built("[Zaron lonak]{lang=vyl font=f map=m .nativefont}")).toBe(
            `${CAP("z")}\u{F02F0}${P("n")} ${rowsOf("lonak")}`,
        );
    });

    it("refuses a capitalised exception the rows cannot capitalise, at the word", () => {
        expect(
            scanRuns("Said [lonak Orlan]{lang=vyl font=f map=m .nativefont}.", ctx).errors.map(
                (error: { line: number; column: number; message: string }) =>
                    `${error.line}:${error.column}: ${error.message}`,
            ),
        ).toEqual([
            "1:13: `Orlan` is capitalised, and the native form the lexicon of `vyl` states for `orlan` under the map `m` does not begin as the rows spell its first letter, so the rows cannot capitalise it; state `Orlan` as a word of its own with its native form",
        ]);
        expect(transliterate(ctx, { map: "m", lang: "vyl", font: "f" }, "Orlan")).toMatchObject({
            problem:
                "`Orlan` is capitalised, and the native form the lexicon of `vyl` states for `orlan` under the map `m` does not begin as the rows spell its first letter, so the rows cannot capitalise it; state `Orlan` as a word of its own with its native form",
        });
    });

    it("writes a capitalised exception stated as a word of its own, with no finding", () => {
        const stated = {
            ...runContext(config, [
                {
                    ...languageRecord,
                    data: {
                        ...languageRecord.data,
                        words: [
                            ...WORDS,
                            {
                                form: "Orlan",
                                class: "n",
                                field: "Law",
                                gloss: "the Gate",
                                native: [{ map: "m", text: "\u{F02F3}" }],
                            },
                        ],
                    },
                },
                mapRecord,
            ]),
            faces: new Map([["f", face("f", ALL + ZARON_NATIVE + ORLAN_NATIVE + "\u{F02F3}")]]),
        };
        expect(scanRuns("[Orlan]{lang=vyl font=f map=m .nativefont}", stated).errors).toEqual([]);
        expect(transliterate(stated, { map: "m", lang: "vyl", font: "f" }, "Orlan")).toEqual({
            text: "\u{F02F3}",
        });
    });

    it("finds an exception written exactly before trying it in lowercase", () => {
        expect(built("[ZARON]{lang=vyl font=f map=m .nativefont}")).toBe(
            `${CAP("z")}\u{F02F0}${P("n")}`,
        );
    });

    it("spells every word by the rows with `map=` and no `lang=`", () => {
        expect(built("[zaron lonak]{font=f map=m lang=und .nativefont}")).toBe(
            `${rowsOf("zaron")} ${rowsOf("lonak")}`,
        );
    });

    it("spells every word by the rows for a language with no `note`", () => {
        expect(built("[zaron]{lang=khel font=f map=m .nativefont}")).toBe(rowsOf("zaron"));
    });

    it("locates a character the face lacks inside an exception at the word's start", () => {
        const narrow = { ...ctx, faces: new Map([["f", face("f", ALL)]]) };
        expect(
            scanRuns("Said [lonak zaron]{lang=vyl font=f map=m .nativefont}.", narrow).errors.map(
                (error: { line: number; column: number; message: string }) =>
                    `${error.line}:${error.column}: ${error.message}`,
            ),
        ).toEqual([
            "1:13: `zaron` is written U+F02F0 by the lexicon of `vyl` for the map `m`, which the font `f` does not draw",
        ]);
    });

    it("writes a plane-15 exception and locates a plane-15 code point the face lacks", () => {
        const plane15 = {
            ...runContext(config, [
                {
                    ...languageRecord,
                    data: {
                        ...languageRecord.data,
                        words: [
                            {
                                form: "orlan",
                                class: "n",
                                gloss: "a gate",
                                native: [{ map: "m", text: "\u{F0200}\u{F02F3}" }],
                            },
                            { form: "lonak", class: "n", gloss: "a road" },
                        ],
                    },
                },
                mapRecord,
            ]),
            faces: new Map([["f", face("f", ALL + "\u{F0200}")]]),
        };
        expect(transliterate(plane15, { map: "m", lang: "vyl", font: "f" }, "orlan")).toEqual({
            text: "\u{F0200}\u{F02F3}",
        });
        expect(
            scanRuns("Said [lonak orlan]{lang=vyl font=f map=m .nativefont}.", plane15).errors.map(
                (error: { line: number; column: number; message: string }) =>
                    `${error.line}:${error.column}: ${error.message}`,
            ),
        ).toEqual([
            "1:13: `orlan` is written U+F02F3 by the lexicon of `vyl` for the map `m`, which the font `f` does not draw",
        ]);
    });

    it("refuses a font the map is not for, at the run's `map=`", () => {
        const wide = { ...ctx, faces: new Map([...ctx.faces, ["h", face("h", ALL)]]) };
        expect(
            scanRuns("Said [lonak]{lang=vyl font=h map=m .nativefont}.", wide).errors.map(
                (error: { line: number; column: number; message: string }) =>
                    `${error.line}:${error.column}: ${error.message}`,
            ),
        ).toEqual(["1:34: `h` is not a font of the map `m`; it is for `f` and `g`"]);
    });
});

describe("transliterate and the lexicon share the build's path", () => {
    it("gives the native text a build of the same run gives", () => {
        for (const font of ["f", "g"]) {
            const source = `[Zaron karalzon lonak, orlan]{lang=vyl font=${font} map=m .nativefont}`;
            expect(
                transliterate(ctx, { map: "m", lang: "vyl", font }, "Zaron karalzon lonak, orlan"),
            ).toEqual({ text: built(source) });
            const listed = lexiconEntries(ctx, { lang: "vyl", map: "m", font });
            expect("entries" in listed && listed.entries.map((entry: any) => entry.native)).toEqual(
                WORDS.map((word) =>
                    built(`[${word.form}]{lang=vyl font=${font} map=m .nativefont}`),
                ),
            );
        }
    });

    it("lists every word in order, with its gloss, class and whether it is an exception", () => {
        expect(lexiconEntries(ctx, { lang: "vyl", map: "m", font: "f" })).toEqual({
            entries: [
                {
                    form: "zaron",
                    native: ZARON_NATIVE,
                    exception: true,
                    class: "n",
                    gloss: "an oath",
                },
                {
                    form: "karalzon",
                    native: rowsOf("karalzon"),
                    exception: false,
                    class: "n",
                    gloss: "the kept fire",
                },
                {
                    form: "orlan",
                    native: ORLAN_NATIVE,
                    exception: true,
                    class: "n",
                    gloss: "a gate",
                },
                {
                    form: "lonak",
                    native: rowsOf("lonak"),
                    exception: false,
                    class: "n",
                    gloss: "a road",
                },
            ],
        });
    });

    it("says what is wrong with an unknown map, language or font", () => {
        expect(transliterate(ctx, { map: "q", font: "f" }, "x")).toMatchObject({
            problem:
                "`q` is not a map: a map is named by the `data.map.name` of a mapping note; did you mean `m`?",
        });
        expect(transliterate(ctx, { map: "m", lang: "zz", font: "f" }, "x")).toMatchObject({
            problem: "`zz` is not a declared language (`languages` in package-build.config.yaml)",
        });
        expect(transliterate(ctx, { map: "m" }, "x")).toMatchObject({
            problem: "the map `m` is for `f` and `g`; name one with `--font`",
        });
        expect(transliterate(ctx, { map: "m", font: "h" }, "x")).toMatchObject({
            problem: "`h` is not a font of the map `m`; it is for `f` and `g`",
        });
    });
});

/** A lint note from frontmatter, with its raw text, so findings are located. */
const noteOf = (file: string, fm: object) => ({
    file,
    fm,
    raw: `---\n${YAML.stringify(fm)}---\n`,
});
const located = (findings: Array<{ line?: number; column?: number; message: string }>) =>
    findings.map((finding) => `${finding.line}:${finding.column}: ${finding.message}`);

const languageNote = (words: object[]) =>
    noteOf("Vylari.md", {
        type: "skill",
        subType: "language",
        shortcode: "vylarilng",
        name: { full: "Vylari" },
        data: { fields: [{ name: "Law", holds: "law" }], words },
    });

describe("the checks on a word's `native`", () => {
    it("accepts exceptions that differ from the rows", () => {
        expect(checkLexiconNatives(languageNote(WORDS), ctx)).toEqual([]);
    });

    it("reports a native form that states what the rows already give", () => {
        expect(
            located(
                checkLexiconNatives(
                    languageNote([
                        {
                            form: "lonak",
                            class: "n",
                            field: "Law",
                            gloss: "a road",
                            native: [{ map: "m", font: "f", text: rowsOf("lonak") }],
                        },
                        // Equal to the shared rows, which `f` uses for `o`; not to `g`'s.
                        {
                            form: "zon",
                            class: "n",
                            field: "Law",
                            gloss: "fire",
                            native: [{ map: "m", text: rowsOf("zon") }],
                        },
                        {
                            form: "zan",
                            class: "n",
                            field: "Law",
                            gloss: "ash",
                            native: [{ map: "m", text: rowsOf("zan") }],
                        },
                    ]),
                    ctx,
                ),
            ),
        ).toEqual([
            "17:11: `data.words[0].native[0]` states what the rows already give: the map `m` spells `lonak` so in the font `f`; a native form is stated only where the rows spell the word differently",
            "32:11: `data.words[2].native[0]` states what the rows already give: the map `m` spells `zan` so in every font it is for; a native form is stated only where the rows spell the word differently",
        ]);
    });

    it("reports an unknown map, a font the map is not for, a second form and an undrawn character", () => {
        expect(
            located(
                checkLexiconNatives(
                    languageNote([
                        {
                            form: "zaron",
                            class: "n",
                            field: "Law",
                            gloss: "an oath",
                            native: [
                                { map: "n", text: "\u{F02F0}" },
                                { map: "m", font: "h", text: "\u{F02F0}" },
                                { map: "m", text: ZARON_NATIVE },
                                { map: "m", text: "\u{F02F3}" },
                            ],
                        },
                    ]),
                    ctx,
                ),
            ),
        ).toEqual([
            "17:16: `data.words[0].native[0].map` is `n`, which is not a map: a native form names the `data.map.name` of a mapping note; did you mean `m`?",
            "20:17: `data.words[0].native[1].font` is `h`, which is not a font of the map `m`; it is for `f` and `g`",
            "24:11: `data.words[0].native[3]` states a second native form for the map `m`; the first is `data.words[0].native[2]`",
            "24:11: `data.words[0].native[3]` holds U+F02F3, which the font `f`, listed in the map `m`, does not draw",
            "24:11: `data.words[0].native[3]` holds U+F02F3, which the font `g`, listed in the map `m`, does not draw",
        ]);
    });

    it("refuses a malformed `native`, at the key", () => {
        const note = languageNote([
            {
                form: "zaron",
                class: "n",
                field: "Law",
                gloss: "an oath",
                native: [{ map: "m" }, { text: "x", map: "m", glyph: "y" }],
            },
        ]);
        const findings = lintNote(
            { ...note, type: "skill" },
            { schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS }, vocabulary: NOTE_VOCABULARY },
        ).filter((finding: { message: string }) => finding.message.includes("native"));
        expect(located(findings)).toEqual([
            "17:11: `data.words[0].native[0]` must state `text` — the word in the script, as the map's characters",
            '20:11: "glyph" is not a key of `data.words[0].native[1]`; it takes only `map`, `font`, `text`',
        ]);
    });
});

/** A mapping note for the lint. */
const mapNoteOf = (map: object) =>
    noteOf("Map.md", {
        type: "doc",
        subType: "reference",
        shortcode: "mapm",
        name: { full: "M" },
        data: { map },
    });

describe("the checks on `data.map.fonts`", () => {
    it("accepts fonts that draw every character their rows and the lexicon give", () => {
        expect(checkMapFonts(mapNoteOf(MAP), ctx)).toEqual([]);
    });

    it("reports an unknown face and a duplicate entry, at the entry", () => {
        expect(
            located(
                checkMapFonts(
                    mapNoteOf({ ...MAP, fonts: [{ font: "f" }, { font: "gg" }, { font: "f" }] }),
                    ctx,
                ),
            ),
        ).toEqual([
            "13:15: `gg` is not a font: `data.map.fonts[1].font` names an installed face; did you mean `g`?",
            "14:9: `data.map.fonts[2]` lists the font `f` a second time; the first is `data.map.fonts[0]`",
        ]);
    });

    it("reports a code point a listed face lacks, at the row that writes it", () => {
        const narrow = {
            ...ctx,
            faces: new Map([
                ["f", face("f", ALL.replace(P("k"), "") + ZARON_NATIVE + ORLAN_NATIVE)],
                ["g", face("g", ALL + ZARON_NATIVE + ORLAN_NATIVE + KARALZON_G)],
            ]),
        };
        expect(located(checkMapFonts(mapNoteOf(MAP), narrow))).toEqual([
            "28:9: `data.map.rows[5]` writes U+F0205, which the font `f`, listed in `data.map.fonts`, does not draw",
            "15:13: `data.map.fonts[1].rows[0]` writes U+F0224, which the font `g` does not draw",
        ]);
    });

    it("refuses a generic family and an empty list in the note lint", () => {
        const lint = (map: object) =>
            located(
                lintNote(
                    { ...mapNoteOf(map), type: "doc" },
                    {
                        schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
                        vocabulary: NOTE_VOCABULARY,
                    },
                ).filter((finding: { message: string }) => finding.message.includes("data.map")),
            );
        expect(lint({ name: "m", fonts: [], rows: [] })).toEqual([
            "10:12: `data.map.fonts` is empty; a map lists each face it is drawn in",
        ]);
        expect(lint({ name: "m", fonts: [{ font: "mono" }], rows: [] })).toEqual([
            "11:15: `data.map.fonts[0].font` is `mono`, a generic family; a map lists the faces it is drawn in",
        ]);
        expect(lint({ name: "m", rows: [] })).toEqual([
            "8:3: `data.map` must state `fonts` — list of `{ font, rows? }`",
        ]);
    });
});

describe("`languages.<name>.note`", () => {
    it("is a finding at the key when it names no language note", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "language-note-"));
        try {
            const file = path.join(root, "package-build.config.yaml");
            fs.writeFileSync(
                file,
                "contentPackage: demo\nlanguages:\n  vyl:\n    tag: art-x-vyl\n    note: skill-nothing\n  khel:\n    tag: art-x-khel\n    note: doc-mapm\n",
            );
            expect(
                located(
                    languageNoteFindings(
                        {
                            contentPackage: "demo",
                            configFile: file,
                            languages: {
                                vyl: { tag: "art-x-vyl", note: "skill-nothing" },
                                khel: { tag: "art-x-khel", note: "doc-mapm" },
                            },
                        },
                        [languageRecord, mapRecord],
                    ),
                ),
            ).toEqual([
                "5:5: `languages.vyl.note` is `skill-nothing`, which names no language note in demo; it names a skill note whose subType is language",
                "8:5: `languages.khel.note` is `doc-mapm`, which names no language note in demo; it names a skill note whose subType is language",
            ]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

/** A small package: the language, the map, and an installed fonts package. */
let project: string;

const FONTS_FIXTURE = path.join(HERE, "fixtures", "script-fonts", "fonts");

beforeAll(() => {
    project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "map-lexicon-")));
    const content = path.join(project, "assets", "content");
    fs.mkdirSync(content, { recursive: true });
    fs.writeFileSync(
        path.join(project, "package.json"),
        JSON.stringify({ name: "demo", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(project, "package-build.config.yaml"),
        "contentPackage: demo\npackageKind: documentation\npublish: {}\nlanguages:\n  vyl:\n    tag: art-x-vyl\n    note: skill-vylarilng\n",
    );
    fs.cpSync(FONTS_FIXTURE, path.join(project, "node_modules", "@heroiclands", "fonts"), {
        recursive: true,
    });
    const write = (name: string, fm: object) =>
        fs.writeFileSync(path.join(content, name), `---\n${YAML.stringify(fm)}---\n\nText.\n`);
    write("Vylari.md", {
        shortcode: "vylarilng",
        name: { full: "Vylari" },
        type: "skill",
        subType: "language",
        data: {
            roman: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ,",
            fields: [{ name: "Law", holds: "law" }],
            grammar: { plural: [{ ending: "", becomes: "a" }] },
            words: [
                {
                    form: "zaron",
                    class: "n",
                    field: "Law",
                    gloss: "an oath",
                    native: [
                        { map: "m", text: "\u{F02F0}" },
                        { map: "m", text: "\u{F02F1}", font: "g" },
                    ],
                },
                { form: "lonak", class: "n", field: "Law", gloss: "a road" },
                {
                    form: "Zaron",
                    class: "n",
                    field: "Law",
                    gloss: "the Oath",
                    native: [{ map: "m", text: "\u{F02F2}" }],
                },
            ],
        },
    });
    write("Map.md", {
        shortcode: "mapm",
        name: { full: "M" },
        type: "doc",
        subType: "reference",
        data: { map: { ...MAP, fonts: [{ font: "semaron-kuriale" }] } },
    });
});

afterAll(() => fs.rmSync(project, { recursive: true, force: true }));

function run(...args: string[]) {
    const r = spawnSync(process.execPath, [BIN, ...args], {
        cwd: project,
        encoding: "utf8",
        env: {
            ...process.env,
            PACKAGE_BUILD_CONFIG: path.join(project, "package-build.config.yaml"),
        },
    });
    return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

describe("the `natives` relation", () => {
    it("keeps native forms that differ only in case as rows", async () => {
        const records = collectContentIndex(path.join(project, "assets", "content"), {
            contentPackage: "demo",
            skipDirectories: [],
        });
        const db = await openNotesDatabase(records);
        try {
            const schema = await db.query("DESCRIBE natives");
            expect(schema.rows.map((row: { column_name: string }) => row.column_name)).toEqual([
                ...NATIVE_COLUMNS,
            ]);
            expect(
                (
                    await db.query(
                        'SELECT form, "map", font, "text" FROM natives ORDER BY word, native',
                    )
                ).rows,
            ).toEqual([
                { form: "zaron", map: "m", font: null, text: "\u{F02F0}" },
                { form: "zaron", map: "m", font: "g", text: "\u{F02F1}" },
                { form: "Zaron", map: "m", font: null, text: "\u{F02F2}" },
            ]);
        } finally {
            await db.close();
        }
    });
});

describe("`package-build transliterate` and `package-build lexicon`", () => {
    it(
        "print the mapped text, its code points, and every word with its native form",
        () => {
            const text = run("transliterate", "m", "--lang", "vyl", "zaron", "lonak");
            expect(text.err).toBe("");
            expect(text.code).toBe(0);
            expect(text.out).toBe(`\u{F02F0} ${rowsOf("lonak")}\n`);
            const hex = run("transliterate", "m", "--lang", "vyl", "--hex", "Zaron");
            expect(hex.code).toBe(0);
            expect(hex.out).toBe("U+F02F2\n");
            const letter = run("transliterate", "m", "--hex", "z");
            expect(letter.code).toBe(0);
            expect(letter.out).toBe("U+F0200\n");
            const listed = run("lexicon", "vyl", "--map", "m");
            expect(listed.code).toBe(0);
            expect(listed.out).toBe(
                [
                    "zaron\t\u{F02F0}\texception\tn\tan oath",
                    `lonak\t${rowsOf("lonak")}\trows\tn\ta road`,
                    "Zaron\t\u{F02F2}\texception\tn\tthe Oath",
                    "",
                ].join("\n"),
            );
            const json = run("lexicon", "vyl", "--map", "m", "--json");
            expect(JSON.parse(json.out)[1]).toEqual({
                form: "lonak",
                native: rowsOf("lonak"),
                exception: false,
                class: "n",
                gloss: "a road",
            });
        },
        subprocessTimeout(4),
    );

    it(
        "list the forms the rules derive after the words with `--derived`",
        () => {
            const listed = run("lexicon", "vyl", "--map", "m", "--derived");
            expect(listed.err).toBe("");
            expect(listed.code).toBe(0);
            expect(listed.out).toBe(
                [
                    "zaron\t\u{F02F0}\texception\tn\tan oath\t",
                    `lonak\t${rowsOf("lonak")}\trows\tn\ta road\t`,
                    "Zaron\t\u{F02F2}\texception\tn\tthe Oath\t",
                    `zarona\t${rowsOf("zarona")}\trows\tn\tan oath\tzaron`,
                    `lonaka\t${rowsOf("lonaka")}\trows\tn\ta road\tlonak`,
                    "",
                ].join("\n"),
            );
            const json = JSON.parse(run("lexicon", "vyl", "--map", "m", "--derived", "--json").out);
            expect(json.at(-1)).toEqual({
                form: "lonaka",
                native: rowsOf("lonaka"),
                exception: false,
                class: "n",
                gloss: "a road",
                from: "lonak",
            });
        },
        subprocessTimeout(2),
    );

    it(
        "reads the text from stdin for `-`",
        () => {
            const r = spawnSync(process.execPath, [BIN, "transliterate", "m", "-"], {
                cwd: project,
                encoding: "utf8",
                input: "lonak\n",
                env: {
                    ...process.env,
                    PACKAGE_BUILD_CONFIG: path.join(project, "package-build.config.yaml"),
                },
            });
            expect(r.status).toBe(0);
            expect(r.stdout).toBe(`${rowsOf("lonak")}\n`);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "reads a passage larger than a pipe buffer from a slow writer",
        async () => {
            const child = spawn(process.execPath, [BIN, "transliterate", "m", "-"], {
                cwd: project,
                env: {
                    ...process.env,
                    PACKAGE_BUILD_CONFIG: path.join(project, "package-build.config.yaml"),
                },
            });
            let out = "";
            let err = "";
            child.stdout.on("data", (chunk) => (out += chunk));
            child.stderr.on("data", (chunk) => (err += chunk));
            const closed = new Promise<number | null>((resolve) => child.on("close", resolve));
            const line = "lonak ".repeat(1024);
            for (let i = 0; i < 24; i++) {
                child.stdin.write(line);
                await new Promise((resolve) => setTimeout(resolve, 30));
            }
            child.stdin.end("\n");
            expect(await closed).toBe(0);
            expect(err).toBe("");
            expect(out.length).toBeGreaterThan(24 * 1024);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "exit 1 with a finding on an unknown map or language",
        () => {
            const map = run("transliterate", "q", "lonak");
            expect(map.code).toBe(1);
            expect(map.err).toMatch(/^assets\/content: error: `q` is not a map/m);
            const lang = run("lexicon", "zz", "--map", "m");
            expect(lang.code).toBe(1);
            expect(lang.err).toMatch(
                /^package-build\.config\.yaml:\d+:\d+: error: `zz` is not a declared language/m,
            );
        },
        subprocessTimeout(2),
    );
});
