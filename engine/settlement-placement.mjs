/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Discover geometrically spaced candidate sites on a normalized map. @module */
const METERS = Object.freeze({
    km: 1000,
    mi: 1609.344,
    lg: 4828.032,
    vr: 1066.8,
    nmi: 1852,
    nlg: 5556,
});
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const point = (p) => Array.isArray(p) && p.length === 2 && p.every(finite);
const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const onSegment = (a, b, p) =>
    cross(a, b, p) === 0 &&
    p[0] >= Math.min(a[0], b[0]) &&
    p[0] <= Math.max(a[0], b[0]) &&
    p[1] >= Math.min(a[1], b[1]) &&
    p[1] <= Math.max(a[1], b[1]);
const intersects = (a, b, c, d) => {
    const abC = cross(a, b, c),
        abD = cross(a, b, d),
        cdA = cross(c, d, a),
        cdB = cross(c, d, b);
    return (
        ((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
        ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))
    );
};
const touches = (a, b, c, d) =>
    intersects(a, b, c, d) ||
    onSegment(a, b, c) ||
    onSegment(a, b, d) ||
    onSegment(c, d, a) ||
    onSegment(c, d, b);

/** Return the grid interval in raw map coordinates, or NaN for invalid units.
 * @param {object} units - Map distance unit and scale.
 * @param {number} spacingMeters - Physical grid spacing.
 * @returns {number} Raw coordinate interval.
 */
export function placementGridInterval(units, spacingMeters) {
    return spacingMeters / (METERS[units?.distanceUnit] * units?.distanceScale);
}

/**
 * Find candidate coordinates on a globally anchored square grid. Boundary points
 * belong to the lowest numbered cell; overlapping interiors are ambiguous.
 * Inputs are normalized map cells, with packed cell IDs and map coordinates.
 * The operation does not choose a settlement count or assign identities.
 *
 * @param {object} input - Discovery inputs.
 * @param {{mapId: string, mapHash: string, jsonHash: string, units: {distanceUnit: string, distanceScale: number}, cells: Array<{id: number, boundary: number[][]}>}} input.map - Selected normalized cells and provenance.
 * @param {Array<{point: number[]|null}>} input.existingSites - Known coordinates, or null for an unknown location.
 * @param {number} input.spacingMeters - Minimum spacing in meters, strictly positive.
 * @param {number} input.candidateLimit - Maximum returned sites, a nonnegative safe integer.
 * @param {number} input.workLimit - Maximum geometric operations, a positive safe integer.
 * @returns {{provenance: {mapId: unknown, mapHash: unknown, jsonHash: unknown, units: object|undefined, spacingMeters: unknown}, candidates: Array<{cellId: number, point: number[]}>, missing: Array<{code: string, message: string}>}} Sites or a diagnostic; failures return no partial sites.
 */
