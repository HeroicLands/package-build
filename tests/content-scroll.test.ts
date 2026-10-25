/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **The `scroll` fence.** A script whose note states `direction: vertical-rl`
 * is set in columns read from the right: as a `.scroll` block on the site, in
 * the preview and in Foundry, and as panel images drawn from the face's
 * outlines in the book. The fence's own findings, the face it takes, the
 * findings on its script, its layout into columns and panels, and the outlines
 * the book draws.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import YAML from "yaml";

import {
    BOOK_SCROLL_ROWS,
    panelRoman,
    renderScroll,
    scanScrolls,
    scrollPanels,
    scrollParagraphs,
} from "../engine/content-scroll.mjs";
import { renderRuns, runContext, scanRuns } from "../engine/content-scripts.mjs";
import { fontOutlines, scrollPanelSvg } from "../engine/font-outlines.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";
import { directionsFromRecords } from "../engine/script-direction.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "script-fonts", "fonts");
const TENG_CHOU = path.join(FIXTURE, "fonts", "TengChou-Regular.ttf");

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
    native: [{ map: "tengchou", text }],
});

const CHEN = "\u{F101F}";
const TENG = "\u{F1013}";
const CHOU = "\u{F103E}";
const HING = "\u{F1057}";
const TAN = "\u{F1014}";

let root: string;
let ctx: ReturnType<typeof runContext>;

beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "content-scroll-")));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "demo" }));
    fs.cpSync(FIXTURE, path.join(root, "node_modules", "@heroiclands", "fonts"), {
        recursive: true,
    });
    ctx = runContext(
        {
            rootDir: root,
            contentPackage: "demo",
            languages: { tsu: { tag: "art-x-tsu", note: "skill-tantsoulng" } },
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
                data: {
                    map: {
                        name: "tengchou",
                        logographic: true,
                        fonts: [{ font: "teng-chou" }],
                        rows: [[" ", ""]],
                    },
                },
            },
            {
                type: "doc",
                shortcode: "semaronmap",
                address: { canonical: "demo-note-doc-semaronmap" },
                data: {
                    map: {
                        name: "two-faces",
                        fonts: [{ font: "semaron-kuriale" }, { font: "teng-chou" }],
                        rows: [],
                    },
                },
            },
            scriptNote("tengchouscript", {
                fonts: ["teng-chou"],
                emphasis: "overline",
                direction: "vertical-rl",
            }),
            scriptNote("semaronscrpt", { fonts: ["semaron-kuriale"], emphasis: "rubric" }),
        ],
    );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const located = (findings: Array<{ line: number; column: number; message: string }>) =>
    findings.map((finding) => `${finding.line}:${finding.column}: ${finding.message}`);

describe("the fence's own findings", () => {
    it("reads rows and cols as whole numbers above zero, each finding at its value", () => {
        const { blocks, errors } = scanScrolls(
            "```scroll {rows=12 cols=4 lang=tsu map=tengchou}\nchen\n```\n",
        );
        expect(errors).toEqual([]);
        expect(blocks[0]).toMatchObject({ rows: 12, cols: 4, invalid: false, start: 0, end: 2 });
        expect(
            located(
                scanScrolls(
                    '```scroll {rows=0 cols="two" map=tengchou}\nchen\n```\n\n```scroll {cols=1.5 map=tengchou}\nchen\n```\n',
                ).errors,
            ),
        ).toEqual([
            "1:17: `rows=0` is not a number of characters: `rows=` is a whole number above zero",
            "1:25: `cols=two` is not a number of columns: `cols=` is a whole number above zero",
            "5:17: `cols=1.5` is not a number of columns: `cols=` is a whole number above zero",
        ]);
    });

    it("refuses a key it does not take, an id, an empty body and a missing close", () => {
        expect(
            located(scanScrolls("```scroll {rows=3 width=2 map=tengchou}\nchen\n```\n").errors),
        ).toEqual([
            "1:19: `width=` is not a scroll attribute; a scroll takes `rows=`, `cols=`, `lang=`, `font=` and `map=`",
        ]);
        expect(located(scanScrolls("```scroll {#seal map=tengchou}\nchen\n```\n").errors)).toEqual([
            "1:1: a scroll fence takes no `#id`",
        ]);
        expect(located(scanScrolls("```scroll {map=tengchou}\n\n```\n").errors)).toEqual([
            "1:1: scroll fence is empty",
        ]);
        expect(located(scanScrolls("```scroll {map=tengchou}\nchen\n").errors)).toEqual([
            "1:1: scroll fence needs a closing code fence",
        ]);
    });

    it("reads no fence quoted inside another fence", () => {
        expect(scanScrolls("````markdown\n```scroll {rows=0}\nchen\n```\n````\n")).toEqual({
            blocks: [],
            errors: [],
        });
    });
});

