/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The item-frontmatter reference, and the one property that decides whether a
 * consumer can commit it: **the page must already be what Prettier would
 * write.**
 *
 * A consumer commits this page and formats its repository. If the generator and
 * the formatter disagree by so much as a space, the formatter rewrites the file
 * and the `--check` guard then calls it stale on every clean checkout — the two
 * undoing each other forever, with the repository never settling.
 *
 * That is why the tables are padded here rather than by a formatting step, and
 * why this case exists: it is the guard on a hand-reproduced Prettier rule. If
 * Prettier's markdown printer ever changes, or a field description starts using
 * a construct Prettier normalises, this fails here — in the package that
 * generates the page — rather than in the repository that publishes it.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import prettier from "prettier";
import matter from "gray-matter";

import {
    renderItemFieldReference,
    isUnderContentTree,
    shortcodeFromBasename,
    itemFieldsEnvelope,
    renderItemFieldsPage,
} from "../engine/field-reference.mjs";
import { defineConfig } from "../content-config.mjs";
import { sharedPrettierOptionsFor } from "../engine/prose-config.mjs";

/** The page as the command writes it, trailing newline and all. */
const page = `${renderItemFieldReference({
    title: "Item Note Frontmatter",
    preamble: [
        "See also: [The Authoring Workflow](authoring-workflow.md)",
        "",
        "Every item note carries the frontmatter envelope described there.",
    ],
    generatedBy: "`content-build docs item-fields`",
})}\n`;

describe("the generated page is what Prettier would write", () => {
    it("survives Prettier unchanged", async () => {
        const formatted = await prettier.format(page, { parser: "markdown" });

        expect(formatted).toBe(page);
    });

    it("pads every table column to its widest cell", () => {
        // The property Prettier is being matched on. Checked directly too, so a
        // failure says which rule broke rather than only that something did.
        const rows = page.split("\n").filter((line) => line.startsWith("|"));
        expect(rows.length).toBeGreaterThan(0);

        const widthsOf = (row: string) =>
            row
                .replace(/^\| /, "")
                .replace(/ \|$/, "")
                .split(" | ")
                .map((cell) => cell.length);

        // Group consecutive table lines, then check each block is rectangular.
        let block: string[] = [];
        const blocks: string[][] = [];
        for (const line of page.split("\n")) {
            if (line.startsWith("|")) block.push(line);
            else if (block.length) {
                blocks.push(block);
                block = [];
            }
        }
        if (block.length) blocks.push(block);

        for (const table of blocks) {
            const widths = table.map(widthsOf);
            for (const row of widths) {
                expect(row).toEqual(widths[0]);
            }
        }
    });
});

describe("what the consumer supplies", () => {
    it("emits the preamble between the banner and the first table", () => {
        const lines = page.split("\n");
        const preambleAt = lines.indexOf(
            "See also: [The Authoring Workflow](authoring-workflow.md)",
        );
        const firstTable = lines.findIndex((l) => l.startsWith("|"));

        expect(preambleAt).toBeGreaterThan(-1);
        expect(preambleAt).toBeLessThan(firstTable);
    });

    it("uses the title it is given as the H1", () => {
        expect(page.split("\n")[0]).toBe("# Item Note Frontmatter");
    });

    it("renders without a preamble at all", () => {
        const bare = renderItemFieldReference({ title: "Bare" });

        expect(bare.split("\n")[0]).toBe("# Bare");
        expect(bare).toContain("|");
    });
});

