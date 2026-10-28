/* SPDX-License-Identifier: GPL-3.0-or-later */
import { expect, it } from "vitest";
import { scanSpans } from "../engine/content-spans.mjs";

it.each(["lang=vyl", ".verse lang=vyl"])("recognizes !-initial attributed text (%s)", (attrs) => {
    const result = scanSpans(`[! a]{${attrs}}`);
    expect(result.errors).toEqual([]);
    expect(result.spans).toMatchObject([{ text: "! a", start: 0, contentEnd: 4 }]);
    if (attrs.includes(".verse")) expect(result.spans[0].verseModel).toBeDefined();
});
it.each([
    "[!NOTE]",
    "`[! a]{lang=vyl}`",
    "```\n[! a]{lang=vyl}\n```",
    "\\[! a]{lang=vyl}",
    "![! a](image.png){lang=vyl}",
    "[[doc-place|! a]]{lang=vyl}",
    "[^note]{lang=vyl}\n\n[^note]: Note.",
])("does not reinterpret literal, code, image, link or footnote syntax: %s", (source) => {
    expect(scanSpans(source).spans).toEqual([]);
});
