/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { scanVerse, parseVerse, workShapeFindings } from "../engine/content-verse.mjs";
import { createRenderer } from "../engine/content-render.mjs";
import { blockTokens } from "../engine/markdown-blocks.mjs";
import { pageOpenings } from "../engine/heading-attributes.mjs";
import { verseRegions } from "../engine/verse-regions.mjs";
const div = (body: string, attrs = "") => `::: {.verse ${attrs}}\n${body}\n:::`;
describe("verse div input regions", () => {
    it.each(["\n", "\r\n"])(
        "records parser content offsets inside nested containers with %j endings",
        (newline) => {
            const source = ["- Intro.", "", "  > ::: {.verse}", "  > One/", "  > :::", ""].join(
                newline,
            );
            const region = verseRegions(source)[0];
            expect(region.contentStarts).toEqual([
                source.indexOf(":::"),
                source.indexOf("One/"),
                source.lastIndexOf(":::"),
            ]);
            expect(source.slice(region.from, region.contentStarts[0])).toBe("  > ");
            expect(region.to).toBe(source.length);
        },
    );
    it("accepts both div spellings and keeps source ranges", () => {
        for (const source of [div("One/..Two", "lang=en"), ":::verse {lang=en}\nOne/..Two\n:::"]) {
            const result = scanVerse(source);
            expect(result.errors).toEqual([]);
            expect(result.blocks).toHaveLength(1);
            expect(source.slice(result.blocks[0].bodyStart, result.blocks[0].bodyEnd)).toBe(
                "One/..Two",
            );
            expect(result.blocks[0].model.cantos[0].stanzas[0].lines.map((l) => l.text)).toEqual([
                "One",
                "Two",
            ]);
        }
    });
    it.each(["\n", "\r\n"])("separates whitespace-only stanza lines with %j endings", (newline) => {
        for (const blank of [" ", "  ", "    "]) {
            const body = ["One", blank, "..Two"].join(newline);
            const model = parseVerse(body);
            expect(model.errors).toEqual([]);
            expect(
                model.cantos[0].stanzas.map((stanza) => stanza.lines.map((line) => line.text)),
            ).toEqual([["One"], ["Two"]]);
            const second = model.cantos[0].stanzas[1].lines[0];
            expect(second.level).toBe(2);
            expect(second.from).toBe(body.indexOf("..Two"));
            expect(second.offsets[0]).toBe(body.indexOf("Two"));
            expect(second.to).toBe(body.length);
            const nested = [
                "- Intro.",
                "",
                "  ::: {.verse work=w}",
                "  One",
                `  ${blank}`,
                "  ..Two",
                "  :::",
                "",
                "::: {.verse work=w}",
                "Other",
                "",
                "Last",
                ":::",
            ].join(newline);
            const scanned = scanVerse(nested);
            expect(scanned.errors).toEqual([]);
            expect(workShapeFindings(scanned.blocks)).toEqual([]);
            expect(
                scanned.blocks[0].model.cantos[0].stanzas.map((stanza) =>
                    stanza.lines.map((line) => line.text),
                ),
            ).toEqual([["One"], ["Two"]]);
            expect(
                scanned.blocks[0].bodyStart +
                    scanned.blocks[0].model.cantos[0].stanzas[1].lines[0].offsets[0],
            ).toBe(nested.indexOf("Two"));
            for (const target of ["web", "foundry", "preview"] as const) {
                const html = createRenderer(target).render(div(body));
                expect(html.match(/class="verse-stanza"/g)).toHaveLength(2);
                expect(html).toContain('class="verse-line i2">Two');
            }
        }
    });

    it("keeps CRLF span source positions through logical-line balancing", () => {
        const lf = "[One\ncontinued/..Two]{.direction #cue}";
        const body = lf.replace(/\n/g, "\r\n");
        const model = parseVerse(body);
        const lines = model.cantos[0].stanzas[0].lines;
        expect(lines.map((line) => line.text)).toEqual(
            parseVerse(lf).cantos[0].stanzas[0].lines.map((line) => line.text),
        );
        expect(lines[0].text).toBe("[One continued]{.direction #cue}");
        expect(lines[1].text).toBe("[Two]{.direction }");
        expect(lines[1].offsets[1]).toBe(body.indexOf("Two"));
        expect(lines[1].to).toBe(body.length);
        const source = "::: {.verse}\r\n" + body + "\r\n:::";
        const block = scanVerse(source).blocks[0];
        expect(block.bodyStart + block.model.cantos[0].stanzas[0].lines[1].offsets[1]).toBe(
            source.indexOf("Two"),
        );
    });
    it("keeps block-looking body text opaque", () => {
        const source = div("- One/\n1. Two/\n# Three/\n> Four/\n    Five");
        expect(
            blockTokens(source).filter((t) =>
                [
                    "heading_open",
                    "bullet_list_open",
                    "ordered_list_open",
                    "blockquote_open",
                    "code_block",
                ].includes(t.type),
            ),
        ).toEqual([]);
        expect(pageOpenings(source).size).toBe(0);
        expect(scanVerse(source).blocks[0].model.cantos[0].stanzas[0].lines).toHaveLength(5);
    });
    it("refuses the code fence and protects literal examples", () => {
        expect(scanVerse("```verse\nOne\n```").errors[0].message).toContain(".verse");
        expect(scanVerse("````markdown\n```verse\nOne\n```\n````").errors).toEqual([]);
    });
    it("reads titled anchored cantos without creating a page", () => {
        const source = div('One\n\n--- {.canto #second title="The Choosing"}\n\nTwo');
        const result = scanVerse(source);
        expect(result.errors).toEqual([]);
        expect(result.blocks[0].model.groups.find((g) => g.cantoBreak)).toMatchObject({
            id: "second",
            title: "The Choosing",
        });
        expect(pageOpenings(source).size).toBe(0);
    });
    it("leaves canto-looking inline code and escaped text literal", () => {
        for (const body of [
            "`--- {.canto}`",
            "\\--- {.canto}",
            '[A]{title="--- {.canto}"}',
            "`One\n--- {.canto}\nTwo`",
        ]) {
            expect(parseVerse(body, { inline: true }).errors, body).toEqual([]);
        }
    });
    it("keeps braces inside a quoted canto title", () => {
        const model = parseVerse('One\n\n--- {.canto title="The {Choosing}"}\nTwo');
        expect(model.errors).toEqual([]);
        expect(model.groups.find((group) => group.cantoBreak).title).toBe("The {Choosing}");
    });
    it("locates malformed canto boundaries and refuses authored asterisks", () => {
        expect(parseVerse("One\n--- {.canto}\nTwo").errors[0]).toMatchObject({
            offset: 4,
            message: expect.stringContaining("blank line"),
        });
        expect(parseVerse("One\n\n***\n\nTwo").errors[0].message).toContain("--- {.canto}");
        expect(parseVerse("One\n\n--- {.canto}", {}).errors[0].message).toContain(
            "before and after",
        );
        expect(
            parseVerse("One//--- {.canto}//Two", { inline: true }).errors.length,
        ).toBeGreaterThan(0);
    });
});

