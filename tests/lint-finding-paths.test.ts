/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Every content-tree lint locates a finding from the working directory.
 *
 * The diagnostic contract is `file:line:column`, with the path relative to the
 * directory the command was run from — that is what an editor, a CI annotator
 * or a shell `$EDITOR +line` resolves a finding against. A walk that
 * relativizes against the content root instead emits a path that reads fine and
 * opens nothing, and one `content-build lint` run emits both shapes at once.
 *
 * So the check is mechanical rather than a reading: resolve each finding's path
 * against the working directory and require a file to be there.
 *
 * The roster is **derived** from the engine's own exports rather than listed
 * here, so a walk added beside the existing ones is held to the same rule
 * without anyone remembering to add it. A new lint the fixture does not provoke
 * fails too, which is the intended cost: a lint nothing exercises is a lint
 * whose paths nobody has checked.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as engine from "../engine/index.mjs";

type Finding = { file?: string };
type LintResult = { findings: Finding[] };
type ContentLint = (contentBase: string, opts: Record<string, unknown>) => LintResult;

/** Every `lintContent*` walk the engine publishes, by name. */
function contentLints(): Array<[string, ContentLint]> {
    const found: Array<[string, ContentLint]> = [];
    for (const namespace of Object.values(engine as Record<string, unknown>)) {
        if (!namespace || typeof namespace !== "object") continue;
        for (const [name, value] of Object.entries(namespace as Record<string, unknown>)) {
            if (typeof value !== "function") continue;
            if (!/^lintContent/.test(name)) continue;
            if (found.some(([already]) => already === name)) continue;
            found.push([name, value as ContentLint]);
        }
    }
    return found.sort(([a], [b]) => (a < b ? -1 : 1));
}

describe("a content lint locates a finding from the working directory", () => {
    let root: string;
    /**
     * The corpus `lintContentTree` reads, supplied directly so the roster needs
     * no build configuration to run a walk against a fixture.
     */
    const records = [
        {
            file: { path: "Guide/Note.md" },
            type: "doc",
            shortcode: "note",
            name: { full: "Note" },
        },
    ];

    beforeAll(() => {
        // Realpath: macOS hands out a symlinked temporary directory, and a
        // finding resolved through the link must still name the same file.
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lint-paths-")));
        fs.mkdirSync(path.join(root, "Guide"), { recursive: true });
        // One note carrying one defect per walk: a non-ASCII vowel for the
        // charset check, a tag for the HTML check, an undeclared icon name, and
        // an image directive naming no width this format knows.
        fs.writeFileSync(
            path.join(root, "Guide", "Note.md"),
            [
                "---",
                "type: doc",
                "shortcode: note",
                "name:",
                "  full: Note",
                "---",
                "",
                "A <strong>bold</strong> claim about the vowel /ə/, and :icon-nosuchglyph: too.",
                "",
                "![A map](maps/x.png){.no-such-width}",
                "",
            ].join("\n"),
        );
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it("publishes the walks this holds to the rule", () => {
        // Names, not a count: a roster that shrank silently would pass a count.
        expect(contentLints().map(([name]) => name)).toEqual([
            "lintContentCharset",
            "lintContentHtml",
            "lintContentIcons",
            "lintContentImages",
            "lintContentTree",
        ]);
    });

    for (const [name, lint] of contentLints()) {
        it(`${name} emits a path that resolves from the working directory`, () => {
            // Every option any walk reads, so the roster stays derived rather
            // than a table of per-lint invocations free to omit one.
            const { findings } = lint(root, { skipDirectories: [], records });

            expect(findings.length).toBeGreaterThan(0);
            for (const finding of findings) {
                expect(finding.file).toBeTruthy();
                const resolved = path.resolve(process.cwd(), String(finding.file));
                expect(
                    fs.existsSync(resolved),
                    `${name} reported \`${finding.file}\`, which resolves to ` +
                        `\`${resolved}\` and is not there`,
                ).toBe(true);
                expect(resolved.startsWith(root)).toBe(true);
            }
        });
    }
});
