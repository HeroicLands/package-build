/*
 * Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Read pinned Azgaar Full JSON and its saved map for on-demand authoring. @module */
import { createHash } from "node:crypto";

const VERSION = "1.156.0";
export const AZGAAR_LIMITS = Object.freeze({
    mapBytes: 64 * 1024 * 1024,
    jsonBytes: 256 * 1024 * 1024,
    records: 1000000,
});
const hash = (value) => createHash("sha256").update(value).digest("hex");
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const positive = (value) => finite(value) && value > 0;
const address = (value) => typeof value === "string" && Boolean(value.trim());

/**
 * Read an Azgaar 1.156.0 Full JSON export alongside its saved map.
 * @param {{map: string|Buffer, json: string|Buffer, mapFile: string, jsonFile: string, pin: object, mapping: object, limits?: {mapBytes?: number, jsonBytes?: number, records?: number}}} input - Pinned input files and explicit identities.
 * @returns {object} Map metadata, selected cells and referenced map records.
 */
export function readAzgaarMap({ map, json, mapFile, jsonFile, pin, mapping, limits = {} }) {
    const fail = (file, message) => {
        throw Object.assign(new Error(`${file}: error: ${message}`), { located: true });
    };
    if (!address(mapFile) || !address(jsonFile))
        throw new TypeError("mapFile and jsonFile are required");
    if (!(typeof map === "string" || Buffer.isBuffer(map)))
        fail(mapFile, "provide the saved map bytes");
    if (!(typeof json === "string" || Buffer.isBuffer(json)))
        fail(jsonFile, "provide the Full JSON bytes");
    const cap = (key) => {
        const value = limits[key] ?? AZGAAR_LIMITS[key];
        if (!Number.isSafeInteger(value) || value < 1 || value > AZGAAR_LIMITS[key])
            fail("limits", `invalid ${key} limit`);
        return value;
    };
    const mapLimit = cap("mapBytes"),
        jsonLimit = cap("jsonBytes"),
        recordLimit = cap("records");
    const byteLength = (value) =>
        Buffer.isBuffer(value) ? value.length : Buffer.byteLength(value);
    if (byteLength(map) > mapLimit) fail(mapFile, "saved map exceeds the byte limit");
    if (byteLength(json) > jsonLimit) fail(jsonFile, "Full JSON exceeds the byte limit");
    if (
        !object(pin) ||
        !/^[a-f0-9]{64}$/.test(pin.mapHash ?? "") ||
        !/^[a-f0-9]{64}$/.test(pin.jsonHash ?? "")
    )
        fail(jsonFile, "pin both SHA-256 hashes");
    if (hash(map) !== pin.mapHash) fail(mapFile, "saved map hash differs from the pin");
    if (hash(json) !== pin.jsonHash) fail(jsonFile, "Full JSON hash differs from the pin");
    const firstEnd = map.indexOf("\r\n");
    const secondEnd = firstEnd < 0 ? -1 : map.indexOf("\r\n", firstEnd + 2);
    if (firstEnd < 0 || secondEnd < 0) fail(mapFile, "saved map header or settings are missing");
    const headerText = String(map.slice(0, firstEnd));
    const settingsText = String(map.slice(firstEnd + 2, secondEnd));
    const header = headerText.split("|");
    const parse = (text, file, offset = 0) => {
        try {
            return JSON.parse(text);
        } catch (error) {
            const match = / in JSON at position (\d+) \(line \d+ column \d+\)$/.exec(error.message);
            if (!match) fail(file, "invalid JSON");
            const before = text.slice(0, Number(match[1]));
            const lines = before.split("\n");
            const line = lines.length + offset;
            const column = lines.at(-1).length + 1;
            throw Object.assign(new Error(`${file}:${line}:${column}: error: invalid JSON`), {
                located: true,
            });
        }
    };
    const mapSettings = parse(settingsText, mapFile, 1);
    const data = parse(String(json), jsonFile);
    if (
        !object(data) ||
        !object(data.info) ||
        !object(data.settings) ||
        !object(data.pack) ||
        !object(data.grid)
    )
        fail(jsonFile, "expected an Azgaar Full JSON export");
    const info = data.info,
        settings = data.settings;
    if (header[0] !== VERSION) fail(mapFile, `saved map must use Azgaar ${VERSION}`);
    if (info.version !== VERSION || pin.version !== VERSION)
        fail(jsonFile, `export and pin must use Azgaar ${VERSION}`);
    const identity = String(info.mapId ?? ""),
        seed = String(info.seed ?? "");
    if (
        !identity ||
        !seed ||
        identity !== header[6] ||
        identity !== String(pin.mapId ?? "") ||
        seed !== header[3] ||
        seed !== String(pin.seed ?? "") ||
        Number(header[4]) !== info.width ||
        Number(header[5]) !== info.height ||
        info.width !== pin.width ||
        info.height !== pin.height
    )
        fail(jsonFile, "map identity, seed or dimensions differ from the saved map or pin");
    const units = mapSettings?.units;
    if (!object(units)) fail(mapFile, "saved map units are missing");
    const keys = [
        ["distanceUnit", units?.distance?.unit],
        ["distanceScale", units?.distance?.scale],
        ["areaUnit", units?.area?.unit],
        ["heightUnit", units?.height?.unit],
        ["heightExponent", units?.height?.exponent],
        ["temperatureScale", units?.temperature?.unit],
        ["populationRate", units?.population?.scale],
        ["urbanization", units?.population?.urbanization?.rate],
    ];
    if (keys.some(([, value]) => value === undefined))
        fail(mapFile, "saved map units are incomplete");
    if (
        !object(pin.units) ||
        keys.some(([key, value]) => settings[key] !== value || pin.units[key] !== value) ||
        !positive(settings.distanceScale) ||
        !positive(settings.populationRate) ||
        !positive(settings.urbanization)
    )
        fail(jsonFile, "map units or population scale differ from the saved map or pin");
    const table = (name) => {
        const records = data.pack[name];
        if (!Array.isArray(records)) fail(jsonFile, `pack.${name} is missing`);
        if (records.length > recordLimit) fail(jsonFile, `pack.${name} exceeds the record limit`);
        const byId = new Map();
        for (const entry of records) {
            if (!object(entry) || !integer(entry.i)) continue;
            if (byId.has(entry.i)) fail(jsonFile, `pack.${name} repeats ID ${entry.i}`);
            byId.set(entry.i, entry);
        }
        return byId;
    };
    const tables = Object.fromEntries(
        ["features", "biomes", "cultures", "states", "provinces", "burgs", "rivers", "routes"].map(
            (name) => [name, table(name)],
        ),
    );
    const cells = data.pack.cells,
        grid = data.grid.cells;
    if (
        !Array.isArray(cells) ||
        !cells.length ||
        !Array.isArray(grid) ||
        !grid.length ||
        !Array.isArray(data.pack.vertices)
    )
        fail(jsonFile, "packed cells, vertices and grid cells are required");
    const indexed = (entries, label) => {
        if (entries.length > recordLimit) fail(jsonFile, `${label} exceeds the record limit`);
        const result = new Map();
        for (const entry of entries) {
            if (!object(entry) || !integer(entry.i) || result.has(entry.i))
                fail(jsonFile, `${label} contains an invalid or repeated ID`);
            result.set(entry.i, entry);
        }
        return result;
    };
    const packed = indexed(cells, "packed cells"),
        climate = indexed(grid, "grid cells"),
        vertices = indexed(data.pack.vertices, "vertices");
    if (
        !object(mapping) ||
        !object(mapping.state) ||
        !integer(mapping.state.id) ||
        mapping.state.id === 0 ||
        !address(mapping.state.address) ||
        !object(mapping.cultures)
    )
        fail("mapping", "supply a state ID and polity address, and explicit culture mappings");
    const state = tables.states.get(mapping.state.id);
    if (!state || state.removed) fail(jsonFile, "mapped state is missing or removed");
    const chosen = cells.filter((cell) => cell.state === mapping.state.id);
    if (!chosen.length) fail(jsonFile, "mapped state has no cells");
    const ref = (tableName, id, label, optionalZero = true) => {
        if (!integer(id)) fail(jsonFile, `${label} is missing or invalid`);
        if (optionalZero && id === 0) return null;
        const item = tables[tableName].get(id);
        if (!item || item.removed)
            fail(jsonFile, `${label} refers to a missing or removed ${tableName} record`);
        return item;
    };
    for (const route of tables.routes.values()) {
        if (
            !address(route.group) ||
            !Array.isArray(route.points) ||
            route.points.length < 2 ||
            route.points.length > recordLimit ||
            !route.points.every(
                (point) =>
                    Array.isArray(point) &&
                    point.length === 3 &&
                    finite(point[0]) &&
                    finite(point[1]) &&
                    integer(point[2]) &&
                    packed.has(point[2]),
            ) ||
            (route.cells !== undefined &&
                (!Array.isArray(route.cells) ||
                    route.cells.length > recordLimit ||
                    !route.cells.every((id) => packed.has(id))))
        )
            fail(jsonFile, `route ${route.i} has invalid geometry or cell IDs`);
    }
    const normalized = chosen.map((cell) => {
        const g = climate.get(cell.g);
        if (!integer(cell.g) || !g || !finite(g.temp) || !finite(g.prec))
            fail(jsonFile, `cell ${cell.i} has no valid climate grid cell`);
        if (
            !Array.isArray(cell.p) ||
            cell.p.length !== 2 ||
            !cell.p.every(finite) ||
            !finite(cell.h) ||
            !finite(cell.area) ||
            cell.area < 0 ||
            !finite(cell.fl) ||
            cell.fl < 0 ||
            !finite(cell.pop) ||
            cell.pop < 0
        )
            fail(jsonFile, `cell ${cell.i} has incomplete geometry or terrain`);
        if (
            !Array.isArray(cell.v) ||
            cell.v.length < 3 ||
            cell.v.length > recordLimit ||
            new Set(cell.v).size !== cell.v.length ||
            !cell.v.every((id) => {
                const point = vertices.get(id)?.p;
                return Array.isArray(point) && point.length === 2 && point.every(finite);
            }) ||
            !Array.isArray(cell.c) ||
            cell.c.length > recordLimit ||
            !cell.c.every((id) => packed.has(id))
        )
            fail(jsonFile, `cell ${cell.i} has invalid vertices or neighbors`);
        const polygon = cell.v.map((id) => vertices.get(id).p);
        const twiceArea = polygon.reduce((sum, point, i) => {
            const next = polygon[(i + 1) % polygon.length];
            return sum + point[0] * next[1] - next[0] * point[1];
        }, 0);
        if (!finite(twiceArea) || twiceArea === 0)
            fail(jsonFile, `cell ${cell.i} has a degenerate polygon`);
        const biome = ref("biomes", cell.biome, `cell ${cell.i} biome`, false);
        const culture = ref("cultures", cell.culture, `cell ${cell.i} culture`);
        const cultureAddress = culture ? mapping.cultures[String(cell.culture)] : null;
        if (culture && !address(cultureAddress))
            fail("mapping", `cell ${cell.i} needs an explicit culture mapping`);
        const province = ref("provinces", cell.province, `cell ${cell.i} province`);
        const feature = ref("features", cell.f, `cell ${cell.i} feature`);
        const river = ref("rivers", cell.r, `cell ${cell.i} river`);
        const burg = ref("burgs", cell.burg, `cell ${cell.i} burg`);
        let burgCulture = null,
            burgCultureAddress = null;
        if (burg?.culture !== undefined && burg.culture !== null) {
            burgCulture = ref("cultures", burg.culture, `cell ${cell.i} burg culture`);
            burgCultureAddress = burgCulture ? mapping.cultures[String(burg.culture)] : null;
            if (burgCulture && !address(burgCultureAddress))
                fail("mapping", `cell ${cell.i} burg needs an explicit culture mapping`);
        }
        if (burg && burg.cell !== cell.i) fail(jsonFile, `cell ${cell.i} and its burg disagree`);
        if (
            burg &&
            burg.population !== undefined &&
            (!finite(burg.population) || burg.population < 0)
        )
            fail(jsonFile, `cell ${cell.i} burg population is invalid`);
        if (cell.routes !== undefined && !object(cell.routes))
            fail(jsonFile, `cell ${cell.i} route links are invalid`);
        const routeLinks = Object.entries(cell.routes ?? {}).map(([neighbor, routeId]) => {
            if (
                !/^\d+$/.test(neighbor) ||
                !packed.has(Number(neighbor)) ||
                !integer(routeId) ||
                !tables.routes.has(routeId)
            )
                fail(jsonFile, `cell ${cell.i} has an invalid route link`);
            return { neighbor: Number(neighbor), route: tables.routes.get(routeId) };
        });
        return {
            id: cell.i,
            gridId: cell.g,
            center: cell.p,
            boundary: polygon,
            neighbors: cell.c,
            rawArea: cell.area,
            area: cell.area * settings.distanceScale ** 2,
            elevationScale: cell.h,
            temperatureCelsius: g.temp,
            precipitation100mm: g.prec,
            biome,
            culture,
            cultureAddress,
            state,
            polityAddress: mapping.state.address,
            province,
            feature,
            coast: cell.t,
            river,
            flux: cell.fl,
            burg,
            burgCultureId: burg?.culture ?? null,
            burgCulture,
            burgCultureAddress,
            ruralPopulation: cell.pop * settings.populationRate,
            urbanPopulation:
                !burg ? 0
                : burg.population === undefined ? null
                : burg.population * settings.populationRate * settings.urbanization,
            routeLinks,
        };
    });
    return {
        mapId: identity,
        seed,
        version: VERSION,
        mapHash: pin.mapHash,
        jsonHash: pin.jsonHash,
        units: { ...pin.units },
        state,
        cells: normalized,
        routes: [...tables.routes.values()],
        rivers: [...tables.rivers.values()],
    };
}
