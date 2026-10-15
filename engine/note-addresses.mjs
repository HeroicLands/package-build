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

import { declaredSystems, systemBlocksFor } from "./system-vocabulary.mjs";
import { inBlockKey } from "./system-block.mjs";
import {
    isAddressTuple,
    parseAddress,
    renderAddress,
    acceptsType,
    hasAnchor,
    readCanonicalKey,
    splitAnchor,
} from "./address.mjs";
import { NOTE_VOCABULARY, dataFields } from "./note-vocabulary.mjs";
import { ASSET_TYPE_NAMES } from "./asset-types.mjs";
import { ART_SLOTS } from "./art-slots.mjs";
import { SHIPPED_SYSTEMS } from "./subtype-registry.mjs";
import { EVENT_ADDRESS_POSITIONS } from "./note-events.mjs";

import { AddressEntries, AddressLink, readPublishedAddresses } from "./address-values.mjs";
import { formatDiagnostic } from "./diagnostics.mjs";
export {
    AddressEntries,
    encodeAddresses,
    cloneAddressState,
    publishAddresses,
    readPublishedAddresses,
    flattenPublishedAddresses,
} from "./address-values.mjs";

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
    // A language's Addresses and a glossary entry's language, read leniently:
    // a value that is no Address stays as written, for the language or
    // glossary check to refuse at its own key.
    {
        noteType: "skill",
        path: ["data", "tongues", "*", "language"],
        shape: "value",
        type: "skill",
        accepts: ["skill"],
        lenient: true,
    },
    ...["from", "to"].map((key) => ({
        noteType: "skill",
        path: ["data", "soundChanges", "*", key],
        shape: "value",
        type: "skill",
        accepts: ["skill"],
        lenient: true,
    })),
    {
        noteType: "skill",
        path: ["data", "cognates", "*", "forms"],
        shape: "keys",
        type: "skill",
        accepts: ["skill"],
        lenient: true,
    },
    ...[
        ["folders", "folder", ["folder"], "none"],
        ["cultures", "lore", ["lore"]],
        ["lore", "lore", ["lore"]],
        ["parents", "place", undefined],
        ["addresses", undefined, undefined],
        ["skip", undefined, undefined],
    ].map(([kind, type, accepts, system]) => ({
        noteType: "skill",
        path: ["data", "scope", kind],
        shape: "list",
        ...(type ? { type } : {}),
        ...(accepts ? { accepts } : {}),
        ...(system ? { system } : {}),
        lenient: true,
    })),
    {
        noteType: "skill",
        path: ["data", "words", "*", "source", "language"],
        shape: "value",
        type: "skill",
        accepts: ["skill"],
        lenient: true,
    },
    ...["lore", "affiliation"].map((noteType) => ({
        noteType,
        path: ["data", "glossary", "*", "language"],
        shape: "value",
        type: "skill",
        accepts: ["skill"],
        lenient: true,
    })),
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
                ...(field.declines === undefined ? {} : { declines: field.declines }),
                ...(field.anchors ? { anchors: field.anchors } : {}),
                ...(ASSET_TYPE_NAMES.has(field.ref) || field.ref === "folder" ?
                    { system: "none" }
                :   {}),
            });
    }
    out.push(...STRUCTURED_ADDRESSES.filter((p) => !p.noteType || p.noteType === fm.type));
    // An event's Addresses, on every type that carries events. Read leniently:
    // a value that is no accepted Address stays as written, for the event
    // check to refuse at its own key with the message its key earns, rather
    // than taking the whole note out of the index.
    if ((dataFields(fm.type) ?? []).some((field) => field.name === "events"))
        for (const position of EVENT_ADDRESS_POSITIONS)
            out.push({
                ...position,
                path: ["data", "events", "*", ...position.path],
                lenient: true,
            });
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
                        { declared: true },
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
            const inBlock = inBlockKey(field);
            if (inBlock !== undefined) {
                out.push({ ...position, path: [system, ...inBlock.split(".")] });
            }
            if (field.name?.startsWith("data.") && field.topLevelMeans === undefined)
                out.push({ ...position, path: field.name.slice(5).split(".") });
        }
    }
    return out;
}

