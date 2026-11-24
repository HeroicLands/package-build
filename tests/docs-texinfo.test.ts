/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The Markdown-to-Texinfo converter maps each construct the documentation uses
 * and reports, at its location, each one it cannot map.
 */

import { describe, it, expect } from "vitest";

import {
    columnFractions,
    convertDocs,
    escapeTexinfo,
    formatFinding,
    infoText,
    nodeNameFor,
} from "../scripts/docs-texinfo/convert.mjs";
import type { ManifestEntry } from "../scripts/docs-texinfo/manifest.mjs";

type Files = Record<string, string>;

/** Convert in-memory pages: keys are paths relative to `docs/`. */
function convert(pages: Files, manifest?: ManifestEntry[], options: Record<string, unknown> = {}) {
    const files: Files = { "assets/preview/gitea.ini": "", "CONTENT.md": "" };
    for (const [file, source] of Object.entries(pages)) files[`docs/${file}`] = source;
    const result = convertDocs({
        root: "/nowhere",
        version: "1.2.3",
        shipped: ["assets", "docs"],
        manifest: manifest ?? ["index.md", ...Object.keys(pages).filter((f) => f !== "index.md")],
        read: (file: string) => {
            if (!(file in files)) throw new Error(`no ${file}`);
            return files[file];
        },
        exists: (file: string) => file in files,
        ...options,
    });
    return { ...result, lines: result.findings.map(formatFinding) };
}

const INDEX = "# Manual\n\nThe opening.\n";

/** The text between a chapter's `@node` line and the next chapter's. */
function chapter(texinfo: string, name: string): string {
    const opening = `@node ${name}\n@chapter`;
    const start = texinfo.indexOf(opening);
    expect(start, `chapter ${name}`).toBeGreaterThanOrEqual(0);
    const next = texinfo.indexOf("\n@chapter", start + opening.length);
    const end = next < 0 ? texinfo.indexOf("@bye") : texinfo.lastIndexOf("@node", next);
    return texinfo.slice(start, end);
}

describe("escaping", () => {
    it("escapes @, braces, and commas inside an argument", () => {
        expect(escapeTexinfo("a@b {c}")).toBe("a@@b @{c@}");
        expect(escapeTexinfo("x, y")).toBe("x, y");
        expect(escapeTexinfo("x, y", { argument: true })).toBe("x@comma{} y");
    });

    it("escapes text and code in a page", () => {
        const { texinfo, findings } = convert({
            "index.md": INDEX,
            "a.md": "# A\n\nMeet @ noon about {braces} and `{@x}`.\n",
        });
        expect(findings).toEqual([]);
        expect(texinfo).toContain("Meet @@ noon about @{braces@} and @code{@{@@x@}}.");
    });

    it("writes node names Info can read, keeping code only in titles", () => {
        expect(nodeNameFor("Configuration: `a.yaml`, key by key.")).toBe(
            "Configuration - `a yaml` key by key",
        );
        expect(nodeNameFor("packageBuild.stageDir and packageBuild.assets")).toBe(
            "packageBuild stageDir and packageBuild assets",
        );
        expect(nodeNameFor("package-build encode [text..]")).toBe("package-build encode [text]");
        expect(nodeNameFor("./engine/art-provenance")).toBe("/engine/art-provenance");
        expect(nodeNameFor("ns:key (and more)")).toBe("ns key (and more)");
        expect(nodeNameFor("(leading) parenthesis")).toBe("leading) parenthesis");
        const { texinfo, findings } = convert({
            "index.md": INDEX,
            "a.md": "# A\n\n## The `@{x}` key, and: more\n\nText.\n",
        });
        expect(findings).toEqual([]);
        expect(texinfo).toContain(
            "@node The @@@{x@} key and - more\n@section The @code{@@@{x@}} key, and: more",
        );
    });
});

