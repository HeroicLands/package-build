/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * **The renderer is one configuration.** `createRenderer` builds the parser
 * every target reads, so what a target adds is the only thing that separates it
 * from the others. This holds the targets to that: the plugin lists are read
 * from the renderers, the stages are held against the passes they compose, and
 * the preview's two views and the highlighting are exercised on their own.
 */

import { describe, expect, it } from "vitest";

import { renderAlerts } from "../engine/content-alerts.mjs";
import { renderBlocks, renderWithheldSections } from "../engine/content-blocks.mjs";
import { renderFigureBlocks, scanFigures } from "../engine/content-figures.mjs";
import {
    RENDER_TARGETS,
    createRenderer,
    highlightCode,
    inertHtml,
} from "../engine/content-render.mjs";
import { renderSpans } from "../engine/content-spans.mjs";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";
import { renderPreview } from "../engine/site-preview.mjs";

/** Every construct a stage writes, in one body. */
const BODY = [
    "# Heading {#heading}",
    "",
    ":@ A listing. {#listing}",
    "",
    "```js",
    "const lantern = 'lit';",
    "```",
    "",
    "> [!NOTE]",
    "> Mind the step.",
    "",
    ':::secret {title="For the GM"}',
    "The harbor master is a smuggler.",
    ":::",
    "",
    "```verse",
    "First line/",
    "  Second line",
    "```",
    "",
    "A [name]{.name} and a [hidden thing]{.secret}.[^1]",
    "",
    "[^1]: A footnote.",
    "",
].join("\n");

describe("createRenderer", () => {
    it("builds a renderer for each target and refuses any other", () => {
        for (const target of RENDER_TARGETS) expect(createRenderer(target).target).toBe(target);
        expect(() => createRenderer("pdf" as any)).toThrow(/is not a render target/);
    });

    it("installs the shared plugins on every HTML target, in one order", () => {
        const foundry = createRenderer("foundry").plugins;
        const preview = createRenderer("preview").plugins;
        const indexed = createRenderer("preview", { source: false }).plugins;
        const web = createRenderer("web").plugins;
        const shared = [
            "footnotes",
            "definition-lists",
            "dictionary-rows",
            "dictionary-entries",
            "heading-attributes",
            "images",
            "first-use",
        ];
        for (const plugins of [foundry, preview, indexed, web])
            expect(plugins.filter((name) => shared.includes(name))).toEqual(shared);
    });

    it("differs between targets only where a target must", () => {
        const names = (target: string, options = {}) => [
            ...createRenderer(target as any, options).plugins,
        ];
        const without = (list: string[], ...drop: string[]) =>
            list.filter((name) => !drop.includes(name));
        // The website's spans are written as HTML by `prepare`, every heading on
        // a web page carries an id its contents list links to, and its
        // punctuation is typographic.
        expect(without(names("foundry"), "spans")).toEqual(
            without(names("web"), "heading-ids", "typographer"),
        );
        expect(names("web")).toEqual(expect.arrayContaining(["heading-ids", "typographer"]));
        // The preview adds its source rules, and the buffer-only view has no icons.
        expect(without(names("preview"), "preview-source")).toEqual(names("foundry"));
        expect(without(names("foundry"), "icons")).toEqual(
            without(names("preview", { source: true }), "preview-source"),
        );
        // The book reads the tokens its Typst stage walks.
        expect(names("book")).toEqual([
            "footnotes",
            "alerts",
            "spans",
            "verse-inline",
            "script-emphasis",
            "definition-lists",
            "icons",
            "images",
            "first-use",
        ]);
    });

    it("parses the book with HTML off and leaves its output to the Typst stage", () => {
        const book = createRenderer("book");
        expect(book.md.options.html).toBe(false);
        expect(() => book.render("text")).toThrow(/parsed, not rendered/);
        expect(() => book.prepare("text")).toThrow(/parsed, not rendered/);
    });

    it("renders the Foundry target as the passes it composes", () => {
        const foundry = createRenderer("foundry");
        const figured = renderFigureBlocks(BODY, (block: string) => foundry.md.render(block));
        const blocks = renderBlocks(figured.markdown, "foundry");
        expect(foundry.prepare(BODY)).toBe(renderAlerts(blocks.markdown, "foundry").markdown);
        expect(renderFoundryMarkdown(BODY)).toContain('<aside class="alert alert-note">');
    });

    it("prepares the web target as the passes it composes", () => {
        const web = createRenderer("web");
        const figured = renderFigureBlocks(BODY);
        const blocks = renderBlocks(figured.markdown, "web");
        const alerts = renderAlerts(blocks.markdown).markdown;
        expect(web.prepare(BODY)).toBe(renderWithheldSections(renderSpans(alerts).markdown));
    });

    it("renders an inline run through the same parser", () => {
        expect(createRenderer("foundry").renderInline("a *b*")).toBe("a <em>b</em>");
    });
});

