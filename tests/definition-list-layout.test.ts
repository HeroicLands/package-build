/* SPDX-License-Identifier: GPL-3.0-or-later */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRenderer } from "../engine/content-render.mjs";
import { groupDictionaryLists } from "../engine/dictionary-html.mjs";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";
import { baseStylesheetSource } from "../engine/base-styles.mjs";
import { rules } from "./helpers/theme-css.ts";

const source = `## Navigation anchor

Short *term*
: A **rich** definition with a note[^one].
: Another definition.

Longer term
: First paragraph.

    Second paragraph.

    - A list item
    - Another item

    Nested
    : Nested definition.

[^one]: A footnote with a link to [the heading](#navigation-anchor).
`;
const temporary: string[] = [];
afterAll(() => {
    for (const dir of temporary) fs.rmSync(dir, { recursive: true, force: true });
});

describe("dictionary definition-list markup", () => {
    it("keeps each Foundry term and all its definitions in semantic rows", () => {
        const html = renderFoundryMarkdown(source);
        expect(html.match(/<dl class="dictionary">/g)).toHaveLength(2);
        expect(html).toMatch(/<div>\s*<dt>Short <em>term<\/em><\/dt><dd>/);
        expect(html).toMatch(/<dd>Another definition\.<\/dd>\s*<\/div>\s*<div>\s*<dt>Longer term/);
        expect(html).toContain("Second paragraph.");
        expect(html).toContain("<ul>");
        expect(html).toContain("Nested definition.");
        expect(html).toContain('class="footnote-ref"');
        expect(html).toContain('class="footnotes"');
        expect(html).not.toMatch(/<\/dt>\s+<dd>/);
    });
    it("groups lists inside footnotes after the shared footnote pass", () => {
        const html = renderFoundryMarkdown(
            "Text[^one].\n\n[^one]: Footnote term\n    : Footnote definition",
        );
        expect(html).toContain('<dl class="dictionary">');
        expect(html).toContain("<dt>Footnote term</dt><dd>Footnote definition");
        expect(html).toContain('class="footnotes"');
    });
    it("keeps definition-list examples literal", () => {
        expect(renderFoundryMarkdown("```md\nTerm\n: Definition\n```")).not.toContain("<dl");
    });
    it("groups the final HTML of a site page without replacing its footnotes", () => {
        const raw = `<dl class="existing" title="a > b"><div><dt>Grouped</dt>\n<dd>Existing row</dd></div></dl>
<!-- literal <dl><dt>Comment</dt><dd>Example</dd></dl> -->
<script>const example = "<dl><dt>Script</dt><dd>Example</dd></dl>";</script>
<pre title="x > y"><code><dl><dt>Raw code</dt><dd>Example</dd></dl></code></pre>
<dl><dt>Outer raw</dt><dd><dl><dt>Inner raw</dt><dd>Nested raw definition</dd></dl></dd></dl>
<dl class="dictionary"><div><dt>Already dictionary</dt>
<dd>
<p>Grouped first paragraph</p><p>Later paragraph</p></dd></div></dl>
<dl class=plain><dt>Unquoted class</dt><dd>Plain</dd></dl>
<dl class=dictionary><div><dt>Unquoted dictionary</dt><dd>Stable</dd></div></dl>

\`\`\`html
<dl><dt>Fenced</dt><dd>Example</dd></dl>
\`\`\`
`;
        const html = groupDictionaryLists(createRenderer("web").render(`${source}\n${raw}`));
        expect(html).toContain('class="footnotes"');
        expect(html).toContain('href="#fn1"');
        expect(html).toMatch(
            /<dl class="dictionary">\s*<div>\s*<dt>Short <em>term<\/em><\/dt><dd>/,
        );
        expect(html).toContain(
            '<dl class="dictionary existing" title="a > b"><div><dt>Grouped</dt><dd>Existing row</dd></div></dl>',
        );
        expect(html).toContain("<!-- literal <dl><dt>Comment</dt><dd>Example</dd></dl> -->");
        expect(html).toContain(
            '<script>const example = "<dl><dt>Script</dt><dd>Example</dd></dl>";</script>',
        );
        expect(html).toContain(
            '<pre title="x > y"><code><dl><dt>Raw code</dt><dd>Example</dd></dl></code></pre>',
        );
        expect(html).not.toContain("<dt>Fenced</dt>");
        expect(html).toContain("Fenced");
        expect(html).not.toMatch(/<\/dt>\s+<dd>Existing row/);
        // The Markdown list and the one nested in it, the raw list and the one
        // nested in it, and the list authored already grouped: five lists, each with
        // its own rows.
        expect(html.match(/<dl class="dictionary">/g)).toHaveLength(5);
        expect(html).not.toContain("dictionary dictionary");
        expect(html).toContain(
            "<dl class=dictionary><div><dt>Unquoted dictionary</dt><dd>Stable</dd></div></dl>",
        );
        expect(html).toContain(
            '<dl class="dictionary plain"><div><dt>Unquoted class</dt><dd>Plain</dd></div></dl>',
        );
        expect(html).toContain("<dt>Already dictionary</dt><dd><p>Grouped first paragraph</p>");
        expect(html).toContain(
            '<dt>Outer raw</dt><dd><dl class="dictionary"><div><dt>Inner raw</dt><dd>Nested raw definition</dd></div></dl></dd></div></dl>',
        );
    });
});

describe("several descriptions under one term", () => {
    const sheets = {
        "the site theme": path.resolve(import.meta.dirname, "../site-theme/static/css/style.css"),
        "the Foundry base stylesheet": baseStylesheetSource(),
    };

    it.each(Object.entries(sheets))(
        "%s sets every description after the first on its own line",
        (_name, file) => {
            const following = rules(fs.readFileSync(file, "utf8")).filter(
                (rule) => /\.dictionary/.test(rule.selector) && /dd\s*\+\s*dd/.test(rule.selector),
            );
            const declared = following.map((rule) => rule.body).join(";");
            expect(following.length).toBeGreaterThan(0);
            expect(declared).toMatch(/display\s*:\s*block/);
            expect(declared).toMatch(/text-indent\s*:\s*0/);
        },
    );

    it("sets each description of the book as its own paragraph", () => {
        const source = markdownToTypst("Term\n: First sense.\n: Second sense.");
        expect(source).toContain("book-definition([Term],[First sense.\n\nSecond sense.])");
    });
});
