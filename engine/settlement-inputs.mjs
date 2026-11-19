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

/** Assemble on-demand settlement calculations from one captured content session. @module */
import {
    canonicalKey,
    ownDocumentSystem,
    readCanonicalKey,
    renderAddress,
    parseAddress,
    isAddressTuple,
} from "./address.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { cachedIndexPath } from "./metadata-index.mjs";
import { AddressLink } from "./address-values.mjs";
import { isNoteRecord } from "./index-records.mjs";
import { createSettlementMembership } from "./settlement-tables.mjs";
import { proposeSettlements } from "./settlement-generate.mjs";
import { proposeUrbanSupply } from "./settlement-urban.mjs";
import { SETTLEMENT_MODEL_DEFAULTS } from "./settlement-model.mjs";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const canonical = (value) => {
    const tuple = readCanonicalKey(value instanceof AddressLink ? value.target : value);
    return tuple ? renderAddress(tuple) : undefined;
};
const sourceAddress = (fm, pkg) =>
    fm?.type && fm?.shortcode ? canonicalKey(pkg, "note", fm.type, fm.shortcode) : undefined;
const urbanTypes = new Set(["town", "city", "metropolis"]);
const ruralTypes = new Set(["encampment", "homestead", "hamlet", "village"]);
const positive = (n) => typeof n === "number" && Number.isFinite(n) && n > 0;
const nonnegative = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
const count = (n) => Number.isSafeInteger(n) && n >= 0;
const ACRE_SQUARE_METERS = 4046.8564224;
const DISTANCE_UNITS = Object.freeze({
    km: { meters: 1000, acresPerSquareUnit: 1000000 / ACRE_SQUARE_METERS },
    mi: { meters: 1609.344, acresPerSquareUnit: 640 },
    lg: { meters: 4828.032, acresPerSquareUnit: 5760 },
    vr: { meters: 1066.8, acresPerSquareUnit: 1066.8 ** 2 / ACRE_SQUARE_METERS },
    nmi: { meters: 1852, acresPerSquareUnit: 1852 ** 2 / ACRE_SQUARE_METERS },
    nlg: { meters: 5556, acresPerSquareUnit: 5556 ** 2 / ACRE_SQUARE_METERS },
});
/** Derive a physical cell area from verified normalized map units.
 * @param {object} cell - Normalized map cell.
 * @param {object} units - Pinned map units.
 * @returns {object|undefined} Conversion details when the basis is valid.
 */
export function settlementCellAreaConversion(cell, units) {
    const unit =
        (
            object(units) &&
            typeof units.distanceUnit === "string" &&
            own(DISTANCE_UNITS, units.distanceUnit)
        ) ?
            DISTANCE_UNITS[units.distanceUnit]
        :   undefined;
    const valid =
        unit &&
        positive(units?.distanceScale) &&
        typeof units?.areaUnit === "string" &&
        units.areaUnit.length > 0 &&
        nonnegative(cell?.rawArea) &&
        nonnegative(cell?.area);
    const expected = valid ? cell.rawArea * units.distanceScale ** 2 : undefined;
    const acres = valid ? cell.area * unit.acresPerSquareUnit : undefined;
    if (!valid || !nonnegative(expected) || cell.area !== expected || !nonnegative(acres))
        return undefined;
    return {
        distanceUnit: units.distanceUnit,
        distanceScale: units.distanceScale,
        areaUnit: units.areaUnit,
        rawArea: cell.rawArea,
        scaledArea: cell.area,
        metersPerUnit: unit.meters,
        acreSquareMeters: ACRE_SQUARE_METERS,
        acresPerSquareUnit: unit.acresPerSquareUnit,
        acres,
    };
}
function sourceKey(source, mapId) {
    if (
        !object(source) ||
        source.mapId !== mapId ||
        !["cell", "burg"].includes(source.kind) ||
        !count(source.id) ||
        Object.keys(source).some((key) => !["mapId", "kind", "id", "slot"].includes(key)) ||
        (source.kind === "burg" && own(source, "slot")) ||
        (source.kind === "cell" && own(source, "slot") && !count(source.slot))
    )
        return undefined;
    return JSON.stringify([
        source.mapId,
        source.kind,
        source.id,
        source.kind === "cell" ? (source.slot ?? 0) : null,
    ]);
}

/**
 * Prepare calculation inputs from captured notes and explicit physical bindings.
 * Missing inputs identify their source or input field. No content is written.
 * @param {object} options - Session, selected Address, normalized map, bindings and settings.
 * @param {import("./content-session.mjs").ContentSession} options.session - Captured content session.
 * @param {string|{package: string, system: string, type: string, shortcode: string}} options.polityAddress - Selected local polity Address.
 * @param {object} options.map - Normalized map.
 * @param {object} [options.bindings] - Explicit map and note bindings.
 * @param {object} [options.settings] - Calculation settings and physical inputs.
 * @param {{membership?: Function, charge?: Function}} [context] - Operation-local membership query and work meter.
 * @returns {object} Selected facts, writer capture, calculator inputs and missing stages.
 */
