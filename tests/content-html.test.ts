/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Raw HTML in a note's prose.
 *
 * The gap these pin: the charset check enforces *characters*, and a page of
 * `<i class="fa-solid fa-star">` is entirely ASCII — so it is allowlist-clean
 * and simultaneously unrenderable in a book, because Typst is handed markdown
 * and knows no HTML. The two rules are the same rule at two levels, and this is
 * the upper one.
 *
 * The hard half is what must *not* be reported: markdown's own angle brackets,
 * and HTML shown as an example. A rule that could not tell an example from a
 * tag would make it impossible to document any of this.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { checkHtml, htmlMessage, lintContentHtml, HTML_TAG } from "../engine/content-html.mjs";

describe("checkHtml", () => {
    it("reports an opening tag, a closing tag and a self-closing one", () => {
        const findings = checkHtml("A <strong>bold</strong> word and a <br/> break.", "N.md");

        expect(findings.map((f) => f.message)).toEqual([
            expect.stringContaining("`<strong>`"),
            expect.stringContaining("`</strong>`"),
            expect.stringContaining("`<br/>`"),
        ]);
    });

    it("names the file, the position and the tag", () => {
        const [finding] = checkHtml("one\ntwo <p>three</p>\n", "Guide/N.md");

        expect(finding.file).toBe("Guide/N.md");
        expect(finding.line).toBe(2);
        expect(finding.column).toBe(5);
        expect(finding.message).toContain("`<p>`");
    });

    it("is a warning, so it cannot fail a build", () => {
        // A note that renders correctly on two of three surfaces should not red
        // a build while the third is still being built.
        for (const finding of checkHtml("<p>x</p>", "N.md")) {
            expect(finding.severity).toBe("warning");
        }
    });

    it("says nothing about a note that is only markdown", () => {
        expect(checkHtml("**bold**, _italic_, and a [link](/x).", "N.md")).toEqual([]);
    });

    it("says nothing about an empty body", () => {
        expect(checkHtml("", "N.md")).toEqual([]);
        expect(checkHtml(undefined as never, "N.md")).toEqual([]);
    });
});

describe("what is not a tag", () => {
    it("leaves an autolink alone", () => {
        // `<https://…>` is markdown. The name is followed by `:`, which is
        // neither whitespace nor a closing bracket, so the pattern stops.
        expect(checkHtml("See <https://example.com> for more.", "N.md")).toEqual([]);
    });

    it("leaves a comparison in prose alone", () => {
        expect(checkHtml("A roll of a < b succeeds, and 3 > 2.", "N.md")).toEqual([]);
    });

    it("leaves an email autolink alone", () => {
        expect(checkHtml("Write to <toasty@example.org>.", "N.md")).toEqual([]);
    });
});

describe("code is an example, not a mistake", () => {
    it("leaves a fenced block alone", () => {
        const body = "Before.\n\n```html\n<p>an example</p>\n```\n\nAfter.";

        expect(checkHtml(body, "N.md")).toEqual([]);
    });

    it("leaves a fence of any length alone, holding a shorter one", () => {
        const body = "````markdown\n```html\n<p>x</p>\n```\n````\n";

        expect(checkHtml(body, "N.md")).toEqual([]);
    });

    it("leaves an inline code span alone", () => {
        expect(checkHtml('Write `<i class="fa-solid">` and it renders.', "N.md")).toEqual([]);
    });

    it("still reports a tag beside one that is quoted", () => {
        // The distinction has to hold in both directions, or the rule is
        // either useless or impossible to document around.
        const findings = checkHtml("Say `<p>` but never write <p> here.", "N.md");

        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain("`<p>`");
        expect(findings[0].column).toBe(27);
    });
});

describe("the message", () => {
    it("names the tag and why markdown is the answer", () => {
        const message = htmlMessage('<i class="fa-solid fa-star">');

        expect(message).toContain('`<i class="fa-solid fa-star">`');
        expect(message).toContain("write it in markdown");
        // An author who does not know the book cannot render it reads the
        // finding as pedantry about a tag that plainly works.
        expect(message).toContain("Typst");
    });
});

describe("HTML_TAG", () => {
    it("is global, because a note is scanned for every tag it carries", () => {
        expect(HTML_TAG.global).toBe(true);
    });
});

describe("lintContentHtml", () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "content-html-"));
        fs.mkdirSync(path.join(root, "Guide"), { recursive: true });
        fs.mkdirSync(path.join(root, "Templates"), { recursive: true });

        fs.writeFileSync(
            path.join(root, "Guide", "Prose.md"),
            "---\ntype: doc\nshortcode: prose\n---\n\nA <strong>bold</strong> claim.\n",
        );
        fs.writeFileSync(
            path.join(root, "Guide", "Clean.md"),
            "---\ntype: doc\nshortcode: clean\n---\n\nA **bold** claim.\n",
        );
        fs.writeFileSync(
            path.join(root, "Templates", "Skipped.md"),
            "---\ntype: doc\n---\n\n<p>skipped</p>\n",
        );
        fs.writeFileSync(path.join(root, "notes.txt"), "<p>not markdown</p>");
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it("reports a tag at its position in the file, not in the body", () => {
        const { findings } = lintContentHtml(root);
        const prose = findings.filter((f) => f.file.endsWith("Prose.md"));

        expect(prose).toHaveLength(2);
        // The frontmatter's four lines and the blank line sit above it.
        expect(prose[0].line).toBe(6);
        expect(prose[0].column).toBe(3);
    });

    it("says nothing about a note written in markdown", () => {
        const { findings } = lintContentHtml(root);

        expect(findings.some((f) => f.file.endsWith("Clean.md"))).toBe(false);
    });

    it("honours the tree's skipped directories", () => {
        const { findings } = lintContentHtml(root, { skipDirectories: ["Templates"] });

        expect(findings.some((f) => f.file.includes("Templates"))).toBe(false);
        expect(lintContentHtml(root).findings.some((f) => f.file.includes("Templates"))).toBe(true);
    });

    it("reads markdown only, and counts what it read", () => {
        const { files } = lintContentHtml(root);

        expect(files).toBe(3);
    });

    it("scans a file with no frontmatter whole", () => {
        // Not a note, but a stray `.md` carrying markup is the same problem for
        // the same reason.
        const bare = path.join(root, "Bare.md");
        fs.writeFileSync(bare, "<p>loose</p>\n");
        try {
            const { findings } = lintContentHtml(root);
            const found = findings.filter((f) => f.file === "Bare.md");
            expect(found).toHaveLength(2);
            expect(found[0].line).toBe(1);
        } finally {
            fs.rmSync(bare, { force: true });
        }
    });
});
