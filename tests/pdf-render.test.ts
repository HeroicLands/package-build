// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, it, expect } from "vitest";

import {
    bookTypstPreamble,
    escapeTypst,
    labelFor,
    markdownToTypst,
    renderBook,
    resolveDanglingLabels,
} from "../engine/pdf-render.mjs";
import { ICON_SIZES, iconHtml } from "../engine/content-icons.mjs";
import { htmlMessage } from "../engine/content-html.mjs";

describe("escapeTypst", () => {
    it("makes Typst's markup characters inert", () => {
        expect(escapeTypst("a #hash, a $dollar, an @at, a [bracket]")).toBe(
            "a \\#hash, a \\$dollar, an \\@at, a \\[bracket\\]",
        );
    });

    it("escapes a list marker at the head of a line and leaves a hyphen alone mid-word", () => {
        // `- 1 dagger` must not become a bullet; `e-mail` must not grow a
        // backslash in the middle of a word.
        expect(escapeTypst("- one")).toBe("\\- one");
        expect(escapeTypst("e-mail")).toBe("e-mail");
    });

    it("leaves the corpus's own punctuation and diacritics untouched", () => {
        // The charset check admits these deliberately; escaping them would put
        // backslashes through 24,000 em dashes.
        expect(escapeTypst("Saṃgha — Fývria, Ādānaśreṇī")).toBe("Saṃgha — Fývria, Ādānaśreṇī");
    });
});

