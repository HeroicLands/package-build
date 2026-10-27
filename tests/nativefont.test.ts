/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { renderRuns, scanRuns } from "../engine/content-scripts.mjs";
import { compileTestEncoding } from "./helpers/encoding.js";

const glyph = "\u{F0200}";
const face = (slug: string) => ({
    slug,
    family: slug,
    class: `hl-${slug}`,
    direction: "ltr",
    features: [],
    draws: new Set([glyph.codePointAt(0), "文".codePointAt(0)]),
});
const ctx = {
    languages: { vyl: { tag: "art-x-vyl" }, other: { tag: "art-x-other" } },
    romanInventories: new Map([
        ["vyl", { language: "vyl", characters: new Set("abcdefghijklmnopqrstuvwxyz") }],
    ]),
    faces: new Map([
        ["script", face("script")],
        ["other-script", face("other-script")],
    ]),
    encodings: new Map([
        [
            "letters",
            compileTestEncoding({
                name: "letters",
                rows: [["name", glyph]],
                fonts: [{ font: "script" }, { font: "other-script" }],
            }),
        ],
        [
            "alternate",
            compileTestEncoding({
                name: "alternate",
                rows: [["name", "文"]],
                fonts: [{ font: "script" }, { font: "other-script" }],
            }),
        ],
    ]),
    wordBooks: new Map([["vyl", { language: "vyl", accepts: (word: string) => word === "name" }]]),
};

