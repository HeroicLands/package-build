/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */

/** Explicit settlement proposals from mapped cells and authored facts. @module */
import { calculateSettlement, distributeRuralPopulation } from "./settlement-model.mjs";

const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const count = (v) => Number.isSafeInteger(v) && v >= 0;
const positive = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
const nonnegative = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const text = (v) => typeof v === "string" && v.trim().length > 0;
const fail = (message) => {
    throw new RangeError(message);
};
const has = (v, k) => Object.hasOwn(v, k);

function identity(source, mapId) {
    if (
        !object(source) ||
        Object.keys(source).some((key) => !["mapId", "kind", "id", "slot"].includes(key)) ||
        source.mapId !== mapId ||
        !["cell", "burg"].includes(source.kind) ||
        !count(source.id) ||
        (source.kind === "burg" && has(source, "slot")) ||
        (source.kind === "cell" && has(source, "slot") && !count(source.slot))
    )
        fail("invalid or mismatched map source identity");
    return JSON.stringify([
        source.mapId,
        source.kind,
        source.id,
        source.kind === "cell" ? (source.slot ?? 0) : null,
    ]);
}

function matches(rule, cell) {
    if (!object(rule) || !object(rule.when) || !object(rule.profile))
        fail("land rules require a condition and profile");
    const when = rule.when;
    const allowed = [
        "biome",
        "minimumElevation",
        "maximumElevation",
        "river",
        "coast",
        "routeGroup",
    ];
    if (Object.keys(when).some((key) => !allowed.includes(key)))
        fail("unknown land rule condition");
    if (has(when, "biome") && when.biome !== cell.biome?.i) return false;
    if (has(when, "minimumElevation") && !(cell.elevationScale >= when.minimumElevation))
        return false;
    if (has(when, "maximumElevation") && !(cell.elevationScale <= when.maximumElevation))
        return false;
    if (has(when, "river") && Boolean(cell.river) !== when.river) return false;
    if (has(when, "coast") && (cell.coast === 1) !== when.coast) return false;
    if (
        has(when, "routeGroup") &&
        !(cell.routeLinks ?? []).some((link) => link.route?.group === when.routeGroup)
    )
        return false;
    return true;
}

/**
 * Propose rural household allocations for explicitly bound map placements.
 * @param {object} input - Normalized map, rural total, bindings, existing facts and declared rules.
 * @param {object} [config] - Editable settlement model figures.
 * @returns {object} Preserved facts, proposals and unplaced population.
 */
