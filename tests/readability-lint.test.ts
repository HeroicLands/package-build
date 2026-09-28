/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeProse, lintProse } from "../engine/readability-lint.mjs";
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
        const findings = await analyzeProse("note.md", source);
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
            expect((await lintProse(root, {}, ["Templates"])).length).toBe(1);
            expect((await lintProse(path.join(root, "Templates", "two.md"), {})).length).toBe(1);
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
        });
        expect(resolvePackageBuildConfig(shared({ age: 18, threshold: 6 })).proseLint).toEqual({
            age: 18,
            threshold: 6,
            minWords: 8,
        });
        expect(() => resolvePackageBuildConfig(shared({ threshold: 8 }))).toThrow(
            /packageBuild.proseLint.threshold/,
        );
    });
});
