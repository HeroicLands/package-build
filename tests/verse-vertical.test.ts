/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **Verse in a script written in columns.** A verse div whose face belongs to
 * a script note stating `direction: vertical-rl` sets each stanza's lines in
 * that face as columns read from the right: as a `.verse-columns` block on the
 * site, in the preview and in Foundry, and as column images drawn from the
 * face's outlines in the book. A paired Roman presentation stays in lines
 * beside the columns, a column holds at most 40 characters on every surface,
 * and a verse in a script written in lines is set in rows, unchanged by the
 * script's direction. The class is written by the build alone.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { renderRuns, runContext } from "../engine/content-scripts.mjs";
import { scanVerse, VERTICAL_VERSE_CLASS } from "../engine/content-verse.mjs";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";
import { BOOK_RUBRIC } from "../engine/font-outlines.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";
import { encodingContext } from "./helpers/encoding.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "script-fonts", "fonts");

const scriptNote = (shortcode: string, script: object) => ({
    type: "skill",
    subType: "script",
    shortcode,
    address: { canonical: `demo-note-skill-${shortcode}` },
    data: { script },
});

const native = (form: string, text: string) => ({
    form,
    class: "n",
    gloss: form,
    native: [{ enc: "teng-chou", text }],
});

const CHEN = "\u{F101F}";
const TENG = "\u{F1013}";
const CHOU = "\u{F103E}";
const HING = "\u{F1057}";
const TAN = "\u{F1014}";
/** The invisible control the test encodings write for a line ending. */
const LINE_END = "\u{E010C}";

let root: string;
let bare: string;
let ctx: ReturnType<typeof runContext>;
let bareCtx: ReturnType<typeof runContext>;

const makeCtx = (dir: string) =>
    encodingContext(
        {
            rootDir: dir,
            contentPackage: "demo",
            languages: {
                tsu: { tag: "art-x-tsu", note: "skill-tantsoulng" },
                sem: { tag: "art-x-sem" },
            },
        },
        [
            {
                type: "skill",
                subType: "language",
                shortcode: "tantsoulng",
                address: { canonical: "demo-note-skill-tantsoulng" },
                data: {
                    roman: "abcdefghijklmnopqrstuvwxyz",
                    words: [
                        native("chen", CHEN),
                        native("teng", TENG),
                        native("chou", CHOU),
                        native("hing", HING),
                        native("tan", TAN),
                    ],
                },
            },
            {
                type: "doc",
                shortcode: "tengchoumap",
                address: { canonical: "demo-note-doc-tengchoumap" },
                encodingDefinition: {
                    name: "teng-chou",
                    noLetters: true,
                    fonts: [{ font: "teng-chou" }],
                    rows: [
                        [" ", ""],
                        ["*", "\u{F1014}"],
                    ],
                },
            },
            {
                type: "doc",
                shortcode: "semaronmap",
                address: { canonical: "demo-note-doc-semaronmap" },
                encodingDefinition: {
                    name: "semaron",
                    noLetters: true,
                    fonts: [{ font: "semaron-kuriale" }],
                    rows: [
                        ["s", "\u{F0200}"],
                        ["a", "\u{F0201}"],
                        ["y", "\u{F0202}"],
                        ["*", "\u{F0203}"],
                    ],
                },
            },
            scriptNote("tengchouscript", {
                fonts: ["teng-chou"],
                emphasis: "rubric",
                direction: "vertical-rl",
            }),
            scriptNote("semaronscrpt", { fonts: ["semaron-kuriale"], emphasis: "rubric" }),
        ],
    );

beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "verse-vertical-")));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "demo" }));
    fs.cpSync(FIXTURE, path.join(root, "node_modules", "@heroiclands", "fonts"), {
        recursive: true,
    });
    ctx = makeCtx(root);
    bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "verse-vertical-bare-")));
    fs.writeFileSync(path.join(bare, "package.json"), JSON.stringify({ name: "demo" }));
    fs.cpSync(FIXTURE, path.join(bare, "node_modules", "@heroiclands", "fonts"), {
        recursive: true,
    });
    const manifest = path.join(bare, "node_modules", "@heroiclands", "fonts", "fonts.json");
    const fonts = JSON.parse(fs.readFileSync(manifest, "utf8"));
    for (const family of fonts.families) delete family.files?.ttf;
    fs.writeFileSync(manifest, JSON.stringify(fonts));
    bareCtx = makeCtx(bare);
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
});

