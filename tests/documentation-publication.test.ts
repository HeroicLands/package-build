// SPDX-License-Identifier: GPL-3.0-or-later

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docs = path.join(root, "docs");

function markdownFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(directory, entry.name);
        return (
            entry.isDirectory() ? markdownFiles(full)
            : entry.isFile() && entry.name.endsWith(".md") ? [full]
            : []
        );
    });
}

describe("package documentation", () => {
    it("keeps this repository's documentation in Markdown", () => {
        const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
        // The theme ships inside this package, so `hugo-theme/` is shipped
        // rather than installed. `tests/theme-render.test.ts` renders a page
        // through it and crosses the contract the two halves hold.
        expect(pkg.files).toContain("hugo-theme");
        expect(
            Object.keys(pkg.scripts).filter((name) => /^(?:build|serve):site/.test(name)),
        ).toEqual([]);
        expect(Object.keys(pkg.scripts).filter((name) => /^build:book/.test(name))).toEqual([]);
        expect(pkg.scripts).not.toHaveProperty("build:content-index");
        expect(existsSync(path.join(root, "package-build.config.yaml"))).toBe(false);
        expect(existsSync(path.join(root, "book.yaml"))).toBe(false);
    });

    it("keeps the documentation home and guides in Markdown", () => {
        expect(existsSync(path.join(docs, "index.md"))).toBe(true);
        expect(markdownFiles(docs).length).toBeGreaterThan(1);
    });

    it("keeps every local Markdown link inside the guide tree", () => {
        for (const file of markdownFiles(docs)) {
            const body = readFileSync(file, "utf8");
            for (const match of body.matchAll(/\[[^\]\n]+\]\(([^\s)]+\.md)(?:#[^\s)]*)?\)/g)) {
                const target = path.resolve(path.dirname(file), match[1]);
                expect(target.startsWith(`${docs}${path.sep}`), file).toBe(true);
                expect(existsSync(target), target).toBe(true);
            }
        }
    });
});
