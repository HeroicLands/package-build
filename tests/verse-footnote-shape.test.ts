/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { parseVerse, scanVerse, renderVerseQuotes } from "../engine/content-verse.mjs";
const footnotes = new Set(["a"]);
describe("footnotes are neutral to verse shape", () => {
    it("attaches marker-only positions without adding lines or stanzas", () => {
        const body = "One/[^a]/Two\n\n[^a]\n\nThree";
        const m = parseVerse(body, { footnotes });
        expect(m.cantos[0].stanzas.map((s) => s.lines.length)).toEqual([2, 1]);
        expect(m.boundaries.filter((b) => b.kind === "line")).toHaveLength(1);
        expect(m.groups.filter((g) => !g.cantoBreak).map((g) => g.label)).toEqual(["1", "2"]);
        expect(m.cantos[0].stanzas[0].lines.map((l) => l.text)).toEqual(["One[^a]", "Two[^a]"]);
        const line = m.cantos[0].stanzas[0].lines[0];
        expect(line.offsets[line.text.indexOf("[^a]")]).toBe(body.indexOf("[^a]"));
    });
    it("preserves leading and entirely marker-only text without shape", () => {
        const start = parseVerse("[^a]//One", { footnotes });
        expect(start.cantos[0].stanzas).toHaveLength(1);
        expect(start.cantos[0].stanzas[0].lines[0].text).toBe("[^a]One");
        const alone = parseVerse("[^a]", { footnotes });
        expect(alone.cantos[0].stanzas).toEqual([]);
        expect(alone.notes[0].text).toBe("[^a]");
    });
    it("uses same-note definitions when comparing work versions", () => {
        const source =
            "::: {.verse work=w}\nOne/[^a]/Two\n\n[^a]\n\nThree\n:::\n\n::: {.verse work=w}\nOther\n\nLast\n:::\n\n[^a]: A note.";
        expect(scanVerse(source).errors).toEqual([]);
    });
    it("keeps unresolved, escaped and code references as literal text", () => {
        for (const body of ["[^missing]", "\\[^a]", "`[^a]`"])
            expect(parseVerse(body, { footnotes }).cantos[0].stanzas[0].lines).toHaveLength(1);
    });
});

describe("verse HTML reference placement", () => {
    it("renders reference-only positions without extra inline layout rows", async () => {
        const { verseMarkdown } = await import("../engine/content-verse.mjs");
        const body = "One/[^a]/Two",
            model = parseVerse(body, { footnotes });
        const html = verseMarkdown(body, { model, inline: true });
        expect(html.match(/class="verse-line"/g)).toHaveLength(2);
        expect(html.match(/\[\^a\]/g)).toHaveLength(1);
    });
    it("keeps a notes-only encoded div outside every native font wrapper", async () => {
        const { renderVerse } = await import("../engine/content-verse.mjs");
        const body = "[^a]",
            model = parseVerse(body, { footnotes });
        const source =
            "::: {.verse .script .hl-script lang=vyl enc=letters}\n" +
            body +
            "\n:::\n\n[^a]: Note.";
        model.notes[0].romanText = model.notes[0].text;
        model.notes[0].text = "";
        const verses = new Map([
            [body, { model, classes: ["script", "hl-script"], attributes: { lang: "art-x-vyl" } }],
        ]);
        const html = renderVerse(source, { verses }).markdown;
        expect(html).toContain('class="verse verse-paired"');
        expect(html).toContain('class="verse-footnotes">[^a]</span>');
        expect(html).not.toContain("hl-script");
        expect(html).not.toContain('class="verse-line"');
    });
    it("leaves an already encoded ordinary span in continuous script flow", () => {
        const source = "Before [字。]{lang=art-x-vyl .script .hl-script}[^a] after.\n\n[^a]: Note.";
        expect(renderVerseQuotes(source)).toBe(source);
    });
});