/**
 * The finding for a declared Address whose shortcode carries a capital.
 *
 * A shortcode is lowercase, and a declared Address is read as written, so the
 * value is refused rather than folded. Where the lowercase spelling names
 * something the context declares, the message names that shortcode.
 *
 * @param {import("./address.mjs").AddressProblem} problem - The parser's verdict.
 * @param {Array<string|number>} path - The value's key path.
 * @param {{shape?: string}} position - The Address position it sits in.
 * @param {{declaresAddress?: (tuple: object) => boolean}} context - The
 *   decode context; `declaresAddress` answers whether a complete Address names
 *   a declared note or item.
 * @returns {Error & {keyPath: Array<string|number>, addressKey: boolean}} The
 *   located error.
 */
function shortcodeCaseError(problem, path, position, context) {
    const declared =
        context.declaresAddress?.(problem.lowercase) ?
            `; the declared shortcode is \`${problem.lowercase.shortcode}\``
        :   "";
    const error = new Error(
        `\`${path.join(".")}\` shortcode \`${problem.shortcode}\` must be lowercase${declared}`,
    );
    error.keyPath = path;
    error.addressKey = position.shape === "keys";
    return /** @type {any} */ (error);
}

/**
 * Decode declared properties at the note boundary. Raw mappings cannot impersonate tuples.
 *
 * A declared Address is read as written. A shortcode spelled with a capital is
 * refused, and every such value in the note is collected before the decode
 * throws, so each reference is reported at its own position: the thrown error
 * describes the first, and its `findings` carry all of them.
 *
 * @param {object} fm - Parsed YAML or an index record.
 * @param {object} context - The builder's package and known types, and
 *   optionally `declaresAddress`, which names the lowercase spelling of a
 *   refused shortcode when it is declared.
 * @returns {object} The same note carrying typed Address properties.
 * @throws {Error} When a declared Address is refused; `keyPath` locates it, and
 *   `findings`, where present, lists every refused shortcode.
 */
export function decodeNoteAddresses(fm, context) {
    if (!fm || typeof fm !== "object") return fm;
    /** @type {Array<Error & {keyPath: Array<string|number>}>} */
    const refused = [];
    try {
        decodePositions(fm, context, refused);
    } catch (error) {
        if (refused.length && error?.keyPath) error.findings = [...refused, error];
        throw error;
    }
    if (refused.length) {
        const [first] = refused;
        /** @type {any} */ (first).findings = refused;
        throw first;
    }
    return fm;
}

/**
 * The body of {@link decodeNoteAddresses}: every Address position, decoded in
 * place.
 *
 * @param {object} fm - The note.
 * @param {object} context - The decode context.
 * @param {Error[]} refused - Collects each refused shortcode.
 * @returns {void}
 */
