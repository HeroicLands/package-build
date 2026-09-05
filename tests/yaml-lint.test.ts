/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { candidateFiles, frontmatterProcessor, lintYaml } from "../engine/yaml-lint.mjs";

let root: string;

/**
 * Write one file into the fixture tree.
 *
 * @param file - Path relative to the tree root.
 * @param text - Its contents.
 */
function write(file: string, text: string): void {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
}

/**
 * Lint the fixture tree and return the findings for one file.
 *
 * @param file - Path relative to the tree root.
 * @returns The findings reported against it.
 */
async function findingsFor(file: string): Promise<any[]> {
    const { findings } = await lintYaml(root, { paths: [file] });
    return findings;
}

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "yaml-lint-"));
});
afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe("the frontmatter processor", () => {
    it("hands ESLint the fence, and nothing after it", () => {
        const [virtual] = frontmatterProcessor.preprocess("---\na: 1\n---\n\nbody: not yaml\n");

        expect(virtual.text).toBe("a: 1");
        expect(virtual.filename).toBe("0.yaml");
    });

    it("offers nothing for a file with no frontmatter", () => {
        expect(frontmatterProcessor.preprocess("# Just a heading\n")).toEqual([]);
    });

    it("maps a finding back over the opening `---`", () => {
        const mapped = frontmatterProcessor.postprocess([[{ line: 3, endLine: 4 } as any]]);

        expect(mapped[0].line).toBe(4);
        expect(mapped[0].endLine).toBe(5);
    });
});

describe("linting a note's frontmatter", () => {
    it("reports a key written with nothing after the colon", async () => {
        // `folder:` and `folder: null` parse identically and read as opposite
        // things: a decision, or a key somebody began and did not finish.
        write("bare.md", "---\ntype: skill\nfolder:\n---\n\nbody\n");
        const findings = await findingsFor("bare.md");

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toMatch(/yml\/no-empty-mapping-value/);
    });

    it("says nothing about a key with a mapping or a sequence under it", async () => {
        // A sequence may sit at the parent's own indent, which makes the key's
        // line look bare when it is not.
        write("blocks.md", "---\nname:\n  full: Climbing\ntags:\n- a\nmore:\n  - b\n---\n\nbody\n");

        expect(await findingsFor("blocks.md")).toEqual([]);
    });

    it("locates it at its position in the file, not in the fence", async () => {
        write("located.md", "---\nname:\n  full: X\ntype: skill\nfolder:\n---\n\nbody\n");
        const [finding] = await findingsFor("located.md");

        // `folder:` is the fence's line 4 and the file's line 5.
        expect(finding.line).toBe(5);
        expect(finding.column).toBe(1);
    });

    it("reports a duplicate key, which the note parse silently swallowed", async () => {
        // `parseMarkdownFile` catches this throw and returns `frontmatter:
        // null`, so the note stopped being a note and the build said nothing.
        write("dup.md", "---\nname: One\nname: Two\n---\n\nbody\n");
        const findings = await findingsFor("dup.md");

        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/Map keys must be unique/);
        expect(findings[0].line).toBe(3);
        // A parse error reports column 0, which no compiler-parseable format
        // admits; it is clamped rather than dropped, because the line is right.
        expect(findings[0].column).toBe(1);
    });

    it("reports a tab used as indentation", async () => {
        write("tab.md", "---\nname: X\nmap:\n\tk: 1\n---\n\nbody\n");
        const findings = await findingsFor("tab.md");

        expect(findings[0].message).toMatch(/Tabs are not allowed as indentation/);
    });

    it("reports an irregular space, which no editor shows", async () => {
        write("nbsp.md", "---\nname: caf\u00a0e\n---\n\nbody\n");
        const findings = await findingsFor("nbsp.md");

        expect(findings[0].message).toMatch(/yml\/no-irregular-whitespace/);
    });

    it("passes a note whose frontmatter is well formed", async () => {
        write("ok.md", "---\ntype: skill\nname:\n  full: Climbing\ntags:\n  - a\n---\n\nbody\n");

        expect(await findingsFor("ok.md")).toEqual([]);
    });

    it("reads no further than the fence", async () => {
        // A body is markdown, and markdown is full of text that is not YAML.
        write("body.md", "---\ntype: skill\n---\n\n- a: 1\n\tb: 2\n\nname: x\nname: y\n");

        expect(await findingsFor("body.md")).toEqual([]);
    });
});

