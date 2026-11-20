/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { proposeUrbanSupply } from "../engine/settlement-urban.mjs";

function fixture() {
    const cells = [
        { id: 1, burg: { i: 11 }, burgCultureAddress: "lore-town", urbanPopulation: 50 },
        { id: 2, burg: { i: 12 }, burgCultureAddress: "lore-town", urbanPopulation: 50 },
    ];
    const cities = [
        {
            identity: "place-a",
            cellId: 1,
            source: { mapId: "map", kind: "burg", id: 11 },
            fact: { households: 100, economicFocus: "trading" },
            localFood: 100,
        },
        {
            identity: "place-b",
            cellId: 2,
            source: { mapId: "map", kind: "burg", id: 12 },
            fact: { households: 100 },
            localFood: 100,
        },
    ];
    const routes = [
        {
            id: "r1",
            city: "place-a",
            source: "farm",
            mode: "river",
            leagues: 0,
            maxCargo: 400,
            access: true,
        },
        {
            id: "r2",
            city: "place-b",
            source: "farm",
            mode: "river",
            leagues: 0,
            maxCargo: 1000,
            access: true,
        },
    ];
    return {
        map: { mapId: "map", cells },
        cities,
        routes,
        sources: [{ id: "farm", foodSurplus: 700 }],
        subpolities: [],
        cultureSizes: { "lore-town": 5 },
        urbanPopulation: 1000,
    } as any;
}

describe("urban food proposals", () => {
    it("preserves authored households above map estimates and shares the available food", () => {
        const input = fixture();
        const result = proposeUrbanSupply(input);
        expect(result.cities[0]).toMatchObject({
            fact: { households: 100, economicFocus: "trading" },
            populationExact: 500,
            need: 650,
            unmet: 150,
        });
        expect(result.cities[1]).toMatchObject({ populationExact: 500, need: 650, unmet: 250 });
        expect(result.remainingFood.farm).toBe(0);
        expect(result.remainingCargo.r1).toBe(0);
        expect(proposeUrbanSupply(input)).toEqual(result);
    });
    it("does not assume access or a cargo limit", () => {
        const input = fixture();
        input.routes[0].access = false;
        delete input.routes[1].maxCargo;
        const result = proposeUrbanSupply(input);
        expect(result.remainingFood.farm).toBe(700);
        expect(result.cities[0].unmet).toBe(550);
        expect(result.missing).toContainEqual({
            identity: "place-b",
            field: "route r2 mode, distance or cargo",
        });
    });
    it("preserves unknown and zero facts and still computes independent cities", () => {
        const input = fixture();
        input.cities[0].fact.households = null;
        input.cities[1].fact.households = 0;
        const result = proposeUrbanSupply(input);
        expect(result.missing).toContainEqual({ identity: "place-a", field: "households" });
        expect(result.cities[1]).toMatchObject({ households: 0, populationExact: 0, need: 0 });
        expect(result.unallocatedUrbanPopulation).toBeNull();
    });
    it("requires explicit food values and avoids inferring food from trade", () => {
        const input = fixture();
        delete input.sources[0].foodSurplus;
        delete input.cities[0].localFood;
        const result = proposeUrbanSupply(input);
        expect(result.missing).toContainEqual({ identity: "farm", field: "foodSurplus" });
        expect(result.missing).toContainEqual({ identity: "place-a", field: "localFood" });
        expect(result.cities[1].unmet).toBe(550);
    });
    it("keeps map estimates subordinate to authored reservations and the declared total", () => {
        const input = fixture();
        delete input.cities[1].fact;
        input.map.cells[1].urbanPopulation = 1000;
        input.urbanPopulation = 600;
        const result = proposeUrbanSupply(input);
        expect(result.cities[0].populationExact).toBe(500);
        expect(result.cities[1]).toMatchObject({
            populationSource: "map estimate",
            households: 20,
            populationExact: 100,
        });
        expect(result.unallocatedUrbanPopulation).toBe(0);
    });
    it("excludes subordinate cities once and detects conflicting bindings", () => {
        const input = fixture();
        input.subpolities = [{ address: "affiliation-child", urbanPopulation: 500, cellIds: [2] }];
        const result = proposeUrbanSupply(input);
        expect(result.reservedPopulation).toBe(1000);
        expect(result.cities).toHaveLength(1);
        input.cities[0].subpolity = "affiliation-child";
        expect(() => proposeUrbanSupply(input)).toThrow(/conflicts/);
    });
    it("rejects duplicate source or conflicting authored identity", () => {
        const input = fixture();
        input.cities[1].source = { ...input.cities[0].source };
        input.cities[1].cellId = 1;
        expect(() => proposeUrbanSupply(input)).toThrow(/duplicate urban map identity/);
        input.cities[1].source = { mapId: "map", kind: "burg", id: 12 };
        input.cities[1].cellId = 2;
        input.cities[0].fact.generatorSource = { mapId: "map", kind: "cell", id: 1, slot: 0 };
        expect(() => proposeUrbanSupply(input)).toThrow(/source conflicts/);
    });
});
