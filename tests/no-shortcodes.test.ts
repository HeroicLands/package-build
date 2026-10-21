/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * No content tree this repository carries holds a shortcode.
 *
 * Every markdown file under `tests/fixtures/` is read, and `{{<` or `{{%`
 * outside code is a failure at the file, line and column. `package-build lint`
 * reports the same finding to a consumer.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { markupFindings } from "../engine/markup-validation.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(ROOT, "tests/fixtures");

/** Every markdown file below a directory. */
function markdownFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return markdownFiles(full);
        return entry.name.endsWith(".md") ? [full] : [];
    });
}

describe("fixture content trees", () => {
    const files = markdownFiles(FIXTURES);

    it("finds the fixtures", () => {
        expect(files.length).toBeGreaterThan(0);
    });

    it("hold no shortcode", () => {
        const found = files.flatMap((file) =>
            markupFindings(fs.readFileSync(file, "utf8"), path.relative(ROOT, file))
                .filter((finding) => finding.message.startsWith("A shortcode is not"))
                .map(({ file, line, column }) => `${file}:${line}:${column}`),
        );
        expect(found).toEqual([]);
    });

    it("would fail on a shortcode", () => {
        const found = markupFindings('Text {{< glyph slug="ra" >}}\n', "a.md");
        expect(found.map(({ line, column }) => ({ line, column }))).toContainEqual({
            line: 1,
            column: 6,
        });
    });
});
