/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */

/** Household-first calculations for explicit settlement authoring. @module */
import defaults from "./settlement-model-defaults.json" with { type: "json" };

/** Editable starting figures for the settlement calculations. */
export const SETTLEMENT_MODEL_DEFAULTS = defaults;
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const nonnegative = (n) => finite(n) && n >= 0;
const ratio = (n) => finite(n) && n >= 0 && n <= 1;
const count = (n) => Number.isSafeInteger(n) && n >= 0;
const requireValue = (condition, message) => {
    if (!condition) throw new RangeError(message);
};
const checked = (value, label) => {
    requireValue(finite(value), `${label} is not representable`);
    return value;
};
const shares = (values, length) =>
    Array.isArray(values) &&
    values.length === length &&
    values.every(ratio) &&
    Math.abs(values.reduce((a, b) => a + b, 0) - 1) < 1e-9;

/**
 * Round an estimated population to two significant figures.
 * @param {number} value - Estimated people.
 * @returns {number} Rounded estimate.
 */
export function roundPopulation(value) {
    requireValue(nonnegative(value), "population must be nonnegative");
    const rounded = Math.round(Number(value.toPrecision(2)));
    requireValue(count(rounded), "rounded population is not a safely representable whole number");
    return rounded;
}

/**
 * Calculate a settlement from its households and explicit land and cultural inputs.
 * @param {object} input - Household count, household size, land and selected policies.
 * @param {object} [config] - Editable model figures.
 * @returns {object} Population, food and public support, or an unknown count.
 */
export function calculateSettlement(input, config = defaults) {
    requireValue(input && typeof input === "object", "settlement input is required");
    if (!Object.hasOwn(input, "households") || input.households === null) {
        const result =
            !Object.hasOwn(input, "households") ?
                { status: "omitted" }
            :   { status: "unknown", households: null };
        if (Object.hasOwn(input, "population")) result.authoredPopulation = input.population;
        return result;
    }
    requireValue(count(input.households), "households must be a nonnegative whole number");
    requireValue(
        finite(input.householdSize) && input.householdSize > 0,
        "a positive culture household size is required",
    );
    requireValue(
        nonnegative(input.areaAcres) && finite(input.holdingAcres) && input.holdingAcres > 0,
        "area and a positive household holding are required",
    );
    requireValue(
        Array.isArray(input.land) &&
            input.land.length === 4 &&
            input.land.every((n) => Number.isInteger(n) && n >= 0 && n <= 9),
        "land ratings must contain four values from 0 to 9",
    );
    requireValue(
        finite(input.development) && input.development > 0,
        "development must be positive",
    );
    requireValue(
        ratio(input.obligation) && ratio(input.upwardShare),
        "obligation and upward shares must be between zero and one",
    );
    requireValue(typeof input.urban === "boolean", "urban status is required");
    const food = config.food?.[input.foodApproach];
    const focus =
        Object.hasOwn(input, "economicFocus") ? input.economicFocus : input.defaultEconomicFocus;
    const mix = input.householdMix ?? config.livelihoods?.[focus];
    const budgetShares = input.governanceShares ?? config.governance?.[input.governance];
    requireValue(
        food &&
            Array.isArray(food.yields) &&
            food.yields.length === 4 &&
            food.yields.every(nonnegative) &&
            finite(food.perPerson) &&
            food.perPerson > 0,
        "a valid food approach is required",
    );
    requireValue(shares(mix, 3), "livelihood household shares must sum to one");
    requireValue(shares(budgetShares, 6), "governance shares must sum to one");
    requireValue(
        Array.isArray(config.ratingCurve) &&
            config.ratingCurve.length === 10 &&
            config.ratingCurve.every(nonnegative),
        "ten nonnegative land multipliers are required",
    );
    const upkeep = input.urban ? config.urbanUpkeep : config.ruralUpkeep;
    requireValue(finite(upkeep) && upkeep > 0, "food upkeep must be positive");
    const populationExact = checked(input.households * input.householdSize, "population");
    const landYield = checked(
        food.yields.reduce(
            (sum, value, i) =>
                checked(
                    sum + checked(value * config.ratingCurve[input.land[i]], "land yield"),
                    "land yield",
                ),
            0,
        ) * input.development,
        "land yield",
    );
    const baseYield = food.yields.reduce((a, b) => checked(a + b, "base yield"), 0);
    const quality = baseYield ? checked(landYield / baseYield, "land quality") : 0;
    const producerPeople = checked(populationExact * mix[0], "producer population");
    const workerYield = checked(
        checked(producerPeople * food.perPerson, "worker yield") * (food.mobile ? 1 : quality),
        "worker yield",
    );
    const landLimit = checked(
        checked(landYield * input.areaAcres, "land production") / 100,
        "land production",
    );
    const production = Math.min(workerYield, landLimit);
    const need = checked(populationExact * upkeep, "food need");
    const producerNeed = checked(producerPeople * upkeep, "producer food need");
    const obligation = Math.min(
        production * input.obligation,
        Math.max(0, production - producerNeed),
    );
    const upward = obligation * input.upwardShare;
    const local = obligation - upward;
    const keys = ["leadership", "order", "defense", "faith", "welfare", "works"];
    const budgets = Object.fromEntries(keys.map((key, i) => [key, local * budgetShares[i]]));
    const roleHouseholds = Object.fromEntries(
        keys.slice(0, 4).map((key) => {
            const cost = config.roleCost?.[key];
            requireValue(finite(cost) && cost > 0, `positive ${key} support cost is required`);
            const householdCost = checked(input.householdSize * cost, `${key} household cost`);
            requireValue(householdCost > 0, `${key} household cost is not representable`);
            return [key, checked(budgets[key] / householdCost, `${key} households`)];
        }),
    );
    const support = Object.values(roleHouseholds).reduce(
        (a, b) => checked(a + b, "supported households"),
        0,
    );
    const nonProducing = input.households * (1 - mix[0]);
    if (support > nonProducing && support > 0)
        for (const key of Object.keys(roleHouseholds))
            roleHouseholds[key] *= nonProducing / support;
    const capacity = Math.floor(
        checked(input.areaAcres / input.holdingAcres, "household capacity"),
    );
    requireValue(count(capacity), "household capacity is not a safely representable whole number");
    const result = {
        status: "calculated",
        households: input.households,
        estimatedPopulation: roundPopulation(populationExact),
        populationExact,
        economicFocus: focus,
        capacity,
        production,
        need,
        balanceBeforeExports: production - need,
        balance: checked(production - need - upward, "food balance"),
        ruralOverCapacity: !input.urban && input.households > capacity,
        obligation,
        upward,
        local,
        budgets,
        roleHouseholds,
        explanation: {
            landYieldPer100Acres: landYield,
            landLimit,
            producerPeople,
            workerYield,
            householdSize: input.householdSize,
            upkeep,
            mix,
            budgetShares,
        },
    };
    if (Object.hasOwn(input, "population")) result.authoredPopulation = input.population;
    return result;
}

