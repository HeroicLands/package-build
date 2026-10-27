/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { plainRomanRun } from "../engine/roman-run.mjs";
import { scanSpans } from "../engine/content-spans.mjs";
import { romanTextProblems } from "../engine/roman-characters.mjs";
const inventory = {
    language: "vyl",
    characters: new Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"),
};
const project = (source: string) =>
    plainRomanRun(source, {
        spans: scanSpans(source).spans,
        includeSpan: (span) => !span.attrs?.some(([key]) => ["lang", "font", "enc"].includes(key)),
    });
describe("a full logical Roman run", () => {
    it("keeps quotation state across presentation-only children", () => {
        const source = "a «b [word]{.emph} c»";
        const result = project(source);
        expect(result.text).toBe("a «b word c»");
        expect(romanTextProblems(result.text, inventory)).toEqual([]);
        expect(result.spans[0]).toMatchObject({ from: 5, to: 9, contentFrom: 5, contentTo: 9 });
    });
    it("preserves nested presentation and wraps name text in standard braces", () => {
        const source = "a [the [Name]{.name}]{.emph}";
        const result = project(source);
        expect(result.text).toBe("a the {Name}");
        expect(result.spans).toHaveLength(2);
        expect(result.offsets[result.text.indexOf("{")]).toBe(source.indexOf("[Name"));
        expect(result.offsets[result.text.indexOf("}")]).toBe(source.indexOf("]{"));
    });
    it("does not mistake an interruption before a child for a run ending", () => {
        const source = "a—[word]{.emph}";
        const result = project(source);
        const [problem] = romanTextProblems(result.text, inventory);
        expect(problem.message).toContain("terminal");
        expect(result.offsets[problem.offset]).toBe(source.indexOf("—"));
    });
    it("leaves independent children opaque while retaining outer quotation state", () => {
        const source = "«a [чужой]{lang=ru} b»";
        const result = project(source);
        expect(result.text).toBe("«a {} b»");
        expect(romanTextProblems(result.text, inventory)).toEqual([]);
        expect(result.spans[0].included).toBe(false);
    });
    it("retains exact escaped and supplementary source positions", () => {
        const source = "x 😀 \\; [a\\,]{.emph}";
        const result = project(source);
        expect(result.text).toBe("x 😀 ; a,");
        expect(result.offsets[result.text.indexOf(";")]).toBe(source.indexOf(";"));
        const point = result.text.indexOf("😀");
        expect(result.offsets.slice(point, point + 2)).toEqual([
            source.indexOf("😀"),
            source.indexOf("😀"),
        ]);
    });
    it("leaves codage notation intact and removes only caller-designated layout", () => {
        const source = "...a ⟦CODE\\NAME U+003B⟧\\\nb";
        const result = plainRomanRun(source, { exclude: [[0, 3]] });
        expect(result.text).toBe("a ⟦CODE\\NAME U+003B⟧\nb");
        expect(result.offsets.at(-1)).toBe(source.length - 1);
    });
    it.each(["\n", "\r\n", "\r"])(
        "removes a hard-line-break slash before %j with exact following offsets",
        (ending) => {
            const source = "a\\" + ending + "b";
            const result = plainRomanRun(source);
            expect(result.text).toBe("a" + ending + "b");
            expect(result.offsets.at(-1)).toBe(source.length - 1);
            expect(result.offsets[1]).toBe(2);
        },
    );
    it("projects bounded source ranges with absolute offsets", () => {
        const source = "prefix [a [b]{.emph} c]{lang=vyl} suffix";
        const spans = scanSpans(source).spans;
        const result = plainRomanRun(source, {
            from: spans[0].start + 1,
            to: spans[0].contentEnd,
            spans,
        });
        expect(result.text).toBe("a b c");
        expect(result.offsets[2]).toBe(source.indexOf("b]{"));
    });
});
