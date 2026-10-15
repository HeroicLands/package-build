/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `package-build lint` holds every content and picture path to printable 7-bit
 * ASCII. The cases run the real command over a minimal temporary package, since
 * the rule is about what the command refuses.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { SUBPROCESS_TEST_TIMEOUT } from "./subprocess-timeout.js";
import { offendingPathCharacters } from "../engine/path-charset.mjs";

const CLI = path.resolve(__dirname, "../bin/package-build.mjs");

/** A package holding one well-formed note at `notePath`, and optionally a picture. */
function fixture(notePath: string, picturePath?: string) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "path-charset-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "demo", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(root, "package-build.config.yaml"),
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
    const note = path.join(root, notePath);
    fs.mkdirSync(path.dirname(note), { recursive: true });
    fs.writeFileSync(
        note,
        `---
name: { full: Manual }
shortcode: root
type: homepage
description: A described note.
---
The front page of a demonstration package, with enough words in its body to
read as finished rather than as a beginning.
`,
    );
    if (picturePath) {
        const picture = path.join(root, picturePath);
        fs.mkdirSync(path.dirname(picture), { recursive: true });
        fs.writeFileSync(picture, "<svg xmlns='http://www.w3.org/2000/svg'/>");
    }
    return root;
}

function lint(root: string) {
    const result = spawnSync(process.execPath, [CLI, "lint"], {
        cwd: root,
        env: { ...process.env, PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml") },
        encoding: "utf8",
    });
    return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** Lint a fixture and remove it. */
function lintFixture(notePath: string, picturePath?: string) {
    const root = fixture(notePath, picturePath);
    try {
        return lint(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

describe("a path outside printable ASCII", () => {
    it(
        "fails lint for a note, naming the character",
        () => {
            const result = lintFixture("assets/content/X/A_Sílhari_Manual.md");
            expect(result.status).not.toBe(0);
            expect(result.output).toContain(
                "assets/content/X/A_Sílhari_Manual.md: error: the path holds U+00ED (í), " +
                    "outside printable ASCII; rename the file using ASCII only",
            );
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "passes lint when the same note is spelled in ASCII",
        () => {
            const result = lintFixture("assets/content/X/A_Silhari_Manual.md");
            expect(result.output).not.toContain("outside printable ASCII");
            expect(result.status, result.output).toBe(0);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "fails lint for a picture under a picture root",
        () => {
            const result = lintFixture("assets/content/A.md", "assets/icons/sub/Sílhari.svg");
            expect(result.status).not.toBe(0);
            expect(result.output).toContain(
                "assets/icons/sub/Sílhari.svg: error: the path holds U+00ED (í)",
            );
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "accepts an apostrophe",
        () => {
            const result = lintFixture("assets/content/Knight's_Shield.md");
            expect(result.output).not.toContain("outside printable ASCII");
            expect(result.status, result.output).toBe(0);
        },
        SUBPROCESS_TEST_TIMEOUT,
    );

    it(
        "fails lint for a control character in a name",
        () => {
            const result = lintFixture("assets/content/A\tB.md");
            expect(result.status).not.toBe(0);
            expect(result.output).toContain("the path holds U+0009");
        },
        SUBPROCESS_TEST_TIMEOUT,
    );
});

describe("offendingPathCharacters", () => {
    it("is empty for printable ASCII, apostrophe and space included", () => {
        expect(offendingPathCharacters("assets/content/Knight's Shield-1_a.b.md")).toEqual([]);
    });

    it("names each distinct character once, in order of appearance", () => {
        expect(offendingPathCharacters("Sílhári-í")).toEqual(["í", "á"]);
    });

    it("refuses control characters, DEL and astral characters", () => {
        expect(offendingPathCharacters("a\u0001b\u007f\u{1F600}")).toEqual([
            "\u0001",
            "\u007f",
            "\u{1F600}",
        ]);
    });
});
