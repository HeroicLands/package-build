/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, it, expect } from "vitest";
import MarkdownIt from "markdown-it";
import footnotes from "markdown-it-footnote";
import {
    ALERT_TYPES,
    scanAlerts,
    renderAlerts,
    alertMarkdownPlugin,
} from "../engine/content-alerts.mjs";
import { scanBlocks } from "../engine/content-blocks.mjs";
import { scanSpans } from "../engine/content-spans.mjs";
describe("blockquote alerts", () => {
    it.each(["note", "tip", "important", "warning", "caution"])(
        "renders %s with its icon and safe attributes",
        (type) => {
            const source = `> [!${type.toUpperCase()}] {#SomeId .wide lang=en}\n> Body with *emphasis*.`;
            const scanned = scanAlerts(source);
            expect(scanned.errors).toEqual([]);
            expect(scanned.blocks[0]).toMatchObject({
                start: 0,
                end: 1,
                type,
                id: "SomeId",
                body: "Body with *emphasis*.",
            });
            const rendered = renderAlerts(source, "web").markdown;
            expect(rendered).toContain(`class="alert alert-${type} wide" id="someid" lang="en"`);
            expect(rendered).toContain('class="alert-icon"');
            expect(rendered).toContain(ALERT_TYPES[type].title);
            expect(new MarkdownIt({ html: true }).render(rendered)).toContain("<em>emphasis</em>");
            expect(scanSpans(source).spans).toEqual([]);
        },
    );
    it("overrides the heading title safely and renders nested alerts", () => {
        const source =
            '> [!WARNING] {title="Seasonal *closure*"}\n> Watch out.\n>\n> > [!TIP] {#inner}\n> > Take the other road.';
        const result = scanAlerts(source);
        expect(result.errors).toEqual([]);
        expect(result.blocks.map((block) => block.type)).toEqual(["warning", "tip"]);
        expect(result.blocks[0].title).toBe("Seasonal *closure*");
        expect(result.blocks[1].body).toBe("Take the other road.");
        const html = new MarkdownIt({ html: true }).render(renderAlerts(source).markdown);
        expect(html).toContain("Seasonal <em>closure</em>");
        expect(html).toContain("alert-tip");
        expect(html).not.toContain(" title=");
        const escaped = renderAlerts('> [!NOTE] {title="<script>x</script>"}\n> Body').markdown;
        expect(escaped).not.toContain("<script>");
    });
    it("collects spans in alert bodies without reading title attributes", () => {
        const source = '> [!NOTE] {title="[title]{#ignored}"}\n> [body]{#body}';
        expect(scanSpans(source).spans.map((span) => [span.id, span.line, span.column])).toEqual([
            ["body", 2, 3],
        ]);
    });
    it("preserves nested lists, code, continuation paragraphs and note-level footnotes", () => {
        const source =
            "> [!NOTE]\n> First.[^n]\n>\n> - One\n>   - Two\n>\n> ```text\n> [literal]\n> ```\n>\n> Last.\n\n[^n]: Footnote.";
        const rendered = renderAlerts(source).markdown;
        const html = new MarkdownIt({ html: true }).use(footnotes).render(rendered);
        expect(html).toContain("<li>Two</li>");
        expect(html).toContain("footnote-ref");
        expect(html).toContain("[literal]");
        const md = new MarkdownIt().use(footnotes).use(alertMarkdownPlugin);
        const tokens = md.parse(source, {});
        expect(tokens.find((token) => token.type === "blockquote_open")?.meta.alert.type).toBe(
            "note",
        );
        expect(
            tokens
                .filter((token) => token.type === "inline")
                .map((token) => token.content)
                .join(" "),
        ).not.toContain("[!NOTE]");
    });
    it("reports unknown types, invalid attributes and absent bodies with locations", () => {
        expect(scanAlerts("> [!WRONG]\n> Body").errors[0]).toMatchObject({ line: 1, column: 3 });
        expect(scanAlerts('> [!NOTE] {onclick="bad"}\n> Body').errors[0].message).toContain(
            "event handler",
        );
        expect(scanAlerts("> [!TIP] {#id .bad!}\n> Body").errors[0].message).toContain(
            "invalid class",
        );
        expect(scanAlerts("> [!NOTE]").errors[0].message).toContain("body");
        expect(scanAlerts("> [!NOTE").errors[0].message).toContain("brackets");
        expect(scanAlerts("> [!NOTE] {#missing\n> Body").errors[0].message).toContain("braces");
    });
    it("leaves plain blockquotes and literal examples untouched", () => {
        const source = "> Ordinary quote.\n\n```md\n> [!NOTE]\n> Example.\n```";
        expect(scanAlerts(source)).toEqual({ blocks: [], errors: [] });
        expect(renderAlerts(source).markdown).toBe(source);
        expect(scanBlocks(":::info\nBody\n:::").errors[0].message).toContain("no info block");
        expect(scanBlocks(":::warn\nBody\n:::").errors[0].message).toContain("no warn block");
        expect(scanBlocks(":::secret\nBody\n:::").errors).toEqual([]);
    });
});
