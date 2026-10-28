// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileTestEncoding } from "./helpers/encoding.js";
import { markdownToTypst } from "../engine/pdf-render.mjs";
import { createRenderer } from "../engine/content-render.mjs";

const verse = (body: string, attrs = "") => `::: {.verse ${attrs}}\n${body}\n:::`;
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
                draws: new Set([glyph.codePointAt(0)]),
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

describe("encoded verse print layout", () => {
    it("pairs native and Roman logical lines from one original at full weight", () => {
        const out = markdownToTypst(verse("Marendas/..Marendas", "lang=vyl enc=letters"), { runs });
        expect(out).toContain("#set text(dir: ltr)\n#grid(columns: (1fr, 1fr)");
        expect(out).toContain(glyph);
        expect(out).toContain("[Marendas]");
        expect(out).toContain("#h(2.5em)");
        expect(out).not.toContain("luma(45%)");
    });

    it("keeps links and one shared footnote definition in the surrounding environment", () => {
        const out = markdownToTypst(
            `${verse("[Marendas](https://example.org)[^sea]", "lang=vyl enc=letters")}\n\n[^sea]: The sea.`,
            { runs },
        );
        expect(out).toContain('#link("https://example.org")');
        expect(out.match(/#footnote\[The sea\.\]/g)).toHaveLength(1);
        expect(out).not.toContain("[^sea]");
    });

    it("preserves plain direction and speaker hooks in both generated presentations", () => {
        const source = verse("[Marendas]{.speaker}/[Marendas]{.direction}", "lang=vyl enc=letters");
        for (const target of ["foundry", "web"] as const) {
            const html = createRenderer(target).render(source, { runs });
            expect(html.match(/class="speaker(?: [^"]*)?"/g)).toHaveLength(2);
            expect(html.match(/class="direction(?: [^"]*)?"/g)).toHaveLength(2);
            expect(html).toContain(glyph);
            expect(html).not.toContain("emph-rubric");
            expect(html).not.toContain("emph-overline");
        }
        const out = markdownToTypst(source, { runs });
        expect(out.match(/classes: \("speaker"/g)).toHaveLength(2);
        expect(out.match(/classes: \("direction"/g)).toHaveLength(2);
        expect(out).not.toContain("#overline");
        expect(out).not.toContain("fill: book-rubric");
    });

    it("keeps encoded quotations script-only with their links, semantic spans and footnotes", () => {
        const source =
            "Before [[Marendas]{.speaker}/..[Marendas](https://example.org)[^sea]]{.verse lang=vyl enc=letters} after.\n\n[^sea]: The sea.";
        for (const target of ["foundry", "web", "preview"] as const) {
            const html = createRenderer(target).render(source, { runs });
            expect(html).not.toContain("verse-inline");
            expect(html).not.toContain("verse-paired");
            expect(html).toContain("<p>Before <span");
            expect(html).toMatch(/<\/span><sup class="footnote-ref">[\s\S]*?<\/sup> after\.<\/p>/);
            expect(html).toContain('href="https://example.org"');
            expect(html.match(/class="speaker(?: [^"]*)?"/g)).toHaveLength(1);
            expect(html).toContain(glyph);
            expect(html).not.toContain("<div");
            expect(html).not.toContain("verse-label");
        }
        const out = markdownToTypst(source, { runs });
        expect(out).toContain("Before #book-span");
        expect(out).not.toContain("#grid");
        expect(out).not.toContain("#h(");
        expect(out.match(/#footnote\[The sea\.\]/g)).toHaveLength(1);
        expect(out).not.toContain("verse-pair:");
        expect(out).not.toContain("[^sea]");
    });

    it("shows a titled canto and its anchor once across an encoded original", () => {
        const source = verse(
            'Marendas\n\n--- {.canto #return title="Return"}\nMarendas',
            "lang=vyl enc=letters",
        );
        for (const target of ["foundry", "web"] as const) {
            const html = createRenderer(target).render(source, { runs });
            expect(html.match(/id="return"/g)).toHaveLength(1);
            expect(html.match(/>Return</g)).toHaveLength(1);
            expect(html).toContain("verse-canto-heading");
        }
        const out = markdownToTypst(source, { runs, anchorPrefix: "work" });
        expect(out.match(/<work--return>/g)).toHaveLength(1);
        expect(out.match(/#heading\(level: 3[^\n]*\[Return\]/g)).toHaveLength(1);
    });

    it("retains encoded div transport when its body ends with an authored blank line", () => {
        const out = markdownToTypst(verse("Marendas/Marendas\n", "lang=vyl enc=letters"), { runs });
        expect(out).toContain("#grid(columns: (1fr, 1fr)");
        expect(out).toContain(glyph);
        expect(out).toContain("[Marendas]");
        expect(out).not.toContain("verse-pair:");
    });

    it.each(["cols=2", "numstep=1"])(
        "refuses %s with the ordinary unknown-attribute finding",
        (attr) => {
            const findings: { message: string }[] = [];
            markdownToTypst(verse("A line", attr), { findings });
            expect(findings).toContainEqual(
                expect.objectContaining({
                    message: expect.stringContaining("is not a verse attribute"),
                }),
            );
        },
    );

    it("joins ordinary source lines and leaves explicit default encoding in one column", () => {
        const out = markdownToTypst(verse("First\nsecond", "enc=default"));
        expect(out).toContain("First second");
        expect(out).not.toContain("#grid");
    });
});

describe("verse styles shared by journal, preview and site", () => {
    it.each(["assets/styles/content-base.css", "site-theme/static/css/style.css"])(
        "%s aligns the paired presentations without secondary readings",
        (file) => {
            const css = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
            expect(css).toMatch(
                /\.verse-row\s*\{[^}]*direction:\s*ltr;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
            );
            expect(css).toContain(".verse-label");
            expect(css).not.toContain(".verse-secondary");
        },
    );
});
