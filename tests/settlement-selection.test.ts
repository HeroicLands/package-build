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
