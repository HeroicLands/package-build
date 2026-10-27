/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { lintChangesetText, lintReleaseText, topLevelBlocks } from "../engine/changelog-lint.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURES = path.join(ROOT, "tests", "fixtures", "changelog");

/** A pending changeset's frontmatter fence, the same shape `npx changeset` writes. */
const FRONTMATTER = '---\n"@heroiclands/package-build": patch\n---\n\n';

/**
 * The 1-based line a substring first appears on, in the same file the
 * fixture text describes — independent of how the checker itself counts
 * lines, so a test failure means the *reported* line is wrong rather than
 * confirming whatever the implementation already believes.
 *
 * @param text - The fixture's full text.
 * @param needle - A substring unique to the line being asked about.
 * @returns The 1-based line number.
 */
function lineOf(text: string, needle: string): number {
    const lines = text.split("\n");
    const at = lines.findIndex((line) => line.includes(needle));
    if (at === -1) throw new Error(`fixture does not contain "${needle}"`);
    return at + 1;
}

interface ClassCase {
    name: string;
    ruleId: string;
    text: string;
    /** A substring unique to the offending line, when the class has one. */
    needle?: string;
    severity?: "error" | "warning";
}

const LONG_BULLET_TEXT = `- ${Array.from({ length: 41 }, (_, i) => `word${i}`).join(" ")}.\n`;

const TOO_MANY_BULLETS_TEXT = `${Array.from({ length: 16 }, (_, i) => `- entry${i}: a change.`).join("\n")}\n`;

const TOO_MANY_LINES_TEXT = `${Array.from({ length: 61 }, (_, i) => `Filler line number ${i} of the section.`).join("\n")}\n`;

const CASES: ClassCase[] = [
    {
        name: "a commit-hash prefix opening a bullet",
        ruleId: "commit-hash",
        text: `${FRONTMATTER}- 1234567: a fix with a hash prefix.\n`,
        needle: "1234567",
    },
    {
        name: "an issue reference",
        ruleId: "issue-reference",
        text: `${FRONTMATTER}Fixes the bug described in #123.\n`,
        needle: "#123",
    },
    {
        name: "a fenced code block",
        ruleId: "code-fence",
        text: `${FRONTMATTER}Some text.\n\n\`\`\`text\nexample\n\`\`\`\n`,
        needle: "```text",
    },
    {
        name: "a Verification/Bump paragraph",
        ruleId: "verification-paragraph",
        text: `${FRONTMATTER}A fix.\n\n**Verified.** Ran the whole suite by hand.\n`,
        needle: "Verified",
    },
    {
        name: "a scoreboard phrase",
        ruleId: "scoreboard-phrase",
        text: `${FRONTMATTER}The output is byte-identical across both runs.\n`,
        needle: "byte-identical",
    },
    {
        name: "a bullet longer than 40 words",
        ruleId: "long-bullet",
        text: `${FRONTMATTER}${LONG_BULLET_TEXT}`,
        needle: "word0",
    },
    {
        name: "a nested bullet list",
        ruleId: "nested-list",
        text: `${FRONTMATTER}- A top-level bullet with detail below.\n  - Nested detail one.\n  - Nested detail two.\n`,
        needle: "Nested detail one",
    },
    {
        name: "a `#` heading inside the body",
        ruleId: "heading",
        text: `${FRONTMATTER}## Not allowed here\n`,
        needle: "Not allowed here",
    },
    {
        name: "more than 15 top-level bullets",
        ruleId: "too-many-bullets",
        text: `${FRONTMATTER}${TOO_MANY_BULLETS_TEXT}`,
        needle: "entry15",
    },
    {
        name: "more than 60 lines in one section",
        ruleId: "too-many-lines",
        text: `${FRONTMATTER}${TOO_MANY_LINES_TEXT}`,
        needle: "Filler line number 59",
    },
];

describe("changelog check — one fixture per finding class", () => {
    for (const { name, ruleId, text, needle } of CASES) {
        it(`fails on ${name}, naming its class and line`, () => {
            const { findings } = lintChangesetText(text);
            const hit = findings.find((f) => f.message.includes(`changelog-check/${ruleId}`));

            expect(hit, `expected a changelog-check/${ruleId} finding`).toBeDefined();
            expect(hit!.severity).toBe("error");
            expect(hit!.line).toBeTypeOf("number");
            if (needle) expect(hit!.line).toBe(lineOf(text, needle));
        });
    }
});

