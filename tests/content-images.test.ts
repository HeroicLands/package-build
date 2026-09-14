/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * An image saying how wide it is and where it sits.
 *
 * The failure these pin is the quiet one: `{.fullwidth}` rendering as an
 * ordinary image looks exactly like a directive that worked, so an unknown
 * value has to be refused, located, and fatal — and it must not be
 * half-honoured either, because a directive that drops only the part it did not
 * understand is the same silent failure in a smaller costume.
 *
 * The other half is what must *not* be touched: an image inside a fence is an
 * example of one, and this module's own documentation is written out of such
 * examples.
 */

import { describe, it, expect } from "vitest";
import MarkdownIt from "markdown-it";

import {
    IMAGE_CLASSES,
    IMAGE_FLOATS,
    checkImages,
    figureClasses,
    imageFigureHtml,
    imagePlugin,
    imageSourceProblem,
    imageSourcesIn,
    imagesIn,
    parseImageDirective,
    renderImageFigures,
} from "../engine/content-images.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";

const render = (markdown: string) =>
    new MarkdownIt({ html: true }).use(imagePlugin()).render(markdown);

describe("the two vocabularies parse and are closed", () => {
    it("reads a width class and a float, together or apart", () => {
        expect(parseImageDirective("{.full-width}")).toEqual({
            classes: ["full-width"],
            float: "",
            problems: [],
        });
        expect(parseImageDirective("{float: top-left}")).toEqual({
            classes: [],
            float: "top-left",
            problems: [],
        });
        expect(parseImageDirective("{.full-width, float: bottom-right}")).toEqual({
            classes: ["full-width"],
            float: "bottom-right",
            problems: [],
        });
    });

    it("takes every float the specification lists", () => {
        for (const value of Object.keys(IMAGE_FLOATS)) {
            expect(parseImageDirective(`{float: ${value}}`).float, value).toBe(value);
        }
    });

    it("refuses a near-miss class rather than reading it as the ordinary width", () => {
        for (const spelling of [".fullwidth", ".full_width", ".fullWidth"]) {
            const { classes, problems } = parseImageDirective(`{${spelling}}`);
            expect(classes, spelling).toEqual([]);
            expect(problems.join(" "), spelling).toContain("is not a width an image has");
        }
    });

    it("refuses a dimension, whatever it is spelled as", () => {
        for (const spelling of ["width=800", "width: 800", "height=12em"]) {
            expect(parseImageDirective(`{${spelling}}`).problems.length, spelling).toBe(1);
        }
    });

    it("refuses a float it does not know", () => {
        expect(parseImageDirective("{float: middle}").problems.join(" ")).toContain(
            "is not a position",
        );
    });

    it("honours nothing at all when one part of a directive is refused", () => {
        // The half-honoured case is the silent failure in a smaller costume: an
        // author who wrote both and got one would have to compare two outputs
        // to notice.
        const { classes, float, problems } = parseImageDirective("{.full-width, float: middle}");
        expect(problems.length).toBe(1);
        expect(classes).toEqual([]);
        expect(float).toBe("");
    });

    it("lets nothing author-supplied through beyond the vocabularies", () => {
        for (const attack of [
            'style="position:fixed"',
            "#anything",
            'onclick="alert(1)"',
            'data-x="1"',
        ]) {
            const parsed = parseImageDirective(`{${attack}}`);
            expect(parsed.problems.length, attack).toBeGreaterThan(0);
            expect(figureClasses(parsed), attack).toBe("note-image");
        }
    });

    it("names a class per vocabulary entry, and one shared class always", () => {
        expect(figureClasses({ classes: ["full-width"], float: "center" })).toBe(
            `note-image ${IMAGE_CLASSES["full-width"].class} ${IMAGE_FLOATS.center.class}`,
        );
        expect(figureClasses()).toBe("note-image");
    });
});

describe("an address is held to a shape", () => {
    it("takes a package-relative path and a full URL", () => {
        expect(imageSourceProblem("images/maps/thalorna.webp")).toBe("");
        expect(imageSourceProblem("https://cdn.example.org/images/x.webp")).toBe("");
        expect(imageSourceProblem("systems/sohl/assets/images/x.webp")).toBe("");
    });

    it("refuses a scheme that is not an image, rather than escaping it", () => {
        expect(imageSourceProblem("javascript:alert(1)")).toContain("is not an address");
        expect(imageSourceProblem("data:image/png;base64,AAAA")).toContain("is not an address");
    });

    it("refuses an address carrying markup characters", () => {
        expect(imageSourceProblem('x.webp" onerror="alert(1)')).toContain("is not an address");
    });
});

describe("an image is found where it is written, and nowhere else", () => {
    it("reads the alt text, the address and the directive", () => {
        expect(imagesIn("![A map](images/m.webp){.full-width}\n")).toMatchObject([
            { alt: "A map", src: "images/m.webp", directive: "{.full-width}", block: true },
        ]);
    });

    it("leaves an image inside a fence alone", () => {
        const body = ["```markdown", "![A map](images/m.webp){.full-width}", "```", ""].join("\n");
        expect(imagesIn(body)).toEqual([]);
        expect(imageSourcesIn(body)).toEqual([]);
    });

    it("knows an image sharing its paragraph from one standing alone", () => {
        expect(imagesIn("See ![A map](images/m.webp) there.\n")[0].block).toBe(false);
        expect(imagesIn("Prose.\n![A map](images/m.webp)\n")[0].block).toBe(false);
        expect(imagesIn("Prose.\n\n![A map](images/m.webp)\n\nMore.\n")[0].block).toBe(true);
    });
});

