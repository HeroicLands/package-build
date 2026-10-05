/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
// Build-time pack helper (plain ESM, no Foundry). Imported by relative path
// because the pack-build scripts live outside the `@src` alias tree.
import { splitPages, assertUniquePages } from "../engine/journals.mjs";
import { pageOpenings } from "../engine/heading-attributes.mjs";
import { scanBlocks } from "../engine/content-blocks.mjs";

/** The lines inside a named block, as the page splitter supplies them. */
function blockLines(markdown: string): Set<number> {
    const lines = new Set<number>();
    for (const { start, end } of scanBlocks(markdown).blocks) {
        for (let i = start; i <= end; i++) lines.add(i);
    }
    return lines;
}

describe("splitPages (a page per H1, and per anchored heading)", () => {
    it("splits on an H1 and keeps its heading depth", () => {
        const pages = splitPages("intro text\n\n# First\n\nbody\n\n# Second\n\nmore");
        expect(pages.map((p) => p.name)).toEqual(["Introduction", "First", "Second"]);
        expect(pages.map((p) => p.level)).toEqual([1, 1, 1]);
    });

    it("splits on a deeper heading when it carries an anchor, recording the slug", () => {
        const pages = splitPages("# Top\n\na\n\n## Marked {#marked}\n\nb\n\n## Plain\n\nc");
        expect(pages.map((p) => p.name)).toEqual(["Top", "Marked"]);
        expect(pages[1].level).toBe(2);
        expect(pages[1].anchorSlug).toBe("marked");
        // The unanchored H2 stays inside the page it follows.
        expect(pages[1].markdown).toContain("## Plain");
    });

    it("strips the anchor from the page name", () => {
        const [page] = splitPages("# Shock State Index {#shock-state-index}\n\nbody");
        expect(page.name).toBe("Shock State Index");
        expect(page.anchorSlug).toBe("shock-state-index");
    });

    it("ignores a heading inside a fenced code block", () => {
        const pages = splitPages("# Real\n\n```\n# Not a heading {#nope}\n```\n");
        expect(pages).toHaveLength(1);
        expect(pages[0].name).toBe("Real");
    });

    it("keeps headings inside a secret block on their containing page", () => {
        const pages = splitPages("# Public\n\n:::secret\n# GM heading\nA clue.\n:::\n\n# Next");
        expect(pages.map((page) => page.name)).toEqual(["Public", "Next"]);
        expect(pages[0].markdown).toContain("# GM heading");
    });

    it.each(["info", "warn"])(
        "keeps a figure inside a :::%s block on its containing page",
        (name) => {
            const pages = splitPages(
                `# Public\n\n:::${name}\n\n:@ Caption. {#a}\n\nAlpha.\n:::\n\n# Next`,
            );
            expect(pages.map((page) => page.name)).toEqual(["Public", "Next"]);
            expect(pages[0].markdown).toContain(":@ Caption. {#a}");
        },
    );

    it.each([":::secret {#hoard}", ':::secret {title="The hoard"}'])(
        "keeps a figure inside %s on its containing page",
        (opener) => {
            const pages = splitPages(
                `# Public\n\n${opener}\n\n:@ Caption. {#a}\n\nAlpha.\n:::\n\n# Next`,
            );
            expect(pages.map((page) => page.name)).toEqual(["Public", "Next"]);
            expect(pages[0].markdown).toContain(":@ Caption. {#a}");
        },
    );

    it("keeps a second figure and the prose between two figures inside one secret on its containing page", () => {
        const body = [
            "# Public",
            "",
            ":::secret",
            "",
            ":@ Alpha. {#a}",
            "",
            "Alpha.",
            "",
            "GM prose between figures.",
            "",
            ":@ Beta. {#b}",
            "",
            "Beta.",
            ":::",
            "",
            "# Next",
        ].join("\n");
        const pages = splitPages(body);
        expect(pages.map((page) => page.name)).toEqual(["Public", "Next"]);
        expect(pages[0].markdown).toContain("GM prose between figures.");
        expect(pages[0].markdown).toContain(":@ Beta. {#b}");
    });

    it("still starts its own page for a figure at the top level", () => {
        const pages = splitPages("# Public\n\n:@ Caption. {#a}\n\nAlpha.\n\n# Next");
        expect(pages.map((page) => page.name)).toEqual(["Public", "Prose 1", "Next"]);
    });

    it("ignores a heading inside a tilde-fenced code block", () => {
        const pages = splitPages("# Real\n\n~~~\n# Not a heading {#nope}\n~~~\n");
        expect(pages).toHaveLength(1);
        expect(pages[0].name).toBe("Real");
    });

    it("keeps a four-backtick fence's own three-backtick line from closing it early", () => {
        const body = [
            "# Real",
            "",
            "````",
            "# Not a heading {#nope}",
            "```",
            "more code",
            "````",
            "",
            "# Next",
        ].join("\n");
        const pages = splitPages(body);
        expect(pages.map((page) => page.name)).toEqual(["Real", "Next"]);
    });
});

