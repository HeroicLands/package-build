/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { discoverPlacementSites } from "../engine/settlement-placement.mjs";

const cell = (id: number, boundary: number[][]) => ({ id, boundary });
const box = (id: number, x: number, y: number, width: number, height: number) =>
    cell(id, [
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height],
    ]);
const input = () =>
    ({
        map: {
            mapId: "map",
            mapHash: "a",
            jsonHash: "b",
            units: { distanceUnit: "nmi", distanceScale: 1 },
            cells: [box(2, 0, 0, 6, 6)],
        },
        existingSites: [],
        spacingMeters: 5556,
        candidateLimit: 100,
        workLimit: 10000,
    }) as any;

describe("geographic placement sites", () => {
    it("orders cells deterministically and assigns shared boundary points once", () => {
        const data = input();
        data.map.cells = [box(9, 3, 0, 3, 3), box(2, 0, 0, 3, 3)];
        const result = discoverPlacementSites(data);
        expect(result.missing).toEqual([]);
        expect(
            result.candidates
                .filter((p: any) => p.point[0] === 3)
                .every((p: any) => p.cellId === 2),
        ).toBe(true);
        data.map.cells.reverse();
        expect(discoverPlacementSites(data)).toEqual(result);
        expect(new Set(result.candidates.map((p: any) => p.point.join(","))).size).toBe(
            result.candidates.length,
        );
    });
    it("uses polygon interiors, including irregular and small polygons", () => {
        const data = input();
        data.map.cells = [
            cell(1, [
                [0, 0],
                [6, 0],
                [0, 6],
            ]),
            box(3, 10, 10, 0.1, 0.1),
        ];
        const result = discoverPlacementSites(data);
        expect(result.candidates.some((p: any) => p.point[0] === 6 && p.point[1] === 6)).toBe(
            false,
        );
        expect(result.candidates.some((p: any) => p.cellId === 3)).toBe(false);
    });
    it("converts physical units and honors the map scale", () => {
        const a = input();
        const b = input();
        b.map.units = { distanceUnit: "km", distanceScale: 1.852 };
        expect(discoverPlacementSites(a).candidates).toEqual(discoverPlacementSites(b).candidates);
        b.map.units.distanceScale = 0;
        expect(discoverPlacementSites(b).missing[0].code).toBe("invalid-input");
        b.map.units = { distanceUnit: "unknown", distanceScale: 1 };
        expect(discoverPlacementSites(b).missing[0].code).toBe("invalid-input");
    });
    it("excludes sites near known positions across cells and reports unknown positions", () => {
        const data = input();
        data.map.cells = [box(1, 0, 0, 3, 3), box(2, 3, 0, 3, 3)];
        data.existingSites = [{ point: [2, 0] }];
        expect(
            discoverPlacementSites(data).candidates.some(
                (p: any) => p.point[0] === 3 && p.point[1] === 0,
            ),
        ).toBe(false);
        data.existingSites = [{ point: null }];
        const result = discoverPlacementSites(data);
        expect(result.candidates).toEqual([]);
        expect(result.missing[0].code).toBe("unknown-location");
    });
    it("rejects duplicate and invalid geometry, and overlapping interiors", () => {
        const data = input();
        data.map.cells = [box(1, 0, 0, 3, 3), box(1, 3, 0, 3, 3)];
        expect(discoverPlacementSites(data).missing[0].code).toBe("invalid-geometry");
        data.map.cells = [
            cell(1, [
                [0, 0],
                [3, 3],
                [0, 3],
                [3, 0],
            ]),
        ];
        expect(discoverPlacementSites(data).missing[0].code).toBe("invalid-geometry");
        data.map.cells = [box(1, -1, -1, 5, 5), box(2, -2, -2, 6, 6)];
        expect(discoverPlacementSites(data).missing[0].code).toBe("ambiguous-geometry");
    });
    it("detects overlapping interiors between grid points", () => {
        const data = input();
        data.map.cells = [
            box(1, 0, 0, 6, 6),
            cell(2, [
                [3, 0],
                [6, 3],
                [3, 6],
                [0, 3],
            ]),
        ];
        data.spacingMeters = 18520;
        expect(discoverPlacementSites(data).missing[0].code).toBe("ambiguous-geometry");
    });
    it("finishes empty thin grids without traversing their long dimension", () => {
        const data = input();
        data.map.cells = [box(1, 1, 0, 1, 3e12)];
        expect(discoverPlacementSites(data)).toMatchObject({ candidates: [], missing: [] });
        data.map.cells = [box(1, 0, 1, 3e12, 1)];
        expect(discoverPlacementSites(data)).toMatchObject({ candidates: [], missing: [] });
    });
    it("bounds work and output without returning partial results", () => {
        const data = input();
        data.workLimit = 0;
        expect(discoverPlacementSites(data).missing[0].code).toBe("invalid-input");
        data.workLimit = 1;
        expect(discoverPlacementSites(data).missing[0].code).toBe("work-limit");
        data.workLimit = 10000;
        data.candidateLimit = 0;
        expect(discoverPlacementSites(data).missing[0].code).toBe("candidate-limit");
        data.map.cells = [box(1, -1e12, -1e12, 2e12, 2e12)];
        expect(discoverPlacementSites(data).missing[0].code).toBe("work-limit");
    });
});
