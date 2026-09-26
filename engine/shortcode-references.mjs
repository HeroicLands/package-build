/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { completeAddress, isAddressTuple, readCanonicalKey, renderAddress } from "./address.mjs";

const nativeIndexes = new WeakMap();

/**
 * Index a completed presentation map by native namespace and Shortcode.
 * Callers finish populating a map before resolving references through it.
 * @param {Map<string, object>} index - Completed identity index.
 * @returns {Map<string, object[]>} Native matches grouped by declared namespace.
 */
function nativeIndex(index) {
    if (nativeIndexes.has(index)) return nativeIndexes.get(index);
    const grouped = new Map();
    for (const [key, value] of index) {
        const address = readCanonicalKey(key);
        if (!isAddressTuple(address)) continue;
        const namespace = `${address.system}/${address.type}/${address.shortcode}`;
        const matches = grouped.get(namespace) ?? [];
        matches.push({ key, address, value });
        grouped.set(namespace, matches);
    }
    nativeIndexes.set(index, grouped);
    return grouped;
}

/**
 * Present a native Shortcode using its unique system/type target.
 * Address properties never use this lookup. Multiple packages claiming the
 * same native identity remain ambiguous. Documentation supplies links; the
 * native target supplies a name even when its documentation is unpublished.
 * @param {readonly Map<string, object>[]} indexes - Published identity indexes.
 * @param {unknown} code - Native Shortcode.
 * @param {{type: string, system: string}} hint - Its declared native namespace.
 * @returns {object|undefined} Documentation presentation, or no unique target.
 */
export function resolveShortcodeReference(indexes, code, hint) {
    if (typeof code !== "string" || !code || !hint.type || !hint.system) return undefined;
    const matches = new Map();
    const namespace = `${hint.system}/${hint.type}/${code.toLowerCase()}`;
    for (const index of indexes) {
        if (!index) continue;
        for (const match of nativeIndex(index).get(namespace) ?? [])
            if (!matches.has(match.key)) matches.set(match.key, match);
    }
    if (matches.size !== 1) return undefined;
    const { address: native, value } = matches.values().next().value;
    const address = completeAddress({
        package: native.package,
        system: "note",
        type: native.type,
        shortcode: native.shortcode,
    });
    const key = renderAddress(address);
    const documentation = indexes.map((index) => index?.get(key)).find(Boolean);
    return {
        name: documentation?.name ?? value.name,
        subType: documentation?.subType ?? value.subType,
        address,
        ...(documentation?.uuid ? { uuid: documentation.uuid } : {}),
        ...(documentation?.url ? { url: documentation.url } : {}),
    };
}
