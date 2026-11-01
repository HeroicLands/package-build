/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { scanVerse, renderVerse } from "../engine/content-verse.mjs";
import { createRenderer } from "../engine/content-render.mjs";
import { scanSpans } from "../engine/content-spans.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";
import { plainRomanVerse } from "../engine/roman-verse.mjs";

const containers = [
    { name: "quote", before: [], prefix: "> " },
    { name: "list and quote", before: ["- Intro.", ""], prefix: "  > " },
    { name: "nested quotes and list", before: ["> - Intro.", ">"], prefix: ">   > " },
];
const body = [
    "One 🌊/",
    "..Two",
    "",
    '--- {.canto #next title="Next"}',
    "",
    "Three",
    "continued",
    "",
    "> Literal",
];
const shape = (model) =>
    model.cantos.map((canto) =>
        canto.stanzas.map((stanza) => stanza.lines.map(({ text, level }) => ({ text, level }))),
    );

for (const newline of ["\n", "\r\n"]) {
    describe(`contained verse with ${JSON.stringify(newline)} endings`, () => {
        for (const { name, before, prefix } of containers) {
            const contain = (lines: string[]) =>
                [...before, ...lines.map((line) => (line ? prefix + line : prefix.trimEnd()))].join(
                    newline,
                );
            it(`shares logical structure and authored offsets in ${name}`, () => {
                const source = contain(["::: {.verse}", ...body, ":::"]);
                const result = scanVerse(source);
                expect(result.errors).toEqual([]);
                const block = result.blocks[0];
                const bare = scanVerse(["::: {.verse}", ...body, ":::"].join(newline)).blocks[0];
                expect(shape(block.model)).toEqual(shape(bare.model));
                expect(block.body).toBe(source.slice(block.bodyStart, block.bodyEnd));
                for (const canto of block.model.cantos)
                    for (const stanza of canto.stanzas)
                        for (const line of stanza.lines)
                            for (let i = 0; i < line.text.length; i++) {
                                const actual = source[block.bodyStart + line.offsets[i]];
                                expect(/\s/.test(actual) ? " " : actual).toBe(line.text[i]);
                            }
                expect(
                    block.bodyStart + block.model.groups.find((group) => group.cantoBreak).from,
                ).toBe(source.indexOf("---"));
                const projection = plainRomanVerse(source, {
                    from: block.bodyStart,
                    to: block.bodyEnd,
                    model: block.model,
                    modelOffset: block.bodyStart,
                });
                expect(projection.text).toBe(
                    plainRomanVerse(bare.body, { model: bare.model }).text,
                );
                expect(projection.text).toContain("Three continued");
                expect(projection.text).toContain("> Literal");
                expect(projection.boundaries.map(({ kind }) => kind)).toEqual(
                    bare.model.boundaries.map(({ kind }) => kind),
                );
                for (const target of ["web", "foundry", "preview"] as const) {
                    const html = createRenderer(target).render(source);
                    expect(html.match(/class="verse-stanza"/g)).toHaveLength(3);
                    expect(html).toContain('class="verse-line i2">Two');
                    expect(html).toContain("Three continued");
                    expect(html).toContain("&gt; Literal");
                }
                const typst = markdownToTypst(source);
                expect(typst).toContain("#h(2.5em)Two");
                expect(typst).toContain("Three continued");
                const transformed = createRenderer("web").render(renderVerse(source).markdown);
                expect(transformed.match(/class="verse-stanza"/g)).toHaveLength(3);
                expect(transformed).toContain("<blockquote>");
            });
            it(`locates body findings in authored ${name} columns`, () => {
                const source = contain([
                    "::: {.verse}",
                    "One/",
                    "Bad\tword",
                    "--- {.canto}",
                    "Two",
                    ":::",
                ]);
                const errors = scanVerse(source).errors;
                expect(errors).toEqual([
                    {
                        line: before.length + 3,
                        column: prefix.length + 4,
                        message: "tabs are not allowed in verse",
                    },
                    {
                        line: before.length + 4,
                        column: prefix.length + 1,
                        message: "a canto break needs a blank line before it",
                    },
                ]);
            });
            it(`maps multiline spans inside ${name}`, () => {
                const source = contain([
                    "::: {.verse}",
                    "[One",
                    "continued]{.direction}/..Two",
                    ":::",
                ]);
                const result = scanSpans(source);
                expect(result.errors).toEqual([]);
                const span = result.spans.find((span) =>
                    span.attrs.some(([key, value]) => key === "class" && value === "direction"),
                );
                expect(span.text.replace(/\r?\n/g, " ")).toBe("One continued");
                expect(span.start).toBe(source.indexOf("[One"));
                expect(span.end).toBe(source.indexOf("}/") + 1);
                expect(span.line).toBe(before.length + 2);
                expect(span.column).toBe(prefix.length + 1);
            });
        }
        it("retains opening list markers and continuation containers", () => {
            const source = ["- > ::: {.verse}", "  > One", "  >", "  > ..Two", "  > :::"].join(
                newline,
            );
            const block = scanVerse(source).blocks[0];
            expect(shape(block.model)).toEqual([
                [[{ text: "One", level: 0 }], [{ text: "Two", level: 2 }]],
            ]);
            const html = createRenderer("web").render(renderVerse(source).markdown);
            expect(html.match(/<li>/g)).toHaveLength(1);
            expect(html.match(/<blockquote>/g)).toHaveLength(1);
            expect(html.match(/class="verse-stanza"/g)).toHaveLength(2);
        });
        it("reports a quoted empty body at its opener", () => {
            expect(scanVerse(["> ::: {.verse}", ">", "> :::"].join(newline)).errors).toEqual([
                { line: 1, column: 3, message: "verse div is empty" },
            ]);
        });
        it("leaves quoted fenced examples literal", () => {
            const source = [
                "> ```markdown",
                "> ::: {.verse}",
                "> One",
                ">",
                "> Two",
                "> :::",
                "> ```",
            ].join(newline);
            expect(scanVerse(source).blocks).toEqual([]);
            expect(createRenderer("web").render(source)).not.toContain('class="verse-stanza"');
        });
    });
}