describe("assertUniquePages", () => {
    it("accepts distinct anchors", () => {
        expect(() =>
            assertUniquePages(
                [
                    { anchorSlug: "a", name: "A" },
                    { anchorSlug: "b", name: "B" },
                    { anchorSlug: null, name: "C" },
                ],
                "Note",
            ),
        ).not.toThrow();
    });

    it("accepts several pages with no anchor at all", () => {
        // Each still has its own heading, which is what identifies it since
        // The index is not part of the key. `splitPages` never yields a page
        // without a name, so this is the shape the compiler actually passes.
        expect(() =>
            assertUniquePages(
                [
                    { anchorSlug: null, name: "One" },
                    { anchorSlug: null, name: "Two" },
                ],
                "Note",
            ),
        ).not.toThrow();
    });

    it("rejects two unanchored pages sharing a heading", () => {
        // They derive one page id, so the two compile to a single document —
        // reported here, where the note and the heading can be named, rather
        // than by the LevelDB packer as an opaque key collision.
        expect(() =>
            assertUniquePages(
                [
                    { anchorSlug: null, name: "Notes" },
                    { anchorSlug: null, name: "Notes" },
                ],
                "Mystical Ability",
            ),
        ).toThrow(/Mystical Ability.*"Notes"/);
    });

    it("does not confuse an anchor with a name", () => {
        // The two halves key differently — a slug through `anchorPageId`, a
        // name through `makeId` — so a page named for another's anchor is not
        // a collision.
        expect(() =>
            assertUniquePages(
                [
                    { anchorSlug: "notes", name: "Something Else" },
                    { anchorSlug: null, name: "notes" },
                ],
                "Note",
            ),
        ).not.toThrow();
    });

    it("rejects a repeated anchor, naming the note and the slug", () => {
        // Two headings sharing an anchor derive the same page id, which the
        // LevelDB packer would only report as an opaque key collision.
        expect(() =>
            assertUniquePages(
                [
                    { anchorSlug: "before-you-start", name: "Before You Start" },
                    { anchorSlug: "before-you-start", name: "Before You Start (2)" },
                ],
                "Mystical Ability",
            ),
        ).toThrow(/Mystical Ability.*before-you-start/);
    });
});

describe("a page-opening heading inside a named block", () => {
    it("is no opening, for every name and however the opener is written", () => {
        // `pageOpenings` is told which lines sit inside a named block rather
        // than reading them itself, so every name in the registry, an opener
        // carrying an attribute block, and a nested construct's own closing
        // line are all answered by the one reading `scanBlocks` performs.
        for (const opener of [":::secret", ":::info", ":::warn", ":::secret {#hoard}"]) {
            const body = [
                "# Public",
                "Before.",
                "",
                opener,
                "# Hidden {#hidden}",
                "Inside.",
                ":::",
                "",
                "# Next",
                "After.",
            ].join("\n");
            const names = [...pageOpenings(body, blockLines(body)).values()].map((o) => o.text);
            expect(names, opener).toEqual(["Public", "Next"]);
        }
    });

    it("is an opening at the top level, with no block to sit inside", () => {
        const body = ["# Public", "Before.", "", "# Next {#next}", "After."].join("\n");
        const names = [...pageOpenings(body, blockLines(body)).values()].map((o) => o.text);
        expect(names).toEqual(["Public", "Next"]);
    });
});
