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

/** Prepare named settlement rows from a captured selection. @module */
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { isNoteRecord, sortKeysDeep } from "./index-records.mjs";
import { settlementBands } from "./settlement-bands.mjs";
import { assertSettlementRecords } from "./settlement-tables.mjs";
import { canonicalKey } from "./address.mjs";
import { nameFormsOf } from "./name-forms.mjs";
import { proposeSettlementName } from "./settlement-names.mjs";
import { prepareSettlementEdit } from "./settlement-source.mjs";

const key = (r) =>
    r?.package && r?.type && r?.shortcode ?
        canonicalKey(r.package, "note", r.type, r.shortcode)
    :   undefined;
const snapshot = (r) =>
    JSON.parse(
        JSON.stringify({
            package: r.package,
            type: r.type,
            subType: r.subType,
            shortcode: r.shortcode,
            address: r.address,
            name: r.name,
            names: r.names,
            lang: r.lang,
            languageCode: r.languageCode,
            data: r.data,
        }),
    );

/** Charge bounded traversal before inspecting captured or loaded data.
 * @param {unknown[]} roots - Data to inspect.
 * @param {number} limit - Maximum charged units.
 * @returns {number} Charged units.
 */
export function authoringGraphWork(roots, limit) {
    if (!Number.isSafeInteger(limit) || limit < 1)
        throw new RangeError("authoring work limit must be a positive safe integer");
    let work = 0;
    const seen = new WeakSet();
    const charge = (n) => {
        work += n;
        if (!Number.isSafeInteger(work) || work > limit)
            throw new RangeError("authoring inputs exceed the work limit");
    };
    function* children(value) {
        if (Array.isArray(value) || value instanceof Set) yield* value;
        else if (value instanceof Map)
            for (const [key, entry] of value) {
                yield key;
                yield entry;
            }
        else
            for (const key in value)
                if (Object.hasOwn(value, key)) {
                    charge(1);
                    yield key;
                    yield value[key];
                }
    }
    const pending = [roots.values()];
    while (pending.length) {
        const next = pending.at(-1).next();
        if (next.done) {
            pending.pop();
            continue;
        }
        const value = next.value;
        if (typeof value === "string") charge(value.length + 1);
        else if (Buffer.isBuffer(value)) charge(value.length + 1);
        else if (value && typeof value === "object" && !seen.has(value)) {
            seen.add(value);
            charge(
                Array.isArray(value) ? value.length + 1
                : value instanceof Map ? 2 * value.size + 1
                : value instanceof Set ? value.size + 1
                : 1,
            );
            pending.push(children(value));
        } else charge(1);
    }
    return work;
}

/** Check captured authoring inputs before loading a trusted setting module.
 * @param {object} options - Session, selected proposals and budget.
 * @returns {number} Charged units.
 */
export function preflightNamedSettlements({ session, selection, maxCandidates, maxWork }) {
    const proposals = selection?.selection?.result?.proposals;
    if (!Array.isArray(proposals))
        throw new RangeError("complete rural placement selection is required");
    if (proposals.length && (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1))
        throw new RangeError("provide a positive name candidate limit");
    const count = session?.records?.length ?? 0;
    const foreignCount = session?.foreign?.index instanceof Map ? session.foreign.index.size : 0;
    const extent =
        count + foreignCount + proposals.length + (selection.existingRows?.length ?? 0) + 1;
    const allowance = 2 * extent * extent + proposals.length * (extent + (maxCandidates ?? 0) + 1);
    if (!Number.isSafeInteger(allowance) || allowance >= maxWork)
        throw new RangeError("authoring inputs exceed the work limit");
    const used = authoringGraphWork(
        [
            session?.records,
            session?.sources,
            session?.foreign?.index,
            session?.config?.packageBuild,
            selection.existingRows,
            proposals,
        ],
        maxWork - allowance,
    );
    // Each local validation can expand and scan every captured descendant row.
    const validationWork = 4 * count * used;
    if (!Number.isSafeInteger(validationWork) || validationWork > maxWork - allowance - used)
        throw new RangeError("authoring inputs exceed the work limit");
    for (const record of session.records) {
        if (!isNoteRecord(record)) continue;
        if (typeof record.file?.path !== "string")
            throw new RangeError("a note has no captured source path");
        const file = path.resolve(session.contentBase, record.file.path);
        const raw = session.sources?.get(file)?.raw;
        if (typeof raw !== "string" && !Buffer.isBuffer(raw))
            throw Object.assign(
                new RangeError("captured source is required for settlement validation"),
                { file },
            );
    }
    return allowance + used + validationWork;
}
/**
 * Prepare complete rows and an optimistic source edit without writing.
 * @param {object} options - Captured session, selection and setting checks.
 * @returns {object} Proposed rows and edit, or missing inputs.
 */
