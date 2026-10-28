/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { footnoteLabels, footnoteReferences } from "../engine/content-footnotes.mjs";
describe("defined footnote source references", () => {
    it("uses same-note definitions and preserves original reference ranges", () => {
        const source = "Word[^one], unknown[^missing].\n\n[^one]: The note.";
        expect([...footnoteLabels(source)]).toEqual(["one"]);
        expect(footnoteReferences(source)).toEqual([
            { from: 4, to: 10, key: "one", text: "[^one]" },
        ]);
    });
    it("keeps code, escapes, link destinations and attributes literal", () => {
        const source =
            '`[^one]` \\[^one] [word](https://example.org/[^one]) [word]{title="[^one]"} <!-- > [^one] --> word[^one]: next';
        const refs = footnoteReferences(source, { inline: true, definitions: new Set(["one"]) });
        expect(refs.map((ref) => ref.from)).toEqual([source.lastIndexOf("[^one]")]);
    });
    it("treats block-looking verse lines as inline content in their supplied context", () => {
        const source = "    Word[^one]/\n# Title[^one]";
        expect(
            footnoteReferences(source, { inline: true, definitions: new Set(["one"]) }),
        ).toHaveLength(2);
        expect(footnoteReferences("```\n[^one]\n```\n\n[^one]: note")).toEqual([]);
    });
});