function decodePositions(fm, context, refused) {
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
            // The word a position declines with is not an Address; it stays as
            // written so every later stage can tell it from an image.
            if (position.declines !== undefined && value === position.declines) return value;
            if (value instanceof AddressLink) {
                if (!position.anchors)
                    fail(
                        value,
                        path,
                        "takes no anchor — it names a whole note, so write the Address without `#…`",
                    );
                return value;
            }
            // An anchor is admitted only where the position declares the kinds
            // it takes; the anchor's existence and kind are a resolution
            // question, asked where the index is.
            const anchored = hasAnchor(value);
            if (anchored && !position.anchors)
                fail(
                    value,
                    path,
                    "takes no anchor — it names a whole note, so write the Address without `#…`",
                );
            const { address: written, anchor } = anchored ? splitAnchor(value) : { address: value };
            const tuple = parseAddress(written, defaults, { declared: true });
            if (tuple.reason === "shortcode-not-lowercase" && !position.lenient) {
                refused.push(shortcodeCaseError(tuple, path, position, context));
                return value;
            }
            if (tuple.reason) fail(value, path, "is not an accepted Address");
            if (position.accepts && !acceptsType(tuple, position.accepts))
                fail(
                    value,
                    path,
                    `must name a ${position.accepts.join(" or ")} Address, but names ${tuple.type}`,
                );
            return anchored ?
                    new AddressLink(
                        tuple,
                        anchor,
                        position.anchors.length === 1 ? position.anchors[0] : null,
                    )
                :   tuple;
        };
        const convert = (value, path) => {
            if (value == null || value === "") return value;
            const shape = position.shape;
            if (shape === "keys") {
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
            if (shape === "list") {
                if (!Array.isArray(value)) fail(value, path, "must be a list of Addresses");
                return value.map((v, i) => read(v, [...path, i]));
            }
            if (shape === "scalar-or-map" && typeof value === "object" && !isAddressTuple(value)) {
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
        // A lenient position keeps a value it cannot read, as written.
        const settle = (value, path) => {
            if (!position.lenient) return convert(value, path);
            try {
                return convert(value, path);
            } catch {
                return value;
            }
        };
        // Copy each traversed owner so YAML aliases retain their own read context.
        const visit = (owner, path, offset = 0, actual = []) => {
            if (owner == null || owner === "") return owner;
            const key = path[offset];
            if (key === "*") {
                if (!Array.isArray(owner)) {
                    if (position.lenient) return owner;
                    fail(owner, actual, "must be a list of entries");
                }
                return owner.map((value, i) => visit(value, path, offset + 1, [...actual, i]));
            }
            if (typeof owner !== "object") return owner;
            if (!Object.hasOwn(owner, key)) return owner;
            const copy = Array.isArray(owner) ? [...owner] : { ...owner };
            copy[key] =
                offset === path.length - 1 ?
                    settle(owner[key], [...actual, key])
                :   visit(owner[key], path, offset + 1, [...actual, key]);
            return copy;
        };
        const decoded = visit(fm, position.path);
        Object.assign(fm, decoded);
    }
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
        types: new Set(Object.keys(NOTE_VOCABULARY)),
        systemBlocks,
    };
}

/**
 * Decode Address properties contributed by an index record.
 *
 * A record read from a published index writes every Address as
 * `{ address, anchor, anchorKind }`; each becomes a tuple, or an
 * {@link AddressLink} where it carries an anchor, before the declared
 * positions are read.
 *
 * With a `source`, the record is a dependency's, read from its cached index.
 * Every decode failure then leaves as a located finding that names the
 * dependency, the cached file, the record, the field and the remedy, because
 * the shape of a published index is the dependency's to correct and no note in
 * the reading tree is at fault.
 *
 * @param {object} record - The record.
 * @param {object} context - Builder defaults.
 * @param {{package: string, file: string, line?: number}} [source] - The
 *   dependency and the cached index file the record was read from, with the
 *   record's 1-based line when known.
 * @returns {object} The typed record.
 * @throws {Error} A located finding (`located: true`) when `source` is given
 *   and the record cannot be decoded; otherwise the decode error itself.
 */
export function decodeIndexAddresses(record, context, source) {
    if (!source) return decodeIndexRecord(record, context);
    try {
        return decodeIndexRecord(record, context);
    } catch (error) {
        const field = error.keyPath?.join(".") ?? error.indexField;
        const named = [record?.type, record?.shortcode].filter(Boolean).join(" ");
        const detail = error.message.replace(/^Index /, "");
        const error_ = new Error(
            formatDiagnostic({
                file: source.file,
                ...(Number.isInteger(source.line) ? { line: source.line } : {}),
                severity: "error",
                message:
                    `${source.package} published an index this package-build does not read` +
                    (named ? ` (record ${named}` : " (record") +
                    (field ? `, field ${field}` : "") +
                    `): ${detail}. Take a release of ${source.package} built with this ` +
                    `package-build, then run \`package-build deps fetch\` again.`,
            }),
            { cause: error },
        );
        error_.located = true;
        throw error_;
    }
}

/**
 * Decode one index record's Address properties.
 *
 * @param {object} record - The record.
 * @param {object} context - Builder defaults.
 * @returns {object} The typed record.
 */
function decodeIndexRecord(record, context) {
    Object.assign(record, readPublishedAddresses(record));
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
        if (anchor.link != null && !(anchor.link instanceof AddressLink)) {
            const error = new Error(
                `Index anchor link is not an Address: ${JSON.stringify(anchor.link)}`,
            );
            error.indexField = "anchors[].link";
            throw error;
        }
    }
    return record;
}
