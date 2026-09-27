// SPDX-License-Identifier: GPL-3.0-or-later
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function markdownFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) return markdownFiles(absolute);
        return entry.isFile() && entry.name.endsWith(".md") ? [absolute] : [];
    });
}

describe("README documentation index", () => {
    it("links every Markdown document under docs", () => {
        const readme = readFileSync(path.join(root, "README.md"), "utf8");
        for (const absolute of markdownFiles(path.join(root, "docs"))) {
            const relative = path.relative(root, absolute).split(path.sep).join("/");
            expect(readme, `README.md should link ${relative}`).toContain(`](${relative})`);
        }
    });
});
