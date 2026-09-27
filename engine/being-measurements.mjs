/* SPDX-License-Identifier: GPL-3.0-or-later */

import { positionOfFrontmatterPath } from "./diagnostics.mjs";

const INCHES_PER_METRE = 39.3701;
const POUNDS_PER_KILOGRAM = 2.20462;

/** Measurements are displayed as whole imperial units. */
function safeRound(value) {
    const rounded = Math.round(value);
    return Number.isSafeInteger(rounded) && rounded >= 0 ? rounded : null;
}

/** Read a being's height as a whole number of inches. */
export function parseBeingHeight(value) {
    if (typeof value === "number")
        return Number.isFinite(value) && value >= 0 ? safeRound(value * INCHES_PER_METRE) : null;
    if (typeof value !== "string") return null;
    const metric = /^(\d+(?:\.\d+)?) ?m$/.exec(value);
    if (metric) return safeRound(Number(metric[1]) * INCHES_PER_METRE);
    const imperial = /^(\d+)'(?:\s*(\d{1,2})")?$/.exec(value);
    if (!imperial) return null;
    const inches = Number(imperial[2] ?? 0);
    return inches <= 11 ? safeRound(Number(imperial[1]) * 12 + inches) : null;
}

/** Read a being's weight as a whole number of pounds. */
export function parseBeingWeight(value) {
    if (typeof value === "number")
        return Number.isFinite(value) && value >= 0 ? safeRound(value * POUNDS_PER_KILOGRAM) : null;
    if (typeof value !== "string") return null;
    const metric = /^(\d+(?:\.\d+)?) ?kg$/.exec(value);
    if (metric) return safeRound(Number(metric[1]) * POUNDS_PER_KILOGRAM);
    const imperial = /^(\d+) ?lbs$/.exec(value);
    return imperial ? safeRound(Number(imperial[1])) : null;
}

/** Show a being's height in feet and inches. */
export function displayBeingHeight(value) {
    const inches = parseBeingHeight(value);
    if (inches === null) return String(value);
    const feet = Math.floor(inches / 12);
    const remainder = inches % 12;
    return String(feet) + "′" + (remainder ? " " + String(remainder) + "″" : "");
}

/** Show a being's weight in pounds. */
export function displayBeingWeight(value) {
    const pounds = parseBeingWeight(value);
    return pounds === null ? String(value) : String(pounds) + " lbs";
}

/** Check one authored being measurement at its frontmatter position. */
export function checkBeingMeasurement(note, key, parse) {
    const value = note.fm?.data?.[key];
    if (value === undefined || value === null || parse(value) !== null) return [];
    return [
        {
            ...(note.file ? { file: note.file } : {}),
            ...positionOfFrontmatterPath(note.raw ?? "", ["data", key]),
            severity: "error",
            message:
                "data." +
                key +
                (key === "height" ?
                    " needs metres or feet and inches, such as 1.91m or 6' 3\""
                :   " needs kilograms or pounds, such as 85kg or 187 lbs"),
        },
    ];
}