describe("chapters and sections", () => {
    it("takes a single first heading at the shallowest level as the chapter title", () => {
        const { texinfo, findings } = convert({
            "index.md": INDEX,
            "a.md": "---\nname: { full: Not this }\n---\n\n# Alpha\n\nIntro.\n\n## Beta\n\nB.\n",
        });
        expect(findings).toEqual([]);
        expect(texinfo).toContain("@node Alpha\n@chapter Alpha\n\nIntro.");
        expect(texinfo).toContain("@node Beta\n@section Beta\n\nB.");
        expect(texinfo).not.toContain("Not this");
    });

    it("takes front matter name.full when the shallowest level has several headings", () => {
        const { texinfo, findings } = convert({
            "index.md": INDEX,
            "a.md": "---\nname: { full: Gamma }\n---\n\nLead.\n\n## One\n\n### Deep\n\n## Two\n",
        });
        expect(findings).toEqual([]);
        expect(texinfo).toContain("@node Gamma\n@chapter Gamma\n\nLead.");
        expect(texinfo).toContain("@node One\n@section One");
        expect(texinfo).toContain("@node Deep\n@subsection Deep");
        expect(texinfo).toContain("@node Two\n@section Two");
    });

    it("reports a page with neither a single first heading nor name.full", () => {
        const { lines } = convert({ "index.md": INDEX, "b.md": "## One\n\n## Two\n" });
        expect(lines).toEqual([
            "docs/b.md: error: the page has no title: no single first heading at the shallowest level, and no front matter name.full",
        ]);
    });

    it("makes headings below a subsection anchored sub-subheadings", () => {
        const { texinfo, findings } = convert({
            "index.md": INDEX,
            "a.md": "# A\n\n## S\n\n### T\n\n#### U\n\n##### V\n\nText.\n",
        });
        expect(findings).toEqual([]);
        expect(texinfo).toContain(
            "@node T\n@subsection T\n\n@anchor{U}\n@subsubheading U\n\n@anchor{V}\n@subsubheading V",
        );
        expect(texinfo).not.toContain("@node U");
    });

    it("writes each node's menu before its first child", () => {
        const { texinfo } = convert({
            "index.md": INDEX,
            "a.md": "# A\n\nIntro.\n\n## S1\n\n### T1\n\n### T2\n\n## S2\n",
        });
        expect(chapter(texinfo, "A")).toContain(
            "Intro.\n\n@menu\n* S1::\n* S2::\n@end menu\n\n@node S1\n@section S1\n\n@menu\n* T1::\n* T2::\n@end menu\n\n@node T1",
        );
        expect(texinfo.match(/\* S1::/g)).toHaveLength(2);
    });

    it("nests a heading that skips a level under the one before it", () => {
        const { texinfo } = convert({ "index.md": INDEX, "a.md": "# A\n\n### Skipped\n" });
        expect(texinfo).toContain("@node Skipped\n@section Skipped");
    });

    it("qualifies a repeated node name by its chapter, then numbers it", () => {
        const { texinfo, findings } = convert({
            "index.md": INDEX,
            "a.md": "# A\n\n## Overview\n\n## Overview\n",
            "b.md": "# B\n\n## Overview\n\n## Overview\n",
        });
        expect(findings).toEqual([]);
        expect(texinfo).toContain("@node Overview\n");
        expect(texinfo).toContain("@node Overview (A)\n");
        expect(texinfo).toContain("@node Overview (B)\n");
        expect(texinfo).toContain("@node Overview (B) 2\n");
    });

    it("drops an attribute block from the heading and resolves its id", () => {
        const { texinfo, findings } = convert({
            "index.md": INDEX,
            "a.md": "# A\n\n## Long title {#short}\n\nSee [it](#short).\n",
        });
        expect(findings).toEqual([]);
        expect(texinfo).toContain("@section Long title\n");
        expect(texinfo).toContain("See @ref{Long title,,it}.");
    });

    it("attaches a page after the section the manifest names", () => {
        const { texinfo, findings } = convert(
            {
                "index.md": INDEX,
                "commands.md":
                    "# Commands\n\n## Group\n\n### `tool one`\n\nOne.\n\n### `tool two`\n\nTwo.\n",
                "commands/one.md": "# One manual\n\nMore.\n\n## Details\n\nD.\n",
            },
            [
                "index.md",
                { file: "commands.md", attach: [{ file: "commands/one.md", after: "tool-one" }] },
            ],
        );
        expect(findings).toEqual([]);
        const text = chapter(texinfo, "Commands");
        expect(text).toContain("* tool one::\n* One manual::\n* tool two::");
        expect(text).toContain(
            "One.\n\n@node One manual\n@subsection One manual\n\nMore.\n\n@anchor{Details}\n@subsubheading Details\n\nD.\n\n@node tool two",
        );
    });
});

