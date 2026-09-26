/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { declaredSystems, systemBlocksFor } from "./system-vocabulary.mjs";
import { RETIRED_FIELD_ALIASES } from "./retired-fields.mjs";
import {
    isAddressTuple,
    parseAddress,
    renderAddress,
    acceptsType,
    readCanonicalKey,
} from "./address.mjs";
import { NOTE_VOCABULARY, dataFields } from "./note-vocabulary.mjs";
import { ASSET_TYPE_NAMES } from "./asset-types.mjs";
import { ART_SLOTS } from "./art-slots.mjs";
import { SHIPPED_SYSTEMS } from "./subtype-registry.mjs";

import { AddressEntries, AddressLink } from "./address-values.mjs";
export { AddressEntries, encodeAddresses, cloneAddressState } from "./address-values.mjs";

/** Structured positions whose Address is nested inside a declared container. */
export const STRUCTURED_ADDRESSES = Object.freeze([
    {
        path: ["packFolder"],
        shape: "scalar-or-map",
        type: "folder",
        accepts: ["folder"],
        system: "none",
    },
    {
        noteType: "affiliation",
        path: ["data", "governance", "ranks", "*", "lore"],
        shape: "value",
        type: "lore",
        accepts: ["lore"],
    },
    {
        noteType: "place",
        path: ["data", "borders", "*", "to"],
        shape: "value",
        type: "place",
        accepts: ["place"],
    },
    {
        noteType: "place",
        path: ["data", "routes", "*", "to"],
        shape: "value",
        type: "place",
        accepts: ["place"],
    },
]);

/**
 * All declared Address positions of a note, including embedded notes.
 * @param {object} fm - The note.
 * @returns {object[]} Position descriptors with container shape and defaults.
 */
export function addressPositions(fm, context = {}) {
    const out = [];
    for (const field of dataFields(fm.type) ?? []) {
        const shape =
            field.kind === "address" ? "value"
            : field.keyKind === "address" ? "keys"
            : field.entryKind === "address" ? field.kind
            : undefined;
        if (shape)
            out.push({
                path: ["data", ...field.name.split(".")],
                shape,
                type: field.ref,
                accepts: field.accepts,
                ...(ASSET_TYPE_NAMES.has(field.ref) || field.ref === "folder" ?
                    { system: "none" }
                :   {}),
            });
    }
    out.push(...STRUCTURED_ADDRESSES.filter((p) => !p.noteType || p.noteType === fm.type));
    for (const system of new Set([
        ...SHIPPED_SYSTEMS,
        ...Object.keys(context.systemBlocks ?? {}),
    ])) {
        out.push({
            path: [system, "packFolder"],
            shape: "scalar-or-map",
            type: "folder",
            accepts: ["folder"],
            system: "none",
        });
        out.push({
            path: [system, "items", "*", "model"],
            shape: "value",
            system,
            legacyShortcodeCase: true,
        });
        for (const slot of ART_SLOTS)
            out.push({
                path: [system, "items", "*", "data", slot.key],
                shape: "value",
                type: slot.type,
                accepts: slot.accepts,
                system: "none",
            });
        const spec = context.systemBlocks?.[system];
        for (const [index, entry] of (Array.isArray(fm[system]?.items) ?
            fm[system].items
        :   []
        ).entries()) {
            const model =
                entry?.model == null ?
                    null
                :   parseAddress(
                        entry.model,
                        {
                            ...context,
                            system,
                            types: new Set([...Object.keys(NOTE_VOCABULARY), ...ASSET_TYPE_NAMES]),
                        },
                        { declared: true, legacyShortcodeCase: true },
                    );
            const type = model && !model.reason ? model.type : entry?.type;
            for (const field of spec?.fields?.[type] ?? []) {
                if (!field.address) continue;
                out.push({
                    path: [system, "items", index, "system", ...field.to.split(".")],
                    shape:
                        field.address.holds === "items" ? "list" : (field.address.holds ?? "value"),
                    type: field.address.type,
                    accepts: field.address.accepts,
                    system:
                        (
                            ASSET_TYPE_NAMES.has(field.address.type) ||
                            field.address.type === "folder"
                        ) ?
                            "none"
                        :   system,
                });
            }
        }
        const fields = [
            ...(spec?.fields?.[fm.type] ?? []),
            ...(spec?.fieldVocabulary ? (context.schemas?.[fm.type]?.fields ?? []) : []),
        ];
        for (const field of fields) {
            if (!field.address) continue;
            const position = {
                shape: field.address.holds === "items" ? "list" : (field.address.holds ?? "value"),
                type: field.address.type,
                accepts: field.address.accepts,
                system:
                    ASSET_TYPE_NAMES.has(field.address.type) || field.address.type === "folder" ?
                        "none"
                    :   system,
            };
            out.push({ ...position, path: [system, "system", ...field.to.split(".")] });
            out.push({
                ...position,
                path: [system, ...(field.legacyKey ?? field.name).split(".")],
            });
            if (field.name?.startsWith("data.") && field.topLevelMeans === undefined)
                out.push({ ...position, path: field.name.slice(5).split(".") });
        }
    }
    for (const position of [...out]) {
        const last = position.path.at(-1);
        const retired = RETIRED_FIELD_ALIASES[last];
        if (retired) out.push({ ...position, path: [...position.path.slice(0, -1), retired] });
    }
    return out;
}

/**
 * Decode declared properties at the note boundary. Raw mappings cannot impersonate tuples.
 * @param {object} fm - Parsed YAML or an index record.
 * @param {object} context - The builder's package and known types.
 * @returns {object} The same note carrying typed Address properties.
 */
