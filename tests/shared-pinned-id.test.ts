/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Two notes pinning one document `id`.
 *
 * A note's `data.id` is the `_id` its document is filed under, and an embedded
 * item's id derives from its owning actor's. Two beings pinning the same value
 * therefore denote one actor, and the finding names that shared id and both
 * files rather than reporting an item as a duplicate of itself.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Actors } from "../sohl/actors.mjs";

/** A being carrying one stand-alone embedded item, pinned to `id`. */
function being(shortcode: string, id: string): string {
    return `---
name:
  full: Being ${shortcode}
shortcode: ${shortcode}
type: being
data:
  id: ${id}
sohl:
  templatePriority: null
  items:
    - {type: miscgear, name: Sheets, system: {shortcode: parchment}}
---

# Appearance {#appearance}

A being.
`;
}

let tmp: string;
let compiler: any;
const lines: string[] = [];

beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-shared-id-"));
    const content = path.join(tmp, "content");
    const itemsDir = path.join(tmp, "items");
    fs.mkdirSync(content);
    fs.mkdirSync(itemsDir);
    fs.mkdirSync(path.join(tmp, "actors"));
    fs.writeFileSync(path.join(content, "First.md"), being("firstbeing", "AAAAAAAAAAAAAAAA"));
    fs.writeFileSync(path.join(content, "Second.md"), being("secondbeing", "AAAAAAAAAAAAAAAA"));
    fs.writeFileSync(path.join(content, "Third.md"), being("thirdbeing", "BBBBBBBBBBBBBBBB"));
    const spy = vi.spyOn(console, "error").mockImplementation((line) => {
        lines.push(String(line));
    });
    try {
        compiler = new Actors({
            skipDirectories: [],
            contentBase: content,
            dest: path.join(tmp, "actors"),
            itemsSourceDirs: [itemsDir],
        });
        await compiler.compile();
    } finally {
        spy.mockRestore();
    }
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("two beings pinning one id", () => {
    it("never report an embedded item as a duplicate of itself", () => {
        expect(lines.filter((l) => l.includes("already the identity"))).toEqual([]);
    });

    it("are refused once, at the second note, naming the first", () => {
        const found = lines.filter(
            (l) => l.includes("Second.md") && l.includes("AAAAAAAAAAAAAAAA"),
        );
        expect(found).toHaveLength(1);
        expect(found[0]).toMatch(/^[^\s]*Second\.md:\d+:\d+: error: /);
        expect(found[0]).toContain("First.md");
        expect(compiler.errorCount).toBe(1);
    });

    it("leave a being with its own id compiling", () => {
        expect(lines.some((l) => l.includes("Third.md"))).toBe(false);
    });
});
