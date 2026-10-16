/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectAnchors } from "../engine/anchors.mjs";
import { BLOCK_NAMES, scanBlocks } from "../engine/content-blocks.mjs";
import { expandContentTables } from "../engine/content-tables.mjs";
import { pageOpenings, scanHeadingAttributes } from "../engine/heading-attributes.mjs";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";
import { buildPages, splitPages } from "../engine/journals.mjs";
import { insertLexicalSections, lexicalSectionsFor } from "../engine/lexical-sections.mjs";
import { openNotesDatabase, prepareSqlTables } from "../engine/sql-tables.mjs";

const language = "demo-note-skill-tongue";
const record = {
    package: "demo",
    type: "skill",
    subType: "language",
    shortcode: "tongue",
    id: "abcdefghijklmnop",
    name: { full: "Tongue" },
    address: { canonical: language, slug: "skill-tongue" },
    file: { path: "Tongue.md", name: "Tongue", folder: "" },
    data: { words: [{ form: "zethu", class: "n", field: "Court", gloss: "a scribe" }] },
};
const lexical = lexicalSectionsFor([record]).get(language)!;
let db: any;

beforeAll(async () => {
    db = await openNotesDatabase([record]);
});
afterAll(async () => {
    await db?.close();
});

describe("automatic lexical sections follow authored structure", () => {
    it("inserts after authored text following a custom SQL subsection, preserving later source locations", async () => {
        const source = [
            "## Lexicon {#lexicon}",
            "",
            "Authored introduction.",
            "",
            "```sql",
            `SELECT 'Custom subsection' AS "_section", 'Custom row.' AS "Entry"`,
            "```",
            "",
            "Authored text after the custom table.",
            "",
            "## Reading {#reading}",
            "",
            "Next section.",
        ].join("\n");
        const prepared: any = (
            await prepareSqlTables(db, [{ source: "Tongue.md", markdown: source }])
        ).get("Tongue.md");
        expect(prepared[0].reason).toBeUndefined();
        expect(prepared[0].markdown).toContain("## Custom subsection");
        prepared.lexical = lexical;
        const result = expandContentTables(source, { sqlTables: prepared });
        expect(result.markdown.indexOf("**zethu**")).toBeGreaterThan(
            result.markdown.indexOf("Authored text after the custom table."),
        );
        expect(result.markdown.indexOf("**zethu**")).toBeLessThan(
            result.markdown.indexOf("## Reading"),
        );
        const at = result.markdown.split("\n").findIndex((line) => line.startsWith("## Reading"));
        expect(result.lineMap[at]).toEqual({
            line: source.split("\n").indexOf("## Reading {#reading}"),
            generated: false,
        });
    });

    it("keeps a reused lexical section before the existing appended generated sections", () => {
        const tables: any = [];
        tables.lexical = lexical;
        tables.generated = "# Within {#within}\n\nAn existing derived list.";
        const result = expandContentTables("# Lexicon {#lexicon}\n\nAuthored text.", {
            sqlTables: tables,
        });
        expect(result.markdown.indexOf("**zethu**")).toBeLessThan(
            result.markdown.indexOf("# Within"),
        );
        expect(result.markdown.split("\n")[result.generatedFrom!]).toBe("# Within {#within}");
    });

    for (const literal of [
        "<!--\n# Hidden example {#dictionary}\n-->",
        "<div>\n# Hidden example {#dictionary}\n</div>",
    ]) {
        it(`ignores a heading example in ${literal.startsWith("<!--") ? "an HTML comment" : "an HTML block"} even without lexical data`, () => {
            const source = `# Overview {#overview}\n\n${literal}\n\n# Reading {#reading}\n\nProse.`;
            expect(scanHeadingAttributes(source).headings.map((heading) => heading.id)).toEqual([
                "overview",
                "reading",
            ]);
            expect([...pageOpenings(source).values()].map((heading) => heading.id)).toEqual([
                "overview",
                "reading",
            ]);
            expect(collectAnchors(source).map((anchor) => anchor.slug)).toEqual([
                "overview",
                "reading",
            ]);
            expect(splitPages(source).map((page) => page.name)).toEqual(["Overview", "Reading"]);
        });
    }

    it("adds an actual Dictionary heading instead of reusing a hidden comment example", () => {
        const source = "<!--\n# Hidden example {#dictionary}\n-->\n\nAuthored prose.";
        const result = insertLexicalSections(source, lexical);
        const html = renderFoundryMarkdown(result.markdown);
        expect(result.markdown).toContain("# Dictionary {#dictionary}");
        expect(html.match(/id="dictionary"/g)).toHaveLength(1);
        expect(
            collectAnchors(result.markdown).filter((anchor) => anchor.slug === "dictionary"),
        ).toHaveLength(1);
        const pages = buildPages(splitPages(result.markdown), record.id, "Tongue");
        expect(pages.some((page) => page.name === "Hidden example")).toBe(false);
        const dictionary = pages.find((page) => page.name === "Dictionary");
        expect(dictionary?.text?.content).toMatch(/<h6\b[^>]*id="word-[^"]+"/);
    });

    for (const opening of [
        ...Object.keys(BLOCK_NAMES).map((name) => `:::${name}`),
        "::: {.panel}",
    ]) {
        it(`never captures an anchored heading inside ${opening}`, () => {
            const source = `${opening}\n## Hidden lexicon {#lexicon}\n\nPrivate introduction.\n\n## Another heading\n\nMore.\n:::\n\n# Public\n\nPublic prose.`;
            expect(scanBlocks(source).errors.map((error) => error.message)).toContainEqual(
                expect.stringContaining("a heading that starts a page cannot be written inside"),
            );
            const result = insertLexicalSections(source, lexical);
            expect(result.markdown).toContain("# Dictionary {#dictionary}");
            expect(result.markdown.indexOf("**zethu**")).toBeGreaterThan(
                result.markdown.indexOf("Public prose."),
            );
            expect(scanBlocks(result.markdown).errors.map((error) => error.message)).toContainEqual(
                expect.stringContaining("a heading that starts a page cannot be written inside"),
            );
        });
    }
});
