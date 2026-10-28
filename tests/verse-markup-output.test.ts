// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { createRenderer } from "../engine/content-render.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";

const versions = [
    "::: {.verse work=watch lang=en}",
    "- The shore/1. The lamp/# The keeper/> The watch",
    "",
    '--- {.canto #choosing title="The Choosing"}',
    "    The tide",
    ":::",
    "",
    ":::verse {work=watch lang=en}",
    "Another telling",
    "",
    '--- {.canto title="The Choice"}',
    "Another ending",
    ":::",
].join("\n");

describe("verse markup on publishing targets", () => {
    it("renders div versions as opaque lines, labels and titled canto headings", () => {
        for (const target of ["foundry", "web", "preview"] as const) {
            const html = createRenderer(target).render(versions);
            expect(html).toContain('class="verse-label">1:1</span>');
            expect(html).toContain('class="verse-label">2:1</span>');
            expect(html).toContain('id="choosing"');
            expect(html).toContain("The Choosing");
            expect(html).toContain("- The shore");
            expect(html).toContain("1. The lamp");
            expect(html).toContain("# The keeper");
            expect(html).toContain("&gt; The watch");
            expect(html).not.toContain("<ul>");
            expect(html).not.toContain("<ol>");
            expect(html).not.toContain("<blockquote>");
            expect(html).not.toContain("<pre>");
        }
    });

    it("keeps inline quotations inside their prose paragraph and shares footnotes", () => {
        const source =
            "Before [The shore/..the lamp[^one]//]{.verse} after.\n\n[^one]: By the sea.";
        for (const target of ["foundry", "web", "preview"] as const) {
            const html = createRenderer(target).render(source);
            expect(html).toContain("<p>Before <span");
            expect(html).toContain("verse-inline");
            expect(html).toContain('class="verse-line i2">the lamp');
            expect(html).toContain("</span> after.</p>");
            expect(html).toContain("footnote-ref");
            expect(html).not.toContain("<div");
            expect(html).not.toContain("verse-label");
        }
    });

    it("emits the same work and inline structure in Typst without interpreting block markers", () => {
        const out = markdownToTypst(versions, { anchorPrefix: "watch" });
        expect(out).toContain("The Choosing");
        expect(out).toContain("<watch--choosing>");
        expect(out).toContain("[1:1]");
        expect(out).toContain("[2:1]");
        expect(out).toContain("\\- The shore");
        expect(out).toContain("\\# The keeper");
        expect(out).not.toContain("#raw");
        const quote = markdownToTypst("Before [The shore/..the lamp]{.verse} after.");
        expect(quote).toContain("#h(2.5em)the lamp");
        expect(quote).toContain("Before ");
        expect(quote).toContain(" after.");
    });
});
