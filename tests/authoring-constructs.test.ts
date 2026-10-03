/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Every block construct `docs/authoring/links-and-markup.md` specifies renders
 * on every surface, and correct markup produces no finding on any of them.
 *
 * **The second half is the guard.** The three surfaces each assemble the body
 * out of the same passes in the same order — secrets, then admonitions, then
 * figures — and each pass scans the whole body for its own `:::` lines. A pass
 * that mistakes another construct's closer for its own reports an error on
 * correct markup, and every one of these surfaces fails the build on an error.
 * That failure is invisible to a test driving one pass in isolation with input
 * containing only that pass's own blocks, which is how a corpus using none of
 * these constructs can sit beside a suite that passes.
 *
 * So each case below is written as an author would write it, put through the
 * real chain for each surface, and checked twice: that the markup came out, and
 * that nothing complained. A construct added to the document is added here.
 */

import { describe, it, expect } from "vitest";

import { renderBlocks, scanBlocks } from "../engine/content-blocks.mjs";
import { renderFigureBlocks, scanFigures } from "../engine/content-figures.mjs";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";
import { IMAGE_FLOATS, IMAGE_SIZES } from "../engine/content-images.mjs";

import { readFileSync } from "node:fs";
import path from "node:path";

/** One authored body, as a note would carry it. */
const body = (...lines: string[]) => lines.join("\n");

/**
 * The findings every surface would raise for a body.
 *
 * Read out of the passes the compilers call rather than restated. The named
 * blocks are one pass over all three names, and figures are the other; every
 * compiler reads both. A surface reporting a finding the others do not is the
 * asymmetry worth failing on, so they are collected together and compared as
 * one set.
 */
function findings(source: string) {
    return [
        ...scanBlocks(source).errors.map((e) => `block ${e.line}: ${e.message}`),
        ...scanFigures(source).errors.map((e) => `figure ${e.line}: ${e.message}`),
    ];
}

/** The body as the Foundry pack compiler renders it. */
function foundry(source: string) {
    return renderFoundryMarkdown(source, scanFigures(source).figures, undefined, undefined);
}

/** The body as the site build renders it, in the order `site-build` runs. */
function web(source: string) {
    const blocks = renderBlocks(source, "web");
    return renderFigureBlocks(blocks.markdown).markdown;
}

/**
 * The body as the book renders it.
 *
 * `markdownToTypst` reads every named block itself, as `pdf-build` relies on,
 * so a body goes to it as authored and each block becomes a print box.
 */
function book(source: string) {
    return markdownToTypst(source);
}

/**
 * Every documented block construct, one case each, plus the combinations that
 * put more than one `:::` construct in one body — which is the shape no single
 * pass's own tests produce.
 */
const CASES: Record<string, string> = {
    secret: body(":::secret", "The vault is behind the arras.", ":::"),
    info: body(":::info", "Ships pay the harbour due on arrival.", ":::"),
    warn: body(":::warn", "The shoals are uncovered at low water.", ":::"),
    "warn with an id": body(":::warn {#risk}", "The shoals are uncovered.", ":::"),
    figure: body(
        ":::figure {#trade}",
        "| Route | Days |",
        "| ----- | ---- |",
        "| North | 4    |",
        "///",
        "Trade routes out of the harbour",
        ":::",
    ),
    "figure with no caption": body(
        ":::figure {#shoals}",
        "| Shoal | Depth |",
        "| ----- | ----- |",
        "| Bar   | 2     |",
        ":::",
    ),
    "bordered prose figure": body(
        ":::figure {#aside .border}",
        "The harbourmaster keeps the tide table himself.",
        "///",
        "The tide table",
        ":::",
    ),
    "figure inside a secret": body(
        ":::secret",
        "Before.",
        "",
        ":::figure {#takings}",
        "The cut is a tenth.",
        "///",
        "What the harbourmaster takes",
        ":::",
        "",
        "After.",
        ":::",
    ),
    footnotes: body("Spring brings the floods.[^flood]", "", "[^flood]: Snowmelt off the ridge."),
    "definition list": body("Harbour due", ": A toll on every hull that ties up."),
    "every construct in one note": body(
        ":::info",
        "Ships pay the harbour due on arrival.",
        ":::",
        "",
        ":::warn {#risk}",
        "The shoals are uncovered at low water.",
        ":::",
        "",
        ":::secret",
        "The harbourmaster takes a cut.",
        ":::",
        "",
        ":::figure {#trade}",
        "| Route | Days |",
        "| ----- | ---- |",
        "| North | 4    |",
        "///",
        "Trade routes out of the harbour",
        ":::",
        "",
        "Spring brings the floods.[^flood]",
        "",
        "Harbour due",
        ": A toll on every hull that ties up.",
        "",
        "[^flood]: Snowmelt off the ridge.",
    ),
};

describe("correct markup produces no finding, on any surface", () => {
    for (const [name, source] of Object.entries(CASES)) {
        it(`${name}`, () => {
            expect(findings(source)).toEqual([]);
        });
    }
});