describe("blocks", () => {
    it("writes fenced code as an example, a nested fence included", () => {
        const { texinfo, findings } = convert({
            "index.md": INDEX,
            "a.md": "# A\n\n````markdown\n# Title {#t}\n\n```sql\nSELECT '@';\n```\n````\n",
        });
        expect(findings).toEqual([]);
        expect(texinfo).toContain(
            "@example\n# Title @{#t@}\n\n```sql\nSELECT '@@';\n```\n@end example",
        );
    });

    it("writes a keyed table as @table @code", () => {
        const { texinfo, findings } = convert({
            "index.md": INDEX,
            "a.md": "# A\n\n| Key | Meaning |\n| --- | --- |\n| `one` | The first. |\n| `two` | The `second`. |\n\n| Key | Type | Meaning |\n| --- | --- | --- |\n| `three` | string | Third. |\n",
        });
        expect(findings).toEqual([]);
        expect(texinfo).toContain(
            "@table @code\n@item one\nThe first.\n@item two\nThe @code{second}.\n@end table",
        );
        expect(texinfo).toContain(
            "@table @code\n@item three\n@emph{Type}: string\n\n@emph{Meaning}: Third.\n@end table",
        );
    });

    it("writes any other table as @multitable", () => {
        const { texinfo, findings } = convert({
            "index.md": INDEX,
            "a.md": "# A\n\n| Name | Value |\n| --- | --- |\n| `one` | 1 |\n| plain words | `2` |\n",
        });
        expect(findings).toEqual([]);
        expect(texinfo).toMatch(
            /@multitable @columnfractions 0\.\d{4} 0\.\d{4}\n@headitem Name @tab Value\n@item @code\{one\} @tab 1\n@item plain words @tab @code\{2\}\n@end multitable/,
        );
    });

    it("makes every multitable column at least its longest word plus two", () => {
        const word = "Fortification";
        const { texinfo, findings } = convert({
            "index.md": INDEX,
            "a.md": `# A\n\n| ${word} | Notes |\n| --- | --- |\n| yes | ${"long prose ".repeat(20)}|\n`,
        });
        expect(findings).toEqual([]);
        const fractions = /@multitable @columnfractions (.+)/.exec(texinfo)?.[1].split(" ");
        expect(fractions).toHaveLength(2);
        const sizes = (fractions ?? []).map((f) => Math.round(Number(f) * 72));
        expect(sizes[0]).toBeGreaterThanOrEqual(word.length + 2);
        expect(sizes[0] + sizes[1] + 2).toBeLessThanOrEqual(72);
    });

    it("measures a column by what Info prints, a cross-reference unbroken", () => {
        expect(infoText("@code{a@comma{} b} @strong{c} @emph{d}")).toBe("‘a, b’ *c* _d_");
        expect(infoText("@ref{Node name,,the label}")).toBe(
            "*note\u00a0the\u00a0label:\u00a0Node\u00a0name.",
        );
        expect(infoText("@pxref{N}")).toBe("*note\u00a0N::");
        expect(columnFractions([["*note\u00a0x\u00a0y::", "z"]])).toEqual([
            (13 / 72).toFixed(4),
            (3 / 72).toFixed(4),
        ]);
    });

    it("shrinks the line by the indentation a table sits at", () => {
        const rows = [["a".repeat(30), "b".repeat(30)]];
        expect(columnFractions(rows)).toHaveLength(2);
        expect(columnFractions(rows, 10)).toBeUndefined();
    });

    it("writes a table whose columns cannot fit as a @table keyed on its first column", () => {
        const head = Array.from({ length: 8 }, (_, i) => `Heading${i}`);
        const row = ["**First** key", ...head.slice(1).map((h) => `${h.toLowerCase()}value`)];
        const { texinfo, findings } = convert({
            "index.md": INDEX,
            "a.md": `# A\n\n| ${head.join(" | ")} |\n| ${head.map(() => "---").join(" | ")} |\n| ${row.join(" | ")} |\n| | lone |\n`,
        });
        expect(findings).toEqual([]);
        expect(texinfo).not.toContain("@multitable");
        expect(texinfo).toContain(
            "@table @asis\n@item @strong{First} key\n@emph{Heading1}: heading1value\n\n@emph{Heading2}: heading2value",
        );
        expect(texinfo).toContain("@item @w{}\n@emph{Heading1}: lone\n@end table");
    });

    it("writes a table of headers alone that cannot fit as a list of them", () => {
        const head = Array.from({ length: 8 }, (_, i) => `Heading${i}`);
        const { texinfo, findings } = convert({
            "index.md": INDEX,
            "a.md": `# A\n\n| ${head.join(" | ")} |\n| ${head.map(() => "---").join(" | ")} |\n`,
        });
        expect(findings).toEqual([]);
        expect(texinfo).toContain(
            `@itemize @bullet\n${head.map((h) => `@item ${h}`).join("\n")}\n@end itemize`,
        );
    });

    it("writes bullet, ordered, and nested lists, with quotations inside items", () => {
        const { texinfo, findings } = convert({
            "index.md": INDEX,
            "a.md": "# A\n\n- one\n  - inner\n- two\n\n  > quoted\n\n3. third\n4. fourth\n",
        });
        expect(findings).toEqual([]);
        expect(texinfo).toContain(
            "@itemize @bullet\n@item\none\n\n@itemize @bullet\n@item\ninner\n@end itemize\n\n@item\ntwo\n\n@quotation\nquoted\n@end quotation\n@end itemize",
        );
        expect(texinfo).toContain("@enumerate 3\n@item\nthird\n\n@item\nfourth\n@end enumerate");
    });

    it("writes strong, emphasis, and quotations", () => {
        const { texinfo } = convert({
            "index.md": INDEX,
            "a.md": "# A\n\n**Bold** and _soft_.\n\n> A quote.\n",
        });
        expect(texinfo).toContain(
            "@strong{Bold} and @emph{soft}.\n\n@quotation\nA quote.\n@end quotation",
        );
    });

    it('writes strong text that opens with "note" as @b, which Info prints plain', () => {
        const { texinfo } = convert({ "index.md": INDEX, "a.md": "# A\n\nA **note infobox**.\n" });
        expect(texinfo).toContain("A @b{note infobox}.");
        expect(texinfo).not.toContain("@strong{note");
    });

    it("drops HTML comments and thematic breaks", () => {
        const { texinfo, findings } = convert({
            "index.md": INDEX,
            "a.md": "<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->\n\n# A\n\nOne.\n\n---\n\n<!-- marker:start -->\n\nTwo.\n",
        });
        expect(findings).toEqual([]);
        expect(chapter(texinfo, "A")).toBe("@node A\n@chapter A\n\nOne.\n\nTwo.\n\n");
    });
});

