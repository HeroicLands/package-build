/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { parseExtensionAttributes, booleanAttribute } from "../engine/extension-attributes.mjs";

describe("extension attributes", () => {
    it("reads one grammar for ids, classes, bare values, and quoted values", () => {
        expect(
            parseExtensionAttributes(
                '#trade .full-width float=top-left title="Regional trade routes"',
            ),
        ).toEqual({
            id: "trade",
            classes: ["full-width"],
            values: { float: "top-left", title: "Regional trade routes" },
            problems: [],
        });
    });

    it("rejects former punctuation and duplicate keys", () => {
        expect(parseExtensionAttributes("float: top-left, size: medium").problems).not.toEqual([]);
        expect(parseExtensionAttributes("float=left float=right").problems).not.toEqual([]);
    });

    it("requires literal Boolean values", () => {
        expect(booleanAttribute("true", "allow-empty")).toBe(true);
        expect(booleanAttribute("false", "allow-empty")).toBe(false);
        expect(() => booleanAttribute("True", "allow-empty")).toThrow(/true.*false/);
        expect(() => booleanAttribute(undefined, "allow-empty")).toThrow(/true.*false/);
    });
});
