/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, it, expect } from "vitest";
import MarkdownIt from "markdown-it";
import { scanBlocks, renderBlocks } from "../engine/content-blocks.mjs";
import { scanPoetry, renderPoetry } from "../engine/content-poetry.mjs";
import { spanMarkdownPlugin, scanSpans, renderSpans } from "../engine/content-spans.mjs";
describe("markup primitives", () => {
    it("wraps attributed nested divs without a heading", () => {
        const source = '::: {#outer .wide title="Example"}\nText.\n::: {.inner}\nMore.\n:::\n:::';
        expect(scanBlocks(source).errors).toEqual([]);
        const result = renderBlocks(source, "web").markdown;
        expect(result).toContain('class="wide" id="outer" title="Example"');
        expect(result).toContain('<div class="inner">');
        expect(result).not.toContain("<summary");
    });
    it("reads poetry fences, preserving stanza and relative indent", () => {
        const source =
            '```poetry {meter="common meter"}\n    Base  line\n       Indented\n\n    Last\n```';
        expect(scanPoetry(source).errors).toEqual([]);
        const result = renderPoetry(source).markdown;
        expect(result).toContain('class="poetry-line i1"');
        expect(result).toContain("Base  line");
        expect(scanPoetry("~~~poetry\nA\tline\n~~~").errors[0]).toMatchObject({
            line: 2,
            column: 2,
        });
        expect(scanBlocks(":::poetry\nOld\n:::").errors[0].message).toContain("no poetry block");
    });
    it("does not read poetry inside literal examples", () => {
        expect(scanPoetry("````md\n```poetry\nVerse\n```\n````").blocks).toEqual([]);
    });
    it("preserves literal headings in a fenced poem inside a div", () => {
        expect(scanBlocks("::: {.verse}\n```poetry\n# Verse {#literal}\n```\n:::").errors).toEqual(
            [],
        );
    });
    it("collects nested spans and leaves wiki and footnote markers alone", () => {
        const source = "[outer [inner]{#nested}]{#outer} [[wiki]] [^note]\n\n[^note]: Note.";
        expect(scanSpans(source).spans.map((span) => span.id)).toEqual(["outer", "nested"]);
        expect(renderSpans(source).markdown).toContain(
            '<span id="outer">outer <span id="nested">inner</span></span>',
        );
    });
    it("excludes image, link, reference and wiki bracket syntax even unresolved", () => {
        const source =
            "![label] [label]() [label][missing] [[wiki]] [broken](unclosed [also]{#yes}";
        const scanned = scanSpans(source);
        expect(scanned.spans.map((span) => span.text)).toEqual(["also"]);
        expect(renderSpans("![label]{.art} [label][missing]{.link} [[wiki]]{.wiki}").markdown).toBe(
            "![label]{.art} [label][missing]{.link} [[wiki]]{.wiki}",
        );
    });
    it("finds and renders verse spans with original file locations", () => {
        const source =
            'Before.\n\n```poetry\n  A [bright]{#Light} lantern\n  [bad]{onclick="bad"}\n```\n\n```text\n[literal]{#No}\n```';
        const result = scanSpans(source);
        expect(result.spans.map((span) => [span.id, span.line, span.column])).toEqual([
            ["light", 4, 5],
            ["", 5, 3],
        ]);
        expect(result.errors[0]).toMatchObject({ line: 5, column: 3 });
        expect(renderSpans(source).markdown).toContain('A <span id="light">bright</span> lantern');
        expect(renderSpans(source).markdown).toContain("[literal]{#No}");
    });
    it("renders canonical anchor IDs for every primitive", () => {
        expect(renderBlocks("::: {#SomeId}\nText\n:::", "web").markdown).toContain('id="someid"');
        expect(renderPoetry("```poetry {#SomeId}\nText\n```").markdown).toContain('id="someid"');
        expect(renderSpans("[Text]{#SomeId}").markdown).toContain('id="someid"');
    });
    it("renders nested Markdown spans and preserves link precedence", () => {
        const md = new MarkdownIt().use(spanMarkdownPlugin);
        const html = md.render(
            "[Some *verse*]{#verse .special lang=en} [plain] [link](https://example.org) [ref][x] ![art](a.png) `[[literal]]`\n\n[x]: https://example.org",
        );
        expect(html).toContain(
            '<span id="verse" class="special" lang="en">Some <em>verse</em></span>',
        );
        expect(html).toContain("<span>plain</span>");
        expect(html).toContain('<a href="https://example.org">ref</a>');
        expect(html).toContain('<img src="a.png"');
        expect(scanSpans('[text]{onclick="bad"}').errors[0]).toMatchObject({ line: 1 });
    });
});
