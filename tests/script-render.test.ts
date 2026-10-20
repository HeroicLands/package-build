/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **Marked text rendered on every target.** Goldens for `renderRuns` and for
 * what each target makes of its output: a roman run in a language, a run
 * mapped into a left-to-right face, a run mapped into a right-to-left face, a
 * right-to-left block, a poetry fence, and the generic families.
 *
 * The fixture fonts package lists each face's real code points, and the maps
 * here are written out row by row, so every expectation is a literal.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { renderBlocks } from "../engine/content-blocks.mjs";
import { renderRuns, runContext, scanRuns } from "../engine/content-scripts.mjs";
import { renderSpans } from "../engine/content-spans.mjs";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";
import { markupFindings } from "../engine/markup-validation.mjs";
import { bookTypstPreamble, markdownToTypst, renderBook } from "../engine/pdf-render.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "script-fonts", "fonts");

/** A mapping note's record, as the content index carries it. */
const mapNote = (shortcode: string, map: object) => ({
    type: "doc",
    shortcode,
    address: { canonical: `demo-note-doc-${shortcode}` },
    data: { map },
});

/** Semaron Kuriale's letters, and its `th`, from roman. */
const VYL_SEMARON = {
    name: "vyl-semaron",
    vowels: "aeiou",
    rows: [
        ["th", "\u{F0250}"],
        ["t", "\u{F0241}"],
        ["h", "\u{F0236}"],
        ["i", "\u{F0237}"],
        ["r", "\u{F023F}"],
        ["u", "\u{F0242}"],
        ["m", "\u{F023B}"],
        ["a", "\u{F0230}"],
        ["n", "\u{F023C}"],
        ["s", "\u{F0240}"],
        ["o", "\u{F023D}"],
        ["k", "\u{F0239}"],
        [".", "\u{F0268}"],
        ["*", "\u{F0268}"],
    ],
};

/** Qalezu Hand's consonants, with Khelathi's vowels dropped. */
const KHEL_QALEZU = {
    name: "khel-qalezu",
    rows: [
        ["a", ""],
        ["o", ""],
        ["u", ""],
        ["n", "\u{1EA08}"],
        ["l", "\u{1EA00}"],
        ["gh", "\u{1EA0D}"],
        ["g", "\u{1EA06}"],
        ["r", "\u{1EA01}"],
        ["z", "\u{1EA04}"],
        [".", ""],
    ],
};

let root: string;
let ctx: ReturnType<typeof runContext>;

beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "script-render-")));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "demo" }));
    fs.cpSync(FIXTURE, path.join(root, "node_modules", "@heroiclands", "fonts"), {
        recursive: true,
    });
    ctx = runContext(
        {
            rootDir: root,
            languages: {
                vyl: { tag: "art-x-vyl" },
                khel: { tag: "art-x-khel" },
            },
        },
        [mapNote("vylsemaron", VYL_SEMARON), mapNote("khelqalezu", KHEL_QALEZU)],
    );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const render = (source: string) => renderRuns(source, ctx).markdown;

const BAN = /<\/?(?:bdo|bdi)\b|[\u200E\u200F\u202A-\u202E\u2066-\u2069]/;

/** `thrima` in Semaron: `th` is one letter. */
const THRIMA = "\u{F0250}\u{F023F}\u{F0237}\u{F023B}\u{F0230}";
/** `sorima` in Semaron. */
const SORIMA = "\u{F0240}\u{F023D}\u{F023F}\u{F0237}\u{F023B}\u{F0230}";
/** `anlagh gar` in Qalezu: the vowels drop and `gh` is one letter. */
const ANLAGH = "\u{1EA08}\u{1EA00}\u{1EA0D} \u{1EA06}\u{1EA01}";

const ROMAN = "Said [Daimela, helthos.]{lang=vyl} twice.";
const LTR = "Said [thrima sorima.]{lang=vyl font=semaron-kuriale map=vyl-semaron} twice.";
const RTL = "Said [anlagh gar.]{lang=khel font=qalezu-hand map=khel-qalezu} twice.";
const BLOCK = [
    "::: {#verse .note lang=khel font=qalezu-hand map=khel-qalezu}",
    "anlagh gar.",
    "  zul.",
    "",
    "gar.",
    ":::",
].join("\n");
const POEM = [
    "```poetry {form=epic lang=vyl font=semaron-kuriale map=vyl-semaron}",
    "thrima sorima",
    "  thrima",
    "```",
].join("\n");
const RTL_POEM = [
    "```poetry {#lay lang=khel font=qalezu-hand map=khel-qalezu}",
    "anlagh gar",
    "  zul",
    "```",
].join("\n");
const ALL = [ROMAN, "", LTR, "", RTL, "", BLOCK, "", POEM, "", RTL_POEM, ""].join("\n");

