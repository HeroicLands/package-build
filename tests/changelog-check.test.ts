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

import { lintChangesetText, lintReleaseText } from "../engine/changelog-lint.mjs";

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
    it("a code-like token outside a code span is a warning, not a failure", () => {
        const text = `${FRONTMATTER}Rename \`getFoo\` to getFooBar() across the tree.\n`;
        const { findings } = lintChangesetText(text);

        expect(findings.length).toBeGreaterThan(0);
        for (const finding of findings) {
            expect(finding.message).toContain("changelog-check/code-like-token");
            expect(finding.severity).toBe("warning");
        }
    });

    it("the same token inside a code span is not reported at all", () => {
        const text = `${FRONTMATTER}Rename \`getFooBar()\` across the tree.\n`;
        const { findings } = lintChangesetText(text);
        expect(findings).toEqual([]);
    });
});

describe("changelog check — the real fixtures", () => {
    const clean = fs.readFileSync(path.join(FIXTURES, "clean.md"), "utf8");
    const dirty = fs.readFileSync(path.join(FIXTURES, "dirty.md"), "utf8");

    it("Song-of-Heroic-Lands-FoundryVTT's rewritten 0.8.6 section passes clean", () => {
        const { findings } = lintReleaseText(clean);
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

describe("changelog check — `changelog.labels`", () => {
    const text = `${FRONTMATTER}**Character data**\n\n- A shortcode is folded to lowercase.\n`;

    it("warns on a label absent from a declared `changelog.labels`", () => {
        const { findings } = lintChangesetText(text, { labels: ["Compendiums", "Characters"] });
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("warning");
        expect(findings[0].message).toContain("changelog-check/unknown-label");
        expect(findings[0].message).toContain('"Character data"');
        expect(findings[0].line).toBe(lineOf(text, "Character data"));
    });

    it("does not warn on a label the declared list does contain", () => {
        const { findings } = lintChangesetText(text, { labels: ["Character data"] });
        expect(findings).toEqual([]);
    });

    it("warns nothing when `changelog.labels` is not declared", () => {
        const { findings } = lintChangesetText(text);
        expect(findings).toEqual([]);
    });

    it("also applies to a `## <version>` release section under --release", () => {
        const release = `## 0.1.0\n\n### Patch Changes\n\n**Character data**\n\n- A shortcode is folded to lowercase.\n`;
        const { findings } = lintReleaseText(release, { labels: ["Characters"] });
        expect(findings.some((f) => f.message.includes("changelog-check/unknown-label"))).toBe(
            true,
        );
    });
});
