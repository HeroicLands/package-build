/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { renderRuns, scanRuns } from "../engine/content-scripts.mjs";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";
import { createRenderer } from "../engine/content-render.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";
import { compileTestEncoding, testFaces } from "./helpers/encoding.js";

const ctx = {
    faces: new Map(),
    languages: { vyl: { tag: "art-x-vyl" }, en: { tag: "en" } },
    encodings: new Map([
        ["letters", compileTestEncoding({ name: "letters", rows: [["one", "uno"]] })],
    ]),
};
ctx.faces = testFaces(ctx.encodings);
const native = "lang=vyl font=semaron-kuriale enc=letters";
const html = (source: string) => renderFoundryMarkdown(renderRuns(source, ctx).markdown);

describe("span forms of emphasis", () => {
    it.each([
        ["emph", "*"],
        ["strong", "**"],
    ])("sets .%s exactly like its Markdown form", (name, mark) => {
        const span = `[one]{.${name}}`;
        const markdown = `${mark}one${mark}`;
        expect(html(span)).toBe(html(markdown));
        expect(createRenderer("web").render(span)).toBe(createRenderer("web").render(markdown));
        expect(markdownToTypst(span)).toBe(markdownToTypst(markdown));
    });

    it.each(["emph", "name"])("encodes a class-only .%s inside a native span", (name) => {
        const source = `[one [one]{.${name}} one]{${native}}`;
        const rendered = renderRuns(source, ctx);
        expect(rendered.errors).toEqual([]);
        expect(rendered.markdown).not.toContain("one");
        expect(rendered.markdown.match(/uno/g)).toHaveLength(3);
    });

    it("encodes inherited spans inside a native div", () => {
        const source = `::: {${native}}\none [one]{.name} [one]{.emph}\n:::`;
        const rendered = renderRuns(source, ctx);
        expect(rendered.errors).toEqual([]);
        expect(rendered.markdown).not.toContain("one");
        expect(rendered.markdown.match(/uno/g)).toHaveLength(3);
    });

    it.each(["rubric", "overline"])("uses the language's %s convention", (convention) => {
        const local = { ...ctx, languageEmphases: new Map([["vyl", convention]]) };
        const source = `[one [one]{.emph}]{${native}}`;
        const rendered = renderRuns(source, local);
        expect(rendered.errors).toEqual([]);
        expect(renderFoundryMarkdown(rendered.markdown)).toContain(
            `<em class="emph-${convention}">uno</em>`,
        );
        expect(markdownToTypst(source, { runs: local })).toContain(
            convention === "rubric" ? "#text(fill: book-rubric)[uno]" : "#overline[uno]",
        );
    });

    it("reports strong in a non-English run at the span", () => {
        const source = "[one [one]{.strong}]{lang=vyl}";
        expect(scanRuns(source, ctx).errors).toEqual([
            {
                line: 1,
                column: 6,
                message: "a span in non-English language `vyl` holds no `.strong` emphasis",
            },
        ]);
    });

    it("reports emphasis in a word-emphasis language at the span", () => {
        const source = "[one [one]{.emph}]{lang=vyl}";
        expect(
            scanRuns(source, { ...ctx, languageEmphases: new Map([["vyl", "words"]]) }).errors,
        ).toEqual([
            {
                line: 1,
                column: 6,
                message: "`vyl` marks emphasis with a word, not a mark; write the word",
            },
        ]);
    });

    it("reports incompatible emphasis classes at the span", () => {
        expect(scanRuns("[one]{.emph .strong}", ctx).errors).toEqual([
            { line: 1, column: 1, message: "a span takes `.emph` or `.strong`, not both" },
        ]);
    });
});
