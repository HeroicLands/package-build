// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileMap } from "../engine/text-maps.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";

const verse = (body: string, attrs = "cols=4") => `\`\`\`verse {${attrs}}\n${body}\n\`\`\``;

describe("numbered verse column print layout", () => {
    it("keeps sparse cells and unlimited repeats aligned, resetting foreground each row", () => {
        const result = markdownToTypst(
            verse("2 first\n2 second\n2 third\n2 fourth\n4 last\n\n1 next\n3 middle"),
        );
        expect(result).toContain("#grid(columns: (1fr, 1fr, 1fr, 1fr)");
        expect(result).toContain("  [], [#stack(");
        expect(result).toContain("[last],");
        expect(result).toContain("  [next], [], [middle], [],");
        expect(result.match(/fill: luma\(45%\)/g)).toHaveLength(3);
        expect(result).not.toContain("2 first");
    });

    it("numbers logical rows and spans stanza breaks over all columns and the gutter", () => {
        const result = markdownToTypst(
            verse("1 a\n1 repeat\n3 b\n\n***\n\n2 c\n\n4 d", "cols=4 numstep=2"),
        );
        expect(result).toContain("#grid(columns: (2.5em, 1fr, 1fr, 1fr, 1fr)");
        expect(result).toContain("grid.cell(colspan: 5)[#v(0.5em)]");
        expect(result).toContain("[#text(fill: luma(45%))[2]], [], [c], [], [],");
        expect(result).not.toContain("[4],");
    });

    it("keeps column order fixed while indenting each part in its own direction", () => {
        const result = markdownToTypst(verse("1 ..left\n3 ..שלום", "cols=3 dir=rtl"));
        expect(result).toContain("#set text(dir: ltr)\n#grid");
        expect(result).toContain("#pad(left: 2.5em)[left]");
        expect(result).toContain("#set text(dir: rtl)\n#pad(right: 2.5em)[שלום]");
    });

    it("parses links and footnotes with the surrounding document environment", () => {
        const result = markdownToTypst(
            `${verse("2 [harbor](https://example.org)[^sea]\n\n3 shore", "cols=3")}\n\n[^sea]: The sea.`,
        );
        expect(result).toContain('#link("https://example.org")[harbor]');
        expect(result).toContain("  [], [#link(");
        expect(result).toContain("#footnote[The sea.]");
        expect(result).not.toContain("[^sea]");
    });

    it("keeps native presentation on its authored linked run and Roman repeats plain", () => {
        const glyph = "\u{F0200}";
        const runs = {
            languages: { vyl: { tag: "art-x-vyl" } },
            writtenIn: new Map([["vyl", { font: "script", map: "letters" }]]),
            faces: new Map([
                [
                    "script",
                    {
                        slug: "script",
                        family: "Script",
                        class: "hl-script",
                        direction: "ltr",
                        features: [],
                        draws: new Set([glyph.codePointAt(0)]),
                    },
                ],
            ]),
            maps: new Map([
                [
                    "letters",
                    compileMap({ name: "letters", rows: [["Marendas", glyph]], fonts: ["script"] }),
                ],
            ]),
            wordBooks: new Map([
                [
                    "vyl",
                    {
                        language: "vyl",
                        accepts: (word: string) => word.toLowerCase() === "marendas",
                    },
                ],
            ]),
        };
        const result = markdownToTypst(
            verse(
                "2 [[Marendas](/target/)]{lang=vyl .nativefont}\n2 [Marendas]{lang=vyl}",
                "cols=3",
            ),
            { runs },
        );
        expect(result).toContain(
            `#link("/target/")[#book-span(classes: ("script", "hl-script"))[${glyph}]]`,
        );
        expect(result).toContain("#text(fill: luma(45%))[#box[Marendas]]");
        expect(result.match(/hl-script/g)).toHaveLength(1);
    });

    it("keeps secondary rubric emphasis and linked labels gray while retaining foreground emphasis", () => {
        const runs = {
            languages: { en: { tag: "en" } },
            faces: new Map([
                ["f", { slug: "f", family: "Face", class: "hl-f", draws: new Set([97, 98]) }],
            ]),
            languageEmphases: new Map([["en", "rubric"]]),
        };
        const findings: object[] = [];
        const result = markdownToTypst(
            verse(
                "1 [a **b**]{lang=en .nativefont font=f}\n1 [a **b**]{lang=en .nativefont font=f}\n1 [linked](/target/)",
                "cols=2 lang=en",
            ),
            { runs, findings },
        );
        expect(findings).toEqual([]);
        expect(result.match(/#text\(fill: book-rubric\)\[b\]/g)).toHaveLength(1);
        expect(result).toContain(
            '#book-span(classes: ("script", "hl-f"), lang: "en")[a #text(fill: luma(45%))[b]]',
        );
        expect(result).toContain('#link("/target/")[#text(fill: luma(45%))[linked]]');
        expect(result.match(/#book-span/g)).toHaveLength(2);
    });

    it.each([
        ["3 Outside", "cols=2", "column 3 is outside 1..2"],
        ["0 Outside", "cols=2", "column 0 is outside 1..2"],
        ["9007199254740992 Outside", "cols=2", "outside 1..2"],
        ["No prefix", "cols=2", "column number and spaces"],
        ["1. Outside", "cols=2", "column number and spaces"],
        ["1 Content", "cols=9007199254740992", "positive whole number"],
    ])(
        "reports invalid input without assigning it a display column: %s",
        (body, attrs, message) => {
            const findings: { message: string }[] = [];
            const result = markdownToTypst(verse(body, attrs), { findings });
            expect(findings).toContainEqual(
                expect.objectContaining({ message: expect.stringContaining(message) }),
            );
            expect(result).toContain(body);
            expect(result).not.toContain("#grid");
            expect(result).toBe(`\`\`\`\n${body}\n\`\`\``);
        },
    );

    it("leaves ordinary verse physical lines in the foreground", () => {
        const result = markdownToTypst(verse("1 first\n1 next\n\nlast", "cols=1"));
        expect(result).toContain("1 first");
        expect(result).not.toContain("#grid");
        expect(result).not.toContain("luma(45%)");
    });
});

describe("verse column styles shared by journal, preview and site", () => {
    it.each(["assets/styles/content-base.css", "site-theme/static/css/style.css"])(
        "%s reserves all authored columns and mutes nested content together",
        (file) => {
            const css = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
            expect(css).toMatch(
                /\.verse-row\s*\{[^}]*direction:\s*ltr;[^}]*grid-template-columns:\s*repeat\(var\(--verse-columns,\s*2\),\s*minmax\(0,\s*1fr\)\)/,
            );
            expect(css).toMatch(
                /\.verse-numbered\.verse-columns\s+\.verse-row\s*\{[^}]*grid-template-columns:\s*2.5em repeat\(var\(--verse-columns/,
            );
            expect(css).toMatch(/\.verse-secondary\s+\*\s*\{\s*color:\s*inherit;/);
        },
    );
});
