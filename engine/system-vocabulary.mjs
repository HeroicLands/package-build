/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Systems named by package declarations and pack targets.
 * @param {object} [config] - Resolved build configuration.
 * @returns {string[]} Declared system identifiers.
 */
export function declaredSystems(config) {
    const out = [];
    for (const system of Object.keys(config?.systems ?? {})) {
        if (!out.includes(system)) out.push(system);
    }
    for (const pack of config?.packs ?? []) {
        const system = pack?.system;
        if (typeof system === "string" && system && !out.includes(system)) out.push(system);
    }
    if (out.length) return out;
    const packageWide = config?.stats?.systemId;
    return typeof packageWide === "string" && packageWide ? [packageWide] : [];
}

/**
 * System field vocabularies supplied by the configuration and caller.
 * @param {object} [config] - Resolved build configuration.
 * @param {object} [options] - Caller schema context.
 * @param {string} [options.schemaSystem] - Owner of the caller's schemas.
 * @returns {object} System block declarations.
 */
export function systemBlocksFor(config, { schemaSystem } = {}) {
    const byName = config?.itemFieldsBySystem ?? {};
    /** @type {Record<string, object>} */
    const blocks = {};
    for (const system of declaredSystems(config)) {
        /** @type {object} */
        const spec = {};
        if (system === schemaSystem) spec.fieldVocabulary = true;
        if (byName[system]) spec.fields = byName[system];
        if (Object.keys(spec).length) blocks[system] = Object.freeze(spec);
    }
    return Object.freeze(blocks);
}
