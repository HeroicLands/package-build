/* SPDX-License-Identifier: GPL-3.0-or-later */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { compileRows as compileEncoding, encodeText } from "../engine/encoding.mjs";
import { renderRuns, scanRuns } from "../engine/content-scripts.mjs";
import { createRenderer } from "../engine/content-render.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";

const definitions = ["semaron", "qalezu"].map((name) =>
    JSON.parse(
        fs.readFileSync(new URL(`./fixtures/encodings/${name}.json`, import.meta.url), "utf8"),
    ),
);
const encodings = new Map(
    definitions.map((definition) => [definition.name, compileEncoding(definition)]),
);
const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const faces = new Map(
    definitions.flatMap((definition) =>
        definition.fonts.map((font: string) => [
            font,
            {
                slug: font,
                family: font,
                class: `hl-${font}`,
                features: [],
                draws: new Set(
                    [
                        ...definition.rows.flatMap((row: any) => [
                            ...(Array.isArray(row) ? row[1] : row.to),
                        ]),
                        ...Object.values(definition.controls).flatMap((value: any) => [...value]),
                    ].map((char: string) => char.codePointAt(0)),
                ),
            },
        ]),
    ),
);
const ctx = {
    languages: { vyl: { tag: "art-x-vyl" } },
    encodings,
    faces,
    romanInventories: new Map([["vyl", { language: "vyl", characters: new Set(alphabet) }]]),
};
const semaron = "lang=vyl enc=semaron font=semaron-kuriale";
const qalezu = "lang=vyl enc=qalezu font=qalezu-hand";
const visible = (source: string) =>
    createRenderer("foundry")
        .renderInline(source)
        .replace(/<[^>]+>/g, "");

