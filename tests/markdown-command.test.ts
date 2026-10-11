/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `package-build markdown` end to end: the findings it prints, the repairs
 * `--fix` makes, and the dependency set that lets it run.
 *
 * The CLI is spawned rather than called, because the contract under test is
 * what a consumer's terminal and CI log receive — `file:line:column: severity:
 * message`, path first, relative to the working directory — and the exit status.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { lintMarkdown } from "../engine/prose-lint.mjs";

import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BIN = path.join(PKG_ROOT, "bin", "package-build.mjs");

let root: string;

const write = (rel: string, body: string) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    return file;
};

const run = (...args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, "markdown", ...args], {
        cwd: root,
        encoding: "utf8",
    });
    const lines = `${r.stdout}${r.stderr}`.split("\n").filter((line) => /^[^\s[]/.test(line));
    return { status: r.status, diagnostics: lines.filter((line) => line.includes(": error: ")) };
};

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-markdown-"));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

const BAD_A =
    "# One\n\n### Three\n\nSome *emph* and **s** and <https://x.y> http://bare.example\n\n" +
    "(text)[http://a.b]\n\n[ Spaced ](http://a.b)\n\n| a | b |\n|--|--|\n| 1 |\n";
const BAD_B = "---\nk: v\n---\n# T\n\nA *b* c.\n\n[ref][missing]\n";

describe("package-build markdown findings", () => {
    it(
        "prints each finding as path:line:column: error: message and exits 1",
        () => {
            write("a.md", BAD_A);
            write("sub/b.md", BAD_B);
            write(".gitignore", "build/\n");
            write("build/c.md", "# A\n\n### B\n");

            const r = run();

            expect(r.status).toBe(1);
            expect(r.diagnostics).toEqual([
                "a.md:3: error: MD001/heading-increment Heading levels should only increment by one level at a time [Expected: h2; Actual: h3]",
                'a.md:5:41: error: MD034/no-bare-urls Bare URL used [Context: "http://bare.example"]',
                "a.md:5:6: error: MD049/emphasis-style Emphasis style [Expected: underscore; Actual: asterisk]",
                "a.md:5:11: error: MD049/emphasis-style Emphasis style [Expected: underscore; Actual: asterisk]",
                "a.md:7:1: error: MD011/no-reversed-links Reversed link syntax [(text)[http://a.b]]",
                'a.md:9:2: error: MD039/no-space-in-links Spaces inside link text [Context: "[ Spaced ]"]',
                'a.md:9:9: error: MD039/no-space-in-links Spaces inside link text [Context: "[ Spaced ]"]',
                "a.md:13:5: error: MD056/table-column-count Table column count [Expected: 2; Actual: 1; Too few cells, row will be missing data]",
                "sub/b.md:6:3: error: MD049/emphasis-style Emphasis style [Expected: underscore; Actual: asterisk]",
                "sub/b.md:6:5: error: MD049/emphasis-style Emphasis style [Expected: underscore; Actual: asterisk]",
                'sub/b.md:8:1: error: MD052/reference-links-images Reference links and images should use a label that is defined [Missing link or image reference definition: "missing"] [Context: "[ref][missing]"]',
            ]);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "repairs what is fixable under --fix and still reports the rest",
        () => {
            write("a.md", BAD_A);
            write("sub/b.md", BAD_B);

            const r = run("--fix");

            expect(r.status).toBe(1);
            expect(r.diagnostics).toEqual([
                "a.md:3: error: MD001/heading-increment Heading levels should only increment by one level at a time [Expected: h2; Actual: h3]",
                "a.md:13:5: error: MD056/table-column-count Table column count [Expected: 2; Actual: 1; Too few cells, row will be missing data]",
                'sub/b.md:8:1: error: MD052/reference-links-images Reference links and images should use a label that is defined [Missing link or image reference definition: "missing"] [Context: "[ref][missing]"]',
            ]);
            const a = fs.readFileSync(path.join(root, "a.md"), "utf8");
            expect(a).toContain("Some _emph_ and **s** and <https://x.y> <http://bare.example>");
            expect(a).toContain("[text](http://a.b)");
            expect(a).toContain("[Spaced](http://a.b)");
            expect(fs.readFileSync(path.join(root, "sub/b.md"), "utf8")).toContain("A _b_ c.");
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "exits 0 and writes nothing for a clean tree under --fix",
        () => {
            write("a.md", "# Title\n\nClean _text_.\n");
            const before = fs.statSync(path.join(root, "a.md")).mtimeMs;
            expect(run("--fix").status).toBe(0);
            expect(fs.statSync(path.join(root, "a.md")).mtimeMs).toBe(before);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );
});

const STAR = "Some *emphasis* here.\n";

describe("markdown file selection and configuration", () => {
    const flagged = async (opts?: { paths?: string[] }) =>
        [
            ...new Set(
                (await lintMarkdown(root, opts)).findings.map((f: any) =>
                    path.relative(root, f.file),
                ),
            ),
        ].sort();

    it("applies a nested .gitignore to its own directory only", async () => {
        write("docs/.gitignore", "generated/\n");
        write("docs/generated/a.md", STAR);
        write("docs/kept/a.md", STAR);
        write("other/generated/a.md", STAR);
        expect(await flagged()).toEqual(["docs/kept/a.md", "other/generated/a.md"]);
    });

    it("lets a nested options file set rules for its subtree", async () => {
        write("a.md", STAR);
        write("docs/a.md", STAR);
        write("docs/.markdownlint-cli2.jsonc", JSON.stringify({ config: { MD049: false } }));
        expect(await flagged()).toEqual(["a.md"]);
    });

    it("lets a rule file replace the rules for its directory", async () => {
        write("a.md", STAR);
        write("docs/a.md", STAR);
        write("docs/.markdownlint.json", JSON.stringify({ default: false }));
        expect(await flagged()).toEqual(["a.md"]);
    });

    it("selects files by the paths given and by the root options file's globs", async () => {
        write("a.md", STAR);
        write("docs/b.md", STAR);
        expect(await flagged({ paths: ["docs/*.md"] })).toEqual(["docs/b.md"]);
        expect(await flagged({ paths: ["docs"] })).toEqual(["docs/b.md"]);
        write(".markdownlint-cli2.jsonc", JSON.stringify({ globs: ["!docs/**"] }));
        expect(await flagged()).toEqual(["a.md"]);
    });

    it("honours a custom frontMatter pattern", async () => {
        write("a.md", ";;;\nx: *y*\n;;;\n# T\n");
        expect(await flagged()).toContain("a.md");
        write(".markdownlint-cli2.jsonc", JSON.stringify({ frontMatter: "^;;;[\\s\\S]*?\\n;;;" }));
        expect(await flagged()).toEqual([]);
    });

    it("refuses an unknown option, located at its key", async () => {
        write("a.md", "# T\n");
        write(".markdownlint-cli2.jsonc", '{\n    "ignores": [],\n    "outputFormatters": []\n}\n');
        const r = await lintMarkdown(root);
        expect(r.exitCode).toBe(1);
        expect(r.findings).toHaveLength(1);
        expect(r.findings[0]).toMatchObject({
            file: path.join(root, ".markdownlint-cli2.jsonc"),
            line: 3,
            column: 5,
            severity: "error",
        });
        expect(r.findings[0].message).toContain("unknown option `outputFormatters`");
    });

    it("refuses a root-only option written in a nested options file", async () => {
        write("a.md", "# T\n");
        write("docs/a.md", "# T\n");
        write("docs/.markdownlint-cli2.yaml", "config:\n  MD049: false\nglobs:\n  - '**/*.md'\n");
        const r = await lintMarkdown(root);
        expect(r.findings).toHaveLength(1);
        expect(r.findings[0]).toMatchObject({ line: 3, column: 1 });
        expect(r.findings[0].message).toContain(
            "`globs` can only be declared in the repository root",
        );
    });

    it("locates a syntax error in an options file", async () => {
        write("a.md", "# T\n");
        write(".markdownlint-cli2.jsonc", '{\n    "ignores": [\n');
        const r = await lintMarkdown(root);
        expect(r.findings).toHaveLength(1);
        expect(r.findings[0].line).toBeGreaterThan(0);
        expect(r.findings[0].file).toBe(path.join(root, ".markdownlint-cli2.jsonc"));
    });
});

describe("the markdown linter's dependencies", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"));

    it("does not ship markdownlint-cli2", () => {
        expect(Object.keys(manifest.dependencies)).not.toContain("markdownlint-cli2");
        expect(Object.keys(manifest.devDependencies ?? {})).not.toContain("markdownlint-cli2");
    });

    it("drives the markdownlint library directly", () => {
        expect(Object.keys(manifest.dependencies)).toContain("markdownlint");
    });
});
