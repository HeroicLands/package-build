/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * A minified page reads as the page did: only comments and the length of each
 * run of white space change, and where white space is the content it is kept.
 */

import { describe, expect, it } from "vitest";

import { minifyHtml } from "../engine/html-minify.mjs";

describe("a minified page", () => {
    it("cuts each run of white space to one character, a newline where the run held one", () => {
        expect(minifyHtml("  <p>A   long\n\n   line</p>\n\n<p>B</p>")).toBe(
            "<p>A long\nline</p>\n<p>B</p>",
        );
    });

    it("keeps the space between two words in different elements", () => {
        expect(minifyHtml("<em>a</em>   <strong>b</strong>")).toBe("<em>a</em> <strong>b</strong>");
    });

    it("drops comments but a conditional one", () => {
        expect(minifyHtml("<p>a<!-- note -->b</p><!--[if IE]>x<![endif]-->")).toBe(
            "<p>ab</p><!--[if IE]>x<![endif]-->",
        );
    });

    it("keeps preformatted text, scripts, styles and a verse's lines as written", () => {
        const kept = [
            "<pre>  a\n\n  b</pre>",
            "<textarea>  x  </textarea>",
            "<script>if (a  <  b) {\n\n}</script>",
            "<style>p  {  }</style>",
            '<span class="verse-line i1">The   harbor <em>sleeps</em>   below.</span>',
        ];
        for (const html of kept) expect(minifyHtml(html)).toBe(html);
        expect(minifyHtml('<span class="x">a   b</span>')).toBe('<span class="x">a b</span>');
    });

    it("leaves a tag and its attribute values as written", () => {
        const tag = '<a title="two  spaces" href="/x/">x</a>';
        expect(minifyHtml(tag)).toBe(tag);
    });
});
