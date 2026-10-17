/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";

const ROOT = path.resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const cwd = mkdtempSync(path.join(os.tmpdir(), "source-preview-cli-"));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

function run(args: string[] = [], input = "# Plain Markdown\n\nA **local** note.\n") {
    return spawnSync(
        process.execPath,
        [path.join(ROOT, "bin/package-build-preview.mjs"), ...args],
        {
            cwd,
            input,
            encoding: "utf8",
            timeout: SUBPROCESS_TEST_TIMEOUT,
            env: { ...process.env, PACKAGE_BUILD_CONFIG: path.join(cwd, "does-not-exist.yaml") },
        },
    );
}

describe("the standalone source preview", () => {
    it("publishes an executable command and typed public renderer export", () => {
        expect(pkg.bin["package-build-preview"]).toBe("./bin/package-build-preview.mjs");
        expect(pkg.exports["./preview"]).toEqual({
            types: "./types/engine/site-preview.d.mts",
            import: "./engine/site-preview.mjs",
            default: "./engine/site-preview.mjs",
        });
    });

    it("renders stdin without frontmatter, configuration or content tree", () => {
        const result = run();
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('class="hl-preview hl-preview-light"');
        expect(result.stdout).toContain("<h1>Plain Markdown</h1>");
        expect(result.stdout).toContain("<strong>local</strong>");
        expect(result.stderr).toBe("");
        expect(result.stdout).not.toContain("<style");
    });

    it("selects dark explicitly", () => {
        const result = run(["--dark"]);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('class="hl-preview hl-preview-dark"');
        expect(result.stdout).not.toContain("hl-preview-light");
    });

    it("emits the shared scoped stylesheet without reading stdin", () => {
        const result = run(["--css"], "");
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain(".hl-preview");
        expect(result.stdout).toContain("#6c3fd1");
        expect(result.stdout).toContain("#c4b0ff");
        expect(result.stdout).not.toContain("<style");
    });

    it.each([["--unknown"], ["--dark=false"], ["file.md"]])(
        "refuses unsupported arguments %j",
        (...args) => {
            const result = run(args);
            expect(result.status).toBe(1);
            expect(result.stdout).toBe("");
            expect(result.stderr).toMatch(/package-build-preview:.*(Unknown|Unexpected)/);
        },
    );

    it("computes ages with the default and explicit current date", () => {
        const note = '---\ntype: being\ndata:\n  born: "700.2"\n---\nAge: {{data.age}}';
        const normal = run([], note);
        expect(normal.status, normal.stderr).toBe(0);
        expect(normal.stdout).toContain("Age: 19");
        const override = run(["--current-date", "730.2"], note);
        expect(override.status, override.stderr).toBe(0);
        expect(override.stdout).toContain("Age: 30");
    });

    it("discovers the local setting and allows an explicit override", () => {
        const file = path.join(cwd, "package-build.config.yaml");
        writeFileSync(file, 'currentDate: "740.1"\n');
        try {
            const note = '---\ntype: being\ndata:\n  born: "700.1"\n---\nAge: {{data.age}}';
            expect(run([], note).stdout).toContain("Age: 40");
            expect(run(["--current-date", "730.1"], note).stdout).toContain("Age: 30");
        } finally {
            unlinkSync(file);
        }
    });

    it.each([
        ["--current-date"],
        ["--current-date", "unknown"],
        ["--current-date", "datefrom calendar 720 AF"],
    ])("rejects invalid date arguments %j", (...args) => {
        const result = run(args);
        expect(result.status).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toMatch(/current.date|currentDate/);
    });

    it("lists all CLI options in help", () => {
        const source = readFileSync(path.join(ROOT, "bin/package-build-preview.mjs"), "utf8");
        const result = run(["--help"]);
        expect(result.status, result.stderr).toBe(0);
        // Derive the surface from parser comparisons so a new option requires help.
        const options = [...source.matchAll(/arg === "(--[a-z-]+)"/g)].map((m) => m[1]);
        expect(options.length).toBeGreaterThanOrEqual(3);
        for (const option of options) expect(result.stdout).toContain(option);
    });
});
