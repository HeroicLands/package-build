/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The empty-shell check holds to its definition: an element drawn around
 * nothing, or around its own heading, is reported, and an element a reader has
 * something in is not.
 */

import { describe, expect, it } from "vitest";

import { emptyShells } from "./helpers/empty-shells";

const tags = (html: string) => emptyShells(html).map((shell) => `${shell.tag}.${shell.classes}`);

describe("an empty shell", () => {
    it("is an element holding only whitespace", () => {
        expect(tags('<main><p>Text</p><nav class="single-nav">\n  \n</nav></main>')).toEqual([
            "nav.single-nav",
        ]);
    });

    it("is a section holding only its heading", () => {
        expect(tags('<section class="related"><h2>Related</h2></section>')).toEqual([
            "section.related",
        ]);
    });

    it("is a section whose heading carries an id", () => {
        expect(
            tags('<section class="related"><h2 id="related-heading">Related</h2></section>'),
        ).toEqual(["section.related"]);
    });

    it("is a disclosure holding only its summary", () => {
        expect(
            tags('<details class="box"><summary><h2>Profile</h2></summary>\n</details>'),
        ).toEqual(["details.box"]);
    });

    it("is reported once, at the outermost element that holds nothing", () => {
        expect(tags('<aside class="rail"><div class="inner"> </div></aside>')).toEqual([
            "aside.rail",
        ]);
    });

    it("is found beside content", () => {
        expect(tags('<div class="a"><p>Text</p><ul class="b"></ul></div>')).toEqual(["ul.b"]);
    });

    it("is not an element whose text is raw", () => {
        expect(tags("<div><script>var x = '<p></p>';</script><p>Text</p></div>")).toEqual([]);
    });
});

describe("content", () => {
    it("is text, a picture, an icon, a button and a rule", () => {
        for (const inner of [
            "Words",
            '<img src="a.png" alt="">',
            '<i class="fa-solid fa-star"></i>',
            "<button></button>",
            "<hr>",
            '<svg width="1"></svg>',
        ])
            expect(tags(`<div class="x">${inner}</div>`), inner).toEqual([]);
    });

    it("is a first-level heading with text, and an element a script fills", () => {
        expect(tags('<section class="hero"><div><h1>Title</h1></div></section>')).toEqual([]);
        expect(tags('<div class="panel"><div id="search"></div></div>')).toEqual([]);
    });

    it("is a background image", () => {
        expect(
            tags('<section class="hero" style="background-image: url(\'a.webp\');"></section>'),
        ).toEqual([]);
    });

    it("is not text in a hidden element", () => {
        expect(tags('<div class="x"><span hidden>filter</span></div>')).toEqual(["div.x"]);
    });

    it("is a heading's list when the list has items", () => {
        expect(
            tags(
                '<section class="related"><h2>Related</h2><ul><li><a href="/a/">A</a></li></ul></section>',
            ),
        ).toEqual([]);
    });
});

describe("the report", () => {
    it("names the line the shell opens on", () => {
        expect(emptyShells('<main>\n<p>Text</p>\n<ul class="a">\n</ul>\n</main>')).toEqual([
            { tag: "ul", classes: "a", line: 3 },
        ]);
    });
});
