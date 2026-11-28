// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { compileEncoding, decodeText, encodeText } from "../engine/encoding.mjs";
import { decodeWithLanguage, encodeWithLanguage } from "../engine/encoding-language.mjs";
import { encodingsFromRecords } from "../engine/encoding-notes.mjs";
import { lexiconsFromRecords, encodingFor } from "../engine/encoding-lexicon.mjs";
import { renderRuns } from "../engine/content-scripts.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { ENCODING_RULE_FIELDS } from "../engine/encoding-terms.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import YAML from "yaml";

const FIRE = "\u{F0400}",
    METAL = "\u{F0401}",
    WATER = "\u{F0402}";
const OPEN = "\u{E0112}",
    CLOSE = "\u{E0113}";
const codes = { FIRE, METAL, WATER };
const rules = { normalization: "NFC", matching: "longest-first", roundTrip: "none" };
const unspacedRules = { ...rules, "word-spaces": "none" };
const signs = compileEncoding(
    { language: "tant", font: "signs", mappings: {}, rules: unspacedRules },
    { codes, name: "tantsigns" },
);
const word = (form: string, text?: string, built?: string[]) => ({
    form,
    class: "n",
    gloss: form,
    ...(text ? { native: [{ enc: "tantsigns", text }] } : {}),
    ...(built ? { built } : {}),
});
const lexicon = {
    language: "tant",
    data: {
        words: [
            word("ho", FIRE),
            word("jing", METAL),
            word("sui", WATER),
            word("hosui", undefined, ["ho", "sui"]),
        ],
    },
};
const encode = (text: string, options: Record<string, unknown> = {}) =>
    encodeWithLanguage(signs, text, { lexicon, ...options });
const period = encodeText(signs, ".");

describe("an encoding that declares word-spaces none", () => {
    it("writes adjacent signs for words separated by one space", () => {
        expect(encode("ho jing")).toMatchObject({ text: FIRE + METAL, findings: [] });
    });

    it("writes nothing for a run of spaces, tabs or line breaks", () => {
        for (const gap of ["  ", "\t", "\n", " \n\t ", "\r\n", "  "])
            expect(encode(`ho${gap}jing${gap}sui`)).toMatchObject({
                text: FIRE + METAL + WATER,
                findings: [],
            });
    });

    it("writes a compound as its parts side by side, with nothing between it and its neighbor", () => {
        expect(encode("hosui jing")).toMatchObject({ text: FIRE + WATER + METAL, findings: [] });
    });

    it("keeps literal codage and standard punctuation as declared", () => {
        expect(encode("ho ⟦WATER⟧ jing.")).toMatchObject({
            text: FIRE + OPEN + WATER + CLOSE + METAL + period,
            findings: [],
        });
        expect(encodeText(signs, "⟦FIRE METAL⟧ ⟦WATER⟧")).toBe(
            OPEN + FIRE + METAL + CLOSE + OPEN + WATER + CLOSE,
        );
    });

    it("keeps the verse line mark at a verse line break", () => {
        expect(encode("ho\njing", { verse: true }).text).toBe(
            FIRE + encodeText(signs, "/") + METAL,
        );
    });

    it("reports a word with no writing at the word", () => {
        const result = encode("ho  zaw jing");
        expect(result.text).toBe("");
        expect(result.findings).toEqual([
            expect.objectContaining({
                offset: 4,
                column: 5,
                message: expect.stringMatching(/`zaw` has no writing in the `tant` lexicon/),
            }),
        ]);
    });

    it("decodes adjacent signs with a space after each word", () => {
        const plain = { language: "tant", data: { words: lexicon.data.words.slice(0, 3) } };
        const decode = (text: string) => decodeWithLanguage(signs, text, { lexicon: plain });
        expect(decode(FIRE + METAL + WATER)).toMatchObject({ text: "ho jing sui", findings: [] });
        expect(decode(FIRE + METAL + period)).toMatchObject({ text: "ho jing.", findings: [] });
        expect(decode(FIRE + OPEN + WATER + CLOSE + METAL)).toMatchObject({
            text: "ho ⟦WATER⟧ jing",
            findings: [],
        });
    });
});

