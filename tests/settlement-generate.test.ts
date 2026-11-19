/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { proposeSettlements } from "../engine/settlement-generate.mjs";

const profile = {
    land: [5, 5, 5, 5],
    development: 1,
    holdingAcres: 25,
    foodApproach: "agrarian",
    economicFocus: "agrarian",
    governance: "appointed",
    obligation: 0.3,
    upwardShare: 0.3,
};
function fixture() {
    const cell = {
        id: 7,
        biome: { i: 3 },
        elevationScale: 30,
        river: { i: 1 },
        coast: 0,
        routeLinks: [{ route: { group: "roads" } }],
        cultureAddress: "lore-culture",
        polityAddress: "affiliation-polity",
        ruralPopulation: 500,
        burg: { i: 4 },
        burgCultureAddress: "lore-town",
    };
    const placement = (slot: number, areaAcres = 1000) => ({
        cellId: 7,
        source: { mapId: "map", kind: "cell", id: 7, slot },
        areaAcres,
        cellAreaAcres: 2000,
    });
    return {
        map: { mapId: "map", cells: [cell] },
        ruralPopulation: 500,
        existing: [],
        subpolities: [],
        cultureSizes: { "lore-culture": 5, "lore-town": 4 },
        landRules: [{ when: { biome: 3, river: true, routeGroup: "roads" }, profile }],
        placements: [placement(0), placement(1)],
    } as any;
}

describe("settlement proposals", () => {
    it("distributes stated people across multiple cells slots deterministically", () => {
        const input = fixture();
        const result = proposeSettlements(input);
        expect(result.proposals.map((row: any) => row.calculation.households)).toEqual([40, 40]);
        expect(result.unallocatedPopulation).toBe(100);
        expect(proposeSettlements(input)).toEqual(result);
    });
    it("reserves authored households and retains edited facts instead of map estimates", () => {
        const input = fixture();
        const fact = {
            identity: "place-known",
            source: input.placements[0].source,
            urban: false,
            households: 10,
            householdSize: 5,
            economicFocus: "mining",
            population: 700,
        };
        input.existing = [fact];
        input.placements[0].noteAddress = "place-known";
        const result = proposeSettlements(input);
        expect(result.existing).toEqual([fact]);
        expect(result.reservedPopulation).toBe(50);
        expect(result.proposals).toHaveLength(1);
        expect(result.proposals[0].calculation.households).toBe(40);
    });
    it("keeps explicit mining on unrelated terrain and uses burg culture", () => {
        const input = fixture();
        input.placements = [
            {
                cellId: 7,
                source: { mapId: "map", kind: "burg", id: 4 },
                areaAcres: 1000,
                cellAreaAcres: 2000,
                profile: { economicFocus: "mining" },
            },
        ];
        expect(proposeSettlements(input).proposals[0]).toMatchObject({
            cultureAddress: "lore-town",
            calculation: { economicFocus: "mining" },
        });
    });
    it("uses map population only when a rural total is omitted", () => {
        const input = fixture();
        delete input.ruralPopulation;
        expect(proposeSettlements(input)).toMatchObject({
            populationSource: "map estimate",
            ruralPopulation: 500,
        });
    });
    it("requires unknown facts instead of replacing them", () => {
        const input = fixture();
        input.existing = [
            { identity: "place-known", urban: false, households: null, population: 100 },
        ];
        expect(() => proposeSettlements(input)).toThrow(/unknown households/);
        input.existing = [];
        input.cultureSizes = {};
        expect(() => proposeSettlements(input)).toThrow(/household size/);
        input.cultureSizes = { "lore-culture": 5 };
        input.landRules = [];
        expect(() => proposeSettlements(input)).toThrow(/land rule/);
    });
    it("refuses ambiguous map identities and overlapping acreage", () => {
        const input = fixture();
        input.placements[1].source.slot = 0;
        expect(() => proposeSettlements(input)).toThrow(/duplicate placement/);
        input.placements[1].source.slot = 1;
        input.placements[1].areaAcres = 1100;
        expect(() => proposeSettlements(input)).toThrow(/acreage exceeds/);
    });
    it("reserves subordinate totals once and excludes their cells", () => {
        const input = fixture();
        input.map.cells.push({ ...input.map.cells[0], id: 8 });
        input.subpolities = [{ address: "affiliation-child", ruralPopulation: 100, cellIds: [8] }];
        input.existing = [
            {
                identity: "place-child",
                subpolity: "affiliation-child",
                urban: false,
                population: 100,
            },
        ];
        expect(proposeSettlements(input).reservedPopulation).toBe(100);
        input.placements[0].cellId = 8;
        input.placements[0].source.id = 8;
        expect(() => proposeSettlements(input)).toThrow(/belongs to a subpolity/);
    });
});
