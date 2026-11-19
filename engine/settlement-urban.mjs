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

/** Urban food-supply proposals from explicit map and route bindings. @module */
import { deliverFood, roundPopulation, SETTLEMENT_MODEL_DEFAULTS } from "./settlement-model.mjs";

const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v) => typeof v === "string" && v.trim().length > 0;
const number = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const count = (v) => Number.isSafeInteger(v) && v >= 0;
const own = (v, k) => Object.hasOwn(v, k);
const fail = (message) => {
    throw new RangeError(message);
};
const checked = (value, message) => {
    if (!number(value)) fail(message);
    return value;
};

function sourceKey(source, mapId) {
    if (
        !object(source) ||
        source.mapId !== mapId ||
        !["cell", "burg"].includes(source.kind) ||
        !count(source.id) ||
        Object.keys(source).some((k) => !["mapId", "kind", "id", "slot"].includes(k)) ||
        (source.kind === "burg" && own(source, "slot")) ||
        (source.kind === "cell" && own(source, "slot") && !count(source.slot))
    )
        fail("invalid urban map identity");
    return JSON.stringify([
        source.mapId,
        source.kind,
        source.id,
        source.kind === "cell" ? (source.slot ?? 0) : null,
    ]);
}

/**
 * Calculate urban food needs and allocate explicitly authorized food routes.
 * @param {object} input - Normalized map, bound cities, sources, routes and subordinate totals.
 * @param {object} [config] - Editable settlement model figures.
 * @returns {object} Preserved facts, estimates, deliveries and missing inputs.
 */
