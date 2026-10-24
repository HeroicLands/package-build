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

/** Sequential, nested stage accounting for one content invocation. */
export function createContentTimings() {
    const started = performance.now();
    let changed = started;
    const stack = ["orchestration"];
    const stages = new Map();
    const hits = new Map();
    const account = () => {
        const now = performance.now();
        const name = stack.at(-1);
        stages.set(name, (stages.get(name) ?? 0) + now - changed);
        changed = now;
    };
    const begin = (name) => {
        account();
        stack.push(name);
        return () => {
            account();
            stack.pop();
        };
    };
    return {
        /** @template T @param {string} name @param {() => T} work @returns {T} */
        sync(name, work) {
            const stop = begin(name);
            try {
                return work();
            } finally {
                stop();
            }
        },
        /** @template T @param {string} name @param {() => Promise<T>|T} work @returns {Promise<T>} */
        async measure(name, work) {
            const stop = begin(name);
            try {
                return await work();
            } finally {
                stop();
            }
        },
        /** @param {string} name */
        hit(name) {
            hits.set(name, (hits.get(name) ?? 0) + 1);
        },
        snapshot() {
            account();
            return {
                totalMs: changed - started,
                stages: Object.fromEntries(stages),
                hits: Object.fromEntries(hits),
            };
        },
    };
}
