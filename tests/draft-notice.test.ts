/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A draft note says so on every surface it reaches, and says the same thing.
 *
 * Three assertions carry most of this: the sentence is one string every surface
 * composes around, the notice leads what a reader meets first, and a settled
 * note carries nothing anywhere. The rest guard the two ways a surface can lose
 * the notice silently — a Typst special character in the sentence, and a notice
 * composed early enough to give an empty note a document.
 */

import { describe, it, expect } from "vitest";

import {
    BOOK_DRAFT_NOTICE,
    DRAFT_NOTICE,
    DRAFT_NOTICE_CLASS,
    DRAFT_NOTICE_ICON,
    DRAFT_NOTICE_LABEL,
    bookDraftNoticePreamble,
    draftNoticeFor,
    draftNoticeHtml,
    draftNoticeTypst,
    withDraftNotice,
} from "../engine/draft-notice.mjs";
import { Journals, buildJournalEntry } from "../engine/journals.mjs";
import { bookTypstPreamble } from "../engine/pdf-render.mjs";
import { journalHasContent } from "../engine/note-state.mjs";

const DRAFT = { type: "lore", tags: ["village", "draft"] };
const SETTLED = { type: "lore", tags: ["village"] };

describe("the sentence", () => {
    it("states that the content may change rather than that the writing is rough", () => {
        expect(DRAFT_NOTICE).toBe(
            "This entry is unfinished. What it states may change, and nothing in it is settled.",
        );
    });

    it("carries the meaning with nothing around it", () => {
        // The floor: every surface can lose its rule, its mark and its
        // styling, and what is left has to be a complete statement.
        expect(DRAFT_NOTICE_LABEL).toBe("Draft.");
        expect(`${DRAFT_NOTICE_LABEL} ${DRAFT_NOTICE}`).toMatch(/^Draft\. .+\.$/);
    });

    it("sets in the book's own face, with nothing Typst reads as markup", () => {
        // A `#`, `$`, `*`, `_`, `@`, `<`, `>`, `[`, `]` or backslash in the
        // sentence would be swallowed by the compiler rather than set, and the
        // notice is emitted as literal Typst content.
        expect(DRAFT_NOTICE).not.toMatch(/[#$*_@<>[\]\\]/);
        expect(DRAFT_NOTICE_LABEL).not.toMatch(/[#$*_@<>[\]\\]/);
    });
});

describe("the voice", () => {
    it("sets the sentence in italic and the label in bold roman, on every surface", () => {
        // The sentence is the text speaking about its own state rather than
        // about the world, and italic is what tells a reader the voice has
        // changed. Bold italic beside the mark would be one emphasis too many.
        const html = draftNoticeHtml();
        expect(html).toContain(`<strong>${DRAFT_NOTICE_LABEL}</strong> <em>${DRAFT_NOTICE}</em>`);
        expect(html).not.toContain(`<em><strong>`);

        const preamble = bookDraftNoticePreamble();
        expect(preamble).toContain('[#text(weight: "bold")[#label]#h(0.25em)#emph[#body]]');
    });
});

describe("the mark", () => {
    it("is a notice rather than a hazard", () => {
        expect(DRAFT_NOTICE_ICON).toBe("fa-circle-exclamation");
        expect(DRAFT_NOTICE_ICON).not.toContain("triangle");
    });

    it("is drawn in the book rather than set from a face", () => {
        // A consumer declaring no icon family is the normal case, and a glyph
        // a face lacks is silent in Typst, so the book's mark cannot come from
        // one.
        const preamble = bookDraftNoticePreamble();
        expect(preamble).toContain("circle(");
        expect(preamble).not.toContain("fa-");
        expect(bookTypstPreamble()).toContain(`#let ${BOOK_DRAFT_NOTICE}(`);
    });

    it("is a filled disc with the glyph knocked out of it", () => {
        // A mark the reader meets before the sentence, so it carries the
        // book's accent and the glyph is the colour of the paper. Both are
        // palette names: a literal colour here would not follow the book.
        const preamble = bookDraftNoticePreamble();
        expect(preamble).toContain("circle(radius: radius, fill: book-accent)");
        expect(preamble).toContain("fill: book-paper)[!]");
        expect(preamble).not.toContain("stroke: 0.6pt");
        expect(preamble).not.toMatch(/rgb\(/);
    });

    it("sizes the glyph from the disc, so one number sets the mark", () => {
        // A glyph sized against the surrounding text instead keeps its size
        // while the disc grows, and the mark becomes a large disc with a small
        // exclamation adrift in it.
        const preamble = bookDraftNoticePreamble();
        expect(preamble).toMatch(/#let radius = [\d.]+em/);
        expect(preamble).toMatch(/#text\(size: [\d.]+ \* radius,/);
    });

    it("sets in a column of its own, beside the sentence", () => {
        // Inline, a notice long enough to wrap starts its second line under
        // the mark. A two-column grid centred on the block keeps the sentence
        // beside it at one line or three.
        const preamble = bookDraftNoticePreamble();
        expect(preamble).toContain("#grid(columns: (auto, 1fr)");
        expect(preamble).toContain("align: (center + horizon, horizon)");
    });

    it("leaves the sentence in the book's own body type", () => {
        // The rule and the mark set the notice apart. Type set smaller or
        // lighter than the prose reads as apparatus a reader may skip, which
        // is the opposite of a statement to be read before the entry.
        const preamble = bookDraftNoticePreamble();
        expect(preamble).not.toContain("#set text(");
        expect(preamble).toContain("stroke: (left: 1.6pt + book-faint)");
    });
});

describe("the notice a note has earned", () => {
    it("is drawn for a note carrying the tag", () => {
        expect(draftNoticeFor(DRAFT)).toBe(draftNoticeHtml());
        expect(draftNoticeFor(DRAFT)).toContain(DRAFT_NOTICE);
        expect(draftNoticeFor(DRAFT)).toContain(DRAFT_NOTICE_CLASS);
        expect(draftNoticeFor(DRAFT)).toContain(DRAFT_NOTICE_ICON);
    });

    it("is nothing for a settled note", () => {
        expect(draftNoticeFor(SETTLED)).toBe("");
        expect(draftNoticeFor({ type: "lore" })).toBe("");
        expect(draftNoticeFor(null)).toBe("");
    });

    it("leads a system's prose field, and a settled note's is untouched", () => {
        expect(withDraftNotice(DRAFT, "<p>Tall.</p>")).toBe(`${draftNoticeHtml()}\n<p>Tall.</p>`);
        expect(withDraftNotice(SETTLED, "<p>Tall.</p>")).toBe("<p>Tall.</p>");
    });

    it("stands alone where a draft being has written no appearance yet", () => {
        expect(withDraftNotice(DRAFT, "")).toBe(draftNoticeHtml());
        expect(withDraftNotice(SETTLED, "")).toBe("");
    });
});

describe("the journal entry", () => {
    const entry = (notice: string) =>
        buildJournalEntry({
            id: "0123456789abcdef",
            name: "Tanvur",
            markdown: "Prose.",
            infobox: '<details class="infobox"></details>',
            notice,
        });

    it("leads the first page, ahead of the infobox", () => {
        const content = entry(draftNoticeHtml()).pages[0].text.content;
        expect(content.indexOf(DRAFT_NOTICE)).toBeLessThan(content.indexOf("infobox"));
        expect(content.startsWith(draftNoticeHtml())).toBe(true);
    });

    it("carries nothing for a settled note", () => {
        expect(entry("").pages[0].text.content).not.toContain(DRAFT_NOTICE);
    });

    it("is not what gives an empty note a document", () => {
        // The notice is composed inside `buildEntry`, which the compiler
        // reaches only once `skipNote` has passed — so a stub compiles into
        // nothing whatever its tags say. Composed before that test, the notice
        // would be content enough to make one.
        expect(journalHasContent("   \n")).toBe(false);
        expect(Journals.prototype.skipNote.call(null, DRAFT, "   \n")).toBe(true);
        expect(() =>
            buildJournalEntry({ id: "0123456789abcdef", name: "Empty", markdown: "" }),
        ).toThrow(/nothing to compile/);
    });
});

describe("the book leaf", () => {
    it("calls the drawn notice with the label and the sentence", () => {
        expect(draftNoticeTypst()).toBe(
            `#${BOOK_DRAFT_NOTICE}[${DRAFT_NOTICE_LABEL}][${DRAFT_NOTICE}]`,
        );
    });
});
