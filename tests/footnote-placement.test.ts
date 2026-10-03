/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * A footnote's two halves have different placement rules, and every surface
 * must agree on both.
 *
 * A reference may be written anywhere prose can be written — the eight
 * contexts below are the guard against a check that over-corrects and refuses
 * markup authors actually want. A definition belongs at the top level of the
 * note; written elsewhere, or missing, it is a finding rather than three
 * different wrong renders.
 */

import { describe, it, expect } from "vitest";

import { renderFoundryMarkdown } from "../engine/helpers.mjs";
import { renderBlocks } from "../engine/content-blocks.mjs";
import { renderCaptionBlocks } from "../engine/content-captions.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";
import {
    footnoteFindings,
    misplacedFootnoteDefinitions,
    unresolvedFootnoteReferences,
} from "../engine/content-footnotes.mjs";

/** The body as the Foundry pack compiler renders it. */
function foundry(source: string) {
    return renderFoundryMarkdown(source);
}

/** The body as the site build renders it, in the order `site-build` runs. */
function web(source: string) {
    const blocks = renderBlocks(source, "web");
    return renderCaptionBlocks(blocks.markdown).markdown;
}

/** The body as the book renders it, with findings collected rather than thrown. */
function book(source: string) {
    const findings: object[] = [];
    const typst = markdownToTypst(source, { findings });
    return { typst, findings };
}

describe("a footnote reference may be written anywhere prose can be written", () => {
    const CONTEXTS: Record<string, string> = {
        "a paragraph": "A plain paragraph.[^a]",
        "a list item": "- An item.[^a]",
        "a nested list item": "- Outer\n  - An inner item.[^a]",
        "a block quote": "> A quoted line.[^a]",
        "a table cell": "| A | B |\n| - | - |\n| x[^a] | y |",
        "a table header": "| X[^a] | B |\n| - | - |\n| x | y |",
        "a heading": "## A heading[^a]",
        "a definition-list term": "Term[^a]\n: A definition.",
    };

    for (const [name, prose] of Object.entries(CONTEXTS)) {
        it(`${name}, with its definition at the top level`, () => {
            const source = `${prose}\n\n[^a]: A note.`;
            expect(footnoteFindings(source)).toEqual([]);
            expect(() => foundry(source)).not.toThrow();
            expect(() => web(source)).not.toThrow();
            const { findings } = book(source);
            expect(findings).toEqual([]);

            expect(foundry(source)).toContain("footnote-ref");
            expect(web(source)).toMatch(/\[\^a\]/);
        });
    }
});

describe("a footnote reference inside a named block or a caption", () => {
    const CASES: Record<string, string> = {
        info: ":::info\nA fact.[^x]\n:::",
        warn: ":::warn\nA caution.[^x]\n:::",
        secret: ":::secret\nA clue.[^x]\n:::",
        "caption prose": ":::caption {#note}\nA note\n:::\n\nSome prose.[^x]",
    };

    for (const [name, body] of Object.entries(CASES)) {
        it(`resolves in ${name}, numbered with the rest of the note`, () => {
            const source = `Before.[^before]\n\n${body}\n\n[^before]: First.\n\n[^x]: The note.`;
            expect(footnoteFindings(source)).toEqual([]);

            const foundryHtml = foundry(source);
            expect(foundryHtml).toContain("The note.");
            expect(foundryHtml).not.toMatch(/\[\^x\]/);
            // One combined Footnotes section, not one per box.
            expect(foundryHtml.match(/class="footnotes"/g)).toHaveLength(1);
            // Numbered after the note's first reference, not restarted inside
            // the block.
            expect(foundryHtml.indexOf(">[1]</a>")).toBeLessThan(foundryHtml.indexOf(">[2]</a>"));

            const webMarkdown = web(source);
            // Left as Markdown for the page's own render — see
            // `engine/content-blocks.mjs` — so the reference survives as
            // real syntax rather than literal text.
            expect(webMarkdown).toContain("[^x]");

            const { findings } = book(source);
            expect(findings).toEqual([]);
        });
    }
});

describe("a footnote definition below the top level is a finding", () => {
    const CASES: Record<string, string> = {
        "a list": "Body.[^a]\n\n- item\n- [^a]: A note.",
        "a block quote": "Body.[^a]\n\n> [^a]: A note.",
    };

    for (const [name, source] of Object.entries(CASES)) {
        it(`${name}, naming the definition's own line`, () => {
            const errors = misplacedFootnoteDefinitions(source);
            expect(errors).toHaveLength(1);
            expect(errors[0].message).toContain("top level");

            const { findings } = book(source);
            expect(findings).toHaveLength(1);
            expect(findings[0]).toMatchObject({ severity: "error" });
            expect(findings[0].message).toContain("top level");
        });
    }

    it("produces no finding when the definition is at the top level", () => {
        expect(misplacedFootnoteDefinitions("Body.[^a]\n\n[^a]: A note.")).toEqual([]);
    });
});

describe("a footnote reference no top-level definition resolves is a finding", () => {
    it("at the reference's own line and column, for a never-defined label", () => {
        const errors = unresolvedFootnoteReferences("Body.[^z]");
        expect(errors).toEqual([{ line: 1, column: 6, message: expect.stringContaining("[^z]") }]);
    });

    it("for a label defined only inside a table cell", () => {
        const source = "Body.[^c]\n\n| Note |\n| - |\n| [^c]: A note. |";
        const errors = unresolvedFootnoteReferences(source);
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain("[^c]");
    });

    it("does not also report a label already reported as misplaced", () => {
        const source = "Body.[^a]\n\n- item\n- [^a]: A note.";
        expect(unresolvedFootnoteReferences(source)).toEqual([]);
        expect(footnoteFindings(source)).toHaveLength(1);
    });
});

describe("a footnote example inside a code fence produces no finding", () => {
    it("whether the label is ever genuinely defined or not", () => {
        const source = "```markdown\n[^x]: Example\n:::\n```";
        expect(misplacedFootnoteDefinitions(source)).toEqual([]);
    });

    it("and does not count as a real definition for a reference outside it", () => {
        // The example inside the fence must not be mistaken for a genuine
        // top-level definition — a real reference naming the same label
        // still has nothing to resolve against.
        const source = "```markdown\n[^x]: Example\n```\n\nBody.[^x]";
        const errors = unresolvedFootnoteReferences(source);
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain("[^x]");
    });
});
