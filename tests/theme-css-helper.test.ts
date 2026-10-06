/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { declares, lineOf, rules, styled } from "./helpers/theme-css.ts";

describe("theme CSS class guard", () => {
    it("does not accept a longer class sharing the requested prefix", () => {
        const css = ".content-figure-label-removed { color: red; }";
        const parsed = rules(css);
        expect(styled(parsed, "content-figure-label")).toBe(false);
        expect(declares(parsed, "content-figure-label", "color")).toBe(false);
        expect(lineOf(css, "content-figure-label")).toBe(0);
    });

    it("accepts a class followed by selector syntax", () => {
        const css = ".content-figure-label:hover, .other .content-figure-label { color: red; }";
        const parsed = rules(css);
        expect(styled(parsed, "content-figure-label")).toBe(true);
        expect(declares(parsed, "content-figure-label", "color")).toBe(true);
        expect(lineOf(css, "content-figure-label")).toBe(1);
    });
});
