/* SPDX-License-Identifier: GPL-3.0-or-later */
import { createHash } from "node:crypto";
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
export function settlementMapFixture() {
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
