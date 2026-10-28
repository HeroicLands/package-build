/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { runContext, scanRuns, renderRuns } from "../engine/content-scripts.mjs";
import { checkLanguageData } from "../engine/language-data.mjs";
import { languageNoteFindings } from "../engine/encoding-lexicon.mjs";
import { compileTestEncoding } from "./helpers/encoding.js";

const config = {
    contentPackage: "demo",
    languages: {
        vyl: { tag: "art-x-vyl", note: "skill-vyl" },
        other: { tag: "art-x-other", note: "skill-other" },
        silent: { tag: "art-x-silent", note: "skill-silent" },
    },
};
const language = (shortcode: string, roman?: string) => ({
    package: "demo",
    system: "note",
    type: "skill",
    subType: "language",
    shortcode,
    data: roman === undefined ? {} : { roman },
});
const records = [language("vyl", "kaKàÀ1"), language("other", "x"), language("silent", "")];
const context = (notes = records) => ({
    ...runContext(config, notes),
    encodingFindings: [],
    wordBooks: new Map(),
});
const errors = (source: string, ctx = context()) => scanRuns(source, ctx).errors;
const semicolon = (source: string, ctx = context()) =>
    errors(source, ctx).filter((error) => error.message.includes("U+003B"));

describe("a language's literal Roman characters", () => {
    it("rejects semicolon in a Roman span at the original source character", () => {
        const source = "Before [ka;]{lang=vyl} after.";
        expect(semicolon(source)).toEqual([
            {
                line: 1,
                column: source.indexOf(";") + 1,
                message:
                    "`;` (U+003B) is not standard Roman punctuation; write `,` for a pause within a sentence or `.` between complete sentences",
            },
        ]);
    });
    it("permits only explicitly declared case, accents and digits", () => {
        expect(errors("[Kà ka.1]{lang=vyl}")).toEqual([]);
        const source = "[Ká a2]{lang=vyl}";
        expect(errors(source).map((error) => error.column)).toEqual([3, 6]);
    });
    it("uses the same inventory for a configured BCP 47 tag", () => {
        expect(semicolon("[ka;]{lang=art-x-vyl}")).toHaveLength(1);
        expect(semicolon("::: {lang=ART-x-VYL}\nka;\n:::")).toHaveLength(1);
        expect(errors("[An external language, really!]{lang=en}")).toEqual([]);
        expect(errors("[?!]{lang=zxx}")).toEqual([]);
    });
    it("respects the nearest nested language and checks inherited children once", () => {
        const source = "[ka [x,]{lang=other} [ka;]{.name}]{lang=vyl}";
        expect(semicolon(source).map((error) => error.column)).toEqual([
            source.lastIndexOf(";") + 1,
        ]);
    });
    it("checks paragraphs, verse and scroll text with the same character rule", () => {
        expect(semicolon("::: {lang=vyl}\nka;\n:::")).toHaveLength(1);
        expect(semicolon("```verse {lang=vyl}\nka;\n```")).toHaveLength(1);
    });
    it("excludes indent periods and explicit verse separators", () => {
        const source = "```verse {lang=vyl}\n...[ka.]{lang=vyl}/\nka.\n\n***\n\nka./\nka.\n```";
        expect(errors(source)).toEqual([]);
        expect(errors("```verse {lang=vyl}\n...ka.\n***\nka.\n```")).toEqual([]);
    });
    it("checks escaped punctuation at the punctuation, without accepting its escape", () => {
        const source = "[ka\\;]{lang=vyl}";
        expect(semicolon(source).map((error) => error.column)).toEqual([source.indexOf(";") + 1]);
        expect(errors("::: {lang=vyl}\nka.\\\nka.\n:::")).toEqual([]);
    });
    it("requires NFC source spelling and counts diagnostic columns in code points", () => {
        const source = "😀 [ka\u0300;]{lang=vyl}";
        expect(errors(source)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    line: 1,
                    column: [...source.slice(0, source.indexOf("a"))].length + 1,
                    message: expect.stringContaining("NFC"),
                }),
                expect.objectContaining({
                    line: 1,
                    column: [...source.slice(0, source.indexOf(";"))].length + 1,
                    message: expect.stringContaining("U+003B"),
                }),
            ]),
        );
    });
    it.each([
        "[[doc-target#anchor|ka;]]{lang=vyl}",
        "[[doc-target#anchor|ka;]]{lang=art-x-vyl}",
        "[[ka;](/target-with-comma,/)]{lang=vyl}",
        "[@UUID[Compendium.demo.entries.Item.id]{ka;}]{lang=vyl}",
    ])("checks only the visible linked label in %s", (source) => {
        expect(semicolon(source).map((error) => error.column)).toEqual([source.indexOf(";") + 1]);
    });
    it("checks raw labels in inherited language runs and excludes link syntax", () => {
        const source = "[ka [[doc-target|ka;]]{lang=vyl} ka.]{lang=vyl}";
        expect(semicolon(source).map((error) => error.column)).toEqual([source.indexOf(";") + 1]);
        expect(errors("[[doc-target-with-comma,|ka.]]{lang=vyl}")).toEqual([]);
    });
    it("rejects invalid input before a map or lexicon can conceal it", () => {
        const mapped = {
            ...context(),
            encodings: new Map([
                ["m", compileTestEncoding({ name: "m", rows: [["ka;", "◇"]], fonts: ["face"] })],
            ]),
            faces: new Map([
                ["face", { slug: "face", family: "Face", class: "face", draws: new Set([0x25c7]) }],
            ]),
        };
        expect(semicolon("[ka;]{lang=vyl font=face enc=m}", mapped)).toHaveLength(1);
        expect(semicolon("[ka;]{lang=vyl font=mono}")).toHaveLength(1);
    });
    it("checks source even when native font resolution already failed", () => {
        expect(semicolon("[ka;]{lang=vyl}")).toHaveLength(1);
    });
    it("keeps direct native signs separate from the Roman source inventory", () => {
        const sign = "\u{F0200}";
        const ctx = {
            ...context(),
            faces: new Map([
                [
                    "face",
                    {
                        slug: "face",
                        family: "Face",
                        class: "face",
                        draws: new Set([0xf0200, 0x3b]),
                    },
                ],
            ]),
        };
        for (const source of [
            `[${sign}]{lang=vyl font=face}`,
            `[[doc-target|${sign}]]{lang=vyl font=face}`,
        ])
            expect(errors(source, ctx)).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ message: expect.stringContaining("⟦U+F0200⟧") }),
                ]),
            );
        expect(errors(`[${sign}]{lang=vyl}`, ctx)).toEqual([
            expect.objectContaining({ message: expect.stringContaining("U+F0200") }),
        ]);
        expect(errors("[\u{F0201}]{lang=vyl font=face}", ctx)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ message: expect.stringContaining("⟦U+F0201⟧") }),
            ]),
        );
        expect(semicolon("[;]{lang=vyl font=face}", ctx)).toHaveLength(1);
    });
    it("checks native scroll source while excluding valid emphasis delimiters", () => {
        const ctx = {
            ...context(),
            faces: new Map([
                [
                    "vertical",
                    {
                        slug: "vertical",
                        family: "Vertical",
                        class: "vertical",
                        draws: new Set([0x6b, 0x61, 0x2e, 0x3b]),
                    },
                ],
            ]),
            encodings: new Map([
                [
                    "vertical",
                    compileTestEncoding({ name: "vertical", fonts: ["vertical"], rows: [] }),
                ],
            ]),
            directions: new Map([["vertical", "vertical-rl"]]),
        };
        expect(
            semicolon("```scroll {lang=vyl enc=vertical font=vertical}\nka;\n```", ctx),
        ).toHaveLength(1);
        expect(
            errors("```scroll {lang=vyl enc=vertical font=vertical}\nka *ka.*\n```", ctx),
        ).toEqual([]);
    });
    it("does not inherit a family inventory or admit other Unicode letters", () => {
        const parent = language("parent", "kx");
        const child = { ...language("vyl", "ka"), data: { roman: "ka", family: "skill-parent" } };
        expect(
            errors("[xЖ]{lang=vyl}", context([child, parent])).map((error) => error.message),
        ).toEqual([expect.stringContaining("U+0078"), expect.stringContaining("U+0416")]);
    });
    it("preserves explicit sign notation tagged zxx through its mapping", () => {
        const sign = "\u{F0200}";
        const ctx = {
            ...context(),
            encodings: new Map([
                [
                    "notation",
                    compileTestEncoding({
                        name: "notation",
                        fonts: ["face"],
                        rows: [
                            ["16-024", sign],
                            [":", sign],
                            ["*", sign],
                        ],
                    }),
                ],
            ]),
            faces: new Map([
                [
                    "face",
                    { slug: "face", family: "Face", class: "face", draws: new Set([0xf0200]) },
                ],
            ]),
        };
        const source = "[16-024:16-024\\*16-024]{lang=zxx enc=notation font=face}";
        expect(errors(source, ctx)).toEqual([]);
        expect(renderRuns(source, ctx).markdown).toContain(sign.repeat(5));
        expect(errors(source.replace("lang=zxx", "lang=vyl"), ctx)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ message: expect.stringContaining("U+003A") }),
            ]),
        );
    });
    it("rejects punctuation hidden by an entire word's native spelling", () => {
        const sign = "\u{F0200}";
        const nativeWord = {
            ...language("vyl", "ka"),
            data: {
                roman: "ka",
                words: [
                    {
                        form: "k'a",
                        class: "n",
                        gloss: "fixture",
                        native: [{ enc: "m", text: sign }],
                    },
                ],
            },
        };
        const ctx = {
            ...runContext(config, [nativeWord]),
            encodingFindings: [],
            encodings: new Map([
                [
                    "m",
                    compileTestEncoding({
                        name: "m",
                        rows: [
                            ["k", sign],
                            ["a", sign],
                        ],
                        fonts: ["face"],
                    }),
                ],
            ]),
            faces: new Map([
                [
                    "face",
                    { slug: "face", family: "Face", class: "face", draws: new Set([0xf0200]) },
                ],
            ]),
        };
        expect(errors("[k'a]{lang=vyl enc=m font=face}", ctx)).toEqual([
            expect.objectContaining({ column: 3, message: expect.stringContaining("U+0027") }),
        ]);
    });
    it("checks NFC for composing Unicode sequences beyond base-plus-mark pairs", () => {
        const ctx = context([language("vyl", "ᄀxᅡ")]);
        expect(errors("[가]{lang=vyl}", ctx)).toEqual([
            expect.objectContaining({ column: 2, message: expect.stringContaining("NFC") }),
        ]);
    });
    it("distinguishes an explicit empty alphabet from a missing declaration", () => {
        expect(errors("[ ]{lang=silent}")).toEqual([]);
        expect(errors("[k]{lang=silent}")).toHaveLength(1);
        expect(errors("[ka]{lang=vyl}", context([language("vyl")]))).toEqual([
            expect.objectContaining({
                message: expect.stringContaining("must declare `data.roman`"),
            }),
        ]);
    });
    it("requires an inventory for every configured language note even without text", () => {
        expect(languageNoteFindings(config, records)).toEqual([]);
        expect(languageNoteFindings(config, [language("vyl"), ...records.slice(1)])).toEqual([
            expect.objectContaining({
                message: expect.stringContaining("must declare `data.roman`"),
            }),
        ]);
    });
    it("validates inventory normalization, duplicate characters and structural whitespace", () => {
        const findings = (roman: string) =>
            checkLanguageData({ file: "language.md", raw: "", fm: language("vyl", roman) });
        expect(findings("kaKàÀ1")).toEqual([]);
        expect(findings("")).toEqual([]);
        expect(findings("aa")).toEqual([
            expect.objectContaining({ message: expect.stringContaining("repeats") }),
        ]);
        expect(findings("a\u0300")).toEqual([
            expect.objectContaining({ message: expect.stringContaining("NFC") }),
        ]);
        expect(findings("a b")).toEqual([
            expect.objectContaining({ message: expect.stringContaining("whitespace") }),
        ]);
    });
});
