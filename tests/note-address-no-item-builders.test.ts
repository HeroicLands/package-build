/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A `note` Address finds its note in a package with no `itemBuilders`.** A
 * skill's own document is a system document, so its canonical Address names
 * that system; written in the `note` system — which is what a `data:` field
 * resolves — it names the same note, exactly as it does for an affiliation or
 * a place.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

describe("a package with no itemBuilders", () => {
    it(
        "resolves a literature note's language to its skill note",
        () => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "no-item-builders-"));
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
                fs.writeFileSync(
                    path.join(content, "Tongue.md"),
                    "---\nshortcode: tongue\nname: { full: Tongue }\ntype: skill\nsubType: language\n---\n\nA tongue.\n",
                );
                fs.writeFileSync(
                    path.join(content, "Lay.md"),
                    "---\nshortcode: lay\nname: { full: Lay }\ntype: lore\nsubType: literature\n" +
                        "data:\n    language: skill-tongue\n---\n\nA lay.\n",
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
                expect(output).not.toMatch(/Lay\.md:\d+:\d+: error/);
                expect(output).not.toMatch(/does not resolve/);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
        SUBPROCESS_TEST_TIMEOUT,
    );
});
