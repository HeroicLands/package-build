/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
// Build-time pack helper (plain ESM, no Foundry). Imported by relative path
// because the pack-build scripts live outside the `@src` alias tree.
import {
    splitPages,
    assertUniquePages,
    journalPageId,
    buildJournalEntry,
} from "../engine/journals.mjs";
import { pageOpenings } from "../engine/heading-attributes.mjs";
import { scanBlocks } from "../engine/content-blocks.mjs";
import { makeId } from "../engine/ids.mjs";
import { anchorPageId } from "../engine/wikilinks.mjs";

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

    it.each(["#", "##"])("names a %s page by its visible heading text", (level) => {
        const [page] = splitPages(
            `${level} [Jane Doe]{.name ref="#jane"} and [Old Tam]{.name} {#cast}\n\nbody`,
        );
        expect(page.name).toBe("Jane Doe and Old Tam");
        expect(page.anchorSlug).toBe("cast");
    });

    it("reduces resolved heading links and emphasis while preserving code and escaped characters", () => {
        const [page] = splitPages(
            '# **The** _old_ [quay](https://example.org) and <span class="content-link">@UUID[JournalEntry.abc.JournalEntryPage.def]{the harbor}</span>: `a*b` \\*literal\\* {#harbor}\n\nbody',
        );
        expect(page.name).toBe("The old quay and the harbor: a*b *literal*");
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

    it.each(["NOTE", "WARNING"])(
        "keeps caption-looking text inside a %s alert on its containing page",
        (type) => {
            const pages = splitPages(
                `# Public\n\n> [!${type}]\n>\n> :@ Caption. {#a}\n>\n> Alpha.\n\n# Next`,
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
        for (const opener of [":::secret", "::: {#info}", "::: {#warning}", ":::secret {#hoard}"]) {
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

describe("private source page identities", () => {
    const entryId = "0123456789abcdef";
    it("keeps public and literal anchored page IDs unchanged", () => {
        const body = "# Population 4700\n\nAn account.\n\n## Details 4700 {#details}\n\nDetails.";
        const publicPages = splitPages(body);
        expect(journalPageId(entryId, publicPages[0])).toBe(
            makeId("journal-page", `${entryId}:Population 4700`),
        );
        expect(journalPageId(entryId, publicPages[1])).toBe(anchorPageId(entryId, "details"));
        const source = body.replaceAll("4700", "{{data.population.actual}}");
        const lineMap = source.split("\n").map((_, line) => ({ line, generated: false }));
        const privatePages = splitPages(body, undefined, undefined, undefined, { source, lineMap });
        expect(journalPageId(entryId, privatePages[0])).not.toBe(
            journalPageId(entryId, publicPages[0]),
        );
        expect(journalPageId(entryId, privatePages[1])).toBe(anchorPageId(entryId, "details"));
        const doc = buildJournalEntry({
            id: entryId,
            name: "Account",
            markdown: body,
            pageSource: { source, lineMap },
        });
        expect(doc.pages.map((page) => page._id)).toEqual(
            privatePages.map((page) => journalPageId(entryId, page)),
        );
        expect(JSON.stringify(doc)).not.toContain("sourceIdentity");
    });

    it("preserves static page and continuation IDs when paragraphs move headings", () => {
        const source =
            "# Account\n\nBefore.\n\n: Example {#Example}\n\n```text\nSample\n```\n\nAfter.\n\n## Details {#explicit}\n\nAn anchored section.\n\n# Details\n\nDetails.";
        const expected = splitPages(source).map((page) => journalPageId(entryId, page));
        const privateIds = (body) =>
            splitPages(body, undefined, undefined, undefined, { source: body })
                .filter((page) => page.name !== "Introduction")
                .map((page) => journalPageId(entryId, page));
        expect(privateIds(source)).toEqual(expected);
        expect(privateIds(`A paragraph.\n\n${source}`)).toEqual(expected);
    });

    it("keys dynamic headings on unexpanded names across paragraph insertions and actual values", () => {
        const heading = "Population {{data.population.actual}}";
        const ids = (actual, prefix) => {
            const source = `${prefix}# ${heading}\n\nAn account.\n\n# Static\n\nDetails.`;
            const body = source.replace("{{data.population.actual}}", String(actual));
            return splitPages(body, undefined, undefined, undefined, {
                source,
                lineMap: source.split("\n").map((_, line) => ({ line, generated: false })),
            })
                .filter((page) => page.name !== "Introduction")
                .map((page) => journalPageId(entryId, page));
        };
        expect(ids(4700, "")).toEqual(ids(6800, "A paragraph.\n\n"));
        expect(ids(4700, "")).toEqual([
            makeId("journal-page", `${entryId}:${heading}`),
            makeId("journal-page", `${entryId}:Static`),
        ]);
        expect(ids(4700, "")[0]).not.toBe(makeId("journal-page", `${entryId}:Population 4700`));
    });

    it("uses literal generated anchors across ordering changes and withholds concealed slugs from seeds", () => {
        const source = "```sql\nSELECT 'Known {#known}', secret_heading\n```";
        const pages = (body) =>
            splitPages(body, undefined, undefined, undefined, {
                source,
                lineMap: body.split("\n").map(() => ({ line: 0, generated: true })),
            });
        const first = pages("# Known {#known}\n\nOne.\n\n# Hidden {#count4700}\n\nTwo.");
        const second = pages("# Hidden {#count6800}\n\nTwo.\n\n# Known {#known}\n\nOne.");
        expect(journalPageId(entryId, first[0])).toBe(anchorPageId(entryId, "known"));
        expect(journalPageId(entryId, second[1])).toBe(journalPageId(entryId, first[0]));
        expect(journalPageId(entryId, first[1])).toBe(journalPageId(entryId, second[0]));
        expect(journalPageId(entryId, first[1])).not.toBe(anchorPageId(entryId, "count4700"));
    });

    it("associates generated openings with their directive and structural ordinal", () => {
        const source = "```sql\nSELECT a_heading\n```";
        const render = (actual) => `# First ${actual}\n\nOne.\n\n# Second ${actual}\n\nTwo.`;
        const identity = (actual) =>
            splitPages(render(actual), undefined, undefined, undefined, {
                source,
                lineMap: render(actual)
                    .split("\n")
                    .map(() => ({ line: 0, generated: true })),
            }).map((page) => journalPageId(entryId, page));
        expect(identity(4700)).toEqual(identity(6800));
        expect(new Set(identity(4700)).size).toBe(2);
    });

    it("refuses an unassociated private opening and duplicate source identities", () => {
        expect(() =>
            splitPages("# Rendered", undefined, undefined, undefined, {
                file: "source.md",
                bodyLine: 8,
            } as any),
        ).toThrow("source.md:8:1: error: private journal has no captured source");
        expect(() =>
            splitPages("# Rendered\n\nBody.", undefined, undefined, undefined, {
                source: "# Source\n\nBody.",
                lineMap: [],
                file: "source.md",
                bodyLine: 8,
            }),
        ).toThrow("source.md:8:1: error: private journal page opening has no source association");
        expect(() =>
            assertUniquePages(
                [
                    {
                        name: "First",
                        anchorSlug: null,
                        sourceIdentity: { name: "Source" },
                    },
                    {
                        name: "Second",
                        anchorSlug: null,
                        sourceIdentity: { name: "Source" },
                    },
                ],
                "Account",
            ),
        ).toThrow("repeats a private page source identity");
    });
});
