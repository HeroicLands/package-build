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

import { parseAddress, renderAddress } from "./address.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { parseNoteDate } from "./note-dates.mjs";
import { reckoningContext } from "./reckoning-markers.mjs";

import { HOLDER_FIELDS, OFFICE_FIELDS } from "./standing-terms.mjs";
import { isNoteRecord } from "./index-records.mjs";
import { isAddressTuple } from "./address.mjs";
import { officeRoster, readStandings, standingOffices } from "./standings.mjs";

export { HOLDER_FIELDS, OFFICE_FIELDS };

/**
 * A note's identity across its systems: `package-type-shortcode`, lowercased.
 *
 * A body's Item and its journal carry one page, and a being names the body by
 * its `note` Address, so the system is left out.
 *
 * @param {{package?: string, type?: string, shortcode?: string}} tuple
 * @returns {string} The key, or `""` where a part is missing.
 */
export function officeBodyKey(tuple) {
    const parts = [tuple?.package, tuple?.type, tuple?.shortcode].map((part) =>
        String(part ?? "").toLowerCase(),
    );
    return parts.every(Boolean) ? parts.join("-") : "";
}

/**
 * Each body's offices with the living beings that hold them.
 *
 * Nothing is authored on the office for this: a being states the post it holds
 * in its own `data.affiliations.<body>.office`, and this collects, for every
 * office in a body's `governance.offices`, each being naming it. A being whose
 * `data.died` is set holds nothing, so a former holder drops out and a vacant
 * office lists no one. A post the body does not declare is the standing check's
 * finding and is listed nowhere.
 *
 * Offices keep the body's declared order; holders are ordered by name.
 *
 * @param {object[]} records - Content-index records; only note records are
 *   read.
 * @returns {Map<string, Map<string, object[]>>} Body identity
 *   (`package-type-shortcode`) → office → the holding beings' records, for every
 *   body with at least one held office.
 */
export function officeHolders(records) {
    const notes = records.filter((record) => isNoteRecord(record) && record.shortcode);
    /** Body identity → office → holding beings. */
    const named = new Map();
    for (const record of notes) {
        if (record.type !== "being" || record.data?.died != null) continue;
        for (const { body, standing } of readStandings(record.data?.affiliations).entries) {
            const key = isAddressTuple(body) ? officeBodyKey(body) : "";
            if (!key || !mapping(standing)) continue;
            const offices = named.get(key) ?? new Map();
            for (const office of standingOffices(standing)) {
                const holders = offices.get(office) ?? [];
                if (!holders.includes(record)) holders.push(record);
                offices.set(office, holders);
            }
            named.set(key, offices);
        }
    }
    const nameOf = (record) => String(record.name?.full ?? record.shortcode);
    const out = new Map();
    for (const record of notes) {
        if (record.type !== "affiliation") continue;
        const key = officeBodyKey(record);
        const claims = named.get(key);
        if (!claims) continue;
        const held = new Map();
        for (const office of officeRoster(record.data?.governance?.offices).keys()) {
            const holders = claims.get(office);
            if (holders?.length)
                held.set(
                    office,
                    holders.toSorted((a, b) => nameOf(a).localeCompare(nameOf(b), "en")),
                );
        }
        if (held.size) out.set(key, held);
    }
    return out;
}

const mapping = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Validate one affiliation's office roster against dated beings in the corpus.
 * @param {object} note
 * @param {{index?: object}} [options]
 */
export function checkDatedOffices(note, { index } = {}) {
    const offices = note.fm?.data?.governance?.offices;
    if (offices === undefined || offices === null) return [];
    const findings = [];
    const at = (path, message) => ({
        file: note.file,
        ...positionOfFrontmatterPath(note.raw ?? "", path),
        severity: "error",
        message,
    });
    // The roster's shape — a map of offices, each a description or a map of
    // `OFFICE_FIELDS`, each holder a map of `HOLDER_FIELDS` — is the inner-key
    // check's. What is checked here is what the holders and their dates mean.
    if (!mapping(offices)) return [];

    const dates = reckoningContext(index);
    for (const [office, value] of Object.entries(offices)) {
        const base = ["data", "governance", "offices", office];
        if (!mapping(value) || !Array.isArray(value.holders)) continue;
        const terms = [];
        value.holders.forEach((row, position) => {
            const rowPath = [...base, "holders", position];
            if (!mapping(row)) return;
            if (typeof row.being === "string" && row.being.trim()) {
                const tuple = parseAddress(row.being, {
                    package: index?.contentPackage,
                    system: "note",
                    type: "being",
                    types: index?.types,
                    packages: index?.packages,
                });
                if (tuple.reason || tuple.type !== "being") {
                    findings.push(
                        at(
                            [...rowPath, "being"],
                            `office ${office} holder ${row.being} must name a being Address`,
                        ),
                    );
                } else if (index?.addressHit) {
                    const target = index.addressHit(renderAddress(tuple));
                    if (!target)
                        findings.push(
                            at(
                                [...rowPath, "being"],
                                `office ${office} holder ${row.being} does not resolve`,
                            ),
                        );
                    else if ((target.fm ?? target).data?.died != null && row.end == null)
                        findings.push(
                            at(
                                [...rowPath, "being"],
                                `office ${office} claims a current holder ${row.being} whose died value is present`,
                            ),
                        );
                }
            }

            const bounds = {};
            let invalidDate = false;
            for (const key of ["start", "end"]) {
                if (row[key] === undefined || row[key] === null) continue;
                const parsed = parseNoteDate(row[key], {
                    ...dates,
                    allowUnknown: false,
                    field: `data.governance.offices.${office}.holders.${key}`,
                    file: note.file,
                    raw: note.raw,
                    keyPath: [...rowPath, key],
                });
                findings.push(...parsed.findings);
                if (
                    parsed.date &&
                    parsed.date.month !== null &&
                    parsed.date.canonicalDay === undefined
                ) {
                    findings.push(
                        at(
                            [...rowPath, key],
                            `office ${office} holder ${key} needs a marker or canonical day to order it`,
                        ),
                    );
                    invalidDate = true;
                } else if (parsed.date && Number.isFinite(parsed.date.sort))
                    bounds[key] =
                        parsed.date.sort +
                        (key === "end" ?
                            ((parsed.date.spanDays ?? 1) - 1) / (dates.daysPerYear ?? 365)
                        :   0);
                else {
                    if (parsed.date)
                        findings.push(
                            at(
                                [...rowPath, key],
                                `office ${office} holder ${key} needs a resolved date`,
                            ),
                        );
                    invalidDate = true;
                }
            }
            if (bounds.start !== undefined && bounds.end !== undefined && bounds.end < bounds.start)
                findings.push(
                    at([...rowPath, "end"], `office ${office} holder ends before its start`),
                );
            if (!invalidDate)
                terms.push({
                    start: bounds.start ?? -Infinity,
                    end: bounds.end ?? Infinity,
                    contested: row.contested === true,
                    rowPath,
                });
        });
        for (let i = 0; i < terms.length; i++)
            for (let j = i + 1; j < terms.length; j++)
                if (
                    !terms[i].contested &&
                    !terms[j].contested &&
                    terms[i].start <= terms[j].end &&
                    terms[j].start <= terms[i].end
                )
                    findings.push(
                        at(terms[j].rowPath, `office ${office} has overlapping holder terms`),
                    );
    }
    return findings;
}
