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

import { fitsKind } from "./data-keys.mjs";

/** @typedef {{actual: number|string|null, apparent?: number|string|null}} Population */
/** @typedef {{actual: number|null, apparent: number|null}} ProjectedPopulation */

/** @param {number|string|null} value @returns {number|null} */
function numberOrNull(value) {
    if (value === null) return null;
    if (!fitsKind(value, "number"))
        throw new TypeError("Population figure must be a number or null");
    return Number(value);
}
/** @typedef {"public"|"all"} PopulationAudience */

/** @param {Population|undefined} value @returns {number|null|undefined} */
export function populationActual(value) {
    return value === undefined ? undefined : numberOrNull(value.actual);
}
/** @param {Population|undefined} value @returns {number|null|undefined} */
export function populationApparent(value) {
    return (
        value === undefined ? undefined
        : Object.hasOwn(value, "apparent") ?
            numberOrNull(/** @type {number|string|null} */ (value.apparent))
        :   numberOrNull(value.actual)
    );
}
/** @param {Population|undefined} value @param {PopulationAudience} [audience] @returns {number|null|undefined} */
export function populationForAudience(value, audience = "public") {
    if (audience !== "public" && audience !== "all")
        throw new Error(`Unknown population audience: ${audience}`);
    return audience === "all" ? populationActual(value) : populationApparent(value);
}
/** @param {Population|undefined} value @returns {boolean} */
export function populationDiffers(value) {
    return value !== undefined && populationActual(value) !== populationApparent(value);
}
/** @param {Population|undefined} value @param {PopulationAudience} [audience] @returns {ProjectedPopulation|undefined} */
export function projectPopulation(value, audience = "public") {
    populationForAudience(value, audience);
    if (value === undefined) return undefined;
    const apparent = numberOrNull(
        Object.hasOwn(value, "apparent") ?
            /** @type {number|string|null} */ (value.apparent)
        :   value.actual,
    );
    return {
        actual:
            audience === "public" && populationDiffers(value) ? null : numberOrNull(value.actual),
        apparent,
    };
}
/** @param {any} fm @param {PopulationAudience} [audience] @returns {any} */
export function projectPopulationFrontmatter(fm, audience = "public") {
    populationForAudience(undefined, audience);
    if (!fm || typeof fm !== "object") return fm;
    const data = fm.data;
    if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(data))
    )
        return { ...fm };
    const projected = { ...data };
    for (const key of ["population", "territorial_population"]) {
        if (Object.hasOwn(data, key)) projected[key] = projectPopulation(data[key], audience);
    }
    if (Array.isArray(data.settlements))
        projected.settlements = data.settlements.map((row) => {
            if (
                !row ||
                typeof row !== "object" ||
                ![Object.prototype, null].includes(Object.getPrototypeOf(row)) ||
                !Object.hasOwn(row, "population")
            )
                return row;
            return { ...row, population: projectPopulation(row.population, audience) };
        });
    return { ...fm, data: projected };
}
