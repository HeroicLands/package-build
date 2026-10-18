// SPDX-License-Identifier: GPL-3.0-or-later

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { markdownToTypst, renderBook } from "../engine/pdf-render.mjs";
import { typstArgs } from "../engine/pdf-build.mjs";
import { SUBPROCESS_TEST_TIMEOUT, subprocessTimeout } from "./subprocess-timeout.js";

const HAS_TYPST = spawnSync("typst", ["--version"], { encoding: "utf8" }).status === 0;
const HAS_POPPLER = spawnSync("pdftotext", ["-v"], { encoding: "utf8" }).status === 0;

const complex = [
    "Short",
    ": First definition with *emphasis*, **bold text**, and a note.[^detail]",
    "",
    "    A second paragraph.",
    "",
    "    - First nested item",
    "    - Second nested item",
    "",
    "    ```text",
    "    code in the definition",
    "    ```",
    "",
    ": Another definition for the same term.",
    "",
    "A considerably longer unbreakable term",
    ": The definition follows the wider label.",
    "",
    "[^detail]: Footnote attached to the definition.",
].join("\n");

describe("definition-list source", () => {
    it("runs the bold term in at the margin and indents the rest of the row 1em", () => {
        const source = markdownToTypst("Short\n: A normal definition.");
        expect(source).toContain("#{");
        expect(source).toContain("let book-definition(term, body)");
        expect(source).toContain("breakable: true");
        expect(source).toContain("inset: (left: 1em)");
        expect(source).toContain("first-line-indent: 0pt");
        expect(source).toContain('#set text(weight: "regular")');
        expect(source).toContain('#h(-1em)#text(weight: "bold", term)#h(0.5em)#body');
        expect(source).toContain("book-definition([Short],[A normal definition.])");
        // A long term takes no wider slot, and rows keep the book's paragraph spacing.
        expect(source).not.toContain("measure(");
        expect(source).not.toContain("above: 0pt");
        expect(source).not.toContain("#terms(");
    });

    it("retains all definitions, paragraphs, nested lists, fences, and footnotes", () => {
        const source = markdownToTypst(complex);
        expect(source.match(/book-definition\(\[/g)).toHaveLength(2);
        expect(source).toContain("book-definition([Short],[First definition");
        expect(source).toContain("#emph[emphasis]");
        expect(source).toContain("#strong[bold text]");
        expect(source).toContain("A second paragraph.");
        expect(source).toContain("#list([First nested item], [Second nested item])");
        expect(source).toContain("code in the definition");
        expect(source).toContain("Another definition for the same term.");
        expect(source).toContain("#footnote[Footnote attached to the definition.]");
        expect(source).toContain("book-definition([A considerably longer unbreakable term]");
    });

    it("keeps nested definition helpers scoped and renders them inside a full book", () => {
        const body = markdownToTypst("Outer\n: Paragraph.\n\n    Inner\n    : Nested definition.");
        expect(body.match(/let book-definition\(/g)).toHaveLength(2);
        const book = renderBook({
            title: "Dictionary layout",
            plan: {
                entries: [
                    {
                        kind: "note",
                        depth: 1,
                        anchor: "dictionary",
                        record: { name: { full: "Dictionary" } },
                    },
                ],
                links: new Map(),
            },
            bodies: new Map([["dictionary", body]]),
        });
        expect(book).toContain(body);
        expect(book).toContain("book-definition([Inner],[Nested definition.])");
    });
});

// These cases are intentionally optional, like the other book compiler tests.
// They check PDF coordinates and real page flow, not emitted Typst strings.
describe.runIf(HAS_TYPST && HAS_POPPLER)("compiled definition-list geometry", () => {
    const temporary: string[] = [];
    afterAll(() => temporary.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

    function compile(markdown: string) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-book-definition-"));
        temporary.push(dir);
        const input = path.join(dir, "dictionary.typ");
        const pdf = path.join(dir, "dictionary.pdf");
        fs.writeFileSync(
            input,
            [
                "#set page(width: 440pt, height: 360pt, margin: 36pt)",
                '#set text(font: "Libertinus Serif", size: 10pt)',
                "#set par(justify: false, leading: 0.5em, spacing: 0.7em)",
                markdownToTypst(markdown),
            ].join("\n"),
        );
        const rendered = spawnSync("typst", typstArgs(input, pdf), {
            encoding: "utf8",
            timeout: SUBPROCESS_TEST_TIMEOUT,
            maxBuffer: 1024 * 1024,
        });
        expect(rendered.status, rendered.stderr).toBe(0);
        const extracted = spawnSync("pdftotext", ["-bbox", pdf, "-"], {
            encoding: "utf8",
            timeout: SUBPROCESS_TEST_TIMEOUT,
            maxBuffer: 1024 * 1024,
        });
        expect(extracted.status, extracted.stderr).toBe(0);
        const pages = [...extracted.stdout.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g)];
        return pages.map((page) =>
            [
                ...page[1].matchAll(
                    /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g,
                ),
            ].map((word) => ({
                x: Number(word[1]),
                y: Number(word[2]),
                right: Number(word[3]),
                text: word[5],
            })),
        );
    }

    it(
        "runs each term in at the margin and hangs every continuation line 1em in",
        () => {
            const pages = compile(
                [
                    "Short",
                    ": FIRST definition has enough words to wrap onto another line and continue here with MORE material.",
                    "",
                    "    SECOND paragraph begins on the continuation margin.",
                    "",
                    "A considerably longer unbreakable term",
                    ": LONGSTART follows the long term then wraps naturally with CONTINUED material that remains at the fixed margin.",
                ].join("\n"),
            );
            const words = pages.flat();
            const word = (text: string) => {
                const found = words.find((item) => item.text === text);
                expect(found, text).toBeDefined();
                return found!;
            };
            expect(word("Short").x).toBeCloseTo(36, 1);
            // 10pt type: the definition starts 0.5em after its term, and every
            // continuation line and paragraph hangs 1em in from the margin.
            expect(word("FIRST").x - word("Short").right).toBeCloseTo(5, 1);
            expect(Math.abs(word("Short").y - word("FIRST").y)).toBeLessThan(1);
            expect(word("SECOND").x).toBeCloseTo(36 + 10, 1);
            const termLast = word("term");
            expect(word("A").x).toBeCloseTo(36, 1);
            for (const part of ["A", "considerably", "longer", "unbreakable"]) {
                expect(Math.abs(word(part).y - termLast.y)).toBeLessThan(1);
            }
            expect(word("LONGSTART").x).toBeGreaterThan(word("FIRST").x);
            expect(word("LONGSTART").x - termLast.right).toBeCloseTo(5, 1);
            expect(Math.abs(word("LONGSTART").y - termLast.y)).toBeLessThan(1);
            const continuation = words.filter(
                (item) => item.y > word("FIRST").y + 1 && item.y < word("SECOND").y - 1,
            );
            expect(continuation.length).toBeGreaterThan(0);
            const firstOnLine = new Map<number, (typeof words)[number]>();
            for (const item of continuation)
                if (!firstOnLine.has(item.y)) firstOnLine.set(item.y, item);
            for (const item of firstOnLine.values()) expect(item.x).toBeCloseTo(36 + 10, 1);
            const longContinuation = words.filter((item) => item.y > word("LONGSTART").y + 1);
            expect(longContinuation.length).toBeGreaterThan(0);
            const longFirstOnLine = new Map<number, (typeof words)[number]>();
            for (const item of longContinuation)
                if (!longFirstOnLine.has(item.y)) longFirstOnLine.set(item.y, item);
            for (const item of longFirstOnLine.values()) expect(item.x).toBeCloseTo(36 + 10, 1);
        },
        subprocessTimeout(2),
    );

    it(
        "preserves rich definitions and allows a single row to continue across pages",
        () => {
            const paragraphs = Array.from(
                { length: 24 },
                (_, index) =>
                    `    Paragraph${index} carries enough definition text to use several lines and continue across pages without losing the hanging margin.`,
            );
            const pages = compile(
                [
                    complex,
                    "",
                    "Flowing",
                    ": START of a definition that is longer than a page.",
                    "",
                    paragraphs.join("\n\n"),
                    "",
                    "End",
                    ": FINISH after the long definition.",
                ].join("\n"),
            );
            expect(pages.length).toBeGreaterThan(1);
            const text = pages
                .flat()
                .map((word) => word.text)
                .join(" ");
            for (const marker of [
                "Short",
                "Footnote",
                "code",
                "Another",
                "START",
                "Paragraph0",
                "Paragraph23",
                "FINISH",
            ]) {
                expect(text).toContain(marker);
            }
            for (const page of pages) {
                for (const paragraph of page.filter((word) => /^Paragraph\d+$/.test(word.text))) {
                    expect(paragraph.x).toBeCloseTo(36 + 10, 1);
                }
            }
        },
        subprocessTimeout(2),
    );
});
