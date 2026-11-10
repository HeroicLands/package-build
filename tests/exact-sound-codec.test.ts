// SPDX-License-Identifier: GPL-3.0-or-later
import fs from "node:fs";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { compileEncoding, encodeText, decodeText } from "../engine/encoding.mjs";
import { letterRows } from "../engine/language-rows.mjs";
import { guideSoundAt } from "../engine/encoding-sounds.mjs";
import { encodeWithLanguage, decodeWithLanguage } from "../engine/encoding-language.mjs";
import {
    SHARED_SOUNDS,
    SHARED_SOUND_CONTROLS,
    SHARED_SOUND_CODES,
} from "../engine/encoding-standard.mjs";

const raw = fs.readFileSync(
    new URL("./fixtures/sound-guides/Pronouncing_Thalorna.md", import.meta.url),
    "utf8",
);
const sounds = YAML.parse(raw.split("---")[1]).data.sounds.letters;
function fixture(invisible = false) {
    const codes = Object.fromEntries(
        sounds.flatMap((row, i) => [
            [`S${i}`, String.fromCodePoint(0xf0000 + i)],
            [SHARED_SOUNDS[row.ipa].code, SHARED_SOUNDS[row.ipa].invisible],
        ]),
    );
    const data = {
        language: "demo",
        font: "sound-font",
        mappings: Object.fromEntries(
            sounds.map((row, i) => [
                row.letters[0],
                invisible ? SHARED_SOUNDS[row.ipa].code : `S${i}`,
            ]),
        ),
        rules: { normalization: "NFC", matching: "longest-first", roundTrip: "exact" },
    };
    return { data, codes, sounds };
}
const compile = (f = fixture()) => compileEncoding(f.data, { codes: f.codes, sounds: f.sounds });

describe("the consumer guide's exact sound contract", () => {
    for (const invisible of [false, true]) {
        it(`round-trips every runtime guide sound through ${invisible ? "invisible" : "visible"} forms`, () => {
            const enc = compile(fixture(invisible));
            for (const row of sounds) {
                const roman = row.letters[0];
                expect(decodeText(enc, encodeText(enc, roman)), row.ipa).toBe(roman);
            }
        });
        it.each([
            "kau",
            "kaü",
            "asha",
            "as-ha",
            "kaú",
            "káu",
            "vskáu",
            "paäa",
            "paää",
            "bòtò́n",
            "khard-vurán",
            "zevr-",
            "-ev",
            "siy",
            "kuy",
            "kiya",
            "kuya",
            "’",
            "«kau, kaü‼»",
        ])(`round-trips %s (${invisible ? "invisible" : "visible"})`, (roman) => {
            const enc = compile(fixture(invisible));
            expect(decodeText(enc, encodeText(enc, roman))).toBe(roman === "’" ? "'" : roman);
        });
    }
    it("encodes stress and a compound boundary as separate controls", () => {
        const enc = compile();
        expect(encodeText(enc, "káu")).toBe(encodeText(enc, "kau") + SHARED_SOUND_CONTROLS.stress);
        expect(encodeText(enc, "kaú")).toBe(encodeText(enc, "kaü") + SHARED_SOUND_CONTROLS.stress);
        expect(encodeText(enc, "zevr-")).toBe(
            encodeText(enc, "zevr") + SHARED_SOUND_CONTROLS.compoundBoundary,
        );
    });
    it("refuses a missing sound and two sounds sharing one form", () => {
        const missing = fixture();
        delete missing.data.mappings.ai;
        expect(() => compile(missing)).toThrow(/ai|aɪ/);
        const ambiguous = fixture();
        ambiguous.data.mappings.ai = ambiguous.data.mappings.a;
        expect(() => compile(ambiguous)).toThrow(/ambiguous|distinct|duplicates/);
    });
    it("uses sounds directly even with a conflicting lexicon", () => {
        const enc = compile();
        const options = {
            lexicon: {
                language: "demo",
                data: { words: [{ form: "kaü", native: [{ enc: enc.name, text: "wrong" }] }] },
            },
        };
        const native = encodeText(enc, "kaü");
        expect(encodeWithLanguage(enc, "kaü", options).text).toBe(native);
        expect(decodeWithLanguage(enc, native, options)).toEqual({ text: "kaü", findings: [] });
    });
    it("rejects the canonical round-trip value", () => {
        const f = fixture();
        f.data.rules.roundTrip = "canonical";
        expect(() => compile(f)).toThrow(/roundTrip/);
    });
});

