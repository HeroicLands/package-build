// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, it, expect } from "vitest";

import {
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

    it("nests a list as a call rather than by indentation", () => {
        const out = markdownToTypst(["- one", "- two", "  - deep"].join("\n"));
        expect(out).toContain("#list([one]");
        expect(out).toContain("#list([deep])");
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
        // reader the syntax that makes a link work.
        expect(out).toBe("== Appearance <being-jaslyne--appearance>");
        expect(out).not.toContain("{#");
    });

    it("points a fragment link at the section rather than at the entry", () => {
        const out = markdownToTypst("see [looks](/sohl/being-jaslyne/#appearance)", {
            links: new Map([["being-jaslyne", "being-jaslyne"]]),
        });
        expect(out).toBe("see #link(<being-jaslyne--appearance>)[looks]");
    });

    it("nests a note's own headings beneath the entry heading the book gave it", () => {
        const out = markdownToTypst("## Description", { headingOffset: 1 });
        expect(out).toBe("=== Description");
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
            { kind: "section", title: "Gear", depth: 1, anchor: "gear" },
            {
                kind: "note",
                depth: 1,
                anchor: "weapongear-dagger",
                record: { name: { full: "Dagger" } },
            },
        ],
        links: new Map(),
        stats: {},
    };

    it("gives every entry a heading, so the PDF outline is built for free", () => {
        const out = renderBook({ plan, title: "A Book", bodies: new Map() });
        expect(out).toContain("= Gear <gear>");
        expect(out).toContain("== Dagger <weapongear-dagger>");
    });

    it("opens on a table of contents shallower than the outline", () => {
        // 2,500 entries in the front matter would be forty pages of contents
        // before the book starts; the sidebar carries the entries instead.
        const out = renderBook({ plan, title: "A Book", tocDepth: 2 });
        expect(out).toContain("#outline(title: [Contents], depth: 2)");
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
});
