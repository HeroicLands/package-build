/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Everything the CLI imports has to be in `files`, or the command ships broken.
 *
 * `package.json` `files` is an explicit whitelist, so a **new root module is
 * invisible to the published package unless someone remembers to list it** —
 * and nothing here reads that list, so forgetting is silent. Every local check
 * passes, because locally the file is simply there.
 *
 * 17.1.0 shipped exactly that way: `labels.mjs` was added and not whitelisted,
 * so `package-build labels check` resolved to nothing and every consumer got
 * `ERR_MODULE_NOT_FOUND` on a command the release notes announced. The failure
 * surfaces only in a consumer, after publish, which is the worst place for it.
 *
 * This reads the imports out of `bin/` and requires each one's root module to
 * be covered — by name, or by a directory entry that contains it. It is a
 * cheaper guard than packing the tarball, and it fails on the commit that adds
 * the module rather than on the release that omits it.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const FILES: string[] = pkg.files ?? [];

/** Root-relative specifiers a `bin/` entry point imports (`../thing.mjs`). */
function rootImports(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const entry of readdirSync(path.join(ROOT, "bin"))) {
        if (!entry.endsWith(".mjs")) continue;
        const text = readFileSync(path.join(ROOT, "bin", entry), "utf8");
        for (const m of text.matchAll(/from\s+"\.\.\/([^"]+)"/g)) {
            const target = m[1];
            if (!out.has(target)) out.set(target, []);
            out.get(target)!.push(entry);
        }
    }
    return out;
}

/** Whether `files` publishes a path, by exact name or by a containing directory. */
function published(target: string): boolean {
    if (FILES.includes(target)) return true;
    const [head] = target.split("/");
    return FILES.includes(head);
}

describe("the published package carries what its CLI imports", () => {
    it("finds the imports to check, so the guard cannot pass vacuously", () => {
        const imports = rootImports();
        expect(imports.size).toBeGreaterThan(5);
        expect([...imports.keys()]).toContain("labels.mjs");
    });

    it("publishes every root module a `bin/` entry point imports", () => {
        const missing: Record<string, string[]> = {};
        for (const [target, importers] of rootImports()) {
            if (!published(target)) missing[target] = importers;
        }
        // Each key is a module that resolves locally and is absent from the
        // tarball — the command that imports it throws ERR_MODULE_NOT_FOUND on
        // a consumer's machine and nowhere else.
        expect(missing).toEqual({});
    });
});