describe("the face and the script", () => {
    it("uses an explicitly chosen native face and map", () => {
        expect(
            scanRuns(
                "```scroll {lang=tsu map=tengchou font=teng-chou .nativefont}\nchen\n```\n",
                ctx,
            ).runs,
        ).toEqual([
            expect.objectContaining({ kind: "scroll", font: "teng-chou", map: "tengchou" }),
        ]);
    });

    it("requires native opt-in and its own language on a scroll", () => {
        expect(located(scanRuns("```scroll {rows=3}\nchen\n```\n", ctx).errors)).toEqual([
            "1:1: a scroll requires `.nativefont` and an explicit `lang=` on the same construct",
        ]);
    });

    it("requires an explicit face when its language supplies no native font", () => {
        expect(
            located(
                scanRuns("```scroll {map=two-faces lang=und .nativefont}\nchen\n```\n", ctx).errors,
            ),
        ).toEqual([
            "1:35: `.nativefont` has no default `font=` for `und`; state `font=` explicitly",
        ]);
    });

    it("refuses a script written in lines, at the face or the map that gives it", () => {
        expect(
            located(
                scanRuns("```scroll {font=semaron-kuriale lang=und .nativefont}\nchen\n```\n", ctx)
                    .errors,
            ),
        ).toEqual([
            "1:17: a `scroll` fence sets a script written in columns, and the script of `semaron-kuriale` is written in lines; set it in a face whose script note states `direction: vertical-rl`, or use a div",
        ]);
        expect(
            located(
                scanRuns("```scroll {font=serif lang=und .nativefont}\nchen\n```\n", ctx).errors,
            )[0],
        ).toMatch(/^1:17: .*the script of `serif` is written in lines/);
    });

    it("checks a scroll's words as a mapped run's, at the word", () => {
        expect(
            located(
                scanRuns(
                    "```scroll {lang=tsu map=tengchou font=teng-chou .nativefont}\nchen\nzhou\n```\n",
                    ctx,
                ).errors,
            ),
        ).toEqual([
            "3:1: `zhou` is not a word of the `tsu` lexicon, a registered name, or a regular form of one; coin it in the lexicon (or register the name) first",
            "3:1: `zhou` has no `tengchou` writing in the `tsu` lexicon, and its parts do not give one; state one, or write the word directly in signs",
        ]);
    });

    it("reads each face's direction from its script note", () => {
        expect(
            directionsFromRecords([
                scriptNote("a", { fonts: ["f"], emphasis: "rubric", direction: "vertical-rl" }),
                scriptNote("b", { fonts: ["g"], emphasis: "rubric" }),
                scriptNote("c", { fonts: ["f"], emphasis: "rubric" }),
            ]),
        ).toEqual(new Map([["f", "vertical-rl"]]));
    });
});

describe("the rewrite", () => {
    const source =
        "```scroll {rows=3 cols=2 lang=tsu map=tengchou font=teng-chou .nativefont}\nchen teng\n  chou *hing*\n\ntan\n```\n";

    it("sets each paragraph on one line, mapped and unescaped, emphasis by the script's convention", () => {
        const { markdown, scrolls } = renderRuns(source, ctx, undefined, { target: "foundry" });
        expect(markdown).toBe(
            "```scroll {lang=art-x-tsu .script .hl-teng-chou rows=3 cols=2}\n" +
                `${CHEN}${TENG}${CHOU}<em class="emph-overline">${HING}</em>\n\n${TAN}\n` +
                "```\n",
        );
        expect([...scrolls.values()][0].paragraphs).toEqual([
            [
                { text: CHEN, roman: "chen" },
                { text: TENG, roman: " teng" },
                { text: CHOU, roman: " chou" },
                { text: HING, roman: " hing", emphasis: "overline" },
            ],
            [{ text: TAN, roman: "tan" }],
        ]);
    });

    it("writes a .scroll block holding a paragraph each, its size as custom properties", () => {
        expect(renderFoundryMarkdown(source, undefined, undefined, undefined, undefined, ctx)).toBe(
            '<div class="scroll script hl-teng-chou" lang="art-x-tsu" data-rows="3" data-cols="2" style="--scroll-rows: 3; --scroll-cols: 2">\n' +
                `<p>${CHEN}${TENG}${CHOU}<em class="emph-overline">${HING}</em></p>\n` +
                `<p>${TAN}</p>\n` +
                "</div>\n",
        );
    });

    it("escapes the text it does not write itself", () => {
        expect(renderScroll("```scroll {lang=en}\na <b> & c\n```\n").markdown).toBe(
            '\n<div class="scroll" lang="en">\n<p>a &lt;b&gt; &amp; c</p>\n</div>\n\n',
        );
    });

    it("leaves a fence with a finding in its opening as code", () => {
        expect(renderScroll("```scroll {rows=x}\nchen\n```\n").markdown).toBe(
            "```scroll {rows=x}\nchen\n```\n",
        );
    });
});

