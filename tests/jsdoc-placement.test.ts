/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A JSDoc block documents the symbol **directly below it**, or it documents
 * nothing.
 *
 * `npm run build:types` generates the published `.d.mts` from these blocks, so
 * a block that has drifted off its symbol ships a wrong type while the source
 * still reads as documented at a glance — the expensive kind of wrong, because
 * nothing looks amiss in either place.
 *
 * Two shapes are checked, and both are decidable from the parse rather than
 * from the prose:
 *
 * - **An export with no block at all.** A symbol other repositories import and
 *   nothing says what it takes or returns.
 * - **A block a second block follows.** One symbol, two blocks above it: the
 *   first documents whatever used to sit between them. This is how a block
 *   comes adrift — a declaration moves or is removed and its block stays — and
 *   it is what the whole class looks like from the parse.
 *
 * A block declaring a `@typedef`, `@callback`, `@enum` or the module itself
 * documents no following symbol by design, and neither does a file's opening
 * block, so neither is a finding.
 *
 * What is deliberately **not** checked is whether a block's `@param` names
 * match the parameters: a destructured options object is documented under
 * whatever name the block gives it, sometimes as an inline object type and
 * sometimes property by property, and every spelling is legitimate. A rule over
 * that reports honest blocks by the dozen, which is a worse outcome than the
 * defect it looks for.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as acorn from "acorn";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The shipped module tree: every directory whose `.mjs` files are published. */
const SOURCE_DIRS = ["", "bin", "ci", "engine", "hm3", "sohl"];

/** Blocks that document no following symbol by design. */
const STANDALONE_TAG = /@(typedef|callback|module|file|fileoverview|license|enum|interface)\b/;

/** Every shipped `.mjs`, root-relative. */
function sourceFiles(): string[] {
    return SOURCE_DIRS.flatMap((dir) =>
        fs
            .readdirSync(path.join(ROOT, dir))
            .filter((name) => name.endsWith(".mjs"))
            .map((name) => (dir ? `${dir}/${name}` : name)),
    ).sort();
}

type Comment = { value: string; start: number; end: number };

/** One file, parsed: its JSDoc blocks and the top-level exports they document. */
function read(rel: string): {
    source: string;
    blocks: Comment[];
    exports: { name: string; start: number }[];
} {
    const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const comments: acorn.Comment[] = [];
    const ast = acorn.parse(source, {
        ecmaVersion: "latest",
        sourceType: "module",
        onComment: comments,
    });
    const blocks = comments.filter(
        (c) => c.type === "Block" && c.value.startsWith("*"),
    ) as Comment[];

    const exports: { name: string; start: number }[] = [];
    for (const node of ast.body as any[]) {
        if (node.type !== "ExportNamedDeclaration" || !node.declaration) continue;
        const declared = node.declaration;
        if (declared.type === "FunctionDeclaration" || declared.type === "ClassDeclaration") {
            exports.push({ name: declared.id.name, start: node.start });
        } else if (declared.type === "VariableDeclaration") {
            for (const one of declared.declarations) {
                if (one.id.type === "Identifier")
                    exports.push({ name: one.id.name, start: node.start });
            }
        }
    }
    return { source, blocks, exports };
}

/** `file:line:` for a position, the way every diagnostic here names one. */
function at(rel: string, source: string, pos: number): string {
    return `${rel}:${source.slice(0, pos).split("\n").length}:`;
}

const files = sourceFiles();

describe("a JSDoc block documents the symbol below it", () => {
    it("finds the shipped modules, so the guard cannot pass vacuously", () => {
        expect(files.length).toBeGreaterThan(50);
        expect(files).toContain("release.mjs");
        expect(files).toContain("engine/note-vocabulary.mjs");
    });

    it("gives every exported symbol a block of its own", () => {
        const undocumented: string[] = [];
        for (const rel of files) {
            const { source, blocks, exports } = read(rel);
            for (const symbol of exports) {
                const above = blocks.filter(
                    (b) => b.end <= symbol.start && /^\s*$/.test(source.slice(b.end, symbol.start)),
                );
                if (!above.length) {
                    undocumented.push(`${at(rel, source, symbol.start)} ${symbol.name}`);
                }
            }
        }
        expect(undocumented).toEqual([]);
    });

    it("leaves no block stranded above another block", () => {
        const stranded: string[] = [];
        for (const rel of files) {
            const { source, blocks } = read(rel);
            for (let i = 0; i < blocks.length - 1; i++) {
                // A file's opening block describes the file, not a symbol.
                if (i === 0) continue;
                if (STANDALONE_TAG.test(blocks[i].value)) continue;
                if (!/^\s*$/.test(source.slice(blocks[i].end, blocks[i + 1].start))) continue;
                stranded.push(at(rel, source, blocks[i].start));
            }
        }
        expect(stranded).toEqual([]);
    });
});
