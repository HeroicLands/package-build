// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { renderMarkdownExpressions } from "../engine/markdown-expressions.mjs";
import { scanFigures } from "../engine/content-figures.mjs";

/** A note's figures, by id, in the shape the `ref` helper's `get` reads. */
function figureMap(source: string) {
    return new Map(
        scanFigures(source)
            .figures.filter((figure) => figure.id)
            .map((figure) => [
                figure.id,
                {
                    label: figure.label,
                    caption: source === NO_CAPTION ? "" : figure.caption,
                    hasCaption: source !== NO_CAPTION,
                },
            ]),
    );
}

/**
 * The `figures` context {@link renderMarkdownExpressions} takes for the `ref`
 * helper, built the way `engine/site-build.mjs` builds it — `get` for this
 * note's own figures, by id, from a real `scanFigures` pass.
 */
function figuresById(source: string) {
    const own = figureMap(source);
    return { get: (id: string) => own.get(id) };
}

/**
 * A `figures` context spanning more than one note — the shape
 * `engine/site-build.mjs` and `engine/pdf-build.mjs` build for the `ref`
 * helper's cross-note case: `get` reads the citing note's own figures, and
 * `note` resolves another note's address, the way a wikilink would. An
 * address absent from `others` is a note this build does not resolve.
 */
function corpusFigures(own: string, others: Record<string, string>) {
    const ownMap = figureMap(own);
    return {
        get: (id: string) => ownMap.get(id),
        note: (address: string) => {
            if (!Object.hasOwn(others, address)) return undefined;
            return { url: `/pkg/${address}/`, figures: figureMap(others[address]) };
        },
    };
}

const WITH_CAPTION =
    ":@ The great beast, as drawn by [[person-havard|Havard]], in *ink*. {#thorn}\n\n![[being-foobar|The Great Beast]]";
const NO_CAPTION = ":@ Placeholder {#plain}\n\n![[being-foobar|The Great Beast]]";

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

describe("the ref expression helper, addressing another note", () => {
    const OTHERS = { "place-thornford": WITH_CAPTION };

    it("resolves the number form to the target's own number, as a link to its page", () => {
        const result = renderMarkdownExpressions('{{ref "place-thornford#thorn"}}', {
            figures: corpusFigures("", OTHERS),
        });
        expect(result).toEqual({
            markdown: "[Figure 1](/pkg/place-thornford/#thorn)",
            findings: [],
        });
    });

    it("resolves the full form to the target's number and caption", () => {
        const result = renderMarkdownExpressions('{{ref "place-thornford#thorn" form="full"}}', {
            figures: corpusFigures("", OTHERS),
        });
        expect(result).toEqual({
            markdown:
                "[Figure 1: The great beast, as drawn by Havard, in *ink*.](/pkg/place-thornford/#thorn)",
            findings: [],
        });
    });

    it("resolves the title form to the target's caption alone", () => {
        const result = renderMarkdownExpressions('{{ref "place-thornford#thorn" form="title"}}', {
            figures: corpusFigures("", OTHERS),
        });
        expect(result).toEqual({
            markdown:
                "[The great beast, as drawn by Havard, in *ink*.](/pkg/place-thornford/#thorn)",
            findings: [],
        });
    });

    it("flattens a link in the target's caption to its label text, as it does within one note", () => {
        const result = renderMarkdownExpressions('{{ref "place-thornford#thorn" form="title"}}', {
            figures: corpusFigures("", OTHERS),
        });
        expect(result.markdown.match(/\]\(/g)).toHaveLength(1);
        expect(result.markdown).toContain("Havard");
    });

    it("refuses full or title aimed at another note's captionless figure", () => {
        const others = { "place-thornford": NO_CAPTION };
        const full = renderMarkdownExpressions('{{ref "place-thornford#plain" form="full"}}', {
            figures: corpusFigures("", others),
            file: "Note.md",
            bodyLine: 1,
        });
        expect(full.findings).toEqual([
            expect.objectContaining({
                message: expect.stringContaining(
                    'form="full" needs a caption, and figure "#plain" has none',
                ),
            }),
        ]);
        const number = renderMarkdownExpressions('{{ref "place-thornford#plain"}}', {
            figures: corpusFigures("", others),
        });
        expect(number.findings).toEqual([]);
    });

    it("reports an anchor matching no figure in the addressed note", () => {
        const result = renderMarkdownExpressions('{{ref "place-thornford#nosuch"}}', {
            figures: corpusFigures("", OTHERS),
            file: "Note.md",
            bodyLine: 1,
        });
        expect(result.findings).toEqual([
            {
                file: "Note.md",
                line: 1,
                column: 1,
                severity: "error",
                message: expect.stringContaining(
                    'names no figure for anchor "#nosuch" in "place-thornford"',
                ),
            },
        ]);
    });

    it("reports an address naming a note that does not exist", () => {
        const result = renderMarkdownExpressions('{{ref "place-nowhere#thorn"}}', {
            figures: corpusFigures("", OTHERS),
            file: "Note.md",
            bodyLine: 1,
        });
        expect(result.findings).toEqual([
            {
                file: "Note.md",
                line: 1,
                column: 1,
                severity: "error",
                message: expect.stringContaining(
                    'addresses "place-nowhere", which names no note this build resolves',
                ),
            },
        ]);
    });

    it("refuses a cross-note address when the build offers no cross-note resolution", () => {
        // `figures.note` is omitted entirely — the shape a build that does not
        // resolve cross-note references hands the helper.
        const result = renderMarkdownExpressions('{{ref "place-thornford#thorn"}}', {
            figures: figuresById(WITH_CAPTION),
            file: "Note.md",
            bodyLine: 1,
        });
        expect(result.findings).toEqual([
            expect.objectContaining({
                message: expect.stringContaining("names no note this build resolves"),
            }),
        ]);
    });
});
