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
import { isNoteRecord } from "./index-records.mjs";
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
            name: r.name,
            names: r.names,
            lang: r.lang,
            languageCode: r.languageCode,
            data: r.data,
        }),
    );

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
}) {
    const missing = selection.missing.filter((item) => item.field !== "naming");
    if (session.problems?.length) return { missing: [...missing, ...session.problems] };
    const fail = (field, message) => ({ missing: [...missing, { field, message }] });
    if (missing.length) return { missing };
    if (!selection.ruralInput || !selection.selection?.result)
        return fail("selection", "complete rural placement selection is required");
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
    if (
        current.length !== indexed.length ||
        current.some((record) => {
            const other = byAddress.get(key(record));
            return !other || !isDeepStrictEqual(snapshot(record), snapshot(other));
        })
    )
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
        rows.push({
            settlement: name.name,
            polity: polityAddress,
            type:
                population < 10 ? "homestead"
                : population < 100 ? "hamlet"
                : "village",
            population,
            market: population <= 80 ? "subsistence" : "local",
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
        rawOf: (file) => session.sources.get(file)?.raw,
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
