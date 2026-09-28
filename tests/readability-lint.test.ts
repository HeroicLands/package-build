/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    analyzeProse,
    lintProse,
    scoreProse,
    scoreProseTree,
} from "../engine/readability-lint.mjs";
import { resolvePackageBuildConfig } from "../config.mjs";

describe("optional prose analysis", () => {
    it("reports readability confidence and applies the selected threshold", async () => {
        const sentence =
            "The extraordinarily complicated administrative procedure requires comprehensive documentation, extensive verification, and meticulous evaluation before the organization can reach a preliminary determination about the proposed implementation and communicate its conclusions to the relevant stakeholders.";
        const findings = await analyzeProse("note.md", sentence, {
            age: 10,
            threshold: 1,
            minWords: 8,
        });
        expect(findings[0].message).toContain("retext-readability/readability: confidence=6/7");
        expect(findings[0].message).toContain(`sentence=${JSON.stringify(sentence)}`);
        expect(
            (await analyzeProse("note.md", sentence, { age: 10, threshold: 7, minWords: 8 })).some(
                (finding) => finding.message.includes("retext-readability"),
            ),
        ).toBe(false);
    });

    it("locates suggestions in prose and leaves frontmatter and code alone", async () => {
        const source = `---
shortcode: utilization
---

The utilization is very high.

\`\`\`
The utilization is very high.
\`\`\`

[[lore-utilization|Utilization]]
`;
        const findings = await analyzeProse("note.md", source, { rules: "all" });
        expect(findings.map((finding) => [finding.line, finding.column])).toEqual([
            [5, 5],
            [5, 20],
        ]);
        expect(findings[0].message).toContain("retext-simplify/utilization");
        expect(findings[0].message).toContain('sentence="The utilization is very high."');
        expect(findings[0].message).toContain('expected=["use"]');
        expect(findings[0].message).toContain("confidence=unscored");
    });

    it("uses a single file or a tree with configured directory exclusions", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "prose-lint-"));
        try {
            fs.writeFileSync(path.join(root, "one.md"), "The utilization is high.\n");
            fs.mkdirSync(path.join(root, "Templates"));
            fs.writeFileSync(path.join(root, "Templates", "two.md"), "The utilization is high.\n");
            expect((await lintProse(root, { rules: "simplify" }, ["Templates"])).length).toBe(1);
            expect(
                (await lintProse(path.join(root, "Templates", "two.md"), { rules: "simplify" }))
                    .length,
            ).toBe(1);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("validates configured defaults and bounds", () => {
        const shared = (proseLint?: object) => ({
            rootDir: "/repo",
            packageKind: "systems",
            foundryPackage: "sohl",
            packageBuild: proseLint ? { proseLint } : {},
        });
        expect(resolvePackageBuildConfig(shared()).proseLint).toEqual({
            age: 21,
            threshold: 5,
            minWords: 8,
            rules: "readability",
        });
        expect(resolvePackageBuildConfig(shared({ age: 18, threshold: 6 })).proseLint).toEqual({
            age: 18,
            threshold: 6,
            minWords: 8,
            rules: "readability",
        });
        expect(() => resolvePackageBuildConfig(shared({ threshold: 8 }))).toThrow(
            /packageBuild.proseLint.threshold/,
        );
        expect(() => resolvePackageBuildConfig(shared({ rules: "spelling" }))).toThrow(
            /packageBuild.proseLint.rules/,
        );
        const scoreConfig = {
            rootDir: "/repo",
            packageKind: "systems",
            foundryPackage: "sohl",
            packageBuild: {
                proseScore: { minWords: 25, bands: { flesch: { min: 45, max: 80 } } },
            },
        };
        expect(resolvePackageBuildConfig(scoreConfig).proseScore).toEqual({
            minWords: 25,
            bands: { flesch: { min: 45, max: 80 } },
        });
        expect(() =>
            resolvePackageBuildConfig({
                ...scoreConfig,
                packageBuild: { proseScore: { bands: { flesch: { min: 80, max: 45 } } } },
            }),
        ).toThrow(/packageBuild.proseScore.bands.flesch/);
    });

    it("excludes GFM tables, inline code, headings, and lists without shifting positions", async () => {
        const hard =
            "The extraordinarily complicated administrative procedure requires comprehensive documentation, extensive verification, and meticulous evaluation before the organization can reach a preliminary determination about the proposed implementation and communicate its conclusions to the relevant stakeholders.";
        const source = `# ${hard}\n\n| Statement |\n| --- |\n| ${hard} |\n\n- ${hard}\n\n\`${hard}\`\n\n${hard}\n`;
        const findings = await analyzeProse("note.md", source, { age: 10, threshold: 1 });
        expect(
            findings.filter((finding) => finding.message.includes("retext-readability")),
        ).toEqual([expect.objectContaining({ line: 11, column: 1 })]);
    });

    it("scores prose paragraphs and applies both ends of configured bands", async () => {
        const source = `---\nshortcode: sample\n---\n\n# Heading words\n\nThe cat sat on the mat. The dog ran to the gate.\n\n| Very complex table content |\n| --- |\n| Hard words |\n\n- A list with more words.\n`;
        const score = await scoreProse("note.md", source, {
            minWords: 5,
            bands: { flesch: { max: 80 }, longestSentenceWords: { min: 10 } },
        });
        expect(score.words).toBe(12);
        expect(score.bodyWords).toBeGreaterThan(score.words);
        expect(score.metrics.flesch).toBeGreaterThan(80);
        expect(score.violations).toEqual(["flesch above 80", "longestSentenceWords below 10"]);
        expect((await scoreProse("note.md", source, { minWords: 100 })).insufficient).toBe(true);
    });

    it("pools word and sentence counts over a directory and skips short notes", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "prose-score-"));
        try {
            fs.writeFileSync(path.join(root, "one.md"), "The cat sat on the mat.\n");
            fs.writeFileSync(path.join(root, "two.md"), "The dog ran to the gate.\n");
            fs.writeFileSync(path.join(root, "short.md"), "Brief.\n");
            const { summary } = await scoreProseTree(root, { minWords: 5 });
            expect(summary).toMatchObject({ scored: 2, insufficient: 1, words: 12, sentences: 2 });
            expect(summary.flesch).toBeGreaterThan(0);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
