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

/**
 * **The inner keys of a `data:` field**, and the one check that holds every
 * field's value to them.
 *
 * `data:` is closed at its own level by the frontmatter lint. A field whose value
 * holds maps is closed the same way one level down and at every level below: its
 * declaration states what the value holds, and a key the declaration does not
 * name is a finding at that key's own `file:line:column`.
 *
 * A declaration states its contents with the same descriptor vocabulary a
 * field uses — `name`, `kind`, `shape`, `describe` — plus three properties
 * saying where the maps are:
 *
 * - **`fields`** — the value is a map with these keys and no others. Each is an
 *   {@link InnerKeySpec}, which may itself carry `fields`, `entries` or
 *   `values`.
 * - **`entries`** — the value is a list, and this describes one entry. A list
 *   of Addresses states `entryKind` instead.
 * - **`values`** — the value is a map whose keys are data (an Address, a
 *   Shortcode, a pack, a name), and this describes the value under each key.
 *   The keys themselves are checked as the field's `keyKind` says.
 *
 * Dotted field names (`appearance.eye_color`) declare a container's keys by
 * their segments, and the container is closed to them just the same.
 *
 * **What the check owns is shape**: an undeclared key, a required key that is
 * absent, and a present value of the wrong kind. What a value *means* — whether
 * an Address resolves, a bearing is one of eight, a ladder repeats a level —
 * stays with the field's own `check`, which skips a value of the wrong shape
 * because this check has already reported it.
 *
 * @module
 */

import { isAddressTuple } from "./address.mjs";
import { AddressEntries, AddressLink } from "./address-values.mjs";
import { positionOfFrontmatterPath } from "./diagnostics.mjs";
import { nearest } from "./near-miss.mjs";

/**
 * One key inside a field's value.
 *
 * @typedef {object} InnerKeySpec
 * @property {string} name - The key as an author writes it.
 * @property {string} [kind] - Its value's shape: `string`, `date`, `number`,
 *   `integer`, `boolean`, `address`, `list`, `map`, `scalar-or-map`,
 *   `list-or-map` or `string-or-list` — see {@link fitsKind}. Absent, the check
 *   makes no claim about the value.
 * @property {readonly string[]} [allowed] - The closed set a present value is
 *   one of, where the key takes a fixed word.
 * @property {boolean} [positive] - A present number is greater than zero.
 * @property {boolean} [verbatim] - The value is a symbol, such as a unit, and
 *   every surface shows it exactly as written, never recased.
 * @property {string} shape - The shape in words, for a finding and the reference.
 * @property {boolean} [required] - The key must be stated, with a value.
 * @property {boolean} [nullable] - An explicit `null` states the key, for a
 *   required key whose null has a meaning of its own.
 * @property {string} [label] - The infobox row label, where humanising the key
 *   reads wrongly.
 * @property {string} describe - One line, for the author-facing reference.
 * @property {readonly InnerKeySpec[]} [fields] - Its own keys, where it is a map.
 * @property {object} [entries] - One entry, where it is a list of maps.
 * @property {object} [values] - One value, where it is a map keyed by data.
 */

/** Whether a value is a plain map rather than a list, an Address or a scalar. */
export function isPlainMap(value) {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !isAddressTuple(value) &&
        !(value instanceof AddressLink) &&
        !(value instanceof AddressEntries)
    );
}

/** Whether a value is one value rather than a container of them. */
function isScalar(value) {
    return (
        typeof value !== "object" ||
        value === null ||
        isAddressTuple(value) ||
        value instanceof AddressLink
    );
}

/**
 * Whether a present value has a declared kind's shape.
 *
 * Shape alone: whether an Address resolves, or a word is in a closed set, is the
 * field's own check's question. Lenient where YAML is ambiguous — `"12"` is a
 * number, an emptied map arrives as `[]`, and a `date` may be the bare number
 * YAML reads `720.1` as — and strict where it is not: a `string` is text, so a
 * title or a description written as `5` is a finding rather than a value
 * nothing reads as text. An `address` is one value or a parsed Address; what it
 * names is the reference check's.
 *
 * @param {unknown} value - The authored value, not `undefined` or `null`.
 * @param {string|undefined} kind - The declared kind.
 * @returns {boolean} Whether it fits.
 */
