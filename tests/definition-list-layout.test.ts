/* SPDX-License-Identifier: GPL-3.0-or-later */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";

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
    it.each(["first-consumer", "second-consumer"])(
        "groups final Goldmark HTML for %s without replacing its TOC or footnotes",
        (name) => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), `dictionary-${name}-`));
            temporary.push(root);
            fs.mkdirSync(path.join(root, "content"));
            fs.mkdirSync(path.join(root, "layouts"));
            fs.writeFileSync(
                path.join(root, "hugo.toml"),
                `baseURL="https://example.test/${name}/"\ntheme="hugo-theme"\nthemesDir=${JSON.stringify(path.resolve(import.meta.dirname, ".."))}\n[markup.goldmark.renderer]\nunsafe=true\n`,
            );
            // Use the shipped content partial in a small page shell so the assertions
            // inspect Goldmark output independently of unrelated site navigation.
            fs.writeFileSync(
                path.join(root, "layouts/index.html"),
                '{{ .TableOfContents }}<article class="single-body">{{ partial "dictionary-lists.html" .Content }}</article>',
            );
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
            fs.writeFileSync(
                path.join(root, "content/_index.md"),
                `---\ntitle: Dictionary\n---\n\n${source}\n${raw}`,
            );
            const result = spawnSync(
                "hugo",
                ["--source", root, "--destination", path.join(root, "public")],
                { encoding: "utf8" },
            );
            expect(result.status, result.stdout + result.stderr).toBe(0);
            const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
            expect(html).toContain('href="#navigation-anchor"');
            expect(html).toContain('<h2 id="navigation-anchor">');
            expect(html).toContain('class="footnotes"');
            expect(html).toContain('href="#fn:1"');
            expect(html).toMatch(
                /<dl class="dictionary">\s*<div><dt>Short <em>term<\/em><\/dt><dd>/,
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
            // Both the outer and nested Markdown definition lists have independent rows.
            expect(html.match(/<dl class="dictionary">/g)).toHaveLength(4);
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
        },
    );
});
