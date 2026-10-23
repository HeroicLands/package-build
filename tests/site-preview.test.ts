/*
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as preview from "../engine/site-preview.mjs";
import { EXPRESSION_HELPERS } from "../engine/markdown-expressions.mjs";
import { ALERT_TYPES } from "../engine/content-alerts.mjs";

const { renderPreview, previewStyles } = preview;
const textOf = (html: string) =>
    html
        .replace(/<[^>]*>/g, "")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
const sourceHtml = (source: string) => renderPreview(source, { infobox: false }).html;

describe("buffer-only preview", () => {
    it("classifies every registered expression helper", () => {
        expect(Object.keys(preview.PREVIEW_HELPERS).sort()).toEqual(
            Object.keys(EXPRESSION_HELPERS).sort(),
        );
    });
    it("imports and renders in an empty project, without loading index or SQL machinery", () => {
        const dir = mkdtempSync(path.join(tmpdir(), "source-preview-"));
        try {
            writeFileSync(path.join(dir, "broken-neighbor.md"), "---\na: [invalid YAML\n---");
            writeFileSync(
                path.join(dir, "package-build.config.yaml"),
                "currentDate: [invalid YAML",
            );
            const entry = new URL("../engine/site-preview.mjs", import.meta.url).href;
            const script = `import {registerHooks} from 'node:module';
                registerHooks({resolve(specifier, context, next) {
                    if (/(?:content-index|metadata-index|sql-tables|@duckdb)/.test(specifier)) throw new Error('forbidden '+specifier);
                    return next(specifier, context);
                }});
                delete process.env.CONTENT_CONFIG;
                const {renderPreview}=await import(${JSON.stringify(entry)});
                const result=renderPreview('# Standalone\\n\\n[[missing-address|Missing]]');
                if(!result.ok || result.findings.length || !result.html.includes('Standalone')) throw new Error(JSON.stringify(result));
                const age=renderPreview(${JSON.stringify('---\ntype: being\ndata:\n  born: "700.1"\n---\nAge: {{data.age}}')});
                if(age.frontmatter.data.age!==20 || !age.html.includes('Age: 20')) throw new Error(JSON.stringify(age));
                console.log('rendered');`;
            expect(
                execFileSync(process.execPath, ["--input-type=module", "-e", script], {
                    cwd: dir,
                    encoding: "utf8",
                }).trim(),
            ).toBe("rendered");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
    it.each([
        '[[place-nowhere#anchor|**A <name> & text**]]{.show title="a}b"}',
        '![[image-missing|Portrait]]{.secret width="20%"}',
        '[**A <span> & name**]{.name data-type="being/npc"}',
        '[[address|label]]{title="one"}{.secret}',
    ])("preserves exact extension source: %s", (source) => {
        const html = sourceHtml(source);
        expect(textOf(html).trim()).toBe(source);
        expect(html).toContain('class="hl-preview-bracket"');
        expect(html).toContain('class="hl-preview-label"');
        expect(html).not.toContain("<strong>");
        expect(html).not.toContain("<name>");
        expect(html).not.toContain("<a ");
    });
    it("leaves ordinary prose following attributes outside the protected token", () => {
        const html = sourceHtml("[[place-x|X]]{.show} **After**.");
        expect(html).toContain("<strong>After</strong>");
        expect(html).toContain('hl-preview-attribute">{.show}</span>');
    });
    it("keeps addresses, anchors, labels and punctuation in their distinct roles", () => {
        const html = sourceHtml("![[place-x#part|Label]]{.show}");
        expect(html).toContain('hl-preview-bracket">![[</span>');
        expect(html).toContain('hl-preview-address">place-x#part</span>');
        expect(html).toContain('hl-preview-bracket">|</span>');
        expect(html).toContain('hl-preview-label">Label</span>');
        expect(html).toContain('hl-preview-bracket">]]</span>');
        expect(html).toContain('hl-preview-attribute">{.show}</span>');
    });
    it.each(["sql", "pagelist"])("keeps the entire %s fence opaque and grey", (name) => {
        const source = `~~~~${name} {#a title="x"}\n  [[x|**X**]] {{sql "unsafe"}} <script>x</script>\n~~~~`;
        const html = sourceHtml(source);
        expect(html).toContain('<pre class="hl-preview-fence"><code>');
        expect(textOf(html).trim()).toBe(source);
        expect(html).not.toContain("hl-preview-address");
        expect(html).not.toContain("hl-preview-dependent");
        expect(html).not.toContain("language-");
    });
    it.each([
        '{{sql "SELECT 1"}}',
        '{{gt (sql "SELECT 1") 0}}',
        '{{eq (words (sql "SELECT 1")) "one"}}',
        '{{and (eq (dateformat "cal" "1.1") "one") true}}',
        '{{ref "place-other#caption" form="full"}}',
        '{{ref "#birth" field="when"}}',
        '{{not (ref "place-other#caption")}}',
        "{{missing.local.value}}",
    ])("preserves the whole dependent expression %s", (source) => {
        const html = sourceHtml(source);
        expect(textOf(html).trim()).toBe(source);
        expect(html.match(/hl-preview-dependent/g)).toHaveLength(1);
    });
    it("evaluates pure helpers and authored values without double escaping", () => {
        const text =
            '---\nname:\n  full: "A & B <C>"\ndata:\n  count: 1200\n---\n{{name.full}}: {{digits data.count}}; {{words 12}}; {{and (gt 3 1) (not false)}}';
        const html = sourceHtml(text);
        expect(textOf(html).trim()).toBe("A & B <C>: 1,200; twelve; true");
        expect(html).not.toContain("<C>");
        expect(html).not.toContain("hl-preview-dependent");
    });
    it("renders local figures, captions and same-note figure references", () => {
        const html = sourceHtml(
            ':@ **Portrait** {#portrait}\n\n![[image-x|X]]\n\n{{ref "#portrait"}}',
        );
        expect(html).toContain('id="portrait"');
        expect(html).toContain("Figure 1: <strong>Portrait</strong>");
        expect(html).toContain('<a href="#portrait">Figure 1</a>');
        expect(html).toContain('hl-preview-address">image-x');
    });
    it("resolves dynamic same-note figure targets from authored frontmatter", () => {
        const html = sourceHtml(
            '---\ndata:\n  figure: "#portrait"\n---\n:@ Portrait {#portrait}\n\n![[image-x|X]]\n\n{{ref data.figure}}',
        );
        expect(html).toContain('<a href="#portrait">Figure 1</a>');
        expect(html).not.toContain("hl-preview-dependent");
    });
    it.each([
        ['figure: "place-other#portrait"', "{{ref data.figure}}"],
        ['figure: "#missing"', "{{ref data.figure}}"],
        ['other: "#portrait"', "{{ref data.figure}}"],
        ['figure: "#portrait"', "{{ref data.toString}}"],
        ['figure: "#portrait"', '{{ref (sql "SELECT target")}}'],
    ])(
        "preserves unresolved dynamic references without evaluating subcalls",
        (field, expression) => {
            const html = sourceHtml(
                `---\ndata:\n  ${field}\n---\n:@ Portrait {#portrait}\n\n![[image-x|X]]\n\n${expression}`,
            );
            expect(html).toContain("hl-preview-dependent");
            expect(textOf(html)).toContain(expression);
        },
    );
    it("resolves dynamic local event facts while keeping date fields as source", () => {
        const html = sourceHtml(
            '---\ndata:\n  target: "#arrival"\n  events:\n    - id: arrival\n      kind: journey\n      when: "300.25"\n---\n{{ref data.target field="kind"}} / {{ref data.target field="when"}}',
        );
        expect(textOf(html).trim()).toBe('journey / {{ref data.target field="when"}}');
    });
    it("evaluates local event facts while leaving dates as green source", () => {
        const html = sourceHtml(
            '---\ndata:\n  events:\n    - id: arrival\n      kind: journey\n      when: "300.25"\n---\n{{ref "#arrival" field="kind"}} / {{ref "#arrival" field="when"}}',
        );
        expect(textOf(html).trim()).toBe('journey / {{ref "#arrival" field="when"}}');
    });
    it("renders Markdown, footnotes, definitions, verse and containers locally", () => {
        const html = sourceHtml(
            '# Heading {#heading}\n\nTerm\n: Definition\n\n:::secret {title="Details"}\nText[^one]\n:::\n\n```verse\nFirst *line*\n.Second\n\nLast\n```\n\n[^one]: A footnote.',
        );
        expect(html).toContain('<h1 id="heading">Heading</h1>');
        expect(html).toContain('<dl class="dictionary">');
        expect(html).toContain('<details class="secret"><summary>Details</summary>');
        expect(html).toContain("footnote-ref");
        expect(html).toContain("A footnote.");
        expect(html).toContain('class="verse"');
        expect(html).toContain("First <em>line</em>");
        expect(html).toContain('class="verse-line i1">Second');
        const verseCss = previewStyles();
        expect(verseCss).toContain(".verse-stanza-break");
        expect(verseCss).toMatch(/padding-inline-start:\s*var\(--verse-indent, 0em\)/);
    });
    it("renders dictionary rows while preserving multiple definitions and rich nested content", () => {
        const html = sourceHtml(
            "**Term**\n: First *definition*.\n: Second definition.\n\nOther\n: A paragraph.\n\n    A second paragraph with a footnote.[^one]\n\n    - A list item\n\n    Nested\n    : Inner definition.\n\n[^one]: Definition footnote.",
        );
        expect(html).toContain('<dl class="dictionary">');
        expect(html).toMatch(
            /<div>\s*<dt><strong>Term<\/strong><\/dt><dd>First <em>definition<\/em>\.<\/dd>\s*<dd>Second definition\.<\/dd>\s*<\/div>/,
        );
        expect(html).toContain("<dt>Other</dt><dd><p>A paragraph.</p>");
        expect(html).toContain("A second paragraph with a footnote.");
        expect(html).toContain("<li>A list item</li>");
        expect(html.match(/<dl class="dictionary">/g)).toHaveLength(2);
        expect(html).toContain("<dt>Nested</dt>");
        expect(html).toContain("Definition footnote.");
    });

    it("scopes dictionary hanging-indent and responsive rules to preview content", () => {
        const css = preview.previewStyles();
        expect(css).toContain(
            ".hl-preview .dictionary { --indent:150px; --gap:.75em; margin:0; display:block; }",
        );
        expect(css).toContain(
            ".hl-preview .dictionary > div { padding-left:var(--indent); text-indent:calc(-1 * var(--indent)); margin-bottom:.5em; }",
        );
        expect(css).toContain(
            ".hl-preview .dictionary > div > dt { display:inline-block; min-width:calc(var(--indent) - var(--gap)); margin-right:var(--gap); font-weight:bold; white-space:nowrap; text-indent:0; text-align:left; }",
        );
        expect(css).toContain(
            ".hl-preview .dictionary > div > dd { display:inline; margin:0; font-weight:normal; }",
        );
        expect(css).toContain(
            "@media (max-width:600px) { .hl-preview .dictionary { --indent:100px; } }",
        );
        expect(css).toContain(
            ".hl-preview .dictionary > div > dd > :is(p, ul, ol, dl, blockquote, pre, table, div) { text-indent:0; }",
        );
        expect(css).toContain(
            ".hl-preview .dictionary > div > dd > p:first-child { display:inline; }",
        );
    });

    it("collects footnotes from verses in the document", () => {
        const html = sourceHtml(
            "> [!TIP]\n> Body\n\n```verse\nVerse[^verse]\n```\n\n[^verse]: Verse note.",
        );
        expect(html).toContain("Verse note.");
        expect(html.match(/class="footnotes"/g)).toHaveLength(1);
    });
    it("preserves wikilink pipes and attribute pipes within table cells", () => {
        const html = sourceHtml(
            '| Link | Value |\n| :--- | ---: |\n| [[place-x|X]]{title="a|b"} | 2 |',
        );
        expect(html).toContain("<table>");
        expect(html.match(/<td\b/g)).toHaveLength(2);
        expect(html).toContain('hl-preview-address">place-x');
        expect(html).toContain('hl-preview-label">X');
        expect(html).toContain('hl-preview-attribute">{title=&quot;a|b&quot;}');
        expect(html).toContain("hl-preview-align-right");
    });
    it.each([
        "[[unfinished|**label**",
        '[Label]{title="unfinished **source**',
        '{{gt (sql "unfinished")',
        "> [!UNKNOWN]\n> Body",
        "```sql\nSELECT 1",
    ])("tolerates incomplete source: %s", (source) => {
        const result = renderPreview(source + "\n\n# Following", { infobox: false });
        expect(result.ok).toBe(true);
        expect(textOf(result.html)).toContain("Following");
        expect(result.html).not.toContain("undefined");
    });
    it("does not evaluate extensions inside inline code or example fences", () => {
        const html = sourceHtml(
            '`[[x|X]] {{words 12}}`\n\n```md\n> [!TIP]\n> {{sql "SELECT 1"}}\n```',
        );
        expect(html).toContain("<code>[[x|X]] {{words 12}}</code>");
        expect(html).not.toContain("hl-preview-address");
        expect(html).not.toContain('class="alert');
        expect(html).not.toContain("hl-preview-dependent");
    });
    it("shows authored infobox fields, green references and the locally computed age", () => {
        const result = renderPreview(
            '---\ntype: being\ndata:\n  born: "300.25"\n  species: lore-species\n  culture: "[[lore-culture|Culture]]"\n  portrait: "![[image-person|Person]]{.show}"\n  seeAlso: [lore-hidden]\n---\nBody',
        );
        expect(result.frontmatter.data.age).toBe(419);
        expect(result.html).toContain("<dt>age</dt><dd>419</dd>");
        expect(result.html).toContain('hl-preview-dependent">lore-species');
        expect(result.html).toContain('hl-preview-dependent">[[lore-culture|Culture]]');
        expect(result.html).toContain('hl-preview-address">image-person');
        expect(result.html).not.toContain("lore-hidden");
        expect(result.html).not.toContain("href=");
        expect(
            renderPreview('---\ntype: being\ndata:\n  born: "300.25"\n  age: 0\n---').frontmatter
                .data.age,
        ).toBe(0);
        expect(
            renderPreview("---\ndata:\n  population: 12\n---\nBody", { infobox: false }).html,
        ).not.toContain("hl-preview-infobox");
    });
    it("omits authored See also and related sections without removing the following section", () => {
        const html = sourceHtml(
            "# Note\n\nBody\n\n## See also\n\n[[hidden|Hidden]]\n\n## Related pages\n\nRelated\n\n## Kept\n\nStill here.",
        );
        expect(html).not.toContain("See also");
        expect(html).not.toContain("Hidden");
        expect(html).not.toContain("Related");
        expect(html).toContain("Still here.");
    });
    it("omits unavailable ages and renders their expressions as empty text", () => {
        const result = renderPreview(
            '---\ntype: being\ndata:\n  born: "unknown"\n---\nAge: {{data.age}}',
            { infobox: false },
        );
        expect(result.frontmatter.data.age).toBe(null);
        expect(textOf(result.html).trim()).toBe("Age:");
    });
    it("marks only secret span content for focusable CSS redaction and keeps block spoilers closed", () => {
        const html = sourceHtml(
            "[Hidden **source**]{.secret} and [Visible]{.name} and [Unrelated]{.secretly}\n\n:::secret {title=Spoiler}\nBlock secret.\n:::",
        );
        expect(html).toContain(
            '<span class="hl-preview-span hl-preview-secret" tabindex="0"><span class="hl-preview-bracket">[</span><span class="hl-preview-secret-content"><span class="hl-preview-label">Hidden <strong>source</strong></span>',
        );
        expect(html.match(/hl-preview-secret(?=[" ])/g)).toHaveLength(1);
        expect(html.match(/tabindex="0"/g)).toHaveLength(1);
        expect(html).toContain('<details class="secret"><summary>Spoiler</summary>');
        expect(html).not.toContain("<details open");
        expect(html).not.toContain("<script");
        expect(html).not.toContain("<button");
        expect(textOf(html)).toContain("[Hidden source]{.secret}");
    });

    it("redacts explicitly secret wikilink and image sources without resolving targets", () => {
        for (const source of [
            "[[hidden#anchor|Secret]]{.secret}",
            "![[image-hidden|Portrait]]{.secret}",
        ]) {
            const html = sourceHtml(source);
            expect(textOf(html).trim()).toBe(source);
            expect(html).toContain('<span class="hl-preview-secret" tabindex="0">');
            expect(html).toContain(
                'class="hl-preview-secret-content"><span class="hl-preview-address">',
            );
            expect(html).not.toContain("<img");
            expect(html).not.toContain("href=");
        }
        expect(sourceHtml("[[visible|Label]]{.secretly}")).not.toContain('tabindex="0"');
    });

    it("closes secret heading spoilers at real section boundaries and preserves anchors and global footnotes", () => {
        const html = sourceHtml(
            "# Visible\n\n## Hidden {#hidden .secret}\nSecret body.[^one]\n\n### Child\nNested body.\n\n```md\n## Not a boundary\n```\n\n## Public\nPublic body.\n\n[^one]: Global footnote.",
        );
        const start = html.indexOf('<details class="secret">');
        const end = html.indexOf("</details>", start);
        expect(start).toBeGreaterThan(html.indexOf("<h1>Visible</h1>"));
        expect(html.slice(start, end)).toContain('<h2 id="hidden">Hidden</h2>');
        expect(html.slice(start, end)).toContain("<h3>Child</h3>");
        expect(html.slice(start, end)).toContain("## Not a boundary");
        expect(end).toBeLessThan(html.indexOf("<h2>Public</h2>"));
        expect(html.indexOf('class="footnotes"')).toBeGreaterThan(end);
        expect(html).toContain("Global footnote.");
        expect(html).not.toContain("<details open");
    });

    it("nests secret subsections while leaving their following peers in the parent section", () => {
        const html = sourceHtml(
            "## Outer {.secret}\nOuter body.\n\n### Inner {.secret}\nInner body.\n\n### After inner\nStill outer.\n\n## Public\nVisible.",
        );
        expect(html.match(/<details class="secret">/g)).toHaveLength(2);
        const innerEnd = html.indexOf("</details>");
        const outerEnd = html.indexOf("</details>", innerEnd + 1);
        expect(innerEnd).toBeLessThan(html.indexOf("<h3>After inner</h3>"));
        expect(outerEnd).toBeGreaterThan(html.indexOf("Still outer."));
        expect(outerEnd).toBeLessThan(html.indexOf("<h2>Public</h2>"));
    });

    it("makes entire spans bold while preserving normal wikilink attribute weight", () => {
        const html = sourceHtml("[Name]{.name} and [[place-x|X]]{.show}");
        expect(html).toContain(
            '<span class="hl-preview-span"><span class="hl-preview-bracket">[</span>',
        );
        expect(html.match(/class="hl-preview-span"/g)).toHaveLength(1);
        const css = previewStyles();
        expect(css).toContain(".hl-preview .hl-preview-span .hl-preview-attribute");
        expect(css).toContain(".hl-preview dt { font-weight:700; }");
        expect(css).toContain(".hl-preview dd { font-weight:400; }");
    });
    it("tolerates unfinished frontmatter collections beside local expressions", () => {
        const result = renderPreview("---\ndata:\n  events:\n    -\n---\n{{words 12}}");
        expect(result.ok).toBe(true);
        expect(result.html).toContain("twelve");
    });
    it("retains malformed frontmatter as visible text and reports it without blocking rendering", () => {
        const result = renderPreview("---\ndata: [invalid\n---\n\n# Body");
        expect(result.ok).toBe(true);
        expect(result.findings).toHaveLength(1);
        expect(result.html).toContain("Body");
    });
});

describe("preview alert boxes", () => {
    it.each(Object.entries(ALERT_TYPES))(
        "renders %s with the registry icon and title in both modes",
        (name, definition) => {
            for (const dark of [false, true]) {
                const html = renderPreview(
                    `> [!${name.toUpperCase()}]\n> Body **text** [[place-x|X]] and {{sql "SELECT 1"}}`,
                    { dark },
                ).html;
                expect(html).toContain(`alert alert-${name}`);
                expect(html).toContain(definition.svg);
                expect(html).toContain(`${definition.title}</header>`);
                expect(html).toContain("Body <strong>text</strong>");
                expect(html).toContain('hl-preview-address">place-x');
                expect(html).toContain("hl-preview-dependent");
                expect(html).toContain(dark ? "hl-preview-dark" : "hl-preview-light");
            }
        },
    );
    it("keeps invalid attributes and unfinished markers visible", () => {
        const source = '> [!NOTE]{onclick="x"}\n> Body';
        const html = sourceHtml(source);
        expect(html).not.toContain('class="alert alert-note"');
        expect(textOf(html).trim()).toBe(source);
    });
    it("supports custom titles with syntax highlighting, nested palettes and fences inside bodies", () => {
        const html = sourceHtml(
            '> [!NOTE]{title="Look [[place-x|X]]"}\n> Outer\n>\n> > [!WARNING]\n> > Inner\n>\n> ```sql\n> SELECT 1\n> ```',
        );
        expect(html).toContain('Look <span class="hl-preview-bracket">[[</span>');
        expect(html).toContain("alert alert-warning");
        expect(html).toContain("hl-preview-fence");
    });
});

const luminance = (hex: string) => {
    const values = hex
        .replace("#", "")
        .match(/../g)!
        .map((c) => parseInt(c, 16) / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
};
const contrast = (a: string, b: string) =>
    (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
describe("explicit preview palettes", () => {
    it.each([
        [
            "light",
            ["#ffffff", "#f6f8fa"],
            ["#24292f", "#0969da", "#6c3fd1", "#1a7f37", "#57606a"],
            [
                ["#0969da", "#f6faff"],
                ["#1a7f37", "#f4fbf5"],
                ["#6c3fd1", "#faf7ff"],
                ["#9a6700", "#fffaf0"],
            ],
        ],
        [
            "dark",
            ["#0d1117", "#161b22"],
            ["#e6edf3", "#58a6ff", "#c4b0ff", "#7ee787", "#8b949e"],
            [
                ["#58a6ff", "#101a28"],
                ["#7ee787", "#102018"],
                ["#c4b0ff", "#1c172a"],
                ["#d29922", "#241d10"],
            ],
        ],
    ])(
        "uses the exact approved %s palette with readable syntax on panels and alerts",
        (mode, backgrounds, foregrounds, alerts) => {
            const css = previewStyles();
            const palette = css.match(
                new RegExp(`\\.hl-preview\\.hl-preview-${mode} \\{([^}]+)\\}`),
            )![1];
            for (const color of [...backgrounds, ...foregrounds, ...alerts.flat()])
                expect(palette).toContain(color);
            for (const background of [...backgrounds, ...alerts.map((colors) => colors[1])]) {
                for (const foreground of foregrounds)
                    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
            }
            for (const [accent, background] of alerts)
                expect(contrast(accent, background)).toBeGreaterThanOrEqual(4.5);
            expect(css).toContain("font-weight:700!important");
            expect(css).toContain("border-left:4px solid var(--hl-accent)");
            expect(css).not.toContain("@media (prefers-color-scheme");
        },
    );
});
