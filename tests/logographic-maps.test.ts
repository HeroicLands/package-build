/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A logographic map writes every word from the lexicon, never by sound.** A
 * word under a map stating `logographic: true` is written by its own `native`
 * entry for the map; else by its parts: the writings of the pieces of its
 * `built` list joined in order, or its stem's writing followed by the writing
 * the grammar states for its ending; else it is an error at the word. One roman
 * form standing for entries written differently is an error naming their
 * glosses. The rows write only the text between words. `transliterate` and
 * `lexicon` give what the build gives.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import YAML from "yaml";

import { renderRuns, runContext, scanRuns } from "../engine/content-scripts.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import {
    checkLexiconNatives,
    lexiconEntries,
    mappingFor,
    transliterate,
} from "../engine/map-lexicon.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { applyMap, checkMapField } from "../engine/text-maps.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { subprocessTimeout } from "./subprocess-timeout.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "..", "bin", "package-build.mjs");

/** Signs of Khelathi Zethu Glyphs, at their encoded code points. */
const HEART = "\u{1EABB}"; // 04-018, heart bound with a cord
const POWER = "\u{1EA93}"; // 03-003, open hand with three short rays
const GOD = "\u{1EA91}"; // 03-001, seated god
const SPROUT = "\u{1EB41}"; // 09-017, sprout over silt, sun above
const HOUSE = "\u{1EB66}"; // 11-003, house, roof and door
const INK = "\u{1EBC7}"; // 14-020, ink cake and reed
const MOUTH = "\u{1EA42}"; // 01-003, seated man, hand to mouth
const STROKE = "\u{1EBDF}"; // 16-004, single upright stroke
const STROKES = "\u{1EBE1}"; // 16-006, three strokes
const POINT = "\u{1EBED}"; // 16-018, stroke with a notch

const SIGNS = [HEART, POWER, GOD, SPROUT, HOUSE, INK, MOUTH, STROKE, STROKES, POINT].join("");

/** A face drawing the given characters. */
const face = (slug: string, chars: string) => ({
    slug,
    family: slug,
    class: `hl-${slug}`,
    direction: "ltr",
    features: [],
    draws: new Set(Array.from(chars, (char) => char.codePointAt(0))),
});

/** The `zethu` map: logographic, its rows only for spaces and points. */
const ZETHU = {
    name: "zethu",
    logographic: true,
    fonts: [{ font: "zethu-glyphs" }],
    rows: [
        [" ", " "],
        [".", POINT],
    ],
};

const WORDS = [
    {
        form: "halzi",
        class: "n",
        field: "Words",
        gloss: "heart",
        native: [{ map: "zethu", text: HEART }],
    },
    {
        form: "Halzi",
        class: "stem",
        field: "Words",
        gloss: "heart, and the account a heart answers for",
        native: [{ map: "zethu", text: HEART }],
    },
    {
        form: "lekhau",
        class: "n",
        field: "Words",
        gloss: "sacred power",
        native: [{ map: "zethu", text: POWER }],
    },
    {
        form: "nelgir",
        class: "n",
        field: "Words",
        gloss: "a god",
        native: [{ map: "zethu", text: GOD }],
    },
    {
        form: "Nelgir",
        class: "stem",
        field: "Words",
        gloss: "god",
        native: [{ map: "zethu", text: SPROUT }],
    },
    {
        form: "Gar-",
        class: "stem",
        field: "Words",
        gloss: "house of",
        native: [{ map: "zethu", text: HOUSE }],
    },
    { form: "lekhunet", class: "n", field: "Words", gloss: "a spell", built: ["lekhau", "-unet"] },
    {
        form: "halzunet",
        class: "n",
        field: "Words",
        gloss: "the account",
        built: ["halzi", "-unet"],
    },
    {
        form: "garhalzunet",
        class: "n",
        field: "Words",
        gloss: "the house of the account",
        built: ["Gar-", "halzunet"],
    },
    {
        form: "lekhel",
        class: "n",
        field: "Words",
        gloss: "a holy word, written its own way",
        built: ["lekhau", "-unet"],
        native: [{ map: "zethu", text: POWER + MOUTH }],
    },
    {
        form: "qethar",
        class: "v",
        field: "Words",
        gloss: "to tell",
        native: [{ map: "zethu", text: MOUTH }],
    },
    { form: "zamlu", class: "n", field: "Words", gloss: "music" },
    { form: "zamlet", class: "n", field: "Words", gloss: "a hymn", built: ["zamlu", "-et"] },
];