describe("changelog check — the warning-only case", () => {
    it("keeps accented proper nouns whole when looking for code-like words", () => {
        const text = `${FRONTMATTER}**Miscellaneous**\n\n- HârnMaster and ÉlanMaster use familiar names.\n`;
        const { findings } = lintChangesetText(text);
        expect(findings.filter((finding) => finding.message.includes("code-like-token"))).toEqual(
            [],
        );
    });

    it("a code-like token outside a code span is a warning, not a failure", () => {
        const text = `${FRONTMATTER}**Miscellaneous**\n\n- Rename \`getFoo\` to getFooBar() across the tree.\n`;
        const { findings } = lintChangesetText(text);

        expect(findings.length).toBeGreaterThan(0);
        for (const finding of findings) {
            expect(finding.message).toContain("changelog-check/code-like-token");
            expect(finding.severity).toBe("warning");
        }
    });

    it("the same token inside a code span is not reported at all", () => {
        const text = `${FRONTMATTER}**Miscellaneous**\n\n- Rename \`getFooBar()\` across the tree.\n`;
        const { findings } = lintChangesetText(text);
        expect(findings).toEqual([]);
    });
});

describe("changelog check — the real fixtures", () => {
    const clean = fs.readFileSync(path.join(FIXTURES, "clean.md"), "utf8");
    const dirty = fs.readFileSync(path.join(FIXTURES, "dirty.md"), "utf8");

    it("a release section in the final shape passes clean", () => {
        const { findings } = lintReleaseText(clean, {
            labels: ["Compendiums and content", "Characters and sheets", "Website"],
        });
        expect(findings).toEqual([]);
    });

    it("HârnMaster 3's former 1.6.4 section produces every class the real prose exercises", () => {
        const { findings } = lintReleaseText(dirty);
        const classes = new Set(
            findings
                .map((f) => /changelog-check\/([a-z-]+)/.exec(f.message)?.[1])
                .filter((c): c is string => Boolean(c)),
        );

        // Every class the unaltered HM3 1.6.4 section exercises. `heading` is
        // not among them — the real prose never carries an authored `#`
        // heading — and is proven separately, in the per-class fixture above.
        for (const ruleId of [
            "commit-hash",
            "issue-reference",
            "code-fence",
            "verification-paragraph",
            "scoreboard-phrase",
            "long-bullet",
            "nested-list",
            "too-many-bullets",
            "too-many-lines",
            "code-like-token",
        ]) {
            expect(classes, `expected changelog-check/${ruleId}`).toContain(ruleId);
        }

        expect(findings.some((f) => f.severity === "error")).toBe(true);
    });
});

const TWO_BLOCKS =
    "**Verse**\n\n- A stanza break renders as a blank line.\n\n" +
    "**Rendering**\n\n- Every page carries its section in the contents list.\n";

const SHAPE_LABELS = ["Verse", "Rendering"];

function errorsOf(text: string, ruleId: string, labels: string[] | null = SHAPE_LABELS) {
    return lintChangesetText(text, { labels }).findings.filter(
        (f) => f.severity === "error" && f.message.includes(`changelog-check/${ruleId}`),
    );
}

