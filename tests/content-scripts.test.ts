/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **Text marked with `lang=`, `font=` and `map=`, and every fault in it
 * located.** One table of good markup, each with the runs it yields, and one
 * of bad markup, each with its message and the line and column it is
 * reported at.
 */

import { describe, expect, it } from "vitest";

import { scanRuns } from "../engine/content-scripts.mjs";
import { compileMap } from "../engine/text-maps.mjs";

/** A face drawing the given characters. */
const face = (slug: string, chars: string, direction = "ltr") => ({
    slug,
    family: slug,
    class: `hl-${slug}`,
    direction,
    features: [],
    draws: new Set(Array.from(chars, (char) => char.codePointAt(0))),
});

/** A face that draws `a` to `z` on U+F0200 onward, and its map from roman. */
const PUA = (char: string) => String.fromCodePoint(0xf0200 + char.charCodeAt(0) - 97);
const ROMAN = "abcdefghijklmnopqrstuvwxyz";

const ctx = {
    languages: {
        vyl: { tag: "art-x-vyl" },
        khel: { tag: "art-x-khel" },
    },
    faces: new Map([
        ["semaron-kuriale", face("semaron-kuriale", Array.from(ROMAN, PUA).join("") + ",.")],
        ["qalezu-hand", face("qalezu-hand", "\u{1EA00}\u{1EA01}", "rtl")],
    ]),
    maps: new Map([
        [
            "vyl-semaron",
            compileMap({
                name: "vyl-semaron",
                vowels: "aeiou",
                rows: [
                    ...Array.from(ROMAN.replace("q", ""), (char) => [char, PUA(char)]),
                    ["q", "\u{F02F9}"],
                ],
            }),
        ],
    ]),
};

const SEMARON = "lang=vyl font=semaron-kuriale map=vyl-semaron";