it("refuses missing inventories, additions, altered spellings and a vowel reading of y", () => {
    const f = fixture();
    expect(() => compileEncoding(f.data, { codes: f.codes })).toThrow(/inventory|sounds/);
    for (const change of [
        { letters: ["a"], ipa: "ɒ" },
        { letters: ["ah"], ipa: "ɑ" },
        { letters: ["y"], ipa: "j", kind: "vowel" },
    ])
        expect(() => compile({ ...f, sounds: [change] })).toThrow(/shared|spells|guide|consonant/);
});
it("selects the global guide token before checking a language subset", () => {
    const f = fixture();
    const allowed = new Set(["a", "i", "k"]);
    f.sounds = sounds.filter((row) => allowed.has(row.letters[0]));
    f.data.mappings = Object.fromEntries(
        Object.entries(f.data.mappings).filter(([roman]) => allowed.has(roman)),
    );
    const enc = compile(f);
    expect(decodeText(enc, encodeText(enc, "kaï"))).toBe("kaï");
    expect(() => encodeText(enc, "kai")).toThrow(/ai.*aɪ/);
});
it("reads directly typed visible skeletons without consulting a lexicon", () => {
    const f = fixture(true);
    for (const roman of ["k", "s", "h"]) {
        const index = sounds.findIndex((row) => row.letters[0] === roman);
        f.data.mappings[roman] = `S${index}`;
    }
    const enc = compile(f);
    const written = encodeText(enc, "kas-ha");
    const visible = written.replace(/[\u{E0100}-\u{E01EF}]/gu, "");
    expect(
        decodeWithLanguage(enc, visible, {
            lexicon: { language: "demo", data: { words: [{ form: "kasha" }] } },
        }),
    ).toEqual({ text: "ks-h", findings: [] });
});
it("preserves capital glyphs when supplied and treats other case as the same sound", () => {
    const f = fixture();
    f.codes.CAPITAL_A = "\u{F0100}";
    f.data.mappings.A = "CAPITAL_A";
    const enc = compile(f);
    expect(decodeText(enc, encodeText(enc, "A"))).toBe("A");
    expect(decodeText(enc, f.codes.CAPITAL_A)).toBe("A");
    expect(encodeText(enc, "SH")).toBe(encodeText(enc, "sh"));
});
it("preserves direct sound choices across every pair of guide sounds", () => {
    const f = fixture();
    const enc = compile(f);
    for (const [left, a] of sounds.entries())
        for (const [right, b] of sounds.entries()) {
            const native = f.codes[`S${left}`] + f.codes[`S${right}`];
            const roman = decodeText(enc, native);
            let encoded;
            try {
                encoded = encodeText(enc, roman);
            } catch (error) {
                throw new Error(`${a.letters[0]} + ${b.letters[0]} => ${roman}: ${error.message}`);
            }
            expect(
                encoded.replaceAll(SHARED_SOUND_CONTROLS.compoundBoundary, ""),
                `${a.letters[0]} + ${b.letters[0]} => ${roman}`,
            ).toBe(native);
            expect(decodeText(enc, encodeText(enc, roman))).toBe(roman);
        }
});
it("keeps literal codes and shared verse controls outside the sound stream", () => {
    const enc = compile();
    for (const text of ["⟦S0 U+1F600⟧", "^kau/^^kaü//as-ha‼", "a \\/ a", "a {kaü}"])
        expect(decodeText(enc, encodeText(enc, text))).toBe(text);
});
it("returns every registered logographic reading and explicitly makes no round-trip promise", () => {
    const enc = compileEncoding(
        {
            language: "demo",
            font: "signs",
            mappings: { sun: "SUN", day: "SUN" },
            rules: { normalization: "NFC", matching: "longest-first", roundTrip: "none" },
        },
        { codes: { SUN: "\u{F1000}" } },
    );
    expect(decodeText(enc, "\u{F1000}")).toBe("[sun | day]");
    const lexicon = {
        language: "demo",
        data: {
            words: [
                { form: "sun", native: [{ enc: enc.name, text: "\u{F1000}" }] },
                { form: "day", native: [{ enc: enc.name, text: "\u{F1000}" }] },
            ],
        },
    };
    expect(decodeWithLanguage(enc, "\u{F1000}", { lexicon }).text).toBe("[sun | day]");
});
it("keeps zxx literal codage independent of language sound inventories", () => {
    const enc = compileEncoding(
        {
            language: "zxx",
            font: "pirzath",
            mappings: {},
            rules: { normalization: "NFC", matching: "longest-first" },
        },
        { codes: { SIGN: "\u{F1000}" } },
    );
    expect(decodeText(enc, encodeText(enc, "⟦SIGN⟧"))).toBe("⟦SIGN⟧");
});