describe("encodings for scripts that space their words", () => {
    it("keep one space for a run of whitespace in a lossy alphabetic encoding", () => {
        const letters = compileEncoding(
            { language: "alph", font: "signs", mappings: { a: "FIRE", b: "METAL" }, rules },
            { codes },
        );
        expect(encodeText(letters, "ab \n\t ba")).toBe(`${FIRE}${METAL} ${METAL}${FIRE}`);
        expect(decodeText(letters, `${FIRE}${METAL} ${METAL}${FIRE}`)).toBe("ab ba");
    });

    it("keep the space between codes in an exact literal encoding", () => {
        const literal = compileEncoding(
            {
                language: "zxx",
                font: "signs",
                mappings: {},
                accepts: [],
                rules: { normalization: "NFC", matching: "longest-first", roundTrip: "exact" },
            },
            { codes },
        );
        const native = encodeText(literal, "⟦FIRE⟧ ⟦METAL⟧");
        expect(native).toBe(`${OPEN}${FIRE}${CLOSE} ${OPEN}${METAL}${CLOSE}`);
        expect(decodeText(literal, native)).toBe("⟦FIRE⟧ ⟦METAL⟧");
    });
});

const spaced = compileEncoding(
    { language: "tant", font: "signs", mappings: {}, rules },
    { codes, name: "tantsigns" },
);
const refusal = (data: Record<string, unknown>) => {
    try {
        compileEncoding(
            { language: "tant", font: "signs", mappings: {}, ...data },
            { codes, name: "refused" },
        );
    } catch (error: any) {
        return error;
    }
    return undefined;
};

describe("decoding an unspaced passage", () => {
    const plain = { language: "tant", data: { words: lexicon.data.words.slice(0, 3) } };
    const through = (enc: any, text: string, verse = false) =>
        decodeWithLanguage(enc, encodeWithLanguage(enc, text, { lexicon: plain, verse }).text, {
            lexicon: plain,
        });
    const cases: [string, string][] = [
        ["ho jing. sui", "ho jing. sui"],
        ["ho, jing? sui", "ho, jing? sui"],
        ["{ho} jing", "{ho} jing"],
        ["ho {jing} sui", "ho {jing} sui"],
        ["«ho jing» sui", "«ho jing» sui"],
        ["ho — jing", "ho — jing"],
        ["ho ⟦WATER⟧ jing", "ho ⟦WATER⟧ jing"],
        ["⟦WATER⟧ ho ⟦FIRE⟧", "⟦WATER⟧ ho ⟦FIRE⟧"],
        ["ho… sui", "ho… sui"],
    ];
    for (const [source, expected] of cases)
        it(`reads ${source} with the spaces of a spaced script`, () => {
            expect(through(signs, source).text).toBe(expected);
            expect(through(spaced, source).text).toBe(through(signs, source).text);
            expect(through(signs, source).findings).toEqual([]);
        });
    it("puts a space around the verse line and stanza marks", () => {
        for (const source of ["ho / jing", "ho / jing // sui", "ho // sui"])
            expect(through(signs, source, true).text).toBe(through(spaced, source, true).text);
        expect(through(signs, "ho / jing", true).text).toBe("ho / jing");
    });
    it("reads Roman whitespace in the sign text as a word boundary", () => {
        const plainDecode = (text: string) => decodeWithLanguage(signs, text, { lexicon: plain });
        expect(plainDecode(`${FIRE} ${METAL}\n${WATER}`)).toMatchObject({
            text: "ho jing sui",
            findings: [],
        });
    });
});

