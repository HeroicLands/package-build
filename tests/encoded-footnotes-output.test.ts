// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { createRenderer } from "../engine/content-render.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";
import { scanRuns } from "../engine/content-scripts.mjs";
import { scanVerse } from "../engine/content-verse.mjs";
import { compileTestEncoding } from "./helpers/encoding.js";

const glyph = "\u{F0200}";
const runs = {
    languages: { vyl: { tag: "art-x-vyl" } },
    faces: new Map([
        [
            "script",
            {
                slug: "script",
                family: "Script",
                class: "hl-script",
                direction: "ltr",
                features: [],
                draws: new Set([glyph.codePointAt(0), 0xe010c, 0xe010d]),
            },
        ],
    ]),
    encodings: new Map([
        [
            "letters",
            compileTestEncoding({
                name: "letters",
                rows: [["Marendas", glyph]],
                fonts: ["script"],
            }),
        ],
    ]),
};

describe("encoded footnotes on publishing targets", () => {
    it("keeps footnoted English lines and Roman quotations ordinary", () => {
        for (const body of [
            "::: {.verse lang=en}\nThe shore.[^one]\n:::",
            "Before [The shore.[^one]/..the watch]{.verse lang=en} after.",
        ]) {
            const source = `${body}\n\n[^one]: Note one.`;
            for (const target of ["foundry", "web", "preview"] as const) {
                const html = createRenderer(target).render(source);
                expect(html.match(/class="footnote-ref"/g)).toHaveLength(1);
                expect(html.match(/class="footnote-backref"/g)).toHaveLength(1);
            }
            expect(markdownToTypst(source).match(/#footnote[[(]/g)).toHaveLength(1);
        }
    });

    it("places a div reference at its Roman word once, with one definition and backlink", () => {
        const source =
            "::: {.verse lang=vyl enc=letters}\nMarendas[^one] Marendas\n:::\n\n[^one]: Note one.";
        expect(scanRuns(source, runs).errors).toEqual([]);
        for (const target of ["foundry", "web", "preview"] as const) {
            const html = createRenderer(target).render(source, { runs });
            expect(html.match(/class="footnote-ref"/g)).toHaveLength(1);
            expect(html.match(/class="footnote-backref"/g)).toHaveLength(1);
            expect(html.match(/Note one\./g)).toHaveLength(1);
            const native = html.match(
                /class="verse-native[^\"]*"[^>]*>([\s\S]*?)<\/span><\/span>/,
            )?.[1];
            expect(native).toBeDefined();
            expect(native).not.toContain("footnote-ref");
            expect(html).toMatch(
                /class="verse-roman"[\s\S]*?Marendas<sup class="footnote-ref"[\s\S]*?<\/sup> Marendas/,
            );
        }
        const out = markdownToTypst(source, { runs });
        expect(out.match(/#footnote[[(]/g)).toHaveLength(1);
        expect(out).toMatch(/\[Marendas#footnote\[Note one\.\][\s\S]*? Marendas\]/);
    });

    it("keeps reference-only positions out of work shape and stanza labels", () => {
        const source =
            "::: {.verse work=note lang=en}\nMarendas\n\nMarendas\n:::\n\n::: {.verse work=note lang=vyl enc=letters}\nMarendas\n\n[^one]\n\nMarendas\n:::\n\n[^one]: Note one.";
        expect(scanVerse(source).errors).toEqual([]);
        const html = createRenderer("foundry").render(source, { runs });
        expect(html.match(/class="verse-row"/g)).toHaveLength(2);
        expect(html.match(/class="verse-label">1<\/span>/g)).toHaveLength(2);
        expect(html.match(/class="verse-label">2<\/span>/g)).toHaveLength(2);
        expect(html.match(/class="footnote-ref"/g)).toHaveLength(1);
        const out = markdownToTypst(source, { runs });
        expect(out.match(/#footnote[[(]/g)).toHaveLength(1);
    });

    it("keeps a reference-only body visible once without inventing a verse row", () => {
        const source = "::: {.verse lang=vyl enc=letters}\n[^one]\n:::\n\n[^one]: Note one.";
        const html = createRenderer("foundry").render(source, { runs });
        expect(html.match(/class="footnote-ref"/g)).toHaveLength(1);
        expect(html).not.toContain("verse-row");
        const out = markdownToTypst(source, { runs });
        expect(out.match(/#footnote[[(]/g)).toHaveLength(1);
        expect(out).not.toContain("#grid");
    });

    it.each([
        ["verse", "[Marendas[^one]/Marendas//]{.verse lang=vyl enc=letters}"],
        ["ordinary", "[Marendas[^one]]{lang=vyl enc=letters}"],
    ])(
        "renders an encoded %s span as continuous script with its reference outside the font",
        (_kind, span) => {
            const source = `Before ${span} after.\n\n[^one]: Note one.`;
            expect(scanRuns(source, runs).errors).toEqual([]);
            for (const target of ["foundry", "web", "preview"] as const) {
                const html = createRenderer(target).render(source, { runs });
                expect(html).toContain("<p>Before <span");
                expect(html).toMatch(/<\/span><sup class="footnote-ref"/);
                expect(html.match(/class="footnote-ref"/g)).toHaveLength(1);
                expect(html.match(/class="footnote-backref"/g)).toHaveLength(1);
                expect(html.match(/Note one\./g)).toHaveLength(1);
                expect(html).not.toContain("verse-roman");
                expect(html).not.toContain("verse-paired");
                expect(html).not.toContain("verse-row");
                expect(html).not.toContain("<br");
                expect(html).not.toContain("Marendas");
            }
            const out = markdownToTypst(source, { runs });
            expect(out.match(/#footnote[[(]/g)).toHaveLength(1);
            expect(out).toMatch(/\]#footnote\[Note one\.\]/);
            expect(out).not.toContain("#grid");
            expect(out).not.toContain("#h(");
            expect(out).not.toContain("Marendas");
        },
    );
});
