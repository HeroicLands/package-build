/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, it, expect } from "vitest";
import { scanSpans } from "../engine/content-spans.mjs";
import { scanBlocks } from "../engine/content-blocks.mjs";
import { createRenderer } from "../engine/content-render.mjs";
import { markdownToTypst, createParser } from "../engine/pdf-render.mjs";
import { renderSymbolSpans, symbolImagesIn } from "../engine/content-symbols.mjs";
import { markupFindings } from "../engine/markup-validation.mjs";
import { glyphProblems, cartoucheProblems, typstLength } from "../engine/content-glyphs.mjs";

const resolveSrc = (src: string) => `https://cdn.example.org/pkg/${src}`;

describe("glyph spans", () => {
    it("reads slug, frame and size", () => {
        expect(glyphProblems({ id: "", classes: ["glyph"], values: { slug: "ra" } })).toEqual([]);
        expect(
            glyphProblems({
                id: "",
                classes: ["glyph"],
                values: { slug: "ra", frame: "tablet", size: "block" },
            }),
        ).toEqual([]);
    });

    it("refuses what a glyph cannot mean", () => {
        const problems = (values: Record<string, string>, classes = ["glyph"], id = "") =>
            glyphProblems({ id, classes, values }).join(" | ");
        expect(problems({})).toContain("needs slug");
        expect(problems({ slug: "../x" })).toContain("slug");
        expect(problems({ slug: "ra", frame: "round" })).toContain("tablet");
        expect(problems({ slug: "ra", size: "huge" })).toContain("inline, block");
        expect(problems({ slug: "ra", alt: "Ra" })).toContain("label");
        expect(problems({ slug: "ra", align: "left" })).toContain("not one of");
        expect(problems({ slug: "ra" }, ["glyph", "wide"])).toContain(".wide");
        expect(problems({ slug: "ra" }, ["glyph"], "x")).toContain("#id");
    });

    it("locates a malformed glyph at its own line and column", () => {
        const { errors } = scanSpans("Text\n\nA sign [Ra]{.glyph frame=round slug=ra} here.");
        expect(errors).toEqual([expect.objectContaining({ line: 3, column: 8 })]);
        expect(errors[0].message).toContain("tablet");
    });

    for (const target of ["foundry", "web", "preview"] as const) {
        it(`draws an image on ${target}, the label as its alt text`, () => {
            const renderer = createRenderer(target, { images: { resolveSrc } });
            const html = renderer.render(
                '| Sign |\n| --- |\n| [Sun god]{.glyph slug=ra frame=tablet} |\n\nThe name [Ra]{.glyph slug="ra" size=inline} is one sign, and [ ]{.glyph slug=anubis-jackal}.',
            );
            expect(html).toContain(
                '<span class="glyph glyph-tablet"><img src="https://cdn.example.org/pkg/icons/ra.svg" alt="Sun god" loading="lazy" /></span>',
            );
            expect(html).toContain(
                '<span class="glyph glyph-inline"><img src="https://cdn.example.org/pkg/icons/ra.svg" alt="Ra" loading="lazy" /></span>',
            );
            expect(html).toContain('alt="Anubis Jackal"');
        });
    }

    it("leaves a glyph as source in the buffer-only preview", () => {
        const html = createRenderer("preview", { source: true }).render("[Ra]{.glyph slug=ra}");
        expect(html).not.toContain("<img");
        expect(html).toContain("slug=ra");
    });

    it("leaves a glyph in code alone", () => {
        const html = createRenderer("foundry", { images: { resolveSrc } }).render(
            "`[Ra]{.glyph slug=ra}`\n\n```\n[Ra]{.glyph slug=ra}\n```",
        );
        expect(html).not.toContain("<img");
    });

    it("prints a glyph in the book as an image, or its label when no file is staged", () => {
        const md = createParser(undefined);
        const staged = markdownToTypst("A [Ra]{.glyph slug=ra frame=tablet} sign.", {
            md,
            glyphs: new Map(),
            images: new Map([["icons/ra.svg", "assets/icons/ra.svg"]]),
        });
        expect(staged).toContain('image("assets/icons/ra.svg", height: 1.8em)');
        expect(staged).not.toContain("book-span");
        const missing = markdownToTypst("A [Ra]{.glyph slug=ra} sign.", {
            md,
            glyphs: new Map(),
        });
        expect(missing).toContain("A Ra sign.");
    });

    it("names the pathnames a book has to stage", () => {
        expect(
            symbolImagesIn(
                "A cartouche [Ta]{.cartouche slug=takheperu} and [Ra]{.glyph slug=ra}.\n\n`[x]{.glyph slug=no}`",
            ),
        ).toEqual([
            { src: "icons/ra.svg", locate: "ra" },
            { src: "images/cartouches/takheperu.svg", locate: "takheperu" },
        ]);
    });
});

