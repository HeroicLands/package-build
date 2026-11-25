/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The Markdown-to-Texinfo converter builds a manual from the `texinfo` front
 * matter of the pages it reaches by links, reports what it cannot use, and
 * writes the same manual on every run. A fixture tree holds every structural
 * case and every construct; golden files hold its output.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import {
    columnFractions,
    convertDocs,
    escapeTexinfo,
    formatFinding,
    infoText,
    nodeNameFor,
    sourceEpoch,
} from "../scripts/docs-texinfo/convert.mjs";
import { EPOCH, FILES, PNG, addressed } from "./fixtures/texinfo/tree.mjs";
import {
    buildInfoAndHtml,
    buildPdf,
    hasEpsf,
    skipUnlessPresent,
    texi2anySkip,
    texi2pdfSkip,
} from "./helpers/texinfo-tools";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(HERE, "fixtures", "texinfo", "golden");

type Files = Record<string, string>;

function run(files: Files, options: Record<string, unknown> = {}) {
    const result = convertDocs({
        root: "/nowhere",
        manuals: [{ page: "index.md", out: "manual" }],
        epoch: EPOCH,
        read: (file: string) => {
            if (!(file in files)) throw new Error(`no ${file}`);
            return files[file];
        },
        exists: (file: string) => file in files,
        list: (dir: string) => Object.keys(files).filter((f) => f.startsWith(`${dir}/`)),
        ...options,
    });
    return {
        ...result,
        manual: result.manuals[0],
        lines: result.findings.map(formatFinding),
    };
}

const PACKAGE = JSON.stringify({
    name: "@org/pkg",
    version: "1.2.3",
    files: ["docs", "LICENSE.md"],
    texinfo: { dircategory: "Tests" },
    author: "Ann Author",
});

/** A page with an Address and no `texinfo` front matter. */
const PLAIN = (body: string) =>
    `---\ntype: doc\nshortcode: plain\nname: { full: Plain }\n---\n\n${body}`;

/** A page with `texinfo` front matter. */
function note(name: string, texinfo: string, body: string, extra = ""): string {
    return `---\nname: { full: ${JSON.stringify(name)} }\n${extra}texinfo:\n${texinfo}\n---\n\n${body}\n`;
}

/** A top page that links to every other page, plus the pages. */
function small(pages: Files, top = "# Manual\n\nThe opening.") {
    const links = Object.keys(pages)
        .map((file) => `[${file}](${file})`)
        .join(" ");
    return addressed({
        "package.json": PACKAGE,
        "docs/index.md": note("Manual", "  parent: null", `${top}\n\n${links}`),
        ...Object.fromEntries(Object.entries(pages).map(([file, body]) => [`docs/${file}`, body])),
    });
}