describe("an unspaced encoding that has letter mappings and lexical natives", () => {
    const mapped = compileEncoding(
        {
            language: "tant",
            font: "signs",
            mappings: { ho: "FIRE", jing: "METAL", sui: "WATER" },
            rules: unspacedRules,
        },
        { codes, name: "tantsigns" },
    );
    const plain = { language: "tant", data: { words: lexicon.data.words.slice(0, 3) } };
    const through = (text: string) =>
        decodeWithLanguage(mapped, encodeWithLanguage(mapped, text, { lexicon: plain }).text, {
            lexicon: plain,
        });
    it("encodes adjacent signs across one space or a run of whitespace", () => {
        for (const gap of [" ", "  ", "\t", "\n", " \n\t ", "\r\n", "\n\n"]) {
            expect(
                encodeWithLanguage(mapped, `ho${gap}jing${gap}sui`, { lexicon: plain }),
            ).toMatchObject({ text: FIRE + METAL + WATER, findings: [] });
            expect(through(`ho${gap}jing${gap}sui`)).toMatchObject({
                text: "ho jing sui",
                findings: [],
            });
        }
    });
    it("reads the longest lexical writing first", () => {
        const longer = {
            language: "tant",
            data: { words: [...plain.data.words, word("jingsui", METAL + WATER)] },
        };
        expect(decodeWithLanguage(mapped, FIRE + METAL + WATER, { lexicon: longer })).toMatchObject(
            { text: "ho jingsui", findings: [] },
        );
    });
    it("decodes adjacent words with a space after each word", () => {
        expect(through("ho jing")).toMatchObject({ text: "ho jing", findings: [] });
        expect(through("ho jing sui")).toMatchObject({ text: "ho jing sui", findings: [] });
    });
    it("keeps the spaces around marks and literal spans", () => {
        expect(through("ho jing.")).toMatchObject({ text: "ho jing.", findings: [] });
        expect(through("ho, jing? sui")).toMatchObject({ text: "ho, jing? sui", findings: [] });
        expect(through("ho ⟦WATER⟧ jing")).toMatchObject({
            text: "ho ⟦WATER⟧ jing",
            findings: [],
        });
    });
    it("reads mapped letters beside a lexical word with a space between them", () => {
        const only = { language: "tant", data: { words: [lexicon.data.words[1]] } };
        const decode = (text: string) => decodeWithLanguage(mapped, text, { lexicon: only });
        expect(decode(FIRE + METAL).text).toBe("ho jing");
        expect(decode(FIRE + METAL + period).text).toBe("ho jing.");
    });
});

describe("the word-spaces key", () => {
    it("refuses a value other than space or none with the key located", () => {
        const error = refusal({ rules: { ...rules, "word-spaces": "tab" } });
        expect(error?.key).toBe("rules.word-spaces");
        expect(error?.message).toMatch(/word-spaces is space or none/);
    });
    it("refuses word-separators on a none note, with the key located", () => {
        const error = refusal({
            rules: { ...unspacedRules, "word-separators": ["·"] },
            accepts: ["·"],
        });
        expect(error?.key).toBe("rules.word-separators");
        expect(error?.message).toMatch(/word-spaces: none/);
    });
    it("is declared in the rules vocabulary with its values", () => {
        const field = ENCODING_RULE_FIELDS.find((f: any) => f.name === "word-spaces") as any;
        expect(field.allowed).toEqual(["space", "none"]);
        expect(field.describe).toMatch(/default space/);
    });
    it("is accepted as space or none and refused outside them by the note lint", () => {
        const lint = (value: string) => {
            const fm = {
                type: "doc",
                shortcode: "spaces",
                name: { full: "Spaces" },
                data: {
                    language: "tant",
                    font: "signs",
                    mappings: {},
                    rules: {
                        normalization: "NFC",
                        matching: "longest-first",
                        roundTrip: "none",
                        "word-spaces": value,
                    },
                },
            };
            return lintNote(
                { file: "spaces.md", fm, raw: `---\n${YAML.stringify(fm)}---\n` } as any,
                {
                    schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
                    vocabulary: NOTE_VOCABULARY,
                } as any,
            );
        };
        expect(lint("none")).toEqual([]);
        expect(lint("space")).toEqual([]);
        expect(lint("tab")).toEqual([
            expect.objectContaining({ message: expect.stringMatching(/word-spaces/) }),
        ]);
    });
    it("keeps one space in a codage encoding unless it declares none", () => {
        const literal = (extra: object) =>
            compileEncoding(
                {
                    language: "zxx",
                    font: "signs",
                    mappings: {},
                    accepts: [],
                    rules: { normalization: "NFC", matching: "longest-first", ...extra },
                },
                { codes },
            );
        expect(encodeText(literal({}), "⟦FIRE⟧ ⟦METAL⟧")).toBe(
            `${OPEN}${FIRE}${CLOSE} ${OPEN}${METAL}${CLOSE}`,
        );
        const joined = literal({ "word-spaces": "none" });
        expect(encodeText(joined, "⟦FIRE⟧ ⟦METAL⟧")).toBe(
            `${OPEN}${FIRE}${CLOSE}${OPEN}${METAL}${CLOSE}`,
        );
        expect(decodeText(joined, `${OPEN}${FIRE}${CLOSE}${OPEN}${METAL}${CLOSE}`)).toBe(
            "⟦FIRE⟧⟦METAL⟧",
        );
    });
});