/** Good markup: no finding, and these runs in this order. */
const GOOD: Array<[string, string, Array<Record<string, unknown>>]> = [
    [
        "a span in a declared language",
        "[Daimela, helthos.]{lang=vyl}",
        [{ kind: "span", lang: "vyl", tag: "art-x-vyl", line: 1, column: 1 }],
    ],
    [
        "a span in a declared language, a face and a map",
        `Said [zaron tholmeza]{${SEMARON}} twice.`,
        [
            {
                kind: "span",
                lang: "vyl",
                tag: "art-x-vyl",
                font: "semaron-kuriale",
                map: "vyl-semaron",
                line: 1,
                column: 6,
            },
        ],
    ],
    [
        "a face with no language, its code points typed",
        `[${PUA("k")}${PUA("a")}]{font=semaron-kuriale}`,
        [{ kind: "span", lang: undefined, font: "semaron-kuriale", map: undefined }],
    ],
    [
        "a generic family, which draws everything",
        "[q x 7 ✓]{font=mono}",
        [{ kind: "span", font: "mono" }],
    ],
    [
        "a map with no font",
        "[ka]{map=vyl-semaron}",
        [{ kind: "span", map: "vyl-semaron", font: undefined }],
    ],
    [
        "an English span, which keeps its inline Markdown",
        "[to _stars_]{lang=en}",
        [{ kind: "span", lang: "en", tag: "en" }],
    ],
    [
        "a real language whose tag is mixed case",
        "[colour]{lang=en-GB}",
        [{ kind: "span", lang: "en-GB", tag: "en-GB" }],
    ],
    [
        "a real language in a face",
        "[ad astra]{lang=la font=semaron-kuriale map=vyl-semaron}",
        [{ kind: "span", lang: "la", tag: "la", font: "semaron-kuriale" }],
    ],
    [
        "a marked name in a declared language",
        "[Revothar]{.name lang=vyl}",
        [{ kind: "span", lang: "vyl" }],
    ],
    [
        "quotation and numeral keys, which need no escaping",
        '["ka" 1@ [tor] ^& ^[ma] <<ta>> !]{lang=vyl font=serif}',
        [{ kind: "span", font: "serif" }],
    ],
    [
        "an escaped bracket that stands alone",
        `[ka \\[ tor]{lang=vyl font=sans}`,
        [{ kind: "span", font: "sans" }],
    ],
    [
        "a div of paragraphs and line breaks",
        [
            `::: {${SEMARON}}`,
            "zaron tholmeza,  ",
            "daimela helthos.",
            "",
            "a second paragraph.",
            ":::",
        ].join("\n"),
        [
            {
                kind: "block",
                lang: "vyl",
                tag: "art-x-vyl",
                font: "semaron-kuriale",
                map: "vyl-semaron",
                line: 1,
                column: 1,
            },
        ],
    ],
    [
        "a div in a real language, which keeps its Markdown",
        ["::: {lang=en}", "- a list", "- of *two*", ":::"].join("\n"),
        [{ kind: "block", lang: "en", tag: "en" }],
    ],
    [
        "a marked div nested inside another div",
        ["::: {.outer}", "", "::: {lang=khel}", "Gar anlagh.", ":::", "", ":::"].join("\n"),
        [{ kind: "block", lang: "khel", tag: "art-x-khel", line: 3, column: 1 }],
    ],
    [
        "a run inside a div, which inherits its keys and overrides them",
        [`::: {${SEMARON}}`, "ka [ad astra]{lang=la font=serif} tor.", ":::"].join("\n"),
        [
            { kind: "block", lang: "vyl", font: "semaron-kuriale", map: "vyl-semaron" },
            {
                kind: "span",
                lang: "la",
                tag: "la",
                font: "serif",
                map: undefined,
                line: 2,
                column: 4,
            },
        ],
    ],
    [
        "a run inside a real language's div, which takes its tag",
        ["::: {lang=en}", "Said [ka]{font=semaron-kuriale map=vyl-semaron}.", ":::"].join("\n"),
        [
            { kind: "block", lang: "en" },
            { kind: "span", lang: "en", tag: "en", font: "semaron-kuriale" },
        ],
    ],
    [
        "a verse fence in a declared language, a face and a map",
        [`\`\`\`verse {form=epic ${SEMARON}}`, "zaron tholmeza,", "  daimela helthos.", "```"].join(
            "\n",
        ),
        [
            {
                kind: "verse",
                lang: "vyl",
                tag: "art-x-vyl",
                font: "semaron-kuriale",
                map: "vyl-semaron",
                line: 1,
                column: 1,
            },
        ],
    ],
    [
        "a run in a verse, which inherits the fence's keys",
        [`\`\`\`verse {${SEMARON}}`, "ka [tor]{font=mono}", "```"].join("\n"),
        [
            { kind: "verse", font: "semaron-kuriale" },
            { kind: "span", lang: "vyl", font: "mono", map: "vyl-semaron", line: 2, column: 4 },
        ],
    ],
    [
        "an English verse fence with emphasis",
        ["```verse {form=epic lang=en}", "_Counted._", "```"].join("\n"),
        [{ kind: "verse", lang: "en", tag: "en" }],
    ],
    [
        "markup inside literal code",
        ["```text", "[x]{font=nope}", "```", "", "`[y]{lang=q}`"].join("\n"),
        [],
    ],
    ["a plain span", "[a span]{.uniform}", []],
];

