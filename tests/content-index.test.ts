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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    DERIVED_KEYS,
    sortKeysDeep,
    buildIndexRecord,
    collectContentIndex,
    serializeContentIndex,
    emitContentIndex,
} from "../engine/content-index.mjs";

let tmp: string;

/** Write a note with the given frontmatter, and a one-line body. */
function note(rel: string, frontmatter: string): void {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `---\n${frontmatter}\n---\n\nBody.\n`);
}

/** Read the emitted file back as parsed records. */
function readIndex(file: string): Array<Record<string, any>> {
    const text = fs.readFileSync(file, "utf8");
    return text
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => JSON.parse(l));
}

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "content-index-"));
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("sortKeysDeep", () => {
    it("orders an object's keys at every depth", () => {
        const sorted = sortKeysDeep({ b: 1, a: { d: 2, c: 3 } });
        expect(Object.keys(sorted as object)).toEqual(["a", "b"]);
        expect(Object.keys((sorted as any).a)).toEqual(["c", "d"]);
    });

    it("keeps array order, which is authored, but sorts objects inside", () => {
        const sorted = sortKeysDeep({ list: [{ z: 1, y: 2 }, "b", "a"] }) as any;
        expect(sorted.list[1]).toBe("b");
        expect(sorted.list[2]).toBe("a");
        expect(Object.keys(sorted.list[0])).toEqual(["y", "z"]);
    });

    it("passes non-plain objects through rather than rebuilding them", () => {
        const date = new Date(0);
        expect(sortKeysDeep({ when: date } as any)).toMatchObject({ when: date });
    });

    it("leaves primitives and null alone", () => {
        expect(sortKeysDeep(null)).toBeNull();
        expect(sortKeysDeep(4)).toBe(4);
        expect(sortKeysDeep("x")).toBe("x");
    });
});

