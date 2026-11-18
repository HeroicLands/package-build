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
/** Validate authored movement profiles. @module */
import { locatedFinding } from "./diagnostics.mjs";
import { pathLabel, fitsKind } from "./data-keys.mjs";
import { MOVEMENT_PROFILE_MEDIA } from "./movement-profile-terms.mjs";

/** @param {any} note - Indexed note and source. @returns {object[]} Located findings. */
export function checkMovementProfiles(note) {
    const data = (note.fm ?? note).data ?? {};
    if (!Object.hasOwn(data, "movementProfiles")) return [];
    const out = [];
    const report = (path, message) =>
        out.push(locatedFinding(note, path, `${pathLabel(path)}: ${message}`));
    const path = ["data", "movementProfiles"];
    if (data.movementProfiles === null) report(path, "must be a list");
    if (!Array.isArray(data.movementProfiles)) return out;
    data.movementProfiles.forEach((row, i) => {
        const p = [...path, i];
        if (row == null || (Array.isArray(row) && !row.length))
            report(p, "must be a movement profile record");
        if (!row || typeof row !== "object" || Array.isArray(row)) return;
        if (
            typeof row.medium === "string" &&
            row.medium.trim() &&
            !MOVEMENT_PROFILE_MEDIA.includes(row.medium)
        )
            report(
                [...p, "medium"],
                `${JSON.stringify(row.medium)} must be one of ${MOVEMENT_PROFILE_MEDIA.join(", ")}`,
            );
        for (const key of ["feetPerRound", "leaguesPerWatch"])
            if (
                Object.hasOwn(row, key) &&
                (row[key] === null ||
                    (typeof row[key] === "number" && !Number.isFinite(row[key])) ||
                    (fitsKind(row[key], "number") &&
                        (typeof row[key] !== "number" ||
                            row[key] < 0 ||
                            (key === "feetPerRound" && !Number.isSafeInteger(row[key])))))
            )
                report(
                    [...p, key],
                    `${JSON.stringify(row[key])} must be a finite nonnegative number` +
                        (key === "feetPerRound" ? " of whole feet" : ""),
                );
    });
    return out;
}
