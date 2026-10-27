/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { scanRuns, renderRuns } from "../engine/content-scripts.mjs";
import { compileTestEncoding } from "./helpers/encoding.js";
import * as verse from "../engine/content-verse.mjs";

const poem = (attrs: string, ...lines: string[]) =>
    [`\`\`\`verse {${attrs}}`, ...lines, "```"].join("\n");
const groups = (source: string) =>
    verse.verseGroups(verse.scanVerse(source).blocks[0], source.split("\n"));

describe("numbered verse columns", () => {
    it("groups sparse columns and unlimited ordered repeats into logical rows", () => {
        const source = poem(
            "cols=3 numstep=2",
            "1 First",
            "1 Again",
            "1 Third reading",
            "3 Last",
            "",
            "2 Middle",
            "2 Echo",
            "",
            "***",
            "",
            "1 New stanza",
        );
        expect(verse.scanVerse(source).errors).toEqual([]);
        expect(verse.verseColumnCount(verse.scanVerse(source).blocks[0])).toBe(3);
        const rows = groups(source);
        expect(rows[0].parts.map(({ column, text }) => [column, text])).toEqual([
            [1, "First"],
            [1, "Again"],
            [1, "Third reading"],
            [3, "Last"],
        ]);
        expect(rows[1].parts.map(({ column, text }) => [column, text])).toEqual([
            [2, "Middle"],
            [2, "Echo"],
        ]);
        expect(rows[2]).toEqual({ stanzaBreak: true, line: 9 });
        expect(rows[3].parts[0].column).toBe(1);
    });

    it.each(["0", "-1", "1.5", "two", "9007199254740992"])(
        "rejects invalid cols=%s at its value",
        (cols) => {
            expect(verse.scanVerse(poem(`cols=${cols}`, "text")).errors).toContainEqual({
                line: 1,
                column: 16,
                message: "verse cols= is a positive whole number",
            });
        },
    );

    it.each([
        [
            "no prefix",
            1,
            "a verse with cols>1 starts each content line with a column number and spaces",
        ],
        ["1\ttext", 2, "tabs are not allowed in verse"],
        ["0 text", 1, "column 0 is outside 1..3"],
        ["4 text", 1, "column 4 is outside 1..3"],
        ["1 ", 1, "a numbered verse line needs content after its column number"],
    ])("locates malformed or out-of-range physical line %s", (line, column, message) => {
        expect(verse.scanVerse(poem("cols=3", line)).errors).toContainEqual({
            line: 2,
            column,
            message,
        });
    });

    it("locates decreasing columns and resets order at each blank row", () => {
        expect(verse.scanVerse(poem("cols=3", "2 middle", "  1 back")).errors).toContainEqual({
            line: 3,
            column: 3,
            message: "column numbers must not decrease within a verse row",
        });
        expect(verse.scanVerse(poem("cols=3", "3 last", "", "1 first")).errors).toEqual([]);
    });

    it("preserves authored runs, links, spacing and marker source offsets", () => {
        const source = poem(
            "cols=3",
            "  1   [..Before ]{lang=en}[[place-x|Name]]{lang=vyl}[ after]{lang=en}",
            "3 .Other",
        );
        expect(verse.scanVerse(source).errors).toEqual([]);
        expect(groups(source)[0].parts[0]).toMatchObject({
            column: 1,
            line: 1,
            sourceColumn: 3,
            textColumn: 7,
            indent: 2,
            markerStart: 7,
            markerLength: 2,
            text: "[Before ]{lang=en}[[place-x|Name]]{lang=vyl}[ after]{lang=en}",
        });
        expect(groups(source)[0].parts[1]).toMatchObject({ column: 3, text: "Other", indent: 1 });
    });

    it("renders empty cells, foreground first parts, grey repeats and logical-row numbering", () => {
        const source = poem(
            "cols=3 numstep=2",
            "1 First",
            "1 Repeat",
            "3 Last",
            "",
            "2 Middle",
            "",
            "***",
            "1 Next",
        );
        const html = verse.renderVerse(source).markdown;
        expect(html).toContain('class="verse verse-columns verse-numbered"');
        expect(html).toContain('<span class="verse-column"></span>');
        expect(html).toContain('<span class="verse-part verse-secondary">Repeat</span>');
        expect(html).toContain('<span class="verse-number">2</span>');
        expect(html.match(/class="verse-row"/g)).toHaveLength(3);
        expect(html).toContain('class="verse-stanza-break"');
        expect(html).not.toContain("1 First");
    });

    it("keeps ordinary one-column verse physical lines foreground and unprefixed", () => {
        for (const attrs of ["", "cols=1"]) {
            const source = poem(attrs, "One", "Two", "", "Three");
            expect(verse.scanVerse(source).errors).toEqual([]);
            expect(verse.verseColumnCount(verse.scanVerse(source).blocks[0])).toBe(1);
            const html = verse.renderVerse(source).markdown;
            expect(html.match(/class="verse-line"/g)).toHaveLength(3);
            expect(html).not.toContain("verse-secondary");
            expect(html).not.toContain("verse-columns");
        }
    });

    it("requires native opt-in per run while allowing a generic fence font", () => {
        expect(verse.scanVerse(poem("cols=2 lang=en font=serif", "1 One", "2 Two")).errors).toEqual(
            [],
        );
        const source = poem("cols=2 lang=vyl enc=letters", "1 One");
        expect(scanRuns(source, nativeContext).errors).toContainEqual({
            line: 1,
            column: source.indexOf("letters") + 1,
            message: "a verse with cols>1 selects encoding on individual runs, not the fence",
        });
    });
});

