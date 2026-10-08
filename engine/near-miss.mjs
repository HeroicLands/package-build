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
 * The near miss a closed vocabulary names when it refuses a key: the declared
 * key an unknown one was most likely meant to be, and the declared list as an
 * English sentence.
 *
 * Shared by every closed region — the top level, `data:`, a system block, and
 * the inner keys of a `data:` field — so a misspelling is answered the same
 * way at every depth.
 *
 * @module
 */

/**
 * Edit distance, capped — enough to answer "did you mean".
 *
 * A misspelled property is the failure class this check exists for, and a
 * finding that names the key the author *meant* turns a hunt through the
 * reference into a one-character fix.
 *
 * @param {string} a - One string.
 * @param {string} b - The other.
 * @returns {number} The Levenshtein distance.
 */
export function distance(a, b) {
    const rows = a.length + 1;
    const cols = b.length + 1;
    let prev = Array.from({ length: cols }, (_, j) => j);
    for (let i = 1; i < rows; i += 1) {
        const row = [i];
        for (let j = 1; j < cols; j += 1) {
            row[j] = Math.min(
                prev[j] + 1,
                row[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
        }
        prev = row;
    }
    return prev[cols - 1];
}

/**
 * A closed vocabulary as an English list, for the message that names it.
 *
 * Written from the declaration rather than spelled into the message, so a key
 * the vocabulary gains cannot go unmentioned by the finding that refuses its
 * neighbours.
 *
 * @param {readonly string[]} keys - The declared keys, in declared order.
 * @returns {string} `"a, b, or c"`.
 */
export function listed(keys) {
    if (keys.length < 2) return keys.join("");
    return `${keys.slice(0, -1).join(", ")}, or ${keys[keys.length - 1]}`;
}

/**
 * The declared key an unknown one was most likely meant to be.
 *
 * @param {string} key - The unknown key.
 * @param {Iterable<string>} candidates - The declared keys.
 * @returns {string|undefined} The nearest, when it is near enough to suggest.
 */
export function nearest(key, candidates) {
    let best;
    let bestAt = Infinity;
    for (const candidate of candidates) {
        const d = distance(key.toLowerCase(), candidate.toLowerCase());
        if (d < bestAt) {
            bestAt = d;
            best = candidate;
        }
    }
    // A third of the key's length, so a suggestion is a plausible typo rather
    // than the least-bad of a list of unrelated words.
    return bestAt <= Math.max(1, Math.floor(key.length / 3)) ? best : undefined;
}