it("refuses a pair-local vowel class or spelling rule", () => {
    const f = fixture();
    expect(() => compileEncoding({ ...f.data, vowels: "y" }, { codes: f.codes, sounds })).toThrow(
        /guide/,
    );
    expect(() =>
        compileEncoding(
            { ...f.data, rules: { ...f.data.rules, "vowel-groups": { groups: ["ay"] } } },
            { codes: f.codes, sounds },
        ),
    ).toThrow(/shared guide/);
});

it("refuses a font that assigns a shared alias to a different character", () => {
    const f = fixture();
    f.codes[SHARED_SOUNDS["aɪ"].code] = "X";
    expect(() => compile(f)).toThrow(/Shared code SOUND_AI/);
});
it("includes mapping and lexical readings of the same logograph", () => {
    const enc = compileEncoding(
        {
            language: "demo",
            font: "signs",
            mappings: { sun: "SUN" },
            rules: { normalization: "NFC", matching: "longest-first", roundTrip: "none" },
        },
        { codes: { SUN: "\u{F1000}" } },
    );
    const lexicon = {
        language: "demo",
        data: { words: [{ form: "day", native: [{ enc: enc.name, text: "\u{F1000}" }] }] },
    };
    expect(decodeWithLanguage(enc, "\u{F1000}", { lexicon }).text).toBe("[day | sun]");
});

const toneExamples = [
    ...new Set(
        [...raw.matchAll(/_([\p{L}\p{M}]*[ǎǐǔâîû][\p{L}\p{M}]*)_/gu)]
            .map((match) => match[1])
            .filter((word) => /[ǎâ]a|[ǐî]i|[ǔû]u/u.test(word)),
    ),
];
for (const invisible of [false, true])
    it(`preserves the actual guide's tone examples (${invisible ? "invisible" : "visible"})`, () => {
        const f = fixture(invisible);
        f.codes.CAP_K = "\u{F2000}";
        f.data.mappings.K = "CAP_K";
        const enc = compile(f);
        expect(toneExamples).toEqual(
            expect.arrayContaining(["Kǎalara", "Kâalara", "Kǎalará", "ǐi", "ǔu"]),
        );
        for (const roman of toneExamples)
            expect(decodeText(enc, encodeText(enc, roman)), roman).toBe(roman);
        expect(encodeText(enc, "ǎa")).toBe(encodeText(enc, "aa") + SHARED_SOUND_CODES.TONE_RISING);
        expect(encodeText(enc, "âa")).toBe(encodeText(enc, "aa") + SHARED_SOUND_CODES.TONE_FALLING);
    });
it("keeps tone on held vowels and refuses a tone control on a plain vowel", () => {
    const enc = compile();
    for (const roman of ["ǎ", "ǎi", "aǎ", "ŷ", "ê"])
        expect(() => encodeText(enc, roman)).toThrow(/Tone/);
    expect(() => decodeText(enc, encodeText(enc, "a") + SHARED_SOUND_CODES.TONE_RISING)).toThrow(
        /held vowel/,
    );
});