describe("markdownToTypst", () => {
    it("uses each declared icon size on the web and in print", () => {
        const registry = {
            families: { fontawesome: { class: "fa", styles: ["solid"] } },
            defaultFamily: "fontawesome",
            icons: { star: { style: "solid", icon: "star", label: "star" } },
        };
        const glyphs = new Map([["star", { font: "Icon Font", codepoint: 0xf005 }]]);
        const entry = registry.icons.star;

        expect(markdownToTypst(":icon star:", { registry, glyphs })).not.toContain("size:");
        for (const [size, specification] of Object.entries(ICON_SIZES)) {
            expect(iconHtml(entry, { size }, registry)).toContain(specification.class);
            expect(markdownToTypst(`:icon star:{size=${size}}`, { registry, glyphs })).toContain(
                `size: ${specification.scale}em`,
            );
        }
    });

    it("prints inline code containing backticks without breaking Typst delimiters", () => {
        const out = markdownToTypst("The message is `` `key` must be set.``");
        expect(out).toContain('#raw(" `key` must be set.", block: false)');
    });

    it("emits a table whose header repeats across a page break", () => {
        const out = markdownToTypst(["| A | B |", "| - | -: |", "| 1 | 2 |"].join("\n"));
        // `table.header` is what makes a long table legible; a plain first row
        // would vanish after page one of a roster.
        expect(out).toContain("table.header([A], [B])");
        expect(out).toContain("columns: 2");
        expect(out).toContain("align: (left, right)");
    });

    it("spans a table wider than three columns across the page, and sets a narrower one in the column", () => {
        // Past three columns the cells start breaking one word to a line in a
        // column measure. `book-wide` decides between a float and pages of its
        // own by measuring the result, which cannot be done here.
        const wide = markdownToTypst(
            ["| A | B | C | D |", "| - | - | - | - |", "| 1 | 2 | 3 | 4 |"].join("\n"),
        );
        expect(wide).toContain("#book-wide[");
        const narrow = markdownToTypst(
            ["| A | B | C |", "| - | - | - |", "| 1 | 2 | 3 |"].join("\n"),
        );
        expect(narrow).not.toContain("#book-wide[");
    });

    it("nests a list as a call rather than by indentation", () => {
        const out = markdownToTypst(["- one", "- two", "  - deep"].join("\n"));
        expect(out).toContain("#list([one]");
        expect(out).toContain("#list([deep])");
    });

    it("keeps every paragraph of an item inside the item, so the item is one block", () => {
        // A paragraph that escaped the item's content block would set at the
        // margin instead of at the item's text column, which reads as prose
        // interrupting the list rather than as the point continuing.
        const enumerated = markdownToTypst(
            ["1. **Title**:", "", "   Body paragraph.", "", "2. **Two**: tight item."].join("\n"),
        );
        expect(enumerated).toBe(
            "#enum([#strong[Title]:\n\nBody paragraph.], [#strong[Two]: tight item.])",
        );

        const bulleted = markdownToTypst(
            ["- **Title**:", "", "  Body paragraph.", "", "- **Two**: tight item."].join("\n"),
        );
        expect(bulleted).toBe(
            "#list([#strong[Title]:\n\nBody paragraph.], [#strong[Two]: tight item.])",
        );
    });

    it("pads a short table row so later rows do not shift a column left", () => {
        const out = markdownToTypst(["| A | B | C |", "| - | - | - |", "| 1 | 2 |"].join("\n"));
        expect(out).toContain("[1], [2], []");
    });

    it("opens a raw block with more backticks than its content holds", () => {
        const out = markdownToTypst(["````text", "a ``` fence", "````"].join("\n"));
        // Three backticks inside means the fence must be at least four.
        expect(out).toMatch(/````+text/);
    });

    it("sends a link inward when the book prints its destination", () => {
        const out = markdownToTypst("see [it](/sohl/weapongear-dagger/)", {
            links: new Map([["weapongear-dagger", "weapongear-dagger"]]),
        });
        expect(out).toBe("see #link(<weapongear-dagger>)[it]");
    });

    it("leaves a link out when the book does not print its destination", () => {
        // A cross-package link, and a same-package note no clause selected, are
        // both genuinely elsewhere.
        const out = markdownToTypst("see [it](https://example.org/thalorna/place-x/)");
        expect(out).toBe('see #link("https://example.org/thalorna/place-x/")[it]');
    });

    it("strips a heading's `{#slug}` and turns it into a namespaced label", () => {
        const out = markdownToTypst("## Appearance {#appearance}", {
            anchorPrefix: "being-jaslyne",
        });
        // The braces are markup, not prose: a book printing them shows every
        // reader the syntax that makes a link work. A body heading is never
        // printed and never bookmarked, and stays a real heading regardless.
        expect(out).toBe(
            "#heading(level: 2, outlined: false, bookmarked: false)[Appearance] " +
                "<being-jaslyne--appearance>",
        );
        expect(out).not.toContain("{#");
    });

    it("derives a label from the heading text when the author wrote no anchor", () => {
        const out = markdownToTypst("## Notes", { anchorPrefix: "being-jaslyne" });
        expect(out).toBe(
            "#heading(level: 2, outlined: false, bookmarked: false)[Notes] " +
                "<being-jaslyne--notes>",
        );
    });

    it("keeps a derived anchor from colliding with a repeat, or with an authored one", () => {
        const out = markdownToTypst(
            ["## Notes", "", "## Notes", "", "## History {#notes}"].join("\n"),
            { anchorPrefix: "being-jaslyne" },
        );
        expect(out).toContain("<being-jaslyne--notes>");
        expect(out).toContain("<being-jaslyne--notes-2>");
        expect(out).toContain("<being-jaslyne--notes-3>");
    });

    it("points a fragment link at the section rather than at the entry", () => {
        const out = markdownToTypst("see [looks](/sohl/being-jaslyne/#appearance)", {
            links: new Map([["being-jaslyne", "being-jaslyne"]]),
        });
        expect(out).toBe("see #link(<being-jaslyne--appearance>)[looks]");
    });

    it("nests a note's own headings beneath the entry heading the book gave it", () => {
        const out = markdownToTypst("## Description", { headingOffset: 1 });
        expect(out).toBe(
            "#heading(level: 3, outlined: false, bookmarked: false)[Description] <description>",
        );
    });

    it("sets an unknown icon as its own name rather than dropping it", () => {
        // The visible failure `content-icons` was designed to produce.
        const out = markdownToTypst("press :icon nonesuch: now");
        expect(out).toContain(":icon nonesuch:");
    });

    it("sets a named block's title as markdown rather than handing it to Typst", () => {
        // A title is authored prose: `*word*` is emphasis where Typst reads it
        // as bold, a `#` opens a function call, and one unbalanced `]` closes
        // the box and takes the rest of the document with it.
        expect(markdownToTypst(':::info {title="The *Genzet* only"}\nBody.\n:::')).toContain(
            "[i The #emph[Genzet] only]",
        );
        expect(markdownToTypst(':::info {title="Cost #3"}\nBody.\n:::')).toContain("[i Cost \\#3]");
        expect(markdownToTypst(':::warn {title="Cost ]"}\nBody.\n:::')).toContain("[! Cost \\]]");
        expect(markdownToTypst(':::warn {title="@dawn $5"}\nBody.\n:::')).toContain(
            "[! \\@dawn \\$5]",
        );
    });

    it("prints a box inside a GM-only section as a box", () => {
        const out = markdownToTypst(
            [":::secret", "For the GM.", "", ":::info", "The ford floods.", ":::", "", ":::"].join(
                "\n",
            ),
        );
        // Two coloured blocks, the inner one inside the outer: the section is a
        // container for whatever the GM reads, boxes included.
        expect(out).toContain('fill: rgb("#f2eefb")');
        expect(out).toContain('fill: rgb("#eef6fb")');
        expect(out).not.toContain(":::info");
    });

    it("prints each of two figures sharing an id once, and reports the id", () => {
        const findings: { line?: number; severity: string; message: string }[] = [];
        const out = markdownToTypst(
            [
                ":::figure {#a}",
                "| a |",
                "| - |",
                "| 1 |",
                "///",
                "First",
                ":::",
                "",
                ":::figure {#a}",
                "| c |",
                "| - |",
                "| 3 |",
                "///",
                "Second",
                ":::",
            ].join("\n"),
            { findings },
        );
        expect(out).toContain("Table 1: First");
        expect(out).toContain("Table 2: Second");
        expect(out.match(/table\.header\(\[c\]\)/g)).toHaveLength(1);
        expect(out).not.toContain(":::figure");
        expect(out).not.toContain("///");
        expect(findings).toEqual([
            { line: 9, column: 1, severity: "error", message: 'duplicate figure id "a"' },
        ]);
    });

    it("labels a grouped figure once, with one Typst anchor, not once per image", () => {
        // Two images sharing one `///` caption: the label describes the plate,
        // not either picture, so it is drawn once. Drawing it per image would
        // also emit the same Typst label twice, which is a compile error.
        const out = markdownToTypst(
            [
                ":::figure {#plate}",
                "![One](one.webp)",
                "",
                "![Two](two.webp)",
                "///",
                "Two portraits as one plate.",
                ":::",
            ].join("\n"),
            { anchorPrefix: "chapter" },
        );
        expect(out.match(/Figure 1: Two portraits as one plate\./g)).toHaveLength(1);
        expect(out.match(/<chapter--plate>/g)).toHaveLength(1);
    });

    it("draws a captionless figure's number alone, with no colon", () => {
        const out = markdownToTypst([":::figure {#plain}", "![One](one.webp)", ":::"].join("\n"), {
            anchorPrefix: "chapter",
        });
        expect(out).toContain("Figure 1");
        expect(out).not.toContain("Figure 1:");
    });

    it("gives an idless figure no Typst anchor, and two of them do not collide", () => {
        const out = markdownToTypst(
            [
                ":::figure",
                "![One](one.webp)",
                "///",
                "First.",
                ":::",
                "",
                ":::figure",
                "![Two](two.webp)",
                "///",
                "Second.",
                ":::",
            ].join("\n"),
            { anchorPrefix: "chapter" },
        );
        expect(out).toContain("Figure 1: First.");
        expect(out).toContain("Figure 2: Second.");
        expect(out).not.toMatch(/<chapter--[^>]*>/);
    });

    it("draws a `.border` figure inside a hairline box", () => {
        const plain = markdownToTypst(
            [":::figure {#a}", "Prose.", "///", "Caption.", ":::"].join("\n"),
        );
        const bordered = markdownToTypst(
            [":::figure {#a .border}", "Prose.", "///", "Caption.", ":::"].join("\n"),
        );
        expect(bordered).not.toBe(plain);
        expect(bordered).toContain("stroke:");
        expect(bordered).toContain("Prose.");
        expect(bordered).toContain("Prose 1: Caption.");
    });

    it("numbers each of the four kinds independently within one document", () => {
        const out = markdownToTypst(
            [
                ":::figure {#a}",
                "A boxed aside.",
                ":::",
                "",
                ":::figure {#b}",
                "```js",
                "1",
                "```",
                ":::",
                "",
                ":::figure {#c}",
                "| x |",
                "| - |",
                "| 1 |",
                ":::",
                "",
                ":::figure {#d}",
                "![One](one.webp)",
                ":::",
                "",
                ":::figure {#e}",
                "Another boxed aside.",
                ":::",
            ].join("\n"),
        );
        expect(out).toContain("Prose 1");
        expect(out).toContain("Prose 2");
        expect(out).toContain("Code 1");
        expect(out).toContain("Table 1");
        expect(out).toContain("Figure 1");
    });
});

