import { describe, it, expect } from "vitest";
import MarkdownIt from "markdown-it";
import { scanFigures, renderFigureBlocks, numberFigures } from "../engine/content-figures.mjs";
const caption = (body: string, attrs = "", numbered = true) =>
    `:${numbered ? "@" : ""} A caption${attrs ? ` ${attrs}` : ""}\n\n${body}`;
describe("leading captions", () => {
    it.each([
        ["![A](a.webp)", "figure", "Figure 1"],
        ["![[place-a]]", "figure", "Figure 1"],
        ["| A | B |\n| --- | --- |\n| a | b |", "table", "Table 1"],
        ["```sql\nSELECT 1;\n```", "table", "Table 1"],
        ["```poetry\nA verse\n```", "poem", "Poem 1"],
        ["```js\nlet a=1;\n```", "code", "Code 1"],
        ["A paragraph.", "prose", "Prose 1"],
        ["> A quote.", "prose", "Prose 1"],
        ["::: {#box}\nA paragraph.\n:::", "prose", "Prose 1"],
    ])("infers %s", (body, kind, label) => {
        const result = scanFigures(caption(body));
        expect(result.errors).toEqual([]);
        expect(result.figures[0]).toMatchObject({ kind, label, numbered: true });
    });
    it("does not number or consume counters for unnumbered captions", () => {
        const source = caption("First.", "", false) + "\n\n" + caption("Second.");
        const figures = scanFigures(source).figures;
        expect(figures.map((f) => f.label)).toEqual(["", "Prose 1"]);
        expect(numberFigures(figures, { prose: 8 }).map((f) => f.label)).toEqual(["", "Prose 9"]);
        expect(renderFigureBlocks(source).markdown).toContain(
            '<p class="content-figure-label">A caption</p>',
        );
    });
    it("explicit type overrides inference and arbitrary safe attributes are rendered", () => {
        const source = caption("A paragraph.", '{#a .wide type=poetry lang=en title="A & B"}');
        const result = renderFigureBlocks(source);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toContain('id="a"');
        expect(result.markdown).toContain("content-figure-poem wide");
        expect(result.markdown).toContain('lang="en" title="A &amp; B"');
        expect(result.markdown).toContain("Poem 1: A caption");
    });
    it.each(["# Heading", "- Item", "---", "", ":@ Second\n\nBody."])(
        "rejects unsupported or absent next item %s",
        (body) => {
            expect(scanFigures(caption(body)).errors.length).toBeGreaterThan(0);
            expect(scanFigures(caption(body, "{type=figure}")).errors.length).toBeGreaterThan(0);
        },
    );
    it.each(["{type=map}", "{onclick=alert}", "{#a #b}", '{title="broken}'])(
        "rejects invalid attributes %s",
        (attrs) => {
            expect(scanFigures(caption("Body.", attrs)).errors.length).toBeGreaterThan(0);
        },
    );
    it("requires blank lines and rejects retired syntax outside literal fences", () => {
        expect(scanFigures("Before\n:@ Caption\n\nBody.").errors).toHaveLength(1);
        expect(scanFigures(":@ Caption\nBody.").errors).toHaveLength(1);
        expect(scanFigures(":::figure\nBody.\n:::").errors[0].message).toContain(
            "no longer supported",
        );
        expect(scanFigures("````md\n:::figure\n:@ Caption\n\nBody\n````").errors).toEqual([]);
    });
    it("consumes only the following block", () => {
        const source = caption("Body.\n\n# Next\n\nTail.");
        const figure = scanFigures(source).figures[0];
        expect(figure.bodyStart).toBe(2);
        expect(figure.bodyEnd).toBe(3);
        expect(renderFigureBlocks(source).markdown).toContain("</div>\n\n# Next");
    });
    it("keeps nested code and named blocks inside captioned divs", () => {
        const source = caption("::: {#outer}\n:::secret\nSecret\n:::\n```md\n:::\n```\n:::");
        expect(scanFigures(source).errors).toEqual([]);
        expect(scanFigures(source).figures[0].bodyEnd).toBe(source.split("\n").length);
    });
    it("preserves body markdown for document-level rendering", () => {
        const rendered = new MarkdownIt().render(renderFigureBlocks(caption("**Body**.")).markdown);
        expect(rendered).toContain("<strong>Body</strong>");
    });
});
