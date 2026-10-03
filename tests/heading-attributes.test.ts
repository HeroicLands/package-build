// SPDX-License-Identifier: GPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { collectAnchors } from "../engine/anchors.mjs";
import { extractAnchorSection } from "../engine/anchored-sections.mjs";
import { scanCaptions } from "../engine/content-captions.mjs";
import { splitHeadingAttributes } from "../engine/heading-attributes.mjs";
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

    it("keeps a heading whose braces hold no attribute block, and says so", () => {
        const parsed = splitHeadingAttributes("The set {a, b}");
        expect(parsed.text).toBe("The set {a, b}");
        expect(parsed.problems.length).toBeGreaterThan(0);
    });

    it("accepts an id that begins with a digit, as the corpus writes", () => {
        expect(splitHeadingAttributes("Create the actor {#8qHUveVr9fydLyt2}").id).toBe(
            "8qHUveVr9fydLyt2",
        );
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

    it("sees a heading and a caption claim one anchor through the shared reading", () => {
        const body =
            "## Trade {#trade .wide}\n\n:::caption {#trade}\nRoutes\n:::\n\nA paragraph.\n";
        expect(scanCaptions(body).errors.map((e) => e.message)).toContain(
            'heading and caption declare the same anchor "trade"',
        );
    });
});
