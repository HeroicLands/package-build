/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { plainRomanVerse } from "../engine/roman-verse.mjs";
import { scanSpans } from "../engine/content-spans.mjs";

describe("Roman verse layout projection", () => {
    it("removes indentation while retaining a boundary for every content line", () => {
        const result = plainRomanVerse("...a\nb\n\n..d");
        expect(result.text).toBe("a\nb\n\nd");
        expect(result.boundaries.map(({ kind }) => kind)).toEqual([
            "line",
            "line",
            "stanza",
            "line",
        ]);
        expect(result.boundaries.filter(({ kind }) => kind === "line").map(({ at }) => at)).toEqual(
            [1, 3, 6],
        );
        expect(result.offsets[0]).toBe(3);
        expect(result.offsets.at(-1)).toBe(10);
        expect(result.errors).toEqual([]);
    });
    it("retains native name projection and finds indentation inside the first span", () => {
        const source = "[...name]{.name}\n[word]{.emph}";
        const result = plainRomanVerse(source, { spans: scanSpans(source).spans });
        expect(result.text).toBe("{name}\nword");
        expect(result.spans).toHaveLength(2);
        expect(result.boundaries.map(({ kind }) => kind)).toEqual(["line", "line"]);
    });
    it("records a canto boundary without encoding the marker as letters", () => {
        const result = plainRomanVerse("a\n\n--- {.canto}\n\nb");
        expect(result.boundaries.map(({ kind }) => kind)).toEqual(["line", "canto", "line"]);
        expect(result.text).not.toContain("canto");
    });
    it("refuses a typed slash but leaves a codage slash to its encoding", () => {
        const source = "...a/b ⟦U+002F⟧";
        const result = plainRomanVerse(source);
        expect(result.errors).toEqual([
            { offset: source.indexOf("/"), message: expect.stringContaining("verse") },
        ]);
    });
    it("preserves absolute offsets with CRLF and body bounds", () => {
        const source = "header\r\n..a\r\n..b\r\nfooter";
        const result = plainRomanVerse(source, {
            from: source.indexOf("..a"),
            to: source.indexOf("\r\nfooter"),
        });
        expect(result.text).toBe("a\r\nb");
        expect(result.offsets[0]).toBe(source.indexOf("a\r"));
        expect(result.boundaries.at(-1)?.sourceOffset).toBe(source.indexOf("\r\nfooter"));
    });
});
