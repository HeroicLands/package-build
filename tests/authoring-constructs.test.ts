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
 * captions — and each pass scans the whole body for its own `:::` lines. A pass
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
import { renderCaptionBlocks, scanCaptions } from "../engine/content-captions.mjs";
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
 * blocks are one pass over all three names, and captions are the other; every
 * compiler reads both. A surface reporting a finding the others do not is the
 * asymmetry worth failing on, so they are collected together and compared as
 * one set.
 */
function findings(source: string) {
    return [
        ...scanBlocks(source).errors.map((e) => `block ${e.line}: ${e.message}`),
        ...scanCaptions(source).errors.map((e) => `caption ${e.line}: ${e.message}`),
    ];
}

/** The body as the Foundry pack compiler renders it. */
function foundry(source: string) {
    return renderFoundryMarkdown(source, scanCaptions(source).captions, undefined, undefined);
}

/** The body as the site build renders it, in the order `site-build` runs. */
function web(source: string) {
    const blocks = renderBlocks(source, "web");
    return renderCaptionBlocks(blocks.markdown).markdown;
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
    caption: body(
        ":::caption {#trade}",
        "Trade routes out of the harbour",
        ":::",
        "",
        "| Route | Days |",
        "| ----- | ---- |",
        "| North | 4    |",
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
        ":::caption {#trade}",
        "Trade routes out of the harbour",
        ":::",
        "",
        "| Route | Days |",
        "| ----- | ---- |",
        "| North | 4    |",
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

    it("labels and numbers a caption", () => {
        expect(scanCaptions(CASES.caption).captions).toMatchObject([
            { id: "trade", kind: "table" },
        ]);
        expect(web(CASES.caption)).toContain('id="trade"');
        expect(book(CASES.caption)).toContain("Trade routes out of the harbour");
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

    it("a caption with no id", () => {
        reports(body(":::caption", "Trade routes", ":::", "", "Prose."), "{#anchor}");
    });

    it("a caption with no closing :::", () => {
        reports(body(":::caption {#t}", "Trade routes"), "closing");
    });

    it("a caption with no following block", () => {
        reports(body("Prose.", "", ":::caption {#t}", "Trade routes", ":::"), "following block");
    });

    it("a caption with empty text", () => {
        reports(body(":::caption {#t}", "", ":::", "", "Prose."), "empty");
    });

    it("two captions sharing an id", () => {
        reports(
            body(
                ":::caption {#t}",
                "One",
                ":::",
                "",
                "Prose one.",
                "",
                ":::caption {#t}",
                "Two",
                ":::",
                "",
                "Prose two.",
            ),
            "duplicate caption id",
        );
    });
});
