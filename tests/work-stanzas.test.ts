/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { parseVerse, scanVerse, renderVerse, VERSE_KEYS } from "../engine/content-verse.mjs";
const fence = (body: string, attrs = "") => `::: {.verse ${attrs}}\n${body}\n:::`;
describe("work stanza structure", () => {
    it("joins source lines and reads explicit line and stanza endings", () => {
        const model = parseVerse(
            "First\ncontinued/..Second//Third\n\nFourth\n\n--- {.canto}\nLast",
        );
        expect(
            model.cantos.map((c) => c.stanzas.map((s) => s.lines.map((l) => [l.text, l.level]))),
        ).toEqual([
            [
                [
                    ["First continued", 0],
                    ["Second", 2],
                ],
                [["Third", 0]],
                [["Fourth", 0]],
            ],
            [[["Last", 0]]],
        ]);
        expect(model.groups.filter((g) => !g.cantoBreak).map((g) => g.label)).toEqual([
            "1:1",
            "1:2",
            "1:3",
            "2:1",
        ]);
    });
    it("keeps continuation periods literal and slashes in Markdown syntax", () => {
        const source = "First\n.continued [link](https://example.org/a/b) `a/b` \\/ slash/..Last";
        const model = parseVerse(source);
        expect(model.cantos[0].stanzas[0].lines.map((l) => [l.text, l.level])).toEqual([
            ["First .continued [link](https://example.org/a/b) `a/b` \\/ slash", 0],
            ["Last", 2],
        ]);
    });
    it("keeps inline span meaning across an explicit break", () => {
        const lines = parseVerse("[One/..Two]{.direction}").cantos[0].stanzas[0].lines;
        expect(lines.map((line) => [line.text, line.level])).toEqual([
            ["[One]{.direction}", 0],
            ["[Two]{.direction}", 2],
        ]);
    });
    it("joins CRLF as whitespace while retaining original coordinates", () => {
        const body = "One\r\ncontinued/Last";
        const line = parseVerse(body).cantos[0].stanzas[0].lines[0];
        expect(line.text).toBe("One continued");
        expect(line.offsets[4]).toBe(body.indexOf("continued"));
    });
    it("keeps an authored span anchor on only its first logical line", () => {
        const lines = parseVerse("[One/Two/Three]{#speaker .speaker}").cantos[0].stanzas[0].lines;
        expect(lines[0].text).toContain("#speaker");
        expect(lines.slice(1).every((line) => !line.text.includes("#speaker"))).toBe(true);
        expect(lines.every((line) => line.text.includes(".speaker"))).toBe(true);
    });
    it("protects wikilink target and attribute syntax from slash delimiters", () => {
        const model = parseVerse('[[target/path|Label]]{title="a/b"}/Last');
        expect(model.cantos[0].stanzas[0].lines.map((line) => line.text)).toEqual([
            '[[target/path|Label]]{title="a/b"}',
            "Last",
        ]);
    });
    it("retains source positions after joined lines and inline indentation", () => {
        const body = "One\ncontinued/..Last";
        const line = parseVerse(body).cantos[0].stanzas[0].lines[1];
        expect(line.offsets[0]).toBe(body.indexOf("Last"));
        expect(line.from).toBe(body.indexOf(".."));
    });
    it("finds empty cantos at their separators", () => {
        for (const [body, offset] of [
            ["--- {.canto}\nA", 0],
            ["A\n\n--- {.canto}", 3],
            ["A\n\n--- {.canto}\n\n--- {.canto}\nB", 17],
        ] as const) {
            expect(parseVerse(body).errors).toEqual([
                { offset, message: "a canto break needs a stanza before and after it" },
            ]);
        }
    });
    it("scopes work keys to existing page-opening headings", () => {
        const one = fence("A", "work=w");
        for (const heading of ["# Next", "## Next {#next}"]) {
            const source = one + "\n\n" + heading + "\n\n" + one;
            expect(scanVerse(source).errors.map((error) => error.message)).toEqual([
                "work=w has only one version",
                "work=w has only one version",
            ]);
        }
        expect(scanVerse(one + "\n\n## Subheading\n\n" + one).errors).toEqual([]);
    });
    it("accepts work and refuses undeclared numbering and columns", () => {
        expect(VERSE_KEYS).toContain("work");
        expect(scanVerse(fence("A", "cols=2 numstep=1")).errors.map((e) => e.message)).toEqual([
            "cols= is not a verse attribute",
            "numstep= is not a verse attribute",
        ]);
    });
    it("compares stanza shapes across versions, never their line counts", () => {
        expect(
            scanVerse(fence("A/B\n\nC", "work=w") + "\n\n" + fence("D\n\nE/F/G", "work=w")).errors,
        ).toEqual([]);
        const source = fence("A\n\nB", "work=w") + "\n\n" + fence("C", "work=w");
        const errors = scanVerse(source).errors;
        expect(errors).toHaveLength(2);
        expect(errors.map((e) => e.line)).toEqual([1, 7]);
        expect(errors.every((e) => /canto 1.*2.*1/.test(e.message))).toBe(true);
        expect(scanVerse(fence("A", "work=alone")).errors[0].message).toContain("only one version");
        expect(scanVerse(fence("A", "work=alone"), { checkWorks: false }).errors).toEqual([]);
    });
    it("keeps native canto marks in their script font and direction", () => {
        const body = "A\n\n--- {.canto}\nB",
            model = parseVerse(body);
        const mark = "\u{F0200}";
        model.groups.find((group) => group.cantoBreak).text = mark;
        for (const group of model.groups)
            if (!group.cantoBreak) for (const line of group.lines) line.romanText = line.text;
        const verses = new Map([
            [
                body,
                { model, classes: ["hl-script"], attributes: { lang: "art-x-demo", dir: "rtl" } },
            ],
        ]);
        const html = renderVerse(fence(body), { verses }).markdown;
        expect(html).toContain(
            `<span class="verse-canto-break" aria-hidden="true"><span class="verse-native hl-script" lang="art-x-demo" dir="rtl">${mark}</span></span>`,
        );
        expect(html.match(new RegExp(mark, "g"))).toHaveLength(1);
    });
    it("labels stanzas only when work is stated", () => {
        expect(
            renderVerse(fence("A/B\n\nC", "work=w")).markdown.match(/class="verse-label"/g),
        ).toHaveLength(2);
        expect(renderVerse(fence("A/B")).markdown).not.toContain("verse-label");
    });
});
