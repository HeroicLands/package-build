// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * A web page sets typographic punctuation: curly quotes read by the characters
 * either side of them, dashes and an ellipsis for their runs. Code, raw HTML,
 * link destinations and a heading's attributes keep what was written.
 */

import { describe, expect, it } from "vitest";

import { createRenderer } from "../engine/content-render.mjs";

const web = createRenderer("web");
const text = (markdown: string) =>
    web
        .render(markdown, {})
        .replace(/<[^>]+>/g, "")
        .replaceAll("&quot;", '"')
        .trim();

describe("punctuation on a web page", () => {
    it("curls quotes and apostrophes", () => {
        expect(text(`He said "hello" and 'goodbye'. It's the '90s, 'twas fine.`)).toBe(
            "He said “hello” and ‘goodbye’. It’s the ’90s, ’twas fine.",
        );
        expect(text("The Smiths' house; doin' well. O'Brien's dog.")).toBe(
            "The Smiths’ house; doin’ well. O’Brien’s dog.",
        );
    });

    it("sets dashes, an ellipsis and guillemets", () => {
        expect(text("A dash -- and another --- and dots... and <<these>>.")).toBe(
            "A dash – and another — and dots… and «these».",
        );
    });

    it("closes a quotation opened earlier on the page", () => {
        expect(text('"Opening quote never closed.\n\nA 21" monitor.')).toBe(
            "“Opening quote never closed.\nA 21” monitor.",
        );
        expect(text('A 21" monitor.')).toBe('A 21" monitor.');
    });

    it("reads quotes beside emphasis and links", () => {
        expect(text('"*stress*" and "[link](https://x.invalid/it\'s)"')).toBe(
            "“stress” and “link”",
        );
        expect(web.render("[link](https://x.invalid/it's)")).toContain("https://x.invalid/it's");
    });

    it("leaves code, raw HTML and escapes as written", () => {
        expect(text('`"code"` and \\"escaped\\"')).toBe('"code" and "escaped"');
        expect(web.render('<span data-x="a--b">x</span>')).toContain('data-x="a--b"');
    });

    it("leaves a heading's attribute block for the attribute reader", () => {
        expect(web.render('## The Master\'s "Tale" {#tale data-x="a--b"}')).toBe(
            '<h2 id="tale" data-x="a--b">The Master’s “Tale”</h2>\n',
        );
    });

    it("is the web's alone", () => {
        for (const target of ["foundry", "preview"] as const)
            expect(createRenderer(target).render(`It's "here" -- now.`), target).toContain(
                "It's &quot;here&quot; -- now.",
            );
    });
});
