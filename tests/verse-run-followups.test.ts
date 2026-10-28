/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { compileEncoding, compileRows, encodeText } from "../engine/encoding.mjs";
import { STANDARD_CONTROLS } from "../engine/encoding-standard.mjs";
import { scanSpans } from "../engine/content-spans.mjs";
import { renderRuns, scanRuns } from "../engine/content-scripts.mjs";
import { resolveWebWikilinks } from "../engine/wikilinks.mjs";

const line = "\u{E010C}";
const stanza = STANDARD_CONTROLS.verseStanza;
const slash = "\u{E010F}";
const template = compileEncoding(
    {
        language: "vyl",
        font: "script",
        mappings: { word: "WORD", and: "AND", or: "OR" },
        rules: { normalization: "NFC", matching: "longest-first" },
    },
    { name: "letters", codes: { WORD: "字", AND: "和", OR: "或" } },
);
const rows = compileRows({
    name: "letters",
    fonts: ["script"],
    accepts: ["a-z", "/", "\\"],
    separator: " ",
    controls: STANDARD_CONTROLS,
    rows: [
        ["word", "字"],
        ["and", "和"],
        ["or", "或"],
        ["/", line],
        ["\\/", slash],
    ],
});
const context = (encoding = template) => ({
    languages: { vyl: { tag: "art-x-vyl" }, other: { tag: "art-x-other" } },
    romanInventories: new Map([
        ["vyl", { language: "vyl", characters: new Set("wordan") }],
        ["other", { language: "other", characters: new Set("ZebraQuartzs") }],
    ]),
    wordBooks: new Map([
        [
            "vyl",
            { language: "vyl", accepts: (word: string) => ["word", "and", "or"].includes(word) },
        ],
        [
            "other",
            { language: "other", accepts: (word: string) => ["zebra", "quartz"].includes(word) },
        ],
    ]),
    faces: new Map([
        [
            "script",
            {
                slug: "script",
                family: "Script",
                class: "hl-script",
                draws: new Set([0x5b57, 0x548c, 0x6216]),
            },
        ],
    ]),
    encodings: new Map([["letters", encoding]]),
});
const div = (body: string, attrs = "lang=vyl") => `::: {.verse ${attrs}}\n${body}\n:::`;

