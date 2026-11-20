/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import {
    calculateSettlement,
    distributeRuralPopulation,
    deliverFood,
    roundPopulation,
    SETTLEMENT_MODEL_DEFAULTS,
} from "../engine/settlement-model.mjs";

const settlement = {
    households: 100,
    householdSize: 5.6,
    areaAcres: 100000,
    holdingAcres: 25,
    land: [5, 5, 5, 5],
    development: 1,
    obligation: 0.3,
    upwardShare: 0.3,
    urban: false,
    foodApproach: "agrarian",
    economicFocus: "agrarian",
    governance: "appointed",
};

describe("household settlement arithmetic", () => {
    it("starts from households and limits production by land and producers", () => {
        const result = calculateSettlement(settlement);
        expect(result).toMatchObject({
            households: 100,
            estimatedPopulation: 560,
            need: 560,
            ruralOverCapacity: false,
        });
        expect(result.production).toBeCloseTo(1047.2);
        expect(result.balanceBeforeExports).toBeCloseTo(487.2);
        expect(result.balance).toBeCloseTo(result.balanceBeforeExports - result.upward);
        expect(result.explanation.workerYield).toBeCloseTo(1047.2);
    });
    it("preserves zero, omitted, unknown, and authored population separately", () => {
        expect(calculateSettlement({})).toEqual({ status: "omitted" });
        expect(calculateSettlement({ households: null })).toEqual({
            status: "unknown",
            households: null,
        });
        expect(calculateSettlement({ ...settlement, households: 0, population: 0 })).toMatchObject({
            households: 0,
            estimatedPopulation: 0,
            authoredPopulation: 0,
        });
        expect(
            calculateSettlement({
                ...settlement,
                households: 40,
                householdSize: 6.4,
                population: null,
            }),
        ).toMatchObject({
            populationExact: 256,
            estimatedPopulation: 260,
            authoredPopulation: null,
        });
    });
    it("treats capacity as a rural ceiling and permits explicit mining on any land", () => {
        const input = {
            ...settlement,
            areaAcres: 2000,
            holdingAcres: 25,
            economicFocus: "mining",
            defaultEconomicFocus: "agrarian",
        };
        expect(calculateSettlement(input)).toMatchObject({
            economicFocus: "mining",
            capacity: 80,
            ruralOverCapacity: true,
        });
        expect(calculateSettlement({ ...input, urban: true }).ruralOverCapacity).toBe(false);
    });
    it("requires declared household sizes and editable livelihood shares", () => {
        expect(() => calculateSettlement({ ...settlement, householdSize: 0 })).toThrow(
            /household size/,
        );
        const custom = calculateSettlement({
            ...settlement,
            economicFocus: "custom",
            householdMix: [0.5, 0.3, 0.2],
        });
        expect(custom.explanation.producerPeople).toBeCloseTo(280);
    });
    it("caps obligations at the producers' food margin", () => {
        const result = calculateSettlement({
            ...settlement,
            foodApproach: "forager",
            obligation: 0.6,
        });
        expect(result.obligation).toBeLessThanOrEqual(
            Math.max(0, result.production - result.explanation.producerPeople),
        );
        expect(
            Object.values(result.roleHouseholds).reduce((sum, n) => sum + Number(n), 0),
        ).toBeLessThanOrEqual(15);
    });
    it("rounds estimates to whole people and at most two significant digits", () => {
        for (const [value, expected] of [
            [0, 0],
            [4.4, 4],
            [5.6, 6],
            [8.8, 9],
            [11.2, 11],
            [99.9, 100],
            [104, 100],
            [105, 110],
            [256, 260],
        ])
            expect(roundPopulation(value)).toBe(expected);
    });
    it("places all fitting remaining households in supplied order", () => {
        const cells = [
            { id: 1, capacity: 10, householdSize: 10 },
            { id: 2, capacity: 10, householdSize: 1 },
        ];
        expect(distributeRuralPopulation(9, cells)).toMatchObject({
            allocation: [
                { id: 1, households: 0 },
                { id: 2, households: 9 },
            ],
            unallocatedPopulation: 0,
        });
        expect(
            distributeRuralPopulation(21, [
                { id: 1, capacity: 1, householdSize: 10 },
                { id: 2, capacity: 2, householdSize: 4 },
            ]),
        ).toMatchObject({ allocatedPopulation: 18, unallocatedPopulation: 3 });
    });
    it("rejects arithmetic that cannot be represented", () => {
        expect(() =>
            calculateSettlement({ ...settlement, areaAcres: 1e308, holdingAcres: 1e-308 }),
        ).toThrow(/not representable/);
        expect(() => calculateSettlement({ ...settlement, householdSize: 1e308 })).toThrow(
            /not representable/,
        );
        const config = structuredClone(SETTLEMENT_MODEL_DEFAULTS);
        config.food.agrarian.yields = [1e308, 1e308, 1e308, 1e308];
        expect(() => calculateSettlement(settlement, config)).toThrow(/not representable/);
        expect(() =>
            distributeRuralPopulation(100, [{ id: 1, capacity: 2, householdSize: 1e308 }]),
        ).toThrow(/not representable/);
        expect(() =>
            deliverFood(
                [{ id: "x", surplus: 1 }],
                [{ id: "y", need: 1, routes: [{ source: "x", mode: "road", leagues: 1e308 }] }],
                { haulLoss: { road: 1e308 } },
            ),
        ).toThrow(/not representable/);
    });
    it("distributes a stated rural population without filling land", () => {
        const cells = [
            { id: 1, capacity: 100, householdSize: 5 },
            { id: 2, capacity: 100, householdSize: 5 },
        ];
        expect(distributeRuralPopulation(500, cells)).toMatchObject({
            allocation: [
                { id: 1, households: 50 },
                { id: 2, households: 50 },
            ],
            allocatedPopulation: 500,
            unallocatedPopulation: 0,
        });
        expect(distributeRuralPopulation(1200, cells)).toMatchObject({
            allocatedPopulation: 1000,
            unallocatedPopulation: 200,
        });
    });
    it("applies transport loss and never spends surplus twice", () => {
        const result = deliverFood(
            [{ id: "farm", surplus: 6000 }],
            [
                {
                    id: "town",
                    need: 5000,
                    routes: [{ source: "farm", mode: "river", leagues: 20 }],
                },
                {
                    id: "other",
                    need: 5000,
                    routes: [{ source: "farm", mode: "river", leagues: 20 }],
                },
            ],
        );
        expect(result.demands[0].unmet).toBeCloseTo(0);
        expect(result.demands[1].unmet).toBeGreaterThan(0);
        expect(result.remaining.farm).toBeCloseTo(0);
    });
    it("does not draw on a route that loses half its cargo", () => {
        const result = deliverFood(
            [{ id: "farm", surplus: 100 }],
            [{ id: "town", need: 50, routes: [{ source: "farm", mode: "road", leagues: 100 }] }],
        );
        expect(result.demands[0].unmet).toBe(50);
        expect(result.remaining.farm).toBe(100);
    });
});