export function discoverPlacementSites({
    map,
    existingSites,
    spacingMeters,
    candidateLimit,
    workLimit,
}) {
    const provenance = {
        mapId: map?.mapId,
        mapHash: map?.mapHash,
        jsonHash: map?.jsonHash,
        units: map?.units ? { ...map.units } : undefined,
        spacingMeters,
    };
    const fail = (code, message) => ({ provenance, candidates: [], missing: [{ code, message }] });
    const factor = METERS[map?.units?.distanceUnit],
        scale = map?.units?.distanceScale;
    if (
        !map ||
        typeof map.mapId !== "string" ||
        !map.mapId ||
        typeof map.mapHash !== "string" ||
        !map.mapHash ||
        typeof map.jsonHash !== "string" ||
        !map.jsonHash ||
        !Array.isArray(map.cells) ||
        !Array.isArray(existingSites) ||
        !factor ||
        !finite(scale) ||
        scale <= 0 ||
        !finite(spacingMeters) ||
        spacingMeters <= 0 ||
        !Number.isSafeInteger(candidateLimit) ||
        candidateLimit < 0 ||
        !Number.isSafeInteger(workLimit) ||
        workLimit < 1
    )
        return fail(
            "invalid-input",
            "provide map provenance, supported units, positive scale and spacing, sites, and bounded limits",
        );
    const step = placementGridInterval(map.units, spacingMeters);
    if (!finite(step) || step <= 0)
        return fail("invalid-input", "map scale and spacing must produce a finite grid");
    let work = 0;
    const charge = (amount = 1) => {
        work += amount;
        if (work > workLimit) throw new Error("work-limit");
    };
    const locate = (p, polygon) => {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            charge();
            const a = polygon[j],
                b = polygon[i];
            if (onSegment(a, b, p)) return 1;
            if (
                a[1] > p[1] !== b[1] > p[1] &&
                p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
            )
                inside = !inside;
        }
        return inside ? 2 : 0;
    };
    try {
        charge(map.cells.length + existingSites.length);
        for (const site of existingSites) {
            if (site?.point === null)
                return fail("unknown-location", "an existing site has no known position");
            if (!point(site?.point))
                return fail(
                    "invalid-input",
                    "existing site coordinates must be finite pairs or null",
                );
        }
        const cells = [...map.cells],
            ids = new Set(),
            orientations = new Map();
        for (const cell of cells) {
            const poly = cell?.boundary;
            if (
                !Number.isSafeInteger(cell?.id) ||
                cell.id < 0 ||
                ids.has(cell.id) ||
                !Array.isArray(poly) ||
                poly.length < 3
            )
                return fail("invalid-geometry", "each cell needs a distinct ID and polygon");
            ids.add(cell.id);
            charge(poly.length);
            if (!poly.every(point))
                return fail("invalid-geometry", "polygon coordinates must be finite pairs");
            let area = 0;
            for (let i = 0; i < poly.length; i++) {
                const a = poly[i],
                    b = poly[(i + 1) % poly.length];
                if (a[0] === b[0] && a[1] === b[1])
                    return fail("invalid-geometry", "polygon has a zero-length edge");
                area += a[0] * b[1] - b[0] * a[1];
                for (let j = i + 1; j < poly.length; j++) {
                    charge();
                    if (j === i + 1 || (i === 0 && j === poly.length - 1)) continue;
                    if (touches(a, b, poly[j], poly[(j + 1) % poly.length]))
                        return fail("invalid-geometry", "polygon intersects itself");
                }
            }
            if (!finite(area) || area === 0)
                return fail("invalid-geometry", "polygon has no finite area");
            orientations.set(cell.id, Math.sign(area));
        }
        cells.sort((a, b) => a.id - b.id);
        const edgeEnters = (polygon, other) => {
            for (let i = 0; i < polygon.length; i++) {
                const start = polygon[i],
                    end = polygon[(i + 1) % polygon.length];
                const axis = start[0] !== end[0] ? 0 : 1;
                const cuts = [start, end];
                for (const p of other) {
                    charge();
                    if (onSegment(start, end, p)) cuts.push(p);
                }
                cuts.sort((a, b) => {
                    charge();
                    return a[axis] - b[axis];
                });
                for (let k = 1; k < cuts.length; k++) {
                    charge();
                    if (cuts[k - 1][axis] === cuts[k][axis]) continue;
                    const midpoint = [
                        cuts[k - 1][0] / 2 + cuts[k][0] / 2,
                        cuts[k - 1][1] / 2 + cuts[k][1] / 2,
                    ];
                    if (locate(midpoint, other) === 2) return true;
                }
            }
            return false;
        };
        for (let i = 0; i < cells.length; i++)
            for (let j = i + 1; j < cells.length; j++) {
                const a = cells[i].boundary,
                    b = cells[j].boundary;
                for (let k = 0; k < a.length; k++)
                    for (let l = 0; l < b.length; l++) {
                        charge();
                        const a0 = a[k],
                            a1 = a[(k + 1) % a.length],
                            b0 = b[l],
                            b1 = b[(l + 1) % b.length];
                        if (intersects(a0, a1, b0, b1))
                            return fail("ambiguous-geometry", "cell interiors overlap");
                        if (cross(a0, a1, b0) === 0 && cross(a0, a1, b1) === 0) {
                            const axis = a0[0] !== a1[0] ? 0 : 1;
                            const overlap =
                                Math.min(
                                    Math.max(a0[axis], a1[axis]),
                                    Math.max(b0[axis], b1[axis]),
                                ) -
                                Math.max(
                                    Math.min(a0[axis], a1[axis]),
                                    Math.min(b0[axis], b1[axis]),
                                );
                            const direction =
                                Math.sign(a1[axis] - a0[axis]) * Math.sign(b1[axis] - b0[axis]);
                            if (
                                overlap > 0 &&
                                direction *
                                    orientations.get(cells[i].id) *
                                    orientations.get(cells[j].id) >
                                    0
                            )
                                return fail("ambiguous-geometry", "cell interiors overlap");
                        }
                    }
                const sameBoundary =
                    a.length === b.length &&
                    a.every((p) =>
                        b.some((q) => {
                            charge();
                            return p[0] === q[0] && p[1] === q[1];
                        }),
                    );
                if (
                    sameBoundary ||
                    a.some((p) => locate(p, b) === 2) ||
                    b.some((p) => locate(p, a) === 2) ||
                    edgeEnters(a, b) ||
                    edgeEnters(b, a)
                )
                    return fail("ambiguous-geometry", "cell interiors overlap");
            }
        if (!cells.length) return { provenance, candidates: [], missing: [] };
        let minX = Infinity,
            maxX = -Infinity,
            minY = Infinity,
            maxY = -Infinity;
        for (const cell of cells)
            for (const p of cell.boundary) {
                charge();
                minX = Math.min(minX, p[0]);
                maxX = Math.max(maxX, p[0]);
                minY = Math.min(minY, p[1]);
                maxY = Math.max(maxY, p[1]);
            }
        const bounds = [
            Math.ceil(minX / step),
            Math.floor(maxX / step),
            Math.ceil(minY / step),
            Math.floor(maxY / step),
        ];
        if (!bounds.every(Number.isSafeInteger))
            return fail("work-limit", "grid bounds exceed the work limit");
        const [left, right, top, bottom] = bounds,
            columns = Math.max(0, right - left + 1),
            rows = Math.max(0, bottom - top + 1);
        if (columns === 0 || rows === 0) return { provenance, candidates: [], missing: [] };
        if (!Number.isSafeInteger(columns * rows) || columns * rows > workLimit - work)
            return fail("work-limit", "grid traversal exceeds the work limit");
        const candidates = [];
        for (let y = top; y <= bottom; y++)
            for (let x = left; x <= right; x++) {
                charge();
                const p = [x * step || 0, y * step || 0];
                let owner,
                    interior = 0;
                for (const cell of cells) {
                    const relation = locate(p, cell.boundary);
                    if (relation === 2) interior++;
                    if (relation && owner === undefined) owner = cell.id;
                }
                if (interior > 1) return fail("ambiguous-geometry", "cell interiors overlap");
                if (owner === undefined) continue;
                let blocked = false;
                for (const site of existingSites) {
                    charge();
                    if (Math.hypot(p[0] - site.point[0], p[1] - site.point[1]) < step) {
                        blocked = true;
                        break;
                    }
                }
                if (!blocked) {
                    if (candidates.length === candidateLimit)
                        return fail("candidate-limit", "candidate count exceeds the limit");
                    candidates.push({ cellId: owner, point: p });
                }
            }
        return { provenance, candidates, missing: [] };
    } catch (error) {
        if (error.message === "work-limit")
            return fail("work-limit", "geometry exceeds the work limit");
        throw error;
    }
}
