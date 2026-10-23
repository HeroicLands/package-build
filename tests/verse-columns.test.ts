/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A verse in columns, and numbered verse, on every target.** Each finding at
 * the text that makes the verse wrong, the expansion every target runs before
 * marked text is rewritten, and a golden per target for a verse mapped into a
 * left-to-right face and one mapped into a right-to-left face.
 *
 * The fixture fonts package lists each face's real code points, and the maps
 * here are written out row by row, so every expectation is a literal.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { renderBlocks, scanBlocks } from "../engine/content-blocks.mjs";
import { renderRuns, runContext, scanRuns } from "../engine/content-scripts.mjs";
import { renderSpans } from "../engine/content-spans.mjs";
import { expandVerse } from "../engine/content-verse.mjs";
import { createRenderer } from "../engine/content-render.mjs";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";
import { markupFindings } from "../engine/markup-validation.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "script-fonts", "fonts");

const mapNote = (shortcode: string, map: object) => ({
    type: "doc",
    shortcode,
    address: { canonical: `demo-note-doc-${shortcode}` },
    data: { map },
});

const VYL_SEMARON = {
    name: "vyl-semaron",
    vowels: "aeiou",
    rows: [
        ["th", "\u{F0250}"],
        ["r", "\u{F023F}"],
        ["i", "\u{F0237}"],
        ["m", "\u{F023B}"],
        ["a", "\u{F0230}"],
        ["s", "\u{F0240}"],
        ["o", "\u{F023D}"],
    ],
};

const KHEL_QALEZU = {
    name: "khel-qalezu",
    rows: [
        ["a", ""],
        ["u", ""],
        ["g", "\u{1EA06}"],
        ["r", "\u{1EA01}"],
        ["z", "\u{1EA04}"],
        ["l", "\u{1EA00}"],
    ],
};

/** `thrima` and `sorima` in Semaron: `th` is one letter. */
const THRIMA = "\u{F0250}\u{F023F}\u{F0237}\u{F023B}\u{F0230}";
const SORIMA = "\u{F0240}\u{F023D}\u{F023F}\u{F0237}\u{F023B}\u{F0230}";
/** `gar` and `zul` in Qalezu, the vowels dropped. */
const GAR = "\u{1EA06}\u{1EA01}";
const ZUL = "\u{1EA04}\u{1EA00}";

let root: string;
let ctx: ReturnType<typeof runContext>;

beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "verse-columns-")));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "demo" }));
    fs.cpSync(FIXTURE, path.join(root, "node_modules", "@heroiclands", "fonts"), {
        recursive: true,
    });
    ctx = runContext(
        {
            rootDir: root,
            languages: { vyl: { tag: "art-x-vyl" }, khel: { tag: "art-x-khel" } },
        },
        [mapNote("vylsemaron", VYL_SEMARON), mapNote("khelqalezu", KHEL_QALEZU)],
    );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const OPENER =
    "```verse {#walk lang=vyl numstep=2 col1=vyl/vyl-semaron/semaron-kuriale col2=en:vyl}";
const SOURCE = [
    OPENER,
    "",
    "[thrima sorima]{lang=vyl}",
    "[The line, the song,]{lang=en}",
    "",
    "[the line]{lang=en}",
    "thrima",
    "",
    "***",
    "",
    "[sorima]{lang=vyl}",
    "[The *song*]{lang=en}",
    "```",
].join("\n");

const RTL = [
    "```verse {col1=khel/khel-qalezu/qalezu-hand col2=en}",
    "[gar zul]{lang=khel}",
    "[A road]{lang=en}",
    "```",
].join("\n");

/** Every markup finding, as `line:column: message`. */
const findings = (source: string) =>
    markupFindings(source, "a.md", undefined, ctx).map(
        (f: { line: number; column: number; message: string }) =>
            `${f.line}:${f.column}: ${f.message}`,
    );