/**
 * Allocate a stated rural population over household capacities.
 * @param {number} population - People available for allocation.
 * @param {object[]} cells - Capacities and culture household sizes.
 * @returns {object} Allocations and unallocated people.
 */
export function distributeRuralPopulation(population, cells) {
    requireValue(nonnegative(population), "rural population must be nonnegative");
    requireValue(Array.isArray(cells), "cells must be a list");
    for (const c of cells)
        requireValue(
            count(c.capacity) && finite(c.householdSize) && c.householdSize > 0,
            "each cell needs a capacity and household size",
        );
    const totalCapacity = cells.reduce(
        (sum, c) =>
            checked(
                sum + checked(c.capacity * c.householdSize, "cell population capacity"),
                "total population capacity",
            ),
        0,
    );
    const fraction =
        totalCapacity === 0 ? 0
        : population >= totalCapacity ? 1
        : population / totalCapacity;
    const allocation = cells.map((c) => ({
        id: c.id,
        households: Math.floor(c.capacity * fraction),
    }));
    let allocated = allocation.reduce(
        (sum, a, i) =>
            checked(
                sum + checked(a.households * cells[i].householdSize, "allocated population"),
                "allocated population",
            ),
        0,
    );
    for (const [i, cell] of cells.entries()) {
        const room = cell.capacity - allocation[i].households;
        const remaining = Math.max(0, population - allocated);
        const available = checked(room * cell.householdSize, "remaining cell capacity");
        const extra =
            remaining >= available ? room : (
                Math.min(room, Math.floor(remaining / cell.householdSize))
            );
        requireValue(count(extra), "allocated households are not safely representable");
        allocation[i].households += extra;
        allocated = checked(
            allocated + checked(extra * cell.householdSize, "allocated population"),
            "allocated population",
        );
    }
    return {
        allocation,
        allocatedPopulation: allocated,
        unallocatedPopulation: Math.max(0, population - allocated),
        capacityPopulation: totalCapacity,
    };
}

/**
 * Deliver available surplus along stated routes without spending a source twice.
 * @param {object[]} sources - Named food sources and their available surplus.
 * @param {object[]} demands - Food needs and explicit routes to sources.
 * @param {object} [config] - Editable model figures.
 * @returns {object} Deliveries, unmet needs and remaining surplus.
 */
export function deliverFood(sources, demands, config = defaults) {
    const remaining = new Map();
    for (const source of sources) {
        requireValue(
            typeof source.id === "string" &&
                !remaining.has(source.id) &&
                nonnegative(source.surplus),
            "sources need unique IDs and nonnegative surplus",
        );
        remaining.set(source.id, source.surplus);
    }
    const results = demands.map((demand) => {
        requireValue(
            nonnegative(demand.need) && Array.isArray(demand.routes),
            "demand needs a nonnegative amount and routes",
        );
        let outstanding = demand.need;
        const deliveries = [];
        for (const route of demand.routes) {
            const loss = config.haulLoss?.[route.mode];
            requireValue(
                remaining.has(route.source) && nonnegative(route.leagues) && nonnegative(loss),
                "route needs a known source, distance and haul loss",
            );
            const fraction = 1 - checked(loss * route.leagues, "route loss");
            if (fraction <= 0.5 || outstanding <= 0) continue;
            const available = checked(remaining.get(route.source) * fraction, "deliverable food");
            const sent =
                outstanding >= available ?
                    remaining.get(route.source)
                :   checked(outstanding / fraction, "sent food");
            remaining.set(route.source, remaining.get(route.source) - sent);
            outstanding -= sent * fraction;
            deliveries.push({ source: route.source, sent, delivered: sent * fraction });
        }
        return { id: demand.id, need: demand.need, deliveries, unmet: Math.max(0, outstanding) };
    });
    return { demands: results, remaining: Object.fromEntries(remaining) };
}
