/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { completeAddress, ownDocumentSystem, renderAddress } from "./address.mjs";
import { NOTE_SYSTEM } from "./systems.mjs";
import { JOURNAL_TYPES } from "./ids.mjs";
import { hasDocEntry } from "./item-docs.mjs";

/**
 * Names and published destinations for reference presentation.
 * Stubs contribute names, never pages or documents. The published index
 * remains separate so body-link validation retains its publication rules.
 * @param {readonly object[]} records - Decoded local or fetched records.
 * @param {Map<string, object>} [published] - Actual published link destinations.
 * @returns {Map<string, object>} Canonical lookup keys and presentation values.
 */
export function buildReferenceTargets(records, published = new Map()) {
    const targets = new Map();
    for (const record of records) {
        if (!record.package || !record.type || !record.shortcode) continue;
        const value = { name: record.name?.full ?? record.name, subType: record.subType };
        const systems = new Set([ownDocumentSystem(record.type)]);
        if (JOURNAL_TYPES.has(record.type) || hasDocEntry(record.type)) systems.add(NOTE_SYSTEM);
        for (const system of systems) {
            const address = completeAddress({
                package: record.package,
                system,
                type: record.type,
                shortcode: record.shortcode,
            });
            const key = renderAddress(address);
            targets.set(key, { ...targets.get(key), ...value });
        }
        for (const [system, entry] of Object.entries(record.foundry ?? {})) {
            const address = completeAddress({
                package: record.package,
                system,
                type: record.type,
                shortcode: record.shortcode,
            });
            const key = renderAddress(address);
            targets.set(key, {
                ...targets.get(key),
                ...value,
                ...(entry.uuid ? { uuid: entry.uuid } : {}),
            });
        }
    }
    for (const [key, value] of published) targets.set(key, { ...targets.get(key), ...value });
    return targets;
}