describe("a verse in columns", () => {
    it("reads groups, spans in any order and a plain line in the verse's language", () => {
        expect(findings(SOURCE)).toEqual([]);
    });

    it("reports a verse line missing a language its columns name, at the line", () => {
        const source = SOURCE.replace("[The line, the song,]{lang=en}\n", "");
        expect(findings(source)).toEqual([
            "3:1: this verse line has no `en` line, which `col2=` sets",
        ]);
    });

    it("reports a language given twice in one verse line, at the second", () => {
        const source = SOURCE.replace("thrima\n", "[the line again]{lang=en}\n");
        expect(findings(source)).toEqual(
            [
                "7:1: this verse line gives `en` twice; give each language once",
                "6:1: this verse line has no `vyl` line, which `col1=` sets",
            ].sort(),
        );
    });

    it("reports a language no column sets, at the line", () => {
        const source = SOURCE.replace("thrima\n", "thrima\n[gar]{lang=khel}\n");
        expect(findings(source)).toEqual([
            "8:1: no column sets `khel`; a verse line gives the languages `col1=` and `col2=` name",
        ]);
    });

    it("refuses a third column, a malformed entry and a key a column verse cannot use", () => {
        expect(findings(SOURCE.replace("col2=en:vyl", "col2=en:vyl col3=en"))).toEqual([
            "1:85: `col3=` is not a column: a verse has at most two, `col1=` and `col2=`",
        ]);
        expect(findings(SOURCE.replace("col2=en:vyl", "col2=en::vyl"))).toEqual([
            "1:81: `` in `col2=` is not an entry: an entry is `language[/mapping[/font]]`",
        ]);
        expect(findings(SOURCE.replace("col2=en:vyl", "col2=en:vyl/a/b/c"))).toEqual([
            "1:81: `vyl/a/b/c` in `col2=` is not an entry: an entry is `language[/mapping[/font]]`",
        ]);
        expect(findings(SOURCE.replace("lang=vyl numstep", "lang=vyl font=serif numstep"))).toEqual(
            [
                "1:26: a verse in columns sets each column's fonts and maps in `col1=` and `col2=`, not with `font=`",
                "12:6: text marked `lang=en font=serif` is plain text and holds no emphasis",
            ],
        );
        expect(findings(SOURCE.replace("numstep=2", "numstep=two"))).toEqual([
            "1:26: verse numstep= numbers every Nth line: a whole number, 0 for none",
        ]);
    });

    it("reports an unknown mapping or font at the entry", () => {
        expect(findings(SOURCE.replace("vyl/vyl-semaron/", "vyl/vyl-semron/"))).toEqual([
            "1:45: `vyl-semron` is not a map: `map=` names the `data.map.name` of a mapping note; did you mean `vyl-semaron`?",
        ]);
        expect(findings(SOURCE.replace("/semaron-kuriale", "/semaron-kurial"))).toEqual([
            "1:57: `semaron-kurial` is not a font: `font=` names an installed face, or `mono`, `serif` or `sans`; did you mean `semaron-kuriale`?",
        ]);
    });

    it("reports a mapped entry's undrawn character at the character in the line", () => {
        const source = SOURCE.replace("[sorima]{lang=vyl}", "[sorima7]{lang=vyl}");
        expect(findings(source)).toEqual([
            "11:8: `7` (U+0037) is not drawn by the font `semaron-kuriale`, and the map `vyl-semaron` has no row for it",
        ]);
    });

    it("refuses a line that is not a lone span, an unlabelled line, an indent and the build's class", () => {
        expect(
            findings(SOURCE.replace("[the line]{lang=en}", "[the line]{lang=en .name}")),
        ).toEqual([
            "6:1: a line of a verse in columns is `[text]{lang=…}`, or plain text in the verse's `lang=`, and takes no other key",
        ]);
        expect(findings(SOURCE.replace("{#walk lang=vyl ", "{#walk "))).toEqual([
            "7:1: this line names no language: write it `[text]{lang=…}`, or give the verse `lang=`",
        ]);
        expect(findings(SOURCE.replace("\nthrima\n", "\n  thrima\n"))).toEqual([
            "7:3: a line of a verse in columns is not indented",
        ]);
        expect(findings(SOURCE.replace("{#walk", "{#walk .verse-columns"))).toEqual([
            "1:17: `.verse-columns` is the class the build gives a verse in columns; leave it out",
        ]);
    });

    it("leaves a verse without columns as it is, and numbers it", () => {
        const plain = "```verse {numstep=1}\nOne\n  Two\n```";
        expect(findings(plain)).toEqual([]);
        expect(expandVerse(plain)).toBe(plain);
    });
});

