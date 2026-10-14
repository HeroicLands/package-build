/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { prettierArgs } from "../ci/prettier.mjs";

const all = () => true;

describe("npm run format argument handling", () => {
    it("formats the whole tree when no path is given", () => {
        expect(prettierArgs(["--write"], all)).toEqual(["--write", "."]);
        expect(prettierArgs(["--check"], all)).toEqual(["--check", "."]);
    });

    it("formats only the given paths", () => {
        expect(prettierArgs(["--write", "a.mjs", "docs/b.md"], all)).toEqual([
            "--write",
            "a.mjs",
            "docs/b.md",
        ]);
    });

    it("skips a path that no longer exists, and runs nothing when none remain", () => {
        const exists = (entry: string) => entry === "kept.mjs";
        expect(prettierArgs(["--check", "gone.mjs", "kept.mjs"], exists)).toEqual([
            "--check",
            "kept.mjs",
        ]);
        expect(prettierArgs(["--check", "gone.mjs"], exists)).toBeNull();
    });

    it("refuses a missing or unknown mode", () => {
        expect(() => prettierArgs([], all)).toThrow(/--write or --check/);
        expect(() => prettierArgs(["a.mjs"], all)).toThrow(/--write or --check/);
    });

    it("is what the format scripts run", () => {
        const scripts = JSON.parse(
            readFileSync(path.resolve(__dirname, "../package.json"), "utf8"),
        ).scripts;
        expect(scripts.format).toBe("node ci/prettier.mjs --write");
        expect(scripts["format:check"]).toBe("node ci/prettier.mjs --check");
    });
});
