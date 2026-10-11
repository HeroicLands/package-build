/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
// Build-time pack helper (plain ESM, no Foundry). Imported by relative path
// because the pack-build scripts live outside the `@src` alias tree.
import {
    resolveRelation,
    // eslint-disable-next-line
} from "../engine/helpers.mjs";

describe("resolveRelation (pack builder — affiliation standing map)", () => {
    it("returns an empty map when the affiliation authors no relations", () => {
        expect(resolveRelation({})).toEqual({});
        expect(resolveRelation({ sohl: {} })).toEqual({});
        expect(resolveRelation({ data: {} })).toEqual({});
    });

    it("reads an empty list as an empty map", () => {
        // A note may author `relations: []` to state no entries. It
        // means exactly what `relations: {}` means: neutral toward everyone.
        expect(resolveRelation({ data: { relations: [] } })).toEqual({});
        expect(resolveRelation({ data: { relations: {} } })).toEqual({});
    });

    it("passes an authored map through from `data:`", () => {
        expect(resolveRelation({ data: { relations: { peoni: "nemesis" } } })).toEqual({
            peoni: "nemesis",
        });
    });

    it("reads the destination ahead of `data:`", () => {
        expect(
            resolveRelation({
                sohl: { system: { relations: { peoni: "aligned" } } },
                data: { relations: { peoni: "nemesis" } },
            }),
        ).toEqual({ peoni: "aligned" });
    });

    it("accepts every declared standing", () => {
        expect(
            resolveRelation({
                data: {
                    relations: {
                        a: "aligned",
                        u: "unaligned",
                        r: "rival",
                        n: "nemesis",
                    },
                },
            }),
        ).toEqual({ a: "aligned", u: "unaligned", r: "rival", n: "nemesis" });
    });

    it("throws on an unknown standing rather than shipping it", () => {
        // Foundry would drop the invalid choice at load, quietly turning an
        // authored hostility into neutrality.
        expect(() =>
            resolveRelation({ data: { relations: { peoni: "hostile" } } }, "Agrik"),
        ).toThrow(/Agrik: relations\["peoni"\]/);
    });

    it("throws when the map is not a map", () => {
        // A *populated* list is still an error: it is not a map, and dropping
        // its entries is the silent data loss this resolver exists to prevent.
        expect(() => resolveRelation({ data: { relations: ["peoni"] } }, "Agrik")).toThrow(
            /map of shortcode/,
        );
        expect(() => resolveRelation({ data: { relations: "peoni" } }, "Agrik")).toThrow(
            /relations must be a map/,
        );
    });

    it("reads neither a singular `relation` nor the block's `relations`", () => {
        expect(resolveRelation({ data: { relation: { peoni: "nemesis" } } })).toEqual({});
        expect(resolveRelation({ sohl: { relations: { peoni: "nemesis" } } })).toEqual({});
    });
});