const ORIGINAL =
    "::: {.verse form=song work=tower lang=tsu enc=teng-chou}\n" +
    "chen teng/\n" +
    ".chou hing\n" +
    "\n" +
    "tan\n" +
    ":::\n";
const ENGLISH =
    "::: {.verse form=song work=tower lang=en}\n" +
    "The first line/\n" +
    ".the second\n" +
    "\n" +
    "The third\n" +
    ":::\n";

/**
 * A work in a script written in lines, a version in its script and one in
 * English, and its markup on the site and in Foundry and its book source,
 * character for character.
 */
const LINES_SOURCE =
    "::: {.verse form=song work=w lang=sem enc=semaron}\n" +
    "[say]{.speaker}/\n" +
    "say/\n" +
    "..say\n" +
    "\n" +
    '--- {.canto title="Two"}\n' +
    "\n" +
    "say\n" +
    ":::\n\n" +
    "::: {.verse form=song work=w lang=en}\n" +
    "[Voice]{.speaker}/\n" +
    "Say/\n" +
    "..say\n" +
    "\n" +
    '--- {.canto title="Two"}\n' +
    "\n" +
    "Say\n" +
    ":::\n";
const LINES_HTML =
    '<div class="verse verse-paired verse-labelled" data-form="song" data-work="w">\n' +
    '<div class="verse-stanza"><span class="verse-label">1:1</span>\n' +
    '<p><span class="verse-row"><span class="verse-native script hl-semaron-kuriale" lang="art-x-sem"><span class="verse-line"><span class="speaker script hl-semaron-kuriale" lang="art-x-sem">\u{F0200}\u{F0201}\u{F0202}</span>\u{E010C}</span></span><span class="verse-roman"><span class="verse-line"><span class="speaker">say</span></span></span></span>\n' +
    '<span class="verse-row"><span class="verse-native script hl-semaron-kuriale" lang="art-x-sem"><span class="verse-line">\u{F0200}\u{F0201}\u{F0202}\u{E010C}</span></span><span class="verse-roman"><span class="verse-line">say</span></span></span>\n' +
    '<span class="verse-row"><span class="verse-native script hl-semaron-kuriale" lang="art-x-sem"><span class="verse-line i2">\u{F0200}\u{F0201}\u{F0202}</span></span><span class="verse-roman"><span class="verse-line i2">say</span></span></span></p>\n' +
    "</div>\n" +
    '<p><span class="verse-canto-heading" role="heading" aria-level="3">Two</span><span class="verse-canto-break" aria-hidden="true"><span class="verse-native script hl-semaron-kuriale" lang="art-x-sem">\u{F0203}\u{F0203}\u{F0203}</span></span></p>\n' +
    '<div class="verse-stanza"><span class="verse-label">2:1</span>\n' +
    '<p><span class="verse-row"><span class="verse-native script hl-semaron-kuriale" lang="art-x-sem"><span class="verse-line">\u{F0200}\u{F0201}\u{F0202}</span></span><span class="verse-roman"><span class="verse-line">say</span></span></span></p>\n' +
    "</div>\n" +
    "</div>\n" +
    '<div class="verse verse-labelled" lang="en" data-form="song" data-work="w">\n' +
    '<div class="verse-stanza"><span class="verse-label">1:1</span>\n' +
    '<p><span class="verse-line"><span class="speaker" lang="en">Voice</span></span><br>\n' +
    '<span class="verse-line">Say</span><br>\n' +
    '<span class="verse-line i2">say</span></p>\n' +
    "</div>\n" +
    '<p><span class="verse-canto-heading" role="heading" aria-level="3">Two</span><span class="verse-canto-break" aria-hidden="true"></span></p>\n' +
    '<div class="verse-stanza"><span class="verse-label">2:1</span>\n' +
    '<p><span class="verse-line">Say</span></p>\n' +
    "</div>\n" +
    "</div>\n";