describe("every surface renders every construct", () => {
    for (const [name, source] of Object.entries(CASES)) {
        it(`${name} compiles on all three`, () => {
            expect(() => foundry(source)).not.toThrow();
            expect(() => web(source)).not.toThrow();
            expect(() => book(source)).not.toThrow();
        });
    }

    it("renders a secret as a section, a disclosure and a print box", () => {
        const source = CASES.secret;

        expect(foundry(source)).toContain('class="secret"');
        expect(web(source)).toContain('<details class="secret"');
        expect(web(source)).toContain('<summary class="secret">Secret</summary>');
        expect(book(source)).toContain("Secret");
    });

    it("renders info and warning blocks headed by their kind", () => {
        expect(web(CASES.info)).toContain('<details class="info"');
        expect(foundry(CASES.warn)).toContain('<section class="warn"');
        expect(book(CASES.warn)).toContain("Warn");
    });

    it("carries a warning block's id through as an anchor", () => {
        expect(web(CASES["warn with an id"])).toContain('id="risk"');
    });

    it("labels and numbers a figure", () => {
        expect(scanFigures(CASES.figure).figures).toMatchObject([{ id: "trade", kind: "table" }]);
        expect(web(CASES.figure)).toContain('id="trade"');
        expect(web(CASES.figure)).toContain("Table 1: Trade routes out of the harbour");
        expect(book(CASES.figure)).toContain("Trade routes out of the harbour");
    });

    it("draws an uncaptioned figure's label alone", () => {
        expect(web(CASES["figure with no caption"])).toContain(
            '<p class="content-figure-label">Table 1</p>',
        );
    });

    it("carries a figure's authored class through to the web", () => {
        expect(web(CASES["bordered prose figure"])).toContain(
            '<div id="aside" class="content-figure content-figure-prose border">',
        );
    });

    it("renders footnotes", () => {
        expect(foundry(CASES.footnotes)).toContain("Footnotes");
        expect(book(CASES.footnotes)).toContain("#footnote[");
    });

    it("renders a definition list as one on every surface", () => {
        expect(foundry(CASES["definition list"])).toContain("<dt>Harbour due</dt>");
        expect(book(CASES["definition list"])).toContain("terms.item(");
    });
});

/**
 * The document and the code agree on the vocabularies the document enumerates.
 *
 * Derived from the frozen lists rather than from a second copy, so a name added
 * to one of them fails here until the document names it too. A hand-written
 * second list is one more thing to drift, which is how `full-width` came to be
 * a size the code accepted and the document did not mention.
 */
describe("the document enumerates what the code accepts", () => {
    const DOC = readFileSync(
        path.resolve(__dirname, "../docs/authoring/links-and-markup.md"),
        "utf8",
    );

    it("names every image size", () => {
        for (const size of IMAGE_SIZES) {
            expect(DOC, `size \`${size}\` is not named`).toContain(`\`${size}\``);
        }
    });

    it("names every float position", () => {
        for (const position of Object.keys(IMAGE_FLOATS)) {
            expect(DOC, `float \`${position}\` is not named`).toContain(`\`${position}\``);
        }
    });
});

/**
 * The failure modes the document states are errors stay errors.
 *
 * Checked beside the clean cases, because the fix for a pass claiming markup it
 * does not own is to claim less — and claiming nothing would pass every test
 * above while reporting none of these.
 */
describe("the documented failure modes still report", () => {
    const reports = (source: string, fragment: string) => {
        const all = findings(source).join("\n");
        expect(all).toContain(fragment);
    };

    it("a ::: that closes nothing at all", () => {
        reports(body("Prose.", ":::", "More prose."), "closes no block");
    });

    it("an unclosed secret block", () => {
        reports(body(":::secret", "A clue."), "secret block needs a closing");
    });

    it("a nested secret block", () => {
        reports(body(":::secret", "a", ":::secret", "b", ":::", ":::"), "nested secret");
    });

    it("an unclosed warning block", () => {
        reports(body(":::warn", "Shoals."), "warn block needs a closing");
    });

    it("a nested admonition", () => {
        reports(body(":::info", "Outer.", ":::warn", "Inner.", ":::", ":::"), "nested warn blocks");
    });

    it("a figure whose attributes are not braced", () => {
        reports(body(":::figure #trade", "Trade routes", ":::"), "{#id");
    });

    it("a figure carrying a class the construct does not declare", () => {
        reports(body(":::figure {#t .wide}", "Trade routes", ":::"), ".wide");
    });

    it("a figure carrying a key=value attribute", () => {
        reports(body(':::figure {#t kind="table"}', "Trade routes", ":::"), "kind=");
    });

    it("a figure with no closing :::", () => {
        reports(body(":::figure {#t}", "Trade routes"), "closing");
    });

    it("a figure with no contents", () => {
        reports(body(":::figure {#t}", "///", "Trade routes", ":::"), "no contents");
    });

    it("a figure whose /// section is blank", () => {
        reports(body(":::figure {#t}", "Trade routes", "///", "", ":::"), "write no ///");
    });

    it("a figure carrying a second top-level ///", () => {
        reports(body(":::figure {#t}", "Routes", "///", "One", "///", "Two", ":::"), "one caption");
    });

    it("an H1 inside a secret block, which would tear its own page", () => {
        reports(body(":::secret", "# A heading", "Text.", ":::"), "starts a page");
    });

    it("an anchored heading inside an info block, the same as an H1", () => {
        reports(body(":::info", "## A heading {#x}", "Text.", ":::"), "starts a page");
    });

    it("a page-starting heading written inside a figure", () => {
        reports(body(":::figure {#t}", "# A heading", "///", "A caption.", ":::"), "starts a page");
    });

    it("two figures sharing an id", () => {
        reports(
            body(
                ":::figure {#t}",
                "One.",
                "///",
                "First",
                ":::",
                "",
                ":::figure {#t}",
                "Two.",
                "///",
                "Second",
                ":::",
            ),
            "duplicate figure id",
        );
    });
});