describe("a refusal is located and fatal", () => {
    const body = ["## Appearance", "", "![A map](images/m.webp){.fullwidth}", ""].join("\n");

    it("names the file, the line and the column of the directive", () => {
        const findings = checkImages(body, "Lore/Map.md", { bodyLine: 7, bodyColumn: 1 });
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            file: "Lore/Map.md",
            line: 9,
            // The brace, not the image: the brace is what the author edits.
            column: 24,
            severity: "error",
        });
    });

    it("is an error, because a warning would publish anyway", () => {
        for (const finding of checkImages(body, "x.md")) expect(finding.severity).toBe("error");
    });

    it("reports an image that shares its paragraph with prose", () => {
        const findings = checkImages("See ![A map](images/m.webp) there.\n", "x.md");
        expect(findings.map((f) => f.message).join(" ")).toContain("shares its paragraph");
    });

    it("reports a title, rather than dropping the words in silence", () => {
        const findings = checkImages('![A map](images/m.webp "The realm")\n', "x.md");
        expect(findings.map((f) => f.message).join(" ")).toContain("is a title on an image");
    });

    it("says nothing about an image written correctly", () => {
        expect(checkImages("![A map](images/m.webp){float: center}\n", "x.md")).toEqual([]);
        expect(checkImages("![A map](images/m.webp)\n", "x.md")).toEqual([]);
    });

    it("says nothing about an image inside a fence", () => {
        const fenced = ["```markdown", "![A map](images/m.webp){.fullwidth}", "```", ""].join("\n");
        expect(checkImages(fenced, "x.md")).toEqual([]);
    });
});

describe("the website is handed markup Hugo renders", () => {
    it("turns a block image into a figure carrying the vocabulary's classes", () => {
        expect(renderImageFigures("![A map](images/m.webp){.full-width, float: top-right}\n")).toBe(
            [
                '<figure class="note-image note-image-full-width note-image-float-top-right">',
                '<img src="images/m.webp" alt="A map">',
                "<figcaption>A map</figcaption>",
                "</figure>",
                "",
            ].join("\n"),
        );
    });

    it("escapes the alt text and the address", () => {
        const out = renderImageFigures('![A "map" & more](images/m.webp)\n');
        expect(out).toContain('alt="A &quot;map&quot; &amp; more"');
        expect(out).not.toContain('alt="A "map"');
    });

    it("leaves a refused directive exactly as written, so the page shows it", () => {
        const body = "![A map](images/m.webp){.fullwidth}\n";
        expect(renderImageFigures(body)).toBe(body);
    });

    it("leaves an image that shares its paragraph as markdown", () => {
        const body = "See ![A map](images/m.webp) there.\n";
        expect(renderImageFigures(body)).toBe(body);
    });
});

describe("a Foundry journal page gets the same figure", () => {
    it("renders the figure as a block rather than inside a paragraph", () => {
        const html = render("![A map](images/m.webp){float: top-left}\n");
        expect(html).toContain('<figure class="note-image note-image-float-top-left">');
        expect(html).not.toContain("<p>");
    });

    it("keeps an inline image an inline image", () => {
        const html = render("See ![A map](images/m.webp) there.\n");
        expect(html).toContain("<p>");
        expect(html).not.toContain("<figure");
    });

    it("leaves the braces on the page when the directive is refused", () => {
        expect(render("![A map](images/m.webp){.fullwidth}\n")).toContain("{.fullwidth}");
    });

    it("hands Foundry the address inside the install", () => {
        // The `img:` rule, read the same way: the first segment of an address
        // says which package owns the file, and Foundry serves it from there.
        const html = new MarkdownIt({ html: true })
            .use(imagePlugin((src) => `modules/thalorna/assets/${src}`))
            .render("![A map](images/m.webp)\n");
        expect(html).toContain('src="modules/thalorna/assets/images/m.webp"');
    });

    it("emits the identical markup the website emits", () => {
        const markdown = "![A map](images/m.webp){.full-width}\n";
        expect(render(markdown).trim()).toBe(renderImageFigures(markdown).trim());
        expect(renderImageFigures(markdown).trim()).toBe(
            imageFigureHtml({ src: "images/m.webp", alt: "A map", classes: ["full-width"] }),
        );
    });
});

describe("the book prints the picture at the measure the class names", () => {
    const images = new Map([["images/m.webp", "assets/images/m.webp"]]);
    const typst = (markdown: string) => markdownToTypst(markdown, { images });

    it("sets an image with no marker as a block one column wide", () => {
        const out = typst("![A map](images/m.webp)\n");
        expect(out).toContain('#image("assets/images/m.webp", width: 100%)');
        expect(out).toContain("#block(width: 100%");
        expect(out).not.toContain("#place(");
    });

    it("spans the page for a full-width image, which a block cannot do", () => {
        expect(typst("![A map](images/m.webp){.full-width}\n")).toContain(
            '#place(top, float: true, scope: "parent"',
        );
    });

    it("floats to the corner the position names, within its column", () => {
        expect(typst("![A map](images/m.webp){float: bottom-right}\n")).toContain(
            '#place(bottom + right, float: true, scope: "column"',
        );
    });

    it("draws the alt text as the caption, since print has no alt attribute", () => {
        expect(typst("![A map](images/m.webp)\n")).toContain("[A map]");
    });

    it("prints the caption alone when no file was staged for the address", () => {
        // `#image` on a path Typst cannot open is a compile error, and one of
        // those is fatal to a whole book at the very end of a long run.
        const out = markdownToTypst("![A map](https://example.org/m.webp)\n");
        expect(out).not.toContain("#image(");
        expect(out).toContain("[A map]");
    });
});
