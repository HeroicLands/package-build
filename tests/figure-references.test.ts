// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { renderMarkdownExpressions } from "../engine/markdown-expressions.mjs";
import { scanFigures } from "../engine/content-figures.mjs";

/**
 * The `figures` map {@link renderMarkdownExpressions} takes for the `ref`
 * helper, built the way `engine/site-build.mjs` builds it — id to the fields
 * the helper needs, from a real `scanFigures` pass.
 */
function figuresById(source: string) {
    return new Map(
        scanFigures(source)
            .figures.filter((figure) => figure.id)
            .map((figure) => [
                figure.id,
                { label: figure.label, caption: figure.caption, hasCaption: figure.hasCaption },
            ]),
    );
}

const WITH_CAPTION = [
    ":::figure {#thorn}",
    "![[being-foobar|The Great Beast]]",
    "///",
    "The great beast, as drawn by [[person-havard|Havard]], in *ink*.",
    ":::",
].join("\n");

const NO_CAPTION = [":::figure {#plain}", "![[being-foobar|The Great Beast]]", ":::"].join("\n");

describe("the ref expression helper", () => {
    it("renders the default number form as a link", () => {
        const result = renderMarkdownExpressions('{{ref "#thorn"}}', {
            figures: figuresById(WITH_CAPTION),
        });
        expect(result).toEqual({ markdown: "[Figure 1](#thorn)", findings: [] });
    });

    it('admits form="number" explicitly, identically to omitting it', () => {
        const figures = figuresById(WITH_CAPTION);
        const implicit = renderMarkdownExpressions('{{ref "#thorn"}}', { figures });
        const explicit = renderMarkdownExpressions('{{ref "#thorn" form="number"}}', { figures });
        expect(explicit).toEqual(implicit);
    });

    it("renders the full form as the number and the caption", () => {
        const result = renderMarkdownExpressions('{{ref "#thorn" form="full"}}', {
            figures: figuresById(WITH_CAPTION),
        });
        expect(result).toEqual({
            markdown: "[Figure 1: The great beast, as drawn by Havard, in *ink*.](#thorn)",
            findings: [],
        });
    });

    it("renders the title form as the caption alone", () => {
        const result = renderMarkdownExpressions('{{ref "#thorn" form="title"}}', {
            figures: figuresById(WITH_CAPTION),
        });
        expect(result).toEqual({
            markdown: "[The great beast, as drawn by Havard, in *ink*.](#thorn)",
            findings: [],
        });
    });

    it("reduces a link in the caption to its label text while emphasis survives", () => {
        const result = renderMarkdownExpressions('{{ref "#thorn" form="title"}}', {
            figures: figuresById(WITH_CAPTION),
        });
        // One link only — the reference's own — and the nested wikilink's
        // label text, "Havard", survives as plain words inside it.
        expect(result.markdown).toBe("[The great beast, as drawn by Havard, in *ink*.](#thorn)");
        expect(result.markdown.match(/\]\(/g)).toHaveLength(1);
    });

    it("always renders a link, in every form", () => {
        const figures = figuresById(WITH_CAPTION);
        for (const expression of [
            '{{ref "#thorn"}}',
            '{{ref "#thorn" form="number"}}',
            '{{ref "#thorn" form="full"}}',
            '{{ref "#thorn" form="title"}}',
        ]) {
            const { markdown, findings } = renderMarkdownExpressions(expression, { figures });
            expect(findings).toEqual([]);
            expect(markdown).toMatch(/^\[.+\]\(#thorn\)$/);
        }
    });

    it("reports an unquoted form as a finding naming the accepted values", () => {
        const result = renderMarkdownExpressions('{{ref "#thorn" form=full}}', {
            figures: figuresById(WITH_CAPTION),
            file: "Note.md",
            bodyLine: 5,
        });
        expect(result.markdown).toBe('{{ref "#thorn" form=full}}');
        expect(result.findings).toEqual([
            {
                file: "Note.md",
                line: 5,
                column: 1,
                severity: "error",
                message: expect.stringContaining(
                    "form must be a quoted string — one of number, full, title",
                ),
            },
        ]);
    });

    it("reports a quoted form outside the closed set, naming the accepted values", () => {
        const result = renderMarkdownExpressions('{{ref "#thorn" form="huge"}}', {
            figures: figuresById(WITH_CAPTION),
            file: "Note.md",
            bodyLine: 1,
        });
        expect(result.findings).toEqual([
            {
                file: "Note.md",
                line: 1,
                column: 1,
                severity: "error",
                message: expect.stringContaining("form must be one of number, full, title"),
            },
        ]);
    });

    it("refuses full or title aimed at a figure with no caption", () => {
        const figures = figuresById(NO_CAPTION);
        const full = renderMarkdownExpressions('{{ref "#plain" form="full"}}', {
            figures,
            file: "Note.md",
            bodyLine: 1,
        });
        expect(full.findings).toEqual([
            {
                file: "Note.md",
                line: 1,
                column: 1,
                severity: "error",
                message: expect.stringContaining(
                    'form="full" needs a caption, and figure "#plain" has none',
                ),
            },
        ]);
        const title = renderMarkdownExpressions('{{ref "#plain" form="title"}}', { figures });
        expect(title.findings).toHaveLength(1);
        expect(title.findings[0].message).toContain(
            'form="title" needs a caption, and figure "#plain" has none',
        );
        // The number form needs no caption at all.
        const number = renderMarkdownExpressions('{{ref "#plain"}}', { figures });
        expect(number).toEqual({ markdown: "[Figure 1](#plain)", findings: [] });
    });

    it("reports an anchor matching no figure in this note", () => {
        const result = renderMarkdownExpressions('{{ref "#nosuch"}}', {
            figures: figuresById(WITH_CAPTION),
            file: "Note.md",
            bodyLine: 1,
        });
        expect(result.findings).toEqual([
            {
                file: "Note.md",
                line: 1,
                column: 1,
                severity: "error",
                message: expect.stringContaining('names no figure for anchor "#nosuch"'),
            },
        ]);
    });

    it("reports a cross-note anchor as unresolved here, rather than inventing a number", () => {
        const result = renderMarkdownExpressions('{{ref "place-thornford#thorn"}}', {
            figures: figuresById(WITH_CAPTION),
            file: "Note.md",
            bodyLine: 1,
        });
        expect(result.markdown).toBe('{{ref "place-thornford#thorn"}}');
        expect(result.findings).toEqual([
            {
                file: "Note.md",
                line: 1,
                column: 1,
                severity: "error",
                message: expect.stringContaining("addresses a figure in another note"),
            },
        ]);
    });

    it("locates a fault at the expression's position on its own line", () => {
        const source = 'First line.\nSecond line names {{ref "#nosuch"}} here.';
        const result = renderMarkdownExpressions(source, {
            figures: figuresById(WITH_CAPTION),
            file: "Note.md",
            bodyLine: 10,
        });
        expect(result.findings).toEqual([
            expect.objectContaining({ file: "Note.md", line: 11, column: 19 }),
        ]);
    });
});
