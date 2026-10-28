/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import {
    compileEncoding,
    compileRows,
    decodeText,
    encodePieces,
    encodeText,
} from "../engine/encoding.mjs";
import { encodeWithLanguage } from "../engine/encoding-language.mjs";
import { renderRuns, scanRuns } from "../engine/content-scripts.mjs";
import { plainRomanVerse } from "../engine/roman-verse.mjs";
import { STANDARD_CONTROLS } from "../engine/encoding-standard.mjs";
import { romanTextProblems } from "../engine/roman-characters.mjs";

const slash = "\u{E010F}",
    line = "\u{E010C}",
    stanza = "\u{E010D}",
    canto = "\u{E010E}";
const encoding = () =>
    compileEncoding(
        {
            language: "vyl",
            font: "script",
            mappings: { word: "WORD", and: "AND", or: "OR" },
            rules: { normalization: "NFC", matching: "longest-first" },
        },
        { name: "letters", codes: { WORD: "字", AND: "和", OR: "或" } },
    );
const context = (enc = encoding()) => ({
    languages: { vyl: { tag: "art-x-vyl" } },
    romanInventories: new Map([["vyl", { language: "vyl", characters: new Set("wordan") }]]),
    faces: new Map([
        [
            "script",
            {
                slug: "script",
                family: "Script",
                class: "hl-script",
                draws: new Set([0x5b57, 0x548c, 0x6216]),
            },
        ],
    ]),
    encodings: new Map([["letters", enc]]),
});
const div = (body: string) => `::: {.verse lang=vyl enc=letters}\n${body}\n:::`;

