/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **Emphasis inside a script run is set by the script's own convention.** A
 * script note's `data.script` names its faces and its convention; `*…*` and
 * `**…**` inside a run in one of those faces render as `<em>` and `<strong>`
 * carrying the convention's class on the site and in Foundry, and as red text
 * or an overline in the book. Goldens for each target, the vocabulary's
 * findings at their `line:column`, and the checks on the faces a note lists.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import MarkdownIt from "markdown-it";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import YAML from "yaml";

import { renderBlocks } from "../engine/content-blocks.mjs";
import { renderRuns, runContext, scanRuns } from "../engine/content-scripts.mjs";
import { renderSpans } from "../engine/content-spans.mjs";
import { renderVerse } from "../engine/content-verse.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { bookTypstPreamble, markdownToTypst } from "../engine/pdf-render.mjs";
import {
    EMPHASIS_CLASSES,
    EMPHASIS_CONVENTIONS,
    checkScriptNoteFonts,
    emphasesFromRecords,
} from "../engine/script-emphasis.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "script-fonts", "fonts");

/** A mapping note's record, as the content index carries it. */
const mapNote = (shortcode: string, map: object) => ({
    type: "doc",
    shortcode,
    address: { canonical: `demo-note-doc-${shortcode}` },
    data: { map },
});

/** A script note's record, as the content index carries it. */
const scriptNote = (shortcode: string, script: object) => ({
    type: "skill",
    subType: "script",
    shortcode,
    address: { canonical: `demo-note-skill-${shortcode}` },
    data: { script },
});

/** A language note's record, as the content index carries it. */
const languageNote = (shortcode: string, data: object) => ({
    type: "skill",
    subType: "language",
    shortcode,
    address: { canonical: `demo-note-skill-${shortcode}` },
    data,
});

/** Semaron Kuriale's letters for the words used here. */
const VYL_SEMARON = {
    name: "vyl-semaron",
    rows: [
        ["th", "\u{F0250}"],
        ["r", "\u{F023F}"],
        ["i", "\u{F0237}"],
        ["m", "\u{F023B}"],
        ["a", "\u{F0230}"],
        ["s", "\u{F0240}"],
        ["o", "\u{F023D}"],
    ],
    fonts: [{ font: "semaron-kuriale" }],
};

/** Qalezu Hand's consonants, with the vowels dropped. */
const KHEL_QALEZU = {
    name: "khel-qalezu",
    rows: [
        ["a", ""],
        ["n", "\u{1EA08}"],
        ["l", "\u{1EA00}"],
        ["g", "\u{1EA06}"],
        ["r", "\u{1EA01}"],
    ],
    fonts: [{ font: "qalezu-hand" }],
};

/** Thuravark's letters for `sorima`. */
const VYL_THURAVARK = {
    name: "vyl-thuravark",
    rows: [
        ["s", "\u{F0100}"],
        ["o", "\u{F0101}"],
        ["r", "\u{F0102}"],
        ["i", "\u{F0103}"],
        ["m", "\u{F0104}"],
        ["a", "\u{F0105}"],
    ],
    fonts: [{ font: "thuravark-carved" }],
};

const THRIMA = "\u{F0250}\u{F023F}\u{F0237}\u{F023B}\u{F0230}";
const SORIMA = "\u{F0240}\u{F023D}\u{F023F}\u{F0237}\u{F023B}\u{F0230}";
const GAR = "\u{1EA06}\u{1EA01}";
const NL = "\u{1EA08}\u{1EA00}";
/** `sorima` in Thuravark. */
const SO = "\u{F0100}\u{F0101}\u{F0102}\u{F0103}\u{F0104}\u{F0105}";
/** Two Pirzath letters, typed as the face draws them. */
const PZ = "\u{F0000}\u{F0001}";

let root: string;
let ctx: ReturnType<typeof runContext>;

beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "script-emphasis-")));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "demo" }));
    fs.cpSync(FIXTURE, path.join(root, "node_modules", "@heroiclands", "fonts"), {
        recursive: true,
    });
    ctx = runContext(
        {
            rootDir: root,
            contentPackage: "demo",
            languages: {
                vyl: { tag: "art-x-vyl", note: "skill-vylarilng" },
                prv: { tag: "art-x-prv" },
                tar: { tag: "art-x-tar", note: "skill-tarvenilng" },
                khel: { tag: "art-x-khel" },
            },
        },
        [
            languageNote("vylarilng", { emphasis: "words", words: [] }),
            languageNote("tarvenilng", {
                emphasis: "overline",
                words: [
                    { form: "thrima", class: "n", gloss: "a song" },
                    { form: "sorima", class: "n", gloss: "a verse" },
                ],
            }),
            mapNote("vylsemaron", VYL_SEMARON),
            mapNote("khelqalezu", KHEL_QALEZU),
            mapNote("vylthuravark", VYL_THURAVARK),
            scriptNote("semaronscrpt", { fonts: ["semaron-kuriale"], emphasis: "rubric" }),
            scriptNote("qalezuscrpt", { fonts: ["qalezu-hand"], emphasis: "overline" }),
            scriptNote("pirzathscrpt", {
                fonts: ["pirzath-hand-lifted"],
                emphasis: "overline",
                strongEmphasis: "rubric",
            }),
        ],
    );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const SEMARON = "lang=prv font=semaron-kuriale map=vyl-semaron";
const VYLARI = "lang=vyl font=semaron-kuriale map=vyl-semaron";
const TARVENI = "lang=tar font=semaron-kuriale map=vyl-semaron";
const QALEZU = "lang=khel font=qalezu-hand map=khel-qalezu";
const THURAVARK = "lang=prv font=thuravark-carved map=vyl-thuravark";

const errors = (source: string) =>
    scanRuns(source, ctx).errors.map(
        (error: { line: number; column: number; message: string }) =>
            `${error.line}:${error.column}: ${error.message}`,
    );

describe("the conventions", () => {
    it("are rubric and overline, each with its class", () => {
        expect(EMPHASIS_CONVENTIONS).toEqual(["rubric", "overline"]);
        expect(EMPHASIS_CLASSES).toEqual({ rubric: "emph-rubric", overline: "emph-overline" });
    });

    it("are read from each script note, both levels from one unless it states two", () => {
        expect(
            emphasesFromRecords([
                scriptNote("a", { fonts: ["f", "g"], emphasis: "rubric" }),
                scriptNote("b", { fonts: ["h"], emphasis: "overline", strongEmphasis: "rubric" }),
                { type: "skill", subType: "language", data: { script: { fonts: ["x"] } } },
            ]),
        ).toEqual(
            new Map([
                ["f", { em: "rubric", strong: "rubric" }],
                ["g", { em: "rubric", strong: "rubric" }],
                ["h", { em: "overline", strong: "rubric" }],
            ]),
        );
    });

    it("keep the first note's claim on a face two notes list", () => {
        expect(
            emphasesFromRecords([
                scriptNote("a", { fonts: ["f"], emphasis: "rubric" }),
                scriptNote("b", { fonts: ["f"], emphasis: "overline" }),
            ]).get("f"),
        ).toEqual({ em: "rubric", strong: "rubric" });
    });
});

