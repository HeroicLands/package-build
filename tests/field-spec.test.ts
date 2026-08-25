/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";

// Source is imported by relative path: this suite is self-contained and
// declares no alias tree (see `suite-is-self-contained.test.ts`).
import {
    AS_AUTHORED,
    BLANK_IS_DEFAULT,
    BLANK_IS_NULL,
    BOOLEAN,
    NULLABLE_COUNT,
    NULLABLE_NUMBER,
    NUMBER,
    STRING,
    authoredFields,
    buildFromFields,
    readField,
    setPath,
} from "../engine/field-spec.mjs";

describe("setPath — declaration order is emission order (#22)", () => {
    it("writes a leaf", () => {
        expect(setPath({}, "a", 1)).toEqual({ a: 1 });
    });

    it("creates the intermediate objects of a dotted path", () => {
        expect(setPath({}, "locations.flexible", ["torso"])).toEqual({
            locations: { flexible: ["torso"] },
        });
    });

    it("merges siblings into one intermediate rather than replacing it", () => {
        const out = {};
        setPath(out, "impactBase.die", 6);
        setPath(out, "impactBase.aspect", "piercing");
        expect(out).toEqual({ impactBase: { die: 6, aspect: "piercing" } });
    });

    it("emits keys in declaration order, which is the compiled JSON's order", () => {
        const fields = [
            { to: "second", value: 2, describe: "" },
            { to: "first", value: 1, describe: "" },
        ];
        expect(Object.keys(buildFromFields(fields)({}))).toEqual([
            "second",
            "first",
        ]);
    });
});

describe("readField — coercions carry their shape", () => {
    const read = (field: object, fm: object) =>
        readField(field as never, fm as never);

    it("takes the value as authored when no coercion is declared", () => {
        const field = { name: "weight", to: "w", ...AS_AUTHORED, default: 0 };
        expect(read(field, { sohl: { weight: "3.5" } })).toBe("3.5");
        expect(read(field, {})).toBe(0);
    });

    it("reads a nested key by its dotted name", () => {
        const field = { name: "impact.die", to: "d", ...NUMBER, default: 0 };
        expect(read(field, { sohl: { impact: { die: 6 } } })).toBe(6);
    });

    it("guards a number, and a non-numeric one reads zero", () => {
        const field = { name: "level", to: "l", ...NUMBER, default: 0 };
        expect(read(field, { sohl: { level: "4" } })).toBe(4);
        expect(read(field, { sohl: { level: "nope" } })).toBe(0);
    });

    it("distinguishes an unset nullable number from a blank one", () => {
        const field = {
            name: "mlb",
            to: "m",
            ...NULLABLE_NUMBER,
            default: null,
        };
        expect(read(field, {})).toBeNull();
        expect(read(field, { sohl: { mlb: "" } })).toBeNull();
        expect(read(field, { sohl: { mlb: 0 } })).toBe(0);
        expect(read(field, { sohl: { mlb: 30 } })).toBe(30);
    });

    it("guards a nullable count's value while keeping its absence", () => {
        const field = {
            name: "lvl",
            to: "l",
            ...NULLABLE_COUNT,
            default: null,
        };
        expect(read(field, {})).toBeNull();
        expect(read(field, { sohl: { lvl: "x" } })).toBe(0);
    });

    it("sends a blank to null, or to the default, as declared", () => {
        const toNull = { name: "f", to: "f", ...BLANK_IS_NULL, default: null };
        expect(read(toNull, { sohl: { f: "" } })).toBeNull();
        const toDefault = {
            name: "f",
            to: "f",
            ...BLANK_IS_DEFAULT,
            default: "cured",
        };
        expect(read(toDefault, { sohl: { f: "" } })).toBe("cured");
        expect(read(toDefault, { sohl: { f: "death" } })).toBe("death");
    });

    it("coerces a string and a boolean", () => {
        expect(
            read(
                { name: "s", to: "s", ...STRING, default: "" },
                { sohl: { s: 5 } },
            ),
        ).toBe("5");
        expect(
            read(
                { name: "b", to: "b", ...BOOLEAN, default: false },
                { sohl: { b: "yes" } },
            ),
        ).toBe(true);
    });

    it("derives a value that is not authored at all", () => {
        const field = {
            to: "numDice",
            value: (fm: any) => (fm.sohl.die ? 1 : 0),
        };
        expect(read(field, { sohl: { die: 6 } })).toBe(1);
        expect(read(field, { sohl: { die: 0 } })).toBe(0);
    });

    it("emits a constant with no frontmatter involvement", () => {
        expect(read({ to: "quantity", value: 1 }, {})).toBe(1);
    });
});

describe("authoredFields — the vocabulary, not the emitted block", () => {
    it("keeps only the fields an author can write", () => {
        const fields = [
            { to: "quantity", value: 1, describe: "" },
            { name: "weight", to: "weightBase", describe: "" },
            { to: "numDice", value: () => 0, describe: "" },
        ];
        expect(authoredFields(fields as never).map((f) => f.name)).toEqual([
            "weight",
        ]);
    });
});