export function fitsKind(value, kind) {
    switch (kind) {
        case "string":
            return typeof value === "string";
        case "date":
            return (
                typeof value === "string" || (typeof value === "number" && Number.isFinite(value))
            );
        case "address":
        case "shortcode":
            return isScalar(value) && typeof value !== "boolean";
        case "number":
            return typeof value === "number" ?
                    Number.isFinite(value)
                :   typeof value === "string" &&
                        value.trim() !== "" &&
                        Number.isFinite(Number(value));
        case "integer":
            return fitsKind(value, "number") && Number.isInteger(Number(value));
        case "boolean":
            return typeof value === "boolean";
        case "list":
            return Array.isArray(value);
        case "map":
            return (
                isPlainMap(value) ||
                value instanceof AddressEntries ||
                (Array.isArray(value) && value.length === 0)
            );
        case "scalar-or-map":
            return isScalar(value) || fitsKind(value, "map");
        case "list-or-map":
            return Array.isArray(value) || fitsKind(value, "map");
        case "string-or-list":
            return isScalar(value) || Array.isArray(value);
        default:
            return true;
    }
}

/**
 * The entries of a map value, whatever form it reached the lint in.
 *
 * A map keyed by Address arrives as an {@link AddressEntries} once the note
 * boundary has typed its keys; `sourceKey` is the text the file holds, so a
 * finding locates on what the author wrote.
 *
 * @param {unknown} value - A map value.
 * @returns {Array<[string, unknown]>} Its authored keys and values.
 */
export function mapEntriesOf(value) {
    if (value instanceof AddressEntries)
        return value.entries.map((entry) => [entry.sourceKey, entry.value]);
    if (isPlainMap(value)) return Object.entries(value);
    return [];
}

/**
 * A field declaration as the tree its dotted names describe.
 *
 * `appearance.eye_color` and `appearance.hair_color` are two keys of one
 * container, `appearance`, which is itself a map closed to them. Grouping them
 * here is what lets one walk close the container and every field inside it.
 *
 * @param {readonly object[]} fields - The type's `data:` declaration.
 * @returns {object[]} One spec per top-level key, a dotted group as a `map`
 *   whose `fields` are its members, with `grouped: true`.
 */
export function topLevelSpecs(fields) {
    const out = [];
    const groups = new Map();
    for (const field of fields) {
        const [head, ...rest] = field.name.split(".");
        if (!rest.length) {
            out.push(field);
            continue;
        }
        let group = groups.get(head);
        if (!group) {
            group = { name: head, kind: "map", shape: "a map", grouped: true, members: [] };
            groups.set(head, group);
            out.push(group);
        }
        group.members.push({ ...field, name: rest.join(".") });
    }
    for (const group of groups.values()) {
        group.fields = topLevelSpecs(group.members);
        delete group.members;
    }
    return out;
}

/**
 * A path as a reader writes it: `data.routes[0].terrain`.
 *
 * @param {ReadonlyArray<string|number>} path - The path from the top of the frontmatter.
 * @returns {string} The label.
 */
export function pathLabel(path) {
    let out = "";
    for (const segment of path) {
        if (typeof segment === "number") out += `[${segment}]`;
        else out += out ? `.${segment}` : segment;
    }
    return out;
}

/** Whether a required key's value counts as stated. */
function stated(value, spec) {
    if (value === undefined) return false;
    if (value === null) return Boolean(spec.nullable);
    if (typeof value === "string") return value.trim() !== "";
    return true;
}