export function proposeSettlements(input, config) {
    if (
        !object(input) ||
        !object(input.map) ||
        !text(input.map.mapId) ||
        !Array.isArray(input.map.cells)
    )
        fail("a normalized map with identity and cells is required");
    if (
        !Array.isArray(input.placements) ||
        !Array.isArray(input.existing) ||
        !Array.isArray(input.subpolities) ||
        !object(input.cultureSizes) ||
        !Array.isArray(input.landRules)
    )
        fail("placements, existing facts, subpolities, culture sizes and land rules are required");
    const mapId = input.map.mapId;
    const cells = new Map();
    for (const cell of input.map.cells) {
        if (!object(cell) || !count(cell.id) || cells.has(cell.id))
            fail("map cell identities must be unique");
        cells.set(cell.id, cell);
    }
    let ruralPopulation = input.ruralPopulation;
    let populationSource = "declared";
    if (ruralPopulation === undefined) {
        if (input.subpolities.length)
            fail("map estimates need an explicit rural total when subpolities are present");
        ruralPopulation = input.map.cells.reduce((sum, cell) => {
            if (!nonnegative(cell.ruralPopulation) || !Number.isFinite(sum + cell.ruralPopulation))
                fail("map rural population is missing or invalid");
            return sum + cell.ruralPopulation;
        }, 0);
        populationSource = "map estimate";
    }
    if (!nonnegative(ruralPopulation)) fail("rural population must be finite and nonnegative");
    const seen = new Set(),
        noteBindings = new Set(),
        areas = new Map();
    const existingBySource = new Map();
    const subordinateCells = new Set();
    const reserved = [];
    let reservedPopulation = 0;
    const reserve = (value) => {
        if (!nonnegative(value) || !Number.isFinite(reservedPopulation + value))
            fail("reserved population must be finite and nonnegative");
        reservedPopulation += value;
    };
    for (const sub of input.subpolities) {
        if (!text(sub.address) || noteBindings.has(sub.address))
            fail("subpolity bindings must be unique");
        noteBindings.add(sub.address);
        if (!Array.isArray(sub.cellIds))
            fail(`subpolity ${sub.address} needs explicit cell bindings`);
        for (const id of sub.cellIds) {
            if (!cells.has(id) || subordinateCells.has(id))
                fail("subpolity cell bindings must exist and be unique");
            subordinateCells.add(id);
        }
        if (!nonnegative(sub.ruralPopulation))
            fail(`subpolity ${sub.address} needs a rural population`);
        reserve(sub.ruralPopulation);
    }
    for (const fact of input.existing) {
        if (!object(fact) || !text(fact.identity) || seen.has(fact.identity))
            fail("existing fact identities must be explicit and unique");
        seen.add(fact.identity);
        if (fact.subpolity !== undefined) {
            if (!noteBindings.has(fact.subpolity))
                fail("existing fact refers to an unbound subpolity");
            continue;
        }
        if (fact.source !== undefined) {
            const key = identity(fact.source, mapId);
            if (existingBySource.has(key)) fail("duplicate existing map identity");
            existingBySource.set(key, fact);
        }
        if (fact.urban === true) continue;
        if (fact.urban !== false)
            fail(`existing fact ${fact.identity} needs rural or urban status`);
        if (has(fact, "households")) {
            if (fact.households === null)
                fail(`existing fact ${fact.identity} has unknown households`);
            if (!count(fact.households) || !positive(fact.householdSize))
                fail(`existing fact ${fact.identity} needs a household count and culture size`);
            reserve(fact.households * fact.householdSize);
        } else {
            if (!nonnegative(fact.population))
                fail(`existing fact ${fact.identity} needs a population or household count`);
            reserve(fact.population);
        }
        reserved.push(fact.identity);
    }
    if (reservedPopulation > ruralPopulation)
        fail("reserved rural population exceeds the stated rural total");
    const sources = new Set(),
        placements = [];
    for (const placement of input.placements) {
        if (!object(placement) || !count(placement.cellId) || !cells.has(placement.cellId))
            fail("placement requires a mapped cell");
        const cell = cells.get(placement.cellId),
            source = placement.source;
        if (subordinateCells.has(cell.id)) fail(`cell ${cell.id} belongs to a subpolity`);
        const key = identity(source, mapId);
        if (sources.has(key)) fail("duplicate placement map identity");
        sources.add(key);
        if (source.kind === "cell" && source.id !== cell.id)
            fail("cell identity does not match its placement");
        if (source.kind === "burg" && source.id !== cell.burg?.i)
            fail("burg identity does not match its mapped cell");
        if (placement.noteAddress !== undefined) {
            if (!text(placement.noteAddress) || noteBindings.has(placement.noteAddress))
                fail("note bindings must be unique");
            noteBindings.add(placement.noteAddress);
            if (!seen.has(placement.noteAddress)) fail("a note binding must name an existing fact");
        }
        const matchedSource = existingBySource.get(key);
        if (
            placement.noteAddress !== undefined &&
            seen.has(placement.noteAddress) &&
            matchedSource &&
            matchedSource.identity !== placement.noteAddress
        )
            fail("map identity and note binding refer to different existing facts");
        if (!nonnegative(placement.areaAcres) || !nonnegative(placement.cellAreaAcres))
            fail(`cell ${cell.id} needs explicit acreage`);
        const previous = areas.get(cell.id) ?? { area: 0, total: placement.cellAreaAcres };
        if (
            previous.total !== placement.cellAreaAcres ||
            !Number.isFinite(previous.area + placement.areaAcres) ||
            previous.area + placement.areaAcres > previous.total
        )
            fail(`cell ${cell.id} placement acreage exceeds its declared area`);
        previous.area += placement.areaAcres;
        areas.set(cell.id, previous);
        if (
            matchedSource ||
            (placement.noteAddress !== undefined && seen.has(placement.noteAddress))
        )
            continue;
        const rules = input.landRules.filter((rule) => matches(rule, cell));
        if (rules.length !== 1)
            fail(`cell ${cell.id} needs exactly one matching declared land rule`);
        const cultureAddress =
            source.kind === "burg" ? cell.burgCultureAddress : cell.cultureAddress;
        if (!text(cultureAddress) || !positive(input.cultureSizes[cultureAddress]))
            fail(`cell ${cell.id} needs a mapped culture household size`);
        const profile = {
            ...rules[0].profile,
            ...(placement.profile ?? {}),
            households: 0,
            householdSize: input.cultureSizes[cultureAddress],
            areaAcres: placement.areaAcres,
            urban: false,
        };
        const baseline = calculateSettlement(profile, config);
        placements.push({
            source,
            key,
            cell,
            cultureAddress,
            profile,
            capacity: baseline.capacity,
        });
    }
    for (const [key, fact] of existingBySource) {
        if (fact.source.kind === "cell" && areas.has(fact.source.id) && !sources.has(key))
            fail(`cell ${fact.source.id} needs a placement for its existing settlement`);
        if (fact.source.kind === "burg") {
            const cell = input.map.cells.find((item) => item.burg?.i === fact.source.id);
            if (cell && areas.has(cell.id) && !sources.has(key))
                fail(`cell ${cell.id} needs a placement for its existing burg`);
        }
    }
    const remaining = ruralPopulation - reservedPopulation;
    const distribution = distributeRuralPopulation(
        remaining,
        placements.map((p) => ({
            id: p.key,
            capacity: p.capacity,
            householdSize: p.profile.householdSize,
        })),
    );
    const proposals = placements.map((p, i) => ({
        source: p.source,
        cellId: p.cell.id,
        polityAddress: p.cell.polityAddress,
        cultureAddress: p.cultureAddress,
        calculation: calculateSettlement(
            { ...p.profile, households: distribution.allocation[i].households },
            config,
        ),
    }));
    const inhabited = proposals.filter((proposal) => proposal.calculation.households > 0);
    return {
        existing: input.existing,
        populationSource,
        ruralPopulation,
        reserved,
        reservedPopulation,
        proposedPopulation: distribution.allocatedPopulation,
        unallocatedPopulation: distribution.unallocatedPopulation,
        proposals: inhabited,
    };
}