const SEMARON_P = "\u{F0268}";
const ZUL = "\u{1EA04}\u{1EA00}";
const GAR = "\u{1EA06}\u{1EA01}";

describe("renderRuns, goldens", () => {
    it("tags a roman run with the language's tag and leaves its text", () => {
        expect(render(ROMAN)).toBe("Said [Daimela, helthos.]{lang=art-x-vyl} twice.");
    });

    it("leaves a run in a real language's tag as written", () => {
        expect(render("[ad _astra_]{lang=la}")).toBe("[ad _astra_]{lang=la}");
    });

    it("maps a left-to-right run, longest match first, and sets it in the face's class", () => {
        expect(render(LTR)).toBe(
            `Said [${THRIMA} ${SORIMA}${SEMARON_P}]{lang=art-x-vyl .script .hl-semaron-kuriale} twice.`,
        );
    });

    it("sets text with no map as typed", () => {
        expect(render(`[${THRIMA}]{font=semaron-kuriale}`)).toBe(
            `[${THRIMA}]{.script .hl-semaron-kuriale}`,
        );
    });

    it("escapes the punctuation a run holds, so no later pass reads it as markup", () => {
        expect(render("[Ka <<tor>> [yes]! @#$%^& a_b]{lang=vyl font=serif}")).toBe(
            "[Ka \\<\\<tor\\>\\> \\[yes\\]\\! @\\#$%^\\& a\\_b]{lang=art-x-vyl .font-serif}",
        );
        expect(render("[Ka \\[ tor]{lang=vyl font=mono}")).toBe(
            "[Ka \\[ tor]{lang=art-x-vyl .font-mono}",
        );
    });

    it("maps a right-to-left run, dropping what a row writes as nothing", () => {
        expect(render(RTL)).toBe(
            `Said [${ANLAGH}]{lang=art-x-khel .script .hl-qalezu-hand} twice.`,
        );
    });

    it("keeps a span's own id, classes and attributes", () => {
        expect(render("[gar]{#a .name title=x lang=khel font=qalezu-hand map=khel-qalezu}")).toBe(
            `[${GAR}]{lang=art-x-khel #a .name .script .hl-qalezu-hand title=x}`,
        );
    });

    it("maps a right-to-left block line by line, and marks the block right to left", () => {
        expect(render(BLOCK)).toBe(
            [
                "::: {lang=art-x-khel #verse .note .script .script-block .hl-qalezu-hand dir=rtl}",
                ANLAGH,
                "  " + ZUL,
                "",
                GAR,
                ":::",
            ].join("\n"),
        );
    });

    it("sets a run inside a block by its own keys over the block's", () => {
        const source = [
            "::: {lang=vyl font=semaron-kuriale map=vyl-semaron}",
            "thrima [Tor]{font=serif map=khel-qalezu} thrima",
            ":::",
        ].join("\n");
        expect(render(source)).toBe(
            [
                "::: {lang=art-x-vyl .script .script-block .hl-semaron-kuriale}",
                `${THRIMA} [T\u{1EA01}]{lang=art-x-vyl .font-serif} ${THRIMA}`,
                ":::",
            ].join("\n"),
        );
    });

    it("gives a poetry fence the tag and the class, and maps each verse", () => {
        expect(render(POEM)).toBe(
            [
                "```poetry {lang=art-x-vyl .script .hl-semaron-kuriale form=epic}",
                `${THRIMA} ${SORIMA}`,
                `  ${THRIMA}`,
                "```",
            ].join("\n"),
        );
    });

    it("maps a right-to-left poetry fence and marks it right to left", () => {
        expect(render(RTL_POEM)).toBe(
            [
                "```poetry {lang=art-x-khel #lay .script .hl-qalezu-hand dir=rtl}",
                ANLAGH,
                "  " + ZUL,
                "```",
            ].join("\n"),
        );
    });

    it("sets the generic families in their classes, unchecked", () => {
        expect(render("[q 7 ✓]{font=mono}")).toBe("[q 7 ✓]{.font-mono}");
        expect(render("::: {font=sans}\nx\n:::")).toBe("::: {.font-sans}\nx\n:::");
    });

    it("renders no run that is faulty", () => {
        const faulty = "[x]{lang=vyl font=nowhere} [y]{lang=q} [q]{font=semaron-kuriale}";
        expect(render(faulty)).toBe(faulty);
    });

    it("keeps every line, whatever it rewrites", () => {
        const out = render(ALL);
        expect(out.split("\n")).toHaveLength(ALL.split("\n").length);
        const multi = "[gar\nnal\nzul]{lang=khel font=qalezu-hand map=khel-qalezu}";
        expect(render(multi).split("\n")).toHaveLength(3);
    });

    it("emits no bdo, bdi or direction control character", () => {
        expect(render(ALL)).not.toMatch(BAN);
    });

    it("is idempotent in what it leaves unmarked", () => {
        const plain = "Nothing is marked here.\n\n```poetry {form=epic}\nA\n```\n";
        expect(render(plain)).toBe(plain);
    });
});

