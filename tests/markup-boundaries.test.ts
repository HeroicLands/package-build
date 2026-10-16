/* SPDX-License-Identifier: GPL-3.0-or-later */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanBlocks } from "../engine/content-blocks.mjs";
import { scanAlerts, ALERT_TYPES } from "../engine/content-alerts.mjs";
import { checkFormatting, lintMarkdown } from "../engine/prose-lint.mjs";
import { subprocessTimeout } from "./subprocess-timeout.js";

const CLI = path.resolve(__dirname, "../bin/package-build.mjs");
const LAZY = ':::secret {title="A"}\nHidden.\n\n> [!TIP]\n> Advice.\n:::\n';
const VALID = LAZY.replace("Advice.\n", "Advice.\n\n");
const FRONT =
    "---\nname: { full: Example }\nshortcode: example\ntype: doc\nsubType: rules\ndescription: An example.\n---\n\n";
let root: string;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "markup-boundaries-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const write = (name: string, text: string) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
};

describe("fenced div boundaries", () => {
    it("refuses a closing fence held by a blockquote's lazy continuation", () => {
        expect(scanBlocks(LAZY).errors).toEqual([
            { line: 1, column: 1, message: "secret block needs a closing ::: line" },
        ]);
        expect(scanBlocks(LAZY.replace("\n:::\n", "\n> :::\n")).errors).toHaveLength(1);
        expect(scanBlocks(VALID).errors).toEqual([]);
    });
    it("leaves quoted and indented code examples literal", () => {
        for (const source of [
            "    :::secret\n    Example.\n",
            "> Example.\n:::secret\n",
            "> ```md\n> :::secret\n> ```\n",
            "~~~md\n:::secret\n~~~\n",
            "````md\n```\n:::secret\n```\n````\n",
            "<pre>\n:::secret\n</pre>\n",
        ])
            expect(scanBlocks(source).errors, source).toEqual([]);
    });
    it("accepts nested divs, alerts and quoted code with a real outer closer", () => {
        const source =
            ":::secret\nHidden.\n\n::: {.inner}\n> [!NOTE]\n> Advice.\n>\n> ```md\n> :::\n> ```\n\n:::\n\n::: {#last}\nMore.\n:::\n:::\n";
        expect(scanBlocks(source).errors).toEqual([]);
        expect(scanAlerts(source).errors).toEqual([]);
    });
    it("locates the actual opening column with CRLF", () => {
        expect(scanBlocks("\r\n  :::secret\r\nText.\r\n").errors[0]).toMatchObject({
            line: 2,
            column: 3,
        });
    });
});

