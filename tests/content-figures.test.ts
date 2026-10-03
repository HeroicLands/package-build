// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { collectAnchors } from "../engine/anchors.mjs";
import { numberFigures, renderFigureBlocks, scanFigures } from "../engine/content-figures.mjs";
import { md, renderFoundryMarkdown } from "../engine/helpers.mjs";
import { checkImages, renderImageFigures } from "../engine/content-images.mjs";
import { embedProblems, embedsIn } from "../engine/content-embeds.mjs";
import { splitPages } from "../engine/journals.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";
import { resolveWebWikilinks } from "../engine/web-wikilinks.mjs";

/** A figure fence, with a caption when one is given. */
const fence = (attributes: string, contents: string, caption?: string) =>
    [
        attributes ? `:::figure ${attributes}` : ":::figure",
        contents,
        ...(caption === undefined ? [] : ["///", caption]),
        ":::",
        "",
    ].join("\n");

describe("the figure fence", () => {
    it("derives each kind from the fence's own contents and numbers it in sequence", () => {
        const source = [
            fence("{#passage}", "A paragraph.", "A passage"),
            fence("{#example}", "```js\nconst x = 1;\n```", "An example"),
            fence("{#trade}", "| A | B |\n| - | - |\n| 1 | 2 |", "Trade"),
            fence("{#portrait}", "![Face](face.webp)", "Portrait"),
            fence("{#second}", "| C | D |\n| - | - |\n| 3 | 4 |", "Another table"),
            fence("{#listing}", "```sql\nSELECT 1\n```", "A query"),
        ].join("\n");
        const { figures, errors } = scanFigures(source);
        expect(errors).toEqual([]);
        expect(figures.map(({ id, kind, label }) => [id, kind, label])).toEqual([
            ["passage", "prose", "Prose 1"],
            ["example", "code", "Code 1"],
            ["trade", "table", "Table 1"],
            ["portrait", "figure", "Figure 1"],
            ["second", "table", "Table 2"],
            ["listing", "table", "Table 3"],
        ]);
    });

    it("counts each kind independently within the note", () => {
        const source = [
            fence("{#p1}", "Prose.", "One"),
            fence("{#c1}", "```js\nconst a = 1;\n```", "Two"),
            fence("{#t1}", "| A |\n| - |\n| 1 |", "Three"),
            fence("{#f1}", "![One](one.webp)", "Four"),
            fence("{#p2}", "More prose.", "Five"),
            fence("{#c2}", "```js\nconst b = 2;\n```", "Six"),
            fence("{#t2}", "| B |\n| - |\n| 2 |", "Seven"),
            fence("{#f2}", "![Two](two.webp)", "Eight"),
        ].join("\n");
        expect(scanFigures(source).figures.map((figure) => figure.label)).toEqual([
            "Prose 1",
            "Code 1",
            "Table 1",
            "Figure 1",
            "Prose 2",
            "Code 2",
            "Table 2",
            "Figure 2",
        ]);
    });

    // The split is lexical because the markdown grammar claims the alternatives:
    // `---` or `===` on the line after a paragraph is a setext heading, so an
    // image tight against a delimiter becomes an `<h2>` the moment the body is
    // parsed before it is split. Reading the raw lines keeps the image an image.
    it("keeps an image tight against /// an image rather than a heading or a run of prose", () => {
        const source = fence("{#portrait}", "![A ranger](ranger.webp)", "The ranger.");
        const { figures, errors } = scanFigures(source);
        expect(errors).toEqual([]);
        expect(figures[0]).toMatchObject({
            kind: "figure",
            caption: "The ranger.",
            hasCaption: true,
        });
        const { markdown } = renderFigureBlocks(source);
        expect(markdown).toContain('<img src="ranger.webp"');
        expect(markdown).toContain('<p class="content-figure-label">Figure 1: The ranger.</p>');
        const html = md.render(markdown);
        expect(html).not.toMatch(/<h[1-6]\b/);
        // The caption is not swept into the image's own paragraph.
        expect(html).not.toMatch(/<img[^>]*>\s*The ranger\./);
    });

    it("keeps an embed tight against /// an embed, so an asset address survives the split", () => {
        const source = fence("{#beast}", "![[being-foobar|The Great Beast]]", "The great beast.");
        const { figures, errors } = scanFigures(source);
        expect(errors).toEqual([]);
        expect(figures[0]).toMatchObject({
            kind: "figure",
            caption: "The great beast.",
        });
    });

    // A fence's own delimiters bound the paragraph inside it, so a picture
    // written tight against one is a block — which is how the construct is
    // written, with no blank line between the opener, the picture and `///`.
    it("leaves a picture written tight inside a fence a block of its own", () => {
        const image = fence("{#portrait}", "![A ranger](ranger.webp)", "The ranger.");
        expect(checkImages(image, "Note.md")).toEqual([]);
        expect(renderImageFigures(image)).toContain("<figure class=");

        const embed = fence("{#beast}", "![[being-foobar|The Great Beast]]", "The great beast.");
        expect(embedsIn(embed).flatMap((one) => embedProblems(one))).toEqual([]);
    });

    it("reports no figure for a bare embed outside any fence", () => {
        const { figures, errors } = scanFigures("![[being-foobar|The Great Beast]]\n");
        expect(errors).toEqual([]);
        expect(figures).toEqual([]);
    });

    it("splits at neither /// written inside a nested code fence", () => {
        const source = [
            ":::figure {#listing}",
            "```js",
            "/// A doc comment.",
            "const x = 1;",
            "/// Another one.",
            "```",
            "///",
            "The listing.",
            ":::",
            "",
        ].join("\n");
        const { figures, errors } = scanFigures(source);
        expect(errors).toEqual([]);
        expect(figures).toHaveLength(1);
        expect(figures[0]).toMatchObject({ kind: "code", caption: "The listing." });
        const { markdown } = renderFigureBlocks(source);
        expect(markdown).toContain("/// A doc comment.");
        expect(markdown).toContain("/// Another one.");
        expect(markdown).toContain('<p class="content-figure-label">Code 1: The listing.</p>');
    });

    it("reads the closing ::: outside a nested fence that carries one", () => {
        const source = [
            ":::figure {#nested}",
            "```text",
            ":::",
            "```",
            "///",
            "A fenced example.",
            ":::",
            "",
        ].join("\n");
        const { figures, errors } = scanFigures(source);
        expect(errors).toEqual([]);
        expect(figures).toHaveLength(1);
        expect(figures[0]).toMatchObject({ kind: "code", caption: "A fenced example." });
    });

    it("numbers a fence with no ///, draws its label alone, and anchors it", () => {
        const source = fence("{#thorn}", "![A ranger](ranger.webp)");
        const { figures, errors } = scanFigures(source);
        expect(errors).toEqual([]);
        expect(figures[0]).toMatchObject({
            id: "thorn",
            hasCaption: false,
            caption: "",
            captionStart: -1,
            captionEnd: -1,
            number: 1,
            label: "Figure 1",
        });
        const { markdown } = renderFigureBlocks(source);
        expect(markdown).toContain('<p class="content-figure-label">Figure 1</p>');
        expect(markdown).not.toContain("Figure 1:");
        expect(markdown).toContain('id="thorn"');
        expect(collectAnchors(source).map((anchor) => anchor.slug)).toEqual(["thorn"]);
    });

    it("numbers a fence with no id and writes no id attribute or anchor", () => {
        const source = fence("", "![A ranger](ranger.webp)", "The ranger.");
        const { figures, errors } = scanFigures(source);
        expect(errors).toEqual([]);
        expect(figures[0]).toMatchObject({ id: "", slug: "", number: 1, label: "Figure 1" });
        const { markdown } = renderFigureBlocks(source);
        expect(markdown).not.toContain(" id=");
        expect(markdown).toContain('<div class="content-figure content-figure-figure">');
        expect(markdown).toContain('<p class="content-figure-label">Figure 1: The ranger.</p>');
        expect(collectAnchors(source)).toEqual([]);
    });

    it("numbers a grouped fence once and draws one label for it", () => {
        const source = fence(
            "{#plate}",
            "![One](one.webp)\n\n![Two](two.webp)",
            "Two portraits as one plate.",
        );
        const { figures, errors } = scanFigures(source);
        expect(errors).toEqual([]);
        expect(figures).toHaveLength(1);
        expect(figures[0]).toMatchObject({ kind: "figure", number: 1 });
        const { markdown } = renderFigureBlocks(source);
        expect(markdown.match(/content-figure-label/g)).toHaveLength(1);
        expect(markdown).toContain('<img src="one.webp"');
        expect(markdown).toContain('<img src="two.webp"');
        expect(markdown.match(/<figcaption\b/g)).toBeNull();
    });

    it("emits an authored class beside the construct's own", () => {
        const source = fence("{#thorn .border}", "A boxed aside.", "An aside.");
        const { figures, errors } = scanFigures(source);
        expect(errors).toEqual([]);
        expect(figures[0]).toMatchObject({ classes: ["border"], kind: "prose" });
        const { markdown } = renderFigureBlocks(source);
        expect(markdown).toContain(
            '<div id="thorn" class="content-figure content-figure-prose border">',
        );
    });

    it("keeps a figure's table as Markdown for the page's own render", () => {
        const source = fence("{#trade}", "| A | B |\n| - | - |\n| 1 | 2 |", "**Regional** trade");
        const { markdown, errors } = renderFigureBlocks(source);
        expect(errors).toEqual([]);
        expect(markdown).toContain('id="trade"');
        expect(markdown).toContain("Table 1: <strong>Regional</strong> trade");
        expect(markdown).not.toContain(":::figure");
        expect(markdown).not.toContain("///");
        expect(markdown).toContain("| A | B |");
        expect(md.render(markdown)).toContain("<table>");
    });

    it("uses one visible caption for an image while preserving its alt text", () => {
        const source = fence("{#portrait}", "![A ranger](ranger.webp)", "The ranger");
        const imageHtml = renderImageFigures(source);
        const result = renderFigureBlocks(imageHtml);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toContain("Figure 1: The ranger");
        expect(result.markdown.match(/<figcaption\b/g)).toBeNull();
        expect(result.markdown).toContain('alt="A ranger"');
    });

    it("still draws a captioned figure's label, number and anchor on every surface", () => {
        const source = fence("{#portrait}", "![A ranger](ranger.webp)", "The ranger");

        const site = renderFigureBlocks(renderImageFigures(source));
        expect(site.errors).toEqual([]);
        expect(site.markdown).toContain('id="portrait"');
        expect(site.markdown).toContain("Figure 1: The ranger");

        expect(renderFoundryMarkdown(source)).toContain("Figure 1: The ranger");

        const images = new Map([["ranger.webp", "assets/ranger.webp"]]);
        const typst = markdownToTypst(source, { anchorPrefix: "chapter", images });
        expect(typst).toContain("Figure 1: The ranger");
        expect(typst).toContain("<chapter--portrait>");
    });

    it("draws no visible line for an uncaptioned figure's image, with or without alt text", () => {
        const withAlt = renderFigureBlocks(
            renderImageFigures(fence("{#a}", "![A ranger](ranger.webp)")),
        );
        const withoutAlt = renderFigureBlocks(
            renderImageFigures(fence("{#b}", "![](ranger.webp)")),
        );
        expect(withAlt.markdown.match(/<figcaption\b/g)).toBeNull();
        expect(withoutAlt.markdown.match(/<figcaption\b/g)).toBeNull();
        expect(withAlt.markdown).toContain("Figure 1");
        expect(withAlt.markdown).not.toContain("Figure 1:");
        expect(withoutAlt.markdown).toContain("Figure 1");
        expect(withoutAlt.markdown).not.toContain("Figure 1:");
    });

    it("makes a figure an addressable Foundry page", () => {
        const source =
            "# Introduction\nBefore.\n\n" +
            fence("{#trade}", "| A | B |\n| - | - |\n| 1 | 2 |", "Trade");
        const pages = splitPages(source);
        expect(pages[1].anchorSlug).toBe("trade");
        expect(pages[1].name).toBe("Table 1");
        expect(renderFoundryMarkdown(pages[1].markdown)).toContain("Table 1: Trade");
        expect(collectAnchors(source).map((anchor) => anchor.slug)).toContain("trade");
    });

    it("preserves wide-table reading order without a figure, and keeps one in its float", () => {
        const table = "| A | B | C | D |\n| - | - | - | - |\n| 1 | 2 | 3 | 4 |";
        expect(markdownToTypst(table)).toContain("#pagebreak(weak: true)");
        const output = markdownToTypst(fence("{#trade}", table, "Trade"), {
            anchorPrefix: "chapter",
        });
        expect(output).not.toContain("#pagebreak(weak: true)");
        expect(output).toContain("#book-wide[\n#text(");
        expect(output).toContain("Table 1: Trade");
        expect(output).toContain("<chapter--trade>");
        expect(output).not.toContain(":::figure");
        expect(output).not.toContain("///");
    });

    it("accepts book-wide numbering assigned before rendering each note", () => {
        const source = fence("{#portrait}", "![A ranger](ranger.webp)", "The ranger");
        const figures = numberFigures(scanFigures(source).figures, {
            code: 0,
            table: 0,
            figure: 11,
            prose: 0,
        });
        expect(figures[0].label).toBe("Figure 12");
        expect(markdownToTypst(source, { captions: figures })).toContain("Figure 12: The ranger");
    });

    it("uses the generated label for an empty-label same-page wikilink", () => {
        const body =
            "Refer to [[#trade|]].\n\n" +
            fence("{#trade}", "| A | B |\n| - | - |\n| 1 | 2 |", "Trade");
        const figures = scanFigures(body).figures;
        const ctx = {
            index: new Map(),
            contentPackage: "sohl",
            contentTypes: new Set(["doc"]),
            type: "doc",
            captionLabels: new Map(figures.map((figure) => [figure.id, figure.label])),
        };
        expect(resolveWebWikilinks(body, ctx)).toContain("Refer to [Table 1](#trade).");
    });

    it("parses a figure written inside a named block", () => {
        const source = [
            ":::secret",
            "Before.",
            "",
            fence("{#trade}", "| A | B |\n| - | - |\n| 1 | 2 |", "Trade").trimEnd(),
            "",
            "After.",
            ":::",
            "",
        ].join("\n");
        const { figures, errors } = scanFigures(source);
        expect(errors).toEqual([]);
        expect(figures.map((figure) => figure.label)).toEqual(["Table 1"]);
    });
});

