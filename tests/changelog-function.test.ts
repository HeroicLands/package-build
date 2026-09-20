/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `@heroiclands/package-build/changelog` writes a changeset's summary as a
 * block, verbatim — no commit-hash prefix, which every built-in Changesets
 * generator adds whenever a commit is known, and no `- ` bullet or
 * indentation, so a summary that opens with a paragraph, a bold label, or
 * its own bullet list lands in `CHANGELOG.md` exactly as written.
 */

import { describe, it, expect } from "vitest";

import { getReleaseLine, getDependencyReleaseLine } from "../changelog.cjs";

describe("getReleaseLine", () => {
    it("writes the summary with no commit-hash prefix and no bullet", async () => {
        const line = await getReleaseLine(
            { summary: "**Compendiums** — x", commit: "abc1234" },
            "patch",
            null,
        );
        expect(line).toBe("\n**Compendiums** — x\n");
    });

    it("writes a single-line summary as one line, with no bullet", async () => {
        const line = await getReleaseLine(
            { summary: "A patch note.", commit: undefined },
            "patch",
            null,
        );
        expect(line).toBe("\nA patch note.\n");
    });

    it("passes a multi-line summary through byte-identical, with a surrounding blank line", async () => {
        const summary = [
            "**Compendiums** — x",
            "",
            "More detail on the second paragraph.",
            "- and a bullet of its own",
        ].join("\n");
        const line = await getReleaseLine({ summary, commit: "abc1234" }, "minor", null);
        expect(line).toBe(`\n${summary}\n`);
    });
});

describe("getDependencyReleaseLine", () => {
    it("writes nothing", async () => {
        const line = await getDependencyReleaseLine([], [], null);
        expect(line).toBe("");
    });

    it("writes nothing even when dependencies updated", async () => {
        const line = await getDependencyReleaseLine(
            [{ summary: "x", commit: "abc1234", id: "x", releases: [] }],
            [
                {
                    packageJson: { name: "@heroiclands/package-build", version: "1.0.0" },
                    dir: "/tmp/x",
                    name: "@heroiclands/package-build",
                    type: "patch",
                    oldVersion: "0.9.0",
                    newVersion: "1.0.0",
                    changesets: ["x"],
                },
            ],
            null,
        );
        expect(line).toBe("");
    });
});
