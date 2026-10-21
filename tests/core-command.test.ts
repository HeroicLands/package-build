/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **`package-build core` reports a content tree's core vocabulary gaps** as
 * text and as JSON, exits 0 while concepts are missing, and refuses a language
 * that is none with a located finding.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let root = "";

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "core-command-"));
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
        path.join(content, "Concepts.md"),
        [
            "---",
            "shortcode: concepts",
            "name: { full: Concepts }",
            "type: doc",
            "subType: reference",
            "data:",
            "    concepts:",
            "        - { id: see-verb, gloss: to see, group: senses }",
            "        - { id: smell-noun, gloss: a smell, group: senses }",
            "        - { id: knee, gloss: the knee, group: body }",
            "---",
            "",
            "The core.",
            "",
        ].join("\n"),
    );
    fs.writeFileSync(
        path.join(content, "Tongue.md"),
        [
            "---",
            "shortcode: tongue",
            "name: { full: Tongue }",
            "type: skill",
            "subType: language",
            "data:",
            "    core: true",
            "    fields:",
            "        - { name: Life, holds: Everyday words. }",
            "    words:",
            "        - { form: veda, class: n, field: Life, gloss: a sight, concept: see-verb }",
            "---",
            "",
            "A tongue.",
            "",
        ].join("\n"),
    );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function core(...args: string[]) {
    return spawnSync(
        process.execPath,
        [path.join(PKG_ROOT, "bin", "package-build.mjs"), "core", ...args],
        {
            cwd: root,
            env: {
                ...process.env,
                PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
            },
            encoding: "utf8",
        },
    );
}

describe("package-build core", () => {
    it(
        "prints what the covering languages have no word for, and exits 0",
        () => {
            const run = core();
            expect(run.stderr).toBe("");
            expect(run.stdout).toBe(
                [
                    "Tongue (skill-tongue): 2 of 3 core concepts have no word",
                    "  senses: 1 of 2",
                    "    smell-noun\ta smell",
                    "  body: 1 of 1",
                    "    knee\tthe knee",
                    "",
                ].join("\n"),
            );
            expect(run.status).toBe(0);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "prints the same report as JSON",
        () => {
            const run = core("--json");
            expect(run.status).toBe(0);
            const report = JSON.parse(run.stdout);
            expect(report.concepts).toBe(3);
            expect(report.languages).toHaveLength(1);
            expect(report.languages[0]).toMatchObject({
                name: "Tongue",
                language: "skill-tongue",
                covered: 1,
                total: 3,
            });
            expect(report.languages[0].missing.map((group: any) => group.group)).toEqual([
                "senses",
                "body",
            ]);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "refuses a language that is none, in the diagnostic form",
        () => {
            const run = core("--language", "Nowhere");
            expect(run.status).toBe(1);
            expect(run.stderr).toMatch(/^assets\/content: error: `Nowhere` is no language note: /);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );
});