const LANGUAGE_DATA = {
    roman: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-",
    fields: [{ name: "Words", holds: "words" }],
    affixes: [
        { form: "-unet", gloss: "a thing made of", native: [{ map: "zethu", text: INK }] },
        { form: "-et", gloss: "a song of" },
    ],
    grammar: {
        plural: [{ ending: "", becomes: "im" }],
        verbs: {
            persons: { I: "en", you: "et", heShe: "", we: "enu", youAll: "etu", they: "ar" },
        },
        native: [
            { ending: "plural", map: "zethu", text: STROKES },
            { ending: "I", map: "zethu", text: STROKE },
        ],
    },
    words: WORDS,
};

const languageRecord = {
    type: "skill",
    subType: "language",
    shortcode: "khelathlng",
    address: { canonical: "demo-note-skill-khelathlng" },
    data: LANGUAGE_DATA,
};
const mapRecord = {
    type: "doc",
    subType: "reference",
    shortcode: "mapzethu",
    address: { canonical: "demo-note-doc-mapzethu" },
    data: { map: ZETHU },
};

const config = {
    contentPackage: "demo",
    languages: {
        khel: { tag: "art-x-khel", note: "skill-khelathlng" },
        tant: { tag: "art-x-tant" },
    },
};

const contextOf = (records: object[]) => ({
    ...runContext(config, records),
    faces: new Map([["zethu-glyphs", face("zethu-glyphs", SIGNS + " ")]]),
});
const ctx = contextOf([languageRecord, mapRecord]);

