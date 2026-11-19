/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { calculateSettlement, SETTLEMENT_MODEL_DEFAULTS } from "../engine/settlement-model.mjs";
import { proposeSettlements } from "../engine/settlement-generate.mjs";
import { proposeUrbanSupply } from "../engine/settlement-urban.mjs";

// Synthetic arithmetic examples: these profiles declare no setting's cultural facts.
const scenarios = [
    {
        label: "herder",
        culture: "example-note-lore-herders",
        households: 40,
        householdSize: 5.2,
        foodApproach: "pastoral",
        focus: "subsistence",
        governance: "collective",
        urban: false,
        upwardShare: 0.3,
        population: 208,
        displayed: 210,
        need: 208,
        production: 247,
        overriddenProduction: 208,
        mix: [0.95, 0, 0.05],
        shares: [0.1, 0.1, 0.25, 0.15, 0.15, 0.25],
    },
    {
        label: "maritime",
        culture: "example-note-lore-fishers",
        households: 40,
        householdSize: 4.8,
        foodApproach: "maritime",
        focus: "fishing",
        governance: "representative",
        urban: false,
        upwardShare: 0.3,
        population: 192,
        displayed: 190,
        need: 192,
        production: 273.6,
        overriddenProduction: 291.84,
        mix: [0.75, 0.15, 0.1],
        shares: [0.2, 0.15, 0.2, 0.1, 0.1, 0.25],
    },
    {
        label: "institution-led",
        culture: "example-note-lore-estate",
        households: 40,
        householdSize: 6.4,
        foodApproach: "irrigated",
        focus: "agrarian",
        governance: "institutional",
        urban: false,
        upwardShare: 0.3,
        population: 256,
        displayed: 260,
        need: 256,
        production: 565.76,
        overriddenProduction: 532.48,
        mix: [0.85, 0.05, 0.1],
        shares: [0.2, 0.05, 0.05, 0.5, 0.12, 0.08],
    },
    {
        label: "city-state",
        culture: "example-note-lore-citizens",
        households: 4000,
        householdSize: 4.8,
        foodApproach: "maritime",
        focus: "trading",
        governance: "representative",
        urban: true,
        upwardShare: 0,
        population: 19200,
        displayed: 19000,
        need: 24960,
        production: 7296,
        overriddenProduction: 12850,
        mix: [0.2, 0.6, 0.2],
        shares: [0.2, 0.15, 0.2, 0.1, 0.1, 0.25],
    },
];

function declaredProfile(scenario: (typeof scenarios)[number]) {
    return {
        households: scenario.households,
        householdSize: scenario.householdSize,
        areaAcres: 100000,
        holdingAcres: 100,
        land: [5, 5, 5, 5],
        development: 1,
        foodApproach: scenario.foodApproach,
        defaultEconomicFocus: scenario.focus,
        governance: scenario.governance,
        urban: scenario.urban,
        obligation: 0.3,
        upwardShare: scenario.upwardShare,
    };
}

const customMix = [0.8, 0.1, 0.1];
const customShares = [0.1, 0.1, 0.1, 0.4, 0.1, 0.2];

