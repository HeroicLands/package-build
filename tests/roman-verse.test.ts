/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { parseVerse } from "../engine/content-verse.mjs";
import { plainRomanVerse } from "../engine/roman-verse.mjs";
import { scanSpans } from "../engine/content-spans.mjs";

describe("Roman verse layout projection", () => {
    it("removes indentation and typed controls while joining source lines", () => {
        const result = plainRomanVerse("...a\nb/..c//d");
        expect(result.text).toBe("a b\nc\nd");
        expect(result.boundaries.map(({ kind }) => kind)).toEqual(["line", "stanza"]);
        expect(result.offsets[0]).toBe(3);
        expect(result.errors).toEqual([]);
    });
    it("retains native name projection and first-span indentation", () => {
        const source = "[...name]{.name}/[word]{.emph}";
        const result = plainRomanVerse(source, { spans: scanSpans(source).spans });
        expect(result.text).toBe("{name}\nword");
        expect(result.spans).toHaveLength(2);
        expect(result.text.slice(result.spans[0].from, result.spans[0].to)).toBe("{name}");
        expect(result.boundaries.map(({ kind }) => kind)).toEqual(["line"]);
    });
    it("records the standard canto marker without encoding it as letters", () => {
        const result = plainRomanVerse("a\n***\nb");
        expect(result.boundaries.map(({ kind }) => kind)).toEqual(["canto"]);
        expect(result.text).not.toContain("***");
    });
    it("interprets typed slashes and leaves escaped and codage slashes literal", () => {
        const result = plainRomanVerse("...a/b \\/ ⟦U+002F⟧");
        expect(result.errors).toEqual([]);
        expect(result.text).toBe("a\nb / ⟦U+002F⟧");
        expect(result.boundaries).toEqual([{ kind: "line", at: 1, sourceOffset: 4 }]);
    });
    it("uses whole-fence layout for a partial inline owner", () => {
        const body = "One [..word]{enc=letters}/..Next";
        const source = "header\n" + body + "\nfooter";
        const modelOffset = source.indexOf(body),
            from = source.indexOf("..word"),
            to = from + "..word".length;
        const result = plainRomanVerse(source, { from, to, model: parseVerse(body), modelOffset });
        expect(result.text).toBe("..word");
        expect(result.boundaries).toEqual([]);
        expect(result.offsets[0]).toBe(from);
        const next = source.indexOf("..Next");
        expect(
            plainRomanVerse(source, {
                from: next,
                to: next + 6,
                model: parseVerse(body),
                modelOffset,
            }).text,
        ).toBe("Next");
    });
    it("preserves absolute offsets with CRLF and body bounds", () => {
        const source = "header\r\n..a/\r\n..b\r\nfooter";
        const result = plainRomanVerse(source, {
            from: source.indexOf("..a"),
            to: source.indexOf("\r\nfooter"),
        });
        expect(result.text).toBe("a\n b");
        expect(result.offsets[0]).toBe(source.indexOf("a/"));
        expect(result.boundaries[0]?.sourceOffset).toBe(source.indexOf("/"));
    });
});
