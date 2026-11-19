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

/** Geometric accounting for candidate settlement sites. @module */
import { discoverPlacementSites, placementGridInterval } from "./settlement-placement.mjs";
import { prepareSettlementInputs, settlementCellAreaConversion } from "./settlement-inputs.mjs";
import { matchesLandRule, proposeSettlements } from "./settlement-generate.mjs";
import { distributeRuralPopulation, roundPopulation } from "./settlement-model.mjs";
import { createSettlementMembership } from "./settlement-tables.mjs";
import { settlementBands } from "./settlement-bands.mjs";

const area = (polygon) => {
    let twice = 0;
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i],
            b = polygon[(i + 1) % polygon.length];
        twice +=
            (a[0] - polygon[0][0]) * (b[1] - polygon[0][1]) -
            (b[0] - polygon[0][0]) * (a[1] - polygon[0][1]);
    }
    return Math.abs(twice) / 2;
};

function clip(polygon, axis, bound, greater) {
    const result = [];
    if (!polygon.length) return result;
    const inside = (p) => (greater ? p[axis] >= bound : p[axis] <= bound);
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i],
            b = polygon[(i + 1) % polygon.length];
        const ai = inside(a),
            bi = inside(b);
        if (ai) result.push(a);
        if (ai !== bi) {
            const t = (bound - a[axis]) / (b[axis] - a[axis]);
            const p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
            p[axis] = bound;
            result.push(p);
        }
    }
    return result;
}

/**
 * Discover sites and measure each grid footprint within its owning cell.
 * The weights divide potential acreage; they do not describe surveyed land.
 * @param {object} input - Discovery inputs, including bounded work and output limits.
 * @returns {object} Provenance, weighted candidates, or missing inputs.
 */
export function measurePlacementFootprints(input) {
    const discovery = discoverPlacementSites(input);
    if (discovery.missing.length) return discovery;
    const interval = placementGridInterval(input.map.units, input.spacingMeters);
    const cells = new Map(input.map.cells.map((cell) => [cell.id, cell]));
    const totals = new Map();
    let work = 0;
    const candidates = [];
    const fail = (code, message) => ({
        ...discovery,
        candidates: [],
        missing: [{ code, message }],
    });
    for (const candidate of discovery.candidates) {
        const polygon = cells.get(candidate.cellId).boundary;
        // Four clipping passes can at most double the vertices in each pass.
        work += polygon.length * 31;
        if (!Number.isSafeInteger(work) || work > input.workLimit)
            return fail("work-limit", "footprint measurement exceeds the work limit");
        const whole = area(polygon);
        const half = interval / 2;
        let clipped = polygon;
        for (const [axis, bound, greater] of [
            [0, candidate.point[0] - half, true],
            [0, candidate.point[0] + half, false],
            [1, candidate.point[1] - half, true],
            [1, candidate.point[1] + half, false],
        ])
            clipped = clip(clipped, axis, bound, greater);
        const intersection = area(clipped);
        const weight = intersection / whole;
        if (!Number.isFinite(weight) || weight < 0 || weight > 1 + 1e-12)
            return fail("invalid-geometry", "footprint area cannot be represented reliably");
        const total = (totals.get(candidate.cellId) ?? 0) + weight;
        if (!Number.isFinite(total) || total > 1 + 1e-12)
            return fail("invalid-geometry", "footprints exceed their cell area");
        totals.set(candidate.cellId, total);
        candidates.push({ ...candidate, weight });
    }
    return { ...discovery, candidates, interval };
}