export function prepareNamedSettlements({
    session,
    polityAddress,
    selection,
    factory,
    resources,
    seed,
    maxCandidates,
    maxWork,
    bands,
}) {
    const missing = selection.missing.filter((item) => item.field !== "naming");
    if (session.problems?.length) return { missing: [...missing, ...session.problems] };
    const fail = (field, message) => ({ missing: [...missing, { field, message }] });
    if (missing.length) return { missing };
    if (!selection.ruralInput || !selection.selection?.result)
        return fail("selection", "complete rural placement selection is required");
    try {
        const used = preflightNamedSettlements({ session, selection, maxCandidates, maxWork });
        const resourceWork = authoringGraphWork([resources], maxWork - used);
        const records = resources?.index?.records ?? [];
        let largestElements = 0;
        for (const record of records)
            largestElements = Math.max(
                largestElements,
                Array.isArray(record?.data?.elements) ? record.data.elements.length : 0,
            );
        const proposals = selection.selection.result.proposals.length;
        const ranking =
            proposals *
            (records.length + largestElements * (Math.ceil(Math.log2(largestElements + 1)) + 1));
        if (!Number.isSafeInteger(ranking) || used + resourceWork + ranking > maxWork)
            throw new RangeError("name preparation exceeds the work limit");
        bands = settlementBands(bands);
    } catch (error) {
        return {
            missing: [
                ...missing,
                {
                    field: "naming.budget",
                    message: error.message,
                    ...(error.file ? { file: error.file } : {}),
                },
            ],
        };
    }
    if (!resources?.index || !Array.isArray(resources.index.records))
        return fail("naming.index", "provide the current setting content index");
    const current = session.records.filter((record) => isNoteRecord(record) && key(record));
    const indexed = resources.index.records.filter((record) => isNoteRecord(record) && key(record));
    const byAddress = new Map();
    for (const record of indexed) {
        const address = key(record);
        if (byAddress.has(address))
            return fail("naming.index", "the setting index has duplicate note identities");
        byAddress.set(address, record);
    }
    const allCaptured = session.records
        .map((record) => JSON.stringify(sortKeysDeep(snapshot(record))))
        .sort();
    const allIndexed = resources.index.records
        .map((record) => JSON.stringify(sortKeysDeep(snapshot(record))))
        .sort();
    if (!isDeepStrictEqual(allCaptured, allIndexed))
        return fail("naming.index", "the setting content index does not match the captured notes");
    if (typeof factory !== "function")
        return fail("naming.validators", "provide the setting check factory");
    const selected = [];
    let checks;
    try {
        checks = factory(resources, { selected });
    } catch (error) {
        return fail("naming.validators", `setting checks are unavailable: ${error.message}`);
    }
    if (!checks || typeof checks !== "object" || !checks.validators)
        return fail("naming.validators", "setting checks are unavailable");
    const proposals = selection.selection.result.proposals;
    if (
        proposals.length &&
        (!Number.isSafeInteger(maxCandidates) ||
            maxCandidates < 1 ||
            typeof seed !== "string" ||
            !seed.trim())
    )
        return fail("naming", "provide a seed and positive candidate limit");
    if (
        !Number.isSafeInteger(maxWork) ||
        maxWork < 1 ||
        !Number.isSafeInteger(proposals.length * (maxCandidates ?? 0)) ||
        proposals.length * (maxCandidates ?? 0) > maxWork
    )
        return fail("naming", "name selection exceeds the work limit");
    const exclusions = [];
    for (const record of current) {
        if (typeof record.name?.full === "string") exclusions.push(record.name.full);
        exclusions.push(...nameFormsOf(record.name));
    }
    for (const row of selection.existingRows)
        if (typeof row.settlement === "string") exclusions.push(row.settlement);
    const rows = [...selection.existingRows];
    const names = [];
    for (const proposal of proposals) {
        const culture = byAddress.get(proposal.cultureAddress);
        if (
            !culture ||
            culture.type !== "lore" ||
            culture.subType !== "culture" ||
            typeof culture.lang !== "string"
        )
            return fail(
                "naming.culture",
                `cell ${proposal.cellId} needs an indexed culture and language`,
            );
        const languages = indexed.filter(
            (record) =>
                record.type === "skill" &&
                record.subType === "language" &&
                record.languageCode === culture.lang,
        );
        if (languages.length !== 1)
            return fail(
                "naming.language",
                `cell ${proposal.cellId} needs one indexed language for its culture`,
            );
        const identity = JSON.stringify(proposal.source);
        const name = proposeSettlementName({
            culture,
            language: languages[0],
            identity,
            seed,
            exclusions,
            validators: checks.validators,
            maxCandidates,
        });
        if (name.status !== "accepted")
            return fail(
                `naming.${name.field ?? name.status}`,
                name.message ?? `name selection ${name.status}`,
            );
        selected.push(name.name);
        exclusions.push(name.name);
        names.push(name);
        const calculation = proposal.calculation;
        const population = calculation.estimatedPopulation;
        if (population >= bands.townAt)
            return fail("bands", "a rural proposal exceeds the configured town threshold");
        rows.push({
            settlement: name.name,
            polity: polityAddress,
            type:
                population < bands.homesteadBelow ? "homestead"
                : population < bands.hamletBelow ? "hamlet"
                : "village",
            population,
            market: population <= bands.localAbove ? "subsistence" : "local",
            households: calculation.households,
            economicFocus: calculation.economicFocus,
            generatorSource: proposal.source,
        });
    }
    const proposedRecords = session.records.map((record) =>
        record === selection.polity ?
            { ...record, data: { ...record.data, settlements: rows } }
        :   record,
    );
    assertSettlementRecords(proposedRecords, {
        fileOf: (record) => path.resolve(session.contentBase, record.file?.path ?? ""),
        rawOf: (file) => session.sources.get(file)?.raw ?? "",
        foreignIndex: session.foreign?.index,
        config: session.config,
    });
    const edit = prepareSettlementEdit({
        contentRoot: session.contentBase,
        contentPackage: session.config.contentPackage,
        polityAddress,
        records: session.records,
        sources: selection.sourceCapture,
        rows,
    });
    return { missing, rows, names, edit };
}