describe("the worked example is the smallest note that compiles", () => {
    /** Every fenced example on the page — one per item type. */
    const examples = (() => {
        const out: string[][] = [];
        let block: string[] | undefined;
        for (const line of page.split("\n")) {
            if (line.startsWith("```markdown")) block = [];
            else if (line === "```" && block) {
                out.push(block);
                block = undefined;
            } else block?.push(line);
        }
        return out;
    })();

    it("emits one example per type", () => {
        expect(examples.length).toBeGreaterThan(0);
    });

    it("authors no `id:`", () => {
        // A note's document `_id` derives from its canonical address, and `id:`
        // is the escape hatch for keeping identity across a shortcode rename —
        // not part of the envelope. This page is the reference an author reads
        // while writing a note, and the block most likely to be copied as a
        // template, so an `id:` here teaches every author to write a field that
        // should normally be absent.
        for (const example of examples) {
            expect(example.filter((line) => line.startsWith("id:"))).toEqual([]);
        }
    });

    it("still authors the address the id derives from", () => {
        // The counterpart: what is dropped is the *optional* field, not the
        // address the derivation reads to compute an id in its place.
        for (const example of examples) {
            expect(example).toContain("shortcode: xmpl");
            expect(example.some((line) => line.startsWith("type: "))).toBe(true);
        }
    });
});

describe("emphasis in a field description", () => {
    it("uses the marker Prettier normalises to", async () => {
        // `*x*` and `_x_` both mean emphasis; Prettier writes `_x_`. A
        // declaration using the other spelling would be silently rewritten in
        // the consumer's repository, so the source uses `_` and this says so.
        const emphasised = page.match(/(?<![*\w])\*(?!\*)[^*\n]+\*(?!\*)/g);

        expect(emphasised).toBeNull();

        const formatted = await prettier.format(page, { parser: "markdown" });
        expect(formatted).toBe(page);
    });
});

describe("isUnderContentTree", () => {
    const contentRoot = "/repo/assets/content";

    it("is true for a file directly under the content root", () => {
        expect(isUnderContentTree("/repo/assets/content/item-frontmatter.md", contentRoot)).toBe(
            true,
        );
    });

    it("is true for a file nested inside the content tree", () => {
        expect(
            isUnderContentTree("/repo/assets/content/Dev_Docs/item-frontmatter.md", contentRoot),
        ).toBe(true);
    });

    it("is false for a file outside the content tree", () => {
        expect(isUnderContentTree("/repo/docs/item-fields.md", contentRoot)).toBe(false);
    });

    it("is false for the content root itself, which is a directory, not a note", () => {
        expect(isUnderContentTree(contentRoot, contentRoot)).toBe(false);
    });

    it("is false for a sibling directory whose name merely starts with the root's", () => {
        // `path.relative` is what keeps `assets/content-templates` from being
        // read as inside `assets/content` — a naive prefix check would not.
        expect(isUnderContentTree("/repo/assets/content-templates/x.md", contentRoot)).toBe(false);
    });
});

describe("shortcodeFromBasename", () => {
    it("lowercases and strips everything but letters and digits", () => {
        expect(shortcodeFromBasename("/repo/assets/content/Item-Frontmatter.md")).toBe(
            "itemfrontmatter",
        );
    });

    it("drops the extension", () => {
        expect(shortcodeFromBasename("/repo/docs/gettingStarted.markdown")).toBe("gettingstarted");
    });
});

describe("itemFieldsEnvelope", () => {
    it("writes the universal keys, `name.full` from the title", () => {
        expect(
            itemFieldsEnvelope({ title: "Item Note Frontmatter", shortcode: "itemfrontmatter" }),
        ).toEqual({
            type: "doc",
            subType: "reference",
            shortcode: "itemfrontmatter",
            name: { full: "Item Note Frontmatter" },
            pack: "none",
        });
    });

    it("deep-merges the consumer's frontmatter over the derived envelope", () => {
        const envelope = itemFieldsEnvelope({
            title: "Item Note Frontmatter",
            shortcode: "itemfrontmatter",
            frontmatter: { description: "The generated per-type field tables.", tags: ["ref"] },
        });
        expect(envelope).toEqual({
            type: "doc",
            subType: "reference",
            shortcode: "itemfrontmatter",
            name: { full: "Item Note Frontmatter" },
            pack: "none",
            description: "The generated per-type field tables.",
            tags: ["ref"],
        });
    });

    it("lets the consumer's frontmatter override a derived key, shortcode included", () => {
        const envelope = itemFieldsEnvelope({
            title: "Item Note Frontmatter",
            shortcode: "itemfrontmatter",
            frontmatter: { shortcode: "itmfrntmtr" },
        });
        expect(envelope.shortcode).toBe("itmfrntmtr");
    });

    it("merges into `name` rather than replacing it wholesale", () => {
        const envelope = itemFieldsEnvelope({
            title: "Item Note Frontmatter",
            shortcode: "itemfrontmatter",
            frontmatter: { name: { aliases: ["Item Frontmatter"] } },
        });
        expect(envelope.name).toEqual({
            full: "Item Note Frontmatter",
            aliases: ["Item Frontmatter"],
        });
    });
});

