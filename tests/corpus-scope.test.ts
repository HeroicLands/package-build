/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * One answer to "which files are the corpus?" (#243).
 *
 * `walkMarkdownTree` used to default its scope to
 * `loadPackConfig().skipDirectories` — whichever configuration resolved from the
 * working directory, not the one its caller was working under. Six of its twelve
 * callers were on that default, so two passes over one tree could disagree about
 * which files they were reading, and in an ordinary build nothing showed.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { walkMarkdownTree, collectContentDocs } from "../engine/helpers.mjs";
import { BasePackCompiler } from "../engine/base-compiler.mjs";

let root: string;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-scope-"));
    const note = (rel: string, code: string) => {
        const full = path.join(root, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(
            full,
            `---\ntype: skill\nid: ${code.padEnd(16, "x")}\nshortcode: ${code}\nname:\n  full: ${code}\n---\n\nBody.\n`,
        );
    };
    note("Skills/Climbing.md", "clmb");
    note("Templates/Skill.md", "tmpl");
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** The note paths a walk yields, relative and POSIX-separated. */
function walked(opts: any): string[] {
    return [...walkMarkdownTree(root, opts)]
        .map((n: any) => path.relative(root, n.absPath).split(path.sep).join("/"))
        .sort();
}

describe("the walk's scope is the caller's to state", () => {
    it("refuses a walk that names no scope", () => {
        // Not a default, because a default is where the two answers came from.
        expect(() => [...walkMarkdownTree(root)]).toThrow(/requires `skipDirectories`/);
        expect(() => [...walkMarkdownTree(root, {})]).toThrow(/requires `skipDirectories`/);
    });

    it("honours the scope it is given", () => {
        expect(walked({ skipDirectories: [] })).toEqual([
            "Skills/Climbing.md",
            "Templates/Skill.md",
        ]);
        expect(walked({ skipDirectories: ["Templates"] })).toEqual(["Skills/Climbing.md"]);
    });

    it("takes the caller's answer, whatever the ambient configuration says", () => {
        // The point of the change: this repository's own configuration names no
        // skipped directory, and a caller that names one is still obeyed — and
        // the reverse, which is the case that used to silently compile a
        // template note in a tree configured to skip them.
        expect(walked({ skipDirectories: ["Templates"] })).not.toContain("Templates/Skill.md");
        expect(walked({ skipDirectories: [] })).toContain("Templates/Skill.md");
    });

    it("passes it on to the table corpus, which had its own default", () => {
        expect(
            collectContentDocs(root, { skipDirectories: ["Templates"] }).map((d) => d.path),
        ).toEqual(["Skills/Climbing.md"]);
        expect(() => collectContentDocs(root)).toThrow(/requires `skipDirectories`/);
    });
});

describe("a compile pass states it too", () => {
    class Probe extends BasePackCompiler {
        static label = "probe";
        buildEntry() {
            return null;
        }
    }

    it("refuses to be built without one", () => {
        // A pass that omitted it would walk whatever the working directory's
        // configuration said — including, in a tree that skips `Templates`, the
        // template notes it exists to keep out of the packs.
        expect(() => new Probe({ contentBase: root, dest: root })).toThrow(
            /requires `skipDirectories`/,
        );
    });

    it("is built with one, and holds it", () => {
        const pass = new Probe({ contentBase: root, dest: root, skipDirectories: ["Templates"] });

        expect(pass.skipDirectories).toEqual(["Templates"]);
    });
});