/**
 * Check every declared field's value against its stated inner keys.
 *
 * Run by the frontmatter lint after the container check has refused undeclared
 * top-level keys and checked each top-level field's own kind, so neither is
 * repeated here.
 *
 * @param {object} note - The note: `file`, `raw` and parsed `fm`.
 * @param {readonly object[]} fields - The type's `data:` declaration, shared
 *   fields included.
 * @returns {object[]} Findings, `file:line:column` located on the key at fault.
 */
export function checkDataKeys(note, fields) {
    const data = note.fm?.data;
    if (!isPlainMap(data)) return [];
    const findings = [];
    const raw = note.raw ?? "";
    const finding = (path, message, key = false) => ({
        file: note.file,
        ...positionOfFrontmatterPath(raw, path, { key }),
        severity: "error",
        message,
    });

    /**
     * Walk one value against its declaration.
     *
     * @param {object} spec - The declaration.
     * @param {unknown} value - The value, present and non-null.
     * @param {Array<string|number>} path - Where it sits.
     */
    const walk = (spec, value, path) => {
        if (spec.fields && isPlainMap(value)) {
            closeMap(spec.fields, value, path);
            return;
        }
        if (Array.isArray(value)) {
            const entry = spec.entries;
            if (!entry) return;
            value.forEach((item, i) => visit(entry, item, [...path, i]));
            return;
        }
        if (spec.values) {
            for (const [key, item] of mapEntriesOf(value)) visit(spec.values, item, [...path, key]);
        }
    };

    /** Check one present value's kind, then walk it. */
    const visit = (spec, value, path) => {
        if (value === undefined || value === null) return;
        if (!fitsKind(value, spec.kind)) {
            findings.push(
                finding(
                    path,
                    `\`${pathLabel(path)}\` should be ${spec.shape ?? spec.kind}, but reads ` +
                        JSON.stringify(value),
                ),
            );
            return;
        }
        if (spec.allowed && !spec.allowed.includes(value)) {
            const guess = typeof value === "string" ? nearest(value, spec.allowed) : undefined;
            findings.push(
                finding(
                    path,
                    `\`${pathLabel(path)}\` should be ${spec.allowed.map((word) => `\`${word}\``).join(" or ")}, ` +
                        `but reads ${JSON.stringify(value)}` +
                        (guess ? `. Did you mean "${guess}"?` : ""),
                ),
            );
            return;
        }
        if (spec.positive && !(Number(value) > 0)) {
            findings.push(
                finding(
                    path,
                    `\`${pathLabel(path)}\` should be ${spec.shape ?? "a positive number"}, but reads ` +
                        JSON.stringify(value),
                ),
            );
            return;
        }
        walk(spec, value, path);
    };

    /** Close one map to its declared keys, and walk each that is present. */
    const closeMap = (inner, value, path) => {
        const names = inner.map((spec) => spec.name);
        for (const key of Object.keys(value)) {
            if (names.includes(key)) continue;
            const guess = nearest(key, names);
            findings.push(
                finding(
                    [...path, key],
                    `"${key}" is not a key of \`${pathLabel(path)}\`; it takes only ` +
                        names.map((name) => `\`${name}\``).join(", ") +
                        (guess ? `. Did you mean "${guess}"?` : ""),
                    true,
                ),
            );
        }
        for (const spec of inner) {
            const item = value[spec.name];
            if (spec.required && !stated(item, spec)) {
                findings.push(
                    finding(
                        path,
                        `\`${pathLabel(path)}\` must state \`${spec.name}\` — ${spec.shape}`,
                        typeof path.at(-1) !== "number",
                    ),
                );
                continue;
            }
            visit(spec, item, [...path, spec.name]);
        }
    };

    for (const spec of topLevelSpecs(fields)) {
        const value = data[spec.name];
        if (value === undefined || value === null) continue;
        const path = ["data", spec.name];
        // A dotted group's own shape is checked here: the container check
        // reads its members' leaves and has nothing to say about the group.
        if (spec.grouped) visit(spec, value, path);
        else if (fitsKind(value, spec.kind)) walk(spec, value, path);
    }
    return findings;
}