describe("what a figure fence refuses", () => {
    it("reports a second top-level /// at its own line", () => {
        const source = [
            ":::figure {#thorn}",
            "![A ranger](ranger.webp)",
            "///",
            "The ranger.",
            "///",
            "A second caption.",
            ":::",
            "",
        ].join("\n");
        const errors = scanFigures(source).errors;
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ line: 5, column: 1 });
        expect(errors[0].message).toContain("one caption");
    });

    it("names a class the construct does not declare", () => {
        const errors = scanFigures(fence("{#thorn .wide}", "Prose.", "A caption.")).errors;
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ line: 1, column: 1 });
        expect(errors[0].message).toContain(".wide");
        expect(errors[0].message).toContain(".border");
    });

    it("names a key=value attribute", () => {
        const errors = scanFigures(fence('{#thorn type="figure"}', "Prose.", "A caption.")).errors;
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ line: 1, column: 1 });
        expect(errors[0].message).toContain("type");
    });

    it("names an id written twice in one note", () => {
        const source =
            fence("{#same}", "First.", "One") + "\n" + fence("{#same}", "Second.", "Two");
        const errors = scanFigures(source).errors;
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ line: 7, column: 1 });
        expect(errors[0].message).toContain('duplicate figure id "same"');
    });

    it("reports a fence with no closing ::: at its opening line", () => {
        const errors = scanFigures(":::figure {#open}\n![A ranger](ranger.webp)\n").errors;
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ line: 1, column: 1 });
        expect(errors[0].message).toContain("closing");
    });

    it("reports a page-starting heading inside a fence at the heading's line", () => {
        const h1 = scanFigures(fence("{#thorn}", "# A heading", "A caption.")).errors;
        expect(h1).toHaveLength(1);
        expect(h1[0]).toMatchObject({ line: 2, column: 1 });
        expect(h1[0].message).toContain("starts a page");

        const anchored = scanFigures(fence("{#thorn}", "## A heading {#y}", "A caption.")).errors;
        expect(anchored).toHaveLength(1);
        expect(anchored[0]).toMatchObject({ line: 2 });
    });

    it("reports an anchor a heading and a figure both declare", () => {
        const source = "## Trade {#trade .wide}\n\n" + fence("{#trade}", "Prose.", "Routes");
        const errors = scanFigures(source).errors;
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ line: 1 });
        expect(errors[0].message).toContain('heading and figure declare the same anchor "trade"');
    });

    it("reports a fence with no contents", () => {
        const errors = scanFigures(":::figure {#thorn}\n///\nA caption.\n:::\n").errors;
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ line: 1, column: 1 });
        expect(errors[0].message).toContain("no contents");
    });

    it("reports a /// section that is present and blank", () => {
        const errors = scanFigures(
            ":::figure {#thorn}\n![A ranger](ranger.webp)\n///\n\n:::\n",
        ).errors;
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ line: 3, column: 1 });
        expect(errors[0].message).toContain("write no ///");
    });

    it("reports an attribute block that is not braced", () => {
        const errors = scanFigures(":::figure #thorn\nProse.\n:::\n").errors;
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ line: 1, column: 1 });
        expect(errors[0].message).toContain("{#id");
    });

    it("leaves the markdown untouched when a fence is faulty", () => {
        const source = fence("{#thorn .wide}", "Prose.", "A caption.");
        const { markdown, errors } = renderFigureBlocks(source);
        expect(errors).toHaveLength(1);
        expect(markdown).toBe(source);
    });
});