describe("command boundary validation", () => {
    it.each([
        [":::secret\nHidden.\n", "secret block needs a closing ::: line", 1],
        ["::: {.group}\nText.\n", "div block needs a closing ::: line", 1],
        [":::\nText.\n", "div block needs a closing ::: line", 1],
        ["> [!BOGUS]\n> Advice.\n", "unknown alert type BOGUS", 3],
        [LAZY, "secret block needs a closing ::: line", 1],
    ])("markdown refuses malformed source: %s", async (body, message, column) => {
        const file = write("example.md", FRONT + body);
        const result = await lintMarkdown(root, { paths: ["example.md"] });
        expect(result.exitCode).toBe(1);
        expect(result.findings).toContainEqual(
            expect.objectContaining({
                file,
                line: 9,
                column,
                severity: "error",
                message: expect.stringContaining(message),
            }),
        );
    });
    it.each([
        [":::secret\n\n:::\n", "secret block is empty"],
        [":::secret {onclick=run}\nBody.\n:::\n", "event handler"],
        [":::secret\n:::secret\nBody.\n:::\n:::\n", "nested secret"],
        [":::secret\n# Page\n:::\n", "heading that starts a page"],
        ["> [!NOTE]\n", "needs a body"],
        ["> [!NOTE\n", "brackets"],
        ["```poetry\nVerse.\n", "closing code fence"],
    ])("shares the renderer's syntax refusals: %s", async (body, message) => {
        write("example.md", body);
        const result = await lintMarkdown(root);
        expect(result.exitCode).toBe(1);
        expect(result.findings.some((finding: any) => finding.message.includes(message))).toBe(
            true,
        );
    });
    it("leaves malformed Markdown unchanged when fixes are requested", async () => {
        const source = LAZY + "\nextra trailing spaces   \n";
        const file = write("example.md", source);
        expect((await lintMarkdown(root, { fix: true })).exitCode).toBe(1);
        expect(fs.readFileSync(file, "utf8")).toBe(source);
    });
    it("leaves alert-looking content inside HTML and nested code literal", async () => {
        write(
            "example.md",
            "<pre>\n> [!BOGUS]\n:::secret\n</pre>\n\n> ```markdown\n> > [!BOGUS]\n> :::secret\n> ```\n",
        );
        expect(await lintMarkdown(root)).toMatchObject({ exitCode: 0, findings: [] });
    });
    it("keeps poetry-looking fences in literal HTML out of syntax validation", async () => {
        write("example.md", "<pre>\n```poetry\n</pre>\n");
        expect(await lintMarkdown(root)).toMatchObject({ exitCode: 0, findings: [] });
    });
    it("accepts every alert type the shared registry declares", async () => {
        for (const name of Object.keys(ALERT_TYPES))
            write(`${name}.md`, `> [!${name.toUpperCase()}]\n> Advice.\n`);
        expect(await lintMarkdown(root)).toMatchObject({ exitCode: 0, findings: [] });
    });
    it("does not scan frontmatter or literal code examples", async () => {
        write(
            "example.md",
            "---\ndescription: |\n  :::secret\n  > [!BOGUS]\n---\n\n```markdown\n:::secret\n> [!BOGUS]\n```\n",
        );
        expect(await lintMarkdown(root)).toMatchObject({ exitCode: 0, findings: [] });
    });
    it("format refuses the lazy-closing source without rewriting it", async () => {
        const file = write("example.md", LAZY);
        const result = await checkFormatting(root, { paths: [file], write: true });
        expect(result.findings).toContainEqual(
            expect.objectContaining({
                file,
                line: 1,
                column: 1,
                severity: "error",
                message: expect.stringContaining("closing :::"),
            }),
        );
        expect(result.written).toEqual([]);
        expect(fs.readFileSync(file, "utf8")).toBe(LAZY);
    });
    it("format preserves the separated closing fence and markdown accepts it", async () => {
        const file = write("example.md", VALID);
        expect((await checkFormatting(root, { paths: [file], write: true })).findings).toEqual([]);
        const formatted = fs.readFileSync(file, "utf8");
        expect(formatted).toMatch(/> Advice\.\n\n:::\n/);
        expect((await lintMarkdown(root)).exitCode).toBe(0);
    });
    it(
        "lint and markdown refuse the malformed fixtures with file positions",
        () => {
            write("package.json", JSON.stringify({ name: "demo", version: "1.0.0" }));
            write(
                "package-build.config.yaml",
                `contentPackage: demo
packageKind: modules
compatibility: { minimum: "14.359", verified: "14.359" }
stats: { lastModifiedBy: preflightbuild00 }
packs:
  - { name: journals, type: JournalEntry, default: true }
publish: {}
pdf: { books: [{ id: core, title: Demo, document: book.yaml }] }
`,
            );
            write(
                "assets/content/root.md",
                "---\nname: { full: Demo }\nshortcode: root\ntype: homepage\n---\n\nWelcome.\n",
            );
            write("assets/content/example.md", FRONT + LAZY);
            write(
                "assets/content/div.md",
                FRONT.replaceAll("example", "group") + "::: {.group}\nText.\n",
            );
            write(
                "assets/content/alert.md",
                FRONT.replaceAll("example", "alert") + "> [!BOGUS]\n> Advice.\n",
            );
            for (const command of [["lint"], ["markdown", "assets/content/*.md"]]) {
                const result = spawnSync(process.execPath, [CLI, ...command], {
                    cwd: root,
                    encoding: "utf8",
                    env: {
                        ...process.env,
                        PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
                    },
                });
                const output = result.stdout + result.stderr;
                expect(result.status, output).toBe(1);
                expect(output).toContain(
                    "assets/content/example.md:9:1: error: secret block needs a closing ::: line",
                );
                expect(output).toContain(
                    "assets/content/div.md:9:1: error: div block needs a closing ::: line",
                );
                expect(output).toContain(
                    "assets/content/alert.md:9:3: error: unknown alert type BOGUS",
                );
                expect(output).not.toContain("Markdown is clean");
            }
        },
        subprocessTimeout(2),
    );
});