export function proposeUrbanSupply(input, config = SETTLEMENT_MODEL_DEFAULTS) {
    if (
        !object(input) ||
        !object(input.map) ||
        !text(input.map.mapId) ||
        !Array.isArray(input.map.cells) ||
        !Array.isArray(input.cities) ||
        !Array.isArray(input.sources) ||
        !Array.isArray(input.routes) ||
        !Array.isArray(input.subpolities)
    )
        fail("map, cities, sources, routes and subpolities are required");
    const cells = new Map(),
        childCells = new Map(),
        children = new Set();
    for (const cell of input.map.cells) {
        if (!object(cell) || !count(cell.id) || cells.has(cell.id))
            fail("map cell identities must be unique");
        cells.set(cell.id, cell);
    }
    let reserved = 0,
        unknownChild = false;
    const missing = [];
    for (const child of input.subpolities) {
        if (
            !object(child) ||
            !text(child.address) ||
            children.has(child.address) ||
            !Array.isArray(child.cellIds)
        )
            fail("subpolity needs a unique address, cells and urban population");
        children.add(child.address);
        for (const id of child.cellIds) {
            if (!cells.has(id) || childCells.has(id))
                fail("subpolity cell bindings must exist and be unique");
            childCells.set(id, child.address);
        }
        if (child.urbanPopulation == null) {
            missing.push({ identity: child.address, field: "urbanPopulation" });
            unknownChild = true;
        } else {
            if (!number(child.urbanPopulation))
                fail("subpolity urban population must be nonnegative");
            reserved = checked(
                reserved + child.urbanPopulation,
                "reserved population is not representable",
            );
        }
    }
    if (input.urbanPopulation !== undefined && !number(input.urbanPopulation))
        fail("urban population must be nonnegative");
    const seenSources = new Set(),
        seenFacts = new Set(),
        prepared = [];
    for (const city of input.cities) {
        if (
            !object(city) ||
            !text(city.identity) ||
            seenFacts.has(city.identity) ||
            !count(city.cellId) ||
            !cells.has(city.cellId)
        )
            fail("cities need unique explicit identities and mapped cells");
        seenFacts.add(city.identity);
        const key = sourceKey(city.source, input.map.mapId);
        if (seenSources.has(key)) fail("duplicate urban map identity");
        seenSources.add(key);
        const cell = cells.get(city.cellId);
        if (
            (city.source.kind === "cell" && city.source.id !== cell.id) ||
            (city.source.kind === "burg" && city.source.id !== cell.burg?.i)
        )
            fail("urban identity does not match its mapped cell");
        const child = childCells.get(cell.id);
        if (
            city.subpolity !== undefined &&
            (!children.has(city.subpolity) || city.subpolity !== child)
        )
            fail("urban subpolity conflicts with its mapped cell");
        const fact = city.fact;
        if (fact !== undefined && !object(fact)) fail("authored city facts must be a map");
        if (fact?.identity !== undefined && fact.identity !== city.identity)
            fail("city identity conflicts with its authored fact");
        if (
            fact?.generatorSource !== undefined &&
            sourceKey(fact.generatorSource, input.map.mapId) !== key
        )
            fail("city source conflicts with its authored fact");
        if (child) continue;
        const cultureAddress =
            city.cultureAddress ??
            (city.source.kind === "burg" ? cell.burgCultureAddress : cell.cultureAddress);
        const householdSize = city.householdSize ?? input.cultureSizes?.[cultureAddress];
        let people, households, kind;
        if (fact && own(fact, "households")) {
            if (fact.households === null)
                missing.push({ identity: city.identity, field: "households" });
            else {
                if (!count(fact.households))
                    fail("authored households must be a nonnegative whole number");
                households = fact.households;
                if (households === 0) people = 0;
                else if (!text(cultureAddress) || !number(householdSize) || householdSize === 0)
                    missing.push({ identity: city.identity, field: "householdSize" });
                else
                    people = checked(
                        households * householdSize,
                        "urban population is not representable",
                    );
            }
            kind = "authored households";
        } else if (fact && own(fact, "population")) {
            if (fact.population === null)
                missing.push({ identity: city.identity, field: "population" });
            else if (!number(fact.population))
                fail("authored population must be nonnegative or unknown");
            else people = fact.population;
            kind = "authored population";
        } else if (fact) {
            missing.push({ identity: city.identity, field: "population or households" });
            kind = "authored unknown";
        } else {
            if (city.source.kind !== "burg" || !number(cell.urbanPopulation))
                missing.push({ identity: city.identity, field: "map urban population estimate" });
            else if (!text(cultureAddress) || !number(householdSize) || householdSize === 0)
                missing.push({ identity: city.identity, field: "householdSize" });
            else {
                households = Math.round(cell.urbanPopulation / householdSize);
                if (!count(households)) fail("estimated households are not representable");
                people = checked(
                    households * householdSize,
                    "urban population is not representable",
                );
            }
            kind = "map estimate";
        }
        if (fact && people !== undefined)
            reserved = checked(reserved + people, "reserved population is not representable");
        prepared.push({
            city,
            cell,
            fact,
            householdSize,
            cultureAddress,
            households,
            people,
            kind,
        });
    }
    const unknownAuthored =
        unknownChild || prepared.some((entry) => entry.fact && entry.people === undefined);
    const total = input.urbanPopulation;
    if (total !== undefined && reserved > total)
        fail("authored urban population exceeds the stated urban total");
    let budget = total === undefined ? null : total - reserved;
    for (const entry of prepared) {
        if (entry.fact || entry.people === undefined || budget === null) continue;
        if (unknownAuthored) {
            missing.push({ identity: entry.city.identity, field: "urban population reservation" });
            entry.people = undefined;
            entry.households = undefined;
            continue;
        }
        entry.households = Math.min(entry.households, Math.floor(budget / entry.householdSize));
        entry.people = checked(
            entry.households * entry.householdSize,
            "urban population is not representable",
        );
        budget = Math.max(0, budget - entry.people);
    }
    const stocks = new Map(),
        cargo = new Map(),
        routes = new Map();
    for (const source of input.sources) {
        if (!object(source) || !text(source.id) || stocks.has(source.id))
            fail("food sources need unique IDs and nonnegative food surplus");
        if (source.foodSurplus == null) {
            missing.push({ identity: source.id, field: "foodSurplus" });
            stocks.set(source.id, null);
        } else {
            if (!number(source.foodSurplus)) fail("food surplus must be nonnegative");
            stocks.set(source.id, source.foodSurplus);
        }
    }
    for (const route of input.routes) {
        if (
            !object(route) ||
            !text(route.id) ||
            routes.has(route.id) ||
            !stocks.has(route.source) ||
            !seenFacts.has(route.city)
        )
            fail("routes need unique IDs and bound source and city");
        routes.set(route.id, route);
        if (route.maxCargo != null && !number(route.maxCargo))
            fail("route cargo must be nonnegative");
        cargo.set(route.id, route.maxCargo);
    }
    if (!number(config.urbanUpkeep) || config.urbanUpkeep === 0)
        fail("urban food upkeep must be positive");
    const cities = prepared.map((entry) => {
        const { city, fact, people, households, kind, cultureAddress } = entry;
        const result = {
            identity: city.identity,
            source: city.source,
            cultureAddress,
            fact,
            populationSource: kind,
            households,
            populationExact: people,
            estimatedPopulation: people === undefined ? undefined : roundPopulation(people),
        };
        if (people === undefined) return result;
        const need = checked(people * config.urbanUpkeep, "urban food need is not representable");
        if (city.localFood === undefined || city.localFood === null) {
            missing.push({ identity: city.identity, field: "localFood" });
            return { ...result, need };
        }
        if (!number(city.localFood)) fail("local food must be nonnegative");
        let unmet = Math.max(0, need - city.localFood);
        const deliveries = [];
        if (unmet > 0 && !input.routes.some((route) => route.city === city.identity))
            missing.push({ identity: city.identity, field: "food supply routes" });
        for (const route of input.routes.filter((item) => item.city === city.identity)) {
            if (route.access !== true) {
                if (route.access !== false)
                    missing.push({ identity: city.identity, field: `route ${route.id} access` });
                continue;
            }
            if (!text(route.mode) || !number(route.leagues) || cargo.get(route.id) == null) {
                missing.push({
                    identity: city.identity,
                    field: `route ${route.id} mode, distance or cargo`,
                });
                continue;
            }
            if (stocks.get(route.source) === null) continue;
            const available = Math.min(stocks.get(route.source), cargo.get(route.id));
            const delivery = deliverFood(
                [{ id: route.source, surplus: available }],
                [
                    {
                        id: city.identity,
                        need: unmet,
                        routes: [
                            { source: route.source, mode: route.mode, leagues: route.leagues },
                        ],
                    },
                ],
                config,
            ).demands[0];
            for (const part of delivery.deliveries) {
                stocks.set(route.source, Math.max(0, stocks.get(route.source) - part.sent));
                cargo.set(route.id, Math.max(0, cargo.get(route.id) - part.sent));
                deliveries.push({ route: route.id, ...part });
            }
            unmet = delivery.unmet;
        }
        return { ...result, need, localFood: city.localFood, deliveries, unmet };
    });
    return {
        cities,
        reservedPopulation: reserved,
        unallocatedUrbanPopulation: unknownAuthored ? null : budget,
        missing,
        remainingFood: Object.fromEntries(stocks),
        remainingCargo: Object.fromEntries(cargo),
    };
}
