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
import { settlementMembership } from "./settlement-tables.mjs";
import { proposeSettlements } from "./settlement-generate.mjs";
import { proposeUrbanSupply } from "./settlement-urban.mjs";

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
 * @returns {object} Selected facts, writer capture, calculator inputs and missing stages.
 */
export function prepareSettlementInputs({
    session,
    polityAddress,
    map,
    bindings = {},
    settings = {},
}) {
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
    const member = settlementMembership(polity, records, foreignIndex);
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
    for (const item of member.settlements) {
        const found = noteBindings.filter((entry) => canonical(entry.address) === item.address);
        const file = (sourcesByAddress.get(item.address) ?? [
            cachedIndexPath(session.config, item.record.package),
        ])[0];
        if (found.length !== 1) add(file, "binding", `bind ${item.address} exactly once`, ["data"]);
        makeFact(item.address, item.record.data ?? {}, found[0]?.source, file, ["data"], true);
    }
    for (const binding of noteBindings)
        if (!member.settlements.some((item) => item.address === canonical(binding.address)))
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
    const split = (record, address, file) => {
        const total = record.data?.territorial_population;
        if (!nonnegative(total)) {
            add(
                file,
                "data.territorial_population",
                `state the territorial population for ${address}`,
                ["data", "territorial_population"],
            );
            return {};
        }
        if (total === 0) return { ruralPopulation: 0, urbanPopulation: 0 };
        const share = settings.urbanShares?.[address];
        if (!nonnegative(share) || share > 1) {
            inputMissing(
                `settings.urbanShares.${address}`,
                "provide an urban share between zero and one",
            );
            return {};
        }
        return { ruralPopulation: total * (1 - share), urbanPopulation: total * share };
    };
    const total = split(polity, selected, sourceFile);
    const subpolities = member.polities.map((item) => {
        const found = subBindings.filter((entry) => canonical(entry.address) === item.address);
        const file = (sourcesByAddress.get(item.address) ?? [
            cachedIndexPath(session.config, item.record.package),
        ])[0];
        if (found.length !== 1 || !Array.isArray(found[0]?.cellIds))
            inputMissing(
                `bindings.subpolities.${item.address}`,
                "bind the subordinate polity's cells exactly once",
            );
        return {
            address: item.address,
            cellIds: found[0]?.cellIds,
            ...split(item.record, item.address, file),
        };
    });
    for (const binding of subBindings)
        if (!member.polities.some((item) => item.address === canonical(binding.address)))
            inputMissing(
                "bindings.subpolities",
                `binding ${binding.address} is not a direct subordinate polity`,
            );
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
        Array.isArray(settings.placements) &&
        Array.isArray(settings.landRules)
    ) {
        const candidate = {
            map,
            placements: settings.placements,
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
        ruralInput,
        urbanInput,
        missing,
    };
}