/** Bad markup: each finding as `line:column: message`, in order. */
const BAD: Array<[string, string, string[]]> = [
    [
        "an undeclared language that is not a tag",
        "Before [x]{lang=q} after.",
        [
            "1:17: `q` is not a declared language (`languages` in package-build.config.yaml) or a BCP 47 tag",
        ],
    ],
    [
        "a near miss of a declared language",
        "[x]{lang=vyl_}",
        [
            "1:10: `vyl_` is not a declared language (`languages` in package-build.config.yaml) or a BCP 47 tag; did you mean `vyl`?",
        ],
    ],
    [
        "an unknown font",
        "[x]{font=semaron-kurial}",
        [
            "1:10: `semaron-kurial` is not a font: `font=` names an installed face, or `mono`, `serif` or `sans`; did you mean `semaron-kuriale`?",
        ],
    ],
    [
        "an unknown map",
        "[x]{map=vyl-semron}",
        [
            "1:9: `vyl-semron` is not a map: `map=` names the `data.map.name` of a mapping note; did you mean `vyl-semaron`?",
        ],
    ],
    [
        "a character the face does not draw, with no map",
        "[ka]{font=semaron-kuriale}",
        [
            "1:2: `k` (U+006B) is not drawn by the font `semaron-kuriale`",
            "1:3: `a` (U+0061) is not drawn by the font `semaron-kuriale`",
        ],
    ],
    [
        "a character the map leaves as it is and the face does not draw",
        `[ka 7 ka]{${SEMARON}}`,
        [
            "1:5: `7` (U+0037) is not drawn by the font `semaron-kuriale`, and the map `vyl-semaron` has no row for it",
        ],
    ],
    [
        "a row that maps to a code point the face does not draw",
        `[ta qa]{${SEMARON}}`,
        [
            "1:5: `q` maps to U+F02F9 in the map `vyl-semaron`, which the font `semaron-kuriale` does not draw",
        ],
    ],
    [
        "emphasis in a declared language",
        "[a *b* c]{lang=vyl}",
        ["1:4: a span in non-English language `vyl` holds no bold or italic markup"],
    ],
    [
        "a link in a face",
        `[a [b](https://example.org) c]{${SEMARON}}`,
        [`1:4: text marked \`${SEMARON}\` is plain text and holds no link`],
    ],
    [
        "an image in a generic family",
        `[a ![b](c.webp) c]{font=serif}`,
        [`1:4: text marked \`font=serif\` is plain text and holds no image`],
    ],
    [
        "a wikilink in a declared language",
        "[a [[lore-harbor]] c]{lang=vyl}",
        ["1:4: text marked `lang=vyl` is plain text and holds no wikilink"],
    ],

    [
        "a footnote in a declared language",
        ["[a [^1] c]{lang=vyl}", "", "[^1]: A note."].join("\n"),
        ["1:4: text marked `lang=vyl` is plain text and holds no footnote"],
    ],
    [
        "code in a map",
        "[a `b` c]{map=vyl-semaron}",
        ["1:4: text marked `map=vyl-semaron` is plain text and holds no code"],
    ],
    [
        "HTML in a declared language",
        "[a <b>c</b>]{lang=vyl}",
        [
            "1:4: text marked `lang=vyl` is plain text and holds no HTML",
            "1:8: text marked `lang=vyl` is plain text and holds no HTML",
        ],
    ],
    [
        "an undeclared language on a div",
        ["Prose.", "", "::: {.verse lang=q}", "Ka tor.", ":::"].join("\n"),
        [
            "3:18: `q` is not a declared language (`languages` in package-build.config.yaml) or a BCP 47 tag",
        ],
    ],
    [
        "a character a div's face does not draw, on a later line",
        [`::: {${SEMARON}}`, "ka", "  t7", ":::"].join("\n"),
        [
            "3:4: `7` (U+0037) is not drawn by the font `semaron-kuriale`, and the map `vyl-semaron` has no row for it",
        ],
    ],
    [
        "block structure in a marked div",
        [
            `::: {${SEMARON}}`,
            "# A heading",
            "",
            "- a list",
            "",
            "> a quote",
            "",
            "A paragraph with ~~strikethrough~~ in it.",
            ":::",
        ].join("\n"),
        [
            `2:1: a div marked \`${SEMARON}\` holds paragraphs and line breaks only, not a heading`,
            `4:1: a div marked \`${SEMARON}\` holds paragraphs and line breaks only, not a list`,
            `6:1: a div marked \`${SEMARON}\` holds paragraphs and line breaks only, not a block quote`,
            `8:18: text marked \`${SEMARON}\` takes emphasis only as \`*…*\`, \`_…_\`, \`**…**\` or \`__…__\``,
        ],
    ],
    [
        "a verse fence inside a marked div",
        [`::: {${SEMARON}}`, "```verse", "Ka tor.", "```", ":::"].join("\n"),
        [
            `2:1: a div marked \`${SEMARON}\` holds paragraphs and line breaks only, not a verse fence`,
        ],
    ],
    [
        "an undeclared language on a verse fence",
        ["  ```verse {lang=en_GB}", "  The watch.", "  ```"].join("\n"),
        [
            "1:18: `en_GB` is not a declared language (`languages` in package-build.config.yaml) or a BCP 47 tag",
        ],
    ],
    [
        "emphasis in a verse of a declared language",
        ["```verse {lang=vyl}", "Zaron,", "  daimela *helthos*.", "```"].join("\n"),
        ["3:11: text marked `lang=vyl` is plain text and holds no emphasis"],
    ],
    [
        "a reserved key on a secret block",
        [":::secret {font=mono}", "Ka tor.", ":::"].join("\n"),
        ["1:12: `font=` is read on a span, a div or a verse fence, not on a secret block"],
    ],
];

