// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it } from "vitest";
import { collectAnchors, markupAnchorFindings } from "../engine/anchors.mjs";
import { renderFoundryMarkdown } from "../engine/helpers.mjs";

it("indexes div, span and poetry anchors without indexing literal code examples", () => {
    const source = [
        "::: {#outer}",
        "[a *word*]{#inner .accent}",
        "::: {#nested}",
        "Nested prose.",
        ":::",
        ":::",
        "",
        "```poetry {#verse}",
        "A verse.",
        "```",
        "",
        "```text",
        "[literal]{#hidden}",
        "::: {#alsohidden}",
        "```",
    ].join("\n");
    expect(collectAnchors(source).map((anchor) => anchor.slug)).toEqual([
        "outer",
        "inner",
        "nested",
        "verse",
    ]);
    const html = renderFoundryMarkdown(source);
    expect(html).toContain('id="outer"');
    expect(html).toContain('<span id="inner" class="accent">a <em>word</em></span>');
    expect(html).toContain('id="verse"');
});

it("rejects markup identifier collisions across constructs", () => {
    expect(markupAnchorFindings("::: {#same}\n[Word]{#same}\n:::")).toMatchObject([
        { line: 2, message: 'duplicate markup anchor "same"' },
    ]);
    expect(markupAnchorFindings(":@ Caption {#same}\n\n::: {#same}\nText.\n:::")).toHaveLength(1);
});
