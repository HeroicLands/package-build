/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Five reads that resolve a value by hand, taught the destination position
 * (#126).
 *
 * Most fields reach their value through {@link resolveFieldValue}, which reads
 * `<block>.system.<to>` first and applies the field's coercion wherever the
 * value came from. Five did not, because each resolves a *shape* spread over
 * several keys rather than coercing a scalar, and so re-read the note through
 * `sohlField` — which cannot see inside `sohl.system`.
 *
 * That was equivalent while every note authored in the block. Once a note may
 * author at the destination instead, each of them read as unset and shipped its
 * empty value: `charges` became `{value: null, max: null}`, an affiliation's
 * relations became `{}`, a mystery's aptitudes vanished, `subType` threw, and a
 * projectile's derived `impactBase.numDice` fell to `0` while the die it was
 * derived from sat right there in the document.
 *
 * @module
 */

import { describe, it, expect } from "vitest";

import {
    resolveCharges,
    resolveRelation,
    requireSubType,
    sohlSystemField,
} from "../engine/frontmatter.mjs";
import { ITEM_BUILDERS } from "../sohl/item-builders.mjs";

describe("sohlSystemField", () => {
    it("prefers the destination, keeps reading the legacy position", () => {
        expect(sohlSystemField({ sohl: { system: { x: 1 }, x: 2 } }, "x")).toBe(1);
        expect(sohlSystemField({ sohl: { x: 2 } }, "x")).toBe(2);
        expect(sohlSystemField({ sohl: {} }, "x", "dflt")).toBe("dflt");
    });

    it("reads a dotted path at either position", () => {
        expect(sohlSystemField({ sohl: { system: { a: { b: 3 } } } }, "a.b")).toBe(3);
        expect(sohlSystemField({ sohl: { a: { b: 4 } } }, "a.b")).toBe(4);
    });
});

describe("the five hand-resolved reads see the destination (#126)", () => {
    it("charges", () => {
        expect(resolveCharges({ sohl: { system: { charges: { max: 5, value: 5 } } } })).toEqual({
            max: 5,
            value: 5,
        });
        // and still the legacy position
        expect(resolveCharges({ sohl: { charges: { max: 5, value: 5 } } })).toEqual({
            max: 5,
            value: 5,
        });
    });

    it("subType", () => {
        expect(requireSubType({ sohl: { system: { subType: "physical" } } })).toBe("physical");
        expect(requireSubType({ sohl: { subType: "physical" } })).toBe("physical");
    });

    it("an affiliation's relations", () => {
        expect(
            resolveRelation({ sohl: { system: { relations: { peoni: "nemesis" } } } }),
        ).toEqual({ peoni: "nemesis" });
    });

    it("a projectile's derived numDice, which reads the die it is derived from", () => {
        const build = (sohl: object) =>
            (ITEM_BUILDERS as any).projectile.system({ sohl: { subType: "arrow", ...sohl } });
        // Authored at the destination, under the *emitted* name.
        expect(build({ system: { impactBase: { die: 6, modifier: 6, aspect: "piercing" } } }))
            .toMatchObject({ impactBase: { numDice: 1, die: 6 } });
        // Authored at the legacy position, under the authored name.
        expect(build({ impact: { die: 6, modifier: 6, aspect: "piercing" } })).toMatchObject({
            impactBase: { numDice: 1, die: 6 },
        });
        // No die at either position is still no dice.
        expect(build({})).toMatchObject({ impactBase: { numDice: 0 } });
    });
});
