// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { parseHeaderArgs } from "../engine/code-fences.mjs";

describe("parseHeaderArgs", () => {
    it("reads a bare fence", () => {
        expect(parseHeaderArgs("sql")).toEqual({ language: "sql", args: {}, problems: [] });
    });

    it("reads braced attributes with explicit values", () => {
        expect(parseHeaderArgs("SQL {allow-empty=true section-level=3}")).toEqual({
            language: "sql",
            args: { "allow-empty": "true", "section-level": "3" },
            problems: [],
        });
    });

    it("allows quoted values containing spaces", () => {
        expect(parseHeaderArgs('sql {caption="Gear and armour"}').args.caption).toBe(
            "Gear and armour",
        );
    });

    it("rejects old header syntax and repeated attributes", () => {
        expect(parseHeaderArgs("sql :allow-empty").problems).toContain(
            "fence attributes need {key=value} syntax",
        );
        expect(parseHeaderArgs("sql {allow-empty=true allow-empty=false}").problems).toContain(
            "allow-empty is written twice",
        );
    });

    it("handles an empty info string", () => {
        expect(parseHeaderArgs("")).toEqual({ language: "", args: {}, problems: [] });
        expect(parseHeaderArgs(undefined as never)).toEqual({
            language: "",
            args: {},
            problems: [],
        });
    });
});
