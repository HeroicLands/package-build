/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { scanRuns, renderRuns } from "../engine/content-scripts.mjs";
import { compileTestEncoding } from "./helpers/encoding.js";

const encoded = compileTestEncoding({
    name: "letters",
    fonts: [{ font: "script" }],
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
                family: "Test",
                class: "hl-script",
                draws: new Set([..."字。 \u{E010C}"].map((char) => char.codePointAt(0))),
            },
        ],
    ]),
    encodings: new Map([["letters", encoded]]),
};
const fence = (body: string, attrs = "lang=vyl enc=letters") =>
    "```verse {" + attrs + "}\n" + body + "\n```";
const presentation = (source: string) => {
    const result = renderRuns(source, ctx);
    expect(result.errors).toEqual([]);
    expect(result.verses.size).toBe(1);
    return [...result.verses.values()][0];
};

describe("encoded verse pairs", () => {
    it("derives aligned native and Roman lines from one original", () => {
        const pair = presentation(fence("word/..word\nword"));
        expect(pair.model.groups[0].lines).toMatchObject([
            { text: "字\u{E010C}", romanText: "word", level: 0 },
            { text: "字 字", romanText: "word word", level: 2 },
        ]);
        expect(pair.classes).toContain("hl-script");
    });
    it("keeps enc=default and omitted enc as single-column verse", () => {
        for (const attrs of ["lang=vyl", "lang=vyl enc=default"])
            expect(renderRuns(fence("word/word", attrs), ctx).verses.size).toBe(0);
    });
    it("retains codage on the Roman side and semantic span hooks on both", () => {
        const pair = presentation(fence("[word]{.speaker}/[⟦U+5B57⟧]{.direction}"));
        expect(pair.model.groups[0].lines[0]).toMatchObject({ romanText: "[word]{.speaker}" });
        expect(pair.model.groups[0].lines[0].text).toContain(".speaker");
        expect(pair.model.groups[0].lines[1].romanText).toContain("⟦U+5B57⟧");
        expect(pair.model.groups[0].lines[1].text).toContain(".direction");
    });
    it("balances semantic spans across explicit line boundaries", () => {
        const pair = presentation(fence("[word/word]{.direction}"));
        expect(pair.model.groups[0].lines.map((line) => line.text)).toEqual([
            "[字\u{E010C}]{lang=art-x-vyl .direction .script .hl-script}",
            "[字]{lang=art-x-vyl .direction .script .hl-script}",
        ]);
    });
    it("keeps inline language and encoding choices scoped to the native presentation", () => {
        const pair = presentation(fence("[word]{lang=vyl enc=letters}/word"));
        expect(pair.model.groups[0].lines[0].romanText).toBe("[word]{lang=art-x-vyl}");
    });
    it("joins a semantic span written across source lines", () => {
        const pair = presentation(fence("[word\nword]{.direction}"));
        const line = pair.model.groups[0].lines[0];
        expect(line.romanText).toBe("[word word]{.direction}");
        expect(line.text).toContain("字 字");
        expect(line.text).toContain(".direction");
    });
    it("preserves link destinations and shared footnote syntax while encoding labels", () => {
        const pair = presentation(
            fence("[word](https://example.org/a/b) word[^one]/word") + "\n\n[^one]: Shared note.",
        );
        const line = pair.model.groups[0].lines[0];
        expect(line.text).toContain("[字](https://example.org/a/b)");
        expect(line.text).toContain("[^one]");
        expect(line.romanText).toContain("[word](https://example.org/a/b)");
        expect(line.romanText).toContain("[^one]");
    });
    it("normalizes nested Roman attributes without moving outer span boundaries", () => {
        const pair = presentation(fence("[word [word]{lang=vyl enc=letters}]{.direction}/word"));
        expect(pair.model.groups[0].lines[0].romanText).toBe(
            "[word [word]{lang=art-x-vyl}]{.direction}",
        );
    });
    it("keeps an authored anchor only in the native presentation", () => {
        const pair = presentation(fence("[word]{#cue .speaker}"));
        expect(pair.model.groups[0].lines[0].text).toContain("#cue");
        expect(pair.model.groups[0].lines[0].romanText).toBe("[word]{.speaker}");
    });
    it("emits one native anchor when an anchored speaker spans explicit lines", () => {
        const pair = presentation(fence("[word/word]{#cue .speaker}"));
        const lines = pair.model.groups[0].lines;
        expect(
            lines
                .map((line) => line.text)
                .join("")
                .match(/#cue/g),
        ).toHaveLength(1);
        expect(lines.map((line) => line.romanText).join("")).not.toContain("#cue");
    });
    it("normalizes sibling Roman attributes without shifting their source positions", () => {
        const pair = presentation(fence("[word]{enc=letters} [word]{lang=vyl enc=letters}"));
        expect(pair.model.groups[0].lines[0].romanText).toBe("[word]{} [word]{lang=art-x-vyl}");
    });
    it("preserves wikilink addresses while encoding their visible labels", () => {
        const pair = presentation(fence("word [[lore-destination/path|word]]/word"));
        expect(pair.model.groups[0].lines[0].text).toContain("[[lore-destination/path|字]]");
        expect(pair.model.groups[0].lines[0].romanText).toContain("[[lore-destination/path|word]]");
    });
    it("records one fence run without per-line marked spans", () => {
        const source = fence("word/word\n\nword");
        expect(scanRuns(source, ctx).errors).toEqual([]);
        expect(scanRuns(source, ctx).runs).toMatchObject([
            { kind: "verse", lang: "vyl", enc: "letters", font: "script" },
        ]);
        expect(scanRuns(source, ctx).runs).toHaveLength(1);
        expect(renderRuns(source, ctx).verses.size).toBe(1);
    });
    it("does not collapse distinct originals with identical encoded output", () => {
        const source = fence("word") + "\n\n" + fence("word ");
        const result = renderRuns(source, ctx);
        expect(result.verses.size).toBe(2);
    });
});
