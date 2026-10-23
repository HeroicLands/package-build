/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { renderRuns, scanRuns } from "../engine/content-scripts.mjs";
import { compileMap } from "../engine/text-maps.mjs";

const ctx = {
    languages: { vyl: { tag: "art-x-vyl" }, english: { tag: "en-GB" } },
    maps: new Map([
        [
            "letters",
            compileMap({
                name: "letters",
                rows: [
                    ["one", "uno"],
                    [".", "X"],
                ],
            }),
        ],
    ]),
};

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

    it("selects the new language's script when a nested span switches language", () => {
        const source = "[one [one]{lang=en}]{lang=vyl font=serif map=letters}";
        expect(renderRuns(source, ctx).markdown).toBe(
            "[uno [one]{lang=en}]{lang=art-x-vyl .font-serif}",
        );
    });

    it("retains a language switch for descendants without their own language", () => {
        const source = "[one [one [one]{.name}]{lang=en}]{lang=vyl font=serif map=letters}";
        expect(renderRuns(source, ctx).markdown).toBe(
            "[uno [one [one]{lang=en .name}]{lang=en}]{lang=art-x-vyl .font-serif}",
        );
    });

    it("lets a switched language select its own default script", () => {
        const source = "[one [one]{lang=vyl}]{lang=en font=mono}";
        const defaults = {
            ...ctx,
            writtenIn: new Map([["vyl", { map: "letters", font: "serif" }]]),
        };
        expect(renderRuns(source, defaults).markdown).toBe(
            "[one [uno]{lang=art-x-vyl .font-serif}]{lang=en .font-mono}",
        );
    });

    it("refuses non-English emphasis in a face and with an explicit map", () => {
        for (const attrs of ["font=serif", "map=letters", "font=script"]) {
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
            expect(scanRuns(`[*word*]{lang=fr ${attrs}}`, { ...ctx, faces }).errors).toEqual([
                {
                    line: 1,
                    column: 2,
                    message: "a span in non-English language `fr` holds no bold or italic markup",
                },
            ]);
        }
    });

    it("selects the new language's script inside a mapped verse fence", () => {
        const source = [
            "```verse {lang=vyl font=serif map=letters}",
            "one [one]{lang=en}",
            "```",
        ].join("\n");
        expect(renderRuns(source, ctx).markdown).toBe(
            ["```verse {lang=art-x-vyl .font-serif}", "uno [one]{lang=en}", "```"].join("\n"),
        );
    });

    it("inherits a script when two language names resolve to the same tag", () => {
        const source = "[one [one]{lang=en-GB}]{lang=english font=serif map=letters}";
        expect(renderRuns(source, ctx).markdown).toBe(
            "[uno [uno]{lang=en-GB .font-serif}]{lang=en-GB .font-serif}",
        );
    });

    it("rewrites a valid mapped span following an invalid span on the same line", () => {
        const source = "[*un*]{lang=fr} [one]{lang=vyl font=serif map=letters}";
        expect(renderRuns(source, ctx).markdown).toBe(
            "[*un*]{lang=fr} [uno]{lang=art-x-vyl .font-serif}",
        );
    });

    it("keeps indentation periods outside mapping while mapping literal later periods", () => {
        const source = [
            "```verse {lang=vyl font=serif map=letters}",
            "...one",
            "  [..one]{lang=vyl} [..one]{lang=vyl}",
            "```",
        ].join("\n");
        expect(scanRuns(source, ctx).errors).toEqual([]);
        expect(renderRuns(source, ctx).markdown).toBe(
            [
                "```verse {lang=art-x-vyl .font-serif}",
                "...uno",
                "  [..uno]{lang=art-x-vyl .font-serif} [XXuno]{lang=art-x-vyl .font-serif}",
                "```",
            ].join("\n"),
        );
    });

    it.each([
        ["vyl", "one", "one"],
        ["vyl/letters/serif", "uno", "uno"],
    ])(
        "keeps the column's script choice while inline languages select their own in %s",
        (entry, outer, same) => {
            const mixed = {
                ...ctx,
                languages: { ...ctx.languages, foreign: { tag: "fr" } },
                maps: new Map([
                    ...ctx.maps,
                    ["glyphs", compileMap({ name: "glyphs", rows: [["one", "Ω"]] })],
                ]),
                writtenIn: new Map([
                    ["vyl", { map: "glyphs", font: "serif" }],
                    ["foreign", { map: "glyphs", font: "sans" }],
                ]),
            };
            const source = [
                `\`\`\`verse {col1=${entry}}`,
                "[one [one]{lang=foreign} [one]{lang=vyl}]{lang=vyl}",
                "```",
            ].join("\n");
            expect(scanRuns(source, mixed).errors).toEqual([]);
            const rendered = renderRuns(source, mixed).markdown;
            expect(rendered).toContain(`[${outer} [Ω]{lang=fr .font-sans}`);
            expect(rendered).toContain(
                `[${same}]{lang=art-x-vyl${entry === "vyl" ? "" : " .font-serif"}}`,
            );
        },
    );
});
