/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A small documentation tree for the Texinfo converter: every structural case
 * (link cycles, parent cycles, contradictory and misdirected ordering hints, a
 * second top page, pages without `texinfo`, deep nesting, name collisions) and
 * every Markdown construct, keyed by root-relative path.
 */

/** A 1x1 PNG. */
export const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
);

/** The seconds since the epoch the fixture manual is dated by. */
export const EPOCH = 1700000000;

const page = (name, texinfo, body, extra = "") =>
    `---\nname: { full: ${JSON.stringify(name)} }\n${extra}texinfo:\n${texinfo}\n---\n\n${body}\n`;

const SOURCE = {
    "package.json": JSON.stringify(
        {
            name: "@org/fixture",
            version: "1.2.3",
            description: "A fixture package.",
            license: "GPL-3.0-or-later AND CC-BY-SA-4.0",
            author: "Ada Writer <ada@example.org> (https://example.org)",
            contributors: [{ name: "Bo Helper" }],
            homepage: "https://example.org/fixture",
            repository: { type: "git", url: "git+https://example.org/org/fixture.git" },
            bugs: { url: "https://example.org/org/fixture/issues" },
            texinfo: { dircategory: "Fixtures", license: "CC-BY-SA-4.0" },
            files: ["docs", "LICENSE.md"],
        },
        null,
        4,
    ),
    "LICENSE.md": "License.\n",

    "docs/index.md": page(
        "Fixture Manual",
        "  parent: null",
        `# Fixture Manual

The top page links to every case.

See [escaping](escaping.md). Also [constructs](constructs.md), [hints](hints.md),
[deep](deep1.md), [servers](server/index.md), [clients](client/index.md),
[plain](plain.md), [second top](second-top.md), [orphan](orphan.md),
[loop](loop-a.md), [no parent](no-parent.md), [missing](missing.md),
[bad hints](bad-hints.md) and [the license](../LICENSE.md).

## Topics

Back to [self](#topics).
`,
        "description: The manual that exercises the converter.\n",
    ),

    "docs/escaping.md": page(
        "Escaping and Links",
        "  parent: index.md\n  after: [constructs.md]",
        `# Escaping and Links

Write @ signs, {braces}, and \`{@x}\` with care. Use \`--option\`, \`-x\` and
\`<file>\` inside code, never plain --dashes or "quotes".

See [the \`--check\` option, one, two](constructs.md#inline-code), for details.
A mid-sentence link to [the loop, a cycle](loop-a.md) reads on, and
([hints](hints.md)) in parentheses.

A [link with a: colon](hints.md) and an [external page, with a comma](https://example.org/a,b).

**note that** this is strong, **Notes are fine**, *emphasis*, and a <https://example.org/auto>.

Files \`docs/index.md\` and \`LICENSE.md\`, the variable \`$SOURCE_DATE_EPOCH\`, the
environment variable \`XDG_CACHE_HOME\`, the export \`PACKAGE_KINDS\`, the affix \`-rith\`, the program
\`git\`, the command lines \`npm run build\` and \`texi2any --html\`, and the mail address [Ada](mailto:ada@example.org)
or [ada@example.org](mailto:ada@example.org).

Back to the [top](index.md) and the [license file](../LICENSE.md) and
[root path](/docs/x).
`,
        "description: Special characters and links.\ntags: [escaping, links]\nsubType: reference\n",
    ),

    "docs/constructs.md": page(
        "Constructs",
        "  parent: index.md\n  after: [hints.md]",
        `# Constructs

Intro with a footnote[^one] and a [reference link][ref] and ~~struck~~ text.
A line break:\\
second line, with an image ![The alt, text](pic.png) and <b>html</b> inline.

[ref]: escaping.md
[^one]: The footnote, with a comma.

## Inline code

Use \`--check\`, \`<dir>\`, \`name\` and \`a@b\`.

### Deeper heading

#### Deepest heading

Text under the deepest heading, linked from [here](#deepest-heading).

## Blocks

\`\`\`sh
$ tool --flag <file> {braces} @at
\`\`\`

\`\`\`lisp
(defun f (x) {x})
\`\`\`

\`\`\`verbatim
raw @text {kept} as is
\`\`\`

> A quotation
> over two lines.

> [!WARNING]
> Mind the gap.

- one
- two
  - nested

1. first
2. second

3. third

Term
: The definition, with \`code\`.

- [ ] A task

| Name | Value |
| ---- | ----- |
| a    | 1     |
| b    | 2     |

| Name | A very long column heading that cannot be narrow | Another long column heading here | Third long column heading text |
| ---- | ------------------------------------------------ | -------------------------------- | ------------------------------ |
| supercalifragilisticexpialidocious-word | verylongunbreakablewordnumberone-verylongunbreakablewordnumbertwo | x | y |

---

<div>raw html block</div>

<!-- a comment -->

::: warning
A fenced div.
:::

Unicode: box ├── and ✅ and ⟦x⟧ and é.
`,
        "description: Every Markdown construct.\ntags: [constructs]\nsubType: concept\n",
    ),
    "docs/pic.png": "(png)",

    "docs/hints.md": page(
        "Hints",
        "  parent: index.md\n  after: [deep1.md]",
        "# Hints\n\nSiblings and contradictory hints: [c](hints/c.md), [d](hints/d.md), [e](hints/e.md), [f](hints/f.md).",
    ),
    "docs/hints/c.md": page(
        "C Page",
        "  parent: hints.md\n  before: [hints/d.md]",
        "# C Page\n\nC.",
    ),
    "docs/hints/d.md": page(
        "D Page",
        "  parent: hints.md\n  before: [hints/c.md]",
        "# D Page\n\nD.",
    ),
    "docs/hints/e.md": page(
        "E Page",
        "  parent: hints.md\n  after: [hints/f.md]",
        "# E Page\n\nE is placed after F.",
    ),
    "docs/hints/f.md": page("F Page", "  parent: hints.md", "# F Page\n\nF."),

    "docs/bad-hints.md": page(
        "Bad Hints",
        "  parent: index.md\n  before: [ghost.md, plain.md, hints/c.md, bad-hints.md]\n  after: nope",
        "# Bad Hints\n\nHints that point nowhere useful.",
    ),

    "docs/deep1.md": page("Deep One", "  parent: index.md", "# Deep One\n\n[Next](deep2.md)."),
    "docs/deep2.md": page("Deep Two", "  parent: deep1.md", "# Deep Two\n\n[Next](deep3.md)."),
    "docs/deep3.md": page("Deep Three", "  parent: deep2.md", "# Deep Three\n\n[Next](deep4.md)."),
    "docs/deep4.md": page("Deep Four", "  parent: deep3.md", "# Deep Four\n\n[Next](deep5.md)."),
    "docs/deep5.md": page(
        "Deep Five",
        "  parent: deep4.md",
        "# Deep Five\n\nFolded. [Next](deep6.md), and [back to four](deep4.md).\n\n## Folded heading\n\nText.",
    ),
    "docs/deep6.md": page(
        "Deep Six",
        "  parent: deep5.md",
        "# Deep Six\n\nFolded too, see [heading](deep5.md#folded-heading).",
    ),

    "docs/server/index.md": page(
        "Servers",
        "  parent: index.md\n  after: [bad-hints.md]",
        "# Servers\n\n[Configuration](config.md).",
    ),
    "docs/server/config.md": page(
        "Configuration",
        "  parent: server/index.md",
        "# Configuration\n\nServer settings.\n\n## Options\n\nServer options.",
        "description: Server configuration.\n",
    ),
    "docs/client/index.md": page(
        "Clients",
        "  parent: index.md\n  after: [fixture-note-doc-serverindex]",
        "# Clients\n\n[Configuration](config.md) and [options](config.md#options).",
    ),
    "docs/client/config.md": page(
        "Configuration",
        "  parent: client/index.md",
        "# Configuration\n\nClient settings.\n\n## Options\n\nClient options.",
    ),

    "docs/plain.md":
        "---\ntype: doc\nshortcode: plain\nname: { full: Plain }\nurl: https://example.org/pages/plain\n---\n\n# Plain\n\nNo texinfo front matter. [Hidden](hidden.md).\n",
    "docs/hidden.md": page(
        "Hidden",
        "  parent: index.md",
        "# Hidden\n\nOnly reached through a plain page.",
    ),
    "docs/second-top.md": page("Second Top", "  parent: null", "# Second Top\n\nAnother top."),
    "docs/orphan.md": page(
        "Orphan",
        "  parent: nowhere.md",
        "# Orphan\n\nParent does not resolve.",
    ),
    "docs/loop-a.md": page("Loop A", "  parent: loop-b.md", "# Loop A\n\n[B](loop-b.md)."),
    "docs/loop-b.md": page("Loop B", "  parent: loop-a.md", "# Loop B\n\n[A](loop-a.md)."),
    "docs/no-parent.md": page("No Parent", "  {}", "# No Parent\n\nNo parent key."),
};

/** The shortcode of a page: its path without separators or the extension. */
export const shortcodeOf = (file) =>
    file
        .replace(/^docs\//, "")
        .replace(/\.md$/, "")
        .replace(/[^a-z0-9]/gi, "")
        .toLowerCase();

/**
 * Give each page with `texinfo` front matter the `type` and `shortcode` its
 * Address needs, and write the pages `texinfo` names as those Addresses.
 *
 * @param {Record<string, string>} files
 * @returns {Record<string, string>}
 */
export function addressed(files) {
    return Object.fromEntries(
        Object.entries(files).map(([file, text]) => {
            if (
                !file.startsWith("docs/") ||
                !text.startsWith("---\n") ||
                !text.includes("\ntexinfo:")
            )
                return [file, text];
            const block = /\ntexinfo:\n((?:  .*\n)+)/.exec(text)?.[0] ?? "";
            const converted = block.replace(/([\w/-]+)\.md/g, (_, name) => shortcodeOf(name));
            return [
                file,
                `---\ntype: doc\nshortcode: ${shortcodeOf(file)}\n${text.replace(block, converted).slice(4)}`,
            ];
        }),
    );
}

export const FILES = addressed(SOURCE);