export function decodeNoteAddresses(fm, context) {
    if (!fm || typeof fm !== "object") return fm;
    const types = new Set([
        ...Object.keys(NOTE_VOCABULARY),
        ...ASSET_TYPE_NAMES,
        ...(context.types ?? []),
    ]);
    for (const position of addressPositions(fm, context)) {
        const defaults = {
            ...context,
            types,
            system: position.system ?? context.system ?? "note",
            type: position.type,
        };
        const fail = (value, path, description) => {
            const error = new Error(
                `\`${path.join(".")}\` ${description}: ${JSON.stringify(value)}`,
            );
            error.keyPath = path;
            error.addressKey = position.shape === "keys";
            throw error;
        };
        const read = (value, path) => {
            if (value == null || value === "") return value;
            const tuple = parseAddress(value, defaults, {
                declared: true,
                legacyShortcodeCase: position.legacyShortcodeCase,
            });
            if (tuple.reason) fail(value, path, "is not an accepted Address");
            if (position.accepts && !acceptsType(tuple, position.accepts))
                fail(
                    value,
                    path,
                    `must name a ${position.accepts.join(" or ")} Address, but names ${tuple.type}`,
                );
            return tuple;
        };
        const convert = (value, path) => {
            if (value == null || value === "") return value;
            if (position.shape === "keys") {
                if (value instanceof AddressEntries) return value;
                if (Array.isArray(value) && value.length === 0) return value;
                if (typeof value !== "object" || Array.isArray(value))
                    fail(value, path, "must be an Address-keyed map");
                return new AddressEntries(
                    Object.entries(value).map(([key, v]) => ({
                        target: read(key, [...path, key]),
                        value: v,
                        sourceKey: key,
                    })),
                );
            }
            if (position.shape === "list") {
                if (!Array.isArray(value)) fail(value, path, "must be a list of Addresses");
                return value.map((v, i) => read(v, [...path, i]));
            }
            if (
                position.shape === "scalar-or-map" &&
                typeof value === "object" &&
                !isAddressTuple(value)
            ) {
                if (Array.isArray(value)) {
                    if (!value.length) return value;
                    fail(value, path, "must be an Address or pack map");
                }
                return Object.fromEntries(
                    Object.entries(value).map(([key, v]) => [key, read(v, [...path, key])]),
                );
            }
            return read(value, path);
        };
        // Copy each traversed owner so YAML aliases retain their own read context.
        const visit = (owner, path, offset = 0, actual = []) => {
            if (owner == null || owner === "") return owner;
            const key = path[offset];
            if (key === "*") {
                if (!Array.isArray(owner)) fail(owner, actual, "must be a list of entries");
                return owner.map((value, i) => visit(value, path, offset + 1, [...actual, i]));
            }
            if (typeof owner !== "object") return owner;
            if (!Object.hasOwn(owner, key)) return owner;
            const copy = Array.isArray(owner) ? [...owner] : { ...owner };
            copy[key] =
                offset === path.length - 1 ?
                    convert(owner[key], [...actual, key])
                :   visit(owner[key], path, offset + 1, [...actual, key]);
            return copy;
        };
        const decoded = visit(fm, position.path);
        Object.assign(fm, decoded);
    }
    return fm;
}

/**
 * Read context supplied by the package configuration.
 * @param {object} config - Resolved package configuration.
 * @returns {object} Builder defaults and system declarations.
 */
export function noteAddressContext(config) {
    const systemBlocks = { ...systemBlocksFor(config) };
    // A module with one declared system uses its flat Item registry for that
    // system's Address positions, including fields stored in its content index.
    const systems = new Set([
        ...declaredSystems(config),
        ...(config.relationships?.systems ?? []).map((relationship) => relationship.id),
    ]);
    if (
        systems.size === 1 &&
        config.itemFields &&
        Object.keys(config.itemFieldsBySystem ?? {}).length === 0
    ) {
        const [system] = systems;
        systemBlocks[system] = { ...systemBlocks[system], fields: config.itemFields };
    }
    return {
        package: config.contentPackage,
        system: "note",
        systemBlocks,
    };
}

/**
 * Decode Address properties contributed by an index record.
 * @param {object} record - The record.
 * @param {object} context - Builder defaults.
 * @returns {object} The typed record.
 */
export function decodeIndexAddresses(record, context) {
    decodeNoteAddresses(record, context);
    const canonical = (value, keyPath) => {
        const target = readCanonicalKey(value);
        if (!isAddressTuple(target)) {
            const error = new Error(
                `Index ${keyPath.join(".")} is not a complete Address: ${JSON.stringify(value)}`,
            );
            error.keyPath = keyPath;
            throw error;
        }
        return target;
    };
    for (const key of ["documentation", "documents"]) {
        if (record[key] != null) record[key] = canonical(record[key], [key]);
    }
    if (record.address?.canonical != null)
        record.address.canonical = canonical(record.address.canonical, ["address", "canonical"]);
    for (const anchor of record.anchors ?? []) {
        if (!anchor.link || anchor.link instanceof AddressLink) continue;
        const [written, section] = anchor.link.split("#");
        const target = parseAddress(
            written,
            {
                ...context,
                system: "note",
                types: new Set([...Object.keys(NOTE_VOCABULARY), ...ASSET_TYPE_NAMES]),
            },
            { declared: true },
        );
        if (target.reason) throw new Error(`Index anchor link is not an Address: ${anchor.link}`);
        anchor.link = new AddressLink(target, section);
    }
    return record;
}