describe("explicit native presentation", () => {
    it("keeps language-only spelling Roman and does not select a script", () => {
        const result = scanRuns("[name]{lang=vyl}", ctx);
        expect(result.errors).toEqual([]);
        expect(result.runs).toMatchObject([
            { lang: "vyl", tag: "art-x-vyl", font: undefined, enc: "default" },
        ]);
        expect(renderRuns("[name]{lang=vyl}", ctx).markdown).toBe("[name]{lang=art-x-vyl}");
    });
    it("selects the encoding and its default face", () => {
        const result = renderRuns("[name]{lang=vyl enc=letters}", ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toBe(`[${glyph}]{lang=art-x-vyl .script .hl-script}`);
    });
    it.each([
        ["enc=alternate", "文", "script"],
        ["enc=letters font=other-script", glyph, "other-script"],
        ["enc=alternate font=script", "文", "script"],
    ])("overrides each default independently: %s", (override, text, font) => {
        const result = renderRuns(`[name]{lang=vyl ${override}}`, ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toBe(`[${text}]{lang=art-x-vyl .script .hl-${font}}`);
    });
    it("rejects the retired opt-in on a class-only span", () => {
        expect(scanRuns("Before [name]{.nativefont}.", ctx).errors).toEqual([
            {
                line: 1,
                column: 15,
                message: "`.nativefont` is not an accepted class; select an encoding with `enc=`",
            },
        ]);
    });
    it.each([
        '[name]{data-note=".nativefont" .nativefont}',
        "[name]{.nativefontish .nativefont}",
        '::: {data-note=".nativefont" .nativefont}\nname\n:::',
    ])("locates the actual class token in %s", (source) => {
        const firstLine = source.split("\n")[0];
        expect(scanRuns(source, ctx).errors).toMatchObject([
            {
                line: 1,
                column: firstLine.lastIndexOf(".nativefont") + 1,
                message: expect.stringContaining("not an accepted class"),
            },
        ]);
    });
    it.each(["[[doc-name|name]]{.nativefont}", "[[doc-name|name]]{lang=vyl enc=missing}"])(
        "validates native reference controls before resolution: %s",
        (source) => {
            expect(scanRuns(source, ctx).errors).toHaveLength(1);
            expect(renderRuns(source, ctx).markdown).toBe(source);
        },
    );
    it("locates raw reference attrs and skips literal code", () => {
        const raw = '[[doc-name|name]]{data-note=".nativefont" .nativefont}';
        expect(scanRuns(raw, ctx).errors).toMatchObject([
            { column: raw.lastIndexOf(".nativefont") + 1 },
        ]);
        expect(scanRuns("`" + raw + "`", ctx).errors).toEqual([]);
        expect(scanRuns("```text\n" + raw + "\n```", ctx).errors).toEqual([]);
        expect(scanRuns("[[doc-name|name]]{lang=vyl enc=letters}", ctx).errors).toEqual([]);
        expect(scanRuns("[[doc-name|name]]{lang=vyl}", ctx).errors).toEqual([]);
    });
    it("locates unsupported block opt-in after a quoted lookalike", () => {
        const source = ':::secret {data-note=".nativefont" .nativefont}\nname\n:::';
        expect(scanRuns(source, ctx).errors).toMatchObject([
            {
                line: 1,
                column: source.split("\n")[0].lastIndexOf(".nativefont") + 1,
                message: expect.stringContaining("not an accepted class"),
            },
        ]);
    });
    it("rejects the retired opt-in even with an inherited language", () => {
        expect(scanRuns("::: {lang=vyl}\n[name]{.nativefont}\n:::", ctx).errors).toMatchObject([
            {
                line: 2,
                message: "`.nativefont` is not an accepted class; select an encoding with `enc=`",
            },
        ]);
    });
    it("keeps an explicit face Roman without an encoding", () => {
        const result = renderRuns("[name]{lang=vyl font=script}", ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toBe("[name]{lang=art-x-vyl .script .hl-script}");
    });
    it.each(["serif", "sans", "mono"])("keeps ordinary %s without native opt-in", (font) => {
        const result = renderRuns(`[name]{lang=vyl font=${font}}`, ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toBe(`[name]{lang=art-x-vyl .font-${font}}`);
    });
    it("reports an unknown encoding and permits a declared selection without a language", () => {
        expect(scanRuns("[name]{enc=missing}", ctx).errors).toMatchObject([
            {
                line: 1,
                column: 12,
                message: expect.stringContaining("does not resolve to an encoding document"),
            },
        ]);
        expect(scanRuns("[name]{enc=letters font=script}", ctx).errors).toEqual([]);
    });
    it("requires an encoding for native glyphs and writes literal Unicode through codage", () => {
        expect(scanRuns(`[${glyph}]{lang=vyl font=script}`, ctx).errors).toEqual([
            expect.objectContaining({ message: expect.stringContaining("⟦U+F0200⟧") }),
        ]);
        const result = renderRuns("[⟦U+F0200⟧]{enc=letters font=script}", ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toBe(`[\u{E0112}${glyph}\u{E0113}]{.script .hl-script}`);
        expect(scanRuns("[[doc-name|name]]{lang=vyl enc=letters}", ctx).errors).toEqual([]);
    });
    it("reports the retired class through renderRuns", () => {
        expect(renderRuns("[name]{.nativefont}", ctx).errors).toMatchObject([
            { message: expect.stringContaining("not an accepted class") },
        ]);
    });
    it("checks known words in Roman text independently of presentation", () => {
        const errors = scanRuns("[unknown]{lang=vyl}", ctx).errors;
        expect(errors).toMatchObject([
            { line: 1, column: 2, message: expect.stringContaining("`unknown` is not a word") },
        ]);
    });
    it("keeps unknown-language validation independent", () => {
        expect(scanRuns("[name]{lang=not_a_tag}", ctx).errors).toMatchObject([
            { message: expect.stringContaining("is not a declared language") },
        ]);
    });
    it("keeps a same-language child Roman inside a native container", () => {
        const result = renderRuns("[name [name]{lang=vyl}]{lang=vyl enc=letters}", ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toBe(
            `[${glyph} [name]{lang=art-x-vyl .font-serif}]{lang=art-x-vyl .script .hl-script}`,
        );
    });
    it("selects each independent child encoding and face", () => {
        const source =
            "[name [name]{lang=other enc=alternate font=other-script}]{lang=vyl enc=letters}";
        const result = renderRuns(source, ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toBe(
            `[${glyph} [文]{lang=art-x-other .script .hl-other-script}]{lang=art-x-vyl .script .hl-script}`,
        );
    });
    it("encodes direct div prose and a class-only marked child", () => {
        const result = renderRuns("::: {lang=vyl enc=letters}\nname [name]{.name}\n:::", ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toBe(
            `::: {lang=art-x-vyl .script .script-block .hl-script}\n${glyph} [\u{E0110}${glyph}\u{E0111}]{lang=art-x-vyl .name .script .hl-script}\n:::`,
        );
    });
    it("keeps a scroll Roman when only its language and face are explicit", () => {
        const result = scanRuns("```scroll {lang=vyl font=script}\nname\n```", ctx);
        expect(result.errors).toEqual([]);
        expect(result.runs[0]).toMatchObject({ enc: "default", font: "script", lang: "vyl" });
    });
});
