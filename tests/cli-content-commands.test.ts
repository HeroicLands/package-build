/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The content commands run against a content tree.
 *
 * This repository ships no content, so nothing here had ever *run*
 * `content-build lint` or `content-build site` over a tree — every test called
 * the engine functions directly, with arguments a test supplies. So when
 * `walkMarkdownTree` stopped defaulting its scope (#243), two CLI callers that
 * had been living on that default broke, and the whole suite stayed green:
 * `lint` and `site` failed on the first note for every consumer.
 *
 * These tests are cheap and shallow on purpose. They do not check what the
 * commands report — other suites do that. They check that the commands *reach*
 * the content at all.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(PKG_ROOT, "bin", "content-build.mjs");

let root: string;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cli-content-"));
    fs.mkdirSync(path.join(root, "assets", "content", "Templates"), { recursive: true });
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sohl", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(root, "package-build.config.yaml"),
        `contentPackage: sohl
packageKind: systems
compatibility:
    minimum: "14"
    verified: "14.367"
stats:
    lastModifiedBy: clitestbuild000000
systems:
    sohl:
        compatibility: { verified: "0.9.0" }
itemBuilders: [sohl]
skipDirectories: [Templates]
packs:
    - { name: items, label: Items, type: Item, system: sohl, default: true }
    - { name: journals, label: Journals, type: JournalEntry }
`,
    );
    const note = (name: string, code: string) =>
        `---\nname:\n  full: ${name}\ndescription: A ${name}.\nid: ${code.padEnd(16, "x")}\n` +
        `shortcode: ${code}\ntype: miscgear\nsohl:\n  archetype: 0\n  quality: 0\n` +
        `  durability: 2\n  kbcat: cooking\n  value: 6\n  weight: 3\n---\n\nProse.\n`;
    fs.writeFileSync(path.join(root, "assets", "content", "Bowl.md"), note("Bowl", "bowl"));
    // A note the configured scope excludes, so a command that ignores the
    // scope reads a file it was told not to.
    fs.writeFileSync(
        path.join(root, "assets", "content", "Templates", "Skeleton.md"),
        note("Skeleton", "skel"),
    );
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** Run one content command against the fixture tree. */
function run(...args: string[]): string {
    const r = spawnSync(process.execPath, [CLI, ...args], {
        cwd: root,
        env: { ...process.env, PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml") },
        encoding: "utf8",
    });
    return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

describe("a content command reaches the content", () => {
    it.each(["lint", "links", "site"])("`content-build %s` states the walk's scope", (cmd) => {
        // The failure this exists for: a caller that omits `skipDirectories`
        // throws on the first note, so the command reports nothing about the
        // tree and its exit code is the only symptom.
        expect(run(cmd)).not.toMatch(/requires `skipDirectories`/);
    });

    it("honours the configured scope rather than reading every file", () => {
        // `Templates/` is excluded by the configuration. A command that fell
        // back to an ambient default — or to none — would compile the skeleton
        // note that directory exists to keep out.
        const out = run("lint");

        expect(out).not.toMatch(/Skeleton/);
    });

    /*
     * `content-format notes` was the last check reading the tree for itself
     * (#243). A report measuring the corpus against the declared vocabulary has
     * to be looking at the tree the compile will, or its counts describe a
     * corpus nobody builds.
     */
    it("`content-build content-format notes` measures the configured corpus", () => {
        const out = run("content-format", "notes");

        expect(out).not.toMatch(/requires `skipDirectories`/);
        // One note in scope, and the skipped directory's is not counted.
        expect(out).toMatch(/across 1 note\(s\)/);
        expect(out).not.toMatch(/Skeleton/);
    });
});

/*
 * Every check reads the content index now, so every one of them meets the note
 * the index cannot record — and none of them may be silenced by it (#243).
 */
describe("a note the content index cannot record", () => {
    let bad: string;

    beforeAll(() => {
        bad = path.join(root, "assets", "content", "Legacy.md");
        fs.writeFileSync(
            bad,
            "---\nname:\n  full: Legacy\ndescription: A legacy note.\n" +
                "id: legacyxxxxxxxxxx\nshortcode: legacy\ntype: miscgear\npackage: sohl\n" +
                "sohl:\n  archetype: 0\n  quality: 0\n  durability: 2\n  kbcat: cooking\n" +
                "  value: 6\n  weight: 3\n---\n\nProse.\n",
        );
    });
    afterAll(() => fs.rmSync(bad, { force: true }));

    it.each(["lint", "links", "content-format notes"])(
        "`content-build %s` reports it with a position and still reads the tree",
        (cmd) => {
            const out = run(...cmd.split(" "));

            // Located and correctly advised — `package:` is retired, not
            // renamed — rather than a bare abort.
            expect(out).toMatch(/Legacy\.md:\d+:\d+: error: `package: sohl` is a retired/);
            // And the rest of the tree was still read: the one good note is
            // counted. (Each command words its tally differently — "1 notes:"
            // from `links`, "across 1 note(s)" from the other two.)
            expect(out).toMatch(/\b1 note/);
        },
    );
});
