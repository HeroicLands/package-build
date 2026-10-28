/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { scanRuns, renderRuns } from "../engine/content-scripts.mjs";
import { scanSpans } from "../engine/content-spans.mjs";
import { compileTestEncoding } from "./helpers/encoding.js";

const encoding = compileTestEncoding({
    name: "letters",
    fonts: ["script"],
    rows: [
        ["word", "字"],
        [".", "。"],
    ],
});
const ctx = {
    languages: { vyl: { tag: "art-x-vyl" } },
    faces: new Map([
        [
            "script",
            {
                slug: "script",
                family: "Script",
                class: "hl-script",
                draws: new Set([..."字。 \u{E010C}"].map((char) => char.codePointAt(0))),
            },
        ],
    ]),
    encodings: new Map([["letters", encoding]]),
};
const attrs = "lang=vyl enc=letters";

describe("verse markup language runs", () => {
    it.each([`::: {.verse ${attrs}}`, `:::verse {${attrs}}`])(
        "records and pairs one original for %s",
        (opening) => {
            const source = `${opening}\nword/..word\n:::`;
            const scanned = scanRuns(source, ctx);
            expect(scanned.errors).toEqual([]);
            expect(scanned.runs).toHaveLength(1);
            expect(scanned.runs[0]).toMatchObject({ kind: "verse", lang: "vyl", enc: "letters" });
            const rendered = renderRuns(source, ctx);
            expect(rendered.errors).toEqual([]);
            expect(rendered.verses.size).toBe(1);
            expect([...rendered.verses.values()][0].model.groups[0].lines).toMatchObject([
                { text: "字\u{E010C}", romanText: "word", level: 0 },
                { text: "字", romanText: "word", level: 2 },
            ]);
        },
    );
    it("renders an encoded inline quotation as one continuous script span", () => {
        const source = `Before [word/..word//]{.verse ${attrs}} after.`;
        const result = renderRuns(source, ctx);
        expect(result.errors).toEqual([]);
        expect(result.verses.size).toBe(0);
        expect(result.markdown).toBe(
            "Before [字\u{E010C}字]{lang=art-x-vyl .script .hl-script} after.",
        );
        expect(scanRuns(source, ctx).runs).toHaveLength(1);
    });
    it("keeps several encoded quotations on one line distinct without Roman copies", () => {
        const source = `[word]{.verse ${attrs}} and [word/word]{.verse ${attrs}}.`;
        const result = renderRuns(source, ctx);
        expect(result.errors).toEqual([]);
        expect(result.verses.size).toBe(0);
        expect(result.markdown.match(/\.hl-script/g)).toHaveLength(2);
        expect(result.markdown).not.toContain(".verse");
    });
    it("does not encode nested verse div delimiters as outer marked prose", () => {
        const source = `::: {${attrs}}\n:::verse\nword/word\n:::\n:::`;
        expect(scanRuns(source, ctx).errors).toEqual([]);
        expect(scanRuns(source, ctx).runs.filter((run) => run.kind === "verse")).toHaveLength(1);
    });
    it("gives plain inline quotations a logical model without creating a language run", () => {
        const source = "Before [word/..word//]{.verse} after.";
        expect(
            scanSpans(source).spans.find((span) => span.verseModel)?.verseModel.groups[0].lines,
        ).toHaveLength(2);
        expect(scanRuns(source, ctx).runs).toEqual([]);
    });
});
