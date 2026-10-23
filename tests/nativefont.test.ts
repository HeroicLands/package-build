/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { renderRuns, scanRuns } from "../engine/content-scripts.mjs";
import { compileMap } from "../engine/text-maps.mjs";

const glyph = "字";
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
    writtenIn: new Map([
        ["vyl", { map: "letters", font: "script" }],
        ["other", { map: "alternate", font: "other-script" }],
    ]),
    faces: new Map([
        ["script", face("script")],
        ["other-script", face("other-script")],
    ]),
    maps: new Map([
        [
            "letters",
            compileMap({
                name: "letters",
                rows: [["name", glyph]],
                fonts: [{ font: "script" }, { font: "other-script" }],
            }),
        ],
        [
            "alternate",
            compileMap({
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
            { lang: "vyl", tag: "art-x-vyl", font: undefined, map: undefined },
        ]);
        expect(renderRuns("[name]{lang=vyl}", ctx).markdown).toBe("[name]{lang=art-x-vyl}");
    });
    it("opts into both native defaults and consumes the control class", () => {
        const result = renderRuns("[name]{lang=vyl .nativefont}", ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toBe(`[${glyph}]{lang=art-x-vyl .script .hl-script}`);
    });
    it.each([
        ["map=alternate", "文", "script"],
        ["font=other-script", glyph, "other-script"],
        ["map=alternate font=script", "文", "script"],
    ])("overrides each default independently: %s", (override, text, font) => {
        const result = renderRuns(`[name]{lang=vyl .nativefont ${override}}`, ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toBe(`[${text}]{lang=art-x-vyl .script .hl-${font}}`);
    });
    it("activates a class-only span and locates its missing own language", () => {
        expect(scanRuns("Before [name]{.nativefont}.", ctx).errors).toEqual([
            {
                line: 1,
                column: 15,
                message: "`.nativefont` requires an explicit `lang=` on the same construct",
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
                message: expect.stringContaining("explicit `lang=`"),
            },
        ]);
    });
    it.each([
        "[[doc-name|name]]{.nativefont}",
        "[[doc-name|name]]{lang=vyl font=script}",
        "[[doc-name|name]]{lang=vyl map=letters}",
    ])("validates native reference controls before resolution: %s", (source) => {
        expect(scanRuns(source, ctx).errors).toHaveLength(1);
        expect(renderRuns(source, ctx).markdown).toBe(source);
    });
    it("locates raw reference attrs and skips literal code", () => {
        const raw = '[[doc-name|name]]{data-note=".nativefont" .nativefont}';
        expect(scanRuns(raw, ctx).errors).toMatchObject([
            { column: raw.lastIndexOf(".nativefont") + 1 },
        ]);
        expect(scanRuns("`" + raw + "`", ctx).errors).toEqual([]);
        expect(scanRuns("```text\n" + raw + "\n```", ctx).errors).toEqual([]);
        expect(scanRuns("[[doc-name|name]]{lang=vyl .nativefont}", ctx).errors).toEqual([]);
        expect(scanRuns("[[doc-name|name]]{lang=vyl}", ctx).errors).toEqual([]);
    });
    it("locates unsupported block opt-in after a quoted lookalike", () => {
        const source = ':::secret {data-note=".nativefont" .nativefont}\nname\n:::';
        expect(scanRuns(source, ctx).errors).toMatchObject([
            {
                line: 1,
                column: source.split("\n")[0].lastIndexOf(".nativefont") + 1,
                message: expect.stringContaining("not on a secret block"),
            },
        ]);
    });
    it("does not count an inherited language as explicit native opt-in", () => {
        expect(scanRuns("::: {lang=vyl}\n[name]{.nativefont}\n:::", ctx).errors).toMatchObject([
            {
                line: 2,
                message: "`.nativefont` requires an explicit `lang=` on the same construct",
            },
        ]);
    });
    it.each(["font=script", "map=letters"])(
        "rejects native presentation without the opt-in: %s",
        (override) => {
            expect(scanRuns(`[name]{lang=vyl ${override}}`, ctx).errors).toMatchObject([
                { line: 1, message: expect.stringContaining("requires `.nativefont`") },
            ]);
        },
    );
    it.each(["serif", "sans", "mono"])("keeps ordinary %s without native opt-in", (font) => {
        const result = renderRuns(`[name]{lang=vyl font=${font}}`, ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toBe(`[name]{lang=art-x-vyl .font-${font}}`);
    });
    it("reports a missing native font default with its override", () => {
        const result = scanRuns("[name]{lang=fr .nativefont}", ctx);
        expect(result.errors.map((x) => x.message)).toEqual([
            "`.nativefont` has no default `font=` for `fr`; state `font=` explicitly",
        ]);
        expect(scanRuns("[name]{lang=fr .nativefont map=letters font=script}", ctx).errors).toEqual(
            [],
        );
    });
    it("sets already-encoded native glyphs with an explicit font and no map", () => {
        const result = renderRuns(`[${glyph}]{lang=en .nativefont font=script}`, ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toBe(`[${glyph}]{lang=en .script .hl-script}`);
    });
    it("reports missing language through renderRuns even with class only", () => {
        expect(renderRuns("[name]{.nativefont}", ctx).errors).toMatchObject([
            { message: expect.stringContaining("requires an explicit `lang=`") },
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
        const result = renderRuns("[name [name]{lang=vyl}]{lang=vyl .nativefont}", ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toBe(
            `[${glyph} [name]{lang=art-x-vyl .font-serif}]{lang=art-x-vyl .script .hl-script}`,
        );
    });
    it("requires each child to opt into its own native presentation", () => {
        const source = "[name [name]{lang=other .nativefont}]{lang=vyl .nativefont}";
        const result = renderRuns(source, ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toBe(
            `[${glyph} [文]{lang=art-x-other .script .hl-other-script}]{lang=art-x-vyl .script .hl-script}`,
        );
    });
    it("maps direct div prose while a marked child keeps Roman spelling", () => {
        const result = renderRuns("::: {lang=vyl .nativefont}\nname [name]{.name}\n:::", ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toBe(
            `::: {lang=art-x-vyl .script .script-block .hl-script}\n${glyph} [name]{lang=art-x-vyl .name .font-serif}\n:::`,
        );
    });
    it("requires scrolls to opt in even when a font is explicit", () => {
        const result = scanRuns("```scroll {lang=vyl font=script}\nname\n```", ctx);
        expect(result.errors).toMatchObject([
            { message: expect.stringContaining("requires `.nativefont`") },
        ]);
    });
});
