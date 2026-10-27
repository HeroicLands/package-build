/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { renderRuns, scanRuns } from "../engine/content-scripts.mjs";
import { compileTestEncoding, testFaces } from "./helpers/encoding.js";

const ctx = {
    faces: new Map(),
    languages: { vyl: { tag: "art-x-vyl" }, english: { tag: "en-GB" } },
    encodings: new Map([
        [
            "letters",
            compileTestEncoding({
                name: "letters",
                fonts: ["semaron-kuriale", "script"],
                rows: [
                    ["one", "uno"],
                    [".", "X"],
                ],
            }),
        ],
    ]),
};

ctx.faces = testFaces(ctx.encodings);

describe("emphasis follows a span's effective language", () => {
    it.each(["la", "fr-CA", "vyl"])("refuses stars and underscores in %s", (lang) => {
        for (const markup of ["*word*", "**word**", "_word_", "__word__"])
            expect(scanRuns(`[${markup}]{lang=${lang}}`, ctx).errors).toEqual([
                {
                    line: 1,
                    column: 2,
                    message: `a span in non-English language \`${lang}\` holds no bold or italic markup`,
                },
            ]);
    });

    it.each(["en", "en-GB", "EN-us", "english"])("accepts English emphasis in %s", (lang) => {
        expect(scanRuns(`[one *two* **three**]{lang=${lang}}`, ctx).errors).toEqual([]);
    });

    it("accepts escaped and unpaired literal delimiters", () => {
        expect(scanRuns(String.raw`[one \*two\* \_three\_ a_b_c *]{lang=fr}`, ctx).errors).toEqual(
            [],
        );
    });

    it("inherits language for a span marked only with a class", () => {
        const source = ["::: {lang=fr}", "[un *mot*]{.name}", ":::"].join("\n");
        expect(scanRuns(source, ctx).errors).toEqual([
            {
                line: 2,
                column: 5,
                message: "a span in non-English language `fr` holds no bold or italic markup",
            },
        ]);
    });

    it("takes the nearest enclosing span's language and honors English overrides", () => {
        const source = "[un [one *word*]{lang=en} [un *mot*]{.name}]{lang=fr}";
        expect(scanRuns(source, ctx).errors).toEqual([
            {
                line: 1,
                column: source.indexOf("*mot*") + 1,
                message: "a span in non-English language `fr` holds no bold or italic markup",
            },
        ]);
    });

    it("checks only the offending span beside English on a verse line", () => {
        const source = [
            "```verse {lang=en}",
            "[one *word*]{lang=en} [un **mot**]{lang=fr}",
            "```",
        ].join("\n");
        expect(scanRuns(source, ctx).errors).toEqual([
            {
                line: 2,
                column: 27,
                message: "a span in non-English language `fr` holds no bold or italic markup",
            },
        ]);
    });

    it("does not remap nested markup as part of its enclosing span", () => {
        const source = "[outer [inner]{lang=en font=sans}]{lang=fr font=serif}";
        expect(renderRuns(source, ctx).markdown).toBe(
            "[outer [inner]{lang=en .font-sans}]{lang=fr .font-serif}",
        );
    });

    it("drops native presentation when a nested span switches language", () => {
        const source = "[one [one]{lang=en}]{lang=vyl font=semaron-kuriale enc=letters}";
        expect(renderRuns(source, ctx).markdown).toBe(
            "[uno [one]{lang=en .font-serif}]{lang=art-x-vyl .script .hl-semaron-kuriale}",
        );
    });

    it("retains a language switch for descendants without their own language", () => {
        const source =
            "[one [one [one]{.name}]{lang=en}]{lang=vyl font=semaron-kuriale enc=letters}";
        expect(renderRuns(source, ctx).markdown).toBe(
            "[uno [one [one]{lang=en .name .font-serif}]{lang=en .font-serif}]{lang=art-x-vyl .script .hl-semaron-kuriale}",
        );
    });

    it("lets a switched language explicitly select its encoding", () => {
        const source = "[one [one]{lang=vyl enc=letters}]{lang=en font=mono}";
        const defaults = {
            ...ctx,
        };
        expect(renderRuns(source, defaults).markdown).toBe(
            "[one [uno]{lang=art-x-vyl .script .hl-semaron-kuriale}]{lang=en .font-mono}",
        );
    });

    it("refuses non-English emphasis in a face and with an explicit map", () => {
        for (const attrs of [
            "font=serif",
            "enc=letters font=semaron-kuriale",
            "font=script enc=letters",
        ]) {
            const faces = new Map([
                [
                    "script",
                    {
                        slug: "script",
                        family: "Script",
                        class: "hl-script",
                        features: [],
                        draws: new Set(Array.from("word", (char) => char.codePointAt(0))),
                    },
                ],
            ]);
            expect(
                scanRuns(`[*word*]{lang=fr ${attrs}}`, {
                    ...ctx,
                    faces: new Map([...ctx.faces, ...faces]),
                }).errors,
            ).toEqual([
                {
                    line: 1,
                    column: 2,
                    message: "a span in non-English language `fr` holds no bold or italic markup",
                },
            ]);
        }
    });

    it("keeps a language-only span Roman inside a native verse fence", () => {
        const source = [
            "```verse {lang=vyl font=semaron-kuriale enc=letters}",
            "one [one]{lang=en}",
            "```",
        ].join("\n");
        expect(renderRuns(source, ctx).markdown).toBe(
            [
                "```verse {lang=art-x-vyl .script .hl-semaron-kuriale}",
                "uno [one]{lang=en .font-serif}\u{E010C}",
                "```",
            ].join("\n"),
        );
    });

    it("keeps a same-tag child Roman unless it opts in", () => {
        const source = "[one [one]{lang=en-GB}]{lang=english font=semaron-kuriale enc=letters}";
        expect(renderRuns(source, ctx).markdown).toBe(
            "[uno [one]{lang=en-GB .font-serif}]{lang=en-GB .script .hl-semaron-kuriale}",
        );
    });

    it("rewrites a valid mapped span following an invalid span on the same line", () => {
        const source = "[*un*]{lang=fr} [one]{lang=vyl font=semaron-kuriale enc=letters}";
        expect(renderRuns(source, ctx).markdown).toBe(
            "[*un*]{lang=fr} [uno]{lang=art-x-vyl .script .hl-semaron-kuriale}",
        );
    });

    it("keeps indentation periods outside mapping while mapping literal later periods", () => {
        const source = [
            "```verse {lang=vyl font=semaron-kuriale enc=letters}",
            "...one",
            "  [..one]{lang=vyl font=semaron-kuriale enc=letters} [..one]{lang=vyl font=semaron-kuriale enc=letters}",
            "```",
        ].join("\n");
        expect(scanRuns(source, ctx).errors).toEqual([]);
        expect(renderRuns(source, ctx).markdown).toBe(
            [
                "```verse {lang=art-x-vyl .script .hl-semaron-kuriale}",
                "...uno\u{E010C}",
                "[..uno]{lang=art-x-vyl .script .hl-semaron-kuriale} [XXuno]{lang=art-x-vyl .script .hl-semaron-kuriale}\u{E010C}",
                "```",
            ].join("\n"),
        );
    });

    it.each([
        ["lang=vyl", "one", "one"],
        ["lang=vyl enc=letters font=semaron-kuriale", "uno", "one"],
    ])(
        "keeps each authored column reading's script while inline languages choose their own in %s",
        (entry, outer, same) => {
            const mixed = {
                ...ctx,
                languages: { ...ctx.languages, foreign: { tag: "fr" } },
                encodings: new Map([
                    ...ctx.encodings,
                    [
                        "glyphs",
                        compileTestEncoding({
                            name: "glyphs",
                            fonts: ["semaron-kuriale", "script-other"],
                            rows: [["one", "Ω"]],
                        }),
                    ],
                ]),
            };
            mixed.faces = testFaces(mixed.encodings);
            const source = [
                "```verse {cols=2}",
                `1 [one [one]{lang=foreign enc=glyphs font=script-other} [one]{lang=vyl}]{${entry}}`,
                "```",
            ].join("\n");
            expect(scanRuns(source, mixed).errors).toEqual([]);
            const rendered = renderRuns(source, mixed).markdown;
            expect(rendered).toContain(`[${outer} [Ω]{lang=fr .script .hl-script-other}`);
            expect(rendered).toContain(
                `[${same}]{lang=art-x-vyl${entry === "lang=vyl" ? "" : " .font-serif"}}`,
            );
        },
    );
});
