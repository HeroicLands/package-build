// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { renderAdmonitions, scanAdmonitions } from "../engine/content-admonitions.mjs";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";

describe("inline information boxes", () => {
    const source =
        "Before.\n\n:::info {#route}\n**The road** is open.\n:::\n\n:::warn\nThe ford floods.\n:::\n";

    it("renders labelled boxes on HTML surfaces", () => {
        const { markdown, errors } = renderAdmonitions(source);
        expect(errors).toEqual([]);
        expect(markdown).toContain('id="route"');
        expect(markdown).toContain("sohl-admonition-info");
        expect(markdown).toContain("<strong>The road</strong>");
        expect(markdown).toContain("sohl-admonition-warn");
        expect(renderFoundryMarkdown(source)).toContain("sohl-admonition-warn");
    });

    it("renders colored blocks in print", () => {
        const typst = markdownToTypst(source);
        expect(typst).toContain('fill: rgb("#eef6fb")');
        expect(typst).toContain('fill: rgb("#fff5db")');
        expect(typst).toContain("The ford floods.");
    });

    it("reports malformed blocks at their opening lines", () => {
        expect(scanAdmonitions(":::warn\n").errors[0]).toMatchObject({ line: 1, column: 1 });
        expect(scanAdmonitions(":::info {size=large}\nText\n:::").errors[0].message).toContain(
            "only an id",
        );
        expect(scanAdmonitions(":::info\n:::warn\nText\n:::").errors[0].message).toContain(
            "nested",
        );
    });

    it("leaves examples inside code fences untouched", () => {
        expect(scanAdmonitions("```markdown\n:::warn\ntext\n:::\n```").blocks).toEqual([]);
    });
});
