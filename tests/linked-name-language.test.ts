/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { scanSpans } from "../engine/content-spans.mjs";
import { GENERIC_FONTS, renderRuns, scanRuns } from "../engine/content-scripts.mjs";
import { compileMap } from "../engine/text-maps.mjs";
import { buildWikilinkIndex, convertWikilinks, resolveWebWikilinks } from "../engine/wikilinks.mjs";
import { createRenderer } from "../engine/content-render.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";

const glyph = "\u{F0200}";
const ctx = {
    languages: { vyl: { tag: "art-x-vyl" } },
    writtenIn: new Map([["vyl", { map: "letters", font: "script" }]]),
    faces: new Map([
        [
            "script",
            {
                slug: "script",
                family: "Script",
                class: "hl-script",
                direction: "ltr",
                features: [],
                draws: new Set([glyph.codePointAt(0), "◇".codePointAt(0)]),
            },
        ],
    ]),
    maps: new Map([
        [
            "letters",
            compileMap({
                name: "letters",
                rows: [
                    ["Marendas", glyph],
                    ["Stranger", "◇"],
                ],
                fonts: ["script"],
            }),
        ],
    ]),
    wordBooks: new Map([
        ["vyl", { language: "vyl", accepts: (word: string) => word.toLowerCase() === "marendas" }],
    ]),
};
const address = "doc-target";
const uuid = "Compendium.demo.journals.JournalEntry.aaaaaaaaaaaaaaa1";
function resolve(source: string, target: string, gm = false, draft = false) {
    if (target === "foundry") {
        const index = buildWikilinkIndex(
            [
                {
                    type: "doc",
                    shortcode: "target",
                    id: "aaaaaaaaaaaaaaa1",
                    name: "Marendas",
                    gm,
                    draft,
                },
            ],
            "demo",
        );
        return convertWikilinks(source, { index, type: "doc", id: "aaaaaaaaaaaaaaa2" }).markdown;
    }
    const errors: object[] = [];
    const result = resolveWebWikilinks(source, {
        index: new Map([
            [
                "demo-note-doc-target",
                { name: "Marendas", url: "/target-only-not-a-word/", gm, draft },
            ],
        ]),
        contentPackage: "demo",
        packages: new Set(["demo"]),
        contentTypes: new Set(["doc"]),
        errors,
        ...(target === "book" ? { output: "book" } : {}),
    });
    expect(errors).toEqual([]);
    return result;
}
const source = `[Keeper of the open book, ]{lang=en}[[${address}|Marendas]]{lang=vyl .nativefont}[,]{lang=en}`;

