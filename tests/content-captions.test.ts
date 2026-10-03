// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { collectAnchors } from "../engine/anchors.mjs";
import { numberCaptions, renderCaptionBlocks, scanCaptions } from "../engine/content-captions.mjs";
import { md, renderFoundryMarkdown } from "../engine/helpers.mjs";
import { renderImageFigures } from "../engine/content-images.mjs";
import { splitPages } from "../engine/journals.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";
import { resolveWebWikilinks } from "../engine/web-wikilinks.mjs";

const directive = (id: string, text: string, block: string) =>
    `:::caption {#${id}}\n${text}\n:::\n\n${block}\n`;

describe("caption directives", () => {
    it("classifies the following rendered block and numbers each category", () => {
        const source = [
            directive("passage", "A passage", "A paragraph."),
            directive("example", "An example", "```js\nconst x = 1;\n```"),
            directive("trade", "Trade", "| A | B |\n| - | - |\n| 1 | 2 |"),
            directive("portrait", "Portrait", "![Face](face.webp)"),
            directive("second", "Another table", "| C | D |\n| - | - |\n| 3 | 4 |"),
        ].join("\n");
        const { captions, errors } = scanCaptions(source);
        expect(errors).toEqual([]);
        expect(captions.map(({ id, label }) => [id, label])).toEqual([
            ["passage", "Prose 1"],
            ["example", "Code 1"],
            ["trade", "Table 1"],
            ["portrait", "Figure 1"],
            ["second", "Table 2"],
        ]);
    });

    it("keeps a caption with its table on the web and exposes the anchor", () => {
        const source = directive("trade", "**Regional** trade", "| A | B |\n| - | - |\n| 1 | 2 |");
        const { markdown, errors } = renderCaptionBlocks(source);
        expect(errors).toEqual([]);
        expect(markdown).toContain('id="trade"');
        expect(markdown).toContain("Table 1: <strong>Regional</strong> trade");
        expect(markdown).not.toContain(":::caption");
        // The table itself is left as Markdown, blank-line wrapped, for the
        // page's own render to turn into `<table>` — see the module docs.
        expect(markdown).toContain("| A | B |");
        expect(md.render(markdown)).toContain("<table>");
    });

    it("uses one visible caption for an image while preserving its alt text", () => {
        const source = directive("portrait", "The ranger", "![A ranger](ranger.webp)");
        const imageHtml = renderImageFigures(source);
        const result = renderCaptionBlocks(imageHtml);
        expect(result.markdown).toContain("Figure 1: The ranger");
        expect(result.markdown.match(/<figcaption\b/g)).toBeNull();
        expect(result.markdown).toContain('alt="A ranger"');
    });

    it("makes the caption an addressable Foundry page", () => {
        const source =
            "# Introduction\nBefore.\n\n" +
            directive("trade", "Trade", "| A | B |\n| - | - |\n| 1 | 2 |");
        const pages = splitPages(source);
        expect(pages[1].anchorSlug).toBe("trade");
        expect(pages[1].name).toBe("Table 1");
        expect(renderFoundryMarkdown(pages[1].markdown)).toContain("Table 1: Trade");
        expect(collectAnchors(source).map((anchor) => anchor.slug)).toContain("trade");
    });

    it("preserves wide-table reading order without a caption, and keeps a caption in its float", () => {
        const table = "| A | B | C | D |\n| - | - | - | - |\n| 1 | 2 | 3 | 4 |";
        expect(markdownToTypst(table)).toContain("#pagebreak(weak: true)");
        const output = markdownToTypst(directive("trade", "Trade", table), {
            anchorPrefix: "chapter",
        });
        expect(output).not.toContain("#pagebreak(weak: true)");
        expect(output).toContain("#book-wide[\n#text(");
        expect(output).toContain("Table 1: Trade");
        expect(output).toContain("<chapter--trade>");
        expect(
            markdownToTypst("Refer to [Table 1](#trade).", { anchorPrefix: "chapter" }),
        ).toContain("#link(<chapter--trade>)[Table 1]");
    });

    it("accepts book-wide numbering assigned before rendering each note", () => {
        const source = directive("portrait", "The ranger", "![A ranger](ranger.webp)");
        const captions = numberCaptions(scanCaptions(source).captions, {
            code: 0,
            table: 0,
            figure: 11,
            prose: 0,
        });
        expect(markdownToTypst(source, { captions })).toContain("Figure 12: The ranger");
    });

    it("uses the generated label for an empty-label same-page wikilink", () => {
        const body =
            "Refer to [[#trade|]].\n\n" +
            directive("trade", "Trade", "| A | B |\n| - | - |\n| 1 | 2 |");
        const captions = scanCaptions(body).captions;
        const ctx = {
            index: new Map(),
            contentPackage: "sohl",
            contentTypes: new Set(["doc"]),
            type: "doc",
            captionLabels: new Map(captions.map((caption) => [caption.id, caption.label])),
        };
        expect(resolveWebWikilinks(body, ctx)).toContain("Refer to [Table 1](#trade).");
    });

    it("reports missing targets, duplicate ids, and unclosed directives", () => {
        expect(scanCaptions(":::caption {#empty}\nCaption\n:::").errors[0].message).toContain(
            "following block",
        );
        expect(
            scanCaptions(directive("same", "One", "First.") + directive("same", "Two", "Second."))
                .errors[0].message,
        ).toContain("duplicate");
        expect(scanCaptions(":::caption {#open}\nCaption").errors[0].message).toContain("closing");
        expect(
            scanCaptions("# Heading {#same}\n\n" + directive("same", "Caption", "Text.")).errors[0]
                .message,
        ).toContain("same anchor");
    });
});