describe("verse run inheritance and source projection", () => {
    it.each(["\n", "\r\n"])("rewrites inherited shorthand without stray text (%j)", (newline) => {
        const render = (opening: string) =>
            renderRuns(["::: {lang=en}", opening, "One", ":::", ":::"].join(newline), context());
        const shorthand = render(":::verse");
        expect(shorthand.errors).toEqual([]);
        expect(shorthand.markdown).toBe(render("::: {.verse}").markdown);
        expect(shorthand.markdown).toBe(
            ["::: {lang=en}", "::: {lang=en .verse}", "One", ":::", ":::"].join(newline),
        );
    });
    it.each(["lang=vyl font=serif", "lang=vyl enc=letters"])(
        "gives nested shorthand the same presentation as a braced div (%s)",
        (attrs) => {
            const render = (opening: string) =>
                renderRuns(`::: {${attrs}}\n${opening}\nword\n:::\n:::`, context());
            const shorthand = render(":::verse");
            expect(shorthand.errors).toEqual([]);
            expect(shorthand.markdown).toBe(render("::: {.verse}").markdown);
        },
    );
    it("names a refused verse fence and the accepted div syntax", () => {
        const result = scanRuns("::: {lang=vyl}\n```verse\nword\n```\n:::", context());
        expect(result.errors).toEqual([
            expect.objectContaining({
                line: 2,
                column: 1,
                message: expect.stringMatching(/code fence.*verse.*:::.*\.verse/),
            }),
        ]);
    });
    it.each(["en", "other"])("applies a raw wikilink's %s override inside verse", (lang) => {
        for (const newline of ["\n", "\r\n"]) {
            const source = div(`word [[doc-place|Zebra Quartz]]{lang=${lang}} word`).replaceAll(
                "\n",
                newline,
            );
            expect(scanRuns(source, context()).errors).toEqual([]);
            expect(renderRuns(source, context()).markdown).toContain(
                `[[doc-place|Zebra Quartz]]{lang=${lang}}`,
            );
        }
    });
    it.each([":::verse {lang=vyl}\n", "[", "::: {.verse lang=vyl}\n"])(
        "applies link language attributes in each verse spelling (%s)",
        (opening) => {
            const body = "word [[doc-place|Zebra Quartz]]{lang=en} word";
            const source = opening + body + (opening === "[" ? "]{.verse lang=vyl}" : "\n:::");
            expect(scanRuns(source, context()).errors).toEqual([]);
        },
    );
    it("keeps the inherited language on an unmarked wikilink label", () => {
        expect(scanRuns(div("[[doc-place|Zebra Quartz]]"), context()).errors).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    line: 2,
                    column: 13,
                    message: expect.stringContaining("Z"),
                }),
            ]),
        );
    });
    it("retains explicit child language validation at the label and attribute positions", () => {
        const source = div("word [[doc-place|Zebra $]]{lang=other} word");
        expect(scanRuns(source, context()).errors).toEqual([
            expect.objectContaining({ line: 2, column: 24, message: expect.stringContaining("$") }),
        ]);
        const unknown = div("word [[doc-place|Zebra Quartz]]{lang=en_bad}");
        expect(scanRuns(unknown, context()).errors).toContainEqual(
            expect.objectContaining({
                line: 2,
                column: 38,
                message: expect.stringContaining("en_bad"),
            }),
        );
    });
    it("checks an explicit language's lexicon at the original label", () => {
        const result = scanRuns(div("word [[doc-place|Zebras]]{lang=other} word"), context());
        expect(result.errors).toEqual([
            expect.objectContaining({
                line: 2,
                column: 18,
                message: expect.stringContaining("not a word of the `other` lexicon"),
            }),
        ]);
    });
    it.each(["en", "other"])(
        "keeps a %s link target and Roman label through native rendering",
        (lang) => {
            const source = div(
                `word [[doc-place|Zebra Quartz]]{lang=${lang}}/word`,
                "lang=vyl enc=letters",
            );
            expect(scanRuns(source, context()).errors).toEqual([]);
            expect(renderRuns(source, context()).markdown).toContain(
                `[[doc-place|Zebra Quartz]]{lang=${lang}}`,
            );
            const links = {
                index: new Map([["demo-note-doc-place", { name: "Place", url: "/place/" }]]),
                contentPackage: "demo",
                packages: new Set(["demo"]),
                contentTypes: new Set(["doc"]),
                errors: [],
            };
            const resolved = resolveWebWikilinks(source, links);
            expect(links.errors).toEqual([]);
            const result = renderRuns(resolved, context());
            expect(result.errors).toEqual([]);
            const first = [...result.verses.values()][0].model.groups[0].lines[0];
            expect(first.text).toContain("字");
            expect(first.text).toContain("[Zebra Quartz](/place/)");
            expect(first.text).toContain(
                `lang=${lang === "en" ? "en" : "art-x-other"} .font-serif`,
            );
            expect(first.romanText).toContain("[Zebra Quartz](/place/)");
            expect(first.romanText).not.toContain("enc=");
        },
    );
});

