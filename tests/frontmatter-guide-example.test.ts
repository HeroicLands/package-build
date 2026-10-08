/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **The frontmatter guide's opening example lints.** It is the first note an
 * author copies, so it is read out of the guide and linted as written.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

describe("the frontmatter guide's example", () => {
    it(
        "lints with no error",
        () => {
            const guide = fs.readFileSync(
                path.join(PKG_ROOT, "docs/authoring/frontmatter.md"),
                "utf8",
            );
            const open = guide.indexOf("```yaml\n") + "```yaml\n".length;
            const example = guide.slice(open, guide.indexOf("\n```", open));
            expect(example.startsWith("---\n")).toBe(true);

            const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontmatter-guide-"));
            try {
                fs.writeFileSync(
                    path.join(root, "package.json"),
                    JSON.stringify({ name: "demo", version: "1.0.0" }),
                );
                fs.writeFileSync(
                    path.join(root, "package-build.config.yaml"),
                    [
                        "contentPackage: demo",
                        "packageKind: modules",
                        "compatibility:",
                        '    minimum: "14.359"',
                        "stats:",
                        "    lastModifiedBy: demobuilder0000",
                        "packs:",
                        "    - { name: journals, label: Journals, type: JournalEntry, default: true }",
                    ].join("\n") + "\n",
                );
                const content = path.join(root, "assets/content");
                fs.mkdirSync(content, { recursive: true });
                fs.writeFileSync(path.join(content, "Harbor.md"), `${example}\n\nThe harbor.\n`);
                fs.writeFileSync(
                    path.join(content, "homepage.md"),
                    "---\nshortcode: root\nname: { full: Demo }\ntype: homepage\n---\n\nHome.\n",
                );
                const run = spawnSync(
                    process.execPath,
                    [path.join(PKG_ROOT, "bin", "package-build.mjs"), "lint"],
                    {
                        cwd: root,
                        env: {
                            ...process.env,
                            PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
                        },
                        encoding: "utf8",
                    },
                );
                const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
                expect(output).not.toMatch(/Harbor\.md:\d+(:\d+)?: error/);
                expect(run.status, output).toBe(0);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
    );
});
