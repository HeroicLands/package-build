/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { measurePlacementFootprints } from "../engine/settlement-selection.mjs";

describe("settlement footprint weights", () => {
    it("clips irregular cells and leaves uncovered area unused", () => {
        const input = {
            map: {
                mapId: "m",
                mapHash: "a",
                jsonHash: "b",
                units: { distanceUnit: "nmi", distanceScale: 1 },
                cells: [
                    {
                        id: 1,
                        boundary: [
                            [0, 0],
                            [6, 0],
                            [0, 6],
                        ],
                    },
                ],
            },
            existingSites: [],
            spacingMeters: 5556,
            candidateLimit: 20,
            workLimit: 10000,
        };
        const result = measurePlacementFootprints(input);
        expect(result.missing).toEqual([]);
        expect(
            result.candidates.reduce((sum: number, c: any) => sum + c.weight, 0),
        ).toBeLessThanOrEqual(1 + 1e-12);
        expect(
            result.candidates.find((c: any) => c.point[0] === 0 && c.point[1] === 0).weight,
        ).toBeCloseTo(0.125);
        expect(
            measurePlacementFootprints({
                ...input,
                map: { ...input.map, units: { distanceUnit: "km", distanceScale: 1.852 } },
            }).candidates,
        ).toEqual(result.candidates);
        expect(
            measurePlacementFootprints({ ...input, existingSites: [{ point: null }] }).missing[0]
                .code,
        ).toBe("unknown-location");
    });
});

it("owns shared boundary sites once and leaves every cell within its area", () => {
    const cells = [
        {
            id: 8,
            boundary: [
                [3, 0],
                [9, 0],
                [9, 3],
                [3, 3],
            ],
        },
        {
            id: 2,
            boundary: [
                [0, 0],
                [3, 0],
                [3, 3],
                [0, 3],
            ],
        },
    ];
    const input = {
        map: {
            mapId: "m",
            mapHash: "a",
            jsonHash: "b",
            units: { distanceUnit: "nmi", distanceScale: 1 },
            cells,
        },
        existingSites: [],
        spacingMeters: 5556,
        candidateLimit: 30,
        workLimit: 10000,
    };
    const first = measurePlacementFootprints(input);
    expect(first.missing).toEqual([]);
    expect(
        first.candidates.filter((p: any) => p.point[0] === 3).every((p: any) => p.cellId === 2),
    ).toBe(true);
    for (const id of [2, 8])
        expect(
            first.candidates
                .filter((p: any) => p.cellId === id)
                .reduce((sum: number, p: any) => sum + p.weight, 0),
        ).toBeLessThanOrEqual(1 + 1e-12);
    expect(
        measurePlacementFootprints({
            ...input,
            map: { ...input.map, cells: [...cells].reverse() },
        }),
    ).toEqual(first);
});

it("rejects oversized initial rules and IDs without inspecting their entries", async () => {
    const { selectSettlementPlacements } = await import("../engine/settlement-selection.mjs");
    const guarded = new Proxy(new Array(10000), {
        get(target, key, receiver) {
            if (typeof key === "string" && /^\d+$/.test(key)) throw new Error("inspected entry");
            return Reflect.get(target, key, receiver);
        },
    });
    const options = {
        session: { records: [] },
        map: { cells: [] },
        settings: { placements: [{ cellId: 1, areaAcres: 0 }], landRules: guarded },
    };
    const result = selectSettlementPlacements(options, {
        cellIds: [],
        existingSites: [],
        workLimit: 100,
    });
    expect(result.missing[0].message).toContain("work limit");
    const ids = selectSettlementPlacements(
        { ...options, settings: { ...options.settings, landRules: [] } },
        { cellIds: guarded, existingSites: [], workLimit: 100 },
    );
    expect(ids.missing[0].message).toContain("work limit");
});

it("bounds captured and dependency maps before opening their iterators", async () => {
    const { selectSettlementPlacements } = await import("../engine/settlement-selection.mjs");
    class GuardedMap extends Map {
        override [Symbol.iterator](): MapIterator<[any, any]> {
            throw new Error("opened oversized map");
        }
        override values(): MapIterator<any> {
            throw new Error("opened oversized map");
        }
    }
    const large = new GuardedMap();
    for (let i = 0; i < 10000; i++) large.set(i, {});
    for (const session of [
        { records: [], foreign: { index: large } },
        { records: [], parsed: large },
        { records: [], sources: large },
    ]) {
        const result = selectSettlementPlacements(
            { session, map: { cells: [] }, settings: { placements: [], landRules: [] } },
            { cellIds: [], existingSites: [], workLimit: 100 },
        );
        expect(result.missing[0].message).toContain("work limit");
    }
});

it("charges nested dependency and captured arrays before visiting their entries", async () => {
    const { selectSettlementPlacements } = await import("../engine/settlement-selection.mjs");
    const large = new Proxy(new Array(10000), {
        get(target, key, receiver) {
            if (typeof key === "string" && /^\d+$/.test(key)) throw new Error("visited entry");
            return Reflect.get(target, key, receiver);
        },
    });
    for (const field of ["settlements", "parents"]) {
        const record = { data: { [field]: large } };
        for (const session of [
            {
                records: [],
                foreign: { index: new Map([["dependency", { settlementRecord: record }]]) },
            },
            { records: [], parsed: new Map([["source.md", { frontmatter: record }]]) },
        ]) {
            const result = selectSettlementPlacements(
                { session, map: { cells: [] }, settings: { placements: [], landRules: [] } },
                { cellIds: [], existingSites: [], workLimit: 10000 },
            );
            expect(result.missing[0].message).toContain("work limit");
        }
    }
});