describe("the expansion", () => {
    it("writes each verse line as one span per column entry, in column order", () => {
        expect(expandVerse(SOURCE)).toBe(
            [
                OPENER.replace("}", " .verse-columns}"),
                "[thrima sorima]{lang=vyl map=vyl-semaron font=semaron-kuriale}",
                "[The line, the song,]{lang=en}",
                "[thrima sorima]{lang=vyl}",
                "",
                "[thrima]{lang=vyl map=vyl-semaron font=semaron-kuriale}",
                "[the line]{lang=en}",
                "[thrima]{lang=vyl}",
                "",
                "***",
                "",
                "[sorima]{lang=vyl map=vyl-semaron font=semaron-kuriale}",
                "[The *song*]{lang=en}",
                "[sorima]{lang=vyl}",
                "```",
            ].join("\n"),
        );
    });

    it("leaves a verse with a finding, and an expanded verse, as written", () => {
        const faulty = SOURCE.replace("[The line, the song,]{lang=en}\n", "");
        expect(expandVerse(faulty)).toBe(faulty);
        const once = expandVerse(SOURCE);
        expect(expandVerse(once)).toBe(once);
    });

    it("keeps the runs a note authored, one per span", () => {
        const kinds = scanRuns(SOURCE, ctx).runs.map((run: { kind: string }) => run.kind);
        expect(kinds).toEqual(["verse", "span", "span", "span", "span", "span"]);
    });
});

const site = (source: string) =>
    renderSpans(
        renderBlocks(renderRuns(source, ctx, undefined, { target: "site" }).markdown, "web")
            .markdown,
    ).markdown;
const foundry = (source: string) =>
    renderFoundryMarkdown(source, undefined, undefined, undefined, undefined, ctx);
const typst = (source: string) => markdownToTypst(source, { runs: ctx });

/** One row: its number cell, then each column's parts. */
const row = (number: string | undefined, ...columns: string[][]) =>
    '<span class="verse-row">' +
    (number === undefined ? "" : `<span class="verse-number">${number}</span>`) +
    columns
        .map(
            (parts) =>
                '<span class="verse-column">' +
                parts
                    .map(
                        (part, at) =>
                            `<span class="verse-part${at ? " verse-secondary" : ""}"${/^<span[^>]*>[\u{1EA00}-\u{1EDFF}]/u.test(part) ? ' dir="rtl"' : ""}>${part}</span>`,
                    )
                    .join("") +
                "</span>",
        )
        .join("") +
    "</span>";
const semaron = (text: string, search: string) =>
    `<span class="script hl-semaron-kuriale" lang="art-x-vyl"${search}>${text}</span>`;
const vyl = (text: string) => `<span lang="art-x-vyl">${text}</span>`;
const en = (text: string) => `<span lang="en">${text}</span>`;

