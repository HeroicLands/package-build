/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isAddressTuple, renderAddress } from "./address.mjs";

/** Address-keyed properties hold typed entries rather than string object keys. */
export class AddressEntries {
    /** @param {Array<{target: object, value: unknown, sourceKey: string}>} entries - Typed entries and diagnostic source keys. */
    constructor(entries) {
        if (!entries.every((entry) => isAddressTuple(entry.target)))
            throw new TypeError("Address map keys must be complete tuples");
        this.entries = entries;
    }
}

/** An Address and the section within its document. */
export class AddressLink {
    /** @param {object} target - Complete tuple. @param {string} anchor - Section slug. */
    constructor(target, anchor) {
        if (!isAddressTuple(target)) throw new TypeError("An Address link needs a complete tuple");
        this.target = target;
        this.anchor = anchor;
        Object.freeze(this);
    }
}

/**
 * Render typed properties at a generated-output boundary.
 * @param {any} value - A tuple-bearing tree.
 * @param {WeakMap<object, object>} [seen] - Shared containers in this output.
 * @returns {any} A serializable tree containing full Addresses.
 */
export function encodeAddresses(value, seen = new WeakMap()) {
    if (value && typeof value === "object" && seen.has(value)) return seen.get(value);
    if (isAddressTuple(value)) return renderAddress(value);
    if (value instanceof AddressLink) return `${renderAddress(value.target)}#${value.anchor}`;
    if (value instanceof AddressEntries) {
        const out = {};
        seen.set(value, out);
        for (const { target, value: entry } of value.entries) {
            const key = renderAddress(target);
            if (Object.hasOwn(out, key)) throw new Error(`Repeated Address map key: ${key}`);
            out[key] = encodeAddresses(entry, seen);
        }
        return out;
    }
    if (Array.isArray(value)) {
        const out = [];
        seen.set(value, out);
        for (const entry of value) out.push(encodeAddresses(entry, seen));
        return out;
    }
    if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
        return value;
    const out = {};
    seen.set(value, out);
    for (const [key, entry] of Object.entries(value)) out[key] = encodeAddresses(entry, seen);
    return out;
}

/**
 * Clone mutable note state while retaining immutable Address identities.
 * @param {any} value - Typed note state.
 * @returns {any} An independent mutable container tree.
 */
export function cloneAddressState(value) {
    if (isAddressTuple(value)) return value;
    if (value instanceof AddressEntries)
        return new AddressEntries(
            value.entries.map((entry) => ({ ...entry, value: cloneAddressState(entry.value) })),
        );
    if (Array.isArray(value)) return value.map(cloneAddressState);
    if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
        return value;
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, cloneAddressState(v)]));
}