describe("emphasis in a script run is accepted", () => {
    it.each([
        ["a span", `[thrima *sorima*]{${SEMARON}}`],
        ["strong emphasis in a span", `[thrima **sorima**]{${SEMARON}}`],
        ["both levels at once", `[***sorima*** thrima]{${SEMARON}}`],
        ["a div", [`::: {${SEMARON}}`, "thrima *sorima*", "", "**thrima**", ":::"].join("\n")],
        ["a verse", ["```verse {" + QALEZU + "}", "gar *nal*", "  **gar**", "```"].join("\n")],
        ["a face whose script states no convention", `[*sorima*]{${THURAVARK}}`],
        ["emphasis written with underscores", `[thrima _sorima_]{${SEMARON}}`],
        ["strong emphasis written with underscores", `[thrima __sorima__]{${SEMARON}}`],
        ["a mix of stars and underscores", `[_thrima_ **sorima**]{${SEMARON}}`],
        ["a face with no map", `[*${THRIMA}*]{font=semaron-kuriale}`],
    ])("in %s", (_, source) => {
        expect(errors(source)).toEqual([]);
    });

    it("reads an unpaired or escaped star as a character the map spells", () => {
        expect(errors(`[thrima \\*sorima*]{${SEMARON}}`)).toEqual([
            "1:10: `*` (U+002A) is not drawn by the font `semaron-kuriale`, and the map `vyl-semaron` has no row for it",
        ]);
    });

    it("reads an escaped or unpaired underscore as a character the map spells", () => {
        expect(errors(`[thrima \\_sorima_]{${SEMARON}}`)).toEqual([
            "1:10: `_` (U+005F) is not drawn by the font `semaron-kuriale`, and the map `vyl-semaron` has no row for it",
        ]);
    });

    it("checks the text between the stars against the face, at the character", () => {
        expect(errors(`[thrima *sorimak*]{${SEMARON}}`)).toEqual([
            "1:16: `k` (U+006B) is not drawn by the font `semaron-kuriale`, and the map `vyl-semaron` has no row for it",
        ]);
    });
});

describe("emphasis that is still a finding", () => {
    it.each([
        [
            "a strikethrough in a face",
            `[a ~~b~~ c]{${SEMARON}}`,
            [
                `1:4: text marked \`${SEMARON}\` takes emphasis only as \`*…*\`, \`_…_\`, \`**…**\` or \`__…__\``,
            ],
        ],
        [
            "emphasis in a declared language with no face",
            "[a *b* c]{lang=prv}",
            ["1:4: text marked `lang=prv` is plain text and holds no emphasis"],
        ],
        [
            "emphasis in a generic family",
            "[a *b* c]{font=serif}",
            ["1:4: text marked `font=serif` is plain text and holds no emphasis"],
        ],
        [
            "emphasis in a map with no face",
            "[a *b* c]{map=vyl-semaron}",
            ["1:4: text marked `map=vyl-semaron` is plain text and holds no emphasis"],
        ],
    ])("%s", (_, source, expected) => {
        expect(errors(source)).toEqual(expected);
    });
});

describe("a language's own convention", () => {
    it("is a finding at each emphasis where the language marks it with a word", () => {
        expect(errors(`[thrima *sorima* **thrima**]{${VYLARI}}`)).toEqual([
            "1:9: `vyl` marks emphasis with a word, not a mark; write the word",
            "1:18: `vyl` marks emphasis with a word, not a mark; write the word",
        ]);
        expect(errors("[a *b* _c_]{lang=vyl}")).toEqual([
            "1:4: `vyl` marks emphasis with a word, not a mark; write the word",
            "1:8: `vyl` marks emphasis with a word, not a mark; write the word",
        ]);
    });

    it("overrides the script's, and a tongue that states none takes the script's", () => {
        const render = (source: string) =>
            renderRuns(source, ctx, undefined, { target: "foundry" }).markdown;
        expect(render(`[thrima *sorima*]{${TARVENI}}`)).toBe(
            `[${THRIMA} <em class="emph-overline">${SORIMA}</em>]{lang=art-x-tar .script .hl-semaron-kuriale}`,
        );
        expect(render(`[thrima *sorima*]{${SEMARON}}`)).toBe(
            `[${THRIMA} <em class="emph-rubric">${SORIMA}</em>]{lang=art-x-prv .script .hl-semaron-kuriale}`,
        );
    });

    it("sets underscore emphasis exactly as the star forms", () => {
        const render = (source: string) =>
            renderRuns(source, ctx, undefined, { target: "foundry" }).markdown;
        expect(render(`[thrima _sorima_]{${SEMARON}}`)).toBe(
            render(`[thrima *sorima*]{${SEMARON}}`),
        );
        expect(render(`[thrima __sorima__]{${SEMARON}}`)).toBe(
            render(`[thrima **sorima**]{${SEMARON}}`),
        );
        expect(render(`[thrima __sorima__]{${SEMARON}}`)).toContain(
            `<strong class="emph-rubric">${SORIMA}</strong>`,
        );
    });

    it("leaves a Vylari run with a finding as written", () => {
        const source = `[thrima *sorima*]{${VYLARI}}`;
        expect(renderRuns(source, ctx).markdown).toBe(source);
    });
});