describe("the site", () => {
    it("sets one row per verse line, a column of stacked parts, and the numbers", () => {
        const s = ' data-pagefind-ignore="true"';
        expect(site(SOURCE)).toBe(
            [
                "",
                '<div class="verse verse-columns verse-numbered" id="walk" lang="art-x-vyl" data-numstep="2" data-col1="vyl/vyl-semaron/semaron-kuriale" data-col2="en:vyl">',
                "",
                row(
                    "",
                    [semaron(`${THRIMA} ${SORIMA}`, s)],
                    [en("The line, the song,"), vyl("thrima sorima")],
                ) +
                    "\n" +
                    row("2", [semaron(THRIMA, s)], [en("the line"), vyl("thrima")]),
                "",
                row("", [semaron(SORIMA, s)], [en("The *song*"), vyl("sorima")]),
                "",
                "</div>",
                "",
            ].join("\n"),
        );
    });

    it("keeps a right-to-left part in its column, running right to left", () => {
        expect(site(RTL)).toContain(
            row(
                undefined,
                [
                    `<span class="script hl-qalezu-hand" lang="art-x-khel" data-pagefind-ignore="true">${GAR} ${ZUL}</span>`,
                ],
                [en("A road")],
            ),
        );
    });

    it("numbers a verse without columns in the margin of its line", () => {
        expect(site("```verse {numstep=2}\nOne\n  Two\n\nThree\n```")).toBe(
            [
                "",
                '<div class="verse verse-numbered" data-numstep="2">',
                "",
                '<span class="verse-line">One</span>  ',
                '<span class="verse-line i1"><span class="verse-number">2</span>Two</span>',
                "",
                '<span class="verse-line">Three</span>',
                "",
                "</div>",
                "",
            ].join("\n"),
        );
    });
});

describe("Foundry", () => {
    it("renders the same rows into the journal page, with no search marker", () => {
        const html = foundry(SOURCE);
        expect(html).toContain(
            '<div class="verse verse-columns verse-numbered" id="walk" lang="art-x-vyl" data-numstep="2" data-col1="vyl/vyl-semaron/semaron-kuriale" data-col2="en:vyl">\n<p>' +
                row(
                    "",
                    [semaron(`${THRIMA} ${SORIMA}`, "")],
                    [en("The line, the song,"), vyl("thrima sorima")],
                ) +
                "\n" +
                row("2", [semaron(THRIMA, "")], [en("the line"), vyl("thrima")]) +
                "</p>\n<p>" +
                row("", [semaron(SORIMA, "")], [en("The <em>song</em>"), vyl("sorima")]) +
                "</p>\n</div>",
        );
        expect(html).not.toContain("pagefind");
    });

    it("keeps a right-to-left part in its column, running right to left", () => {
        expect(foundry(RTL)).toContain(
            `<span class="verse-part" dir="rtl"><span class="script hl-qalezu-hand" lang="art-x-khel">${GAR} ${ZUL}</span></span>`,
        );
    });
});

describe("Typst", () => {
    const script = (text: string) =>
        `#book-span(classes: ("script", "hl-semaron-kuriale"))[${text}]`;
    const lang = (text: string, tag?: string) =>
        tag ? `#book-span(classes: (), lang: "${tag}")[${text}]` : `#box[${text}]`;
    const grey = (part: string) => `#text(fill: luma(45%))[${part}]`;
    const stack = (...parts: string[]) =>
        parts.length === 1 ?
            `[${parts[0]}]`
        :   `[#stack(dir: ttb, spacing: 0.3em, ${parts.map((part, at) => `[${at ? grey(part) : part}]`).join(", ")})]`;

    it("sets a grid with a row per verse line, its numbers and a gap between stanzas", () => {
        expect(typst(SOURCE).trim()).toBe(
            [
                "#block(width: 100%)[#grid(columns: (2.5em, 1fr, 1fr), column-gutter: 1.5em, row-gutter: 0.65em,",
                `  [], ${stack(script(`${THRIMA} ${SORIMA}`))}, ${stack(lang("The line, the song,", "en"), lang("thrima sorima"))},`,
                `  [${grey("2")}], ${stack(script(THRIMA))}, ${stack(lang("the line", "en"), lang("thrima"))},`,
                "  grid.cell(colspan: 3)[#v(0.5em)],",
                `  [], ${stack(script(SORIMA))}, ${stack(lang("The #emph[song]", "en"), lang("sorima"))},`,
                ")] <walk>",
            ].join("\n"),
        );
    });

    it("keeps a right-to-left part in its column, running right to left", () => {
        expect(typst(RTL)).toContain(
            `[#set text(dir: rtl)\n#book-span(classes: ("script", "hl-qalezu-hand"))[${GAR} ${ZUL}]], [#book-span(classes: (), lang: "en")[A road]],`,
        );
    });

    it("numbers a verse without columns", () => {
        expect(typst("```verse {numstep=2}\nOne\n  Two\n```")).toContain(
            "#grid(columns: (2.5em, 1fr), column-gutter: 1em, row-gutter: 0.35em,\n  [], [One],\n  [#text(fill: luma(45%))[2]], [#h(1.25em)Two],\n)",
        );
    });
});

