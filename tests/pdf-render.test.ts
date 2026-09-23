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
        const out = markdownToTypst("press :icon-nonesuch: now");
        expect(out).toContain(":icon-nonesuch:");
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