describe("highlighted code", () => {
    it("marks a fence's tokens with highlight.js classes on every HTML target", () => {
        const fence = "```js\nconst lantern = 'lit';\n```";
        for (const target of ["foundry", "web", "preview"] as const) {
            const html = createRenderer(target).md.render(fence);
            expect(html, target).toContain('<code class="language-js">');
            expect(html, target).toContain('<span class="hljs-keyword">const</span>');
        }
    });

    it("leaves a fence naming no language, or one highlight.js lacks, as escaped text", () => {
        expect(createRenderer("foundry").md.render("```\n<b>\n```")).toBe(
            "<pre><code>&lt;b&gt;\n</code></pre>\n",
        );
        expect(highlightCode("x", "no-such-language")).toBe("");
        expect(highlightCode("x", "")).toBe("");
    });

    it("returns markup for a language it knows", () => {
        expect(highlightCode("const a = 1;", "js")).toContain("hljs-keyword");
    });
});

describe("inertHtml", () => {
    it("turns an authored tag, comment and declaration into text", () => {
        const text = inertHtml('a <abbr title="t">b</abbr> <!-- c --> <!DOCTYPE x> <?php ?>');
        expect(text).not.toContain("<");
        expect(text.match(//g)).toHaveLength(5);
    });

    it("leaves an autolink, a link destination, a comparison and code as written", () => {
        const text =
            "<https://example.org/a> <me@example.org> [x](<a b.md>) a < b `<i>`\n\n```\n<div>\n```";
        expect(inertHtml(text)).toBe(text);
    });

    it("is read as text by the preview, in both of its views", () => {
        for (const options of [{}, { index: undefined }]) {
            const { html } = renderPreview('A <abbr title="x">tag</abbr>.', {
                infobox: false,
                ...options,
            });
            expect(html).toContain("&lt;abbr title=&quot;x&quot;&gt;tag&lt;/abbr&gt;");
            expect(html).not.toContain("<abbr");
        }
    });
});

describe("the preview's two views", () => {
    it("shows a wikilink, a span and a query as source when the buffer has no index", () => {
        const { html } = renderPreview("[[place-x|X]] [a]{.name}\n\n```sql\nSELECT 1\n```", {
            infobox: false,
        });
        expect(html).toContain('hl-preview-address">place-x');
        expect(html).toContain("hl-preview-span");
        expect(html).toContain('<pre class="hl-preview-fence">');
    });

    it("sets an alert, a block, a verse and a caption as every HTML target does", () => {
        const html = renderPreview(BODY, { infobox: false }).html;
        expect(html).toContain('<aside class="alert alert-note">');
        expect(html).toContain('<details class="secret"><summary>For the GM</summary>');
        expect(html).toContain('<div class="verse">');
        expect(html).toMatch(
            /<div id="listing" class="content-figure content-figure-code">[\s\S]*?<p class="content-figure-label">Code 1: A listing\.<\/p>\s*<\/div>/,
        );
        expect(html).toContain('<section class="footnotes"><h2>Footnotes</h2>');
    });

    it("reads a malformed alert as its source", () => {
        const { html } = renderPreview('> [!NOTE]{onclick="x"}\n> Body', { infobox: false });
        expect(html).not.toContain("<aside");
        expect(html).toContain("<pre>");
    });

    it("numbers the figures it holds once, in order", () => {
        const source = ":@ One {#a}\n\n```js\n1\n```\n\n:@ Two {#b}\n\n```js\n2\n```";
        const { figures } = scanFigures(source);
        const html = createRenderer("foundry").render(source, { figures });
        expect(html).toContain("Code 1: One");
        expect(html).toContain("Code 2: Two");
    });
});

describe("figure numbers", () => {
    const source = ":@ First {#a}\n\n```js\n1\n```\n\n:@ Second {#b}\n\n```js\n2\n```";

    it("takes a caption's label from the numbering it is given, in order", () => {
        const numbers = scanFigures(source).figures.map((figure: any, at: number) => ({
            ...figure,
            label: `Listing ${at + 7}`,
        }));
        const { markdown } = renderFigureBlocks(source, undefined, numbers);
        expect(markdown).toContain("Listing 7: First");
        expect(markdown).toContain("Listing 8: Second");
    });

    it("matches by id when the text holds only some of the figures", () => {
        const all = scanFigures(source).figures.map((figure: any) => ({
            ...figure,
            label: `Listing ${figure.id === "b" ? 9 : 5}`,
        }));
        const second = ":@ Second {#b}\n\n```js\n2\n```";
        expect(renderFigureBlocks(second, undefined, all).markdown).toContain("Listing 9: Second");
    });

    it("numbers the text itself when no numbering is given", () => {
        expect(renderFigureBlocks(source).markdown).toContain("Code 2: Second");
    });
});