it("reads global guide sounds without a language inventory or font", () => {
    for (const row of sounds) {
        const roman = row.letters[0];
        expect(guideSoundAt(roman)).toMatchObject({
            kind: row.kind,
            vowel: row.kind.includes("vowel"),
            roman,
            ipa: row.ipa,
            from: roman,
            end: roman.length,
        });
    }
    expect(guideSoundAt("y")).toMatchObject({ roman: "y", vowel: false });
    expect(guideSoundAt("iy")).toMatchObject({ roman: "iy", vowel: true });
    expect(guideSoundAt("iya")).toMatchObject({ roman: "i", end: 1 });
    expect(guideSoundAt("kaú", 1)).toMatchObject({ roman: "a", end: 2, stress: false });
    expect(guideSoundAt("kaú", 2)).toMatchObject({ roman: "u", end: 3, stress: true });
    expect(guideSoundAt("Kǎalará", 1)).toMatchObject({
        roman: "aa",
        end: 3,
        stress: false,
        tone: "toneRising",
    });
    expect(guideSoundAt("Kǎalará", 6)).toMatchObject({ roman: "a", stress: true });
    expect(guideSoundAt("-")).toBeUndefined();
    expect(() => guideSoundAt("ŷ")).toThrow(/Tone/);
});

it("selects canonical guide spellings without repeating pronunciation definitions", () => {
    const f = fixture();
    f.sounds = sounds.map((row) => row.letters[0]);
    const enc = compile(f);
    expect(decodeText(enc, encodeText(enc, "vskáu"))).toBe("vskáu");
    expect(() => compile({ ...f, sounds: ["ay"] })).toThrow(/guide spelling/);
    expect(() => compile({ ...f, sounds: ["a", "a"] })).toThrow(/repeats/);
    const rows = letterRows([
        {
            type: "skill",
            subType: "language",
            package: "demo",
            shortcode: "tongue",
            data: { sounds: { letters: ["a", "y", "iy"] } },
        },
    ]);
    expect(rows.map(({ letters, kind, ipa }) => ({ letters, kind, ipa }))).toEqual([
        { letters: ["a"], kind: "vowel", ipa: "ɑ" },
        { letters: ["y"], kind: "consonant", ipa: "j" },
        { letters: ["iy"], kind: "vowel pair", ipa: "ij" },
    ]);
});

it("keeps ny consonantal before vowels and limits closing-glide splitting to iy and uy", () => {
    const tokens = (text: string) => {
        const result = [];
        for (let at = 0; at < text.length;) {
            const token = guideSoundAt(text, at)!;
            result.push(token.roman);
            at = token.end;
        }
        return result;
    };
    expect(tokens("nya")).toEqual(["ny", "a"]);
    expect(tokens("iya")).toEqual(["i", "y", "a"]);
    expect(tokens("uya")).toEqual(["u", "y", "a"]);
    const enc = compile(fixture(true));
    const nya = "\u{E0145}\u{E0118}";
    expect(encodeText(enc, "nya")).toBe(nya);
    expect(decodeText(enc, nya)).toBe("nya");
    expect(decodeText(enc, "\u{E0131}\u{E0142}\u{E0118}")).toBe("n-ya");
    expect(decodeText(enc, "\u{E0126}\u{E0118}")).toBe("iy-a");
    expect(decodeText(enc, "\u{E0127}\u{E0118}")).toBe("uy-a");
});

it.each(["a\u0301\u0301", "a\u030C\u030Ca", "a\u0302\u0302a", "a\u030C\u0302a", "o\u0300\u0300"])(
    "rejects repeated or conflicting marks in %s",
    (roman) => {
        expect(() => guideSoundAt(roman)).toThrow(/repeated|Tone/i);
        expect(() => encodeText(compile(), roman)).toThrow(/repeated|Tone/i);
    },
);
it("preserves the guide's distinct grave and acute on one vowel", () => {
    const roman = "o\u0300\u0301";
    expect(guideSoundAt(roman)).toMatchObject({
        roman: "ò",
        ipa: "ʌ",
        stress: true,
        tone: undefined,
        end: 3,
    });
    const enc = compile(fixture(true));
    expect(encodeText(enc, roman)).toBe(
        SHARED_SOUND_CODES.SOUND_O_GRAVE + SHARED_SOUND_CODES.STRESS,
    );
    expect(decodeText(enc, encodeText(enc, roman))).toBe(roman.normalize("NFC"));
});