describe("verse integration masks", () => {
    it("keeps a nested verse inside its surrounding div", async () => {
        const { scanBlocks, renderBlocks } = await import("../engine/content-blocks.mjs");
        const source =
            ':::secret {title="A song"}\n\n' +
            div("# A literal heading/\n> A literal quote") +
            "\n\n:::";
        expect(scanBlocks(source).errors).toEqual([]);
        expect(scanBlocks(source).blocks).toHaveLength(1);
        expect(renderBlocks(source, "foundry").markdown).toContain('class="verse-line"');
    });
    it("finds work/canto anchors without splitting pages or reading internal captions", async () => {
        const { collectAnchors } = await import("../engine/anchors.mjs");
        const { splitPages } = await import("../engine/journals.mjs");
        const { scanFigures } = await import("../engine/content-figures.mjs");
        const source = div(
            '# Not a page/\n:@ Not a caption\n\n--- {.canto #second title="The Choosing"}\n\nLast',
            " #work",
        );
        expect(scanFigures(source).errors).toEqual([]);
        expect(scanFigures(source).figures).toEqual([]);
        expect(collectAnchors(source).map((a) => a.slug)).toEqual(["work", "second"]);
        expect(splitPages(source)).toHaveLength(1);
    });
    it("keeps body footnote-definition syntax as verse text", async () => {
        const { separateFootnotes } = await import("../engine/content-footnotes.mjs");
        const source = div("[^one]: A line of text/\n# Still verse") + "\n\n[^outside]: Real note.";
        const result = separateFootnotes(source);
        expect(result.markdown).toContain("[^one]: A line of text");
        expect(result.definitions).toBe("[^outside]: Real note.");
    });
    it("infers a captioned verse div as a poem", async () => {
        const { scanFigures } = await import("../engine/content-figures.mjs");
        for (const source of [div("A line"), ":::verse\nA line\n:::"])
            expect(scanFigures(":@ A song.\n\n" + source).figures[0]).toMatchObject({
                kind: "poem",
                label: "Poem 1",
            });
    });
    it("renders inline quotations without block wrappers and refuses logical asterisks", async () => {
        const { renderVerseQuotes, inlineVerseFindings } =
            await import("../engine/content-verse.mjs");
        const source = "Before [One/..Two//Third]{.verse lang=en} after.";
        const out = renderVerseQuotes(source);
        expect(out).toContain("Before <span");
        expect(out).toContain('class="verse-line i2"');
        expect(out).toContain("</span> after.");
        expect(out).not.toContain("<div");
        expect(parseVerse("One//***//Two", { inline: true }).errors[0].message).toContain(
            "--- {.canto}",
        );
        expect(
            inlineVerseFindings(
                { start: 0, text: "One", attrs: [["work", "x"]] },
                "[One]{.verse work=x}",
            )[0].message,
        ).toContain("not an inline");
    });
});