describe("a page link a reader of the book can follow", () => {
    // A page's address is written from the root of the site that serves it,
    // which is right everywhere on the web and nowhere in a PDF: a viewer handed
    // a path has no document to resolve it against.
    const site = "https://www.heroiclands.org/kethira/";

    it("resolves a root-relative page address against the site", () => {
        expect(markdownToTypst("see [it](/kethira/skill-guil/)", { url: site })).toBe(
            'see #link("https://www.heroiclands.org/kethira/skill-guil/")[it]',
        );
    });

    it("keeps a dependency's own package prefix, so it resolves to that package's pages", () => {
        expect(markdownToTypst("see [it](/sohl/skill-guil/)", { url: site })).toBe(
            'see #link("https://www.heroiclands.org/sohl/skill-guil/")[it]',
        );
    });

    it("leaves an address that already names a host exactly as it is", () => {
        const absolute = "https://www.kelestia.com/";
        expect(markdownToTypst(`see [it](${absolute})`, { url: site })).toBe(
            `see #link("${absolute}")[it]`,
        );
    });

    it("leaves the address alone when there is no site to resolve it against", () => {
        expect(markdownToTypst("see [it](/kethira/skill-guil/)")).toBe(
            'see #link("/kethira/skill-guil/")[it]',
        );
    });

    it("sends a link the book prints inward, whatever the site is", () => {
        const out = markdownToTypst("see [it](/kethira/skill-guil/)", {
            url: site,
            links: new Map([["skill-guil", "skill-guil"]]),
        });
        expect(out).toBe("see #link(<skill-guil>)[it]");
    });
});

