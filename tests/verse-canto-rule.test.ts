// SPDX-License-Identifier: GPL-3.0-or-later

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createRenderer } from "../engine/content-render.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";
import { previewStyles } from "../engine/site-preview.mjs";
import { compileEncoding } from "../engine/encoding.mjs";
import { hasClass, rules } from "./helpers/theme-css.ts";

const poem = (attrs = "", title = "") =>
    `::: {.verse ${attrs}}\nword\n\nword\n\n--- {.canto ${title}}\nword\n:::`;

const encoded = compileEncoding(
    {
        language: "vyl",
        font: "script",
        mappings: { word: "WORD" },
        rules: { normalization: "NFC", matching: "longest-first" },
    },
    { name: "letters", codes: { WORD: "字" } },
);
const runs = {
    languages: { vyl: { tag: "art-x-vyl" } },
    faces: new Map([
        [
            "script",
            {
                slug: "script",
                family: "Test",
                class: "hl-script",
                draws: new Set([0x5b57]),
            },
        ],
    ]),
    encodings: new Map([["letters", encoded]]),
};

describe("visible canto boundaries", () => {
    for (const [name, css] of [
        [
            "site",
            fs.readFileSync(new URL("../site-theme/static/css/style.css", import.meta.url), "utf8"),
        ],
        [
            "Foundry",
            fs.readFileSync(new URL("../assets/styles/content-base.css", import.meta.url), "utf8"),
        ],
        ["editor preview", previewStyles()],
    ]) {
        it(`draws a short centered rule in ${name}`, () => {
            const rule = rules(css).find((rule) => hasClass(rule.selector, "verse-canto-break"));
            expect(rule).toBeDefined();
            expect(rule!.body).toMatch(/border-block-start:\s*1px solid currentColor/);
            expect(rule!.body).toMatch(/width:\s*25%/);
            expect(rule!.body).toMatch(/margin:\s*1\.5em auto/);
            expect(rule!.body).not.toMatch(/height:\s*0\.5em/);
        });
    }

    it.each(["foundry", "web", "preview"] as const)(
        "emits a canto boundary but no boundary element for a blank stanza on %s",
        (target) => {
            const html = createRenderer(target).render(poem());
            expect(html.match(/class="verse-stanza"/g)).toHaveLength(3);
            expect(html.match(/class="verse-canto-break"/g)).toHaveLength(1);
            expect(html).not.toContain("verse-stanza-break");
        },
    );

    it.each(["", "work=watch"])("draws a rule between plain or labelled cantos (%s)", (attrs) => {
        const out = markdownToTypst(poem(attrs));
        expect(out.match(/#line\(/g)).toHaveLength(1);
        expect(out).toContain(
            "#v(0.75em)\n#align(center)[#line(length: 25%, stroke: 0.4pt)]\n#v(0.75em)",
        );
    });

    it("keeps one rule, heading and anchor across paired encoded presentations", () => {
        const source = poem("work=watch lang=vyl enc=letters", '#answer title="The Answer"');
        for (const target of ["foundry", "web", "preview"] as const) {
            const html = createRenderer(target).render(source, { runs });
            expect(html).toContain("verse-paired");
            expect(html.match(/class="verse-canto-break"/g)).toHaveLength(1);
            expect(html.match(/class="verse-canto-heading"/g)).toHaveLength(1);
            expect(html.match(/id="answer"/g)).toHaveLength(1);
        }
        const out = markdownToTypst(source, { runs, anchorPrefix: "watch" });
        expect(out).toContain("#grid(columns: (2.5em, 1fr, 1fr)");
        expect(out.match(/#line\(/g)).toHaveLength(1);
        expect(out.match(/#heading\(/g)).toHaveLength(1);
        expect(out).toContain("The Answer");
        expect(out).toContain("<watch--answer>");
        expect(out).not.toContain("--- {.canto");
    });
});
