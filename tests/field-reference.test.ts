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
import prettier from "prettier";

import { renderItemFieldReference } from "../engine/field-reference.mjs";

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