describe("renderItemFieldsPage", () => {
    const contentRoot = "/repo/assets/content";
    const body = "# Item Note Frontmatter\n\nSome tables.\n";

    it("writes the envelope when the destination is under the content tree", () => {
        const rendered = renderItemFieldsPage(body, {
            title: "Item Note Frontmatter",
            destination: path.join(contentRoot, "item-frontmatter.md"),
            contentRoot,
        });
        const parsed = matter(rendered);
        expect(parsed.data).toEqual({
            type: "doc",
            subType: "reference",
            shortcode: "itemfrontmatter",
            name: { full: "Item Note Frontmatter" },
            pack: "none",
        });
        expect(parsed.content.trim()).toBe(body.trim());
    });

    it("carries the consumer's declared frontmatter into the note", () => {
        const rendered = renderItemFieldsPage(body, {
            title: "Item Note Frontmatter",
            destination: path.join(contentRoot, "item-frontmatter.md"),
            contentRoot,
            frontmatter: { description: "The generated per-type field tables." },
        });
        const parsed = matter(rendered);
        expect(parsed.data.description).toBe("The generated per-type field tables.");
    });

    it("writes the body alone when the destination is outside the content tree", () => {
        const rendered = renderItemFieldsPage(body, {
            title: "Item Note Frontmatter",
            destination: "/repo/docs/item-fields.md",
            contentRoot,
            frontmatter: { description: "Ignored outside the content tree." },
        });
        expect(rendered).toBe(body);
    });

    it("writes a note that is already what Prettier would format it to", async () => {
        // The property that decides whether a consumer can commit this page:
        // `content-build format` (Prettier) and `docs item-fields --check`
        // (this generator) have to agree on one file. Proven by running the
        // generator's own output — envelope and all — through the shared
        // Prettier configuration and comparing, the same proof
        // `formatGenerated` applies before a consumer ever sees the page.
        const destination = path.join(contentRoot, "item-frontmatter.md");
        const rendered = renderItemFieldsPage(page, {
            title: "Item Note Frontmatter",
            destination,
            contentRoot,
        });
        const formatted = await prettier.format(rendered, {
            ...sharedPrettierOptionsFor(destination),
            parser: "markdown",
        });

        expect(formatted).toBe(rendered);
    });
});

describe("`docs.itemFields.frontmatter` in configuration", () => {
    function configWith(itemFields: Record<string, unknown>) {
        return defineConfig({
            rootDir: "/repo",
            contentPackage: "acme",
            foundryPackage: "acme",
            packageKind: "systems",
            stats: { lastModifiedBy: "acmebuilder0000" },
            packs: [{ name: "items", type: "Item" }],
            docs: { itemFields },
        });
    }

    it("accepts a mapping", () => {
        const config = configWith({ frontmatter: { description: "x" } });
        expect(config.docs.itemFields.frontmatter).toEqual({ description: "x" });
    });

    it("refuses a non-mapping", () => {
        expect(() => configWith({ frontmatter: "nope" })).toThrow(
            /`docs\.itemFields\.frontmatter` must be a mapping/,
        );
    });

    it("is absent by default, so `itemFieldsEnvelope` sees `undefined`", () => {
        const config = configWith({});
        expect(config.docs.itemFields.frontmatter).toBeUndefined();
    });

    it("still refuses a key outside the vocabulary, naming the new one", () => {
        expect(() => configWith({ nope: 1 })).toThrow(
            /expected one of: title, out, preamble, frontmatter/,
        );
    });
});