describe("declared cross-culture settlement scenarios", () => {
    it.each(scenarios)("calculates the selected defaults for $label", (scenario) => {
        const input = declaredProfile(scenario);
        const snapshot = structuredClone(input);
        const result = calculateSettlement(input);
        expect(result).toMatchObject({
            status: "calculated",
            households: scenario.households,
            estimatedPopulation: scenario.displayed,
            economicFocus: scenario.focus,
            capacity: 1000,
            ruralOverCapacity: false,
            explanation: { mix: scenario.mix, budgetShares: scenario.shares },
        });
        expect(result.populationExact).toBeCloseTo(scenario.population);
        expect(result.production).toBeCloseTo(scenario.production);
        expect(result.need).toBeCloseTo(scenario.need);
        expect(result.budgets.faith).toBeCloseTo(result.local * scenario.shares[3]);
        expect(
            Object.values(result.roleHouseholds).reduce((sum, n) => sum + Number(n), 0),
        ).toBeLessThanOrEqual(scenario.households * (1 - scenario.mix[0]));
        expect(calculateSettlement(input)).toEqual(result);
        expect(input).toEqual(snapshot);
    });

    it.each(scenarios)(
        "accepts explicit livelihood and governance shares for $label",
        (scenario) => {
            const result = calculateSettlement({
                ...declaredProfile(scenario),
                economicFocus: "declared-local-livelihood",
                householdMix: customMix,
                governance: "declared-local-government",
                governanceShares: customShares,
                obligation: 0.2,
                upwardShare: 0,
            });
            expect(result).toMatchObject({
                households: scenario.households,
                estimatedPopulation: scenario.displayed,
                economicFocus: "declared-local-livelihood",
                upward: 0,
                explanation: { mix: customMix, budgetShares: customShares },
            });
            expect(result.production).toBeCloseTo(scenario.overriddenProduction);
            expect(result.local).toBeCloseTo(result.obligation);
            expect(result.budgets.faith).toBeCloseTo(result.local * 0.4);
            expect(result.need).toBeCloseTo(scenario.need);
        },
    );

    it("allocates one polity across herders, fishers and an institution without a cultural preset", () => {
        const rural = scenarios.filter((scenario) => !scenario.urban);
        const input = {
            map: {
                mapId: "synthetic-mixed",
                cells: rural.map((scenario, i) => ({
                    id: i,
                    biome: { i },
                    cultureAddress: scenario.culture,
                    polityAddress: "example-note-affiliation-mixed",
                    ruralPopulation: 10000,
                })),
            },
            ruralPopulation: 328,
            existing: [],
            subpolities: [],
            cultureSizes: Object.fromEntries(rural.map((s) => [s.culture, s.householdSize])),
            landRules: rural.map((scenario, i) => ({
                when: { biome: i },
                profile: declaredProfile(scenario),
            })),
            placements: rural.map((_, i) => ({
                cellId: i,
                source: { mapId: "synthetic-mixed", kind: "cell", id: i, slot: 0 },
                areaAcres: 10000,
                cellAreaAcres: 10000,
                ...(i === 1 ?
                    { profile: { economicFocus: "local-exchange", householdMix: customMix } }
                :   {}),
            })),
        };
        const result = proposeSettlements(input);
        expect(result.populationSource).toBe("declared");
        expect(result.proposals.map((p: any) => p.cultureAddress)).toEqual(
            rural.map((s) => s.culture),
        );
        expect(result.proposals.map((p: any) => p.calculation.households)).toEqual([20, 20, 20]);
        expect(result.proposals.map((p: any) => p.calculation.estimatedPopulation)).toEqual([
            100, 96, 130,
        ]);
        expect(result.proposals.map((p: any) => p.calculation.economicFocus)).toEqual([
            "subsistence",
            "local-exchange",
            "agrarian",
        ]);
        expect(result.proposedPopulation).toBeCloseTo(328);
        expect(result.unallocatedPopulation).toBeCloseTo(0);
        expect(
            result.proposals.every((p: any) => p.calculation.households < p.calculation.capacity),
        ).toBe(true);
        expect(proposeSettlements(input)).toEqual(result);
    });
});

function citySupply() {
    const scenario = scenarios[3];
    const local = calculateSettlement(declaredProfile(scenario));
    return {
        map: {
            mapId: "synthetic-coast",
            cells: [
                {
                    id: 1,
                    burg: { i: 11 },
                    burgCultureAddress: scenario.culture,
                    urbanPopulation: 24000,
                },
            ],
        },
        cultureSizes: { [scenario.culture]: scenario.householdSize },
        urbanPopulation: 24000,
        subpolities: [],
        cities: [
            {
                identity: "example-note-place-city",
                cellId: 1,
                source: { mapId: "synthetic-coast", kind: "burg", id: 11 },
                localFood: local.production,
            },
        ],
        sources: [{ id: "declared-hinterland", foodSurplus: 20000 }],
        routes: [
            {
                id: "coastal-route",
                city: "example-note-place-city",
                source: "declared-hinterland",
                mode: "coast",
                leagues: 10,
                maxCargo: 20000,
                access: true,
            },
        ],
    };
}

it("feeds an over-capacity city-state through declared coastal supply and preserves its households", () => {
    const input = citySupply();
    const estimated = proposeUrbanSupply(input);
    expect(estimated.cities[0]).toMatchObject({
        populationSource: "map estimate",
        households: 5000,
        populationExact: 24000,
    });
    expect(estimated.cities[0].unmet).toBeCloseTo(4180);
    const authored = {
        ...input,
        urbanPopulation: 19200,
        cities: [{ ...input.cities[0], fact: { households: 4000, economicFocus: "trading" } }],
    };
    const result = proposeUrbanSupply(authored);
    expect(result.missing).toEqual([]);
    expect(result.cities[0]).toMatchObject({
        populationSource: "authored households",
        households: 4000,
        populationExact: 19200,
        estimatedPopulation: 19000,
        need: 24960,
    });
    expect(result.cities[0].unmet).toBeCloseTo(0);
    expect(result.cities[0].deliveries[0].delivered).toBeCloseTo(17664);
    expect(result.cities[0].deliveries[0].sent).toBeGreaterThan(17664);
    expect(result.remainingFood["declared-hinterland"]).toBeGreaterThan(0);
    expect(proposeUrbanSupply(authored)).toEqual(result);

    const config = structuredClone(SETTLEMENT_MODEL_DEFAULTS);
    config.haulLoss.coast = 0.02;
    const costly = proposeUrbanSupply(authored, config);
    expect(costly.cities[0].unmet).toBeCloseTo(1664);
    expect(costly.remainingFood["declared-hinterland"]).toBeCloseTo(0);
});

it("does not infer food access from a maritime livelihood or a city government", () => {
    const input = citySupply();
    const blocked = proposeUrbanSupply({
        ...input,
        routes: [{ ...input.routes[0], access: false }],
    });
    expect(blocked.cities[0].unmet).toBeCloseTo(23904);
    expect(blocked.remainingFood["declared-hinterland"]).toBe(20000);
    expect(blocked.cities[0].deliveries).toEqual([]);
});