describe("an encoding note that declares word-spaces none", () => {
    const note = (extra: Record<string, unknown>, shortcode: string) => ({
        type: "doc",
        shortcode,
        name: shortcode,
        package: "demo",
        file: { path: `Docs/${shortcode}.md` },
        data: {
            language: "tant",
            font: "signs",
            mappings: {},
            rules: { normalization: "NFC", matching: "longest-first", roundTrip: "none", ...extra },
        },
    });
    const config = {
        contentPackage: "demo",
        languages: { tant: { tag: "art-x-tant", note: "skill-tant" } },
    };
    const fonts: any = {
        root: "/installed/fonts",
        version: "1.0.0",
        manifest: {
            families: [
                {
                    class: "hl-signs",
                    codepoints: [
                        { codepoint: "U+F0400", code: "FIRE" },
                        { codepoint: "U+F0401", code: "METAL" },
                        { codepoint: "U+F0402", code: "WATER" },
                    ],
                },
            ],
        },
    };
    const tongue = {
        type: "skill",
        subType: "language",
        shortcode: "tant",
        package: "demo",
        data: {
            words: [
                ["ho", "fire", FIRE],
                ["jing", "metal", METAL],
            ].map(([form, gloss, text]) => ({
                form,
                class: "n",
                gloss,
                native: [
                    { enc: "joined", text },
                    { enc: "apart", text },
                ],
            })),
        },
    };
    const loaded = encodingsFromRecords(
        [note({ "word-spaces": "none" }, "joined"), note({}, "apart")],
        config,
        fonts,
    );
    const ctx: any = {
        ...config,
        encodings: loaded.encodings,
        lexicons: lexiconsFromRecords([tongue], config),
        faces: new Map([
            [
                "signs",
                {
                    slug: "signs",
                    class: "hl-signs",
                    family: "Signs",
                    draws: new Set([0xf0400, 0xf0401, 0xf0402]),
                },
            ],
        ]),
    };
    it("loads without findings", () => {
        expect(loaded.findings).toEqual([]);
    });
    it("writes the enc= span of a prose passage with its signs side by side", () => {
        const joined = renderRuns("[ho jing]{enc=joined}", ctx);
        expect(joined.errors).toEqual([]);
        expect(joined.markdown).toContain(FIRE + METAL);
        const apart = renderRuns("[ho jing]{enc=apart}", ctx);
        expect(apart.errors).toEqual([]);
        expect(apart.markdown).toContain(`${FIRE} ${METAL}`);
    });
    it("selects the encoding and lexicon the way a consumer does", () => {
        const selection = encodingFor(ctx, { lang: "tant", font: "signs", enc: "joined" } as any);
        const result = encodeWithLanguage(loaded.encodings.get("joined"), "ho  jing", {
            lexicon: selection?.lexicon ?? [...ctx.lexicons.values()][0],
        });
        expect(result).toMatchObject({ text: FIRE + METAL, findings: [] });
    });
});