describe("buildIndexRecord", () => {
    it("carries the whole frontmatter through unflattened", () => {
        const record = buildIndexRecord({
            frontmatter: { type: "being", sohl: { body: { weight: { base: 1500 } } } },
            relPath: path.join("Bestiary", "Animal", "Aurochs.md"),
            contentPackage: "sohl",
        });
        expect(record.type).toBe("being");
        // The nested path survives as written — a reader addresses what the
        // note says, which is what a dataview query writes.
        expect(record.sohl.body.weight.base).toBe(1500);
    });

    it("namespaces the note's place in the tree under `file`", () => {
        const record = buildIndexRecord({
            frontmatter: { type: "being" },
            relPath: path.join("Bestiary", "Animal", "Aurochs.md"),
            contentPackage: "sohl",
        });
        expect(record.file).toEqual({
            path: "Bestiary/Animal/Aurochs.md",
            folder: "Bestiary/Animal",
            name: "Aurochs",
        });
    });

    it("states an empty folder for a note at the tree root", () => {
        const record = buildIndexRecord({
            frontmatter: { type: "doc" },
            relPath: "README.md",
            contentPackage: "sohl",
        });
        expect(record.file.folder).toBe("");
        expect(record.file.path).toBe("README.md");
    });

    it("stamps the configured package, matching what the expander reads", () => {
        const record = buildIndexRecord({
            frontmatter: { type: "being" },
            relPath: "A.md",
            contentPackage: "thalorna",
        });
        expect(record.package).toBe("thalorna");
    });

    it("does not confuse a note's own `folder` field with its location", () => {
        // `folder` is real frontmatter on most notes, which is exactly why the
        // location lives under `file` instead of beside it.
        const record = buildIndexRecord({
            frontmatter: { type: "being", folder: "Beasts" },
            relPath: path.join("Bestiary", "Aurochs.md"),
            contentPackage: "sohl",
        });
        expect(record.folder).toBe("Beasts");
        expect(record.file.folder).toBe("Bestiary");
    });

    it.each(DERIVED_KEYS)("refuses a note that authors the derived `%s` key", (key) => {
        expect(() =>
            buildIndexRecord({
                frontmatter: { type: "being", [key]: "whatever" },
                relPath: "A.md",
                contentPackage: "sohl",
            }),
        ).toThrow(new RegExp(`\`${key}:\` is derived`));
    });

    it("sorts every key, so a record serializes identically however authored", () => {
        const a = buildIndexRecord({
            frontmatter: { type: "being", id: "x", sohl: { b: 1, a: 2 } },
            relPath: "A.md",
            contentPackage: "sohl",
        });
        const b = buildIndexRecord({
            frontmatter: { sohl: { a: 2, b: 1 }, id: "x", type: "being" },
            relPath: "A.md",
            contentPackage: "sohl",
        });
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
});

describe("collectContentIndex", () => {
    it("orders records by content path, not by directory-read order", () => {
        note("Zebra.md", "type: being\nid: z\nshortcode: zebra");
        note(path.join("Alpha", "Ant.md"), "type: being\nid: a\nshortcode: ant");
        note("Mule.md", "type: being\nid: m\nshortcode: mule");

        const records = collectContentIndex(tmp, { contentPackage: "sohl" });
        expect(records.map((r) => r.file.path)).toEqual(["Alpha/Ant.md", "Mule.md", "Zebra.md"]);
    });

    it("skips the directories the configuration names", () => {
        note("Keep.md", "type: being\nid: k\nshortcode: keep");
        note(path.join("Templates", "Skip.md"), "type: being\nid: s\nshortcode: skip");

        const records = collectContentIndex(tmp, {
            contentPackage: "sohl",
            skipDirectories: ["Templates"],
        });
        expect(records.map((r) => r.file.name)).toEqual(["Keep"]);
    });

    it("returns nothing for a tree that does not exist", () => {
        const records = collectContentIndex(path.join(tmp, "absent"), {
            contentPackage: "sohl",
            skipDirectories: [],
        });
        expect(records).toEqual([]);
    });
});

describe("serializeContentIndex", () => {
    it("writes one compact JSON object per line, newline-terminated", () => {
        const text = serializeContentIndex([{ a: 1 } as any, { b: 2 } as any]);
        expect(text).toBe('{"a":1}\n{"b":2}\n');
    });

    it("serializes an empty set as the empty string, not a lone newline", () => {
        expect(serializeContentIndex([])).toBe("");
    });
});

describe("emitContentIndex", () => {
    const config = (root: string) => ({
        paths: { content: root, contentIndex: path.join(root, "..", "out") },
        contentPackage: "sohl",
        skipDirectories: [],
    });

    it("writes <package>.jsonl and reports what it holds", () => {
        note("Aurochs.md", "type: being\nid: a1\nshortcode: aurochs");
        note("Baboon.md", "type: being\nid: b1\nshortcode: baboon");

        const result = emitContentIndex({ config: config(tmp) as any });

        expect(path.basename(result.file)).toBe("sohl.jsonl");
        expect(result.notes).toBe(2);
        expect(result.bytes).toBeGreaterThan(0);
        expect(readIndex(result.file).map((r) => r.shortcode)).toEqual(["aurochs", "baboon"]);
    });

    it("is byte-stable across runs over an unchanged tree", () => {
        note("Aurochs.md", "type: being\nid: a1\nshortcode: aurochs");
        note(path.join("Deep", "Nested", "Boar.md"), "type: being\nid: b1\nshortcode: boar");

        const first = emitContentIndex({ config: config(tmp) as any });
        const before = fs.readFileSync(first.file, "utf8");
        const second = emitContentIndex({ config: config(tmp) as any });
        const after = fs.readFileSync(second.file, "utf8");

        // Rebuilding is the expected way to use this, so a regeneration that
        // reordered lines would make every rebuild look like a change.
        expect(after).toBe(before);
    });

    it("honours an explicit tree and output directory", () => {
        note(path.join("tree", "A.md"), "type: being\nid: a\nshortcode: a");
        const out = path.join(tmp, "elsewhere");

        const result = emitContentIndex({
            contentBase: path.join(tmp, "tree"),
            outDir: out,
            config: config(tmp) as any,
        });

        expect(result.file).toBe(path.join(out, "sohl.jsonl"));
        expect(fs.existsSync(result.file)).toBe(true);
    });

    it("refuses a content tree that is not there", () => {
        expect(() =>
            emitContentIndex({
                contentBase: path.join(tmp, "absent"),
                config: config(tmp) as any,
            }),
        ).toThrow(/no content tree at/);
    });

    it("refuses to state that a package has no content", () => {
        // An empty index and a mis-pointed tree are indistinguishable to a
        // reader, who takes the file as authoritative.
        fs.mkdirSync(path.join(tmp, "empty"), { recursive: true });
        expect(() =>
            emitContentIndex({
                contentBase: path.join(tmp, "empty"),
                config: config(tmp) as any,
            }),
        ).toThrow(/yielded no notes/);
    });
});
