/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * `docs/authoring/links-and-markup.md` documents the two picture constructs
 * `glyph` and `cartouche` are written as, and documents no shortcode call.
 *
 * Each construct needs a heading naming it in code and a worked example in its
 * own syntax. No example anywhere in the page uses `{{<` or `{{%`, because the
 * lint refuses both.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOC = fs.readFileSync(path.join(ROOT, "docs/authoring/links-and-markup.md"), "utf8");

const SYNTAX: Record<string, RegExp> = {
    glyph: /\]\{\.glyph [^}]*slug=/,
    cartouche: /\]\{\.cartouche [^}]*slug=/,
};

describe("glyphs and cartouches are documented", () => {
    for (const [name, example] of Object.entries(SYNTAX)) {
        it(`${name} has a heading`, () => {
            expect(DOC, `no heading naming \`${name}\``).toMatch(
                new RegExp(`^#{2,4} .*\`${name}\``, "m"),
            );
        });

        it(`${name} has a worked example`, () => {
            expect(DOC, `no worked ${name} example`).toMatch(example);
        });
    }

    it("shows no shortcode call", () => {
        expect(DOC).not.toMatch(/\{\{[<%]/);
    });
});
