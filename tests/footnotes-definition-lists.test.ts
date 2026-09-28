// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";
import { splitPages, buildPages } from "../engine/journals.mjs";
import { markdownToTypst, renderBook } from "../engine/pdf-render.mjs";
import { separateFootnotes } from "../engine/content-footnotes.mjs";

const note = [
    "# First",
    "Here is a short note.[^1] And a long one.[^bignote]",
    "",
    "# Second",
    "Another reference.[^1]",
    "",
    "[^1]: The first footnote.",
    "",
    "[^bignote]: A longer footnote.",
    "",
    "    Another paragraph with `code`.",
].join("\n");

describe("footnotes", () => {
    it("keeps definitions available across Foundry pages", () => {
        const pages = buildPages(splitPages(note), "AAAAAAAAAAAAAAAA", "Sample");
        expect(pages.map((page) => page.name)).toEqual(["First", "Second"]);
        for (const page of pages) {
            expect(page.text.content).toContain('<section class="footnotes">');
            expect(page.text.content).toContain("<h2>Footnotes</h2>");
            expect(page.text.content).toContain("The first footnote.");
        }
        expect(pages[0].text.content).toContain("Another paragraph with");
        expect(pages[1].text.content).not.toContain("A longer footnote.");
    });

    it("renders numbered links at the bottom of one HTML page", () => {
        const html = renderFoundryMarkdown("A[^one].\n\n[^one]: A note.");
        expect(html).toContain('class="footnote-ref"');
        expect(html.indexOf('class="footnotes"')).toBeGreaterThan(html.indexOf("A<sup"));
        expect(html).toContain(">[1]</a>");
    });

    it("numbers by first reference across pages and scopes identifiers to each note", () => {
        const source = [
            "# First",
            "One[^word].",
            "# Second",
            "Two[^2] and one[^word].",
            "[^word]: Word note.",
            "[^2]: Number note.",
        ].join("\n");
        const pages = buildPages(splitPages(source), "AAAAAAAAAAAAAAAA", "One note");
        expect(pages[0].text.content).toContain(">[1]</a>");
        expect(pages[1].text.content).toContain(">[2]</a>");
        expect(pages[1].text.content).toContain(">[1]</a>");
        expect(pages[1].text.content).toContain('value="2"');
        const another = buildPages(
            splitPages("# Elsewhere\nA[^word].\n\n[^word]: Another note."),
            "BBBBBBBBBBBBBBBB",
            "Another note",
        );
        expect(another[0].text.content).toContain(">[1]</a>");
        expect(another[0].text.content).toContain("Another note.");
        expect(another[0].text.content).not.toContain("Word note.");
    });

    it("prints footnotes at their references with smaller book entries", () => {
        const typst = markdownToTypst(note, { anchorPrefix: "sample" });
        expect(typst).toContain("#footnote[The first footnote.]");
        expect(typst).toContain("#footnote[A longer footnote.");
        expect(typst).not.toContain("[^1]:");
        expect(renderBook({ plan: { entries: [] }, title: "Sample" })).toContain(
            "#show footnote.entry: set text(size: 7.8pt)",
        );
    });

    it("keeps footnote examples in code fences literal", () => {
        const source = "```markdown\n[^x]: Example\n```\n\nBody[^x].";
        expect(separateFootnotes(source).definitions).toBe("");
        expect(separateFootnotes(source).markdown).toBe(source);
    });
});

describe("definition lists", () => {
    const source = "First Term\n: First definition.\n\nSecond Term\n: One.\n: Two.";

    it("renders terms and multiple definitions in Foundry HTML", () => {
        const html = renderFoundryMarkdown(source);
        expect(html).toContain("<dl>");
        expect(html).toContain("<dt>Second Term</dt>");
        expect(html.match(/<dd>/g)).toHaveLength(3);
    });

    it("renders one book term with both definitions", () => {
        const typst = markdownToTypst(source);
        expect(typst).toContain("#terms(");
        expect(typst).toContain("terms.item([Second Term],[One.\n\nTwo.])");
    });
});