describe("cartouche spans", () => {
    const ok = "A seal [Au Khelathu]{.cartouche slug=aukhelathu height=10rem align=right} here.";

    it("reads slug, align, height and caption", () => {
        expect(scanSpans(ok).errors).toEqual([]);
        expect(scanSpans('[Ra]{.cartouche slug=ra caption="Sun"}').errors).toEqual([]);
    });

    it("refuses what a cartouche cannot mean, at the span", () => {
        const first = (attrs: string) => scanSpans(`\nA [Ra]{.cartouche ${attrs}} b`).errors[0];
        expect(first("")).toMatchObject({ line: 2, column: 3 });
        expect(first("").message).toContain("needs slug");
        expect(first("slug=ra size=inline").message).toContain("size");
        expect(first("slug=ra alt=Ra").message).toContain("label");
        expect(first("slug=ra align=middle").message).toContain("left, right");
        expect(first("slug=ra height=10vh").message).toContain("height");
        expect(first("slug=ra .wide").message).toContain(".wide");
        expect(first("slug=ra onclick=x").message).toContain("event handler");
    });

    it("is not a block: the fence is an unknown block and draws nothing", () => {
        const fence = ':::cartouche {slug="ra"}\n:::';
        expect(scanBlocks(fence).errors[0].message).toBe(
            "there is no cartouche block; the blocks are secret, div",
        );
        expect(scanBlocks(fence).blocks).toEqual([]);
        const html = createRenderer("foundry", { images: { resolveSrc } }).render(fence);
        expect(html).not.toContain("<figure");
        expect(html).not.toContain("<img");
    });

    for (const target of ["foundry", "web", "preview"] as const) {
        it(`draws a figure inside the sentence on ${target}`, () => {
            const html = createRenderer(target, { images: { resolveSrc } }).render(
                'A seal [Au Khelathu]{.cartouche slug=aukhelathu height=10rem align=right caption="Au <Khelathu>"} stands here.',
            );
            expect(html).toContain(
                'A seal <figure class="cartouche cartouche-right"><img src="https://cdn.example.org/pkg/images/cartouches/aukhelathu.svg" alt="Au Khelathu" loading="lazy" style="height: 10rem; width: auto; max-width: none;" /><figcaption>Au &lt;Khelathu&gt;</figcaption></figure> stands here.',
            );
        });
    }

    it("defaults its alt text to the humanized slug and centres with no align", () => {
        const markdown = createRenderer("foundry").render("[]{.cartouche slug=ta-kheperu}");
        expect(markdown).toContain('<figure class="cartouche">');
        expect(markdown).toContain('alt="Ta Kheperu"');
        expect(markdown).not.toContain("style=");
    });

    it("prints a cartouche in the book at the requested height", () => {
        const md = createParser(undefined);
        const typst = markdownToTypst(ok, {
            md,
            glyphs: new Map(),
            images: new Map([["images/cartouches/aukhelathu.svg", "assets/images/c.svg"]]),
        });
        expect(typst).toContain('#image("assets/images/c.svg", height: 10em)');
        expect(typst).toContain("align(right");
    });

    it("prints a cartouche's label in the book when no file is staged", () => {
        const md = createParser(undefined);
        const typst = markdownToTypst('A [Ra]{.cartouche slug=ra caption="Sun"} b.', {
            md,
            glyphs: new Map(),
        });
        expect(typst).toContain("[Sun]");
        expect(typst).not.toContain("image(");
    });

    it("converts CSS lengths to Typst", () => {
        expect(typstLength("10rem")).toBe("10em");
        expect(typstLength("160px")).toBe("120pt");
        expect(typstLength("2.5cm")).toBe("2.5cm");
        expect(
            cartoucheProblems({
                id: "",
                classes: [],
                values: { slug: "ra", height: "50%" },
            }).join(),
        ).toContain("height");
    });
});

describe("shortcodes", () => {
    it("are a finding at their own line and column", () => {
        const source =
            'Some text.\n\nA sign {{< glyph slug="ra" >}} and\n{{% note %}}\n\n`{{< code >}}`';
        const found = markupFindings(source, "n.md").filter((f) => f.message.includes("shortcode"));
        expect(found.map(({ line, column, severity }) => ({ line, column, severity }))).toEqual([
            { line: 3, column: 8, severity: "error" },
            { line: 4, column: 1, severity: "error" },
        ]);
        expect(found[0].message).toBe(
            "A shortcode is not supported; write `[x]{.glyph}` or `[signs]{.cartouche}`",
        );
    });

    it("do not trouble an expression or a frontmatter value", () => {
        expect(
            markupFindings('---\nname: "{{< x >}}"\n---\n\n{{words 3}}', "n.md").filter((f) =>
                f.message.includes("shortcode"),
            ),
        ).toEqual([]);
    });
});