const LTR = `Said [thrima *sorima*]{${SEMARON}} once.`;
const STRONG = `Said [thrima **sorima**]{${SEMARON}} once.`;
const OVER = `Said [gar *nal*]{${QALEZU}} once.`;
const MIXED = `[*${PZ}* **${PZ}**]{lang=prv font=pirzath-hand-lifted}`;
const PLAIN = `[*sorima* **sorima**]{${THURAVARK}}`;
const ROMAN = "Roman *stays* **as** written, [and *here*]{lang=la}.";
const DIV = [`::: {${SEMARON}}`, "thrima *sorima*", ":::"].join("\n");
const VERSE = ["```verse {" + QALEZU + "}", "gar **nal**", "```"].join("\n");

describe("renderRuns, goldens", () => {
    const render = (source: string, target = "site") =>
        renderRuns(source, ctx, undefined, { target: target as "site" }).markdown;

    it("writes a rubric script's emphasis as a classed em and strong", () => {
        expect(render(LTR, "foundry")).toBe(
            `Said [${THRIMA} <em class="emph-rubric">${SORIMA}</em>]{lang=art-x-prv .script .hl-semaron-kuriale} once.`,
        );
        expect(render(STRONG, "foundry")).toBe(
            `Said [${THRIMA} <strong class="emph-rubric">${SORIMA}</strong>]{lang=art-x-prv .script .hl-semaron-kuriale} once.`,
        );
    });

    it("writes an overline script's emphasis with the overline class", () => {
        expect(render(OVER, "foundry")).toBe(
            `Said [${GAR} <em class="emph-overline">${NL}</em>]{lang=art-x-khel .script .hl-qalezu-hand} once.`,
        );
    });

    it("gives each level its own convention where the note states two", () => {
        expect(render(MIXED, "foundry")).toBe(
            `[<em class="emph-overline">${PZ}</em> <strong class="emph-rubric">${PZ}</strong>]{lang=art-x-prv .script .hl-pirzath-hand-lifted}`,
        );
    });

    it("leaves a script's emphasis classless where its note states no convention", () => {
        expect(render(PLAIN, "foundry")).toBe(
            `[<em>${SO}</em> <strong>${SO}</strong>]{lang=art-x-prv .script .hl-thuravark-carved}`,
        );
    });

    it("leaves emphasis outside a script run as written", () => {
        expect(render(ROMAN)).toBe(ROMAN);
    });

    it("sets a div's and a verse's emphasis line by line", () => {
        expect(render(DIV, "foundry")).toBe(
            [
                "::: {lang=art-x-prv .script .script-block .hl-semaron-kuriale}",
                `${THRIMA} <em class="emph-rubric">${SORIMA}</em>`,
                ":::",
            ].join("\n"),
        );
        expect(render(VERSE, "foundry")).toBe(
            [
                "```verse {lang=art-x-khel .script .hl-qalezu-hand dir=rtl}",
                `${GAR} <strong class="emph-overline">${NL}</strong>`,
                "```",
            ].join("\n"),
        );
    });

    it("drops a classless emphasis in the book, where the face has only its Regular", () => {
        expect(render(PLAIN, "book")).toBe(
            `[${SO} ${SO}]{lang=art-x-prv .script .hl-thuravark-carved}`,
        );
        expect(render(LTR, "book")).toBe(render(LTR, "foundry"));
    });
});

