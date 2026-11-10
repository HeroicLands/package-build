/* SPDX-License-Identifier: GPL-3.0-or-later */

import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { encodingsFromRecords } from "../engine/encoding-notes.mjs";
import { resolveScriptFonts } from "../engine/script-fonts.mjs";

it("compiles an encoding using the installed font's published glyph codes", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const fonts = resolveScriptFonts(root);
    expect(fonts).toBeDefined();
    const result = encodingsFromRecords(
        [
            {
                type: "doc",
                shortcode: "testenc",
                package: "demo",
                file: { path: "Test.md" },
                data: {
                    language: "test",
                    font: "semaron-kuriale",
                    mappings: { a: "ANKRON_MIN" },
                    rules: { normalization: "NFC", matching: "longest-first", roundTrip: "none" },
                },
            },
        ],
        { contentPackage: "demo", languages: { test: { tag: "art-x-test" } } },
        fonts,
    );
    expect(result.findings).toEqual([]);
    expect(result.encodings.get("testenc")).toBeDefined();
});
