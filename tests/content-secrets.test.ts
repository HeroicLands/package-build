/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { md, renderFoundryMarkdown } from "../engine/helpers.mjs";
import { renderSecretBlocks } from "../engine/content-secrets.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";

describe("secret blocks", () => {
    const source = "Before.\n\n:::secret\n**For the GM:** A hidden clue.\n:::\n\nAfter.\n";

    it("renders Foundry secret sections with formatted prose", () => {
        const html = renderFoundryMarkdown(source);
        expect(html).toMatch(/<section class="secret" id="secret-[^"]+">/);
        expect(html).toContain("<strong>For the GM:</strong> A hidden clue.");
        expect(html).not.toContain(":::secret");
    });

    it("renders expandable web spoilers", () => {
        const result = renderSecretBlocks(source, "web");
        expect(result.errors).toEqual([]);
        expect(result.markdown).toContain("<details><summary>Spoiler</summary>");
        expect(result.markdown).toContain("<strong>For the GM:</strong> A hidden clue.");
        expect(result.markdown).not.toContain(":::secret");
    });

    it("keeps GM text readable and labelled in books", () => {
        const result = renderSecretBlocks(source, "book");
        expect(result.errors).toEqual([]);
        expect(result.markdown).toContain("**GM note**\n\n**For the GM:** A hidden clue.");
        expect(result.markdown).not.toContain(":::secret");
        const typst = markdownToTypst(result.markdown);
        expect(typst).toContain("GM note");
        expect(typst).toContain("A hidden clue.");
    });

    it("leaves examples in code fences alone", () => {
        const source = "```markdown\n:::secret\nexample\n:::\n```\n";
        expect(renderSecretBlocks(source, "web")).toEqual({ markdown: source, errors: [] });
    });

    it("reports the opening line of an unclosed block", () => {
        const result = renderSecretBlocks("Intro\n:::secret\nA clue.\n", "web");
        expect(result.errors).toEqual([
            { line: 2, column: 1, message: expect.stringContaining("closing") },
        ]);
    });

    it("reports a nested opener at its own line", () => {
        const result = renderSecretBlocks(":::secret\nfirst\n:::secret\nsecond\n:::", "web");
        expect(result.errors).toEqual([
            { line: 3, column: 1, message: expect.stringContaining("nested") },
        ]);
    });

    it("does not treat an ordinary markdown render as a secret block", () => {
        expect(md.render("A regular note.")).toContain("<p>A regular note.</p>");
    });
});