const LINES_TYPST =
    "#block(width: 100%)[#set text(dir: ltr)\n" +
    "#grid(columns: (2.5em, 1fr, 1fr), column-gutter: 1.5em, row-gutter: 0.35em,\n" +
    '  [#text(size: 0.75em, fill: luma(45%))[1:1]], [#book-script-text(classes: ("script", "hl-semaron-kuriale"))[#book-span(classes: ("speaker", "script", "hl-semaron-kuriale"))[\u{F0200}\u{F0201}\u{F0202}]\u{E010C}]], [#book-span(classes: ("speaker",))[say]],\n' +
    '  [], [#book-script-text(classes: ("script", "hl-semaron-kuriale"))[\u{F0200}\u{F0201}\u{F0202}\u{E010C}]], [say],\n' +
    '  [], [#book-script-text(classes: ("script", "hl-semaron-kuriale"))[#h(2.5em)\u{F0200}\u{F0201}\u{F0202}]], [#h(2.5em)say]\n' +
    ")\n" +
    "\n" +
    '#book-script-text(classes: ("script", "hl-semaron-kuriale"))[\u{F0203}\u{F0203}\u{F0203}]\n' +
    "#v(0.75em)\n" +
    "#align(center)[#line(length: 25%, stroke: 0.4pt)]\n" +
    "#v(0.75em)\n" +
    "#heading(level: 3, outlined: false, bookmarked: false)[Two]\n" +
    "\n" +
    "#set text(dir: ltr)\n" +
    "#grid(columns: (2.5em, 1fr, 1fr), column-gutter: 1.5em, row-gutter: 0.35em,\n" +
    '  [#text(size: 0.75em, fill: luma(45%))[2:1]], [#book-script-text(classes: ("script", "hl-semaron-kuriale"))[\u{F0200}\u{F0201}\u{F0202}]], [say]\n' +
    ")]\n" +
    "\n" +
    '#block(width: 100%)[#grid(columns: (2.5em, 1fr), column-gutter: 0.5em, [#text(size: 0.75em, fill: luma(45%))[1:1]], [#book-script-text(classes: ("verse",), lang: "en")[#book-span(classes: ("speaker",), lang: "en")[Voice] \\\n' +
    "Say \\\n" +
    "#h(2.5em)say]])\n" +
    "\n" +
    "#v(0.75em)\n" +
    "#align(center)[#line(length: 25%, stroke: 0.4pt)]\n" +
    "#v(0.75em)\n" +
    "#heading(level: 3, outlined: false, bookmarked: false)[Two]\n" +
    "\n" +
    '#grid(columns: (2.5em, 1fr), column-gutter: 0.5em, [#text(size: 0.75em, fill: luma(45%))[2:1]], [#book-script-text(classes: ("verse",), lang: "en")[Say]])]';

describe("the rewrite", () => {
    it("marks a verse div in a script written in columns, and no other", () => {
        const vertical = renderRuns(ORIGINAL, ctx, undefined, { target: "foundry" });
        expect(vertical.errors).toEqual([]);
        expect(vertical.markdown.split("\n")[0]).toContain(`.${VERTICAL_VERSE_CLASS}`);
        const lines = renderRuns(
            "::: {.verse lang=sem enc=semaron}\nsay/\nsay\n:::\n",
            ctx,
            undefined,
            { target: "foundry" },
        );
        expect(lines.markdown).not.toContain(VERTICAL_VERSE_CLASS);
        const roman = renderRuns(
            "::: {.verse lang=tsu enc=default}\nchen teng\n:::\n",
            ctx,
            undefined,
            { target: "foundry" },
        );
        expect(roman.markdown).not.toContain(VERTICAL_VERSE_CLASS);
    });
});

