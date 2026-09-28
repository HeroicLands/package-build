/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CLI = path.resolve(__dirname, "../bin/package-build.mjs");

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "index-preflight-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "demo", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(root, "package-build.config.yaml"),
        `
contentPackage: demo
packageKind: modules
compatibility: { minimum: "14.359", verified: "14.359" }
stats: { lastModifiedBy: preflightbuild00 }
relationships:
  systems:
    - id: sohl
      type: system
      manifest: https://example.org/system.json
      compatibility: { verified: "1.0.0" }
packs:
  - { name: items, type: Item }
publish: {}
pdf: { title: Demo, document: book.yaml }
`,
    );
    fs.mkdirSync(path.join(root, "assets/content"), { recursive: true });
    fs.writeFileSync(path.join(root, "assets/content/Broken.md"), "---\nnot valid yaml: [\n---\n");
    return root;
}

function run(root: string, args: string[]) {
    const result = spawnSync(process.execPath, [CLI, ...args], {
        cwd: root,
        env: { ...process.env, PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml") },
        encoding: "utf8",
    });
    return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

describe("dependency index preflight", () => {
    it.each([
        ["lint"],
        ["links"],
        ["site"],
        ["pdf"],
        ["map"],
        ["reachability", "Lore"],
        ["package", "compile"],
    ])("%s fails on a cold cache before reading content or writing output", (...args) => {
        const root = fixture();
        try {
            const result = run(root, args);
            expect(result.status).not.toBe(0);
            expect(result.output).toMatch(
                /package-build\.config\.yaml: error: sohl is a declared dependency/,
            );
            expect(result.output).toContain("package-build deps fetch");
            expect(result.output).not.toMatch(/YAML|Broken\.md/);
            expect(fs.existsSync(path.join(root, "build"))).toBe(false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("lets a complete cache pass the preflight", () => {
        const root = fixture();
        try {
            const cache = path.join(root, "build/cache/metadata/sohl@1.0.0");
            fs.mkdirSync(cache, { recursive: true });
            fs.writeFileSync(path.join(cache, "sohl-metadata.jsonl"), "");
            fs.writeFileSync(path.join(cache, ".complete"), "");
            const result = run(root, ["lint"]);
            expect(result.output).not.toContain("content index has not been fetched");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("leaves commands that do not read foreign indexes alone", () => {
        const root = fixture();
        try {
            expect(run(root, ["package", "clean"]).output).not.toContain(
                "content index has not been fetched",
            );
            const configPath = path.join(root, "package-build.config.yaml");
            fs.writeFileSync(
                configPath,
                fs
                    .readFileSync(configPath, "utf8")
                    .replace("pdf: { title: Demo, document: book.yaml }", ""),
            );
            expect(run(root, ["pdf"]).output).not.toContain("content index has not been fetched");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