describe("the site", () => {
    const md = new MarkdownIt({ html: true });
    const site = (source: string) =>
        md.render(
            renderSpans(
                renderVerse(
                    renderBlocks(
                        renderRuns(source, ctx, undefined, { target: "site" }).markdown,
                        "web",
                    ).markdown,
                ).markdown,
            ).markdown,
        );

    it("renders a rubric run's emphasis as a classed em", () => {
        expect(site(LTR)).toContain(
            `<span class="script hl-semaron-kuriale" lang="art-x-prv" data-pagefind-ignore="true">${THRIMA} <em class="emph-rubric">${SORIMA}</em></span>`,
        );
    });

    it("renders an overline run's strong emphasis as a classed strong", () => {
        expect(site(VERSE)).toContain(`${GAR} <strong class="emph-overline">${NL}</strong>`);
    });

    it("renders a script with no convention as a bare em", () => {
        expect(site(PLAIN)).toContain(`<em>${SO}</em> <strong>${SO}</strong>`);
    });

    it("leaves roman emphasis bare", () => {
        expect(site(ROMAN)).toContain("Roman <em>stays</em> <strong>as</strong> written");
    });
});

describe("Foundry", () => {
    const foundry = (source: string) =>
        renderFoundryMarkdown(source, undefined, undefined, undefined, undefined, ctx);

    it("renders each convention's class on the element", () => {
        expect(foundry(LTR)).toBe(
            `<p>Said <span class="script hl-semaron-kuriale" lang="art-x-prv">${THRIMA} <em class="emph-rubric">${SORIMA}</em></span> once.</p>\n`,
        );
        expect(foundry(OVER)).toContain(`<em class="emph-overline">${NL}</em>`);
        expect(foundry(DIV)).toContain(`${THRIMA} <em class="emph-rubric">${SORIMA}</em>`);
    });
});

