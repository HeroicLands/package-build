/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { parseAddress, renderAddress } from "./address.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { parseNoteDate } from "./note-dates.mjs";
import { reckoningContext } from "./reckoning-markers.mjs";

const OFFICE_KEYS = new Set(["description", "holders"]);
const HOLDER_KEYS = new Set(["being", "start", "end", "contested"]);
const mapping = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Validate one affiliation's office roster against dated beings in the corpus. */
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
    if (!mapping(offices))
        return [
            at(
                ["data", "governance", "offices"],
                "data.governance.offices must be a map of named offices",
            ),
        ];

    const dates = reckoningContext(index);
    for (const [office, value] of Object.entries(offices)) {
        const base = ["data", "governance", "offices", office];
        if (typeof value === "string") continue;
        if (!mapping(value)) {
            findings.push(
                at(base, `office ${office} must be a description or a {description, holders} map`),
            );
            continue;
        }
        for (const key of Object.keys(value))
            if (!OFFICE_KEYS.has(key))
                findings.push(
                    at(
                        [...base, key],
                        `office ${office} has unknown key ${key}; use description or holders`,
                    ),
                );
        if (typeof value.description !== "string")
            findings.push(
                at([...base, "description"], `office ${office} needs a string description`),
            );
        if (!Array.isArray(value.holders)) {
            findings.push(at([...base, "holders"], `office ${office} needs a holders list`));
            continue;
        }
        const terms = [];
        value.holders.forEach((row, position) => {
            const rowPath = [...base, "holders", position];
            if (!mapping(row)) {
                findings.push(at(rowPath, `office ${office} holder must be a map`));
                return;
            }
            for (const key of Object.keys(row))
                if (!HOLDER_KEYS.has(key))
                    findings.push(
                        at([...rowPath, key], `office ${office} holder has unknown key ${key}`),
                    );
            if (row.contested !== undefined && typeof row.contested !== "boolean")
                findings.push(
                    at(
                        [...rowPath, "contested"],
                        `office ${office} contested must be true or false`,
                    ),
                );

            if (typeof row.being !== "string" || !row.being.trim()) {
                findings.push(
                    at([...rowPath, "being"], `office ${office} holder needs a being Address`),
                );
            } else {
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