describe("verse encoding controls", () => {
    it("keeps a literal slash distinct from the line control in direct and language-aware conversion", () => {
        const enc = encoding(),
            source = "and\\/or/word";
        expect(encodeText(enc, source, { verse: true })).toBe(`和${slash}或${line}字`);
        expect(decodeText(enc, `和${slash}或${line}字`)).toBe(source);
        expect(encodeWithLanguage(enc, source, { verse: true })).toMatchObject({
            text: `和${slash}或${line}字`,
            findings: [],
        });
        expect(encodePieces(enc, "and\\/or")[1]).toMatchObject({
            from: "\\/",
            to: slash,
            start: 3,
            end: 5,
        });
    });

    it("retains the escaped slash and source positions in the verse projection", () => {
        const source = "word and\\/or/word",
            projected = plainRomanVerse(source);
        expect(projected.text).toBe("word and\\/or\nword");
        expect(projected.offsets[8]).toBe(source.indexOf("\\"));
        expect(projected.boundaries).toEqual([
            { kind: "line", sourceOffset: source.lastIndexOf("/"), at: 12 },
        ]);
    });

    it("preserves literal slashes in div and inline native output without an internal line ending", () => {
        const ctx = context();
        const source = div("and\\/or/word");
        expect(scanRuns(source, ctx).errors).toEqual([]);
        const result = renderRuns(source, ctx);
        expect(result.errors).toEqual([]);
        const group = [...result.verses.values()][0].model.groups[0];
        expect(group.lines).toMatchObject([
            { text: `和${slash}或${line}`, romanText: "and\\/or" },
            { text: "字", romanText: "word" },
        ]);
        const inline = renderRuns(
            "Before [and\\/or/word]{.verse lang=vyl enc=letters} after.",
            ctx,
        );
        expect(inline.errors).toEqual([]);
        expect(inline.markdown).toBe(
            `Before [和${slash}或${line}字]{lang=art-x-vyl .script .hl-script} after.`,
        );
    });

    it("locates unsupported literal slashes instead of encoding them as line controls", () => {
        const enc = compileRows({
            name: "letters",
            fonts: ["script"],
            accepts: ["a-z", "/"],
            separator: " ",
            rows: [
                ["word", "字"],
                ["/", line],
            ],
        });
        for (const source of [div("word\\/word"), "[word\\/word]{.verse lang=vyl enc=letters}"]) {
            const findings = scanRuns(source, context(enc)).errors;
            expect(findings).toHaveLength(1);
            expect(findings[0]).toMatchObject({
                line: source.startsWith(":::") ? 2 : 1,
                column: source.startsWith(":::") ? 5 : 6,
            });
            expect(renderRuns(source, context(enc)).markdown).toBe(source);
        }
    });

    it.each(["\n", "\r\n"])(
        "encodes a stanza before a *** canto without a following line mark (%j)",
        (newline) => {
            const enc = encoding(),
                source = `word${newline}${newline}***${newline}${newline}word`;
            expect(encodeText(enc, source, { verse: true })).toBe(`字${stanza}${canto}字`);
            expect(encodeWithLanguage(enc, source, { verse: true })).toMatchObject({
                text: `字${stanza}${canto}字`,
                findings: [],
            });
            expect(decodeText(enc, canto)).toBe("***");
            expect(decodeText(enc, `字${stanza}${canto}字`)).toBe("word\n\n***word");
            expect(() => encodeText(enc, "--- {.canto}", { verse: true })).toThrow();
        },
    );

    it("uses the encoded canto in the native model and source replacement", () => {
        const source = div('word\n\n--- {.canto #answer title="The Answer"}\nword');
        const result = renderRuns(source, context());
        expect(result.errors).toEqual([]);
        const model = [...result.verses.values()][0].model;
        expect(model.groups.find((group) => group.cantoBreak)).toMatchObject({
            text: canto,
            id: "answer",
            title: "The Answer",
        });
        expect(result.markdown).toContain(canto);
        expect(
            model.groups.filter((group) => !group.cantoBreak).map((group) => group.lines[0].text),
        ).toEqual([`字${stanza}`, "字"]);
    });

    it("renders CRLF divs with the same stanza and canto controls as LF divs", () => {
        const sources = ["\n", "\r\n"].map((newline) =>
            [
                "::: {.verse lang=vyl enc=letters}",
                "word",
                "",
                "--- {.canto}",
                "",
                "word",
                ":::",
            ].join(newline),
        );
        const results = sources.map((source) => renderRuns(source, context()));
        for (const result of results) {
            expect(result.errors).toEqual([]);
            expect(result.markdown).not.toContain("--- {.canto}");
            expect(result.markdown).toContain(stanza);
            expect(result.markdown).toContain(canto);
            const model = [...result.verses.values()][0].model;
            expect(model.groups.find((group) => group.cantoBreak)).toMatchObject({ text: canto });
            expect(
                model.groups
                    .filter((group) => !group.cantoBreak)
                    .map((group) => group.lines[0].text),
            ).toEqual([`字${stanza}`, "字"]);
        }
        expect(results[1].markdown.replaceAll("\r\n", "\n")).toBe(results[0].markdown);
    });

    it("preserves literal slashes, Roman footnotes and located findings in CRLF verse", () => {
        const source = [
            "::: {.verse lang=vyl enc=letters}",
            "and[^note]\\/or",
            "",
            "--- {.canto}",
            "word",
            ":::",
            "",
            "[^note]: A note.",
        ].join("\r\n");
        const result = renderRuns(source, context());
        expect(result.errors).toEqual([]);
        const model = [...result.verses.values()][0].model;
        const first = model.groups.find((group) => !group.cantoBreak);
        expect(first.lines[0]).toMatchObject({
            text: `和${slash}或${stanza}`,
            romanText: "and[^note]\\/or",
        });
        expect(model.groups.find((group) => group.cantoBreak)).toMatchObject({ text: canto });
        expect(result.markdown).not.toContain("--- {.canto}");
        const bad = source.replace("word\r\n:::", "word\\/$\r\n:::");
        expect(scanRuns(bad, context()).errors).toEqual([
            expect.objectContaining({ line: 5, column: 7 }),
        ]);
    });

    it("uses the selected face and includes control rows in its decoder", () => {
        const enc = compileRows({
            name: "letters",
            fonts: ["script", "other"],
            accepts: ["a", "\\", "/"],
            separator: " ",
            controls: STANDARD_CONTROLS,
            rows: [
                ["a", "A"],
                ["\\/", slash],
                ["/", line],
            ],
            faces: { other: { rows: [["a", "B"]] } },
        });
        expect(encodeText(enc, "a\\/a\n\n***\na", { font: "other", verse: true })).toBe(
            `B${slash}B${stanza}${canto}B`,
        );
        expect(decodeText(enc, `B${slash}B${stanza}${canto}B`, { font: "other" })).toBe(
            "a\\/a\n\n***a",
        );
    });

    it("does not recognize a canto in the middle of a line or as a prefix", () => {
        const enc = encoding();
        for (const source of ["word***word", "***word"])
            expect(() => encodeText(enc, source, { verse: true })).toThrow();
    });

    it("does not treat a literal slash as a new indentation boundary", () => {
        const enc = encoding();
        expect(() => encodeText(enc, "word\\/^word")).toThrow(
            expect.objectContaining({ offset: 6 }),
        );
        expect(
            romanTextProblems("word\\/^word", { language: "vyl", characters: new Set("word") }),
        ).toEqual([
            expect.objectContaining({ offset: 6, message: expect.stringMatching(/indentation/) }),
        ]);
    });

    it("reports an absent canto control instead of bypassing the encoder", () => {
        const enc = compileRows({
            name: "letters",
            fonts: ["script"],
            accepts: ["a-z", "/"],
            separator: " ",
            rows: [
                ["word", "字"],
                ["/", line],
            ],
            controls: { verseStanza: stanza },
        });
        expect(scanRuns(div("word\n\n--- {.canto}\nword"), context(enc)).errors).toEqual([
            expect.objectContaining({
                line: 4,
                column: 1,
                message: expect.stringMatching(/encoding/),
            }),
        ]);
    });
});
