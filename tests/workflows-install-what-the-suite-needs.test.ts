/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Every workflow that runs the suite installs the binaries the suite refuses
 * to run without.
 *
 * Most binary-dependent cases here probe and stand down — a tree with no Typst
 * compiles no book and says nothing. The render cases are the exception:
 * `tests/hugo-available.test.ts` fails outright when `CI` is set and no Hugo
 * answers, because a runner that skips every render case reports a green suite
 * having rendered nothing.
 *
 * That makes Hugo a precondition of `npm test` under CI rather than a
 * nicety, and a workflow that runs the suite without it fails at that step.
 * Both halves of the gate run the suite — the pull-request build and the
 * publish job — so both need the install, and the publish job failing means no
 * release reaches the registry at all.
 *
 * The check is derived from the workflow files rather than from a list of
 * their names, so a third workflow that runs the suite is held to the same
 * rule the day it is added.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOWS = path.join(ROOT, ".github", "workflows");

/** Every workflow file, by its name. */
function workflows(): Map<string, string> {
    const found = new Map<string, string>();
    for (const entry of fs.readdirSync(WORKFLOWS)) {
        if (entry.endsWith(".yml") || entry.endsWith(".yaml")) {
            found.set(entry, fs.readFileSync(path.join(WORKFLOWS, entry), "utf8"));
        }
    }
    return found;
}

/** Whether a workflow runs the whole suite. */
function runsTheSuite(source: string): boolean {
    return /^\s*(?:-\s*)?run:\s*npm test\s*$/m.test(source);
}

/** Whether a workflow puts a Hugo on the PATH before running anything. */
function installsHugo(source: string): boolean {
    return /hugo_extended_/.test(source) && /hugo version/.test(source);
}

describe("the workflows that run the suite", () => {
    const files = workflows();

    it("are found at all, so the cases below are not vacuous", () => {
        expect(files.size).toBeGreaterThan(0);
        expect([...files.values()].filter(runsTheSuite).length).toBeGreaterThan(0);
    });

    it("install the Hugo the render cases refuse to run without", () => {
        for (const [name, source] of files) {
            if (!runsTheSuite(source)) continue;
            expect(
                installsHugo(source),
                `${name} runs \`npm test\` and installs no Hugo, so the suite fails there`,
            ).toBe(true);
        }
    });

    it("pin one Hugo across every workflow that installs it", () => {
        const pinned = new Set<string>();
        for (const source of files.values()) {
            for (const m of source.matchAll(/\bver=(\d+\.\d+\.\d+)/g)) {
                if (installsHugo(source)) pinned.add(m[1]);
            }
        }
        // Two runners disagreeing about which Hugo rendered a page is the
        // failure this prevents; one pin, or none to pin.
        expect(pinned.size).toBeLessThanOrEqual(1);
    });
});