// Bound collection expansion, source scans and repeated membership/calculation passes.
// Map sizes and array lengths are charged before their iterators are opened.
function assemblyBudget(options, selection) {
    const limit = selection.workLimit;
    const session = options.session;
    const length = (value) => (Array.isArray(value) ? value.length : 0);
    const size = (value) => (value instanceof Map ? value.size : 0);
    const records = length(session?.records) + size(session?.foreign?.index);
    const placements = length(options.settings?.placements);
    let units = 1,
        text = 0,
        membershipWork = 0,
        reservedCandidates = 0;
    const requireBudget = (additional = reservedCandidates) => {
        reservedCandidates = Math.max(reservedCandidates, additional);
        // Captures are traversed linearly; placements can scan the record collection.
        const work =
            4 *
                (units +
                    text +
                    records * (placements + reservedCandidates + 1) +
                    reservedCandidates) +
            membershipWork;
        if (
            !Number.isSafeInteger(limit) ||
            limit < 1 ||
            !Number.isSafeInteger(work) ||
            work > limit
        )
            throw new RangeError("assembly exceeds the work limit");
    };
    const reserve = (value) => {
        if (!value || typeof value !== "object") return;
        units +=
            Array.isArray(value) ? value.length + 1
            : value instanceof Map ? 2 * value.size + 1
            : 1;
        requireBudget();
    };
    const roots = [
        session?.records,
        session?.parsed,
        session?.sources,
        session?.foreign?.index,
        session?.problems,
        session?.config?.contentPackage,
        session?.config?.paths?.metadataCache,
        session?.contentBase,
        options.polityAddress,
        options.map,
        options.settings,
        options.bindings,
        options.bands,
        selection.cellIds,
        selection.existingSites,
    ];
    requireBudget();
    for (const value of roots) reserve(value);
    function* entries(value) {
        if (value instanceof Map) {
            for (const [key, entry] of value) {
                yield key;
                yield (
                    value === session?.parsed ? entry?.frontmatter
                    : value === session?.sources ? entry?.raw
                    : entry
                );
            }
        } else if (Array.isArray(value)) {
            yield* value;
        } else {
            for (const key in value) {
                units++;
                requireBudget();
                if (!Object.hasOwn(value, key)) continue;
                yield key;
                yield value[key];
            }
        }
    }
    // Repeated references incur repeated traversal; active references are cycles.
    const active = new WeakSet();
    const pending = [{ iterator: roots.values(), owner: undefined }];
    while (pending.length) {
        const frame = pending.at(-1);
        const next = frame.iterator.next();
        if (next.done) {
            if (frame.owner) active.delete(frame.owner);
            pending.pop();
            continue;
        }
        const value = next.value;
        if (typeof value === "string" || Buffer.isBuffer(value)) {
            text += value.length;
            requireBudget();
        } else if (value && typeof value === "object") {
            if (active.has(value)) throw new RangeError("assembly input graph contains a cycle");
            reserve(value);
            active.add(value);
            pending.push({ iterator: entries(value), owner: value });
        }
    }
    return {
        requireBudget,
        charge(units) {
            membershipWork += units;
            requireBudget();
        },
    };
}

/**
 * Select rural sites from captured facts and assemble their calculation inputs.
 * Positions and acreage for existing settlements are explicit operation inputs.
 * @param {object} options - Arguments accepted by prepareSettlementInputs.
 * @param {object} selection - Direct cell IDs, known existing positions and discovery limits.
 * @returns {object} Assembled inputs, selection report and missing inputs.
 */
