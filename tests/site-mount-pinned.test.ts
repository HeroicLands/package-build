/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The mount a site build writes.
 *
 * A page of documentation is a note in the content tree, and the site build
 * publishes the homepage and the content tree and nothing else. The mount is
 * pinned by digest so that a change to what a consumer's site holds is a
 * deliberate one.
 */

import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "../index.mjs";
import { buildSite, gatesFailed } from "../engine/site-build.mjs";

/**
 * The digest of the mount this fixture publishes. It pins the whole emitted
 * tree — every path and every byte — so a change to the site build that
 * touches what a configuration emits is a red test here rather than a
 * surprise on a consumer's site. A change to the digest is a change to every
 * consumer's published pages, and is made deliberately.
 *
 * Four files: the homepage's `_index.md` at the root, and one page per note
 * flat under the `kb/` mount. Nothing else — no `_index.md` below the root.
 */
const MOUNT_DIGEST = "0148a7c876c763ac5ede6a2017867f7eb405e62ede3f29ff51d398b605396257";
const MOUNT_FILES = 4;

/** Every file below `dir`, as `path\0sha256`, sorted. */
function digestTree(dir: string): { digest: string; files: number } {
    const lines: string[] = [];
    const walk = (d: string) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) walk(full);
            else {
                const rel = path.relative(dir, full).split(path.sep).join("/");
                const sum = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
                lines.push(`${rel}\0${sum}`);
            }
        }
    };
    walk(dir);
    lines.sort();
    return {
        digest: crypto.createHash("sha256").update(lines.join("\n")).digest("hex"),
        files: lines.length,
    };
}

describe("the mount a site build writes is pinned", () => {
    it("emits the pinned mount: the homepage's `_index.md` and one page per note", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-notrees-"));
        const write = (rel: string, text: string) => {
            const file = path.join(root, rel);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, text);
        };
        const note = (rel: string, fm: string, body = "Prose.\n") =>
            write(path.join("assets/content", rel), `---\n${fm.trim()}\n---\n\n${body}`);
        try {
            fs.writeFileSync(
                path.join(root, "package.json"),
                JSON.stringify({ name: "sandbox", version: "1.0.0" }),
            );
            fs.mkdirSync(path.join(root, "build/cache/metadata"), { recursive: true });
            note(
                "homepage.md",
                "type: homepage\nshortcode: root",
                "The module, in its own words.\n",
            );
            note(
                "Gear/Dagger.md",
                "type: weapongear\nshortcode: dagger\nid: aaaaaaaaaaaaaaaa\nname:\n    full: Dagger",
                "A blade. See [[doc-combat|the rules]].\n",
            );
            note(
                "Rules/Combat.md",
                "type: doc\nsubType: rules\nshortcode: combat\nname:\n    full: Combat",
                "## Striking {#striking}\n\nHit things. See [[weapongear-dagger|]] and [[doc-combat#striking|here]].\n",
            );
            note(
                "Rules/README.md",
                "type: doc\nsubType: rules\nshortcode: rulesidx\nname:\n    full: The Rules",
            );
            const config = defineConfig({
                rootDir: root,
                contentPackage: "demo",
                foundryPackage: "demo",
                packageKind: "modules",
                compatibility: { minimum: "14.359" },
                stats: { lastModifiedBy: "demobuilder0000" },
                packs: [
                    { name: "items", type: "Item" },
                    { name: "journals", type: "JournalEntry" },
                ],
                publish: { address: { prefix: "kb/" } },
            });
            const result = buildSite({ config });
            expect(gatesFailed(result.gates)).toBe(false);
            expect(result.wikiErrors).toEqual([]);
            expect(digestTree(path.join(root, "build/hugo/content"))).toEqual({
                digest: MOUNT_DIGEST,
                files: MOUNT_FILES,
            });
            expect(fs.existsSync(path.join(root, "build/hugo/content/_index.md"))).toBe(true);
            expect(fs.existsSync(path.join(root, "build/hugo/content/kb/_index.md"))).toBe(false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
