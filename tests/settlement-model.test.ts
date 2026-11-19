/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import {
    calculateSettlement,
    distributeRuralPopulation,
    deliverFood,
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
