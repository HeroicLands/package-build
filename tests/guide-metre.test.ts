/* SPDX-License-Identifier: GPL-3.0-or-later */

import fs from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { runContext, scanRuns } from "../engine/content-scripts.mjs";
import { lineBeats, metreBooksFromRecords, nucleiOf, stressIndex } from "../engine/verse-metre.mjs";

const guide = fs.readFileSync(
    process.env.HEROICLANDS_SOUND_GUIDE ??
        new URL("./fixtures/sound-guides/Pronouncing_Thalorna.md", import.meta.url),
    "utf8",
);
const letters = parse(guide.split("---")[1]).data.sounds.letters;
const config = {
    contentPackage: "demo",
    languages: { test: { tag: "art-x-test", note: "skill-test" } },
};
const language = (sounds: object = {}, words: object[] = []) => ({
    type: "skill",
    subType: "language",
    shortcode: "test",
    address: { canonical: "demo-note-skill-test" },
    data: {
        roman: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZáéíóúǎâàò.,-",
        sounds,
        words,
    },
});
const metre = {
    type: "doc",
    shortcode: "metres",
    data: {
        metres: [
            { name: "one", beats: 1, kind: "accentual" },
            { name: "two", beats: 2, kind: "accentual" },
        ],
    },
};
const records = (sounds: object = {}, words: object[] = []) => [language(sounds, words), metre];
const scan = (word: string, sounds: object = {}, words: object[] = [], name = "one") =>
    scanRuns(
        `::: {.verse lang=test scan=${name}}\n${word}\n:::`,
        runContext(config, records(sounds, words)),
    );
const book = (sounds: object = {}, words: object[] = []) =>
    metreBooksFromRecords(records(sounds, words), config).get("test")!;

describe("the guide is the metre's pronunciation authority", () => {
    it("counts each sound in the actual guide by its declared kind", () => {
        for (const row of letters)
            for (const spelling of row.letters) {
                expect(nucleiOf(spelling), spelling).toHaveLength(
                    row.kind.includes("vowel") ? 1 : 0,
                );
                expect(lineBeats(spelling, book()), spelling).toEqual({
                    min: row.kind.includes("vowel") ? 1 : 0,
                    max: row.kind.includes("vowel") ? 1 : 0,
                });
            }
    });
    it("never lets a language pair inventory split a guide group in the production scan", () => {
        const expected = {
            stress: { two: "first", longer: "penultimate", mark: "acute" },
            syllables: { vowelPairs: ["au"] },
        };
        const override = { ...expected, syllables: { vowelPairs: [] } };
        const words = [{ form: "kau", class: "part" }];
        expect(scan("kau", expected, words).warnings).toHaveLength(1);
        expect(scan("kau", override, words).warnings).toEqual(
            scan("kau", expected, words).warnings,
        );
    });
    it("never lets a language stress rule remove a secondary beat in the production scan", () => {
        const expected = { stress: { two: "first", longer: "penultimate", mark: "acute" } };
        const override = { stress: { ...expected.stress, longer: "first" } };
        expect(scan("kalatora", expected, [], "two").warnings).toEqual([]);
        expect(scan("kalatora", override, [], "two").warnings).toEqual([]);
    });
    it("needs no language pronunciation override to scan", () => {
        expect(scan("kalatora", {}, [{ form: "kalatora", class: "n" }], "two").errors).toEqual([]);
        expect(scan("kalatora", {}, [], "two").warnings).toEqual([]);
    });
    it("keeps a compound one word regardless of dictionary coverage", () => {
        expect(
            lineBeats("zar-zaros", book({ stress: { two: "first", longer: "penultimate" } })),
        ).toEqual({ min: 1, max: 1 });
        expect(scan("zar-zaros").warnings).toEqual([]);
        expect(scan("zar-zaros", {}, [{ form: "zar-zaros", class: "n" }]).warnings).toEqual([]);
    });
    it("uses the guide's acute, tone and default stress precedence", () => {
        expect(guide).toContain(
            "the syllable with an acute is stressed; failing that, the syllable with a tone; failing that, the rule above",
        );
        for (const [word, stressed] of [
            ["zaros", 0],
            ["kalatora", 2],
            ["kǎalatora", 0],
            ["kâalatora", 0],
            ["kǎalatorá", 3],
            ["bòtò́n", 1],
        ] as const)
            expect(stressIndex(word), word).toBe(stressed);
        expect(scan("kǎalatora", {}, [], "two").warnings).toHaveLength(1);
        expect(scan("kǎalatorá", {}, [], "two").warnings).toEqual([]);
    });
    it.each(["kâ", "c", "x", "álará", "kǎalâa"])(
        "reports invalid guide spelling %s on its verse line",
        (word) => {
            const result = scan(word);
            expect(result.errors).toContainEqual(
                expect.objectContaining({
                    line: 2,
                    column: 1,
                    message: expect.stringContaining("Cannot scan"),
                }),
            );
            expect(result.warnings).toEqual([]);
        },
    );
    it("keeps word formation, mark descriptions and dictionary spellings out of pronunciation", () => {
        const metadata = {
            syllables: { vowelPairs: ["ao"], onsets: "single" },
            marks: [{ mark: "grave", kind: "stress" }],
            readPast: [{ written: "ao", readAs: "a" }],
        };
        const words = [{ form: "kaotara", class: "n" }];
        expect(lineBeats("kaotara", book(metadata, words))).toEqual({ min: 1, max: 2 });
        expect(lineBeats("kàlatora", book(metadata))).toEqual({ min: 1, max: 2 });
        expect(scan("kaotara", metadata, words, "two").warnings).toEqual([]);
        expect(lineBeats("ka-otara", book(metadata, [{ form: "ka-otara", class: "n" }]))).toEqual({
            min: 1,
            max: 2,
        });
    });
    it.each([
        ["kau", ["au"]],
        ["kaü", ["a", "ü"]],
        ["kaú", ["a", "ú"]],
        ["paa", ["aa"]],
        ["paäa", ["a", "äa"]],
        ["paää", ["a", "ä", "ä"]],
        ["siy", ["iy"]],
        ["siya", ["i", "a"]],
        ["kuy", ["uy"]],
        ["kuya", ["u", "a"]],
        ["ka-u", ["a", "u"]],
        ["y", []],
        ["kàu", ["à", "u"]],
        ["k'au", ["au"]],
    ])("reads %s with the guide's boundaries", (word, nuclei) => {
        expect(nucleiOf(word)).toEqual(nuclei);
        expect(nucleiOf(word.normalize("NFD"))).toEqual(nuclei);
    });
});