describe("links", () => {
    const pages = {
        "index.md": "# Manual\n\n- [Alpha](a.md)\n",
        "a.md": "# Alpha\n\nSee [below](#deep-part), [Beta's part](b.md#part-two), [Beta](b.md), and [`x, y`](b.md#part-two).\n\n## Deep part\n",
        "b.md": "# Beta\n\n## Part two\n\nBack to [the top](index.md) and [Alpha](a.md#alpha).\n",
    };

    it("resolves same-page and cross-page anchors to nodes", () => {
        const { texinfo, findings } = convert(pages);
        expect(findings).toEqual([]);
        expect(texinfo).toContain(
            "See @ref{Deep part,,below}, @ref{Part two,,Beta's part}, @ref{Beta}, and @ref{Part two,,@code{x@comma{} y}}.",
        );
        expect(texinfo).toContain("Back to @ref{Top,,the top} and @ref{Alpha}.");
        expect(texinfo).toContain("@item\n@ref{Alpha}\n@end itemize");
    });

    it("writes a label with a colon as text followed by a reference", () => {
        const { texinfo, findings } = convert({
            "index.md": INDEX,
            "a.md": "# A\n\nSee [type: place](#type-place) and [`pack: none`](#type-place).\n\n## type: place\n",
        });
        expect(findings).toEqual([]);
        expect(texinfo).toContain(
            "See type: place (@pxref{type - place}) and @code{pack: none} (@pxref{type - place}).",
        );
    });

    it("resolves an anchor on a sub-subheading to its @anchor", () => {
        const { texinfo, findings } = convert({
            "index.md": INDEX,
            "a.md": "# A\n\n## S\n\n### T\n\n#### Fine point\n\nSee [it](#fine-point).\n",
        });
        expect(findings).toEqual([]);
        expect(texinfo).toContain("See @ref{Fine point,,it}.");
    });

    it("writes external links, shipped files, and site paths", () => {
        const { texinfo, findings } = convert({
            "index.md": INDEX,
            "a.md": "# A\n\n[Docs, here](https://example.org/a,b) and <https://example.org>.\n\nThe [config](../assets/preview/gitea.ini) and [a page](/site/page/).\n",
        });
        expect(findings).toEqual([]);
        expect(texinfo).toContain(
            "@uref{https://example.org/a@comma{}b, Docs@comma{} here} and @uref{https://example.org}.",
        );
        expect(texinfo).toContain(
            "The config (@file{assets/preview/gitea.ini}) and a page (@code{/site/page/}).",
        );
    });

    it("reports links and anchors nothing resolves", () => {
        const { lines } = convert(
            {
                "index.md": INDEX,
                "a.md": "# A\n\n[x](#nowhere) [y](b.md#nowhere) [z](missing.md)\n[w](../CONTENT.md) [v](stray.md)\n",
                "b.md": "# B\n",
                ...{},
            },
            ["index.md", "a.md", "b.md"],
            {
                exists: (file: string) =>
                    [
                        "docs/index.md",
                        "docs/a.md",
                        "docs/b.md",
                        "docs/stray.md",
                        "CONTENT.md",
                    ].includes(file),
            },
        );
        expect(lines).toEqual([
            "docs/a.md:3:1: error: link #nowhere points at an anchor no heading in docs/a.md declares",
            "docs/a.md:3:15: error: link b.md#nowhere points at an anchor no heading in docs/b.md declares",
            "docs/a.md:3:33: error: link missing.md resolves to docs/missing.md, which does not exist",
            "docs/a.md:4:1: error: link ../CONTENT.md points at CONTENT.md, which the package does not ship",
            "docs/a.md:4:20: error: link stray.md points at docs/stray.md, which the manual's manifest does not include",
        ]);
    });
});

