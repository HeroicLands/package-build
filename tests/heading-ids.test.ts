// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Every heading on a web page carries an id, so the contents list links to it
 * and a reader can link to a section. An authored `{#id}` is kept; any other
 * heading is given the GitHub-style id of its text, numbered when it repeats.
 * The other HTML targets give a heading only the id its author wrote.
 */

import { describe, expect, it } from "vitest";

import { createRenderer } from "../engine/content-render.mjs";
import { headingId } from "../engine/heading-attributes.mjs";

const web = createRenderer("web");

describe("the id a heading is given", () => {
    it("is its text in lower case, spaces as hyphens and punctuation dropped", () => {
        expect(headingId("The Bureau of Order (Téngwou Dao)")).toBe(
            "the-bureau-of-order-téngwou-dao",
        );
        expect(headingId("4. Order—Téngwou Dao—The Supreme Court")).toBe(
            "4-orderténgwou-daothe-supreme-court",
        );
        expect(headingId("The Master's Tale: the Water")).toBe("the-masters-tale-the-water");
        expect(headingId("  snake_case and-hyphen  ")).toBe("snake_case-and-hyphen");
    });

    it("is `heading` for a heading with nothing but punctuation", () => {
        expect(headingId("—?!")).toBe("heading");
    });
});

describe("headings on a web page", () => {
    it("carry the id of their text, and keep an authored one", () => {
        const html = web.render(
            "## A Plain Heading\n\n## Named {#named}\n\n### `Code` and *stress*\n",
        );
        expect(html).toContain('<h2 id="a-plain-heading">A Plain Heading</h2>');
        expect(html).toContain('<h2 id="named">Named</h2>');
        expect(html).toContain(
            '<h3 id="code-and-stress"><code>Code</code> and <em>stress</em></h3>',
        );
    });

    it("are numbered from 1 when their text repeats", () => {
        const html = web.render("## Notes\n\n## Notes\n\n## Notes\n");
        expect([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1])).toEqual([
            "notes",
            "notes-1",
            "notes-2",
        ]);
    });

    it("leave out the markup a heading holds, and the text of a link", () => {
        const html = web.render(
            '## Playing <span class="name">Withrún</span> [here](https://x.invalid)\n',
        );
        expect(html).toContain('id="playing-withrún-here"');
    });

    it("leave the other targets with the authored ids alone", () => {
        for (const target of ["foundry", "preview"] as const) {
            const html = createRenderer(target).render("## A Plain Heading\n");
            expect(html, target).toContain("<h2>A Plain Heading</h2>");
        }
    });
});
