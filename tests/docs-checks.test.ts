/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkDocIndex, checkDocLinks } from "../engine/docs-checks.mjs";

function fixture(files: Record<string, string>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "package-build-docs-"));
    for (const [name, text] of Object.entries(files)) {
        const file = path.join(root, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    }
    return root;
}

describe("documentation checks", () => {
    it("emits a located CLI diagnostic for a dead relative link", () => {
        const root = fixture({ "README.md": "[missing](gone.md)\n" });
        const binary = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            "../bin/package-build.mjs",
        );
        const result = spawnSync(process.execPath, [binary, "docs", "links", "--root", root], {
            cwd: root,
            encoding: "utf8",
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/^README\.md:1:11: error: link gone\.md /m);
    });

    it("locates a missing relative file and heading while ignoring code examples", () => {
        const root = fixture({
            "README.md":
                "# Guide\n[ok](pages/topic.md#topic)\n[missing](gone.md)\n[heading](pages/topic.md#absent)\n`[example](ignored.md)`\n```md\n[fenced](ignored.md)\n```\n",
            "pages/topic.md": "# Topic\n",
        });
        const findings = checkDocLinks(root);
        expect(findings).toHaveLength(2);
        expect(
            findings.map((finding) => [path.basename(finding.file), finding.line, finding.column]),
        ).toEqual([
            ["README.md", 3, 11],
            ["README.md", 4, 11],
        ]);
        expect(findings[0].message).toContain("does not exist");
        expect(findings[1].message).toContain("anchor nobody declares");
    });

    it("finds orphaned section pages and accepts indexed pages", () => {
        const root = fixture({
            "README.md": "[One](guides/one.md)\n",
            "guides/one.md": "# One\n",
            "guides/two.md": "# Two\n",
        });
        expect(checkDocIndex(root)).toEqual([
            expect.objectContaining({ file: path.join(root, "guides/two.md"), severity: "error" }),
        ]);
        const binary = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            "../bin/package-build.mjs",
        );
        const result = spawnSync(process.execPath, [binary, "docs", "index", "--root", root], {
            cwd: root,
            encoding: "utf8",
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/^guides\/two\.md: error: not linked from /m);
        fs.appendFileSync(path.join(root, "README.md"), "[Two](guides/two.md)\n");
        expect(checkDocIndex(root)).toEqual([]);
        expect(checkDocLinks(root)).toEqual([]);
    });
});
