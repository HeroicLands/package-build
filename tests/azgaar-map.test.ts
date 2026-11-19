/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readAzgaarMap } from "../engine/azgaar-map.mjs";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const units = {
    distanceUnit: "mi",
    distanceScale: 2,
    areaUnit: "square",
    heightUnit: "ft",
    heightExponent: 2,
    temperatureScale: "°F",
    populationRate: 100,
    urbanization: 2,
};
function fixture() {
    const settings = {
        units: {
            distance: { unit: "mi", scale: 2 },
            area: { unit: "square" },
            height: { unit: "ft", exponent: 2 },
            temperature: { unit: "°F" },
            population: { scale: 100, urbanization: { rate: 2 } },
        },
    };
    const map = `1.156.0|Azgaar|2026-10-25|42|100|80|123\r\n${JSON.stringify(settings)}\r\n`;
    const data = {
        info: { version: "1.156.0", seed: "42", mapId: 123, width: 100, height: 80 },
        settings: { ...units },
        pack: {
            cells: [
                {
                    i: 0,
                    g: 1,
                    p: [5, 5],
                    v: [0, 1, 2],
                    c: [1],
                    h: 30,
                    area: 10,
                    fl: 20,
                    pop: 2,
                    biome: 1,
                    culture: 1,
                    state: 1,
                    province: 0,
                    f: 1,
                    r: 1,
                    burg: 1,
                    t: 1,
                    routes: { "1": 0 },
                },
                {
                    i: 1,
                    g: 0,
                    p: [8, 5],
                    v: [0, 1, 2],
                    c: [0],
                    h: 10,
                    area: 7,
                    fl: 0,
                    pop: 0,
                    biome: 0,
                    culture: 0,
                    state: 0,
                    province: 0,
                    f: 1,
                    r: 0,
                    burg: 0,
                    t: -1,
                },
            ],
            vertices: [
                { i: 0, p: [0, 0] },
                { i: 1, p: [10, 0] },
                { i: 2, p: [5, 10] },
            ],
            states: [{ i: 0 }, { i: 1, name: "State" }, { i: 2, removed: true }],
            cultures: [{ i: 0 }, { i: 1, name: "Culture" }],
            biomes: [
                { i: 0, name: "Marine" },
                { i: 1, name: "Grassland" },
            ],
            features: [{ i: 1, type: "island" }],
            provinces: [0],
            burgs: [0, { i: 1, cell: 0, name: "Port", population: 3, port: 1 }],
            rivers: [{ i: 1, name: "River", cells: [0] }],
            routes: [
                {
                    i: 0,
                    group: "roads",
                    points: [
                        [5, 5, 0],
                        [8, 5, 1],
                    ],
                },
            ],
        },
        grid: {
            cells: [
                { i: 0, temp: -5, prec: 1 },
                { i: 1, temp: 22, prec: 3 },
            ],
        },
    };
    const mapping = {
        state: { id: 1, address: "affiliation-state" },
        cultures: { "1": "lore-culture" },
    };
    const input = (changed = data, pinChange = {}) => {
        const json = JSON.stringify(changed);
        return {
            map,
            json,
            mapFile: "world.map",
            jsonFile: "world.json",
            mapping,
            pin: {
                mapHash: digest(map),
                jsonHash: digest(json),
                mapId: "123",
                seed: "42",
                version: "1.156.0",
                width: 100,
                height: 80,
                units,
                ...pinChange,
            },
        };
    };
    return { data, input, mapping };
}

describe("Azgaar Full JSON", () => {
    it("joins packed cells to their climate grid, source records and routes", () => {
        const { input } = fixture();
        const result = readAzgaarMap(input());
        expect(result).toMatchObject({
            mapId: "123",
            seed: "42",
            cells: [
                {
                    id: 0,
                    gridId: 1,
                    temperature: 22,
                    precipitation: 3,
                    area: 40,
                    ruralPopulation: 200,
                    urbanPopulation: 600,
                    cultureAddress: "lore-culture",
                    province: null,
                    river: { i: 1 },
                    burg: { port: 1 },
                    routeLinks: [{ neighbor: 1, route: { i: 0, group: "roads" } }],
                },
            ],
        });
    });
    it("keeps a missing burg population unknown", () => {
        const f = fixture();
        delete (f.data.pack.burgs[1] as any).population;
        expect(readAzgaarMap(f.input()).cells[0].urbanPopulation).toBeNull();
    });
    it("rejects mismatched hashes, versions, map identities and units", () => {
        const f = fixture();
        for (const pin of [
            { mapHash: "0".repeat(64) },
            { jsonHash: "0".repeat(64) },
            { version: "1.153.1" },
            { mapId: "999" },
            { units: { ...units, distanceScale: 3 } },
        ])
            expect(() => readAzgaarMap(f.input(f.data, pin))).toThrow(/:1:1: error:/);
    });
    it("rejects removed states, missing cultures, bad grid links and broken routes", () => {
        const f = fixture();
        expect(() =>
            readAzgaarMap({
                ...f.input(),
                mapping: { ...f.mapping, state: { id: 2, address: "affiliation-state" } },
            }),
        ).toThrow(/removed/);
        expect(() =>
            readAzgaarMap({ ...f.input(), mapping: { ...f.mapping, cultures: {} } }),
        ).toThrow(/culture mapping/);
        const badGrid = structuredClone(f.data);
        badGrid.pack.cells[0].g = 999;
        expect(() => readAzgaarMap(f.input(badGrid))).toThrow(/climate grid/);
        const badRoute = structuredClone(f.data);
        badRoute.pack.cells[0].routes = { "1": 99 };
        expect(() => readAzgaarMap(f.input(badRoute))).toThrow(/route link/);
    });
});
