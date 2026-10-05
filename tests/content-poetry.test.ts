/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { scanBlocks, renderBlocks } from "../engine/content-blocks.mjs";
import { scanFigures, renderFigureBlocks } from "../engine/content-figures.mjs";
import { renderFoundryMarkdown, md } from "../engine/helpers.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";

const poem = [
    ':::poetry {form=ballad meter="common meter" rhyme=ABCB syllables="8,6,8,6" lang=en}',
    "The lantern burns beside the gate,",
    "The harbor sleeps below.",
    "",
    "The keeper guards the road till dawn,",
    "And keeps a light aglow.",
    ":::",
].join("\n");

const figure = [":::figure {#mypoem}", poem, "///", "A harbor song.", ":::"].join("\n");

describe("poetry blocks", () => {
    it("preserves verse lines and stanza breaks in HTML and print", () => {
        expect(scanBlocks(poem).errors).toEqual([]);
        const html = renderFoundryMarkdown(poem);
        expect(html).toContain('class="poetry"');
        expect(html).toMatch(/gate,<br\s*\/?>(?:\n)?The harbor/);
        expect(html).toMatch(/<\/p>\s*<p>The keeper/);
        const typst = markdownToTypst(poem);
        expect(typst).toContain("gate, \\\nThe harbor");
        expect(typst).toContain("#block(width: 100%)");
    });

    it("numbers a figure beginning with poetry as Poem, on all surfaces", () => {
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
        const web = renderFigureBlocks(
            renderBlocks(figure, "web").markdown,
            md.render.bind(md),
            scanned.figures,
        );
        expect(md.render(web.markdown)).toContain("Poem 1: A harbor song.");
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

    it("keeps figure delimiters outside poetry and gives preceding prose its usual kind", () => {
        const withDelimiter = figure.replace("The harbor sleeps below.", "///");
        expect(scanFigures(withDelimiter).figures[0].caption).toBe("A harbor song.");
        const preceded = figure.replace(poem, `Before the song.\n\n${poem}`);
        expect(scanFigures(preceded).figures[0].kind).toBe("prose");
    });

    it("treats Markdown block markers at the start of a verse as text", () => {
        const source = [":::poetry", "# A summons", "- A road", "```", ":::"].join("\n");
        expect(scanBlocks(source).errors).toEqual([]);
        const html = renderFoundryMarkdown(source);
        expect(html).toContain("# A summons<br>");
        expect(html).toContain("- A road<br>");
        expect(html).toContain("```</p>");
    });

    it("reports invalid attributes and a syllable pattern of the wrong length", () => {
        expect(scanBlocks(poem.replace("8,6,8,6", "8,6")).errors[0].message).toContain(
            "2 counts for 4 verse lines",
        );
        expect(scanBlocks(poem.replace("form=ballad", "title=Song")).errors[0].message).toContain(
            "title= is not a poetry attribute",
        );
        expect(scanBlocks(poem.replace(" lang=en", " lines=4")).errors[0].message).toContain(
            "lines= is not a poetry attribute",
        );
        expect(scanBlocks(":::poetry\n\n:::").errors[0].message).toContain("poetry block is empty");
        expect(scanBlocks(":::poetry\nA line.").errors[0].message).toContain(
            "poetry block needs a closing :::",
        );
    });
});