export function prepareSettlementInputs(
    { session, polityAddress, map, bindings = {}, settings = {} },
    { membership: capturedMembership, charge = () => {} } = {},
) {
    if (
        !session ||
        !Array.isArray(session.records) ||
        !(session.parsed instanceof Map) ||
        !(session.sources instanceof Map)
    )
        throw new TypeError("a captured content session is required");
    const pkg = session.config?.contentPackage;
    const selected = canonical(polityAddress);
    const tuple = readCanonicalKey(polityAddress);
    if (!tuple || tuple.package !== pkg || tuple.system !== "note" || tuple.type !== "affiliation")
        throw new TypeError("select a fully qualified local polity Address");
    const records = session.records;
    const matches = records.filter((r) => {
        if (!isNoteRecord(r) || r.package !== pkg || sourceAddress(r, pkg) !== selected)
            return false;
        const address = canonical(r.address?.canonical);
        return (
            address === selected ||
            address === canonicalKey(pkg, ownDocumentSystem(r.type), r.type, r.shortcode)
        );
    });
    if (
        matches.length !== 1 ||
        matches[0].type !== "affiliation" ||
        matches[0].subType !== "polity" ||
        matches[0].package !== pkg
    )
        throw new Error(`${session.contentBase}: error: select exactly one indexed local polity`);
    const polity = matches[0];
    const captured = new Map();
    const sourcesByAddress = new Map();
    for (const [file, parsed] of session.parsed) {
        const raw = session.sources.get(file)?.raw;
        const address = sourceAddress(parsed.frontmatter, pkg);
        if (!address || (typeof raw !== "string" && !Buffer.isBuffer(raw))) continue;
        captured.set(file, { frontmatter: parsed.frontmatter, raw });
        if (!sourcesByAddress.has(address)) sourcesByAddress.set(address, []);
        sourcesByAddress.get(address).push(file);
    }
    const sourceFiles = sourcesByAddress.get(selected) ?? [];
    if (sourceFiles.length !== 1)
        throw new Error(`${session.contentBase}: error: select exactly one captured polity source`);
    const sourceFile = sourceFiles[0];
    const sourceCapture = captured;
    const fm = captured.get(sourceFile).frontmatter;
    if (fm.subType !== "polity")
        throw new Error(`${sourceFile}: error: captured source is not a polity`);
    if (fm.data !== undefined && !object(fm.data))
        throw new Error(`${sourceFile}: error: data must be a mapping`);
    if (fm.data?.settlements !== undefined && !Array.isArray(fm.data.settlements))
        throw new Error(`${sourceFile}: error: data.settlements must be a list`);
    const existingRows = structuredClone(fm.data?.settlements ?? []);
    const missing = [];
    const add = (file, field, message, keyPath) => {
        const raw = captured.get(file)?.raw;
        const position =
            raw && keyPath ? positionOfFrontmatterPath(String(raw), keyPath) : undefined;
        missing.push({ file, ...(position ?? {}), field, message });
    };
    const inputMissing = (field, message) => add("settlement-inputs", field, message);
    for (const problem of session.problems ?? [])
        missing.push({
            file: problem.file ?? session.contentBase,
            ...(problem.line === undefined ? {} : { line: problem.line }),
            ...(problem.column === undefined ? {} : { column: problem.column }),
            field: "session",
            message: problem.message ?? "resolve the content session problem",
        });
    if (!object(settings) || !object(bindings))
        throw new TypeError("bindings and settings must be objects");
    for (const key of Object.keys(settings))
        if (!["urbanShares", "placements", "landRules", "urban", "model"].includes(key))
            inputMissing(`settings.${key}`, "this setting is not an external settlement input");
    for (const key of Object.keys(bindings))
        if (!["rows", "notes", "subpolities"].includes(key))
            inputMissing(`bindings.${key}`, "this binding is not a settlement input");
    const foreignIndex = session.foreign?.index ?? new Map();
    const membershipOf =
        capturedMembership ?? createSettlementMembership(records, foreignIndex, pkg, charge);
    const member = membershipOf(polity);
    const recordByAddress = new Map();
    for (const record of records) {
        if (
            !isNoteRecord(record) ||
            !record.package ||
            !record.type ||
            !record.shortcode ||
            !record.address?.canonical
        )
            continue;
        const address = sourceAddress(record, record.package);
        const actual = canonical(record.address.canonical);
        if (
            actual !== address &&
            actual !==
                canonicalKey(
                    record.package,
                    ownDocumentSystem(record.type),
                    record.type,
                    record.shortcode,
                )
        )
            continue;
        if (!address) continue;
        if (recordByAddress.has(address))
            inputMissing("session.records", `resolve the duplicate indexed Address ${address}`);
        else recordByAddress.set(address, record);
    }
    for (const [address, entry] of foreignIndex) {
        const record = entry.settlementRecord ?? entry;
        if (!recordByAddress.has(address)) recordByAddress.set(address, record);
        if (entry.settlementRecord && record.package && record.type && record.shortcode) {
            const alias = sourceAddress(record, record.package);
            if (!recordByAddress.has(alias)) recordByAddress.set(alias, record);
        }
    }
    const typeSet = new Set(records.map((record) => record.type).filter(Boolean));
    const packageSet = new Set(
        [
            ...records.map((record) => record.package),
            ...[...foreignIndex.keys()].map((key) => readCanonicalKey(key)?.package),
        ].filter(Boolean),
    );
    // An unresolved parent or government can hide membership. Report it in this operation.
    for (const record of [
        ...records,
        ...new Set(
            [...foreignIndex.values()].map((entry) => entry.settlementRecord).filter(Boolean),
        ),
    ]) {
        if (!(
            (record.type === "affiliation" && record.subType === "polity") ||
            (record.type === "place" && record.subType === "settlement")
        ))
            continue;
        const field = record.type === "affiliation" ? "parents" : "government";
        const values =
            field === "parents" ?
                Array.isArray(record.data?.parents) ?
                    record.data.parents
                :   []
            : record.data?.government == null ? []
            : [record.data.government];
        for (const [i, value] of values.entries()) {
            const written =
                value instanceof AddressLink ? value.target
                : object(value) && typeof value.address === "string" ? value.address
                : value;
            const parsed =
                isAddressTuple(written) ? written : (
                    parseAddress(
                        written,
                        {
                            package: record.package,
                            system: "note",
                            type: "affiliation",
                            types: typeSet,
                            packages: packageSet,
                        },
                        { declared: true },
                    )
                );
            const address = isAddressTuple(parsed) ? renderAddress(parsed) : undefined;
            if (
                !address ||
                (!recordByAddress.has(address) && !session.foreign?.index?.has(address))
            ) {
                const key = sourceAddress(record, record.package);
                const file = (sourcesByAddress.get(key) ?? [
                    cachedIndexPath(session.config, record.package),
                ])[0];
                add(
                    file,
                    `data.${field}`,
                    `resolve the ${field} Address before determining polity membership`,
                    ["data", field, ...(field === "parents" ? [i] : [])],
                );
            }
        }
        if (record.type === "affiliation" && record.data?.seat != null) {
            const value = record.data.seat;
            const written =
                value instanceof AddressLink ? value.target
                : object(value) && typeof value.address === "string" ? value.address
                : value;
            const parsed =
                isAddressTuple(written) ? written : (
                    parseAddress(
                        written,
                        {
                            package: record.package,
                            system: "note",
                            type: "place",
                            types: typeSet,
                            packages: packageSet,
                        },
                        { declared: true },
                    )
                );
            const address = isAddressTuple(parsed) ? renderAddress(parsed) : undefined;
            if (
                !address ||
                (!recordByAddress.has(address) && !session.foreign?.index?.has(address))
            ) {
                const file = (sourcesByAddress.get(sourceAddress(record, record.package)) ?? [
                    cachedIndexPath(session.config, record.package),
                ])[0];
                add(
                    file,
                    "data.seat",
                    "resolve the seat Address before determining polity membership",
                    ["data", "seat"],
                );
            }
        }
    }
    if (!object(map) || typeof map.mapId !== "string" || !Array.isArray(map.cells))
        inputMissing("map", "provide a normalized pinned map");
    else if (
        !map.cells.length ||
        map.cells.some((cell) => !object(cell) || canonical(cell.polityAddress) !== selected)
    )
        inputMissing(
            "map.polityAddress",
            "bind every selected map cell to the selected polity Address",
        );
    const cells = Array.isArray(map?.cells) ? map.cells.filter(object) : [];
    const cellFor = (source) => {
        if (!sourceKey(source, map?.mapId)) return undefined;
        const hits = cells.filter((cell) =>
            source.kind === "cell" ?
                cell.id === source.id
            :   source.kind === "burg" && cell.burg?.i === source.id,
        );
        return hits.length === 1 ? hits[0] : undefined;
    };
    const cultureSizes = {};
    const readCultureSize = (address, file = "settlement-inputs") => {
        const key = canonical(address);
        const culture = key && recordByAddress.get(key);
        if (
            !culture ||
            culture.type !== "lore" ||
            culture.subType !== "culture" ||
            !positive(culture.data?.householdSize)
        ) {
            add(
                file,
                `culture ${key ?? String(address)}`,
                "bind an indexed culture with a declared household size",
            );
            return undefined;
        }
        cultureSizes[key] = culture.data.householdSize;
        return key;
    };
    for (const address of new Set(
        cells.flatMap((cell) => [cell.cultureAddress, cell.burgCultureAddress]).filter(Boolean),
    ))
        readCultureSize(address);
    const readBindings = (key) => {
        const value = bindings[key];
        if (value === undefined) return [];
        if (!Array.isArray(value) || value.some((entry) => !object(entry))) {
            inputMissing(`bindings.${key}`, "provide a list of binding objects");
            return [];
        }
        return value;
    };
    const rowBindings = readBindings("rows");
    const noteBindings = readBindings("notes");
    const subBindings = readBindings("subpolities");
    const tree = new Map();
    const active = new Set();
    const postorder = [];
    const noteClaims = new Map();
    const locationOf = (record) =>
        (sourcesByAddress.get(sourceAddress(record, record.package)) ?? [
            cachedIndexPath(session.config, record.package),
        ])[0];
    const pendingPolities = [
        { record: polity, address: selected, parent: undefined, leaving: false },
    ];
    while (pendingPolities.length) {
        charge(1);
        const { record, address, parent, leaving } = pendingPolities.pop();
        if (leaving) {
            active.delete(address);
            postorder.push(address);
            continue;
        }
        const file = locationOf(record);
        if (active.has(address)) {
            add(file, "data.parents", "the subordinate polity chain contains a cycle", [
                "data",
                "parents",
            ]);
            continue;
        }
        if (tree.has(address)) {
            add(file, "data.parents", "a subordinate polity has ambiguous membership", [
                "data",
                "parents",
            ]);
            continue;
        }
        if (Array.isArray(record.data?.parents) && record.data.parents.length > 1)
            add(file, "data.parents", "a polity declares at most one superior", [
                "data",
                "parents",
            ]);
        const membership = membershipOf(record);
        const node = { address, record, parent, membership, children: [] };
        tree.set(address, node);
        active.add(address);
        charge(membership.settlements.length + membership.polities.length);
        for (const settlement of membership.settlements) {
            if (!noteClaims.has(settlement.address)) noteClaims.set(settlement.address, []);
            noteClaims.get(settlement.address).push(node);
        }
        pendingPolities.push({ record, address, parent, leaving: true });
        for (const child of membership.polities) node.children.push(child.address);
        for (let i = membership.polities.length - 1; i >= 0; i--) {
            const child = membership.polities[i];
            pendingPolities.push({
                record: child.record,
                address: child.address,
                parent: address,
                leaving: false,
            });
        }
    }
    const ancestor = (a, b) => {
        for (let node = tree.get(b); node?.parent; node = tree.get(node.parent)) {
            charge(1);
            if (node.parent === a) return true;
        }
        return false;
    };
    const noteOwner = new Map();
    for (const [address, claims] of noteClaims) {
        let owner = claims[0];
        if (claims.length > 1) {
            const record = recordByAddress.get(address);
            const government = canonical(record?.data?.government);
            const governmentNote = government && readCanonicalKey(government);
            const key = governmentNote && renderAddress({ ...governmentNote, system: "note" });
            const selectedOwner = claims.find((claim) => claim.address === key);
            if (
                !selectedOwner ||
                claims.some(
                    (claim) =>
                        claim !== selectedOwner &&
                        !ancestor(claim.address, selectedOwner.address) &&
                        !ancestor(selectedOwner.address, claim.address),
                )
            ) {
                inputMissing(`membership.${address}`, "resolve the settlement's polity membership");
                owner = undefined;
            } else owner = selectedOwner;
        }
        if (owner) noteOwner.set(address, owner.address);
    }
    const facts = [];
    const sourcesSeen = new Map();
    const makeFact = (identity, data, source, file, keyPath, noted = false) => {
        const urban =
            urbanTypes.has(data?.type) ? true
            : ruralTypes.has(data?.type) ? false
            : undefined;
        if (urban === undefined)
            add(file, "type", `state the settlement type for ${identity}`, keyPath);
        const cell = cellFor(source);
        if (!cell)
            add(file, "generatorSource", `bind ${identity} to one mapped cell or burg`, keyPath);
        const sourceIdentity = sourceKey(source, map?.mapId);
        if (sourceIdentity) {
            const prior = sourcesSeen.get(sourceIdentity);
            if (prior)
                add(
                    file,
                    "generatorSource",
                    `map identity for ${identity} is also bound to ${prior}`,
                    keyPath,
                );
            else sourcesSeen.set(sourceIdentity, identity);
        }
        const mapped = source?.kind === "burg" ? cell?.burgCultureAddress : cell?.cultureAddress;
        const culture = noted && own(data, "culture") ? data.culture : mapped;
        const cultureAddress = canonical(culture);
        if (noted && own(data, "culture") && !cultureAddress)
            add(file, "data.culture", `resolve the declared culture for ${identity}`, [
                "data",
                "culture",
            ]);
        if (cultureAddress && !own(cultureSizes, cultureAddress)) readCultureSize(culture, file);
        const size = cultureSizes[cultureAddress];
        const fact = {
            identity,
            urban,
            ...(source === undefined ? {} : { source }),
            ...(own(data, "households") ? { households: data.households } : {}),
            ...(own(data, "population") ? { population: data.population } : {}),
            ...(size === undefined ? {} : { householdSize: size }),
        };
        if (own(data, "households") && data.households === null)
            add(file, "households", `supply the unknown household count for ${identity}`, keyPath);
        else if (!own(data, "households") && (!own(data, "population") || data.population === null))
            add(file, "population", `supply the unknown population for ${identity}`, keyPath);
        else if (own(data, "households") && size === undefined)
            add(file, "householdSize", `bind the culture household size for ${identity}`, keyPath);
        facts.push({ fact, data, cell, source, cultureAddress, file });
    };
    for (const [index, row] of existingRows.entries()) {
        if (!object(row)) {
            add(sourceFile, `data.settlements.${index}`, "settlement row must be a mapping", [
                "data",
                "settlements",
                index,
            ]);
            continue;
        }
        const found = rowBindings.filter((entry) => entry.index === index);
        if (found.length > 1)
            add(sourceFile, `data.settlements.${index}`, "bind this row at most once", [
                "data",
                "settlements",
                index,
            ]);
        const explicit = found[0]?.source;
        if (
            row.generatorSource !== undefined &&
            explicit !== undefined &&
            (!sourceKey(row.generatorSource, map?.mapId) ||
                sourceKey(row.generatorSource, map?.mapId) !== sourceKey(explicit, map?.mapId))
        )
            add(
                sourceFile,
                `data.settlements.${index}.generatorSource`,
                "binding conflicts with the authored map identity",
                ["data", "settlements", index, "generatorSource"],
            );
        makeFact(`row:${index}`, row, row.generatorSource ?? explicit, sourceFile, [
            "data",
            "settlements",
            index,
        ]);
    }
    for (const item of member.settlements.filter(
        (entry) => noteOwner.get(entry.address) === selected,
    )) {
        const found = noteBindings.filter((entry) => canonical(entry.address) === item.address);
        const file = (sourcesByAddress.get(item.address) ?? [
            cachedIndexPath(session.config, item.record.package),
        ])[0];
        if (found.length !== 1) add(file, "binding", `bind ${item.address} exactly once`, ["data"]);
        makeFact(item.address, item.record.data ?? {}, found[0]?.source, file, ["data"], true);
    }
    for (const binding of noteBindings)
        if (!noteClaims.has(canonical(binding.address)))
            inputMissing(
                "bindings.notes",
                `note binding ${binding.address} is not a direct settlement of the selected polity`,
            );
    for (const binding of rowBindings)
        if (
            !Number.isSafeInteger(binding.index) ||
            binding.index < 0 ||
            binding.index >= existingRows.length
        )
            inputMissing("bindings.rows", "row binding must name an existing row index");
    if (settings.urbanShares !== undefined && !object(settings.urbanShares))
        inputMissing("settings.urbanShares", "provide a mapping of polity Addresses to shares");
    const urbanTargets = {};
    const computed = new Map();
    const ranges = new Map();
    const reserveFact = (data, identity, file, keyPath, source, noted) => {
        if (!object(data) || (!urbanTypes.has(data.type) && !ruralTypes.has(data.type))) {
            add(file, "type", `state the settlement type for ${identity}`, keyPath);
            return undefined;
        }
        let population;
        if (own(data, "households")) {
            if (!count(data.households)) {
                add(file, "households", `supply the household count for ${identity}`, keyPath);
                return undefined;
            }
            if (data.households === 0) population = 0;
            else {
                const cell = cellFor(source);
                const mapped =
                    source?.kind === "burg" ? cell?.burgCultureAddress : cell?.cultureAddress;
                const culture = noted && own(data, "culture") ? data.culture : mapped;
                const cultureAddress = canonical(culture);
                const size =
                    cultureAddress &&
                    (cultureSizes[cultureAddress] ??
                        (readCultureSize(culture, file) && cultureSizes[cultureAddress]));
                if (!positive(size)) {
                    add(
                        file,
                        "householdSize",
                        `resolve the culture household size for ${identity}`,
                        keyPath,
                    );
                    return undefined;
                }
                population = data.households * size;
            }
        } else if (nonnegative(data.population)) population = data.population;
        else {
            add(file, "population", `supply the population for ${identity}`, keyPath);
            return undefined;
        }
        if (!nonnegative(population)) {
            add(file, "population", `the population for ${identity} is not representable`, keyPath);
            return undefined;
        }
        return { urban: urbanTypes.has(data.type), population };
    };
    const subordinateSources = new Set();
    const rememberSource = (source, identity, file, keyPath, ownerAddress) => {
        if (source === undefined) return;
        const key = sourceKey(source, map?.mapId);
        const cell = cellFor(source);
        if (!key || !cell) {
            add(file, "generatorSource", `bind ${identity} to a mapped source`, keyPath);
            return;
        }
        let owner = tree.get(ownerAddress);
        while (owner?.parent && owner.parent !== selected) {
            charge(1);
            owner = tree.get(owner.parent);
        }
        const bound = subBindings.filter(
            (binding) => canonical(binding.address) === owner?.address,
        );
        if (
            owner?.parent !== selected ||
            bound.length !== 1 ||
            !Array.isArray(bound[0]?.cellIds) ||
            !bound[0].cellIds.includes(cell.id)
        )
            add(
                file,
                "generatorSource",
                `source for ${identity} is outside its subordinate polity's bound cells`,
                keyPath,
            );
        subordinateSources.add(key);
        if (sourcesSeen.has(key))
            add(
                file,
                "generatorSource",
                `map identity for ${identity} is also bound to ${sourcesSeen.get(key)}`,
                keyPath,
            );
        else sourcesSeen.set(key, identity);
    };
    const split = (address) => {
        charge(1);
        if (ranges.has(address)) return ranges.get(address);
        if (!tree.has(address)) return undefined;
        const node = tree.get(address);
        const { record } = node;
        const file = locationOf(record);
        let urbanFloor = 0,
            ruralFloor = 0,
            complete = true;
        const reserve = (fact) => {
            if (!fact) {
                complete = false;
                return;
            }
            if (fact.urban) urbanFloor += fact.population;
            else ruralFloor += fact.population;
        };
        if (address === selected) {
            for (const entry of facts)
                reserve(
                    reserveFact(
                        entry.data,
                        entry.fact.identity,
                        entry.file,
                        ["data"],
                        entry.source,
                        !entry.fact.identity.startsWith("row:"),
                    ),
                );
        } else {
            const rows = record.data?.settlements;
            if (rows !== undefined && !Array.isArray(rows)) {
                add(file, "data.settlements", "settlements must be a list", [
                    "data",
                    "settlements",
                ]);
                complete = false;
            }
            for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
                const identity = `${address}#row:${index}`;
                const source = row?.generatorSource;
                rememberSource(
                    source,
                    identity,
                    file,
                    ["data", "settlements", index, "generatorSource"],
                    address,
                );
                reserve(
                    reserveFact(row, identity, file, ["data", "settlements", index], source, false),
                );
            }
            for (const item of node.membership.settlements.filter(
                (entry) => noteOwner.get(entry.address) === address,
            )) {
                const noteFile = locationOf(item.record);
                const bound = noteBindings.filter(
                    (binding) => canonical(binding.address) === item.address,
                );
                if (bound.length > 1) {
                    add(noteFile, "binding", `bind ${item.address} at most once`, ["data"]);
                    complete = false;
                }
                const source = bound[0]?.source;
                rememberSource(source, item.address, noteFile, ["data"], address);
                reserve(
                    reserveFact(
                        item.record.data ?? {},
                        item.address,
                        noteFile,
                        ["data"],
                        source,
                        true,
                    ),
                );
            }
        }
        const children = [];
        for (const child of node.children) {
            charge(1);
            const value = ranges.get(child);
            if (!value) {
                complete = false;
                continue;
            }
            children.push(value);
        }
        const total = record.data?.territorial_population;
        if (!nonnegative(total)) {
            add(
                file,
                "data.territorial_population",
                `state the territorial population for ${address}`,
                ["data", "territorial_population"],
            );
            complete = false;
        }
        const hasShare = object(settings.urbanShares) && own(settings.urbanShares, address);
        const share =
            hasShare ? settings.urbanShares[address]
            : total === 0 ? 0
            : settings.model === undefined ? SETTLEMENT_MODEL_DEFAULTS.urbanShare
            : settings.model?.urbanShare;
        if (!nonnegative(share) || share > 1) {
            inputMissing(
                hasShare ? `settings.urbanShares.${address}` : "settings.model.urbanShare",
                "provide an urban share between zero and one",
            );
            complete = false;
        }
        const childTotal = children.reduce((sum, child) => sum + child.total, 0);
        const minimum = urbanFloor + children.reduce((sum, child) => sum + child.minimum, 0);
        const requiredRural =
            ruralFloor + children.reduce((sum, child) => sum + child.total - child.maximum, 0);
        const maximum = total - requiredRural;
        if (![urbanFloor, ruralFloor, childTotal, minimum, requiredRural].every(nonnegative)) {
            add(
                file,
                "data.territorial_population",
                `reservations for ${address} are not representable`,
                ["data", "territorial_population"],
            );
            complete = false;
        }
        if (complete && (urbanFloor + ruralFloor + childTotal > total || minimum > maximum)) {
            add(
                file,
                "data.territorial_population",
                `known reservations exceed the territorial population for ${address}`,
                ["data", "territorial_population"],
            );
            complete = false;
        }
        let result;
        if (complete) {
            const original = total * share;
            if (hasShare && (original < minimum || original > maximum)) {
                inputMissing(
                    `settings.urbanShares.${address}`,
                    "the stated urban share conflicts with authored population reservations",
                );
            } else {
                result = {
                    address,
                    total,
                    original,
                    hasShare,
                    directUrban: urbanFloor,
                    directRural: ruralFloor,
                    childTotal,
                    children,
                    urbanFloor: minimum,
                    ruralFloor: requiredRural,
                    minimum: hasShare ? original : minimum,
                    maximum: hasShare ? original : maximum,
                };
            }
        }
        ranges.set(address, result);
        return result;
    };
    const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));
    const select = (root, initialTarget) => {
        const pending = [{ node: root, target: initialTarget }];
        while (pending.length) {
            charge(1);
            const { node, target } = pending.pop();
            charge(node.children.length * (Math.ceil(Math.log2(node.children.length + 1)) + 1));
            urbanTargets[node.address] = {
                original: node.original,
                effective: target,
                adjustment: target - node.original,
                urbanFloor: node.urbanFloor,
                ruralFloor: node.ruralFloor,
                source: node.hasShare ? "explicit" : "default",
            };
            computed.set(node.address, {
                ruralPopulation: node.total - target,
                urbanPopulation: target,
            });
            const children = [...node.children].sort((a, b) =>
                a.address < b.address ? -1
                : a.address > b.address ? 1
                : 0,
            );
            const minimum = Math.max(
                children.reduce((sum, child) => sum + child.minimum, 0),
                target - (node.total - node.childTotal - node.directRural),
            );
            const maximum = Math.min(
                children.reduce((sum, child) => sum + child.maximum, 0),
                target - node.directUrban,
            );
            const chosen = children.map((child) =>
                clamp(child.original, child.minimum, child.maximum),
            );
            let sum = chosen.reduce((a, b) => a + b, 0);
            for (let i = 0; i < children.length && sum < minimum; i++) {
                const amount = Math.min(minimum - sum, children[i].maximum - chosen[i]);
                chosen[i] += amount;
                sum += amount;
            }
            for (let i = 0; i < children.length && sum > maximum; i++) {
                const amount = Math.min(sum - maximum, chosen[i] - children[i].minimum);
                chosen[i] -= amount;
                sum -= amount;
            }
            for (let i = children.length - 1; i >= 0; i--)
                pending.push({ node: children[i], target: chosen[i] });
        }
    };
    // Finished descendants precede their parents without recursive calls.
    for (const address of postorder) split(address);
    const root = split(selected);
    if (root) select(root, clamp(root.original, root.minimum, root.maximum));
    const total = computed.get(selected) ?? {};
    const subpolities = member.polities.map((item) => {
        const found = subBindings.filter((entry) => canonical(entry.address) === item.address);
        if (found.length !== 1 || !Array.isArray(found[0]?.cellIds))
            inputMissing(
                `bindings.subpolities.${item.address}`,
                "bind the subordinate polity's cells exactly once",
            );
        return {
            address: item.address,
            cellIds: found[0]?.cellIds,
            ...(computed.get(item.address) ?? {}),
        };
    });
    for (const binding of subBindings)
        if (!member.polities.some((item) => item.address === canonical(binding.address)))
            inputMissing(
                "bindings.subpolities",
                `binding ${binding.address} is not a direct subordinate polity`,
            );
    let resolvedPlacements;
    const cellAreaConversions = {};
    if (Array.isArray(settings.placements) && object(map) && typeof map.mapId === "string") {
        const reserved = new Set(sourcesSeen.keys());
        const explicit = new Set();
        let valid = true;
        const placements = settings.placements.map((placement, index) => {
            if (
                !object(placement) ||
                !count(placement.cellId) ||
                cells.filter((cell) => cell.id === placement.cellId).length !== 1
            ) {
                inputMissing(
                    `settings.placements.${index}`,
                    "bind this placement to a mapped cell",
                );
                valid = false;
                return undefined;
            }
            const result = { ...placement };
            if (!own(result, "source") && result.noteAddress !== undefined) {
                const matches = facts.filter((entry) => entry.fact.identity === result.noteAddress);
                if (matches.length === 1 && matches[0].source !== undefined)
                    result.source = matches[0].source;
                else {
                    inputMissing(
                        `settings.placements.${index}.source`,
                        "bind this noted settlement to its existing map identity",
                    );
                    valid = false;
                }
            }
            if (own(result, "source")) {
                const key = sourceKey(result.source, map.mapId);
                const cell = cellFor(result.source);
                if (!key || !cell || cell.id !== result.cellId) {
                    inputMissing(
                        `settings.placements.${index}.source`,
                        "bind a valid identity in this mapped cell",
                    );
                    valid = false;
                } else if (subordinateSources.has(key)) {
                    inputMissing(
                        `settings.placements.${index}.source`,
                        "a parent placement cannot use a subordinate settlement's identity",
                    );
                    valid = false;
                } else if (explicit.has(key)) {
                    inputMissing(
                        `settings.placements.${index}.source`,
                        "each placement needs a distinct map identity",
                    );
                    valid = false;
                } else {
                    explicit.add(key);
                    reserved.add(key);
                }
            }
            return result;
        });
        if (valid) {
            const nextSlots = new Map();
            for (const placement of placements) {
                if (own(placement, "source")) continue;
                let slot = nextSlots.get(placement.cellId) ?? 0;
                let source = { mapId: map.mapId, kind: "cell", id: placement.cellId, slot };
                while (reserved.has(sourceKey(source, map.mapId))) {
                    if (!Number.isSafeInteger(++slot))
                        throw new RangeError("no representable cell slot remains");
                    source = { ...source, slot };
                }
                placement.source = source;
                reserved.add(sourceKey(source, map.mapId));
                nextSlots.set(placement.cellId, slot + 1);
            }
            for (const [index, placement] of placements.entries()) {
                if (own(placement, "cellAreaAcres")) continue;
                const cell = cells.find((entry) => entry.id === placement.cellId);
                const conversion = settlementCellAreaConversion(cell, map.units);
                if (!conversion) {
                    inputMissing(
                        `settings.placements.${index}.cellAreaAcres`,
                        "provide a mapped cell with verified area and a supported pinned distance unit",
                    );
                    continue;
                }
                placement.cellAreaAcres = conversion.acres;
                cellAreaConversions[cell.id] = conversion;
            }
            resolvedPlacements = placements;
        }
    }
    inputMissing("placement", "discover settlement placements and acreage automatically");
    if (!Array.isArray(settings.landRules))
        inputMissing("settings.landRules", "provide land profiles for mapped placements");
    if (!Array.isArray(settings.urban?.sources))
        inputMissing("settings.urban.sources", "provide declared urban food sources");
    if (!Array.isArray(settings.urban?.routes))
        inputMissing("settings.urban.routes", "provide declared urban food routes");
    inputMissing("naming", "generate names from the selected cultures' naming declarations");
    const baseMissing = missing.filter(
        (item) =>
            ![
                "placement",
                "settings.landRules",
                "settings.urban.sources",
                "settings.urban.routes",
                "naming",
            ].includes(item.field),
    );
    let ruralInput, urbanInput;
    if (
        !baseMissing.length &&
        Array.isArray(resolvedPlacements) &&
        Array.isArray(settings.landRules)
    ) {
        const candidate = {
            map,
            placements: resolvedPlacements,
            existing: facts.map((entry) => entry.fact),
            subpolities,
            cultureSizes,
            landRules: settings.landRules,
            ruralPopulation: total.ruralPopulation,
        };
        try {
            proposeSettlements(candidate, settings.model);
            ruralInput = candidate;
        } catch (error) {
            if (!(error instanceof RangeError)) throw error;
            inputMissing("rural", error.message);
        }
    }
    if (
        !baseMissing.length &&
        Array.isArray(settings.urban?.sources) &&
        Array.isArray(settings.urban?.routes)
    ) {
        const physical = Array.isArray(settings.urban.cities) ? settings.urban.cities : [];
        let cityBindingsComplete = true;
        const cities = facts
            .filter((entry) => entry.fact.urban)
            .map((entry) => {
                const options = physical.filter(
                    (item) => object(item) && item.identity === entry.fact.identity,
                );
                if (options.length !== 1) {
                    cityBindingsComplete = false;
                    inputMissing(
                        `settings.urban.cities.${entry.fact.identity}`,
                        "provide one local food input for this city",
                    );
                }
                if (
                    options.some((item) =>
                        Object.keys(item).some((key) => !["identity", "localFood"].includes(key)),
                    )
                ) {
                    cityBindingsComplete = false;
                    inputMissing(
                        `settings.urban.cities.${entry.fact.identity}`,
                        "city settings accept only identity and localFood",
                    );
                }
                return {
                    identity: entry.fact.identity,
                    cellId: entry.cell?.id,
                    source: entry.source,
                    fact: { ...entry.data, identity: entry.fact.identity },
                    cultureAddress: entry.cultureAddress,
                    localFood: options[0]?.localFood,
                };
            });
        const candidate = {
            map,
            cities,
            sources: settings.urban.sources,
            routes: settings.urban.routes,
            subpolities,
            cultureSizes,
            urbanPopulation: total.urbanPopulation,
        };
        try {
            const result = proposeUrbanSupply(candidate, settings.model);
            for (const item of result.missing)
                inputMissing(
                    `urban.${item.identity}.${item.field}`,
                    `provide ${item.field} for ${item.identity}`,
                );
            if (
                cityBindingsComplete &&
                !result.missing.length &&
                cities.every((city) => city.localFood != null)
            )
                urbanInput = candidate;
        } catch (error) {
            if (!(error instanceof RangeError)) throw error;
            inputMissing("urban", error.message);
        }
    }
    return {
        polity,
        sourceCapture,
        existingRows,
        existingFacts: facts,
        cultureSizes,
        subpolities,
        urbanTargets,
        cellAreaConversions,
        resolvedPlacements,
        ruralInput,
        urbanInput,
        missing,
    };
}