describe("the site", () => {
    const site = (source: string) =>
        renderSpans(
            renderBlocks(renderRuns(source, ctx, undefined, { target: "site" }).markdown, "web")
                .markdown,
        ).markdown;

    it("tags a roman run", () => {
        expect(site(ROMAN)).toContain('<span lang="art-x-vyl">Daimela, helthos.</span>');
    });

    it("sets a mapped run in its face's class", () => {
        expect(site(LTR)).toContain(
            `<span class="script hl-semaron-kuriale" lang="art-x-vyl" data-pagefind-ignore="true">${THRIMA} ${SORIMA}${SEMARON_P}</span>`,
        );
        expect(site(RTL)).toContain(
            `<span class="script hl-qalezu-hand" lang="art-x-khel" data-pagefind-ignore="true">${ANLAGH}</span>`,
        );
    });

    it("sets a generic family in its class", () => {
        expect(site("[x]{font=mono}")).toContain('<span class="font-mono">x</span>');
    });

    it("sets a right-to-left block with dir", () => {
        expect(site(BLOCK)).toContain(
            '<div class="note script script-block hl-qalezu-hand" id="verse" lang="art-x-khel" dir="rtl" data-pagefind-ignore="true">',
        );
    });

    it("sets a poetry fence with its class and tag", () => {
        expect(site(POEM)).toContain(
            '<div class="poetry script hl-semaron-kuriale" lang="art-x-vyl" data-form="epic" data-pagefind-ignore="true">',
        );
        expect(site(RTL_POEM)).toContain(
            '<div class="poetry script hl-qalezu-hand" id="lay" lang="art-x-khel" dir="rtl" data-pagefind-ignore="true">',
        );
    });

    it("keeps the face's code points out of search, and no generic family's", () => {
        expect(renderRuns(LTR, ctx, undefined, { target: "site" }).markdown).toContain(
            "data-pagefind-ignore=true",
        );
        expect(site("[x]{font=mono}")).not.toContain("data-pagefind-ignore");
    });

    it("emits no bdo, bdi or direction control character", () => {
        expect(site(ALL)).not.toMatch(BAN);
    });
});

describe("Foundry", () => {
    const foundry = (source: string) =>
        renderFoundryMarkdown(source, undefined, undefined, undefined, undefined, ctx);

    it("tags and sets a run", () => {
        expect(foundry(ROMAN)).toContain('<span lang="art-x-vyl">Daimela, helthos.</span>');
        expect(foundry(LTR)).toContain(
            `<span class="script hl-semaron-kuriale" lang="art-x-vyl">${THRIMA} ${SORIMA}${SEMARON_P}</span>`,
        );
        expect(foundry(RTL)).toContain(
            `<span class="script hl-qalezu-hand" lang="art-x-khel">${ANLAGH}</span>`,
        );
    });

    it("sets a right-to-left block and a poetry fence", () => {
        expect(foundry(BLOCK)).toContain(
            '<div class="note script script-block hl-qalezu-hand" id="verse" lang="art-x-khel" dir="rtl">',
        );
        expect(foundry(POEM)).toContain(
            '<div class="poetry script hl-semaron-kuriale" lang="art-x-vyl" data-form="epic">',
        );
    });

    it("renders marked text as written when it is given no context", () => {
        expect(renderFoundryMarkdown(ROMAN)).not.toContain("art-x-vyl");
    });

    it("writes no site-search marker", () => {
        expect(foundry(ALL)).not.toContain("pagefind");
    });

    it("emits no bdo, bdi or direction control character", () => {
        expect(foundry(ALL)).not.toMatch(BAN);
    });
});