describe("the scan", () => {
    it("accepts the new keys on a verse", () => {
        expect(scanBlocks("```verse {numstep=5}\nA\n```").errors).toEqual([]);
    });
});

describe("a language with an automatic script in parallel verse", () => {
    const context = () =>
        runContext(
            {
                rootDir: root,
                contentPackage: "demo",
                languages: { vyl: { tag: "art-x-vyl", note: "skill-vyllng" } },
            },
            [
                mapNote("vylsemaron", {
                    ...VYL_SEMARON,
                    fonts: [{ font: "semaron-kuriale" }],
                }),
                {
                    type: "skill",
                    subType: "language",
                    shortcode: "vyllng",
                    address: { canonical: "demo-note-skill-vyllng" },
                    data: {
                        writtenIn: { map: "vyl-semaron", font: "semaron-kuriale" },
                        words: [
                            {
                                form: "thrima",
                                class: "n",
                                gloss: "line",
                                native: [{ map: "vyl-semaron", text: SORIMA }],
                            },
                            { form: "sorima", class: "n", gloss: "song" },
                        ],
                    },
                },
            ],
        );
    const parallel = (lang: string) =>
        [
            ": A song {#automatic-script-song}",
            "",
            `\`\`\`verse {lang=${lang} col1=vyl/vyl-semaron/semaron-kuriale col2=en:vyl}`,
            "[The line]{lang=en}",
            "[thrima]{lang=vyl}",
            "",
            "***",
            "",
            "[The song]{lang=en}",
            "[sorima]{lang=vyl}",
            "```",
        ].join("\n");

    it("still rejects an unregistered word in the mapped column", () => {
        const source = parallel("en").replace("[thrima]", "[thrimathrima]");
        expect(scanRuns(source, context()).errors).toEqual([
            {
                line: 5,
                column: 2,
                message:
                    "`thrimathrima` is not a word of the `vyl` lexicon, a registered name, or a regular form of one; coin it in the lexicon (or register the name) first",
            },
        ]);
    });

    for (const target of ["web", "foundry"] as const) {
        for (const lang of ["en", "vyl"]) {
            it(`keeps the roman repeat beside native spelling on ${target}, outer lang=${lang}`, () => {
                const runs = context();
                const html = createRenderer(target).render(parallel(lang), { runs });
                const search = target === "web" ? ' data-pagefind-ignore="true"' : "";
                expect(html).toContain(
                    row(undefined, [semaron(SORIMA, search)], [en("The line"), vyl("thrima")]),
                );
                expect(html).toContain(
                    row(undefined, [semaron(SORIMA, search)], [en("The song"), vyl("sorima")]),
                );
                expect(html).not.toContain("font-serif");
                expect(html).not.toContain("***");
                expect(html).toMatch(/<\/p>\s*<p><span class="verse-row">/);
                expect(scanRuns(parallel(lang), runs).errors).toEqual([]);
                const prose = createRenderer(target).render("[thrima]{lang=vyl}", { runs });
                expect(prose).toContain(semaron(SORIMA, search));
            });
        }
    }
});
