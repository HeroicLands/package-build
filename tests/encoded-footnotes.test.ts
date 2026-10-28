/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { renderRuns, scanRuns } from "../engine/content-scripts.mjs";
import { compileTestEncoding } from "./helpers/encoding.js";

const enc = compileTestEncoding({ name: "letters", fonts: ["script"], rows: [["word", "字"]] });
const ctx = {
    languages: { vyl: { tag: "art-x-vyl" } },
    faces: new Map([
        [
            "script",
            {
                slug: "script",
                family: "Script",
                class: "hl-script",
                draws: new Set(["字".codePointAt(0)]),
            },
        ],
    ]),
    encodings: new Map([["letters", enc]]),
};
const attrs = "lang=vyl enc=letters";
const note = "\n\n[^sea]: A shared explanation.\n";

describe("footnotes in encoded originals", () => {
    it("extracts a midword reference before ordinary span encoding and restores it outside the font", () => {
        const result = renderRuns(`Before [wo[^sea]rd]{${attrs}} after.${note}`, ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toContain("[字]{lang=art-x-vyl .script .hl-script}[^sea] after.");
        expect(result.markdown.match(/\[\^sea\](?!:)/g)).toHaveLength(1);
    });
    it("draws an encoded verse span as continuous script with its encoded controls only", () => {
        const result = renderRuns(`[word/..word//]{.verse ${attrs}}`, ctx);
        expect(result.errors).toEqual([]);
        expect(result.verses.size).toBe(0);
        expect(result.markdown).not.toContain(".verse");
        expect(result.markdown).not.toContain("/..");
        expect(result.markdown).toContain("字\u{E010C}字");
    });
    it("puts a verse-span reference after the script span rather than in a Roman duplicate", () => {
        const result = renderRuns(`[wo[^sea]rd/word]{.verse ${attrs}}${note}`, ctx);
        expect(result.errors).toEqual([]);
        expect(result.verses.size).toBe(0);
        expect(result.markdown).toContain(
            "字\u{E010C}字]{lang=art-x-vyl .script .hl-script}[^sea]",
        );
    });
    it("keeps a div reference at its original Roman word and out of the native model", () => {
        const source = `::: {.verse ${attrs}}\nwo[^sea]rd/word\n:::${note}`;
        const result = renderRuns(source, ctx);
        expect(result.errors).toEqual([]);
        const lines = [...result.verses.values()][0].model.groups[0].lines;
        expect(lines[0].romanText).toBe("wo[^sea]rd");
        expect(lines.map((line) => line.text).join("")).not.toContain("[^sea]");
        expect(scanRuns(source, ctx).runs).toHaveLength(1);
    });
    it("omits references in an explicit Roman child from the native div only", () => {
        const result = renderRuns(
            `::: {.verse ${attrs}}\nword [word[^sea]]{lang=en}/word\n:::${note}`,
            ctx,
        );
        expect(result.errors).toEqual([]);
        const line = [...result.verses.values()][0].model.groups[0].lines[0];
        expect(line.text).not.toContain("[^sea]");
        expect(line.romanText).toContain("[word[^sea]]{lang=en}");
    });
    it("bubbles a nested encoded reference outside the outer script span once", () => {
        const result = renderRuns(`[word [word[^sea]]{${attrs}}]{${attrs}}${note}`, ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown.match(/\[\^sea\](?!:)/g)).toHaveLength(1);
        expect(result.markdown).toContain(".hl-script}[^sea]\n");
    });
    it("retains following prose when a book link label contains an extracted reference", () => {
        const source = `[@UUID[Compendium.demo.journal]{wo[^sea]rd}]{${attrs}} after.${note}`;
        const result = renderRuns(source, ctx, undefined, { target: "book" });
        expect(result.errors).toEqual([]);
        expect(result.markdown).toContain("[^sea] after.");
        expect(result.markdown.match(/\[\^sea\](?!:)/g)).toHaveLength(1);
    });
    it("keeps a note-only original out of native text without losing its Roman reference", () => {
        const result = renderRuns(`::: {.verse ${attrs}}\n[^sea]\n:::${note}`, ctx);
        expect(result.errors).toEqual([]);
        const model = [...result.verses.values()][0].model;
        expect(model.groups).toEqual([]);
        expect(model.notes).toMatchObject([{ text: "", romanText: "[^sea]" }]);
    });
    it("does not draw an extra verse mark for a reference-only logical line", () => {
        const result = renderRuns(`::: {.verse ${attrs}}\nword/\n[^sea]/\nword\n:::${note}`, ctx);
        expect(result.errors).toEqual([]);
        const lines = [...result.verses.values()][0].model.groups[0].lines;
        expect(lines).toHaveLength(2);
        expect(
            lines
                .map((line) => line.text)
                .join("")
                .split("\u{E010C}"),
        ).toHaveLength(2);
        expect(lines.map((line) => line.romanText).join("")).toContain("[^sea]");
    });
    it("keeps references written in metadata as literal attribute text", () => {
        const result = renderRuns(`[word]{${attrs} title="[^sea]"}${note}`, ctx);
        expect(result.errors).toEqual([]);
        expect(result.markdown).toContain('title="[^sea]"');
        expect(result.markdown).not.toContain("}[^sea]");
    });
    it("does not turn unknown or escaped markers into notes", () => {
        expect(renderRuns(`[wo[^missing]rd]{${attrs}}${note}`, ctx).errors.length).toBeGreaterThan(
            0,
        );
        expect(renderRuns(`[word\\[^sea]]{${attrs}}${note}`, ctx).markdown).not.toContain(
            ".hl-script}[^sea]",
        );
    });
});
