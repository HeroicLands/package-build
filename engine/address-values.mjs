/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isAddressTuple, readCanonicalKey, renderAddress } from "./address.mjs";

/** Address-keyed properties hold typed entries rather than string object keys. */
export class AddressEntries {
    /** @param {Array<{target: object, value: unknown, sourceKey: string}>} entries - Typed entries and diagnostic source keys. */
    constructor(entries) {
        if (!entries.every((entry) => isAddressTuple(entry.target)))
            throw new TypeError("Address map keys must be complete tuples");
        this.entries = entries;
    }
}

/** An Address and an anchor within its note, with the anchor's kind where it is known. */
export class AddressLink {
    /**
     * @param {object} target - Complete tuple.
     * @param {string} anchor - The anchor's slug.
     * @param {"prose"|"event"|null} [kind] - The anchor's kind, or `null` where the
     *   position that holds the link does not fix one.
     */
    constructor(target, anchor, kind = null) {
        if (!isAddressTuple(target)) throw new TypeError("An Address link needs a complete tuple");
        this.target = target;
        this.anchor = anchor;
        this.kind = kind;
        Object.freeze(this);
    }
}

/** The keys of an Address as the published index writes it, and no others. */
export const PUBLISHED_ADDRESS_KEYS = Object.freeze(["address", "anchor", "anchorKind"]);

/**
 * Whether a parsed JSON value is an Address in its published form.
 *
 * @param {unknown} value - A value read from a published index.
 * @returns {boolean} Whether it is a map of exactly `address`, `anchor` and
 *   `anchorKind`, with `address` a string.
 */
export function isPublishedAddress(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const keys = Object.keys(value);
    return (
        keys.length === PUBLISHED_ADDRESS_KEYS.length &&
        PUBLISHED_ADDRESS_KEYS.every((key) => keys.includes(key)) &&
        typeof value.address === "string"
    );
}

/**
 * Write typed properties in the published index's form.
 *
 * Every Address becomes `{ address, anchor, anchorKind }`: `address` the full
 * canonical Address, `anchor` the anchor's slug or `null`, `anchorKind` its
 * kind or `null`. An Address-keyed map keeps string keys — JSON has no other —
 * and a key takes no anchor, so nothing is lost.
 *
 * @param {any} value - A tuple-bearing tree.
 * @param {WeakMap<object, object>} [seen] - Shared containers in this output.
 * @returns {any} A serializable tree.
 */
export function publishAddresses(value, seen = new WeakMap()) {
    if (value && typeof value === "object" && seen.has(value)) return seen.get(value);
    if (isAddressTuple(value))
        return { address: renderAddress(value), anchor: null, anchorKind: null };
    if (value instanceof AddressLink)
        return {
            address: renderAddress(value.target),
            anchor: value.anchor,
            anchorKind: value.kind ?? null,
        };
    if (value instanceof AddressEntries) {
        const out = {};
        seen.set(value, out);
        for (const { target, value: entry } of value.entries) {
            const key = renderAddress(target);
            if (Object.hasOwn(out, key)) throw new Error(`Repeated Address map key: ${key}`);
            out[key] = publishAddresses(entry, seen);
        }
        return out;
    }
    if (Array.isArray(value)) {
        const out = [];
        seen.set(value, out);
        for (const entry of value) out.push(publishAddresses(entry, seen));
        return out;
    }
    if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
        return value;
    const out = {};
    seen.set(value, out);
    for (const [key, entry] of Object.entries(value)) out[key] = publishAddresses(entry, seen);
    return out;
}

/**
 * Read a published index record back into typed properties: every published
 * Address becomes a tuple, or an {@link AddressLink} where it carries an anchor.
 *
 * @param {any} value - A parsed record.
 * @returns {any} The same tree, typed.
 * @throws {Error} When a published Address is not a complete canonical one.
 */
export function readPublishedAddresses(value) {
    // A record already typed in memory keeps its tuples: each is identified by
    // the object itself, which a copy is not.
    if (isAddressTuple(value) || value instanceof AddressLink || value instanceof AddressEntries)
        return value;
    if (isPublishedAddress(value)) {
        const target = readCanonicalKey(value.address);
        if (!isAddressTuple(target))
            throw new Error(`Published Address is not complete: ${JSON.stringify(value.address)}`);
        return value.anchor == null ?
                target
            :   new AddressLink(target, value.anchor, value.anchorKind ?? null);
    }
    if (Array.isArray(value)) return value.map(readPublishedAddresses);
    if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
        return value;
    return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, readPublishedAddresses(entry)]),
    );
}

/**
 * Write every published Address in a parsed record as a plain string — the
 * canonical Address, with `#<anchor>` where it carries one. What the SQL tables
 * present, so a fence compares an Address as the text an author writes.
 *
 * @param {any} value - A parsed record.
 * @returns {any} The same tree with each Address a string.
 */
export function flattenPublishedAddresses(value) {
    if (isPublishedAddress(value))
        return value.anchor == null ? value.address : `${value.address}#${value.anchor}`;
    if (Array.isArray(value)) return value.map(flattenPublishedAddresses);
    if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
        return value;
    return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, flattenPublishedAddresses(entry)]),
    );
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