describe("constructs with no mapping", () => {
    it.each([
        ["an image", "![alt](pic.png)", "an image has no Texinfo mapping"],
        [
            "raw HTML",
            "Returns {Set<string>}.",
            'raw HTML "<string>" has no Texinfo mapping; write it as code or text',
        ],
        [
            "block HTML",
            "<div>\nx\n</div>",
            "raw HTML has no Texinfo mapping; write it as Markdown or code",
        ],
        ["strikethrough", "~~gone~~", "strikethrough has no Texinfo mapping"],
        ["a task list", "- [ ] todo", "a task list has no Texinfo mapping"],
        ["a fenced div", "::: {.verse}\nline\n:::", "a fenced div (`:::`) has no Texinfo mapping"],
        ["a definition list", "Term\n: Meaning", "a definition list has no Texinfo mapping"],
        [
            "a GitHub alert",
            "> [!NOTE]\n> Read this.",
            "a GitHub alert ([!NOTE]) has no Texinfo mapping; write a plain quotation",
        ],
        [
            "a pipe table without a header row",
            "| `a` | one |\n| `b` | two |",
            "a pipe table needs a header row followed by a delimiter row; this one reads as a paragraph",
        ],
        [
            "a reference link",
            "[x][ref]\n\n[ref]: https://example.org",
            "reference link [x] has no Texinfo mapping; write an inline link",
        ],
    ])("reports %s at its location", (_name, markdown, message) => {
        const { lines } = convert({ "index.md": INDEX, "a.md": `# A\n\n${markdown}\n` });
        expect(lines[0]).toMatch(/^docs\/a\.md:3:\d+: error: /);
        expect(lines[0]).toContain(message);
    });

    it("leaves code alone, however it looks", () => {
        const { findings } = convert({
            "index.md": INDEX,
            "a.md": "# A\n\n```markdown\n![alt](pic.png) <b>x</b> ~~y~~\n::: div\n:::\n```\n\n`<string>`\n",
        });
        expect(findings).toEqual([]);
    });
});