/** Everything one conversion wrote, as one text, keyed by file name. */
function written(result: ReturnType<typeof run>): Record<string, string> {
    const { manual } = result;
    return {
        "fixture.texi": manual.texinfo,
        ...Object.fromEntries(
            manual.chapters.map((chapter: { path: string; texinfo: string }) => [
                chapter.path.replace(/^[^/]+\//, ""),
                chapter.texinfo,
            ]),
        ),
        "report.txt": `${result.lines.join("\n")}\n`,
    };
}

describe("escaping and names", () => {
    it("escapes @, braces, and commas inside an argument", () => {
        expect(escapeTexinfo("a@b {c}")).toBe("a@@b @{c@}");
        expect(escapeTexinfo("x, y")).toBe("x, y");
        expect(escapeTexinfo("x, y", { argument: true })).toBe("x@comma{} y");
    });

    it("writes node names without . , : ( ) @ { }", () => {
        expect(nodeNameFor("Configuration: `a.yaml`, key by key.")).toBe(
            "Configuration - `a yaml` key by key",
        );
        expect(nodeNameFor("packageBuild.stageDir and packageBuild.assets")).toBe(
            "packageBuild stageDir and packageBuild assets",
        );
        expect(nodeNameFor("ns:key (and more)")).toBe("ns key and more");
        expect(nodeNameFor("  a   @{b}  ")).toBe("a b");
        expect(nodeNameFor("...")).toBe("Section");
    });

    it("escapes text and code in a page", () => {
        const { manual, findings } = run(
            small({
                "a.md": note(
                    "A",
                    "  parent: index.md",
                    "# A\n\nMeet @ noon about {braces} and `{@x}`.",
                ),
            }),
        );
        expect(findings.filter((f: any) => f.severity === "error")).toEqual([]);
        expect(manual.chapters[0].texinfo).toContain(
            "Meet @@ noon about @{braces@} and @code{@{@@x@}}.",
        );
    });

    it("leaves option names, placeholders and code to semantic commands", () => {
        const { manual } = run(
            small({
                "a.md": note(
                    "A",
                    "  parent: index.md",
                    "# A\n\nUse `--out`, `-x`, `<dir>` and `plain`.",
                ),
            }),
        );
        expect(manual.chapters[0].texinfo).toContain(
            "Use @option{--out}, @option{-x}, @var{dir} and @code{plain}.",
        );
    });
});

describe("the manual's header and metadata", () => {
    const { manual, lines } = run(small({}));

    it("takes its metadata from package.json and the top page", () => {
        const text = manual.texinfo;
        expect(text.startsWith("\\input texinfo   @c -*-texinfo-*-\n")).toBe(true);
        expect(text).toContain("@setfilename manual.info\n");
        expect(text).toContain(
            "@set VERSION 1.2.3\n@set UPDATED 14 November 2023\n@settitle Manual\n",
        );
        expect(text.indexOf("@set VERSION")).toBeLessThan(text.indexOf("@settitle"));
        expect(text).toContain("@dircategory Tests\n@direntry\n* Manual: (manual).");
        expect(text).toContain("@author Ann Author\n");
        expect(text).toContain("@ifnottex\n@node Top\n@top Manual\n");
        expect(text.trimEnd().endsWith("@bye")).toBe(true);
    });

    it("strips an npm scope from the default output name", () => {
        const result = run(small({}), { manuals: [{ page: "index.md" }] });
        expect(result.manual.out).toBe("pkg");
        expect(result.manual.texinfo).toContain("@setfilename pkg.info\n");
    });

    it("leaves out the directory entry and reports it when package.json names no dircategory", () => {
        const files = small({});
        files["package.json"] = JSON.stringify({ name: "p", version: "1.0.0" });
        const result = run(files);
        expect(result.manual.texinfo).not.toContain("@dircategory");
        expect(result.manual.texinfo).not.toContain("@direntry");
        expect(result.lines).toContain(
            "package.json: warning: package.json has no texinfo.dircategory; the manual has no dircategory and no direntry",
        );
        expect(result.dir).not.toContain("(p)");
    });

    it("stops with an error when package.json lacks a name or version", () => {
        const files = small({});
        files["package.json"] = JSON.stringify({ name: "p" });
        const result = run(files);
        expect(result.manuals).toEqual([]);
        expect(result.lines).toEqual(["package.json: error: package.json has no `version`"]);
    });

    it("dates the manual by SOURCE_DATE_EPOCH, never by the clock", () => {
        expect(sourceEpoch("/nowhere", { SOURCE_DATE_EPOCH: "1700000000" })).toBe(1700000000);
        const result = run(small({}), { epoch: 86400 * 365 });
        expect(result.manual.texinfo).toContain("@set UPDATED 1 January 1971\n");
        expect(lines).toBeDefined();
    });

    it("builds an Info dir file from the directory entries", () => {
        const result = run(small({}));
        expect(result.dir).toMatch(
            /\n\x1f\nFile: dir,\tNode: Top\t[^\n]*\n\n\* Menu:\n\nTests\n\* Manual: \(manual\)\./,
        );
    });
});

describe("structure comes from the texinfo front matter", () => {
    it("requires the top page to declare parent null", () => {
        const files = small({});
        files["docs/index.md"] = note("Manual", "  parent: other", "# Manual");
        const result = run(files);
        expect(result.manuals).toEqual([]);
        expect(result.lines).toEqual([
            "docs/index.md:4:11: error: the top page must declare `parent: null`",
        ]);
    });

    it("requires the top page to take part", () => {
        const files = small({});
        files["docs/index.md"] = "# Manual\n";
        expect(run(files).lines).toEqual([
            "docs/index.md: error: the top page has no texinfo front matter",
        ]);
    });

    it("orders siblings by hints, then by title, and nests children under their parent", () => {
        const { manual } = run(
            small({
                "b.md": note("B", "  parent: index.md\n  after: [c.md]", "# B"),
                "c.md": note("C", "  parent: index.md", "# C"),
                "a.md": note("A", "  parent: index.md\n  before: [c.md]", "# A"),
                "child.md": note("Child", "  parent: c.md", "# Child"),
            }),
        );
        const chapters = [...manual.texinfo.matchAll(/^@include .*\/(.+)\.texi$/gm)].map(
            (m) => m[1],
        );
        expect(chapters).toEqual(["a", "c", "b"]);
        const c = manual.chapters.find((chapter: any) => chapter.path.endsWith("/c.texi"));
        expect(c.texinfo).toContain("@menu\n* Child::\n@end menu\n\n@node Child\n@section Child\n");
    });

    it("excludes and reports a page whose parent, chain or key is unusable", () => {
        const result = run(
            small({
                "orphan.md": note("Orphan", "  parent: nowhere", "# Orphan"),
                "loop-a.md": note("Loop A", "  parent: loop-b.md", "# A"),
                "loop-b.md": note("Loop B", "  parent: loop-a.md", "# B"),
                "none.md": note("None", "  {}", "# None"),
                "top2.md": note("Top Two", "  parent: null", "# T"),
                "plain.md": PLAIN("# Plain\n\n[hidden](hidden.md)\n"),
                "hidden.md": note("Hidden", "  parent: index.md", "# H"),
            }),
        );
        expect(result.lines.filter((line) => /is excluded/.test(line)).sort()).toEqual([
            "docs/loop-a.md:6:11: warning: the page is excluded: its parent chain does not lead to the top page",
            "docs/loop-b.md:6:11: warning: the page is excluded: its parent chain does not lead to the top page",
            "docs/none.md:6:3: warning: the page is excluded: texinfo has no parent",
            'docs/orphan.md:6:11: warning: the page is excluded: parent "nowhere" does not resolve to a page',
            "docs/top2.md:6:11: warning: the page is excluded: it declares `parent: null`, and the manual has one top page",
        ]);
        expect(result.manual.texinfo).not.toMatch(/Orphan|Loop A|Top Two|None/);
        expect(result.lines).toEqual(
            expect.arrayContaining([
                expect.stringMatching(
                    /^docs\/index\.md:\d+:\d+: warning: the crawl stops at docs\/plain\.md, which has no texinfo front matter$/,
                ),
            ]),
        );
    });

    it("never follows the links of a page that does not take part", () => {
        const result = run(
            addressed({
                "package.json": PACKAGE,
                "docs/index.md": note("Manual", "  parent: null", "# Manual\n\n[plain](plain.md)"),
                "docs/plain.md": PLAIN("# Plain\n\n[hidden](hidden.md)\n"),
                "docs/hidden.md": note("Hidden", "  parent: index.md", "# Hidden"),
            }),
        );
        expect(result.manual.chapters).toEqual([]);
        expect(result.lines).toEqual(
            expect.arrayContaining([
                "docs/hidden.md:1:1: warning: the page has texinfo front matter but no chain of links through participating pages reaches it from the top page",
            ]),
        );
    });

    it("ignores a hint that does not resolve, names a non-sibling, or names the page itself", () => {
        const result = run(
            small({
                "a.md": note(
                    "A",
                    "  parent: index.md\n  before: [ghost.md, plain.md, kid.md, a.md]\n  after: nope",
                    "# A",
                ),
                "plain.md": PLAIN("# Plain\n"),
                "kid.md": note("Kid", "  parent: a.md", "# Kid"),
            }),
        );
        expect(result.lines.filter((line) => /hint|texinfo\.after/.test(line))).toEqual([
            'docs/a.md:7:12: warning: the before hint "ghost" is ignored: it does not resolve to a page',
            'docs/a.md:7:19: warning: the before hint "plain" is ignored: it is not part of the manual',
            'docs/a.md:7:26: warning: the before hint "kid" is ignored: it is not a sibling',
            'docs/a.md:7:31: warning: the before hint "a" is ignored: it names the page itself',
            "docs/a.md:8:10: warning: texinfo.after must be a list; the hints are ignored",
        ]);
    });

    it("drops a sibling group's hints when they contradict each other", () => {
        const result = run(
            small({
                "x.md": note("X", "  parent: index.md\n  before: [y.md]", "# X"),
                "y.md": note("Y", "  parent: index.md\n  before: [x.md]", "# Y"),
            }),
        );
        expect(result.lines).toContain(
            "docs/x.md:6:3: warning: the ordering hints among the children of Manual contradict each other; the group is ordered by title",
        );
        const order = [...result.manual.texinfo.matchAll(/^@include .*\/(.+)\.texi$/gm)].map(
            (m) => m[1],
        );
        expect(order).toEqual(["x", "y"]);
    });

    it("gives every page one place however many pages link to it", () => {
        const result = run(
            small({
                "a.md": note("A", "  parent: index.md", "# A\n\n[b](b.md) [index](index.md)"),
                "b.md": note("B", "  parent: index.md", "# B\n\n[a](a.md)"),
            }),
        );
        expect(result.manual.texinfo.match(/^@include /gm)).toHaveLength(2);
        expect(
            result.manual.chapters
                .map((c: any) => c.texinfo)
                .join("")
                .match(/^@node B$/gm),
        ).toHaveLength(1);
    });
});

describe("depth", () => {
    const chain = (depth: number) => {
        const pages: Files = {};
        for (let n = 1; n <= depth; n++)
            pages[`p${n}.md`] = note(
                `P${n}`,
                `  parent: ${n === 1 ? "index.md" : `p${n - 1}.md`}`,
                `# P${n}\n\n## Inner ${n}\n\n[next](p${n + 1}.md)`,
            );
        return pages;
    };

    it("numbers four levels and never skips one", () => {
        const { manual } = run(small(chain(4)));
        const text = manual.chapters[0].texinfo;
        expect(text.match(/^@(?:chapter|section|subsection|subsubsection) /gm)).toEqual([
            "@chapter ",
            "@section ",
            "@subsection ",
            "@subsubsection ",
        ]);
    });

    it("folds a page deeper than level four into its level-four ancestor and reports it", () => {
        const result = run(small(chain(6)));
        const text = result.manual.chapters[0].texinfo;
        expect(text).toContain("@anchor{P5}\n@subsubheading P5\n");
        expect(text).toContain("@anchor{P6}\n@subsubheading P6\n");
        expect(text).not.toContain("@node P5");
        expect(result.lines).toContain(
            "docs/p5.md:1:1: warning: the page is 5 levels deep and folds into P4 as a subsubheading",
        );
        expect(text).toContain("@ref{P5,,next}");
    });

    it("renders a page's inner headings relative to its own level, with anchors only where linked", () => {
        const { manual } = run(
            small({
                "a.md": note(
                    "A",
                    "  parent: index.md",
                    "# A\n\n## One\n\n### Two\n\n#### Three\n\n##### Four\n\n[to two](#two)",
                ),
            }),
        );
        expect(manual.chapters[0].texinfo).toContain(
            "@heading One\n@cindex One\n\n@anchor{Two}\n@subheading Two\n@cindex Two\n\n@subsubheading Three\n@cindex Three\n\n@subsubheading Four\n@cindex Four\n",
        );
    });
});

describe("node names", () => {
    it("qualifies every page of a repeated name by its parent, and reports the new names", () => {
        const result = run(
            small({
                "s.md": note("Server", "  parent: index.md", "# Server\n\n[c](sc.md)"),
                "c.md": note("Client", "  parent: index.md", "# Client\n\n[c](cc.md)"),
                "sc.md": note("Configuration", "  parent: s.md", "# Configuration"),
                "cc.md": note("Configuration", "  parent: c.md", "# Configuration"),
            }),
        );
        const text = result.manual.chapters.map((c: any) => c.texinfo).join("\n");
        expect(text).toContain("@node Configuration - Server\n@section Configuration\n");
        expect(text).toContain("@node Configuration - Client\n@section Configuration\n");
        expect(result.lines).toContain(
            "docs/sc.md:1:1: warning: the node name Configuration collides with another name and becomes Configuration - Server",
        );
    });

    it("keeps a name stable when an unrelated page is added", () => {
        const base = {
            "a.md": note("A", "  parent: index.md", "# A"),
            "x.md": note("Same", "  parent: a.md", "# S"),
            "y.md": note("Same", "  parent: index.md", "# S"),
        };
        const before = run(small(base))
            .manual.chapters.map((c: any) => c.texinfo)
            .join("");
        const after = run(small({ ...base, "z.md": note("Z", "  parent: index.md", "# Z") }))
            .manual.chapters.map((c: any) => c.texinfo)
            .join("");
        for (const name of ["Same - A", "Same - Manual"]) {
            expect(before).toContain(`@node ${name}\n`);
            expect(after).toContain(`@node ${name}\n`);
        }
    });

    it("never reuses Top or an index name", () => {
        const result = run(small({ "a.md": note("Concept Index", "  parent: index.md", "# A") }));
        expect(result.manual.texinfo.match(/^@node Concept Index$/gm)).toHaveLength(1);
        expect(result.lines.some((line) => /Concept Index collides/.test(line))).toBe(true);
    });

    it("falls back to the first heading, then the file name, and reports it", () => {
        const result = run(
            small({
                "h.md": "---\ntexinfo:\n  parent: index.md\n---\n\n# From Heading\n",
                "file-name.md": "---\ntexinfo:\n  parent: index.md\n---\n\nText only.\n",
            }),
        );
        expect(result.manual.texinfo).toContain("* From Heading::");
        expect(result.manual.texinfo).toContain("* file-name::");
        expect(result.lines.filter((line) => /no name\.full/.test(line))).toHaveLength(2);
    });
});

describe("links", () => {
    const pages = {
        "a.md": note(
            "A",
            "  parent: index.md",
            "# A\n\nSee [b](b.md), for more. A [mid link](b.md) reads on, and ([b](b.md)) in brackets. Also [lab: colon](b.md) and [x, y](b.md#sec).\n\n[external](https://example.org/a,b) and [site](/x) and [shipped](../LICENSE.md).",
        ),
        "b.md": note(
            "B",
            "  parent: index.md",
            "# B\n\n## Sec\n\n[up](index.md) [dead](missing.md) [bad](b.md#nope)",
        ),
    };
    const files = small(pages);
    files["LICENSE.md"] = "x";
    const result = run(files);
    const text = result.manual.chapters.map((c: any) => c.texinfo).join("\n");

    it("writes a cross-reference by position in the sentence", () => {
        expect(text).toContain("@xref{B,,b}, for more.");
        expect(text).toContain("A @ref{B,,mid link} reads on, and (@pxref{B,,b}) in brackets.");
    });

    it("writes a label with a colon as text followed by a reference", () => {
        expect(text).toContain("lab: colon (@pxref{B})");
    });

    it("points at the anchor of a linked heading and escapes commas in link text", () => {
        expect(text).toContain("@ref{Sec,,x@comma{} y}");
        expect(text).toContain("@anchor{Sec}\n@heading Sec");
    });

    it("writes external links, site paths and shipped files", () => {
        expect(text).toContain("@uref{https://example.org/a@comma{}b, external}");
        expect(text).toContain("site (@code{/x})");
        expect(text).toContain("shipped (@file{LICENSE.md})");
    });

    it("writes an unresolvable link as plain text and reports it, never a dangling reference", () => {
        expect(text).toContain("up dead bad");
        expect(result.lines).toEqual(
            expect.arrayContaining([
                expect.stringMatching(
                    /missing\.md resolves to docs\/missing\.md, which does not exist/,
                ),
                expect.stringMatching(/link b\.md#nope points at an anchor no heading/),
            ]),
        );
        const declared = new Set(
            [
                ...`${result.manual.texinfo}\n${text}`.matchAll(/^@node (.+)$|^@anchor\{(.+)\}$/gm),
            ].map((m) => m[1] ?? m[2]),
        );
        const targets = [...text.matchAll(/@(?:x|px)?ref\{((?:[^,{}@]|@.)+?)[,}]/g)].map(
            (m) => m[1],
        );
        expect(targets.filter((target) => !declared.has(target))).toEqual([]);
    });
});

describe("Addresses", () => {
    it("names a page by its shortcode, its type and shortcode, or its full Address", () => {
        const { manual, lines } = run(
            small({
                "a.md": note("A", "  parent: index.md", "# A"),
                "b.md": note("B", "  parent: doc-a", "# B"),
                "c.md": note("C", "  parent: pkg-note-doc-b", "# C"),
            }),
        );
        expect(lines.filter((line) => /excluded|hint/.test(line))).toEqual([]);
        expect(manual.chapters[0].texinfo).toContain("@section B\n");
        expect(manual.chapters[0].texinfo).toContain("@subsection C\n");
    });

    it("never names a page by its file path", () => {
        const files = small({ "a.md": note("A", "  parent: index.md", "# A") });
        files["docs/a.md"] = files["docs/a.md"].replace("parent: index", "parent: index.md");
        const { lines } = run(files);
        expect(lines.filter((line) => /excluded/.test(line))).toEqual([
            expect.stringContaining('parent "index.md" does not resolve to a page'),
        ]);
    });

    it("refuses a page that shares an Address with another and says so", () => {
        const files = small({ "a.md": note("A", "  parent: index.md", "# A") });
        files["docs/b.md"] = files["docs/a.md"];
        const { lines } = run(files);
        expect(lines.some((line) => /also names a\.md/.test(line))).toBe(true);
    });
});

describe("the license statement", () => {
    const withLicense = (texinfo: Record<string, unknown>, license?: string) => {
        const files = small({});
        files["package.json"] = JSON.stringify({
            name: "p",
            version: "1.0.0",
            author: "A",
            license,
            texinfo: { dircategory: "T", ...texinfo },
        });
        return run(files).manual.texinfo as string;
    };

    it("names the manual's license and the software's apart", () => {
        const text = withLicense({ license: "CC-BY-SA-4.0" }, "GPL-3.0-or-later AND CC-BY-SA-4.0");
        expect(text).toContain(
            "@quotation\nThe text of this manual is licensed under CC-BY-SA-4.0.\nThe software it documents is licensed under GPL-3.0-or-later.\n@end quotation",
        );
    });

    it("names the manual's license alone when the package has no other", () => {
        const text = withLicense({ license: "CC-BY-SA-4.0" }, "CC-BY-SA-4.0");
        expect(text).toContain(
            "The text of this manual is licensed under CC-BY-SA-4.0.\n@end quotation",
        );
    });

    it("states the package license when the manual declares none", () => {
        expect(withLicense({}, "MIT")).toContain("Licensed under MIT.\n@end quotation");
    });
});

describe("what a code span, a link or plain text is", () => {
    const chapter = (text: string) =>
        run(small({ "a.md": note("A", "  parent: index.md", `# A\n\n${text}`) })).manual.chapters[0]
            .texinfo as string;

    it("maps paths to @file, variables to @env, commands to @command and addresses to @email", () => {
        const text = chapter(
            "`docs/a.md` `config.mjs` `~/dev/x` `$SOURCE_DATE_EPOCH` `PACKAGE_KINDS` `npm run build` `git` `-print` `a.b` `and/or words` [m](mailto:a@b.c) [Name](mailto:a@b.c)",
        );
        expect(text).toContain(
            "@file{docs/a.md} @file{config.mjs} @file{~/dev/x} @env{SOURCE_DATE_EPOCH} @code{PACKAGE_KINDS} @samp{npm run build} @command{git} @code{-print} @code{a.b} @code{and/or words} @email{a@@b.c, m} @email{a@@b.c, Name}",
        );
    });

    it("indexes options and variables in the variable index and commands in the program index", () => {
        const { manual } = run(
            small({
                "a.md": note(
                    "A",
                    "  parent: index.md",
                    "# A\n\n`--out` `$HOME_DIR` `npm run x` `--out` `-rith`",
                ),
            }),
        );
        expect(manual.chapters[0].texinfo).toContain(
            "@cindex A\n@vindex @option{--out}\n@vindex HOME_DIR\n@pindex npm\n",
        );
        expect(manual.texinfo).toContain(
            "@node Variable Index\n@unnumbered Variable Index\n@printindex vr",
        );
        expect(manual.texinfo).toContain(
            "@node Program Index\n@unnumbered Program Index\n@printindex pg",
        );
    });

    it("marks a capitalised name an environment variable only where the content says so", () => {
        const text = chapter(
            "Set the environment variable `FOO_BAR`, or `BAZ_QUX` environment variable. The export `PACKAGE_KINDS` stays code.\n\n| Name | Meaning |\n| --- | --- |\n| `ONE_TWO` | x |",
        );
        expect(text).toContain("@env{FOO_BAR}");
        expect(text).toContain("@env{BAZ_QUX}");
        expect(text).toContain("@code{PACKAGE_KINDS}");
        expect(text).toContain("@code{ONE_TWO}");
        const table = chapter(
            "| Environment variable | Meaning |\n| --- | --- |\n| `ONE_TWO` | x |",
        );
        expect(table).toContain("@env{ONE_TWO}");
    });

    it("keeps an option written in plain text from becoming an en dash", () => {
        expect(chapter("Pass --check or -x, not pre-push or a--b.")).toContain(
            "Pass @option{--check} or @option{-x}, not pre-push or a--b.",
        );
    });

    it("links a page outside the manual by the public URL its front matter declares, and by none otherwise", () => {
        const files = small({
            "a.md": note("A", "  parent: index.md", "# A\n\n[x](plain.md#s) [y](other.md)"),
        });
        files["docs/plain.md"] = PLAIN("# Plain\n\n## S\n").replace(
            "name: { full: Plain }\n",
            "name: { full: Plain }\nurl: https://example.org/pages/plain\n",
        );
        files["docs/other.md"] = PLAIN("# Other\n").replace("shortcode: plain", "shortcode: other");
        files["package.json"] = JSON.stringify({
            name: "p",
            version: "1.0.0",
            homepage: "https://example.org/p#docs",
        });
        const result = run(files);
        expect(result.manual.chapters[0].texinfo).toContain(
            "@url{https://example.org/pages/plain#s, x} y",
        );
        expect(
            result.lines.filter((line) => /which is not part of the manual/.test(line)),
        ).toHaveLength(2);
    });

    it("writes only the text before its first heading into the Top node", () => {
        const { manual } = run(
            small(
                { "a.md": note("A", "  parent: index.md", "# A") },
                "# Manual\n\nThe summary.\n\n## Links\n\nLong list.",
            ),
        );
        expect(manual.texinfo).toContain("The summary.");
        expect(manual.texinfo).not.toContain("Long list.");
    });
});

describe("one report per manual", () => {
    it("keeps each manual's findings to itself", () => {
        const files = small({
            "a.md": note("A", "  parent: index.md", "# A\n\n[gone](gone.md)"),
        });
        files["docs/other.md"] = note("Other", "  parent: null", "# Other\n\n[gone](gone2.md)");
        files["docs/other.md"] = addressed({ "docs/other.md": files["docs/other.md"] })[
            "docs/other.md"
        ];
        const result = run(files, {
            manuals: [
                { page: "index.md", out: "one" },
                { page: "other.md", out: "two" },
            ],
        });
        const own = (index: number) => result.manuals[index].findings.map(formatFinding).join("\n");
        expect(own(0)).toContain("gone.md");
        expect(own(0)).not.toContain("gone2.md");
        expect(own(1)).toContain("gone2.md");
        expect(own(1)).not.toContain("gone.md ");
    });
});

describe("indexes", () => {
    it("indexes each page by name and tag, and a reference page also in the reference index", () => {
        const { manual } = run(
            small({
                "a.md": note(
                    "Alpha",
                    "  parent: index.md",
                    "# Alpha",
                    "tags: [one, two]\nsubType: reference\n",
                ),
                "b.md": note("Beta", "  parent: index.md", "# Beta", "subType: unknown\n"),
            }),
        );
        const a = manual.chapters.find((c: any) => c.path.endsWith("alpha.texi")).texinfo;
        expect(a).toContain(
            "@node Alpha\n@chapter Alpha\n@cindex Alpha\n@cindex one\n@cindex two\n@rfindex Alpha\n",
        );
        const b = manual.chapters.find((c: any) => c.path.endsWith("beta.texi")).texinfo;
        expect(b).toBe("@node Beta\n@chapter Beta\n@cindex Beta\n");
        expect(manual.texinfo).toContain("@defindex rf\n");
        expect(manual.texinfo).toContain(
            "@node Concept Index\n@unnumbered Concept Index\n@printindex cp\n\n@node Reference Index\n@unnumbered Reference Index\n@printindex rf\n",
        );
    });

    it("writes no reference index when no page is a reference", () => {
        const { manual } = run(small({}));
        expect(manual.texinfo).not.toContain("@defindex");
        expect(manual.texinfo).not.toContain("Reference Index");
    });

    it("lists a node's description in its menu entry and nothing when it has none", () => {
        const { manual } = run(
            small({
                "a.md": note(
                    "Alpha",
                    "  parent: index.md",
                    "# Alpha",
                    "description: Does a thing.\n",
                ),
                "b.md": note("Beta", "  parent: index.md", "# Beta"),
            }),
        );
        expect(manual.texinfo).toContain(`${"* Alpha::".padEnd(32)} Does a thing.\n* Beta::\n`);
    });
});

describe("the structural indexes", () => {
    const INDICES = { commands: ["cmds"], configuration: ["conf"], api: ["api"] };
    const PACKAGE_WITH_BIN = JSON.stringify({
        ...JSON.parse(PACKAGE),
        bin: { tool: "./bin/tool.mjs", "tool-lite": "./bin/lite.mjs" },
    });
    const page = (name: string, body: string) => note(name, "  parent: index.md", body);
    const files = () => ({
        ...small({
            "cmds.md": page(
                "Commands",
                [
                    "# Commands",
                    "## Running",
                    "### `tool build <dir>`",
                    "**OPTIONS**",
                    "| Option | Type |\n| --- | --- |\n| `--out <dir>` | string |\n| `-v` | boolean |",
                    "### `tool lint [path]` and `lint score`",
                    "**OPTIONS**",
                    "- `--age` years\n- `--rules` names",
                    "### `tool-lite`",
                    "No options.",
                    "## Other",
                    "| Option | Type |\n| --- | --- |\n| `--stray` | string |",
                ].join("\n\n"),
            ),
            "conf.md": page(
                "Configuration",
                [
                    "# Configuration",
                    "### `site`",
                    "| Key | Type |\n| --- | --- |\n| `site.out` | string |\n| `pdf.books[].id` | string |\n| not code | text |",
                    "| Setting | Value |\n| --- | --- |\n| `ignored` | x |",
                ].join("\n\n"),
            ),
            "api.md": page(
                "API",
                [
                    "# API",
                    "### `engine.ids`",
                    "| Export | Signature |\n| --- | --- |\n| `makeId` | `makeId(a)` |\n| `MAP_TYPES` | const |",
                ].join("\n\n"),
            ),
        }),
        "package.json": PACKAGE_WITH_BIN,
    });
    const text = () => {
        const { manual } = run(files(), {
            manuals: [{ page: "index.md", out: "manual", indices: INDICES }],
        });
        return `${manual.texinfo}\n${manual.chapters.map((c: any) => c.texinfo).join("\n")}`;
    };

    it("indexes each command section by its invocation, placeholders dropped", () => {
        const out = text();
        const commands = [...out.matchAll(/^@cmindex (.+)$/gm)].map((m) => m[1]);
        expect(commands).toEqual(["tool build", "tool lint", "tool lint score", "tool-lite"]);
    });

    it("indexes each option once per command section, under the command", () => {
        const options = [...text().matchAll(/^@opindex (.+)$/gm)].map((m) => m[1]);
        expect(options).toEqual([
            "@option{--out} @subentry tool build",
            "@option{-v} @subentry tool build",
            "@option{--age} @subentry tool lint",
            "@option{--rules} @subentry tool lint",
            "@option{--age} @subentry tool lint score",
            "@option{--rules} @subentry tool lint score",
        ]);
    });

    it("indexes the first column of key and export tables, and a code heading", () => {
        const out = text();
        expect([...out.matchAll(/^@ckindex (.+)$/gm)].map((m) => m[1])).toEqual([
            "site",
            "site.out",
            "pdf.books[].id",
        ]);
        expect([...out.matchAll(/^@apindex (.+)$/gm)].map((m) => m[1])).toEqual([
            "engine.ids",
            "makeId",
            "MAP_TYPES",
        ]);
    });

    it("enters every heading in the concept index", () => {
        const out = text();
        for (const heading of ["Running", "Other"]) expect(out).toContain(`@cindex ${heading}\n`);
        expect(out).toMatch(/^@cindex @code\{tool build .*\}$/m);
    });

    it("defines and prints an index node for each structural index it fills", () => {
        const { manual } = run(files(), {
            manuals: [{ page: "index.md", out: "manual", indices: INDICES }],
        });
        for (const code of ["cm", "op", "ck", "ap"]) {
            expect(manual.texinfo).toContain(`@defindex ${code}\n`);
            expect(manual.texinfo).toContain(`@printindex ${code}\n`);
        }
    });

    it("defines no structural index when no page is configured", () => {
        const { manual } = run(files());
        expect(manual.texinfo).not.toMatch(/@defindex (?:cm|op|ck|ap)\b/);
        expect(manual.texinfo).not.toContain("API Index");
    });

    it("reports a configured page that is not in the manual", () => {
        const result = run(files(), {
            manuals: [
                { page: "index.md", out: "manual", indices: { ...INDICES, api: ["nowhere"] } },
            ],
        });
        expect(result.lines.join("\n")).toMatch(
            /error: the api index page `nowhere` is not a page of the manual/,
        );
    });

    it("writes the same text on every run", () => {
        expect(text()).toBe(text());
    });
});

describe("blocks", () => {
    const body = (text: string) =>
        run(small({ "a.md": note("A", "  parent: index.md", `# A\n\n${text}`) }));
    const chapter = (text: string) => body(text).manual.chapters[0].texinfo as string;

    it("writes fenced code as an example, lisp as lisp and verbatim code unescaped", () => {
        const text = chapter(
            "```sh\na @ {b}\n```\n\n```lisp\n(f {x})\n```\n\n```verbatim\na @ {b}\n```",
        );
        expect(text).toContain("@example\na @@ @{b@}\n@end example");
        expect(text).toContain("@lisp\n(f @{x@})\n@end lisp");
        expect(text).toContain("@verbatim\na @ {b}\n@end verbatim");
    });

    it("writes lists, definition lists, quotations and alerts", () => {
        const text = chapter(
            "- one\n- two\n\n3. three\n4. four\n\nTerm\n: Definition\n\n> quoted\n\n> [!NOTE]\n> Careful.",
        );
        expect(text).toContain("@itemize @bullet\n@item\none\n\n@item\ntwo\n@end itemize");
        expect(text).toContain("@enumerate 3\n");
        expect(text).toContain("@table @asis\n@item Term\nDefinition\n@end table");
        expect(text).toContain("@quotation\nquoted\n@end quotation");
        expect(text).toContain("@quotation Note\nCareful.\n@end quotation");
    });

    it("writes raw HTML for HTML output and drops comments and rules", () => {
        const text = chapter("<div>x</div>\n\n<!-- c -->\n\n---\n\nEnd.");
        expect(text).toContain("@html\n<div>x</div>\n@end html");
        expect(text).not.toContain("<!--");
        expect(text.trimEnd().endsWith("End.")).toBe(true);
    });

    it("writes a footnote inline and a reference link as a link", () => {
        const text = chapter(
            "A note[^1] and [ref][r].\n\n[^1]: Footnote text.\n\n[r]: https://example.org/",
        );
        expect(text).toContain(
            "A note@footnote{Footnote text.} and @uref{https://example.org/, ref}.",
        );
    });

    it("writes an image with its alt text and copies the file", () => {
        const files = small({
            "a.md": note("A", "  parent: index.md", "# A\n\n![Alt, text](p.png)"),
        });
        files["docs/p.png"] = "";
        const result = run(files);
        expect(result.manual.chapters[0].texinfo).toContain(
            "@image{manual-images/docs-p,,,Alt@comma{} text,.png}",
        );
        expect(result.manual.assets).toEqual([
            { from: "docs/p.png", to: "manual-images/docs-p.png" },
        ]);
    });

    it("reports a construct with no mapping at its line", () => {
        const result = body("~~gone~~\n\n::: note\nx\n:::\n\n- [ ] task");
        expect(result.lines).toEqual(
            expect.arrayContaining([
                expect.stringMatching(/^docs\/a\.md:11:\d+: warning: strikethrough/),
                expect.stringMatching(/^docs\/a\.md:13:1: warning: a fenced div/),
                expect.stringMatching(/^docs\/a\.md:17:1: warning: a task list/),
            ]),
        );
    });

    it("writes the printed manual an ASCII stand-in for a character its fonts lack", () => {
        const text = chapter("A ├─ ✅ é.");
        expect(text).toContain("@inlinefmtifelse{tex,+,├}@inlinefmtifelse{tex,-,─}");
        expect(text).toContain("@inlinefmtifelse{tex,U+2705,✅} é.");
    });
});

describe("tables", () => {
    const table = (text: string) =>
        run(small({ "a.md": note("A", "  parent: index.md", `# A\n\n${text}`) }));

    it("writes a table as a multitable with columns at least as wide as their longest word", () => {
        const { manual } = table("| Name | Value |\n| ---- | ----- |\n| a | one two |");
        expect(manual.chapters[0].texinfo).toMatch(
            /@multitable @columnfractions 0\.\d+ 0\.\d+\n@headitem Name @tab Value\n@item a @tab one two\n@end multitable/,
        );
        expect(
            columnFractions([
                ["Name", "Value"],
                ["a", "one two"],
            ]),
        ).toEqual(["0.0833", "0.1250"]);
    });

    it("measures a column by what Info prints", () => {
        expect(infoText("@code{x} @emph{y} @strong{z}")).toBe("‘x’ _y_ *z*");
        expect(infoText("@ref{Node}")).toBe("*note Node::");
    });

    it("restructures a table whose columns cannot fit, and reports it", () => {
        const { manual, lines } = table(
            `| A | B | C |\n| - | - | - |\n| ${"x".repeat(40)} | ${"y".repeat(40)} | z |`,
        );
        expect(manual.chapters[0].texinfo).toContain("@table @asis\n@item xxxx");
        expect(lines).toContain(
            "docs/a.md:11:1: warning: the table is too wide for its columns and is restructured as a list keyed on its first column",
        );
    });
});

describe("the fixture manual", () => {
    const FIXTURE = { manuals: [{ page: "index.md", out: "fixture" }] };
    const first = run(FILES, FIXTURE);
    const outputs = written(first);

    it("matches the golden files", () => {
        const names = Object.keys(outputs).sort();
        if (process.env.UPDATE_GOLDEN) {
            fs.rmSync(GOLDEN, { recursive: true, force: true });
            for (const name of names) {
                fs.mkdirSync(path.dirname(path.join(GOLDEN, name)), { recursive: true });
                fs.writeFileSync(path.join(GOLDEN, name), outputs[name]);
            }
        }
        const expected =
            fs.existsSync(GOLDEN) ?
                fs
                    .readdirSync(GOLDEN, { recursive: true, withFileTypes: true })
                    .filter((entry) => entry.isFile())
                    .map((entry) =>
                        path
                            .relative(GOLDEN, path.join(entry.parentPath, entry.name))
                            .split(path.sep)
                            .join("/"),
                    )
                    .sort()
            :   [];
        expect(names).toEqual(expected);
        for (const name of names)
            expect(outputs[name], name).toBe(fs.readFileSync(path.join(GOLDEN, name), "utf8"));
    });

    it("is byte-identical on every run, whatever order the files are listed in", () => {
        const second = run(FILES, {
            ...FIXTURE,
            list: (dir: string) =>
                Object.keys(FILES)
                    .filter((f) => f.startsWith(`${dir}/`))
                    .reverse(),
        });
        expect(written(second)).toEqual(outputs);
        expect(second.dir).toBe(first.dir);
    });

    it("excludes what the brief says to exclude and reports each case", () => {
        const text = Object.values(outputs).join("\n");
        for (const gone of ["Second Top", "Orphan", "Loop A", "Loop B", "No Parent", "Hidden"])
            expect(text, gone).not.toMatch(new RegExp(`@node ${gone}$`, "m"));
        const report = outputs["report.txt"];
        for (const expectation of [
            /plain\.md, which has no texinfo front matter/,
            /second-top\.md.*excluded: it declares `parent: null`/,
            /orphan\.md.*parent "nowhere" does not resolve/,
            /loop-a\.md.*parent chain does not lead/,
            /no-parent\.md.*texinfo has no parent/,
            /hidden\.md.*no chain of links/,
            /hints\/c\.md.*contradict/,
            /bad-hints\.md.*"hintsc" is ignored: it is not a sibling/,
            /deep6\.md.*folds into Deep Four/,
            /server\/config\.md.*becomes Configuration - Servers/,
            /constructs\.md.*fenced div/,
        ])
            expect(report).toMatch(expectation);
    });

    it("declares every node and anchor it refers to", () => {
        const text = Object.values(outputs).join("\n");
        const declared = new Set(
            [...text.matchAll(/^@node (.+)$|^@anchor\{(.+)\}$/gm)].map((m) => m[1] ?? m[2]),
        );
        const targets = [...text.matchAll(/@(?:x|px)?ref\{((?:[^,{}@]|@.)+?)[,}]/g)].map(
            (m) => m[1],
        );
        expect(targets.length).toBeGreaterThan(5);
        expect(targets.filter((target) => !declared.has(target))).toEqual([]);
    });

    describe("builds with the Texinfo tools and no warning", () => {
        const materialize = (stripImages = false) => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), "texinfo-fixture-"));
            const manual = first.manual;
            const strip = (text: string) =>
                stripImages ? text.replace(/@image\{(?:[^{}]|@comma\{\})*\}/g, "") : text;
            fs.writeFileSync(path.join(dir, "fixture.texi"), manual.texinfo);
            fs.mkdirSync(path.join(dir, "fixture-chapters"));
            for (const chapter of manual.chapters)
                fs.writeFileSync(path.join(dir, chapter.path), strip(chapter.texinfo));
            for (const asset of manual.assets) {
                fs.mkdirSync(path.dirname(path.join(dir, asset.to)), { recursive: true });
                fs.writeFileSync(path.join(dir, asset.to), PNG);
            }
            return dir;
        };

        it("texi2any writes Info and HTML", (context) => {
            skipUnlessPresent(context, texi2anySkip());
            const dir = materialize();
            try {
                expect(buildInfoAndHtml(dir, "fixture.texi")).toEqual([]);
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        });

        it("texi2pdf writes a PDF", (context) => {
            skipUnlessPresent(context, texi2pdfSkip());
            // Images need epsf.tex, which a minimal TeX installation lacks.
            const dir = materialize(!hasEpsf());
            try {
                expect(buildPdf(dir, "fixture.texi")).toEqual([]);
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }, 300_000);
    });
});