describe("what the book cannot set", () => {
    /** The findings one body produces, and the Typst it still returns. */
    function render(markdown: string, opts: Record<string, unknown> = {}) {
        const findings: {
            file?: string;
            line?: number;
            column?: number;
            severity: string;
            message: string;
        }[] = [];
        const typst = markdownToTypst(markdown, { findings, file: "note.md", ...opts });
        return { findings, typst };
    }

    it("takes an HTML comment out of the page", () => {
        // The pair a verbatim legal notice needs: the notice carries bare URLs
        // that MD034 would otherwise reject and that may not be rewritten.
        const { findings, typst } = render(
            [
                "<!-- markdownlint-disable MD034 -->",
                "",
                "This is unofficial fan material (https://example.com/).",
                "",
                "<!-- markdownlint-enable MD034 -->",
            ].join("\n"),
        );
        expect(typst).toBe("This is unofficial fan material (https://example.com/).");
        expect(findings).toEqual([]);
    });

    it("takes a comment out from the middle of a line, and from across lines", () => {
        expect(render("A notice <!-- why --> continues.").typst).toBe("A notice  continues.");
        expect(render("<!--\nseveral\nlines\n-->\n\nText.").typst).toBe("Text.");
    });

    it("keeps a comment written inside a fence, where it is an example", () => {
        expect(render("```markdown\n<!-- keep me -->\n```").typst).toContain("<!-- keep me -->");
    });

    it("keeps the lines a comment occupied, so a later finding is at its own line", () => {
        const { findings } = render(["<!--", "two lines", "-->", "", ":::"].join("\n"));
        expect(findings).toEqual([
            {
                file: "note.md",
                line: 5,
                column: 1,
                severity: "error",
                message: "a ::: line closes no block",
            },
        ]);
    });

    it("names a comment that is never closed", () => {
        const { findings } = render("Line one.\n\n<!-- open and never closed");
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ line: 3, column: 1, severity: "error" });
        expect(findings[0].message).toContain("never closed");
    });

    it("refuses an inline image embed the lint already refuses", () => {
        // `lintContentImages` reports this exact shape — an image sharing its
        // paragraph with prose — so the book must refuse it too, rather than
        // typesetting the directive as though it were absent.
        const { findings } = render("A ranger. ![A ranger](ranger.webp) stands watch.");
        expect(findings).toEqual([
            expect.objectContaining({
                file: "note.md",
                severity: "error",
                message: expect.stringContaining("shares its paragraph with other text"),
            }),
        ]);
    });

    it("still typesets a picture that stands alone inside a `:::figure` fence", () => {
        const { findings } = render(
            [":::figure", "![A ranger](ranger.webp)", "///", "A ranger.", ":::"].join("\n"),
        );
        expect(findings).toEqual([]);
    });

    it("reports a `:::` block a front-matter or prose file cannot have scanned for it", () => {
        // Nothing else reads these two: a note's body is scanned by the pass that
        // resolves its links, and a front-matter file is read by this one alone.
        expect(render(":::aside\nBody.\n:::").findings[0]).toMatchObject({
            line: 1,
            severity: "error",
            message: "there is no aside block; the blocks are info, secret, warn, poetry",
        });
        expect(render(":::secret\nhidden").findings[0]).toMatchObject({
            line: 1,
            severity: "error",
            message: "secret block needs a closing ::: line",
        });
        expect(render("Prose.\n\n:::figure {#a}\n///\nOnly\n:::").findings[0]).toMatchObject({
            line: 3,
            severity: "error",
            message: "a figure has no contents",
        });
    });

    it("reads a GM-only section's body for faults the outer scan passes over", () => {
        // There an inner opener is a counted line rather than a block, so an
        // empty box and an attribute that does not parse are only found by
        // reading the body.
        expect(render(":::secret\nouter\n\n:::info\n:::\n\n:::").findings).toEqual([
            {
                file: "note.md",
                line: 4,
                column: 1,
                severity: "error",
                message: "info block is empty",
            },
        ]);
        expect(
            render(":::secret\nouter\n\n:::info {title=}\nBody.\n:::\n\n:::").findings[0],
        ).toMatchObject({ line: 4, message: "title needs a value" });
        // And only where that reading was sound: a body read from a misread
        // outer block says the same mistake over again in other words.
        expect(render(":::secret\nouter\n:::secret\ninner\n:::\n:::").findings).toHaveLength(2);
    });

    it("reports raw HTML in the words the HTML check uses", () => {
        const { findings } = render("A <strong>bold</strong> claim.");
        expect(findings).toHaveLength(2);
        expect(findings[0]).toMatchObject({ line: 1, column: 3, severity: "warning" });
        expect(findings[0].message).toBe(htmlMessage("<strong>"));
    });

    it("reports a wikilink, an embed and an expression that no pass resolved", () => {
        const link = render("See [[lore-harbor|the harbor]].").findings;
        expect(link[0]).toMatchObject({ line: 1, column: 5, severity: "error" });
        expect(link[0].message).toContain("[[lore-harbor|the harbor]]");

        const embed = render("![[image-harbor|Harbor]]{size=medium}").findings;
        expect(embed[0]).toMatchObject({ line: 1, column: 1, severity: "error" });

        const expression = render("{{name.full}} was born then.").findings;
        expect(expression[0]).toMatchObject({ line: 1, column: 1, severity: "error" });
        expect(expression[0].message).toContain("{{name.full}}");
    });

    it("says nothing about those three on a body the passes have been over", () => {
        // Each of them leaves its markup as written when it fails, and has
        // already reported it in its own words; a second finding for one mistake
        // is noise on a build that is already failing.
        expect(
            render("See [[lore-harbor|x]] and {{name.full}}.", { prepared: true }).findings,
        ).toEqual([]);
    });

    it("reports a footnote reference with no definition, and says nothing about one with", () => {
        const { findings, typst } = render("a[^y] only");
        expect(typst).toContain("\\[^y\\]");
        expect(findings[0]).toMatchObject({ line: 1, column: 2, severity: "error" });
        expect(findings[0].message).toContain("[^y]");
        expect(render("a[^x] only\n\n[^x]: note").findings).toEqual([]);
    });

    it("locates a finding in the file rather than in the body it was handed", () => {
        // A note's body starts below its frontmatter, and a line a content table
        // generated is reported at the directive that produced it with no column
        // to point at.
        const { findings } = render("Prose.\n\n:::", { bodyLine: 12 });
        expect(findings[0]).toMatchObject({ line: 14, column: 1 });

        const generated = render("Prose.\n\n:::", {
            bodyLine: 12,
            lineMap: [
                { line: 0, generated: false },
                { line: 1, generated: false },
                { line: 1, generated: true },
            ],
        });
        expect(generated.findings[0]).toEqual({
            file: "note.md",
            line: 13,
            severity: "error",
            message: "a ::: line closes no block",
        });
    });

    it("renders the same Typst for a caller that asks for no findings", () => {
        const body = "A <strong>bold</strong> claim with [[a|link]].";
        expect(markdownToTypst(body)).toBe(markdownToTypst(body, { findings: [] }));
    });
});