describe("the site, the preview and Foundry", () => {
    const html = () =>
        renderFoundryMarkdown(
            `${ENGLISH}\n${ORIGINAL}`,
            undefined,
            undefined,
            undefined,
            undefined,
            ctx,
        );

    it("sets each stanza's native lines as columns, a column to a line, the Roman beside them", () => {
        const out = html();
        const stanzas = [
            ...out.matchAll(
                /<div class="verse-stanza">\n?<span class="verse-label">([^<]*)<\/span>\n?<p><span class="verse-pair"><span class="verse-native script hl-teng-chou verse-columns" lang="art-x-tsu">([^]*?)<\/span><span class="verse-roman">([^]*?)<\/span><\/span><\/p>/g,
            ),
        ];
        expect(stanzas.map((match) => match[1])).toEqual(["1", "2"]);
        // Nothing stands between two lines: under the preserved white space
        // of the columns and the Roman lines, a newline there is a column or
        // a line of its own.
        expect(stanzas[0][2]).toBe(
            `<span class="verse-line">${CHEN}${TENG}${LINE_END}</span>` +
                `<span class="verse-line i1">${CHOU}${HING}</span>`,
        );
        expect(stanzas[0][3]).toBe(
            '<span class="verse-line">chen teng</span>' +
                '<span class="verse-line i1">chou hing</span>',
        );
        expect(stanzas[1][2]).toBe(`<span class="verse-line">${TAN}</span>`);
        expect(out).toMatch(
            /<div class="verse verse-vertical verse-paired verse-labelled" data-form="song" data-work="tower">/,
        );
        expect(out).not.toContain("verse-row");
    });

    it("keeps the English version of the work in lines beside the original", () => {
        const out = html();
        expect(out).toMatch(
            /<div class="verse verse-labelled" lang="en" data-form="song" data-work="tower">/,
        );
        const english = out.slice(0, out.indexOf("verse-vertical"));
        expect(english).not.toContain("verse-columns");
        expect(english).toContain('<span class="verse-line">The first line</span><br>');
        expect(english).toContain('<span class="verse-line i1">the second</span>');
    });

    it("sets a work in a script written in lines in rows, character for character", () => {
        expect(
            renderFoundryMarkdown(LINES_SOURCE, undefined, undefined, undefined, undefined, ctx),
        ).toBe(LINES_HTML);
    });

    it("styles the columns in Foundry and on the site", () => {
        const base = fs.readFileSync(
            path.join(HERE, "..", "assets", "styles", "content-base.css"),
            "utf8",
        );
        const site = fs.readFileSync(
            path.join(HERE, "..", "site-theme", "static", "css", "style.css"),
            "utf8",
        );
        for (const css of [base, site]) {
            expect(css).toMatch(
                /\.verse-vertical\s+\.verse-columns\s*\{[^}]*writing-mode:\s*vertical-rl/,
            );
            expect(css).toMatch(/\.verse-vertical\s+\.verse-pair\s*\{[^}]*display:\s*grid/);
            expect(css).toMatch(
                /\.verse-vertical\s+\.verse-columns\s*\{[^}]*max-inline-size:\s*40em[^}]*white-space:\s*pre-wrap/,
            );
        }
    });
});

describe("the class", () => {
    it("is refused where a verse div writes it, at the class", () => {
        const source = "::: {.verse .verse-vertical lang=en}\nThe first line\n:::\n";
        expect(scanVerse(source).errors).toEqual([
            {
                line: 1,
                column: 13,
                message: ".verse-vertical is set from the script note's direction, not written",
            },
        ]);
    });

    it("is refused on a verse div in a script written in columns too", () => {
        const source = ORIGINAL.replace("{.verse ", "{.verse .verse-vertical ");
        expect(
            scanVerse(source, { checkWorks: false }).errors.map((error) => error.message),
        ).toEqual([".verse-vertical is set from the script note's direction, not written"]);
    });
});

