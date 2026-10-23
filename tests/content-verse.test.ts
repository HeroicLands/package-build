/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { scanBlocks, renderBlocks } from "../engine/content-blocks.mjs";
import { scanFigures, renderFigureBlocks } from "../engine/content-figures.mjs";
import { renderFoundryMarkdown, md } from "../engine/helpers.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";

const poem = [
    "```verse {form=ballad lang=en}",
    "The lantern burns beside the gate,",
    "The harbor sleeps below.",
    "",
    "The keeper guards the road till dawn,",
    "And keeps a light aglow.",
    "```",
].join("\n");

const figure = [":@ A harbor song. {#mypoem}", "", poem].join("\n");

describe("verse blocks", () => {
    it("preserves verse lines and stanza breaks in HTML and print", () => {
        expect(scanBlocks(poem).errors).toEqual([]);
        const html = renderFoundryMarkdown(poem);
        expect(html).toContain('class="verse"');
        expect(html).toMatch(/gate,<\/span><br\s*\/?>(?:\n)?<span class="verse-line">The harbor/);
        expect(html).toMatch(/<\/p>\s*<p><span class="verse-line">The keeper/);
        const typst = markdownToTypst(poem);
        expect(typst).toContain("gate, \\\nThe harbor");
        expect(typst).toContain("#block(width: 100%)");
    });

    it("numbers a figure beginning with verse as Poem, on all surfaces", () => {
        expect(scanBlocks(figure).errors).toEqual([]);
        const scanned = scanFigures(figure);
        expect(scanned.errors).toEqual([]);
        expect(scanned.figures[0]).toMatchObject({
            kind: "poem",
            label: "Poem 1",
            caption: "A harbor song.",
        });
        const foundry = renderFoundryMarkdown(figure, scanned.figures);
        expect(foundry).toContain("Poem 1: A harbor song.");
        const web = renderFigureBlocks(figure, md.render.bind(md), scanned.figures);
        expect(md.render(renderBlocks(web.markdown, "web").markdown)).toContain(
            "Poem 1: A harbor song.",
        );
        expect(markdownToTypst(figure)).toContain("Poem 1: A harbor song.");
    });

    it("keeps inline markup and note-level footnotes in a captioned poem", () => {
        const source =
            figure.replace("The harbor sleeps below.", "The *harbor* sleeps below.[^shore]") +
            "\n\n[^shore]: By the shore.";
        const foundry = renderFoundryMarkdown(source, scanFigures(source).figures);
        expect(foundry).toContain("<em>harbor</em>");
        expect(foundry).toContain("footnote-ref");
        const typst = markdownToTypst(source);
        expect(typst).toContain("#emph[harbor]");
        expect(typst).toContain("#footnote[");
    });

    it("keeps delimiter-like verse inside verse and gives preceding prose its usual kind", () => {
        const withDelimiter = figure.replace("The harbor sleeps below.", "///");
        expect(scanFigures(withDelimiter).figures[0].caption).toBe("A harbor song.");
        const preceded = figure.replace(poem, `Before the song.\n\n${poem}`);
        expect(scanFigures(preceded).figures[0].kind).toBe("prose");
    });

    it("treats Markdown block markers at the start of a verse as text", () => {
        const source = ["~~~~verse", "# A summons", "- A road", "```", "~~~~"].join("\n");
        expect(scanBlocks(source).errors).toEqual([]);
        const html = renderFoundryMarkdown(source);
        expect(html).toContain("# A summons</span><br>");
        expect(html).toContain("- A road</span><br>");
        expect(html).toContain("```</span></p>");
    });

    it("refuses the descriptive keys as unknown verse attributes", () => {
        for (const [key, value] of [
            ["meter", '"common meter"'],
            ["rhyme", "ABCB"],
            ["syllables", '"8,6,8,6"'],
        ])
            expect(
                scanBlocks(poem.replace("form=ballad", `${key}=${value}`)).errors.map(
                    (error: { message: string }) => error.message,
                ),
            ).toEqual([`${key}= is not a verse attribute`]);
    });

    it("reports invalid attributes", () => {
        expect(scanBlocks(poem.replace("form=ballad", "title=Song")).errors[0].message).toContain(
            "title= is not a verse attribute",
        );
        expect(scanBlocks(poem.replace(" lang=en", " lines=4")).errors[0].message).toContain(
            "lines= is not a verse attribute",
        );
        expect(scanBlocks("```verse\n\n```").errors[0].message).toContain("verse block is empty");
        expect(scanBlocks("```verse\nA line.").errors[0].message).toContain(
            "verse block needs a closing code fence",
        );
    });

    it("counts periods independently of leading spaces", () => {
        const source = [
            "```verse",
            "    Base  line",
            "     Plain line",
            "      .One level",
            "       ..Two levels",
            "***",
            "    Next stanza",
            "```",
        ].join("\n");
        expect(scanBlocks(source).errors).toEqual([]);
        const html = renderFoundryMarkdown(source);
        expect(html).toContain('<span class="verse-line">Base  line</span>');
        expect(html).toContain('<span class="verse-line">Plain line</span>');
        expect(html).toContain('<span class="verse-line i1">One level</span>');
        expect(html).toContain('<span class="verse-line i2">Two levels</span>');
        expect(html).toContain('class="verse-stanza-break"');
        const typst = markdownToTypst(source);
        expect(typst).toContain("#h(1.25em)One level");
        expect(typst).toContain("#h(2.5em)Two levels");
        expect(typst).not.toContain("***");
    });

    it("keeps deep indentation and accepts an indented fence", () => {
        const source = ["  ```verse", "    Base", "    .........Far line", "  ```"].join("\n");
        expect(scanBlocks(source).errors).toEqual([]);
        expect(renderFoundryMarkdown(source)).toContain(
            'class="verse-line i9" style="--verse-indent: 11.25em"',
        );
        expect(markdownToTypst(source)).toContain("#h(11.25em)Far line");
    });

    it("keeps an indented poem inside its list item", () => {
        const source = [
            "- Song:",
            "",
            "  ```verse",
            "    First",
            "      .Second",
            "  ```",
            "",
            "- Next",
        ].join("\n");
        const html = renderFoundryMarkdown(source);
        expect(html).toMatch(/<li>\s*<p>Song:<\/p>\s*<div class="verse">/);
        expect(html).toMatch(/<\/div>\s*<\/li>\s*<li>/);
        expect(html).toContain('class="verse-line i1"');
    });

    it("renders a standalone fence indented four spaces as verse", () => {
        const source = ["    ```verse", "      First", "        .Second", "    ```"].join("\n");
        const html = renderFoundryMarkdown(source);
        expect(html).toContain('<div class="verse">');
        expect(html).toContain('class="verse-line i1"');
    });

    it("labels a figure with an indented verse fence as a poem", () => {
        const source = [":@ A song.", "", "  ```verse", "    One line", "  ```"].join("\n");
        expect(scanFigures(source).figures[0].label).toBe("Poem 1");
    });

    it("reports tabs anywhere in a verse body with their source location", () => {
        const source = "```verse\n  A\tline\n\tSecond line\n```";
        expect(scanBlocks(source).errors).toEqual([
            { line: 2, column: 4, message: "tabs are not allowed in verse" },
            { line: 3, column: 1, message: "tabs are not allowed in verse" },
        ]);
    });
});

describe("a fence in any other language", () => {
    it("is a code block, whatever the language is called", () => {
        const source = "```poetry\nThe lantern burns beside the gate,\n```";
        expect(scanBlocks(source).errors).toEqual([]);
        const html = renderFoundryMarkdown(source);
        expect(html).toContain('<pre><code class="language-poetry">');
        expect(html).not.toContain('class="verse"');
        expect(markdownToTypst(source)).not.toContain("#block(width: 100%)[The lantern");
    });
});