describe("labelFor", () => {
    it("keeps a plain anchor and folds what Typst will not take", () => {
        expect(labelFor("being-merrimam")).toBe("being-merrimam");
        expect(labelFor("a b/c")).toBe("a-b-c");
    });
});

describe("resolveDanglingLabels", () => {
    const source = [
        "= Entry <being-x>",
        "== Bit <being-x--bit>",
        "#link(<being-x--bit>)[good]",
        "#link(<being-x--gone>)[section missing]",
        "#link(<nowhere>)[no entry either]",
    ].join("\n");

    it("leaves a reference that resolves", () => {
        expect(resolveDanglingLabels(source)).toContain("#link(<being-x--bit>)[good]");
    });

    it("falls back to the entry when only the section is missing", () => {
        // Typst refuses to compile a dangling reference, so one mistyped anchor
        // would otherwise take a 1,200-page book down at the last step.
        expect(resolveDanglingLabels(source)).toContain("#link(<being-x>)[section missing]");
    });

    it("degrades to plain text when there is no entry to fall back to", () => {
        expect(resolveDanglingLabels(source)).toContain("#box[no entry either]");
    });

    it("reports every downgrade rather than making it silently", () => {
        const findings: { severity: string; message: string }[] = [];
        resolveDanglingLabels(source, findings);
        expect(findings).toHaveLength(2);
        expect(findings.every((f) => f.severity === "warning")).toBe(true);
    });
});