describe("linting a standalone YAML file", () => {
    it("reports the same class of error", async () => {
        write("config/thing.yaml", "one: 1\none: 2\n");
        const findings = await findingsFor("config/thing.yaml");

        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/Map keys must be unique/);
    });

    it("exempts a GitHub workflow from the empty-value rule", async () => {
        // `on:` `push:` carries its meaning by being present; writing
        // `push: null` to satisfy a linter would be worse YAML, not better.
        write(
            ".github/workflows/ci.yml",
            "name: CI\non:\n  push:\n  workflow_dispatch:\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n",
        );

        expect(await findingsFor(".github/workflows/ci.yml")).toEqual([]);
    });

    it("still reports a real error inside a workflow", async () => {
        write(".github/workflows/dup.yml", "name: One\nname: Two\non:\n  push:\n");
        const findings = await findingsFor(".github/workflows/dup.yml");

        expect(findings[0].message).toMatch(/Map keys must be unique/);
    });
});

describe("choosing the files to lint", () => {
    it("skips a worktree checked out under `.claude`", () => {
        // A worktree there is a checkout of this same repository: linting it
        // reports every finding once per worktree, against paths the author
        // cannot edit from where they are standing.
        write(".claude/worktrees/x/note.md", "---\nfolder:\n---\n");
        write("kept.md", "---\nfolder:\n---\n");
        const files = candidateFiles(root);

        expect(files.some((f) => f.startsWith(".claude/"))).toBe(false);
        expect(files).toContain("kept.md");
    });

    it("drops whatever `.gitignore` drops", () => {
        // The set is `git ls-files --cached --others --exclude-standard`, which
        // is the same set `gitignore: true` gives the markdown linter — and it
        // is the difference between offering ESLint 60,792 files in
        // `Song-of-Heroic-Lands-FoundryVTT` and offering it 1,888.
        const repo = fs.mkdtempSync(path.join(os.tmpdir(), "yaml-lint-git-"));
        try {
            const run = (...args: string[]) =>
                execFileSync("git", args, { cwd: repo, stdio: "ignore" });
            run("init", "-q");
            fs.writeFileSync(path.join(repo, ".gitignore"), "nogit/\nbuild/\n");
            fs.mkdirSync(path.join(repo, "nogit"), { recursive: true });
            fs.writeFileSync(path.join(repo, "nogit", "old.md"), "---\nfolder:\n---\n");
            fs.writeFileSync(path.join(repo, "tracked.md"), "---\nfolder:\n---\n");
            fs.writeFileSync(path.join(repo, "untracked.md"), "---\nfolder:\n---\n");
            run("add", "tracked.md");
            const files = candidateFiles(repo);

            expect(files).not.toContain("nogit/old.md");
            expect(files).toContain("tracked.md");
            // Untracked but not ignored, so a note is linted while it is being
            // written and not only once it has been staged.
            expect(files).toContain("untracked.md");
        } finally {
            fs.rmSync(repo, { recursive: true, force: true });
        }
    });

    it("offers markdown and YAML, and nothing else", () => {
        write("code.ts", "export const a = 1;\n");
        const files = candidateFiles(root);

        expect(files).not.toContain("code.ts");
        expect(files.some((f) => f.endsWith(".md"))).toBe(true);
        expect(files.some((f) => f.endsWith(".yaml"))).toBe(true);
    });
});
