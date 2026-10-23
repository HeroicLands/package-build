/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { scanVerse, verseStanzas, verseGroups } from "../engine/content-verse.mjs";
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

    it("keeps numbered-part period indentation and original offsets", () => {
        const source = [
            "```verse {cols=3}",
            "  1 ..[hello]{lang=en}",
            "3 [.later]{lang=en}",
            "```",
        ].join("\n");
        expect(scanVerse(source).errors).toEqual([]);
        const row = verseGroups(scanVerse(source).blocks[0], source.split("\n"))[0];
        expect(row.parts[0]).toMatchObject({
            column: 1,
            line: 1,
            sourceColumn: 3,
            textColumn: 5,
            text: "[hello]{lang=en}",
            indent: 2,
            markerStart: 4,
            markerLength: 2,
        });
        expect(row.parts[1]).toMatchObject({
            column: 3,
            text: "[later]{lang=en}",
            indent: 1,
            markerStart: 3,
        });
    });
});
