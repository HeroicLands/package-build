/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The toolchain renders sites with its own engine and mentions no other site
 * generator. The shipped tree, the tests and the documentation carry no
 * reference to one; only the changelog and the changesets, which record what
 * changed between releases, may name it.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NAME = new RegExp(["hu", "go"].join(""), "i");
const ALLOWED = [/^CHANGELOG\.md$/, /^\.changeset\//];
const BINARY = /\.(png|jpe?g|gif|webp|woff2?|ttf|br|gz|zip|pdf|ico)$/i;

/** Every tracked or untracked-but-not-ignored file, relative to the root. */
function treeFiles(): string[] {
    const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 1 << 28,
    });
    return out.split("\n").filter(Boolean);
}

describe("no reference to another site generator", () => {
    it("is absent from every file outside the changelog and changesets", () => {
        const hits: string[] = [];
        for (const rel of treeFiles()) {
            if (ALLOWED.some((re) => re.test(rel))) continue;
            if (NAME.test(rel)) hits.push(`${rel} (path)`);
            if (BINARY.test(rel)) continue;
            const file = path.join(ROOT, rel);
            if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
            const lines = fs.readFileSync(file, "utf8").split("\n");
            lines.forEach((line, i) => {
                if (NAME.test(line)) hits.push(`${rel}:${i + 1}`);
            });
        }
        expect(hits, `${hits.length} reference(s)`).toEqual([]);
    });
});