describe("language-marked references", () => {
    it.each(["web", "foundry", "book"])(
        "maps only the linked label through %s resolution and rendering",
        (target) => {
            const resolved = resolve(source, target);
            const result = renderRuns(resolved, ctx, undefined, {
                target: target === "web" ? "site" : target,
            });
            expect(result.errors).toEqual([]);
            expect(result.markdown).toContain(
                target === "foundry" ? `@UUID[${uuid}]{${glyph}}` : "](/target-only-not-a-word/)",
            );
            expect(result.markdown).toContain("lang=art-x-vyl .script .hl-script");
            const rendered =
                target === "book" ?
                    markdownToTypst(resolved, { runs: ctx })
                :   createRenderer(target).render(resolved, { runs: ctx });
            expect(rendered).toContain(glyph);
            expect(rendered).toContain(target === "foundry" ? uuid : "/target-only-not-a-word/");
            if (target === "book")
                expect(rendered).toContain(
                    '#link("/target-only-not-a-word/")[#book-span(classes: ("script", "hl-script"))[',
                );
            else
                expect(rendered).toMatch(
                    /Keeper of the open book, <\/span><span[^>]*lang="art-x-vyl"[^>]*>.*<\/span><span lang="en">,<\/span>/,
                );
        },
    );

    it.each(["web", "foundry", "book"])(
        "keeps destination spoilers and consumes .show in %s",
        (target) => {
            const hidden = renderRuns(resolve(source, target, true), ctx).markdown;
            const shown = renderRuns(
                resolve(
                    source.replace("{lang=vyl .nativefont}", "{lang=vyl .nativefont .show}"),
                    target,
                    true,
                ),
                ctx,
            ).markdown;
            expect(hidden).toContain(".secret");
            expect(shown).not.toContain(".secret");
            expect(shown).not.toContain(".show");
            expect(hidden).toContain(glyph);
            expect(shown).toContain(glyph);
        },
    );

    it.each(["web", "foundry", "book"])(
        "retains the draft decoration around the mapped %s reference",
        (target) => {
            const result = renderRuns(resolve(source, target, false, true), ctx, undefined, {
                target: target === "web" ? "site" : target,
            });
            expect(result.errors).toEqual([]);
            expect(result.markdown).toContain(glyph);
            expect(result.markdown).toContain(
                target === "book" ? ") (draft)" : 'class="sohl-draft-link"',
            );
            if (target === "book")
                expect(
                    markdownToTypst(resolve(source, target, false, true), { runs: ctx }),
                ).toMatch(/\[󰈀\]\] \(draft\)/);
        },
    );

    it.each(["web", "foundry"])(
        "locates an unknown label rather than its %s destination",
        (target) => {
            const resolved = resolve(source.replace("|Marendas", "|Stranger"), target);
            expect(scanRuns(resolved, ctx).errors).toEqual([
                {
                    line: 1,
                    column: resolved.indexOf("Stranger") + 1,
                    message:
                        "`Stranger` is not a word of the `vyl` lexicon, a registered name, or a regular form of one; coin it in the lexicon (or register the name) first",
                },
            ]);
        },
    );

    it("keeps a link embedded in native prose forbidden", () => {
        const result = scanRuns("[Marendas [Marendas](/target/) Marendas]{lang=vyl}", ctx);
        expect(result.errors).toMatchObject([
            { column: 11, message: expect.stringContaining("holds no link") },
        ]);
    });

    it.each(["web", "foundry", "book"])(
        "keeps reference positions and sibling punctuation in %s",
        (target) => {
            for (const [before, after] of [
                ["", ", after"],
                ["before ", ", after"],
                ["before ", ""],
            ]) {
                const raw =
                    (before ? `[${before}]{lang=en}` : "") +
                    `[[${address}|Marendas]]{lang=vyl .nativefont}` +
                    (after ? `[${after}]{lang=en}` : "");
                const rewritten = renderRuns(resolve(raw, target), ctx).markdown;
                expect(rewritten.startsWith(before ? `[${before}]{lang=en}` : "[")).toBe(true);
                expect(rewritten.endsWith(after ? `[${after}]{lang=en}` : "}")).toBe(true);
                const html = createRenderer("web").render(resolve(raw, "web"), { runs: ctx });
                expect(html.replace(/<[^>]*>/g, "").trimEnd()).toBe(before + glyph + after);
            }
        },
    );

    it.each(["web", "foundry", "book"])("keeps a language-only %s reference Roman", (target) => {
        const roman = resolve(source.replace(" .nativefont", ""), target);
        const result = renderRuns(roman, ctx, undefined, {
            target: target === "web" ? "site" : target,
        });
        expect(result.errors).toEqual([]);
        expect(result.markdown).toContain("Marendas");
        expect(result.markdown).not.toContain(glyph);
        expect(result.markdown).not.toContain(".script");
        expect(result.markdown).toContain("lang=art-x-vyl");
    });

    it("keeps book draft and navigation cues in the page font while retaining spoiler scope", () => {
        const resolved = resolve(source, "book", true, true);
        const rewritten = renderRuns(resolved, ctx, undefined, { target: "book" }).markdown;
        expect(rewritten).toMatch(/\) \(draft\)\]\{\.secret\}/);
        const printed = markdownToTypst(
            resolve(`[[${address}|Marendas]]{lang=vyl .nativefont}`, "book"),
            {
                runs: ctx,
                elsewhere: { get: () => ({ title: "Core", abbreviation: "Core", page: 12 }) },
            },
        );
        expect(printed).toContain("))[󰈀] (Core~p12)");
        const local = markdownToTypst("[[Marendas](/target/)]{lang=vyl .nativefont}", {
            runs: ctx,
            links: new Map([["target", "target-anchor"]]),
            generated: true,
        });
        expect(local).toContain("))[󰈀]]~(p.~#context {");
    });

    it("leaves authored wikilinks and image/footnote priority to their parsers", () => {
        for (const raw of [
            "[[doc-target|Marendas]]{lang=vyl .nativefont}",
            "![Marendas](/image/){lang=vyl}",
            "[^one]{lang=vyl}\n\n[^one]: A footnote.",
        ]) {
            expect(scanSpans(raw).spans).toEqual([]);
        }
    });

    it.each(["name", "wide", "secret"])(
        "preserves direct class-only .%s labels as literal text",
        (name) => {
            const raw = `[[Marendas]{.${name}}](/target/)`;
            expect(scanSpans(raw).spans).toEqual([]);
            expect(createRenderer("foundry").render(raw)).toContain(`>[Marendas]{.${name}}</a>`);
        },
    );

    it.each(Object.keys(GENERIC_FONTS))("styles a font-only book reference with %s", (font) => {
        const resolved = resolve(`[[${address}|Marendas]]{font=${font}}`, "book");
        const printed = markdownToTypst(resolved, { runs: ctx });
        expect(printed).toBe(
            `#link("/target-only-not-a-word/")[#book-span(classes: ("${GENERIC_FONTS[font]}",))[Marendas]]`,
        );
    });

    it("keeps explicit map and font overrides on the reference", () => {
        const raw = `[[${address}|Marendas]]{lang=vyl font=serif map=other .nativefont}`;
        const overrides = {
            ...ctx,
            maps: new Map([
                ...ctx.maps,
                ["other", compileMap({ name: "other", rows: [["Marendas", "Other"]] })],
            ]),
        };
        const result = renderRuns(resolve(raw, "web"), overrides);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toBe(
            "[[Other](/target-only-not-a-word/)]{lang=art-x-vyl .font-serif}",
        );
    });

    it("preserves a real BCP 47 language on the link in the book", () => {
        const resolved = resolve(`[[${address}|Marendas]]{lang=fr-CA}`, "book");
        expect(scanRuns(resolved, ctx).errors).toEqual([]);
        expect(markdownToTypst(resolved, { runs: ctx })).toBe(
            '#link("/target-only-not-a-word/")[#book-span(classes: (), lang: "fr")[Marendas]]',
        );
    });

    it.each([
        "Marendas ![Marendas](/image/)",
        "[Marendas](/one/) [Marendas](/two/)",
        "[Marendas](/one/) after",
        "before @UUID[Compendium.demo.journals.JournalEntry.aaaaaaaaaaaaaaa1]{Marendas}",
    ])("refuses non-atomic native content: %s", (content) => {
        expect(scanRuns(`[${content}]{lang=vyl}`, ctx).errors.length).toBeGreaterThan(0);
    });

    it("renders split references in a verse column without losing adjacent spaces", () => {
        const poem =
            "```verse {lang=en cols=2}\n" +
            "1 " +
            source +
            "\n2 [Marendas]{lang=vyl .nativefont}\n```";
        const result = renderRuns(resolve(poem, "web"), ctx, undefined, { target: "site" });
        expect(result.errors).toEqual([]);
        expect(result.markdown).toContain(`[${glyph}](/target-only-not-a-word/)`);
        expect(createRenderer("web").render(resolve(poem, "web"), { runs: ctx })).toContain(
            "Keeper of the open book, </span><span",
        );
    });
});