describe("columns and panels", () => {
    const cells = (romans: string) =>
        romans
            .split(" ")
            .map((roman, at) => ({ text: String(at), roman: at ? ` ${roman}` : roman }));

    it("joins a paragraph's lines and starts each paragraph afresh", () => {
        expect(scrollParagraphs(["  one", "two ", "", "", "three", ""])).toEqual([
            "one two",
            "three",
        ]);
    });

    it("fills columns of rows characters, a paragraph to a fresh column, cols to a panel", () => {
        const first = cells("a b c d e");
        const second = cells("f g");
        const { rows, panels } = scrollPanels([first, second], { rows: 2, cols: 2 });
        expect(rows).toBe(2);
        expect(panels.map((panel) => panel.map((column) => column.length))).toEqual([
            [2, 2],
            [1, 2],
        ]);
        expect(panels.map((panel) => panelRoman(panel, [first, second]))).toEqual([
            "a b c d",
            "e f g",
        ]);
    });

    it("makes each column a panel without cols, and a column the longest paragraph without rows", () => {
        const long = cells(
            Array.from({ length: BOOK_SCROLL_ROWS + 5 }, (_, n) => `w${n}`).join(" "),
        );
        expect(scrollPanels([cells("a b c"), cells("d")]).rows).toBe(3);
        expect(scrollPanels([long]).rows).toBe(BOOK_SCROLL_ROWS);
        expect(scrollPanels([cells("a b c"), cells("d")], { rows: 2 }).panels).toHaveLength(3);
    });
});

describe("the book", () => {
    it("draws each character from the face's outlines, centred in its column, the first column rightmost", () => {
        const outlines = fontOutlines(TENG_CHOU);
        expect(outlines.unitsPerEm).toBe(1000);
        const chen = outlines.glyph(0xf101f);
        expect(chen?.d).toMatch(/^M[-\d. ]+(?:[QL][-\d. ]+)+Z/);
        expect(outlines.glyph(0x41)).toBeUndefined();
        const svg = scrollPanelSvg(
            [[{ text: CHEN, roman: "chen" }], [{ text: TENG, roman: "teng", emphasis: "rubric" }]],
            2,
            outlines,
        );
        expect(svg).toMatch(
            /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 3000 2000"/,
        );
        const uses = [
            ...svg.matchAll(/<use href="#g(\d+)" x="([-\d.]+)" y="([-\d.]+)" fill="([^"]+)"\/>/g),
        ];
        expect(uses).toHaveLength(2);
        expect(Number(uses[0][2])).toBeGreaterThan(Number(uses[1][2]));
        expect(Number(uses[0][2]) + chen!.advance / 2).toBe(2250);
        expect(uses.map((use) => use[4])).toEqual(["#241f1a", "#9c281b"]);
    });

    it("sets a scroll as panel images read right to left, its roman text as alt text", () => {
        const typst = markdownToTypst(
            "```scroll {rows=2 cols=1 lang=tsu map=tengchou font=teng-chou .nativefont}\nchen teng chou\n```\n",
            { runs: ctx },
        );
        const boxes = [
            ...typst.matchAll(
                /#box\(image\(bytes\("<svg [^\n]*?"\), format: "svg", height: 2em, alt: "([^"]*)"\)\)/g,
            ),
        ].map((match) => match[1]);
        expect(boxes).toEqual(["chen teng", "chou"]);
        expect(typst).toMatch(/^#block\(width: 100%\)\[#set text\(dir: rtl\)\n#box/);
        expect(typst).toMatch(/\)\)#h\(1em, weak: true\) #box/);
    });

    it("lets columns wrap where the measure ends when no cols is stated", () => {
        const typst = markdownToTypst(
            "```scroll {rows=2 lang=tsu map=tengchou font=teng-chou .nativefont}\nchen teng chou\n```\n",
            { runs: ctx },
        );
        expect(typst).toMatch(/\)\)​#box/);
    });

    it("sets a scroll the rewrite did not set as code", () => {
        expect(
            markdownToTypst(
                "```scroll {rows=2 font=semaron-kuriale lang=und .nativefont}\nchen\n```\n",
                { runs: ctx },
            ),
        ).toMatch(/```\nchen\n```/);
    });
});

/** A note as the lint reads it, its YAML written out so positions are real. */
const noteOf = (fm: object) => ({
    file: "tengchou.md",
    fm,
    raw: `---\n${YAML.stringify(fm)}---\n`,
});

describe("`data.script.direction` in the note lint", () => {
    const lint = (script: object) =>
        lintNote(
            noteOf({
                type: "skill",
                subType: "script",
                shortcode: "tengchouscript",
                name: { full: "Teng Chou Script" },
                data: { script },
            }),
            { schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS }, vocabulary: NOTE_VOCABULARY },
        )
            .filter((finding: { message: string }) => finding.message.includes("data.script"))
            .map(
                (finding: { line?: number; column?: number; message: string }) =>
                    `${finding.line}:${finding.column}: ${finding.message}`,
            );

    it("accepts vertical-rl and refuses any other direction at its value", () => {
        expect(
            lint({ fonts: ["teng-chou"], emphasis: "rubric", direction: "vertical-rl" }),
        ).toEqual([]);
        expect(lint({ fonts: ["teng-chou"], emphasis: "rubric", direction: "vertical" })).toEqual([
            '12:16: `data.script.direction` should be `vertical-rl`, but reads "vertical"',
        ]);
    });
});
