// SPDX-License-Identifier: GPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { collectAnchors } from "../engine/anchors.mjs";
import { extractAnchorSection } from "../engine/anchored-sections.mjs";
import { scanBlocks } from "../engine/content-blocks.mjs";
import { scanFigures } from "../engine/content-figures.mjs";
import { parseHeadingLine, splitHeadingAttributes } from "../engine/heading-attributes.mjs";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";
import { splitPages } from "../engine/journals.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";

const engineDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "engine");

/**
 * Every reader of a heading's brace suffix, derived from the engine source
 * rather than listed here.
 *
 * A pattern that reads the suffix off the end of a heading is anchored to the
 * end of what it matches; a pattern that merely mentions `{#id}` inside a
 * sentence — an error message matched to recover a position — is not. So the
 * two are told apart by the anchor, and a module that grows a reader of its own
 * fails this without anyone remembering to add it.
 */
function privateSuffixReaders() {
    const found: string[] = [];
    for (const name of fs.readdirSync(engineDir).filter((f) => f.endsWith(".mjs"))) {
        const source = fs.readFileSync(path.join(engineDir, name), "utf8");
        for (const [literal] of source.matchAll(
            /\/(?:\\.|\[(?:\\.|[^\]])*\]|[^/\n\\])+\/[gimsuy]*/g,
        )) {
            if (literal.includes("\\{#") && literal.includes("$"))
                found.push(`${name}: ${literal}`);
        }
    }
    return found;
}

describe("one reading of a heading's attribute block", () => {
    it("is the only reader in the engine", () => {
        expect(privateSuffixReaders()).toEqual([]);
    });

    it("separates an id, classes and attributes as a block and a caption do", () => {
        expect(splitHeadingAttributes('The Harbor {#harbor .wide data-x="1"}')).toEqual({
            text: "The Harbor",
            id: "harbor",
            classes: ["wide"],
            values: { "data-x": "1" },
            problems: [],
            braces: true,
        });
    });

    it("reads a heading that carries classes alone", () => {
        const parsed = splitHeadingAttributes("The Customs House {.wide}");
        expect(parsed.text).toBe("The Customs House");
        expect(parsed.id).toBe("");
        expect(parsed.classes).toEqual(["wide"]);
    });

    it("keeps a heading whose braces hold no attribute block, and says so once", () => {
        const parsed = splitHeadingAttributes("The set {a, b}");
        expect(parsed.text).toBe("The set {a, b}");
        expect(parsed.problems).toEqual(["{a, b} is not an attribute block"]);
    });

    it("refuses an event handler and an owned key, as a named block does", () => {
        expect(splitHeadingAttributes('The Harbor {#harbor onclick="x"}').problems).toEqual([
            "onclick is an event handler and is not written",
        ]);
        expect(splitHeadingAttributes('The Harbor {#harbor class="wide"}').problems).toEqual([
            "set class with .class rather than class=",
        ]);
    });

    it("writes an ordinary attribute a heading may carry", () => {
        expect(splitHeadingAttributes('The Harbor {#harbor title="West dock"}').values).toEqual({
            title: "West dock",
        });
    });

    it("accepts an id that begins with a digit, as the corpus writes", () => {
        expect(splitHeadingAttributes("Create the actor {#8qHUveVr9fydLyt2}").id).toBe(
            "8qHUveVr9fydLyt2",
        );
    });
});

describe("one reading of what starts a page", () => {
    it("reads the line's level, text and attributes through the same parse", () => {
        expect(parseHeadingLine("## The Harbor {#harbor .wide}")).toEqual({
            level: 2,
            text: "The Harbor",
            id: "harbor",
            classes: ["wide"],
            values: {},
            problems: [],
            startsPage: true,
        });
        expect(parseHeadingLine("Not a heading")).toBeNull();
    });

    it("starts a page on an H1 or an anchor, and not on a bare lower heading", () => {
        expect(parseHeadingLine("# Plain").startsPage).toBe(true);
        expect(parseHeadingLine("## Anchored {#x}").startsPage).toBe(true);
        expect(parseHeadingLine("## Classed {.wide}").startsPage).toBe(false);
        expect(parseHeadingLine("## Plain").startsPage).toBe(false);
    });

    /**
     * The block and figure refusals ask the same parse, so an opener carrying
     * its own attribute block does not hide a page-opening heading written
     * inside it, and an anchored heading carrying a class is still one.
     */
    it.each([
        ":::secret",
        ":::secret {#cellar}",
        ":::info",
        ":::info {#note .wide}",
        ":::warn",
        ':::warn {title="Careful"}',
    ])("refuses a page-opening heading inside %s", (opener) => {
        for (const heading of [
            "# An H1",
            "## Anchored {#x}",
            "## Anchored and classed {#x .wide}",
        ]) {
            const errors = scanBlocks([opener, heading, "Body text.", ":::"].join("\n")).errors;
            expect(errors.map((e) => e.message).join(" ")).toContain("cannot be written inside");
        }
        // A bare lower heading is still the ordinary way to structure a box.
        const fine = scanBlocks([opener, "## Plain sub", "Body text.", ":::"].join("\n")).errors;
        expect(fine.map((e) => e.message).join(" ")).not.toContain("cannot be written inside");
    });

    it("refuses a page-opening heading inside a figure, by the same parse", () => {
        for (const heading of [
            "# An H1",
            "## Anchored {#x}",
            "## Anchored and classed {#x .wide}",
        ]) {
            const errors = scanFigures(
                [":::figure {#cap}", heading, "///", "A caption.", ":::"].join("\n"),
            ).errors;
            expect(errors.map((e) => e.message).join(" ")).toContain(
                "cannot be written inside a figure",
            );
        }
    });
});

describe("every reader agrees about one heading", () => {
    const cases = [
        "## The Harbor {#harbor}",
        "## The Harbor {#harbor .wide}",
        '## The Harbor {#harbor .wide data-note="x"}',
        "# The Harbor {#harbor}",
    ];

    it.each(cases)("reads the same id from %s", (heading) => {
        const body = `${heading}\n\nThe tide runs out at dusk.\n`;
        expect(collectAnchors(body).map((a) => a.slug)).toEqual(["harbor"]);
        expect(
            splitPages(body)
                .map((p) => p.anchorSlug)
                .filter(Boolean),
        ).toEqual(["harbor"]);
    });

    it.each(cases)("prints no braces from %s", (heading) => {
        const body = `${heading}\n\nThe tide runs out at dusk.\n`;
        const page = splitPages(body).find((p) => p.anchorSlug === "harbor");
        expect(page?.name).toBe("The Harbor");
        expect(renderFoundryMarkdown(body)).not.toContain("{#harbor");
        expect(markdownToTypst(body)).not.toContain("{#harbor");
        expect(markdownToTypst(body)).not.toContain(".wide");
    });

    it("extracts an anchored section whose heading also carries a class", () => {
        const body = "# Appearance {#appearance .wide}\n\nTall, and grey at the temple.\n";
        expect(extractAnchorSection(body, "appearance")).toBe("Tall, and grey at the temple.");
    });

    it("sees a heading and a figure claim one anchor through the shared reading", () => {
        const body =
            "## Trade {#trade .wide}\n\n:::figure {#trade}\nRoutes\n///\nTrade\n:::\n\nA paragraph.\n";
        expect(scanFigures(body).errors.map((e) => e.message)).toContain(
            'heading and figure declare the same anchor "trade"',
        );
    });
});