describe("changelog check — the shape", () => {
    it("accepts a valid two-block changeset", () => {
        expect(lintChangesetText(`${FRONTMATTER}${TWO_BLOCKS}`, { labels: SHAPE_LABELS })).toEqual({
            findings: [],
        });
    });

    it("accepts an empty changeset body", () => {
        expect(lintChangesetText("---\n---\n", { labels: SHAPE_LABELS })).toEqual({
            findings: [],
        });
    });

    it("refuses a single paragraph as a lead paragraph", () => {
        const text = `${FRONTMATTER}Every page now carries its section in the contents list.\n`;
        const hits = errorsOf(text, "lead-paragraph");
        expect(hits).toHaveLength(1);
        expect(hits[0].line).toBe(lineOf(text, "Every page"));
    });

    it("refuses bullets that open no labelled block", () => {
        const text = `${FRONTMATTER}- A bullet with no label above it.\n`;
        const hits = errorsOf(text, "unlabelled");
        expect(hits).toHaveLength(1);
        expect(hits[0].line).toBe(lineOf(text, "A bullet"));
    });

    it("refuses a `#` heading", () => {
        const text = `${FRONTMATTER}## Verse\n\n- A stanza break renders as a blank line.\n`;
        const hits = errorsOf(text, "heading");
        expect(hits).toHaveLength(1);
        expect(hits[0].line).toBe(lineOf(text, "## Verse"));
    });

    it("refuses prose between blocks", () => {
        const text = `${FRONTMATTER}**Verse**\n\n- A stanza break renders as a blank line.\n\nSome closing remark.\n`;
        const hits = errorsOf(text, "stray-prose");
        expect(hits).toHaveLength(1);
        expect(hits[0].line).toBe(lineOf(text, "closing remark"));
    });

    it("refuses a label that carries text on its own line", () => {
        const text = `${FRONTMATTER}**Verse** A stanza break renders.\n\n- A bullet.\n`;
        expect(errorsOf(text, "label-line")).toHaveLength(1);
    });

    it("refuses a label with no bullets", () => {
        const text = `${FRONTMATTER}**Verse**\n\n**Rendering**\n\n- A bullet.\n`;
        const hits = errorsOf(text, "empty-block");
        expect(hits).toHaveLength(1);
        expect(hits[0].line).toBe(lineOf(text, "**Verse**"));
    });

    it("refuses a nested list under a bullet", () => {
        const text = `${FRONTMATTER}**Verse**\n\n- A bullet.\n  - Nested.\n`;
        expect(errorsOf(text, "nested-list")).toHaveLength(1);
    });

    it("refuses a label outside the declared list, naming the declared labels", () => {
        const text = `${FRONTMATTER}**Character data**\n\n- A shortcode is folded to lowercase.\n`;
        const hits = errorsOf(text, "unknown-label");
        expect(hits).toHaveLength(1);
        expect(hits[0].line).toBe(lineOf(text, "Character data"));
        expect(hits[0].message).toContain('"Character data"');
        expect(hits[0].message).toContain("Verse, Rendering");
        expect(hits[0].message).toContain("Miscellaneous");
    });

    it("accepts a declared label", () => {
        const text = `${FRONTMATTER}**Character data**\n\n- A shortcode is folded to lowercase.\n`;
        expect(lintChangesetText(text, { labels: ["Character data"] }).findings).toEqual([]);
    });

    it("accepts Miscellaneous without declaring it", () => {
        const text = `${FRONTMATTER}**Miscellaneous**\n\n- An empty search no longer fails.\n`;
        expect(lintChangesetText(text, { labels: SHAPE_LABELS }).findings).toEqual([]);
        expect(lintChangesetText(text, { labels: null }).findings).toEqual([]);
        expect(lintChangesetText(text).findings).toEqual([]);
    });

    it("with no `changelog.labels`, refuses any other label and names the key to declare", () => {
        const text = `${FRONTMATTER}**Verse**\n\n- A bullet.\n`;
        for (const options of [{ labels: null }, {}]) {
            const hits = lintChangesetText(text, options).findings.filter((f) =>
                f.message.includes("changelog-check/unknown-label"),
            );
            expect(hits).toHaveLength(1);
            expect(hits[0].severity).toBe("error");
            expect(hits[0].message).toContain(".changeset/config.json");
        }
    });

    it("holds a release section to the same shape", () => {
        const release = `## 0.1.0\n\n${TWO_BLOCKS}`;
        expect(lintReleaseText(release, { labels: SHAPE_LABELS }).findings).toEqual([]);

        const bad = "## 0.1.0\n\nA lead paragraph.\n\n**Character data**\n\n- A bullet.\n";
        const { findings } = lintReleaseText(bad, { labels: SHAPE_LABELS });
        const classes = findings.map((f) => /changelog-check\/([a-z-]+)/.exec(f.message)?.[1]);
        expect(classes).toContain("lead-paragraph");
        expect(classes).toContain("unknown-label");
    });

    it("refuses a `### … Changes` heading left in a release", () => {
        const release = `## 0.1.0\n\n### Patch Changes\n\n${TWO_BLOCKS}`;
        const { findings } = lintReleaseText(release, { labels: SHAPE_LABELS });
        const hit = findings.find((f) => f.message.includes("changelog-check/changes-heading"));
        expect(hit?.severity).toBe("error");
        expect(hit?.line).toBe(3);
    });
});

describe("topLevelBlocks — a hard-wrapped paragraph stays one block", () => {
    const noCode = new Set<number>();

    it("a three-line unlabelled paragraph, wrapped at column 0, is one lead block", () => {
        const text = "First line of the paragraph\nsecond line of the paragraph\nthird line.";
        const blocks = topLevelBlocks(text, noCode);

        expect(blocks).toHaveLength(1);
        expect(blocks[0].label).toBeNull();
        expect(blocks[0].startLine).toBe(1);
        expect(blocks[0].text).toBe(text);
    });

    it("a label line followed by three wrapped lines is one labelled block", () => {
        const text =
            "**A bold label.** This is the first line of its paragraph\n" +
            "continuing on a second line\n" +
            "and wrapping onto a third.";
        const blocks = topLevelBlocks(text, noCode);

        expect(blocks).toHaveLength(1);
        expect(blocks[0].label).toBe("A bold label.");
        expect(blocks[0].text).toBe(text);
    });

    it("a label, a blank line, then a wrapped paragraph is a label block followed by one lead block", () => {
        const text =
            "**A bold label.** Its own first line.\n" +
            "\n" +
            "An unrelated lead paragraph, wrapped at column 0,\n" +
            "continuing here.";
        const blocks = topLevelBlocks(text, noCode);

        expect(blocks).toHaveLength(2);
        expect(blocks[0].label).toBe("A bold label.");
        expect(blocks[0].text).toBe("**A bold label.** Its own first line.\n");
        expect(blocks[1].label).toBeNull();
        expect(blocks[1].text).toBe(
            "An unrelated lead paragraph, wrapped at column 0,\ncontinuing here.",
        );
    });
});