export function selectSettlementPlacements(options, selection) {
    const fail = (message) => ({ missing: [{ field: "selection", message }] });
    try {
        if (
            !selection ||
            !Array.isArray(selection.cellIds) ||
            !Array.isArray(selection.existingSites)
        )
            return fail("provide direct cell IDs and existing settlement positions");
        const { requireBudget: requireAssemblyBudget, charge } = assemblyBudget(options, selection);
        const membership = createSettlementMembership(
            options.session?.records,
            options.session?.foreign?.index ?? new Map(),
            options.session?.config?.contentPackage,
            charge,
        );
        const context = { membership, charge };
        const bands = settlementBands(options.bands);
        const rawPlacements = options.settings?.placements;
        // A declared physical total applies to every placement in its cell.
        if (Array.isArray(rawPlacements)) {
            const declared = new Map();
            for (const placement of rawPlacements) {
                if (!placement || !Object.hasOwn(placement, "cellAreaAcres")) continue;
                const amount = placement.cellAreaAcres;
                if (declared.has(placement.cellId) && declared.get(placement.cellId) !== amount)
                    return fail(`cell ${placement.cellId} has conflicting physical acreage`);
                declared.set(placement.cellId, amount);
            }
            options = {
                ...options,
                settings: {
                    ...options.settings,
                    placements: rawPlacements.map((placement) =>
                        (
                            placement &&
                            !Object.hasOwn(placement, "cellAreaAcres") &&
                            declared.has(placement.cellId)
                        ) ?
                            { ...placement, cellAreaAcres: declared.get(placement.cellId) }
                        :   placement,
                    ),
                },
            };
        }
        const initial = prepareSettlementInputs(options, context);
        if (!initial.ruralInput) return { ...initial, selection: undefined };
        const ids = new Set(selection.cellIds);
        if (
            ids.size !== selection.cellIds.length ||
            [...ids].some((id) => !Number.isSafeInteger(id) || id < 0)
        )
            return fail("direct cell IDs must be distinct nonnegative integers");
        const cells = options.map.cells
            .filter((cell) => ids.has(cell.id))
            .sort((a, b) => a.id - b.id);
        if (
            cells.length !== ids.size ||
            initial.subpolities.some((sub) => sub.cellIds.some((id) => ids.has(id)))
        )
            return fail("select mapped direct cells outside subordinate polities");
        const positions = new Map();
        for (const site of selection.existingSites) {
            if (typeof site?.identity !== "string" || positions.has(site.identity))
                return fail("existing positions need distinct settlement identities");
            positions.set(site.identity, site.point);
        }
        for (const fact of initial.existingFacts)
            if (!positions.has(fact.fact.identity))
                return fail(`existing settlement ${fact.fact.identity} needs an explicit position`);
        if (positions.size !== initial.existingFacts.length)
            return fail("existing positions must refer to captured settlements");
        const footprints = measurePlacementFootprints({
            map: { ...options.map, cells },
            existingSites: [...positions.values()].map((point) => ({ point })),
            spacingMeters: selection.spacingMeters,
            candidateLimit: selection.candidateLimit,
            workLimit: selection.workLimit,
        });
        if (footprints.missing.length)
            return {
                ...initial,
                selection: footprints,
                missing: [...initial.missing, ...footprints.missing],
            };
        const existing = options.settings?.placements;
        if (!Array.isArray(existing))
            return fail("provide explicit existing placements and acreage");
        const candidateCount = footprints.candidates.length;
        requireAssemblyBudget(candidateCount);
        const placementCount = existing.length + candidateCount;
        const work =
            2 *
                placementCount *
                (placementCount +
                    options.map.cells.length +
                    initial.ruralInput.landRules.length +
                    initial.existingFacts.length +
                    1) +
            cells.length +
            candidateCount * (initial.ruralInput.landRules.length + 55);
        if (!Number.isSafeInteger(work) || work > selection.workLimit)
            return fail("assembly and land rule matching exceed the work limit");
        const factSources = initial.existingFacts.map((entry) => ({
            identity: entry.fact.identity,
            source: entry.fact.source,
        }));
        const sameSource = (a, b) =>
            a &&
            b &&
            a.mapId === b.mapId &&
            a.kind === b.kind &&
            a.id === b.id &&
            (a.kind !== "cell" || (a.slot ?? 0) === (b.slot ?? 0));
        for (const placement of initial.resolvedPlacements) {
            if (
                !factSources.some(
                    (fact) =>
                        fact.identity === placement.noteAddress ||
                        sameSource(fact.source, placement.source),
                )
            )
                return fail("each existing placement must bind a captured settlement");
        }
        for (const entry of initial.existingFacts) {
            if (
                entry.cell &&
                ids.has(entry.cell.id) &&
                !initial.resolvedPlacements.some(
                    (placement) =>
                        placement.noteAddress === entry.fact.identity ||
                        sameSource(entry.fact.source, placement.source),
                )
            )
                return fail(
                    `existing settlement ${entry.fact.identity} needs explicit placement acreage`,
                );
        }
        const base = proposeSettlements(initial.ruralInput, options.settings.model);
        if (base.proposals.length)
            return fail("existing placements must bind captured settlements");
        const reserved = new Map();
        const physical = new Map();
        for (const p of initial.resolvedPlacements) {
            reserved.set(p.cellId, (reserved.get(p.cellId) ?? 0) + p.areaAcres);
            if (physical.has(p.cellId) && physical.get(p.cellId) !== p.cellAreaAcres)
                return fail(`cell ${p.cellId} has conflicting physical acreage`);
            physical.set(p.cellId, p.cellAreaAcres);
        }
        for (const cell of cells) {
            if (!physical.has(cell.id)) {
                const conversion = settlementCellAreaConversion(cell, options.map.units);
                if (!conversion) return fail(`cell ${cell.id} needs verified physical acreage`);
                physical.set(cell.id, conversion.acres);
            }
        }
        const cellsById = new Map(cells.map((cell) => [cell.id, cell]));
        const modeled = footprints.candidates.map((candidate) => {
            const cell = cellsById.get(candidate.cellId);
            const rules = initial.ruralInput.landRules.filter((rule) =>
                matchesLandRule(rule, cell),
            );
            if (rules.length !== 1)
                throw new RangeError(
                    `cell ${cell.id} needs exactly one matching declared land rule`,
                );
            const holding = rules[0].profile.holdingAcres;
            const householdSize = initial.cultureSizes[cell.cultureAddress];
            if (!(
                Number.isFinite(holding) &&
                holding > 0 &&
                Number.isFinite(householdSize) &&
                householdSize > 0
            ))
                throw new RangeError(
                    `cell ${cell.id} needs a positive holding and mapped culture household size`,
                );
            const physicalAcres = physical.get(cell.id);
            const used = reserved.get(cell.id) ?? 0;
            const ceiling = (physicalAcres - used) * candidate.weight;
            if (!Number.isFinite(ceiling) || ceiling < 0)
                throw new RangeError(`cell ${cell.id} has inconsistent acreage`);
            let capacity = Math.floor(ceiling / holding);
            if (!Number.isSafeInteger(capacity))
                throw new RangeError(`cell ${cell.id} capacity is not representable`);
            // The displayed population of a rural settlement is below the town band.
            let low = 0,
                high = capacity;
            while (low < high) {
                const middle = low + Math.ceil((high - low) / 2);
                if (roundPopulation(middle * householdSize) < bands.townAt) low = middle;
                else high = middle - 1;
            }
            capacity = low;
            return {
                ...candidate,
                physicalAcres,
                reservedAcres: used,
                ceilingAcres: ceiling,
                holdingAcres: holding,
                householdSize,
                capacity,
            };
        });
        const remainingPopulation = Math.max(0, base.ruralPopulation - base.reservedPopulation);
        const allocation = distributeRuralPopulation(
            remainingPopulation,
            modeled.map((entry, id) => ({
                id,
                capacity: entry.capacity,
                householdSize: entry.householdSize,
            })),
        );
        const displayedExisting = initial.existingFacts.reduce(
            (sum, entry) =>
                sum + (Number.isFinite(entry.fact.population) ? entry.fact.population : 0),
            0,
        );
        const displayedLimit = Math.max(
            0,
            Math.min(
                remainingPopulation,
                initial.polity.data.territorial_population - displayedExisting,
            ),
        );
        let allocatedPopulation = 0,
            displayedPopulation = 0;
        // Keep whole households within both the exact and displayed population ceilings.
        for (let i = 0; i < modeled.length; i++) {
            const size = modeled[i].householdSize;
            let low = 0,
                high = allocation.allocation[i].households;
            while (low < high) {
                const middle = low + Math.ceil((high - low) / 2);
                if (
                    allocatedPopulation + middle * size <= remainingPopulation &&
                    displayedPopulation + roundPopulation(middle * size) <= displayedLimit
                )
                    low = middle;
                else high = middle - 1;
            }
            allocation.allocation[i].households = low;
            allocatedPopulation += low * size;
            displayedPopulation += roundPopulation(low * size);
        }
        // Derive the remainder from final integer counts in the proposal's summation order.
        allocation.allocatedPopulation = allocatedPopulation;
        allocation.unallocatedPopulation = Math.max(0, remainingPopulation - allocatedPopulation);
        const chosen = [];
        for (let i = 0; i < modeled.length; i++) {
            const entry = modeled[i],
                households = allocation.allocation[i].households;
            entry.households = households;
            entry.areaAcres = households * entry.holdingAcres;
            if (
                !Number.isFinite(entry.areaAcres) ||
                entry.areaAcres > entry.ceilingAcres ||
                Math.floor(entry.areaAcres / entry.holdingAcres) !== households
            )
                throw new RangeError(
                    `cell ${entry.cellId} modeled acreage cannot represent its households`,
                );
            if (households)
                chosen.push({
                    cellId: entry.cellId,
                    areaAcres: entry.areaAcres,
                    cellAreaAcres: entry.physicalAcres,
                });
        }
        const assembled = prepareSettlementInputs(
            {
                ...options,
                settings: { ...options.settings, placements: [...existing, ...chosen] },
            },
            context,
        );
        if (!assembled.ruralInput) return { ...assembled, selection: footprints };
        const result = proposeSettlements(assembled.ruralInput, options.settings.model);
        const occupied = modeled.filter((entry) => entry.households);
        if (
            result.unallocatedPopulation !== allocation.unallocatedPopulation ||
            result.proposals.length !== occupied.length ||
            result.proposals.some(
                (proposal, i) => proposal.calculation.households !== occupied[i].households,
            )
        )
            throw new RangeError("final settlement allocation does not match selected households");
        const assigned = new Map();
        for (const entry of modeled)
            assigned.set(entry.cellId, (assigned.get(entry.cellId) ?? 0) + entry.areaAcres);
        const cellLedgers = cells.map((cell) => {
            const physicalAcres = physical.get(cell.id);
            const reservedAcres = reserved.get(cell.id) ?? 0;
            const assignedAcres = assigned.get(cell.id) ?? 0;
            return {
                cellId: cell.id,
                physicalAcres,
                reservedAcres,
                assignedAcres,
                unassignedAcres: physicalAcres - reservedAcres - assignedAcres,
            };
        });
        return {
            ...assembled,
            missing: assembled.missing.filter((item) => item.field !== "placement"),
            selection: {
                provenance: footprints.provenance,
                interval: footprints.interval,
                candidates: modeled,
                cellLedgers,
                allocation,
                result,
                assumption:
                    "Clipped grid footprints weight remaining physical acreage; assigned acreage models household holdings.",
            },
        };
    } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        return fail(error.message);
    }
}