describe("standard Roman handoff through actual language runs", () => {
    it("selects conversion and the default face from an explicit encoding alone", () => {
        const result = renderRuns("[ab]{enc=semaron}", ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toContain(".hl-semaron-kuriale");
        expect(visible(result.markdown)).toBe(encodeText(encodings.get("semaron")!, "ab"));
        expect(renderRuns("[ab]{enc=semaron}", ctx).errors).toEqual([]);
    });
    it("accepts an explicit face of the encoding and refuses another encoding's face", () => {
        expect(renderRuns("[ab]{enc=semaron font=semaron-kuriale}", ctx).errors).toEqual([]);
        expect(scanRuns("[ab]{enc=semaron font=qalezu-hand}", ctx).errors).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    message: expect.stringContaining("not a font of the encoding"),
                }),
            ]),
        );
    });
    it("chooses a requested alternate face instead of the default", () => {
        const dual = compileEncoding({
            ...definitions[0],
            name: "dual-face",
            fonts: ["semaron-kuriale", "qalezu-hand"],
        });
        const local = {
            ...ctx,
            encodings: new Map([...encodings, ["dual-face", dual]]),
            faces: new Map([
                ...faces,
                [
                    "qalezu-hand",
                    {
                        ...faces.get("qalezu-hand"),
                        draws: new Set([
                            ...faces.get("qalezu-hand")!.draws,
                            ...faces.get("semaron-kuriale")!.draws,
                        ]),
                    },
                ],
            ]),
        };
        const result = renderRuns("[ab]{enc=dual-face font=qalezu-hand}", local);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toContain(".hl-qalezu-hand");
        expect(result.markdown).not.toContain(".hl-semaron-kuriale");
    });
    it("uses the new encoding's default face instead of another language default", () => {
        const result = renderRuns("[a]{lang=vyl enc=qalezu}", ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toContain(".hl-qalezu-hand");
    });
    it("reports an unavailable encoding package once without per-run cascades", () => {
        const unavailable = {
            ...ctx,
            encodings: new Map(),
            encodingFindings: [
                {
                    message: "The encoding document is invalid",
                },
            ],
        };
        const result = scanRuns("[ab]{enc=semaron} [ab]{lang=vyl}", unavailable);
        expect(result.errors).toEqual([
            { line: 1, column: 1, message: unavailable.encodingFindings[0].message },
        ]);
    });
    it("retains English Markdown emphasis under the same native convention", () => {
        const local = {
            ...ctx,
            emphases: new Map([["semaron-kuriale", { em: "rubric", strong: "rubric" }]]),
        };
        const star = renderRuns("[a *b*]{lang=en enc=semaron}", local);
        const span = renderRuns("[a [b]{.emph}]{lang=en enc=semaron}", local);
        expect(star.errors).toEqual([]);
        expect(span.errors).toEqual([]);
        expect(createRenderer("foundry").render(star.markdown)).toBe(
            createRenderer("foundry").render(span.markdown),
        );
    });
    it("leaves literal codage out of lexical word checks", () => {
        const withWords = {
            ...ctx,
            wordBooks: new Map([
                ["vyl", { language: "vyl", accepts: (word: string) => word === "a" }],
            ]),
        };
        expect(renderRuns(`[a ⟦U+F0230⟧]{${semaron}}`, withWords).errors).toEqual([]);
    });
    it("does not encode opaque child placeholders as empty names", () => {
        const result = renderRuns(`[a [foreign]{lang=en} b]{${semaron}}`, ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown).not.toContain("\u{E0110}");
        expect(result.markdown).not.toContain("\u{E0111}");
        expect(result.markdown).toContain("foreign");
    });
    it("validates one quotation across nested emphasis", () => {
        const source = `[«a [b]{.emph} d»]{${semaron}}`;
        const result = renderRuns(source, ctx);
        expect(result.errors).toEqual([]);
        expect(visible(result.markdown)).toBe(encodeText(encodings.get("semaron")!, "«a b d»"));
    });
    it("validates a quotation across prose lines", () => {
        expect(scanRuns("::: {lang=vyl}\n«a\nb»\n:::", ctx).errors).toEqual([]);
    });
    it("refuses an interruption before an inherited child at its source mark", () => {
        const source = `[a—[b]{.emph}]{${semaron}}`;
        expect(scanRuns(source, ctx).errors).toEqual(
            expect.arrayContaining([
                {
                    line: 1,
                    column: source.indexOf("—") + 1,
                    message: expect.stringContaining("terminal"),
                },
            ]),
        );
    });
    it("hands names to the encoding between standard braces", () => {
        const result = renderRuns(`[a [b]{.name} d]{${semaron}}`, ctx);
        expect(result.errors).toEqual([]);
        expect(visible(result.markdown)).toBe(encodeText(encodings.get("semaron")!, "a {b} d"));
    });
    it("never supplies a missing sentence terminal", () => {
        const result = renderRuns(`[ab]{${semaron}}`, ctx);
        expect(result.errors).toEqual([]);
        expect(visible(result.markdown)).toBe(encodeText(encodings.get("semaron")!, "ab"));
    });
    it("allows literal codage but refuses the same directly typed native sign", () => {
        const literal = renderRuns(`[⟦U+F0230⟧]{${semaron}}`, ctx);
        expect(literal.errors).toEqual([]);
        expect(visible(literal.markdown)).toBe(encodeText(encodings.get("semaron")!, "⟦U+F0230⟧"));
        expect(scanRuns(`[\u{F0230}]{${semaron}}`, ctx).errors).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ message: expect.stringContaining("⟦U+F0230⟧") }),
            ]),
        );
    });
    it("draws the verse line mark at every line end, including stanza boundaries", () => {
        const result = renderRuns(`\`\`\`verse {${qalezu}}\na\n...b\n\na\n\`\`\``, ctx);
        expect(result.errors).toEqual([]);
        const line = encodeText(encodings.get("qalezu")!, "/");
        expect(result.markdown.split(line)).toHaveLength(4);
        expect(result.markdown).toContain(definitions[1].controls.verseStanza);
        // The three authored indentation periods remain layout, outside encoding.
        expect(result.markdown).not.toContain(encodeText(encodings.get("qalezu")!, ".").repeat(3));
    });
    it("retains a native line boundary after an independent Roman child", () => {
        const source = `\`\`\`verse {${qalezu}}\na [b]{lang=en}\n\`\`\``;
        const result = renderRuns(source, ctx);
        expect(result.errors).toEqual([]);
        const line = encodeText(encodings.get("qalezu")!, "/");
        expect(result.markdown).toContain(`]{lang=en .font-serif}${line}`);
        expect(createRenderer("foundry").render(result.markdown)).toContain(`>b</span>${line}`);
    });
    it("draws a line mark for each full native reading in parallel verse", () => {
        const source =
            "```verse {cols=2}\n1 ...[ab]{enc=qalezu}\n2 [ab]{lang=vyl}\n\n1 [ab]{enc=qalezu}\n2 [ab]{lang=vyl}\n```";
        const result = renderRuns(source, ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown.split(encodeText(encodings.get("qalezu")!, "/"))).toHaveLength(3);
        const html = createRenderer("foundry").render(result.markdown);
        expect(html.match(/class="verse-part/g)).toHaveLength(4);
        expect(html).toContain('class="verse-part i3"');
        expect(html.match(/>ab<\/span>/g)).toHaveLength(2);
    });
    it("still refuses an explicit slash in a native mid-line fragment", () => {
        expect(scanRuns("```verse\nbefore [a/b]{enc=qalezu} after\n```", ctx).errors).toEqual(
            expect.arrayContaining([
                { line: 2, column: 10, message: expect.stringContaining("verse") },
            ]),
        );
    });
    it("adds no verse line mark to a native mid-line fragment", () => {
        const result = renderRuns("```verse\nbefore [ab]{enc=qalezu} after\n```", ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown).not.toContain(encodeText(encodings.get("qalezu")!, "/"));
    });
    it("keeps each verse line boundary beside an explicit canto control", () => {
        const result = renderRuns(`\`\`\`verse {${qalezu}}\na\n--- {.canto}\nb\n\`\`\``, ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown.split(definitions[1].controls.verseCanto)).toHaveLength(2);
        expect(result.markdown).not.toContain("--- {.canto}");
        expect(result.markdown.split(encodeText(encodings.get("qalezu")!, "/"))).toHaveLength(3);
    });
    it("refuses a typed verse slash at its authored location", () => {
        expect(scanRuns("```verse {lang=vyl}\na/b\n```", ctx).errors).toEqual(
            expect.arrayContaining([
                { line: 2, column: 2, message: expect.stringContaining("verse") },
            ]),
        );
    });
    it("protects authored catch signs and hyphens from web typography", () => {
        const local = {
            ...ctx,
            romanInventories: new Map([
                ["vyl", { language: "vyl", characters: new Set(alphabet + "'-") }],
            ]),
        };
        const result = renderRuns("[ab--b a'b]{lang=vyl}", local);
        expect(result.errors).toEqual([]);
        for (const target of ["foundry", "web", "preview"] as const)
            expect(createRenderer(target, { source: false }).render(result.markdown)).toContain(
                "ab--b a'b",
            );
    });
    it("keeps Roman spellings and quotation marks unchanged on every target", () => {
        const source = "[«ab», a—]{lang=vyl}";
        const result = renderRuns(source, ctx);
        expect(result.errors).toEqual([]);
        for (const target of ["foundry", "web", "preview"] as const)
            expect(createRenderer(target, { source: false }).render(result.markdown)).toContain(
                "«ab», a—",
            );
        expect(markdownToTypst(source, { runs: ctx })).toContain("«ab», a—");
    });
});
