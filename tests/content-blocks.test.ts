/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { BLOCK_NAMES, renderBlocks, scanBlocks } from "../engine/content-blocks.mjs";
import { md, renderFoundryMarkdown } from "../engine/helpers.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";

describe("named body blocks", () => {
    it("writes the name, the author's classes, the id and any other attribute", () => {
        const source =
            ':::info {#mine title="Notice" .myclass data-source="survey"}\nThis is a note\n:::\n';
        const { markdown, errors } = renderBlocks(source, "foundry");
        expect(errors).toEqual([]);
        expect(markdown).toContain('class="info myclass"');
        expect(markdown).toContain('id="mine"');
        expect(markdown).toContain('data-source="survey"');
        expect(markdown).toContain("<strong>Notice</strong>:<br/>");
        expect(markdown).toContain("This is a note");
    });

    it("opens as a disclosure on the web, with the name on the summary", () => {
        const source = ':::secret {#mine title="GM Only"}\nThis is for the GM only\n:::\n';
        const { markdown, errors } = renderBlocks(source, "web");
        expect(errors).toEqual([]);
        expect(markdown).toContain('<details class="secret" id="mine">');
        expect(markdown).toContain('<summary class="secret">GM Only</summary>');
        expect(markdown).toContain("This is for the GM only");
        expect(markdown).toContain("</details>");
    });

    it("heads a block with the capitalised name when no title is stated", () => {
        expect(BLOCK_NAMES).toEqual({ info: "Info", secret: "Secret", warn: "Warn" });
        for (const [name, title] of Object.entries(BLOCK_NAMES)) {
            const web = renderBlocks(`:::${name}\nBody.\n:::\n`, "web").markdown;
            expect(web).toContain(`<summary class="${name}">${title}</summary>`);
        }
    });

    it("carries no inline style on either surface", () => {
        const source = ":::warn\nThe ford floods.\n:::\n";
        expect(renderBlocks(source, "foundry").markdown).not.toContain("style=");
        expect(renderBlocks(source, "web").markdown).not.toContain("style=");
    });

    it("gives a secret on the Foundry surface an id derived from its body", () => {
        const html = renderFoundryMarkdown(":::secret\nA hidden clue.\n:::\n");
        expect(html).toMatch(/<section class="secret" id="secret-[0-9a-f]{12}">/);
        expect(html).toContain("<strong>Secret</strong>");
        expect(html).not.toContain(":::secret");
    });

    it("lets a title carry emphasis but not markup of its own", () => {
        const emphasised = renderBlocks(':::info {title="The *Genzet* only"}\nBody.\n:::', "web");
        expect(emphasised.markdown).toContain("The <em>Genzet</em> only");
        const injected = renderBlocks(
            ':::info {title="</summary><script>x</script>"}\nBody.\n:::',
            "web",
        );
        expect(injected.markdown).not.toContain("<script>");
    });

    it("renders each block through one path, differing only in the class", () => {
        const source = ":::info\nOne.\n:::\n\n:::warn\nTwo.\n:::\n\n:::secret\nThree.\n:::\n";
        const { markdown } = renderBlocks(source, "web");
        for (const name of ["info", "warn", "secret"]) {
            expect(markdown).toContain(`<details class="${name}">`);
        }
    });

    it("reports a name that is not a block", () => {
        const { blocks, errors } = scanBlocks(":::caution\nBody.\n:::\n");
        expect(blocks).toEqual([]);
        expect(errors[0]).toMatchObject({ line: 1, column: 1 });
        expect(errors[0].message).toContain("no caution block");
        expect(errors[0].message).toContain("info, secret, warn");
    });

    it("keeps a malformed block from silencing the blocks around it", () => {
        const source =
            ":::info\nFirst.\n:::\n\n:::info {size}\nSecond.\n:::\n\n:::warn\nThird.\n:::\n";
        const { markdown, errors } = renderBlocks(source, "web");
        expect(errors).toHaveLength(1);
        expect(markdown).toContain("First.");
        expect(markdown).toContain("Third.");
        expect(markdown).toContain('<details class="info">');
        expect(markdown).toContain('<details class="warn">');
        // the one that failed is left as the author wrote it, and says so
        expect(markdown).toContain(":::info {size}");
    });

    it("refuses an event handler", () => {
        const { errors } = scanBlocks(':::info {onclick="steal()"}\nBody.\n:::\n');
        expect(errors[0].message).toContain("event handler");
    });

    it("refuses id and class written as keys", () => {
        expect(scanBlocks(':::info {id="x"}\nBody.\n:::\n').errors[0].message).toContain("#id");
        expect(scanBlocks(':::info {class="x"}\nBody.\n:::\n').errors[0].message).toContain(
            ".class",
        );
    });

    it("reports an empty block, a nested opener and an unclosed block", () => {
        expect(scanBlocks(":::info\n\n:::\n").errors[0].message).toContain("empty");
        expect(scanBlocks(":::info\nOne.\n:::warn\nTwo.\n:::\n").errors[0]).toMatchObject({
            line: 3,
        });
        expect(scanBlocks(":::warn\nBody.\n").errors[0]).toMatchObject({ line: 1, column: 1 });
        expect(scanBlocks(":::\n").errors[0].message).toContain("closes no block");
    });

    it("leaves examples inside code fences untouched", () => {
        const source = "```markdown\n:::warn\ntext\n:::\n```";
        expect(scanBlocks(source).blocks).toEqual([]);
        expect(renderBlocks(source, "web").markdown).toBe(source);
    });

    it("prints every block as a coloured Typst block titled by its heading", () => {
        const typst = markdownToTypst(
            ':::info\nOne.\n:::\n\n:::warn\nTwo.\n:::\n\n:::secret {title="GM Only"}\nThree.\n:::\n',
        );
        expect(typst).toContain('fill: rgb("#eef6fb")');
        expect(typst).toContain('fill: rgb("#fff5db")');
        expect(typst).toContain('fill: rgb("#f2eefb")');
        expect(typst).toContain("GM Only");
        expect(typst).toContain("Three.");
    });

    it("does not treat an ordinary markdown render as a block", () => {
        expect(md.render("A regular note.")).toContain("<p>A regular note.</p>");
    });
});
