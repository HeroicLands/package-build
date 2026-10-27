// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { compileRows } from "../engine/encoding.mjs";
import { checkEncodingLexicon, checkLexiconNatives } from "../engine/encoding-lexicon.mjs";

const roman = compileRows(
    {
        name: "roman",
        fonts: ["face"],
        accepts: ["a-z", "A-Z"],
        separator: " ",
        rows: [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((c, i) => [
            c,
            String.fromCodePoint(0x4e00 + i),
        ]),
    },
    { language: "tongue" } as any,
);
const codesOnly = compileRows(
    {
        name: "glyphs",
        fonts: ["face"],
        accepts: ["-", ":", "*"],
        separator: " ",
        rows: [],
        codes: [["ONE", "\u{F0300}"]],
    },
    { language: "tongue" } as any,
);
const faces = new Map([
    ["face", { slug: "face", draws: new Set(["α", "\u{F0300}"].map((c) => c.codePointAt(0))) }],
]);
const ctx = (encodings: any[]) => ({
    encodings: new Map(encodings.map((e) => [e.name, e])),
    faces,
    contentPackage: "demo",
    languageRecords: new Map([["tongue", { shortcode: "tongue", package: "demo" }]]),
});
const note = (data: any) => {
    const fm = {
        type: "skill",
        subType: "language",
        shortcode: "tongue",
        name: { full: "Tongue" },
        data,
    };
    return { fm, file: "tongue.md", raw: `---\n${YAML.stringify(fm)}---\n` };
};
const word = (native: any[]) => ({ form: "ab", class: "n", field: "Words", gloss: "x", native });

describe("a codes-only encoding", () => {
    it("is not checked against the lexicon's roman forms", () => {
        const source = note({
            words: [word([])],
            names: { pattern: "{given}", given: { male: ["Qux"] } },
        });
        expect(checkEncodingLexicon(source, ctx([codesOnly]))).toEqual([]);
    });

    it("leaves a roman encoding beside it checking the roman forms", () => {
        const source = note({ words: [{ ...word([]), form: "a1" }] });
        const findings = checkEncodingLexicon(source, ctx([roman, codesOnly]));
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(
            /`a1` is not valid Roman spelling for encoding `roman`/,
        );
    });

    it("still checks a native writing in it", () => {
        const good = note({ words: [word([{ enc: "glyphs", text: "\u{F0300}" }])] });
        expect(checkLexiconNatives(good, ctx([roman, codesOnly]))).toEqual([]);
        const bad = note({ words: [word([{ enc: "glyphs", text: "\u{F0301}" }])] });
        const errors = checkLexiconNatives(bad, ctx([roman, codesOnly]));
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toMatch(/U\+F0301/);
    });
});

describe("an English name list", () => {
    it("is never encoded as the tongue", () => {
        const source = note({
            words: [word([])],
            names: {
                pattern: "{given} the {en.epithet}",
                given: { male: ["ab"] },
                en: { epithet: ["cruel", "Cut-throat 7", "merciless"] },
            },
        });
        expect(checkEncodingLexicon(source, ctx([roman]))).toEqual([]);
    });

    it("leaves the tongue's own lists encoded", () => {
        const source = note({
            names: {
                pattern: "{given} the {en.epithet}",
                given: { male: ["a1"] },
                en: { epithet: ["cruel"] },
            },
        });
        const findings = checkEncodingLexicon(source, ctx([roman]));
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/`a1`/);
    });
});
