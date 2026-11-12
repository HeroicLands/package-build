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
import { isPlainMap } from "./data-keys.mjs";
import { deepMerge } from "./deep-merge.mjs";

/**
 * Apply an item note's neutral defaults to an entry, preserving its identity.
 * @param {object} entry - The neutral item entry.
 * @param {object|undefined} model - The indexed item note.
 * @returns {object} The entry with model defaults.
 */
export function resolveItemDefaults(entry, model) {
    if (!isPlainMap(entry) || !isPlainMap(model?.data)) return entry;
    const { kind, name, img, system } = model.data;
    const defaults = Object.fromEntries(
        Object.entries({ kind, name, img, system }).filter(([, value]) => value !== undefined),
    );
    return deepMerge(defaults, entry);
}

/**
 * Combine neutral entries with system defaults and consume matching keys.
 * @param {object[]} neutral - Neutral item entries.
 * @param {object[]} declared - System entries.
 * @param {string} system - The target system.
 * @param {(address: any) => any} findModel - Resolve an item model.
 * @returns {object} Compiled input entries and their source positions.
 */
export function systemItemEntries(neutral, declared, system, findModel) {
    const remaining = [...(Array.isArray(declared) ? declared : [])];
    const remainingIndices = remaining.map((_, index) => index);
    const entries = [];
    const sources = [];
    const missingType = [];
    for (const [index, entry] of (Array.isArray(neutral) ? neutral : []).entries()) {
        if (!isPlainMap(entry)) continue;
        const match =
            typeof entry.key === "string" ?
                remaining.findIndex((item) => item?.key === entry.key)
            :   -1;
        const override = match < 0 ? undefined : remaining.splice(match, 1)[0];
        const originalIndex = match < 0 ? undefined : remainingIndices.splice(match, 1)[0];
        const model = entry.model == null ? undefined : findModel(entry.model);
        const block = model?.[system];
        if (block && !block.type) {
            missingType.push(index);
            if (match >= 0) {
                remaining.splice(match, 0, override);
                remainingIndices.splice(match, 0, originalIndex);
            }
            continue;
        }
        if (!block?.type && !override?.type && !override?.model) {
            if (match >= 0) {
                remaining.splice(match, 0, override);
                remainingIndices.splice(match, 0, originalIndex);
            }
            continue;
        }
        const { kind: _kind, ...fields } = resolveItemDefaults(entry, model);
        entries.push(deepMerge(deepMerge(block ?? {}, fields), override ?? {}));
        sources.push({
            index,
            neutralModel: entry.model,
            systemModel: override?.model,
            neutral: entry,
            override,
        });
    }
    return { entries, sources, remaining, remainingIndices, missingType };
}