describe("the book", () => {
    it("draws each line as a column image read right to left, the Roman beside it", () => {
        const typst = markdownToTypst(`${ENGLISH}\n${ORIGINAL}`, { runs: ctx });
        const columns = [
            ...typst.matchAll(
                /#box\(image\(bytes\("<svg [^\n]*?"\), format: "svg", height: (\d+)em, alt: "([^"]*)"\)\)/g,
            ),
        ];
        expect(columns.map((match) => match[2])).toEqual(["chen teng", "chou hing", "tan"]);
        // The longest column is the indented line: one cell for its indent.
        expect(new Set(columns.map((match) => match[1]))).toEqual(new Set(["3"]));
        expect(typst).toMatch(/#block\(width: 100%\)\[#set text\(dir: rtl\)\n#box/);
        expect(typst).toMatch(/\)\)\u200B#box/);
        expect(typst).toContain("chen teng \\\n#h(1.25em)chou hing");
        expect(typst).toMatch(/#grid\(columns: \(2\.5em, 1fr, 1fr\)/);
    });

    it("leaves the first cell of an indented column empty", () => {
        const typst = markdownToTypst(ORIGINAL.replace("work=tower ", ""), { runs: ctx });
        const svgs = [...typst.matchAll(/#box\(image\(bytes\("(<svg [^\n]*?)"\)/g)].map(
            (match) => match[1],
        );
        const ys = (svg: string) =>
            [...svg.matchAll(/<use href=\\"#g\d+\\" x=\\"[-\d.]+\\" y=\\"([-\d.]+)\\"/g)].map(
                (match) => Number(match[1]),
            );
        expect(Math.min(...ys(svgs[1]))).toBeGreaterThan(Math.min(...ys(svgs[0])));
    });

    it("continues a long line in the next column, sharing its words among its columns", () => {
        const words = Array.from({ length: 45 }, () => "chen");
        const typst = markdownToTypst(
            `::: {.verse lang=tsu enc=teng-chou}\n${words.join(" ")}\n:::\n`,
            { runs: ctx },
        );
        const columns = [
            ...typst.matchAll(
                /#box\(image\(bytes\("<svg [^\n]*?"\), format: "svg", height: (\d+)em, alt: "([^"]*)"\)\)/g,
            ),
        ];
        expect(columns.map((match) => match[1])).toEqual(["40", "40"]);
        expect(columns.map((match) => match[2].split(" ").length)).toEqual([40, 5]);
        expect(columns.map((match) => match[2]).join(" ")).toBe(words.join(" "));
    });

    const columnsIn = (typst: string) => [
        ...typst.matchAll(
            /#box\(image\(bytes\("(<svg [^\n]*?)"\), format: "svg", height: (\d+)em, alt: "([^"]*)"\)\)/g,
        ),
    ];

    it("keeps an editorial gap as one empty cell that does not lengthen the columns", () => {
        const typst = markdownToTypst(
            "::: {.verse lang=tsu enc=teng-chou}\nchen [lacuna and more]{lang=zxx} teng\n:::\n",
            { runs: ctx },
        );
        const columns = columnsIn(typst);
        expect(columns).toHaveLength(1);
        // chen, the gap, teng
        expect(columns[0][2]).toBe("3");
        expect(columns[0][1].match(/<use /g)).toHaveLength(2);
    });

    it("sets a canto break inside a vertical verse as a rule and a heading between columns", () => {
        const source =
            "::: {.verse form=song work=tower lang=tsu enc=teng-chou}\n" +
            "chen teng/\n" +
            ".chou\n" +
            "\n" +
            '--- {.canto title="Two"}\n' +
            "\n" +
            "chou hing\n" +
            ":::\n";
        const typst = markdownToTypst(source, { runs: ctx });
        expect(columnsIn(typst).map((match) => match[3])).toEqual([
            "chen teng",
            "chou",
            "chou hing",
        ]);
        expect(typst).toContain("#heading(level: 3, outlined: false, bookmarked: false)[Two]");
        const html = renderFoundryMarkdown(source, undefined, undefined, undefined, undefined, ctx);
        expect(html).toContain(
            '<span class="verse-canto-heading" role="heading" aria-level="3">Two</span>',
        );
        expect(html.match(/verse-columns/g)).toHaveLength(2);
    });

    it("draws script emphasis in the rubric in a book column", () => {
        const plain = markdownToTypst("::: {.verse lang=tsu enc=teng-chou}\nchen teng\n:::\n", {
            runs: ctx,
        });
        const marked = markdownToTypst("::: {.verse lang=tsu enc=teng-chou}\n*chen* teng\n:::\n", {
            runs: ctx,
        });
        expect(columnsIn(plain)[0][1]).not.toContain(BOOK_RUBRIC);
        expect(columnsIn(marked)[0][1]).toContain(BOOK_RUBRIC);
    });

    it("sets a div named by its font in columns, on the site and in the book", () => {
        const source = `::: {.verse font=teng-chou}\n${CHEN}${TENG}/\n.${CHOU}\n:::\n`;
        const html = renderFoundryMarkdown(source, undefined, undefined, undefined, undefined, ctx);
        expect(html).toMatch(/<div class="verse script hl-teng-chou verse-vertical"/);
        expect(html).toContain("verse-columns");
        const columns = columnsIn(markdownToTypst(source, { runs: ctx }));
        expect(columns).toHaveLength(2);
        expect(columns.map((match) => match[3])).toEqual([
            "Verse in Teng Chou",
            "Verse in Teng Chou",
        ]);
    });

    it("sets the verse in lines when the face has no TrueType file", () => {
        const typst = markdownToTypst(ORIGINAL, { runs: bareCtx });
        expect(typst).not.toContain("#box(image(");
        expect(typst).toContain("#book-script-text(");
    });

    it("sets a work in a script written in lines in rows, character for character", () => {
        expect(markdownToTypst(LINES_SOURCE, { runs: ctx })).toBe(LINES_TYPST);
    });
});