function findings(source: string, context: object = ctx) {
    return scanRuns(source, context).errors.map(
        (error: { line: number; column: number; message: string }) =>
            `${error.line}:${error.column}: ${error.message}`,
    );
}

describe("marking text with lang=, font= and map=", () => {
    it.each(GOOD)("accepts %s", (_, source, runs) => {
        const scanned = scanRuns(source, ctx);
        expect(scanned.errors).toEqual([]);
        expect(scanned.runs).toHaveLength(runs.length);
        runs.forEach((run, n) => expect(scanned.runs[n]).toMatchObject(run));
    });

    it.each(BAD)("refuses %s, at the fault", (_, source, expected) => {
        expect(findings(source)).toEqual(expected);
    });

    it("reads a declared name before a tag, and a tag only when no name is declared", () => {
        const art = { ...ctx, languages: { art: { tag: "art-x-art" } } };
        expect(scanRuns("[x]{lang=art}", art).runs[0]).toMatchObject({ tag: "art-x-art" });
        expect(scanRuns("[x]{lang=art}", ctx).runs[0]).toMatchObject({ tag: "art" });
    });

    it("knows only the generic families and tags with no configuration", () => {
        expect(scanRuns("[x]{lang=en font=serif}", {}).errors).toEqual([]);
        expect(findings("[x]{font=semaron-kuriale}", {})).toEqual([
            "1:10: `semaron-kuriale` is not a font: `font=` names `mono`, `serif` or `sans`, or a face of @heroiclands/fonts, which this package has not installed",
        ]);
        expect(findings("[x]{map=vyl-semaron}", {})).toHaveLength(1);
        expect(findings("[x]{lang=q}", {})).toHaveLength(1);
    });

    it("reports a character once per run, at its first place", () => {
        expect(findings("[aa aa]{font=semaron-kuriale}")).toEqual([
            "1:2: `a` (U+0061) is not drawn by the font `semaron-kuriale`",
        ]);
    });

    it("locates a character through the map at the start of the matched sequence", () => {
        const long = {
            ...ctx,
            maps: new Map([
                [
                    "long",
                    compileMap({
                        name: "long",
                        rows: [
                            ["k", PUA("k")],
                            ["tsa", "\u{F02FF}"],
                        ],
                    }),
                ],
            ]),
        };
        expect(findings("[k tsa]{font=semaron-kuriale map=long}", long)).toEqual([
            "1:4: `tsa` maps to U+F02FF in the map `long`, which the font `semaron-kuriale` does not draw",
        ]);
    });

    it("records a run whose language does not resolve, with no tag", () => {
        expect(scanRuns("[x]{lang=q}", ctx).runs).toEqual([
            expect.objectContaining({ kind: "span", lang: "q", tag: undefined }),
        ]);
    });

    it.each([
        [
            "a transposed name",
            "Said [x]{lang=vly}.",
            "1:15: `vly` is read as a BCP 47 tag; did you mean the declared language `vyl`?",
        ],
        [
            "a name in the wrong case",
            "[x]{lang=Vyl}",
            "1:10: `Vyl` is read as a BCP 47 tag; did you mean the declared language `vyl`?",
        ],
        [
            "a name one letter off",
            "::: {lang=vy}\nKa.\n:::",
            "1:11: `vy` is read as a BCP 47 tag; did you mean the declared language `vyl`?",
        ],
    ])("warns, at the value, when %s is read as a tag", (_, source, expected) => {
        const scanned = scanRuns(source, ctx);
        expect(scanned.errors).toEqual([]);
        expect(
            scanned.warnings.map(
                (w: { line: number; column: number; message: string }) =>
                    `${w.line}:${w.column}: ${w.message}`,
            ),
        ).toEqual([expected]);
    });

    it("does not warn for a declared name, a far tag or a tag no name is near", () => {
        expect(scanRuns("[x]{lang=vyl}", ctx).warnings).toEqual([]);
        expect(scanRuns("[x]{lang=la}", ctx).warnings).toEqual([]);
        expect(scanRuns("[x]{lang=vly}", {}).warnings).toEqual([]);
    });
});
