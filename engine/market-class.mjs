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

/** The settlement market vocabulary. @module */
import { positionOfFrontmatterPath } from "./diagnostics.mjs";
/** @typedef {{value: string, name: string, trade: string}} MarketClass */
/** @type {readonly MarketClass[]} */
export const MARKET_CLASSES = Object.freeze(
    [
        { value: "international", name: "International", trade: "Trade across nations." },
        { value: "regional", name: "Regional", trade: "Trade across the surrounding region." },
        { value: "local", name: "Local", trade: "Trade among nearby settlements." },
        { value: "subsistence", name: "Subsistence", trade: "Production for local needs." },
    ].map(Object.freeze),
);
/** The declared class, if the value names one. */
export function marketClass(value) {
    return MARKET_CLASSES.find((entry) => entry.value === value);
}
/** Whether the authored value names a market class. */
export function isMarketClass(value) {
    return Boolean(marketClass(value));
}
/** Located findings for a place's market. */
export function checkMarket(note) {
    const value = note?.fm?.data?.market;
    if (
        value === undefined ||
        (value !== null && typeof value === "object") ||
        isMarketClass(value)
    )
        return [];
    return [
        {
            file: note.file,
            ...positionOfFrontmatterPath(note.raw ?? "", ["data", "market"]),
            severity: "error",
            message: `\`data.market\` must be ${MARKET_CLASSES.map((c) => c.value).join(", ")}; got ${JSON.stringify(value)}`,
        },
    ];
}