/** The set text inside the one span a source renders to. */
const built = (source: string, context = ctx) => {
    const out = renderRuns(source, context).markdown;
    const inner = /\[(.*)\]\{/.exec(out)?.[1];
    return (inner ?? out).replace(/\\(.)/g, "$1");
};

/** A run's findings, located. */
const errorsOf = (source: string, context = ctx) =>
    scanRuns(source, context).errors.map(
        (error: { line: number; column: number; message: string }) =>
            `${error.line}:${error.column}: ${error.message}`,
    );

const KEYS = "lang=khel font=zethu-glyphs map=zethu .nativefont";
const keys = { map: "zethu", lang: "khel", font: "zethu-glyphs" };

const MISSING = (word: string) =>
    `\`${word}\` has no \`zethu\` writing in the \`khel\` lexicon, and its parts do not give one; ` +
    "state one, or write the word directly in signs";

describe("a word under a logographic map", () => {
    it("is written by its own `native` entry, which wins over its parts", () => {
        expect(built(`[halzi]{${KEYS}}`)).toBe(HEART);
        expect(built(`[lekhel]{${KEYS}}`)).toBe(POWER + MOUTH);
        expect(errorsOf(`[halzi lekhel]{${KEYS}}`)).toEqual([]);
    });

    it("is written by its `built` pieces' writings joined in order, an affix's included", () => {
        expect(built(`[lekhunet]{${KEYS}}`)).toBe(POWER + INK);
        expect(errorsOf(`[lekhunet]{${KEYS}}`)).toEqual([]);
    });

    it("resolves a piece that is itself built from pieces", () => {
        expect(built(`[garhalzunet]{${KEYS}}`)).toBe(HOUSE + HEART + INK);
    });

    it("appends the writing the grammar states for a plural or a verb ending", () => {
        expect(built(`[halziim]{${KEYS}}`)).toBe(HEART + STROKES);
        expect(built(`[lekhunetim]{${KEYS}}`)).toBe(POWER + INK + STROKES);
        expect(built(`[qetharen]{${KEYS}}`)).toBe(MOUTH + STROKE);
        expect(errorsOf(`[halziim qetharen]{${KEYS}}`)).toEqual([]);
    });

    it("writes each part of a hyphenated compound that is no lexicon word", () => {
        expect(built(`[Gar-halzunet]{${KEYS}}`)).toBe(HOUSE + HEART + INK);
    });

    it("reads a capitalised word by its lowercase form, and passes where both entries write alike", () => {
        expect(built(`[Halzi]{${KEYS}}`)).toBe(HEART);
        expect(errorsOf(`[Halzi]{${KEYS}}`)).toEqual([]);
    });

    it("is an error at the word when neither it nor its parts give a writing", () => {
        expect(errorsOf(`Sung [halzi zamlu]{${KEYS}}.`)).toEqual([`1:13: ${MISSING("zamlu")}`]);
        // A piece with no writing, and an ending the grammar writes no sign for.
        expect(errorsOf(`[zamlet qetharar]{${KEYS}}`)).toEqual([
            `1:2: ${MISSING("zamlet")}`,
            `1:9: ${MISSING("qetharar")}`,
        ]);
    });

    it("is an ambiguity error when one roman form stands for entries written differently", () => {
        const message =
            "`nelgir` stands for 2 words of the `khel` lexicon that the map `zethu` writes " +
            "differently, “a god” and “god”; write the word directly in signs, choosing by its " +
            "sense in `package-build lexicon khel --map zethu`";
        expect(errorsOf(`[halzi nelgir]{${KEYS}}`)).toEqual([`1:8: ${message}`]);
        expect(errorsOf(`[Nelgir]{${KEYS}}`)).toEqual([
            `1:2: ${message.replace("`nelgir`", "`Nelgir`")}`,
        ]);
        // A part matched to entries written differently names the part.
        expect(errorsOf(`[Gar-nelgir]{${KEYS}}`)).toEqual([
            `1:2: ${message.replace("`nelgir` stands", "`Gar-nelgir` is written from its part `nelgir`, which stands")}`,
        ]);
    });

    it("is an error when the run has no lexicon to write it from", () => {
        expect(errorsOf("[halzi]{font=zethu-glyphs map=zethu lang=und .nativefont}")).toEqual([
            "1:2: `halzi` has no `zethu` writing: the map `zethu` is logographic, and `und` has " +
                "no lexicon (`languages.und.note`) to write it from; write the word directly in signs",
        ]);
        expect(errorsOf("[halzi]{lang=tant font=zethu-glyphs map=zethu .nativefont}")).toEqual([
            "1:2: `halzi` has no `zethu` writing: the map `zethu` is logographic, and `tant` has " +
                "no lexicon (`languages.tant.note`) to write it from; write the word directly in signs",
        ]);
    });

    it("passes signs typed directly through unchanged", () => {
        expect(built(`[${GOD} halzi]{${KEYS}}`)).toBe(`${GOD} ${HEART}`);
        expect(errorsOf(`[${GOD} halzi]{${KEYS}}`)).toEqual([]);
    });

    it("is still checked against the lexicon", () => {
        expect(errorsOf(`[halzi qorzu]{${KEYS}}`)).toEqual([
            "1:8: `qorzu` is not a word of the `khel` lexicon, a registered name, or a regular form of one; coin it in the lexicon (or register the name) first",
            `1:8: ${MISSING("qorzu")}`,
        ]);
    });
});

describe("the rows of a logographic map", () => {
    it("write the spaces and points between words, and never a word", () => {
        expect(built(`[halzi lekhau.]{${KEYS}}`)).toBe(`${HEART} ${POWER}${POINT}`);
        // A row matching letters is never applied to a word, which is an error
        // instead of falling through to it; the point after it is still a row's.
        const lettered = contextOf([
            languageRecord,
            { ...mapRecord, data: { map: { ...ZETHU, rows: [...ZETHU.rows, ["z", SPROUT]] } } },
        ]);
        const mapping = mappingFor(lettered, keys);
        const mapped = applyMap(mapping?.map, "zamlu.", {
            font: mapping?.font,
            writing: mapping?.writing,
        });
        expect(mapped.text).toBe(`zamlu${POINT}`);
        expect(mapped.pieces[0]).toMatchObject({ from: "zamlu", unwritten: { missing: true } });
        expect(errorsOf(`[zamlu.]{${KEYS}}`, lettered)).toEqual([`1:2: ${MISSING("zamlu")}`]);
    });

    it("are refused where they match a letter, at the row", () => {
        const note = {
            file: "Zethu.md",
            fm: { data: { map: { ...ZETHU, rows: [...ZETHU.rows, ["z", SPROUT]] } } },
            raw: `---\n${YAML.stringify({ data: { map: { ...ZETHU, rows: [...ZETHU.rows, ["z", SPROUT]] } } })}---\n`,
        };
        expect(
            checkMapField(note).map(
                (finding: { line?: number; column?: number; message: string }) =>
                    `${finding.line}:${finding.column}: ${finding.message}`,
            ),
        ).toEqual([
            "13:9: `data.map.rows[2]` matches `z`, a letter, and the rows of a logographic map write only the text between words",
        ]);
    });
});

describe("transliterate and the lexicon give what the build gives", () => {
    it("transliterate writes a passage as a run with the same keys", () => {
        const passage = "halzi lekhunet garhalzunet halziim qetharen.";
        expect(transliterate(ctx, keys, passage)).toEqual({
            text: built(`[${passage}]{${KEYS}}`),
        });
        expect(transliterate(ctx, keys, "halzi zamlu")).toEqual({
            about: "word",
            problem: MISSING("zamlu"),
        });
    });

    it("the lexicon lists each word's writing and how it is reached, and marks the rest", () => {
        const listed = lexiconEntries(ctx, { lang: "khel", map: "zethu" });
        expect("entries" in listed && listed.entries).toEqual([
            { form: "halzi", native: HEART, source: "own", class: "n", gloss: "heart" },
            {
                form: "Halzi",
                native: HEART,
                source: "own",
                class: "stem",
                gloss: "heart, and the account a heart answers for",
            },
            { form: "lekhau", native: POWER, source: "own", class: "n", gloss: "sacred power" },
            {
                form: "nelgir",
                native: GOD,
                source: "own",
                ambiguous: true,
                class: "n",
                gloss: "a god",
            },
            {
                form: "Nelgir",
                native: SPROUT,
                source: "own",
                ambiguous: true,
                class: "stem",
                gloss: "god",
            },
            { form: "Gar-", native: HOUSE, source: "own", class: "stem", gloss: "house of" },
            {
                form: "lekhunet",
                native: POWER + INK,
                source: "parts",
                class: "n",
                gloss: "a spell",
            },
            {
                form: "halzunet",
                native: HEART + INK,
                source: "parts",
                class: "n",
                gloss: "the account",
            },
            {
                form: "garhalzunet",
                native: HOUSE + HEART + INK,
                source: "parts",
                class: "n",
                gloss: "the house of the account",
            },
            {
                form: "lekhel",
                native: POWER + MOUTH,
                source: "own",
                class: "n",
                gloss: "a holy word, written its own way",
            },
            { form: "qethar", native: MOUTH, source: "own", class: "v", gloss: "to tell" },
            { form: "zamlu", native: "", source: "none", class: "n", gloss: "music" },
            { form: "zamlet", native: "", source: "none", class: "n", gloss: "a hymn" },
        ]);
    });

    it("every word the lexicon lists a writing for is written so by the build", () => {
        const listed = lexiconEntries(ctx, { lang: "khel", map: "zethu", derived: true });
        expect("entries" in listed).toBe(true);
        if (!("entries" in listed)) return;
        for (const entry of listed.entries) {
            const source = `[${entry.form.replace(/-$/, "")}]{${KEYS}}`;
            if (entry.ambiguous || entry.source === "none")
                expect(errorsOf(source)).toHaveLength(1);
            else {
                expect(built(source)).toBe(entry.native);
                expect(transliterate(ctx, keys, entry.form.replace(/-$/, ""))).toEqual({
                    text: entry.native,
                });
            }
        }
        expect(listed.entries.find((entry: any) => entry.form === "halziim")).toEqual({
            form: "halziim",
            native: HEART + STROKES,
            source: "parts",
            class: "n",
            gloss: "heart",
            from: "halzi",
        });
        expect(listed.entries.find((entry: any) => entry.form === "qetharar")).toMatchObject({
            native: "",
            source: "none",
            from: "qethar",
        });
    });
});

/** A note for the lint. */
const noteOf = (file: string, fm: object) => ({ file, fm, raw: `---\n${YAML.stringify(fm)}---\n` });
const located = (findings: Array<{ line?: number; column?: number; message: string }>) =>
    findings.map((finding) => `${finding.line}:${finding.column}: ${finding.message}`);

const languageNote = (data: object) =>
    noteOf("Khelathi.md", {
        type: "skill",
        subType: "language",
        shortcode: "khelathlng",
        name: { full: "Khelathi" },
        data: { fields: [{ name: "Words", holds: "words" }], ...data },
    });

/** A map that spells by sound, beside the logographic one. */
const ROMAN = { name: "roman", fonts: [{ font: "zethu-glyphs" }], rows: [["k", "k"]] };
const both = contextOf([
    languageRecord,
    mapRecord,
    { ...mapRecord, shortcode: "maproman", data: { map: ROMAN } },
]);

describe("the checks on writings under a logographic map", () => {
    it("accept the fixture's writings", () => {
        expect(checkLexiconNatives(languageNote(LANGUAGE_DATA), ctx)).toEqual([]);
    });

    it("do not hold a writing to what the rows would give", () => {
        const word = (map: string) => ({
            form: "ka",
            class: "n",
            field: "Words",
            gloss: "a soul",
            native: [{ map, text: "ka" }],
        });
        const wide = {
            ...both,
            faces: new Map([["zethu-glyphs", face("zethu-glyphs", SIGNS + " ka")]]),
        };
        expect(
            located(checkLexiconNatives(languageNote({ words: [word("zethu")] }), wide)),
        ).toEqual([]);
        expect(
            located(checkLexiconNatives(languageNote({ words: [word("roman")] }), wide)),
        ).toEqual([
            "17:11: `data.words[0].native[0]` states what the rows already give: the map `roman` spells `ka` so in the font `zethu-glyphs`; a native form is stated only where the rows spell the word differently",
        ]);
    });

    it("refuse an affix's or an ending's writing under a map that is not logographic, a second one, a person no pattern states, and an undrawn sign", () => {
        expect(
            located(
                checkLexiconNatives(
                    languageNote({
                        affixes: [
                            {
                                form: "-unet",
                                gloss: "a thing made of",
                                native: [
                                    { map: "roman", text: INK },
                                    { map: "zethu", text: INK },
                                    { map: "zethu", text: "\u{1EC00}" },
                                ],
                            },
                        ],
                        grammar: {
                            plural: [{ ending: "", becomes: "im" }],
                            native: [
                                { ending: "plural", map: "roman", text: STROKES },
                                { ending: "plural", map: "zethu", text: STROKES },
                                { ending: "plural", map: "zethu", text: STROKE },
                                { ending: "they", map: "zethu", text: STROKE },
                            ],
                        },
                        words: [],
                    }),
                    both,
                ),
            ),
        ).toEqual([
            "15:11: `data.affixes[0].native[0]` names the map `roman`, which is not logographic; an affix is written by a native form only under a logographic map",
            "19:11: `data.affixes[0].native[2]` states a second native form for the map `zethu`; the first is `data.affixes[0].native[1]`",
            "19:11: `data.affixes[0].native[2]` holds U+1EC00, which the font `zethu-glyphs`, listed in the map `zethu`, does not draw",
            "26:9: `data.grammar.native[0]` names the map `roman`, which is not logographic; an ending is written by a native form only under a logographic map",
            "32:9: `data.grammar.native[2]` states a second native form of the ending `plural` for the map `zethu`; the first is `data.grammar.native[1]`",
            "35:9: `data.grammar.native[3]` writes the ending `they`, and `data.grammar.verbs` states no `persons`",
        ]);
    });

    it("declare `logographic`, the ending's closed list and the affix's `native` in the vocabulary", () => {
        const lint = (note: { file: string; fm: any; raw: string }) =>
            located(
                lintNote(note, {
                    schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
                    vocabulary: NOTE_VOCABULARY,
                }),
            );
        const mapNote = (map: object) =>
            noteOf("Zethu.md", {
                type: "doc",
                subType: "reference",
                shortcode: "mapzethu",
                name: { full: "Zethu" },
                data: { map },
            });
        expect(lint(mapNote(ZETHU))).toEqual([]);
        expect(lint(mapNote({ ...ZETHU, logographic: "yes" })).join("\n")).toMatch(/logographic/);
        expect(lint(languageNote(LANGUAGE_DATA))).toEqual([]);
        expect(
            lint(
                languageNote({
                    ...LANGUAGE_DATA,
                    grammar: {
                        ...LANGUAGE_DATA.grammar,
                        native: [{ ending: "dual", map: "zethu", text: STROKE }],
                    },
                }),
            ).join("\n"),
        ).toMatch(/`data\.grammar\.native\[0\]\.ending` should be `plural` or `I`/);
    });
});

/** A small package: Khelathi, the `zethu` map, and an installed fonts package. */
let project: string;

const FONTS_FIXTURE = path.join(HERE, "fixtures", "script-fonts", "fonts");

beforeAll(() => {
    project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "logographic-")));
    const content = path.join(project, "assets", "content");
    fs.mkdirSync(content, { recursive: true });
    fs.writeFileSync(
        path.join(project, "package.json"),
        JSON.stringify({ name: "demo", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(project, "package-build.config.yaml"),
        "contentPackage: demo\npackageKind: documentation\npublish: {}\nlanguages:\n  khel:\n    tag: art-x-khel\n    note: skill-khelathlng\n",
    );
    fs.cpSync(FONTS_FIXTURE, path.join(project, "node_modules", "@heroiclands", "fonts"), {
        recursive: true,
    });
    const write = (name: string, fm: object) =>
        fs.writeFileSync(path.join(content, name), `---\n${YAML.stringify(fm)}---\n\nText.\n`);
    write("Khelathi.md", {
        shortcode: "khelathlng",
        name: { full: "Khelathi" },
        type: "skill",
        subType: "language",
        data: LANGUAGE_DATA,
    });
    write("Zethu.md", {
        shortcode: "mapzethu",
        name: { full: "Zethu" },
        type: "doc",
        subType: "reference",
        data: { map: { ...ZETHU, fonts: [{ font: "semaron-kuriale" }] } },
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

describe("`package-build transliterate` and `package-build lexicon` under a logographic map", () => {
    it(
        "write a passage, refuse a word with no writing, and list every word's writing",
        () => {
            const text = run(
                "transliterate",
                "zethu",
                "--lang",
                "khel",
                "--hex",
                "lekhunet",
                "halziim.",
            );
            expect(text.err).toBe("");
            expect(text.code).toBe(0);
            expect(text.out).toBe("U+1EA93 U+1EBC7 U+0020 U+1EABB U+1EBE1 U+1EBED\n");
            const missing = run("transliterate", "zethu", "--lang", "khel", "zamlu");
            expect(missing.code).toBe(1);
            expect(missing.err).toBe(`error: ${MISSING("zamlu")}\n`);
            const listed = run("lexicon", "khel", "--map", "zethu");
            expect(listed.err).toBe("");
            expect(listed.code).toBe(0);
            expect(listed.out.split("\n").slice(3, 7)).toEqual([
                `nelgir\t${GOD}\tambiguous\tn\ta god`,
                `Nelgir\t${SPROUT}\tambiguous\tstem\tgod`,
                `Gar-\t${HOUSE}\town\tstem\thouse of`,
                `lekhunet\t${POWER}${INK}\tparts\tn\ta spell`,
            ]);
            expect(listed.out.split("\n").slice(-3)).toEqual([
                "zamlu\t\tnone\tn\tmusic",
                "zamlet\t\tnone\tn\ta hymn",
                "",
            ]);
        },
        subprocessTimeout(3),
    );
});
