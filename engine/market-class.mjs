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
 * What trade a settlement supports — a place note's `data.market`.
 *
 * `data.population` says how many people a settlement holds, which is not the
 * same question as what a traveller can buy there. Two settlements of eight
 * hundred are a different proposition when one has a weekly market and the
 * other a chartered fair with a moneylender, and `market` is where a note says
 * which.
 *
 * **The scale is six steps and is stated once, here.** The lint refuses a
 * value against it, the vocabulary's `describe` reads its ends, and
 * `docs/content-format.md` states it as a table the suite compares against
 * this list. A second copy of the scale is one more list free to disagree
 * about what a `4` buys.
 *
 * **A class is a step, not a measurement.** The numbers order the steps and
 * nothing more: a `5` is not a market two fifths larger than a `3`, it is a
 * city rather than a town. So a value off the scale is refused rather than
 * clamped — a reader of the scale has to be able to trust that every number
 * means the same thing wherever it appears.
 *
 * **The key is meaningful on a settlement**, and no subType condition is
 * checked. `population` states none either: which places a key says something
 * about is the author's judgement, and the `data:` container is closed per
 * type rather than per subType.
 *
 * @module
 */

import { positionOfFrontmatterPath } from "./diagnostics.mjs";

/**
 * One step of the market scale.
 *
 * @typedef {object} MarketClass
 * @property {number} value - The integer a note writes.
 * @property {string} name - What a settlement of this class is called.
 * @property {string} trade - What can be had there.
 */

/**
 * The market scale, in order, from the settlement with no market to the one
 * other markets buy from.
 *
 * @type {readonly MarketClass[]}
 */
export const MARKET_CLASSES = Object.freeze([
    Object.freeze({
        value: 1,
        name: "hamlet",
        trade: "no market — what neighbours trade among themselves",
    }),
    Object.freeze({
        value: 2,
        name: "village",
        trade: "a weekly market: staples, a smith, what a household cannot make",
    }),
    Object.freeze({
        value: 3,
        name: "town",
        trade: "a regular market, most common goods, several trades working full time",
    }),
    Object.freeze({
        value: 4,
        name: "market town",
        trade: "a chartered fair, goods carried from a week away, a moneylender",
    }),
    Object.freeze({
        value: 5,
        name: "city",
        trade: "anything ordinary, in quantity; foreign goods; a guild structure",
    }),
    Object.freeze({
        value: 6,
        name: "great city",
        trade:
            "the rare and the imported as a matter of course; banking; " +
            "the market from which other markets buy",
    }),
]);

/** The lowest class the scale states. @type {MarketClass} */
const LOWEST = MARKET_CLASSES[0];

/** The highest class the scale states. @type {MarketClass} */
const HIGHEST = MARKET_CLASSES[MARKET_CLASSES.length - 1];

/**
 * The scale's ends, as a finding states them: `1 (hamlet) to 6 (great city)`.
 *
 * @returns {string} The phrase.
 */
function scale() {
    return `${LOWEST.value} (${LOWEST.name}) to ${HIGHEST.value} (${HIGHEST.name})`;
}

/**
 * Whether a value is one of the classes the scale states.
 *
 * A note may write the number quoted, which YAML hands over as a string, so
 * the value is read as a number before it is compared — the same reading
 * `matchesKind` gives a `number` field.
 *
 * @param {unknown} value - The authored value.
 * @returns {boolean} Whether it names a class.
 */
export function isMarketClass(value) {
    const n = numberOf(value);
    return n !== undefined && MARKET_CLASSES.some((entry) => entry.value === n);
}

/**
 * The class a value names, or `undefined` for a value that names none.
 *
 * @param {unknown} value - The authored value.
 * @returns {MarketClass|undefined} The class.
 */
export function marketClass(value) {
    const n = numberOf(value);
    return MARKET_CLASSES.find((entry) => entry.value === n);
}

/**
 * A value as the finite number it reads as, or `undefined`.
 *
 * @param {unknown} value - The authored value.
 * @returns {number|undefined} The number.
 */
function numberOf(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
        return Number(value);
    }
    return undefined;
}

/**
 * Check a place note's `data.market`.
 *
 * The value is one of the classes the scale states, or it is a finding located
 * at the key's own line. A value that is not a number at all is left alone:
 * the container's own shape check reports it, and saying so twice would make
 * one slip read as two.
 *
 * @param {object} note - The note, as the link index hands it over.
 * @returns {object[]} Findings.
 */
export function checkMarket(note) {
    const fm = note?.fm ?? {};
    const data = fm.data && typeof fm.data === "object" && !Array.isArray(fm.data) ? fm.data : {};
    const value = data.market;
    if (value === undefined || value === null) return [];
    if (numberOf(value) === undefined) return [];
    if (isMarketClass(value)) return [];
    return [
        {
            file: note.file,
            ...positionOfFrontmatterPath(note.raw ?? "", ["data", "market"]),
            severity: "error",
            message:
                `\`data.market\` is a market class — a whole number from ${scale()} — ` +
                `but reads ${JSON.stringify(value)}`,
        },
    ];
}