describe("renderBook", () => {
    const plan = {
        entries: [
            { kind: "section", title: "Gear", depth: 1, anchor: "gear", trail: ["Gear"] },
            {
                kind: "note",
                depth: 1,
                anchor: "weapongear-dagger",
                trail: ["Gear"],
                record: { name: { full: "Dagger" } },
            },
        ],
        links: new Map(),
        stats: {},
    };

    it("gives every entry a heading, so the PDF bookmarks panel is built for free", () => {
        const out = renderBook({ plan, title: "A Book", bodies: new Map() });
        expect(out).toContain("#heading(level: 1, outlined: true, bookmarked: true)[Gear] <gear>");
        expect(out).toContain(
            "#heading(level: 2, outlined: false, bookmarked: true)[Dagger] <weapongear-dagger>",
        );
    });

    it("opens on a table of contents with no depth limit, since headings decide it", () => {
        // 2,500 entries in the front matter would be forty pages of contents
        // before the book starts; `outlined: false` on every note leaf is what
        // keeps them off it, not a depth cutoff.
        const out = renderBook({ plan, title: "A Book" });
        expect(out).toContain("#outline(title: [Contents])");
        expect(out).not.toMatch(/#outline\([^)]*depth/);
    });

    it("excepts a list item's paragraphs from the body first-line indent", () => {
        // The indent separates one paragraph of running prose from the next.
        // Inside an item the marker does that, and an item holding a second
        // paragraph would otherwise open it 1.2em right of its own text column.
        const out = renderBook({ plan, title: "A Book" });
        expect(out).toContain("#set par(justify: true, leading: 0.55em, first-line-indent: 1.2em)");
        expect(out).toContain("#show list: set par(first-line-indent: 0em)");
        expect(out).toContain("#show enum: set par(first-line-indent: 0em)");
        // The marker column is Typst's to measure, so a list whose markers
        // widen at `10.` keeps every body on one column.
        expect(out).not.toMatch(/#set (list|enum)\([^)]*indent/);
    });

    it("names the faces a consumer configured", () => {
        const out = renderBook({
            plan,
            title: "A Book",
            fonts: { serif: "Libertinus Serif", mono: "DejaVu Sans Mono" },
        });
        expect(out).toContain('#set text(font: "Libertinus Serif"');
        expect(out).toContain('#show raw: set text(font: "DejaVu Sans Mono")');
    });

    it("puts the title and the version on the title page", () => {
        const out = renderBook({ plan, title: "A Book", subtitle: "and more", version: "1.2.3" });
        expect(out).toContain('#set document(title: "A Book")');
        expect(out).toContain("[A Book]");
        expect(out).toContain("[and more]");
        expect(out).toContain("[1.2.3]");
    });

    it("gives every entry a page of its own, and the section one too", () => {
        // `book-entry` and `book-section` each open with a weak page break, so
        // a page number in the contents points at the thing it names rather
        // than at the middle of whatever ran on before it.
        const out = renderBook({ plan, title: "A Book" });
        expect(out).toContain("#book-section(");
        expect(out).toContain("#book-entry(");
        expect(bookTypstPreamble()).toContain("#let book-entry(kicker, title, banner, epigraph");
        expect(bookTypstPreamble()).toMatch(/book-entry[\s\S]*?pagebreak\(weak: true\)/);
        expect(bookTypstPreamble()).toMatch(/book-section[\s\S]*?pagebreak\(weak: true\)/);
    });

    it("sets the body in two columns, and takes a section's own count when it declares one", () => {
        const out = renderBook({ plan, title: "A Book" });
        expect(out).toContain("#set page(margin: book-margin, columns: 2,");
        expect(out).toContain("#set page(columns: 2, footer: book-footer[Gear])");

        const narrow = renderBook({
            plan: {
                ...plan,
                entries: [{ ...plan.entries[0], presentation: { page: { columns: 1 } } }],
            },
            title: "A Book",
        });
        expect(narrow).toContain("#set page(columns: 1, footer: book-footer[Gear])");
    });

    it("names the running foot after the section, and after `footer:` when one is declared", () => {
        const out = renderBook({
            plan: {
                ...plan,
                entries: [{ ...plan.entries[0], presentation: { footer: "The Armoury" } }],
            },
            title: "A Book",
        });
        expect(out).toContain("footer: book-footer[The Armoury]");
    });

    it("plates an entry over the banner its section declared, and over nothing when there is none", () => {
        // Art arrives later than rendering does, so a section with no banner —
        // or one the build could not stage — still gets its plate.
        const entries = [
            { ...plan.entries[0], presentation: { page: { banner: "art/gear.webp" } } },
            { ...plan.entries[1], presentation: { page: { banner: "art/gear.webp" } } },
        ];
        const staged = renderBook({
            plan: { ...plan, entries },
            title: "A Book",
            banners: new Map([["art/gear.webp", "plates/art/gear.webp"]]),
        });
        expect(staged).toContain('"plates/art/gear.webp"');

        const bare = renderBook({ plan: { ...plan, entries }, title: "A Book" });
        expect(bare).toContain('#book-entry("Gear", "Dagger", none,');
    });

    it("sets a note's description as its epigraph, and leaves an entry without one bare", () => {
        const described = renderBook({
            plan: {
                ...plan,
                entries: [
                    {
                        ...plan.entries[1],
                        record: { name: { full: "Dagger" }, description: "A short blade." },
                    },
                ],
            },
            title: "A Book",
        });
        expect(described).toContain("none, [A short blade.])");
        expect(renderBook({ plan, title: "A Book" })).toContain("none, none)");
    });

    it("carries the section above an entry as its kicker, and the book above a section", () => {
        const out = renderBook({ plan, title: "A Book" });
        expect(out).toContain('#book-section("A Book", "Gear", none)');
        expect(out).toContain('#book-entry("Gear", "Dagger"');
    });
});