describe("Typst", () => {
    const typst = (source: string) => markdownToTypst(source, { runs: ctx });

    it("maps each face's class, and each generic family's, to its family in the preamble", () => {
        const preamble = bookTypstPreamble(ctx, {
            serif: "Libertinus Serif",
            sans: "Libertinus Sans",
            mono: "DejaVu Sans Mono",
        });
        expect(preamble).toContain(
            '#let book-script-fonts = ("hl-semaron-kuriale": (family: "Semaron Kuriale", features: ()), ' +
                '"hl-pirzath-hand-lifted": (family: "Pirzath Hand", features: ()), ' +
                '"hl-thuravark-carved": (family: "Thuravark Carved", features: ("ss01", "liga")), ' +
                '"hl-qalezu-hand": (family: "Qalezu Hand", features: ()), ' +
                '"font-mono": (family: "DejaVu Sans Mono", features: ()), ' +
                '"font-serif": (family: "Libertinus Serif", features: ()), ' +
                '"font-sans": (family: "Libertinus Sans", features: ()))',
        );
        expect(bookTypstPreamble()).toContain("#let book-script-fonts = (:)");
        expect(preamble).toMatch(/#let book-script-text\(body, classes: \(\), lang: none\)/);
        expect(preamble).toMatch(/#let book-span\(body, classes: \(\), lang: none\)/);
    });

    it("sets a generic family in the book's own font", () => {
        const book = renderBook({ sections: [], runs: ctx, fonts: { serif: "Book Serif" } });
        expect(book).toContain('"font-serif": (family: "Book Serif", features: ())');
    });

    it("leaves a roman run in an invented language untagged, and tags a real one", () => {
        expect(typst(ROMAN)).toContain("#box[Daimela, helthos.]");
        expect(typst("[ad astra]{lang=la}")).toContain(
            '#book-span(classes: (), lang: "la")[ad astra]',
        );
        expect(typst("[colour]{lang=en-GB}")).toContain('lang: "en"');
    });

    it("sets a mapped run in its face's class", () => {
        expect(typst(LTR)).toContain(
            `#book-span(classes: ("script", "hl-semaron-kuriale"))[${THRIMA} ${SORIMA}${SEMARON_P}]`,
        );
        expect(typst(RTL)).toContain(
            `#book-span(classes: ("script", "hl-qalezu-hand"))[${ANLAGH}]`,
        );
    });

    it("sets a right-to-left block right to left in its class", () => {
        const out = typst(BLOCK);
        expect(out).toContain(
            '#block(width: 100%)[#set text(dir: rtl)\n#book-script-text(classes: ("note", "script", "script-block", "hl-qalezu-hand"))[',
        );
        expect(out).toContain(ANLAGH);
    });

    it("sets a left-to-right block and a generic block without a direction", () => {
        const out = typst(
            ["::: {lang=vyl font=semaron-kuriale map=vyl-semaron}", "thrima", ":::"].join("\n"),
        );
        expect(out).toContain(
            '#block(width: 100%)[#book-script-text(classes: ("script", "script-block", "hl-semaron-kuriale"))[',
        );
        expect(out).not.toContain("dir: rtl");
        expect(typst("::: {font=mono}\nx\n:::")).toContain(
            '#block(width: 100%)[#book-script-text(classes: ("font-mono",))[',
        );
    });

    it("sets a poetry fence in its class", () => {
        expect(typst(POEM)).toContain(
            '#block(width: 100%)[#book-script-text(classes: ("script", "hl-semaron-kuriale"))[',
        );
        expect(typst(RTL_POEM)).toContain("#set text(dir: rtl)");
    });

    it("writes no site-search marker", () => {
        expect(renderRuns(ALL, ctx, undefined, { target: "book" }).markdown).not.toContain(
            "pagefind",
        );
        expect(typst(ALL)).not.toContain("pagefind");
    });

    it("emits no bdo, bdi or direction control character", () => {
        expect(typst(ALL)).not.toMatch(BAN);
        expect(bookTypstPreamble(ctx)).not.toMatch(BAN);
    });
});

describe("faults", () => {
    it("reports a character the face does not draw, at the character", () => {
        const found = scanRuns(
            "Said [gar 7]{lang=khel font=qalezu-hand map=khel-qalezu}.",
            ctx,
        ).errors;
        expect(found).toEqual([
            {
                line: 1,
                column: 11,
                message:
                    "`7` (U+0037) is not drawn by the font `qalezu-hand`, and the map `khel-qalezu` has no row for it",
            },
        ]);
    });

    it("locates an undrawn character on a later line of a block", () => {
        const found = scanRuns(
            ["::: {lang=khel font=qalezu-hand map=khel-qalezu}", "gar", "  ga7", ":::"].join("\n"),
            ctx,
        ).errors;
        expect(found.map((e: { line: number; column: number }) => [e.line, e.column])).toEqual([
            [3, 5],
        ]);
    });

    it("leaves a run with an undrawn character as written", () => {
        const bad = "[gar 7]{lang=khel font=qalezu-hand map=khel-qalezu}";
        expect(render(bad)).toBe(bad);
    });

    it("reports a near-miss language as a warning, beside the errors", () => {
        const found = markupFindings("[x]{lang=vly}", "a.md", undefined, ctx);
        expect(found).toEqual([
            {
                file: "a.md",
                line: 1,
                column: 10,
                severity: "warning",
                message: "`vly` is read as a BCP 47 tag; did you mean the declared language `vyl`?",
            },
        ]);
    });
});
