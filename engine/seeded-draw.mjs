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
/** Deterministic per-field draws. @module */
/** A 32-bit hash of a string (cyrb53's low half), the seed of one stream. */
function hash(text) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    return h1 >>> 0;
}

/**
 * A deterministic stream of numbers in `[0, 1)` (mulberry32), seeded by the
 * generation's seed and the path of the field it draws.
 *
 * @param {string} seed - The canonical spec and the caller's seed.
 * @param {string} field - The field's path.
 * @returns {() => number} The stream.
 */
export function stream(seed, field) {
    let state = hash(`${seed}\u0000${field}`);
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** One word drawn from a map of words to weights, in the map's own order. */
export function weighted(weights, next) {
    const entries = Object.entries(weights).filter(([, w]) => Number(w) > 0);
    const total = entries.reduce((sum, [, w]) => sum + Number(w), 0);
    let point = next() * total;
    for (const [word, w] of entries) {
        point -= Number(w);
        if (point < 0) return word;
    }
    return entries.at(-1)?.[0];
}
