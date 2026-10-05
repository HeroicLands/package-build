/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, it, expect } from "vitest";
import { BLOCK_NAMES, scanBlocks, renderBlocks } from "../engine/content-blocks.mjs";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";
describe("secret blocks and general divs", () => {
    it("keeps secret as the only named fence", () => {
        expect(BLOCK_NAMES).toEqual({ secret: "Secret" });
        for (const name of ["info", "warn", "figure", "poetry", "caution"])
            expect(scanBlocks(`:::${name}\nBody\n:::`).errors[0].message).toContain(
                `no ${name} block`,
            );
    });
    it("renders secret classes, IDs, custom title and attributes on both surfaces", () => {
        const source =
            ':::secret {#mine title="GM *Only*" .wide data-source=survey}\nHidden clue.\n:::';
        const web = renderBlocks(source, "web");
        expect(web.errors).toEqual([]);
        expect(web.markdown).toContain(
            '<details class="secret wide" id="mine" data-source="survey">',
        );
        expect(web.markdown).toContain('<summary class="secret">GM <em>Only</em></summary>');
        const foundry = renderBlocks(source, "foundry").markdown;
        expect(foundry).toContain('<section class="secret wide"');
        expect(foundry).toContain("<strong>GM <em>Only</em></strong>");
    });
    it("generates stable IDs for Foundry secrets and keeps title HTML escaped", () => {
        const html = renderFoundryMarkdown(":::secret\nHidden clue.\n:::");
        expect(html).toMatch(/id="secret-[a-f0-9]{12}"/);
        expect(
            renderBlocks(':::secret {title="</summary><script>x</script>"}\nBody\n:::', "web")
                .markdown,
        ).not.toContain("<script>");
    });
    it("renders arbitrary div attributes without title headers or inline styles", () => {
        const result = renderBlocks('::: {#group .wide title="A title" lang=en}\nBody\n:::', "web");
        expect(result.errors).toEqual([]);
        expect(result.markdown).toContain(
            '<div class="wide" id="group" title="A title" lang="en">',
        );
        expect(result.markdown).not.toContain("<summary");
        expect(result.markdown).not.toContain("style=");
    });
    it("refuses event handlers and keys reserved for identifier and classes", () => {
        for (const prefix of [":::secret", ":::"]) {
            expect(scanBlocks(`${prefix} {onclick="bad"}\nBody\n:::`).errors[0].message).toContain(
                "event handler",
            );
            expect(scanBlocks(`${prefix} {id=x}\nBody\n:::`).errors[0].message).toContain("#id");
            expect(scanBlocks(`${prefix} {class=x}\nBody\n:::`).errors[0].message).toContain(
                ".class",
            );
        }
    });
    it("locates empty, unclosed and malformed blocks", () => {
        expect(scanBlocks(":::secret\n\n:::").errors[0].message).toContain("empty");
        expect(scanBlocks(":::secret\nBody").errors[0]).toMatchObject({ line: 1, column: 1 });
        expect(scanBlocks("::: {.bad!}\nBody\n:::").errors[0].message).toContain("invalid class");
    });
    it("renders good blocks surrounding a malformed one", () => {
        const source =
            ":::secret\nFirst\n:::\n\n:::secret {size}\nBad\n:::\n\n:::secret\nLast\n:::";
        const result = renderBlocks(source, "web");
        expect(result.errors).toHaveLength(1);
        expect(result.markdown.match(/<details/g)).toHaveLength(2);
        expect(result.markdown).toContain(":::secret {size}");
    });
    it("keeps code examples literal", () => {
        const source = "```md\n:::info\nBody\n:::\n```";
        expect(scanBlocks(source).errors).toEqual([]);
        expect(renderBlocks(source, "web").markdown).toBe(source);
    });
    it("refuses page-starting headings in secret and div bodies", () => {
        for (const prefix of [":::secret", "::: {.group}"])
            for (const heading of ["# Heading", "### Heading {#anchored}"])
                expect(scanBlocks(`${prefix}\n${heading}\n:::`).errors[0]).toMatchObject({
                    line: 2,
                    column: 1,
                });
        expect(scanBlocks(":::secret\n## Ordinary heading\nBody\n:::").errors).toEqual([]);
    });
    it("holds a div within a secret and checks headings within it", () => {
        const source = ":::secret\nBefore\n::: {.inner}\nBody\n:::\nAfter\n:::";
        expect(scanBlocks(source).errors).toEqual([]);
        const result = renderBlocks(source, "web").markdown;
        expect(result).toContain('<details class="secret">');
        expect(result).toContain('<div class="inner">');
        expect(result).toContain("After");
        expect(scanBlocks(source.replace("Body", "# Heading")).errors[0]).toMatchObject({
            line: 4,
        });
    });
    it("refuses a secret nested within another secret", () => {
        const errors = scanBlocks(":::secret\nOuter\n:::secret\nInner\n:::\n:::").errors;
        expect(errors[0]).toMatchObject({ line: 3 });
        expect(errors[0].message).toContain("nested secret");
        expect(errors).toHaveLength(1);
    });
    it("keeps the print secret title and its disclosure color", () => {
        const typst = markdownToTypst(':::secret {title="GM Only"}\nHidden clue.\n:::');
        expect(typst).toContain('fill: rgb("#f2eefb")');
        expect(typst).toContain("GM Only");
    });
});