describe("the manual", () => {
    it("carries its header, copying notice, directory entry, and master menu", () => {
        const { texinfo } = convert({
            "index.md": "---\ndescription: The whole toolchain.\n---\n\n# Manual\n\nThe opening.\n",
            "a.md": "---\ndescription: First things.\n---\n\n# A\n\n## S\n",
        });
        expect(texinfo.startsWith("\\input texinfo\n")).toBe(true);
        for (const line of [
            "@setfilename package-build.info",
            "@settitle Package Build",
            "@set VERSION 1.2.3",
            "@dircategory HeroicLands",
            "* Package Build: (package-build). The whole toolchain.",
            'Copyright @copyright{} 2024-2026 Tom Rodriguez ("Toasty").',
            "Attribution-ShareAlike 4.0 International License (CC-BY-SA-4.0)",
            "@uref{https://creativecommons.org/licenses/by-sa/4.0/}",
            "@node Top\n@top Manual\n\n@insertcopying\n\nThe opening.",
            `${"* A::".padEnd(32)} First things.`,
            "@detailmenu\n --- The Detailed Node Listing ---\n\nA\n\n* S::\n@end detailmenu",
        ]) {
            expect(texinfo).toContain(line);
        }
        expect(texinfo.trimEnd().endsWith("@bye")).toBe(true);
    });

    it("is the same on every run", () => {
        const pages = { "index.md": INDEX, "a.md": "# A\n\nText.\n" };
        expect(convert(pages).texinfo).toBe(convert(pages).texinfo);
    });

    it("places an indexer's entries and appends its nodes", () => {
        const events: unknown[] = [];
        const { texinfo } = convert(
            {
                "index.md": INDEX,
                "a.md": "# A\n\n| Key | Meaning |\n| --- | --- |\n| `k` | K. |\n",
            },
            undefined,
            {
                indexer: {
                    entries: (event: { kind: string; text: string }) => {
                        events.push(event);
                        return [`@cindex ${event.text}`];
                    },
                    nodes: () => [
                        {
                            name: "Index",
                            description: "Every entry.",
                            texinfo: "@unnumbered Index\n\n@printindex cp",
                        },
                    ],
                },
            },
        );
        expect(texinfo).toContain("@chapter A\n@cindex A");
        expect(texinfo).toContain("@item k\n@cindex k\nK.");
        expect(texinfo).toContain(`${"* Index::".padEnd(32)} Every entry.`);
        expect(texinfo).toContain("@node Index\n@unnumbered Index\n\n@printindex cp\n\n@bye");
        expect(events).toContainEqual({
            kind: "item",
            file: "docs/a.md",
            node: "A",
            text: "k",
            header: "Key",
        });
    });
});
