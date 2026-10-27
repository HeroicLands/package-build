/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { romanTextProblems } from "../engine/roman-characters.mjs";
import { scanRuns } from "../engine/content-scripts.mjs";
const inventory = (extra = "") => ({ language: "demo", characters: new Set("ab😀" + extra) });
describe("standard Roman indentation", () => {
    it("allows adjacent indentation at a real or quoted verse line start", () => {
        for (const text of ["^a", "^^a", "a\n^a", "a\r\n^^a", "a/^a", "a/^^a", "^…a"])
            expect(romanTextProblems(text, inventory()), text).toEqual([]);
    });
    it("requires an inventory addition away from line start", () => {
        for (const text of ["a^", "a ^", " ^a", "a\r^a"]) {
            const problems = romanTextProblems(text, inventory());
            expect(problems, text).toEqual([
                expect.objectContaining({
                    offset: text.indexOf("^"),
                    message: expect.stringMatching(/line.start/),
                }),
            ]);
            expect(romanTextProblems(text, inventory("^")), text).toEqual([]);
        }
    });
    it("preserves UTF-16 source offsets after a supplementary character", () => {
        expect(romanTextProblems("😀^", inventory())).toEqual([
            expect.objectContaining({ offset: 2 }),
        ]);
    });
    it("checks a plain Roman language run even when it selects no encoding", () => {
        const ctx = {
            languages: { demo: { tag: "art-x-demo" } },
            romanInventories: new Map([["demo", inventory()]]),
            faces: new Map(),
            encodings: new Map(),
        };
        expect(scanRuns("[a^]{lang=demo}", ctx).errors).toEqual([
            expect.objectContaining({
                line: 1,
                column: 3,
                message: expect.stringMatching(/line.start/),
            }),
        ]);
        const numeric = { ...ctx, romanInventories: new Map([["demo", inventory("^")]]) };
        expect(scanRuns("[a^]{lang=demo}", numeric).errors).toEqual([]);
    });
});