const nativeContext = {
    languages: { vyl: { tag: "art-x-vyl" } },
    faces: new Map([
        [
            "script",
            {
                slug: "script",
                family: "Test",
                class: "hl-script",
                draws: new Set(["字".codePointAt(0), "。".codePointAt(0)]),
            },
        ],
    ]),
    encodings: new Map([
        [
            "letters",
            compileTestEncoding({
                name: "letters",
                fonts: [{ font: "script" }],
                rows: [
                    ["word", "字"],
                    [".", "。"],
                ],
            }),
        ],
    ]),
    wordBooks: new Map([
        ["vyl", { language: "vyl", accepts: (word: string) => word.toLowerCase() === "word" }],
    ]),
};

describe("numbered columns retain authored language runs", () => {
    it("maps only opted native runs and keeps Roman repeats, prefixes and nested markers intact", () => {
        const source = poem(
            "cols=3 lang=en",
            "1 [..word]{lang=vyl enc=letters}",
            "2 A translation",
            "2 [word]{lang=vyl}",
            "3 [word]{lang=vyl}",
        );
        const result = renderRuns(source, nativeContext);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toContain("1 [..字\u{E010C}]{lang=art-x-vyl .script .hl-script}");
        expect(result.markdown).toContain("2 [word]{lang=art-x-vyl}");
        expect(result.markdown).toContain("3 [word]{lang=art-x-vyl}");
        const html = verse.renderVerse(result.markdown).markdown;
        expect(html).toContain('class="verse-part i2">[字\u{E010C}]');
        expect(html).toContain('class="verse-part verse-secondary">[word]');
        expect(html).not.toContain("1 [");
    });
    it("reports lexical faults at the original authored word after its numeric prefix", () => {
        const source = poem("cols=3 lang=vyl", "  3 [unknown]{lang=vyl}");
        expect(scanRuns(source, nativeContext).errors).toContainEqual({
            line: 2,
            column: 6,
            message: expect.stringContaining("`unknown` is not a word"),
        });
    });
    it("reports unmapped characters at their authored position without treating the prefix as text", () => {
        const source = poem("cols=3", "  3 [word7]{lang=en font=script enc=letters}");
        expect(scanRuns(source, nativeContext).errors).toEqual([
            {
                line: 2,
                column: 10,
                message:
                    "`7` encodes to U+0037 in `letters`, which the font `script` does not draw",
            },
        ]);
    });
    it("keeps located encoding diagnostics on authored runs", () => {
        const source = poem("cols=2", "1 [word]{font=script enc=missing}");
        expect(scanRuns(source, nativeContext).errors).toEqual([
            {
                line: 2,
                column: source.split("\n")[1].indexOf("missing") + 1,
                message: "`missing` does not resolve to an encoding document",
            },
        ]);
    });
});
