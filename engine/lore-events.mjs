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

/**
 * Validate a `lore` note's `data.events` list, entry by entry.
 *
 * `data.events` is declared `kind: "list"` with a prose `shape`, the way
 * `data.eras` already is (`engine/calendar-notes.mjs`), and checked by its own
 * walker rather than by the generic `data:` container check, which only knows
 * that the value is an array. Every finding here is positioned at
 * `["data", "events", position, ...]`, so it lands on the entry that carries
 * the fault rather than on the note.
 *
 * @module
 */

import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { parseNoteDate } from "./note-dates.mjs";
import { reckoningContext } from "./reckoning-markers.mjs";

/** Whether a value is a plain map — not `null`, not an array. */
function mapping(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate one `lore` note's `data.events`.
 *
 * Registered as the `events` field's own `check` in `note-vocabulary.mjs`, so
 * it runs on every `lore` note regardless of `subType` — an occasion is not a
 * calendar fact, and nothing here is scoped to `subType: calendar`.
 *
 * @param {object} note - The note, as the link index hands it over.
 * @param {{index?: object}} [options]
 * @returns {object[]} Findings, each positioned at the entry that earned it.
 */
export function checkLoreEvents(note, { index } = {}) {
    const events = note.fm?.data?.events;
    if (!Array.isArray(events)) return [];

    const findings = [];
    const dates = reckoningContext(index);
    const at = (path, message) => ({
        file: note.file,
        ...positionOfFrontmatterPath(note.raw ?? "", path),
        severity: "error",
        message,
    });

    events.forEach((entry, position) => {
        const row = mapping(entry) ? entry : {};
        const base = ["data", "events", position];

        const when = parseNoteDate(row.when, {
            ...dates,
            allowUnknown: true,
            allowZeroYear: true,
            field: "when",
            file: note.file,
            raw: note.raw,
            keyPath: [...base, "when"],
        });
        findings.push(...when.findings);

        const until = parseNoteDate(row.until, {
            ...dates,
            allowUnknown: false,
            field: "until",
            file: note.file,
            raw: note.raw,
            keyPath: [...base, "until"],
        });
        findings.push(...until.findings);

        const recurs = row.recurs;
        if (recurs === undefined || recurs === null) return;

        if (row.when === undefined || row.when === null) {
            findings.push(
                at(
                    [...base, "recurs"],
                    "`recurs` needs a `when` of its own — a recurrence counts from the anchor it names",
                ),
            );
            return;
        }
        if (when.date?.known && when.date.year === 0) {
            findings.push(
                at(
                    [...base, "recurs"],
                    "`recurs` is refused beside a `when` of year 0 — that date already recurs " +
                        "on that day every year, and `every` above 1 cannot be counted without " +
                        "an anchor year",
                ),
            );
            return;
        }
        if (!mapping(recurs)) {
            findings.push(at([...base, "recurs"], "`recurs` is a map of `every` or `on`"));
            return;
        }

        const hasEvery = Object.hasOwn(recurs, "every");
        const hasOn = Object.hasOwn(recurs, "on");
        if (hasEvery && hasOn) {
            findings.push(
                at(
                    [...base, "recurs"],
                    "`recurs` declares exactly one of `every` or `on`, not both — a period " +
                        "with exceptions is written as an enumeration",
                ),
            );
            return;
        }
        if (!hasEvery && !hasOn) {
            findings.push(
                at(
                    [...base, "recurs"],
                    "`recurs` needs `every` or `on` — its absence is what says the occasion " +
                        "happened once",
                ),
            );
            return;
        }

        if (hasEvery) {
            const { every } = recurs;
            if (!(Number.isInteger(every) && every >= 1)) {
                findings.push(
                    at(
                        [...base, "recurs", "every"],
                        `\`recurs.every\` needs a whole number of years, 1 or more, but reads ` +
                            `${JSON.stringify(every)}`,
                    ),
                );
            }
            return;
        }

        if (row.until !== undefined && row.until !== null) {
            findings.push(
                at(
                    [...base, "until"],
                    "`until` is refused beside `recurs.on` — the enumeration states its own " +
                        "last entry",
                ),
            );
        }

        const onList = recurs.on;
        if (!Array.isArray(onList) || onList.length === 0) {
            findings.push(at([...base, "recurs", "on"], "`recurs.on` needs a list of dates"));
            return;
        }

        let previous = when.date?.known ? when.date : null;
        onList.forEach((onRaw, onPosition) => {
            const onPath = [...base, "recurs", "on", onPosition];
            const onParsed = parseNoteDate(onRaw, {
                ...dates,
                allowUnknown: false,
                field: "recurs.on",
                file: note.file,
                raw: note.raw,
                keyPath: onPath,
            });
            findings.push(...onParsed.findings);
            const onDate = onParsed.date;
            if (onDate?.known && previous?.known) {
                if (onDate.sort <= previous.sort) {
                    findings.push(
                        at(
                            onPath,
                            onPosition === 0 ?
                                "`recurs.on` entry is at or before `when`, so it is not a " +
                                    "later occurrence"
                            :   "`recurs.on` entries are not strictly increasing",
                        ),
                    );
                }
            }
            if (onDate?.known) previous = onDate;
        });
    });

    return findings;
}
