/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import {
    expandVerse,
    expandVerseOrigins,
    sourcePosition,
    scanVerse,
    verseStanzas,
} from "../engine/content-verse.mjs";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";

const fence = (...lines: string[]) => ["```verse {numstep=1}", ...lines, "```"].join("\n");

describe("verse line markers and language runs", () => {
    it("takes indentation from periods in the first span and leaves later periods literal", () => {
        const source = fence(
            "   [..The gate]{lang=en} [..salve]{lang=la}",
            "  Plain [..word]{lang=la}",
        );
        const html = renderFoundryMarkdown(source);
        expect(html).toContain('class="verse-line i2"');
        expect(html).toContain('<span lang="en">The gate</span> <span lang="la">..salve</span>');
        expect(html).toContain('Plain <span lang="la">..word</span>');
        expect(markdownToTypst(source)).toContain("#h(2.5em)");
        expect(html.match(/class="verse-number"/g)).toHaveLength(2);
    });

    it("ignores leading spaces and counts each leading period as a level", () => {
        expect(verseStanzas("   Base\n     .One\n..Two")).toEqual([
            [
                { text: "Base", level: 0 },
                { text: "One", level: 1 },
                { text: "Two", level: 2 },
            ],
        ]);
    });

    it("keeps blank verse groups and gives asterisks a separate unnumbered stanza break", () => {
        const source = fence("One", "", "Two", "***", "Three");
        const html = renderFoundryMarkdown(source);
        expect(html).not.toContain("***");
        expect(html.match(/class="verse-number"/g)).toHaveLength(3);
        expect(html).toContain('class="verse-stanza-break"');
        expect(markdownToTypst(source)).toContain("grid.cell(colspan: 2)[#v(0.5em)]");
    });

    it("reads outside markers before a language-labelled parallel part", () => {
        const source = ["```verse {col1=en}", "..[hello]{lang=en}", "```"].join("\n");
        expect(scanVerse(source).errors).toEqual([]);
        expect(renderFoundryMarkdown(source)).toContain('class="verse-part i2"');
        const { markdown, origins } = expandVerseOrigins(source);
        const lines = markdown.split("\n");
        expect(
            sourcePosition({ line: 2, column: lines[1].indexOf("hello") + 1 }, lines, origins),
        ).toEqual({ line: 2, column: 4 });
    });

    it("locates text after a marker stripped from an inline first span", () => {
        const source = [
            "```verse {lang=en col1=en}",
            "[..hello]{lang=la} and [word]{lang=en}",
            "```",
        ].join("\n");
        const { markdown, origins } = expandVerseOrigins(source);
        const lines = markdown.split("\n");
        expect(
            sourcePosition({ line: 2, column: lines[1].indexOf("hello") + 1 }, lines, origins),
        ).toEqual({ line: 2, column: 4 });
        expect(
            sourcePosition({ line: 2, column: lines[1].indexOf("word") + 1 }, lines, origins),
        ).toEqual({ line: 2, column: 25 });
    });

    it("keeps each parallel part's indentation and nested language switches", () => {
        const source = [
            "```verse {col1=la col2=en:la numstep=1}",
            "[..salve [friend]{lang=en}]{lang=la}",
            "[.hello friend]{lang=en}",
            "",
            "[vale]{lang=la}",
            "[goodbye]{lang=en}",
            "```",
        ].join("\n");
        expect(scanVerse(source).errors).toEqual([]);
        const expanded = expandVerse(source);
        expect(expanded).toContain("[..salve [friend]{lang=en}]{lang=la}");
        const html = renderFoundryMarkdown(source);
        expect(html).toContain('class="verse-part i2"');
        expect(html).toContain('class="verse-part i1"');
        expect(html).toContain('class="verse-part verse-secondary i2"');
        expect(html.match(/class="verse-number"/g)).toHaveLength(2);
        expect(markdownToTypst(source)).toContain("#pad(left: 2.5em)");
    });
});