describe("Typst", () => {
    const typst = (source: string) => markdownToTypst(source, { runs: ctx });

    it("sets a rubric in the book's rubric ink", () => {
        expect(typst(LTR)).toContain(
            `#book-span(classes: ("script", "hl-semaron-kuriale"))[${THRIMA} #text(fill: book-rubric)[${SORIMA}]]`,
        );
        expect(typst(STRONG)).toContain(`#text(fill: book-rubric)[${SORIMA}]`);
    });

    it("sets an overline with Typst's own overline", () => {
        expect(typst(OVER)).toContain(
            `#book-span(classes: ("script", "hl-qalezu-hand"))[${GAR} #overline[${NL}]]`,
        );
    });

    it("sets a verse's emphasis by its convention", () => {
        expect(typst(VERSE)).toContain(`${GAR} #overline[${NL}]`);
    });

    it("sets a script with no convention plain", () => {
        expect(typst(PLAIN)).toContain(
            `#book-span(classes: ("script", "hl-thuravark-carved"))[${SO} ${SO}]`,
        );
    });

    it("defines the rubric ink once in the preamble", () => {
        expect(bookTypstPreamble(ctx)).toMatch(/^#let book-rubric = rgb\("#[0-9a-f]{6}"\)$/m);
    });

    it("reads no other tag, and no closing tag it did not open", () => {
        const out = typst('Roman <em>x</em>, <em class="name">y</em> and </strong>.');
        expect(out).not.toContain("#emph[");
        expect(out).not.toContain("book-rubric");
        expect(out).not.toContain("#overline[");
    });
});

/** A note as the lint reads it, its YAML written out so positions are real. */
const noteOf = (file: string, fm: object) => ({
    file,
    fm,
    raw: `---\n${YAML.stringify(fm)}---\n`,
});
const located = (findings: Array<{ line?: number; column?: number; message: string }>) =>
    findings.map((finding) => `${finding.line}:${finding.column}: ${finding.message}`);

const skill = (subType: string, script: object, shortcode = "semaronscrpt") =>
    noteOf(`${shortcode}.md`, {
        type: "skill",
        subType,
        shortcode,
        name: { full: "Semaron Script" },
        data: { script },
    });

const lint = (note: ReturnType<typeof noteOf>, index?: object) =>
    located(
        lintNote(note, {
            schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
            vocabulary: NOTE_VOCABULARY,
            ...(index ? { index } : {}),
        }).filter((finding: { message: string }) => finding.message.includes("data.script")),
    );

describe("`data.script` in the note lint", () => {
    it("accepts a script note's faces and its convention", () => {
        expect(lint(skill("script", { fonts: ["semaron-kuriale"], emphasis: "rubric" }))).toEqual(
            [],
        );
        expect(
            lint(
                skill("script", {
                    fonts: ["pirzath-hand"],
                    emphasis: "overline",
                    strongEmphasis: "rubric",
                }),
            ),
        ).toEqual([]);
    });

    it("refuses a convention the build does not know, at its value", () => {
        expect(lint(skill("script", { fonts: ["semaron-kuriale"], emphasis: "rubrik" }))).toEqual([
            '11:15: `data.script.emphasis` should be `rubric` or `overline`, but reads "rubrik". Did you mean "rubric"?',
        ]);
        expect(
            lint(
                skill("script", {
                    fonts: ["semaron-kuriale"],
                    emphasis: "rubric",
                    strongEmphasis: "bold",
                }),
            ),
        ).toEqual([
            '12:21: `data.script.strongEmphasis` should be `rubric` or `overline`, but reads "bold"',
        ]);
    });

    it("refuses a key it does not declare, and a missing face list or convention", () => {
        expect(
            lint(skill("script", { fonts: ["semaron-kuriale"], emphasis: "rubric", colour: "x" })),
        ).toEqual([
            '12:5: "colour" is not a key of `data.script`; it takes only `fonts`, `emphasis`, `strongEmphasis`',
        ]);
        expect(lint(skill("script", { emphasis: "rubric" }))).toEqual([
            "8:3: `data.script` must state `fonts` — list of installed faces' slugs",
        ]);
        expect(lint(skill("script", { fonts: ["semaron-kuriale"] }))).toEqual([
            "8:3: `data.script` must state `emphasis` — `rubric` or `overline`",
        ]);
    });

    it("refuses `data.script` on a skill that is not a script", () => {
        expect(lint(skill("language", { fonts: ["semaron-kuriale"], emphasis: "rubric" }))).toEqual(
            [
                "8:3: `data.script` states a script's faces and emphasis, and this note's `subType` is not `script`",
            ],
        );
    });

    it("refuses an empty list, a generic family and a face listed twice", () => {
        expect(lint(skill("script", { fonts: [], emphasis: "rubric" }))).toEqual([
            "9:12: `data.script.fonts` is empty; a script lists each face it is written in",
        ]);
        expect(lint(skill("script", { fonts: ["serif"], emphasis: "rubric" }))).toEqual([
            "10:9: `data.script.fonts[0]` is `serif`, a generic family; a script lists the faces it is written in",
        ]);
        expect(
            lint(
                skill("script", {
                    fonts: ["semaron-kuriale", "semaron-kuriale"],
                    emphasis: "rubric",
                }),
            ),
        ).toEqual([
            "11:9: `data.script.fonts[1]` lists the font `semaron-kuriale` a second time; the first is `data.script.fonts[0]`",
        ]);
    });

    it("refuses a face another script note lists", () => {
        const other = skill(
            "script",
            { fonts: ["semaron-kuriale"], emphasis: "overline" },
            "othrscrpt",
        );
        const note = skill("script", { fonts: ["semaron-kuriale"], emphasis: "rubric" });
        expect(lint(note, { notes: [note, other] })).toEqual([
            "10:9: `data.script.fonts[0]` is `semaron-kuriale`, which othrscrpt.md also lists; a face belongs to one script",
        ]);
    });
});

describe("the faces a script note lists", () => {
    it("are installed faces", () => {
        expect(
            located(
                checkScriptNoteFonts(
                    skill("script", {
                        fonts: ["semaron-kuriale", "qalezu-hnad"],
                        emphasis: "rubric",
                    }),
                    ctx,
                ),
            ),
        ).toEqual([
            "11:9: `qalezu-hnad` is not a font: `data.script.fonts[1]` names an installed face; did you mean `qalezu-hand`?",
        ]);
    });

    it("name the fonts package where none is installed", () => {
        expect(
            located(
                checkScriptNoteFonts(
                    skill("script", { fonts: ["semaron-kuriale"], emphasis: "rubric" }),
                    {
                        faces: new Map(),
                    },
                ),
            ),
        ).toEqual([
            "10:9: `semaron-kuriale` is not a font: `data.script.fonts[0]` names a face of @heroiclands/fonts, which this package has not installed",
        ]);
    });
});