describe.each([
    ["template", template],
    ["rows", rows],
] as const)("inline stanza controls from %s encodings", (_name, encoding) => {
    it("proves the direct encoding path supplies stanza controls", () => {
        expect(encodeText(encoding, "word\n\nword\n\n", { verse: true })).toBe(
            `字${stanza}字${stanza}`,
        );
    });
    it.each([
        ["word//word//", `字${stanza}字${stanza}`],
        ["word////word////", `字${stanza}${stanza}字${stanza}${stanza}`],
        ["word/word////", `字${line}字${stanza}${stanza}`],
        ["and\\/or////word", `和${slash}或${stanza}${stanza}字`],
    ])("retains every authored boundary in %s", (body, expected) => {
        const result = renderRuns(`[${body}]{.verse lang=vyl enc=letters}`, context(encoding));
        expect(result.errors).toEqual([]);
        expect(result.markdown).toBe(`[${expected}]{lang=art-x-vyl .script .hl-script}`);
    });
    it.each(["\n", "\r\n"])("retains controls across source newlines (%j)", (newline) => {
        const result = renderRuns(
            `[word//${newline}//word//]{.verse lang=vyl enc=letters}`,
            context(encoding),
        );
        expect(result.errors).toEqual([]);
        expect(result.markdown).toBe(
            `[字${stanza}${stanza}字${stanza}]{lang=art-x-vyl .script .hl-script}`,
        );
    });
    it("renders LF and CRLF quotations identically with child attributes and footnotes", () => {
        const outputs = ["\n", "\r\n"].map((newline) => {
            const source = `[word//${newline}//[Zebra]{lang=en} wo[^note]rd//]{.verse lang=vyl enc=letters}${newline}${newline}[^note]: Note.`;
            const result = renderRuns(source, context(encoding));
            expect(result.errors).toEqual([]);
            expect(result.markdown).toContain(`[Zebra]{lang=en .font-serif}`);
            expect(result.markdown.match(/\[\^note\](?!:)/g)).toHaveLength(1);
            expect(result.markdown).toContain(`${stanza}${stanza}`);
            expect(result.markdown).toContain(
                `字${stanza}]{lang=art-x-vyl .script .hl-script}[^note]`,
            );
            return result.markdown.replaceAll("\r\n", "\n");
        });
        expect(outputs[1]).toBe(outputs[0]);
    });
    it.each(["\n", "\r\n"])(
        "locates a source finding after a supplementary child (%j)",
        (newline) => {
            const source = `[word//${newline}[😀]{lang=en} wo[^note]rd $//]{.verse lang=vyl enc=letters}${newline}${newline}[^note]: Note.`;
            expect(scanRuns(source, context(encoding)).errors).toEqual([
                expect.objectContaining({
                    line: 2,
                    column: 26,
                    message: expect.stringContaining("$"),
                }),
            ]);
        },
    );
    it.each(["\n", "\r\n"])(
        "keeps container-spanning native quotations equivalent (%j)",
        (newline) => {
            const source = `> [word//${newline}> //word//]{.verse lang=vyl enc=letters}`;
            const result = renderRuns(source, context(encoding));
            expect(result.errors).toEqual([]);
            expect(result.markdown).toBe(
                `> [字${stanza}${stanza}字${stanza}]{lang=art-x-vyl .script .hl-script}`,
            );
        },
    );
    it("extracts a footnote once while retaining consecutive and trailing controls", () => {
        const result = renderRuns(
            "[wo[^note]rd////word//]{.verse lang=vyl enc=letters}\n\n[^note]: Note.",
            context(encoding),
        );
        expect(result.errors).toEqual([]);
        expect(result.markdown).toBe(
            `[字${stanza}${stanza}字${stanza}]{lang=art-x-vyl .script .hl-script}[^note]\n\n[^note]: Note.`,
        );
    });
});

it("keeps normalized span text while locating verse models in the raw source", () => {
    const source = "[word//\r\n//word//]{.verse lang=en}";
    const span = scanSpans(source).spans[0];
    expect(span.text).toBe("word//\n//word//");
    expect(source[span.contentEnd]).toBe("]");
    expect(span.verseModel?.boundaries.map(({ sourceOffset }) => sourceOffset)).toEqual([4, 8, 14]);
    expect(
        span.verseModel?.groups.flatMap((group) => group.lines.map((line) => line.text)),
    ).toEqual(["word", "word"]);
});

it.each(["\n", "\r\n"])("keeps container prefixes out of a quoted model (%j)", (newline) => {
    const source = `> [word//${newline}> word]{.verse lang=en}`;
    const span = scanSpans(source).spans[0];
    expect(span.text).toBe("word//\nword");
    expect(
        span.verseModel?.groups.flatMap((group) => group.lines.map((line) => line.text)),
    ).toEqual(["word", "word"]);
    const final = span.verseModel!.groups[1];
    expect(final.lines[0].offsets.map((offset) => source[span.start + 1 + offset]).join("")).toBe(
        "word",
    );
});

it.each(["\n", "\r\n"])(
    "locates child attributes and inline grammar after supplementary text (%j)",
    (newline) => {
        const source = `[word//${newline}[😀]{lang=en_bad}//word]{.verse lang=vyl}`;
        expect(scanRuns(source, context()).errors).toContainEqual(
            expect.objectContaining({
                line: 2,
                column: 10,
                message: expect.stringContaining("en_bad"),
            }),
        );
        const invalid = `[😀//${newline}//***//]{.verse lang=en}`;
        const findings = scanSpans(invalid).errors;
        expect(findings).toEqual([
            expect.objectContaining({
                line: 2,
                column: 3,
                message: expect.stringContaining("canto"),
            }),
        ]);
        const lfFindings = scanSpans(invalid.replaceAll("\r\n", "\n")).errors;
        expect(findings).toEqual(lfFindings);
    },
);
