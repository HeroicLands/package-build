// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { createRenderer } from "../engine/content-render.mjs";
import { bookTypstPreamble, markdownToTypst } from "../engine/pdf-render.mjs";

describe("work verse output", () => {
    const source = [
        "```verse {work=shore lang=en}",
        "The shore/..The lamp",
        "",
        "The keeper",
        "```",
        "",
        "```verse {work=shore lang=en}",
        "Another telling",
        "",
        "The watch",
        "```",
    ].join("\n");

    it("shows stanza labels and logical line indentation on every HTML target", () => {
        for (const target of ["foundry", "web", "preview"] as const) {
            const html = createRenderer(target).render(source);
            expect(html).toContain('class="verse-label">1</span>');
            expect(html).toContain('class="verse-label">2</span>');
            expect(html).toContain('class="verse-line i2">The lamp');
        }
    });

    it("sets one label per stanza in the book and preserves logical line breaks", () => {
        const typst = markdownToTypst(source);
        expect(typst.match(/#text\(size: 0\.75em, fill: luma\(45%\)\)\[1\]/g)).toHaveLength(2);
        expect(typst).toContain("#h(2.5em)The lamp");
    });

    it("preserves direction and speaker hooks with plain defaults inside and outside verse", () => {
        const content =
            "[The Captain]{.speaker} [Enter]{.direction}\n\n```verse\n[The Captain]{.speaker}/[Enter]{.direction}\n```";
        for (const target of ["foundry", "web"] as const) {
            const html = createRenderer(target).render(content);
            expect(html.match(/class="speaker"/g)).toHaveLength(2);
            expect(html.match(/class="direction"/g)).toHaveLength(2);
        }
        const typst = markdownToTypst(content);
        expect(typst.match(/classes: \("speaker",\)/g)).toHaveLength(2);
        expect(typst.match(/classes: \("direction",\)/g)).toHaveLength(2);
        const preamble = bookTypstPreamble();
        expect(preamble).toContain("#let book-direction(body) = body");
        expect(preamble).toContain("#let book-speaker(body) = body");
    });
});
