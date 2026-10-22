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
 * The rows of the SQL relations a language note's register, sounds, history
 * and names are read through, from index records whose Addresses are already
 * strings.
 *
 * Every relation is keyed by `language`, the note that states the entry, and
 * a list's entries by `position`, their order in it. **Every row has every
 * column**, so a fence naming a key no entry writes still binds. A key that
 * would share a name with `language` or `position` takes a prefix:
 * a tongue's `language` is `tongue_language`, an element's `position` is
 * `element_position`, and a cognate form's language is `form_language`.
 *
 * - `register` — one row per `data.register` entry, with `built_text` and
 *   `notes`, every note in the language's `data.scope` carrying the name — of
 *   the whole package, for a language stating no scope: as its full name,
 *   an alias or a part of its name, as a rank or an office title, or as the
 *   name of an anchor, which is cited with its anchor. A folder note carries
 *   no name;
 * - `retired`, `tongues`, `letters`, `edges`, `read_past`, `sound_changes`,
 *   `elements` and `roots` — one row per entry, the list keys always lists;
 * - `scope` — one row per value, with the `kind` of `data.scope` it is under;
 * - `clusters` — one row per language stating `data.sounds.clusters`;
 * - `cluster_groups` and `mutations` — one row per entry of
 *   `data.sounds.clusters.groups` and `data.sounds.mutations`;
 * - `older` — one row per `data.older` entry;
 * - `negation` — one row per language stating `data.negation`;
 * - `name_shapes`, `name_edges`, `name_draws` and `held_from` — one row per
 *   entry of the lists of `data.naming`, and `near_names` one per worked
 *   near name, with the language's `min_syllables`;
 * - `cognates` — one row per form of each set, with the set's `gloss`.
 *
 * @module
 */

import { isLanguageRecord, noteAddressOf } from "./word-rows.mjs";
import {
    ANY_NAME,
    CALLING_CLOSING_KEYS,
    CLUSTER_GROUP_KEYS,
    EDGE_KEYS,
    ELEMENT_KEYS,
    FINAL_KEYS,
    JOINING_KEYS,
    JOIN_KEYS,
    LETTER_KEYS,
    MARK_KEYS,
    MUTATION_KEYS,
    OLDER_KEYS,
    READ_PAST_KEYS,
    REGISTER_KEYS,
    RETIRED_KEYS,
    ROOT_KEYS,
    SCOPE_KINDS,
    SKELETON_KEYS,
    SOUND_CHANGE_STEP_KEYS,
    TONGUE_KEYS,
} from "./language-terms.mjs";

/** The columns every list relation opens with. */
const IDENTITY = Object.freeze(["language", "position"]);

/** A key's column, prefixed where it would share an identity column's name. */
const column = (prefix, key) => (IDENTITY.includes(key) ? `${prefix}_${key}` : key);

/** Every column of the `register` relation, in order. */
export const REGISTER_COLUMNS = Object.freeze([
    ...IDENTITY,
    ...REGISTER_KEYS,
    "built_text",
    "notes",
]);
/** Every column of the `retired` relation, in order. */
export const RETIRED_COLUMNS = Object.freeze([...IDENTITY, ...RETIRED_KEYS]);
/** Every column of the `tongues` relation, in order. */
export const TONGUE_COLUMNS = Object.freeze([
    ...IDENTITY,
    ...TONGUE_KEYS.map((key) => column("tongue", key)),
]);
/** Every column of the `scope` relation, in order. */
export const SCOPE_COLUMNS = Object.freeze(["language", "kind", "value"]);
/** Every column of the `letters` relation, in order. */
export const LETTER_COLUMNS = Object.freeze([...IDENTITY, ...LETTER_KEYS]);
/** Every column of the `edges` relation, in order. */
export const EDGE_COLUMNS = Object.freeze([...IDENTITY, ...EDGE_KEYS]);
/** Every column of the `clusters` relation, in order. */
export const CLUSTER_COLUMNS = Object.freeze(["language", "max"]);
/** Every column of the `cluster_groups` relation, in order. */
export const CLUSTER_GROUP_COLUMNS = Object.freeze([...IDENTITY, ...CLUSTER_GROUP_KEYS]);
/** Every column of the `mutations` relation, in order. */
export const MUTATION_COLUMNS = Object.freeze([...IDENTITY, ...MUTATION_KEYS]);
/** Every column of the `older` relation, in order. */
export const OLDER_COLUMNS = Object.freeze([...IDENTITY, ...OLDER_KEYS]);
/** Every column of the `name_shapes` relation, in order. */
export const NAME_SHAPE_COLUMNS = Object.freeze([
    ...IDENTITY,
    "of",
    "syllables_min",
    "syllables_max",
    "per_vowel_min",
    "per_vowel_max",
]);
/** Every column of the `name_edges` relation, in order. */
export const NAME_EDGE_COLUMNS = Object.freeze([...IDENTITY, "edge", "sounds", "vowel", "of"]);
/** Every column of the `name_draws` relation, in order. */
export const NAME_DRAW_COLUMNS = Object.freeze([...IDENTITY, "kind", "elements"]);
/** Every column of the `held_from` relation, in order. */
export const HELD_FROM_COLUMNS = Object.freeze([
    ...IDENTITY,
    "source",
    "takes",
    "clip",
    "joining",
    "elements",
]);
/** Every column of the `near_names` relation, in order. */
export const NEAR_NAME_COLUMNS = Object.freeze([...IDENTITY, "near", "given", "min_syllables"]);
/** Every column of the `negation` relation, in order: one row per language. */
export const NEGATION_COLUMNS = Object.freeze(["language", "particle", "mutation"]);
/** Every column of the `stress` relation, in order. */
export const STRESS_COLUMNS = Object.freeze(["language", "two", "longer", "mark"]);
/** Every column of the `finals` relation, in order. */
export const FINAL_COLUMNS = Object.freeze([...IDENTITY, ...FINAL_KEYS]);
/** Every column of the `syllables` relation, in order: one row per language. */
export const SYLLABLE_COLUMNS = Object.freeze([
    "language",
    "onsets",
    "codas",
    "finals",
    "doubled",
    "vowelPairs",
    "initialVowel",
    "finalVowel",
    "neverInitial",
    "signature",
    "harmony_back",
    "harmony_front",
    "harmony_neutral",
    "harmony_neutralAs",
    "harmony_partners",
]);
/** Every column of the `joining` relation, in order. */
export const JOINING_COLUMNS = Object.freeze([...IDENTITY, ...JOINING_KEYS]);
/** Every column of the `joins` relation, in order. */
export const JOIN_COLUMNS = Object.freeze([...IDENTITY, ...JOIN_KEYS]);
/** Every column of the `marks` relation, in order. */
export const MARK_COLUMNS = Object.freeze([...IDENTITY, ...MARK_KEYS]);
/** Every column of the `skeleton` relation, in order. */
export const SKELETON_COLUMNS = Object.freeze([...IDENTITY, ...SKELETON_KEYS]);
/** Every column of the `frames` relation, in order. */
export const FRAME_COLUMNS = Object.freeze([
    ...IDENTITY,
    "frame",
    "shape",
    "class",
    "makes",
    "examples",
]);
/** Every column of the `read_past` relation, in order. */
export const READ_PAST_COLUMNS = Object.freeze([...IDENTITY, ...READ_PAST_KEYS]);
/** Every column of the `sound_changes` relation, in order: one row per step. */
export const SOUND_CHANGE_COLUMNS = Object.freeze([
    ...IDENTITY,
    "name",
    "from_language",
    "to_language",
    "takes",
    "step_position",
    ...SOUND_CHANGE_STEP_KEYS,
]);
/** Every column of the `elements` relation, in order. */
export const ELEMENT_COLUMNS = Object.freeze([
    ...IDENTITY,
    ...ELEMENT_KEYS.map((key) => column("element", key)),
]);
/** Every column of the `roots` relation, in order. */
export const ROOT_COLUMNS = Object.freeze([...IDENTITY, ...ROOT_KEYS]);
/** Every column of the `cognates` relation, in order. */
export const COGNATE_COLUMNS = Object.freeze([
    ...IDENTITY,
    "gloss",
    "proto",
    "form_language",
    "form",
]);
/** Every column of the `calling_names` relation, in order. */
export const CALLING_NAME_COLUMNS = Object.freeze([
    ...IDENTITY,
    ...CALLING_CLOSING_KEYS,
    "min_syllables",
]);

/** A list of strings, as a column type. */
const LIST = "VARCHAR[]";

/**
 * The type of each column that holds no text, by relation, so a relation
 * with no row still has the type a fence's list or number function binds to.
 *
 * @type {Readonly<Record<string, Readonly<Record<string, string>>>>}
 */
export const LANGUAGE_COLUMN_TYPES = Object.freeze({
    register: { position: "BIGINT", built: LIST, notes: LIST },
    retired: { position: "BIGINT", instead: LIST },
    tongues: { position: "BIGINT" },
    scope: {},
    letters: { position: "BIGINT", letters: LIST, tongue: LIST },
    edges: { position: "BIGINT", sounds: LIST },
    clusters: { max: "BIGINT" },
    cluster_groups: { position: "BIGINT", clusters: LIST },
    mutations: { position: "BIGINT" },
    older: { position: "BIGINT" },
    negation: {},
    name_shapes: {
        position: "BIGINT",
        syllables_min: "BIGINT",
        syllables_max: "BIGINT",
        per_vowel_min: "DOUBLE",
        per_vowel_max: "DOUBLE",
    },
    name_edges: { position: "BIGINT", sounds: LIST, vowel: "BOOLEAN" },
    name_draws: { position: "BIGINT", elements: LIST },
    held_from: { position: "BIGINT", joining: LIST, elements: LIST },
    near_names: { position: "BIGINT", min_syllables: "BIGINT" },
    stress: {},
    finals: { position: "BIGINT" },
    syllables: {
        codas: LIST,
        finals: LIST,
        doubled: LIST,
        vowelPairs: LIST,
        initialVowel: "BOOLEAN",
        finalVowel: "BOOLEAN",
        neverInitial: LIST,
        signature: LIST,
        harmony_back: LIST,
        harmony_front: LIST,
        harmony_neutral: LIST,
        harmony_partners: "STRUCT(vowel VARCHAR, partner VARCHAR)[]",
    },
    joining: { position: "BIGINT", first: LIST, second: LIST },
    joins: { position: "BIGINT", letters: LIST },
    marks: { position: "BIGINT", letters: LIST },
    skeleton: { position: "BIGINT", second: LIST },
    frames: {
        position: "BIGINT",
        class: LIST,
        examples: "STRUCT(root VARCHAR, form VARCHAR)[]",
    },
    read_past: { position: "BIGINT" },
    sound_changes: { position: "BIGINT", step_position: "BIGINT" },
    elements: { position: "BIGINT", variants: LIST, examples: LIST },
    roots: { position: "BIGINT" },
    cognates: { position: "BIGINT" },
    calling_names: { position: "BIGINT", doubled: "BOOLEAN", min_syllables: "BIGINT" },
});

/** Whether a value is a plain map. */
const isMap = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Code-point order, so a list is the same on every machine. */
const compare = (a, b) =>
    a < b ? -1
    : a > b ? 1
    : 0;

/** A value that may be one string or a list of them, as a list; `null` for none. */
const asList = (value) => {
    if (value === undefined || value === null) return null;
    return (Array.isArray(value) ? value : [value]).map(String);
};

/**
 * Each language record of a set, with its Address.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {Array<[string, Record<string, any>]>}
 */
function languagesOf(records) {
    const out = [];
    for (const record of records) {
        if (!isLanguageRecord(record) || record.documents) continue;
        const language = noteAddressOf(record);
        if (language) out.push([language, record]);
    }
    return out;
}

/**
 * The rows of one list a language note states: one per entry, every key a
 * column.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @param {(data: object) => unknown} read - The list, from a record's `data`.
 * @param {readonly string[]} keys - The keys an entry carries.
 * @param {object} [options]
 * @param {string} [options.prefix] - The prefix of a key sharing an identity
 *   column's name.
 * @param {readonly string[]} [options.lists] - The keys always set as lists.
 * @param {(records: Iterable<Record<string, any>>) => Array<[string, Record<string, any>]>} [options.sources] -
 *   The records stating the list, with their Addresses; the language records
 *   where unstated.
 * @returns {object[]} One row per entry, in record then entry order.
 */
function listRows(records, read, keys, { prefix = "", lists = [], sources = languagesOf } = {}) {
    const rows = [];
    for (const [language, record] of sources(records)) {
        const entries = read(isMap(record.data) ? record.data : {});
        if (!Array.isArray(entries)) continue;
        entries.forEach((entry, position) => {
            if (!isMap(entry)) return;
            const row = { language, position };
            for (const key of keys)
                row[column(prefix, key)] =
                    lists.includes(key) ? asList(entry[key]) : (entry[key] ?? null);
            rows.push(row);
        });
    }
    return rows;
}

/**
 * Each record stating letters and marks, with its Address: every language
 * record, and every `doc` record whose `data.sounds` is a spelling guide's.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {Array<[string, Record<string, any>]>}
 */
function soundSourcesOf(records) {
    const list = [...records];
    const out = languagesOf(list);
    for (const record of list) {
        if (record?.type !== "doc" || record.documents || !isMap(record.data?.sounds)) continue;
        const address = noteAddressOf(record);
        if (address) out.push([address, record]);
    }
    return out;
}

/** A language's `data.sounds`, or an empty map. */
const soundsOf = (data) => (isMap(data.sounds) ? data.sounds : {});

/**
 * Every name a note of the package carries, with the Addresses carrying it:
 * each string of a note's `name`, its aliases, an affiliation's rank and
 * office titles, and the name of each anchor, cited with the anchor.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {Map<string, Set<string>>} By name as written, NFC.
 */
function carriedNames(records) {
    const names = new Map();
    const carry = (name, address) => {
        if (typeof name !== "string" || !name.trim()) return;
        const key = name.normalize("NFC");
        if (!names.has(key)) names.set(key, new Set());
        names.get(key).add(address);
    };
    for (const record of records) {
        const address = noteAddressOf(record);
        if (!address || record.documents || record.type === "folder") continue;
        if (isMap(record.name))
            for (const [key, value] of Object.entries(record.name)) {
                if (key === "aliases" && Array.isArray(value))
                    for (const alias of value) carry(alias, address);
                else carry(value, address);
            }
        const governance = isMap(record.data?.governance) ? record.data.governance : {};
        for (const rank of Array.isArray(governance.ranks) ? governance.ranks : [])
            if (isMap(rank)) carry(rank.title, address);
        if (isMap(governance.offices))
            for (const title of Object.keys(governance.offices)) carry(title, address);
        for (const anchor of Array.isArray(record.anchors) ? record.anchors : [])
            if (isMap(anchor) && typeof anchor.slug === "string")
                carry(anchor.name, `${address}#${anchor.slug}`);
    }
    return names;
}

/** A list of strings from a record value, or an empty one. */
const strings = (value) =>
    (Array.isArray(value) ? value : [value]).filter((one) => typeof one === "string" && one);

/**
 * Whether a note falls in a language's `data.scope`: one of its kinds catches
 * the note, `types` (where stated) admits its type, and `skip` does not name
 * it. A language that states no scope covers every note.
 *
 * @param {Record<string, any>} record - A note's index record.
 * @param {string} address - The note's Address.
 * @param {object|undefined} scope - The language's `data.scope`.
 * @returns {boolean}
 */
export function inScope(record, address, scope) {
    if (!isMap(scope)) return true;
    const values = (kind) => new Set(strings(scope[kind]));
    if (values("skip").has(address)) return false;
    const types = values("types");
    if (types.size && !types.has(record.type)) return false;
    const data = isMap(record.data) ? record.data : {};
    const any = (kind, list) => {
        const wanted = values(kind);
        return strings(list).some((one) => wanted.has(one));
    };
    const file = typeof record.file?.path === "string" ? record.file.path : "";
    return (
        values("addresses").has(address) ||
        any("folders", data.packFolder) ||
        any("cultures", data.culture) ||
        any("lore", data.lore) ||
        any("parents", data.parents) ||
        strings(scope.paths).some((prefix) => file.startsWith(prefix))
    );
}

/**
 * The `register` rows of a set of index records.
 *
 * @param {Iterable<Record<string, any>>} records - Index records, every
 *   Address a string, already narrowed to the audience being published to.
 * @param {Iterable<Record<string, any>>} [all] - Every record of the package;
 *   a note carrying a name is cited only where the audience sees it.
 * @returns {object[]} One row per register entry, in record then entry order.
 */
export function registerRows(records, all = records) {
    const visible = new Set();
    for (const record of records) {
        const key = noteAddressOf(record);
        if (key) visible.add(key);
    }
    const every = [...all];
    // The language note's own record, never the journal sharing its Address.
    const languages = new Map(languagesOf(every));
    const byLanguage = new Map();
    const namesOf = (language) => {
        if (!byLanguage.has(language)) {
            const scope = languages.get(language)?.data?.scope;
            byLanguage.set(
                language,
                carriedNames(
                    every.filter((one) => {
                        const address = noteAddressOf(one);
                        return address !== null && inScope(one, address, scope);
                    }),
                ),
            );
        }
        return byLanguage.get(language);
    };
    return listRows(records, (data) => data.register, REGISTER_KEYS, { lists: ["built"] }).map(
        (row) => {
            const built = row.built ?? [];
            const names = namesOf(row.language);
            const notes = [...(names.get(String(row.name ?? "").normalize("NFC")) ?? [])]
                .filter((address) => visible.has(address.split("#")[0]))
                .sort(compare);
            return {
                ...row,
                built_text: built.length ? built.join(" + ") : null,
                notes: notes.length ? notes : null,
            };
        },
    );
}

/**
 * The `retired` rows: one per `data.retired` entry, `instead` a list.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function retiredRows(records) {
    return listRows(records, (data) => data.retired, RETIRED_KEYS, { lists: ["instead"] });
}

/**
 * The `tongues` rows: one per `data.tongues` entry.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function tongueRows(records) {
    return listRows(records, (data) => data.tongues, TONGUE_KEYS, { prefix: "tongue" });
}

/**
 * The `scope` rows: one per value of each kind of `data.scope`, in the order
 * the kinds are declared.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function scopeRows(records) {
    const rows = [];
    for (const [language, record] of languagesOf(records)) {
        const scope = isMap(record.data?.scope) ? record.data.scope : {};
        for (const kind of SCOPE_KINDS)
            for (const value of Array.isArray(scope[kind]) ? scope[kind] : [])
                if (value !== null && value !== undefined)
                    rows.push({ language, kind, value: String(value) });
    }
    return rows;
}

/**
 * The `letters` rows: one per `data.sounds.letters` entry of a language note
 * or a spelling guide, `letters` and `tongue` lists.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function letterRows(records) {
    return listRows(records, (data) => soundsOf(data).letters, LETTER_KEYS, {
        lists: ["letters", "tongue"],
        sources: soundSourcesOf,
    });
}

/**
 * The `edges` rows: one per `data.sounds.edges` entry, `sounds` a list.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function edgeRows(records) {
    return listRows(records, (data) => soundsOf(data).edges, EDGE_KEYS, { lists: ["sounds"] });
}

/**
 * The `clusters` rows: one per language stating `data.sounds.clusters`.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function clusterRows(records) {
    const rows = [];
    for (const [language, record] of languagesOf(records)) {
        const clusters = soundsOf(isMap(record.data) ? record.data : {}).clusters;
        if (isMap(clusters)) rows.push({ language, max: clusters.max ?? null });
    }
    return rows;
}

/**
 * The `cluster_groups` rows: one per `data.sounds.clusters.groups` entry,
 * `clusters` a list.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function clusterGroupRows(records) {
    return listRows(records, (data) => soundsOf(data).clusters?.groups, CLUSTER_GROUP_KEYS, {
        lists: ["clusters"],
    });
}

/**
 * The `mutations` rows: one per `data.sounds.mutations` entry.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function mutationRows(records) {
    return listRows(records, (data) => soundsOf(data).mutations, MUTATION_KEYS);
}

/**
 * The `older` rows: one per `data.older` entry.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function olderRows(records) {
    return listRows(records, (data) => data.older, OLDER_KEYS);
}

/**
 * The `negation` rows: one per language stating `data.negation`.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function negationRows(records) {
    const rows = [];
    for (const [language, record] of languagesOf(records)) {
        const negation = record.data?.negation;
        if (isMap(negation))
            rows.push({
                language,
                particle: negation.particle ?? null,
                mutation: negation.mutation ?? null,
            });
    }
    return rows;
}

/** A language's `data.naming`, or an empty map. */
const namingOf = (data) => (isMap(data.naming) ? data.naming : {});

/** A range's bound, or `null`. */
const bound = (range, key) => (isMap(range) && typeof range[key] === "number" ? range[key] : null);

/**
 * The `name_shapes` rows: one per `data.naming.shapes` entry, each range as
 * its two bounds.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function nameShapeRows(records) {
    const rows = [];
    for (const [language, record] of languagesOf(records)) {
        const shapes = namingOf(isMap(record.data) ? record.data : {}).shapes;
        if (!Array.isArray(shapes)) continue;
        shapes.forEach((shape, position) => {
            if (!isMap(shape)) return;
            rows.push({
                language,
                position,
                of: shape.of ?? null,
                syllables_min: bound(shape.syllables, "min"),
                syllables_max: bound(shape.syllables, "max"),
                per_vowel_min: bound(shape.perVowel, "min"),
                per_vowel_max: bound(shape.perVowel, "max"),
            });
        });
    }
    return rows;
}

/**
 * The `name_edges` rows: one per `data.naming.edges` entry, `sounds` a list,
 * `vowel` `false` and `of` `name` where unstated.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function nameEdgeRows(records) {
    return listRows(records, (data) => namingOf(data).edges, ["edge", "sounds", "vowel", "of"], {
        lists: ["sounds"],
    }).map((row) => ({ ...row, vowel: row.vowel === true, of: row.of ?? ANY_NAME }));
}

/**
 * The `name_draws` rows: one per `data.naming.draws` entry.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function nameDrawRows(records) {
    return listRows(records, (data) => namingOf(data).draws, ["kind", "elements"], {
        lists: ["elements"],
    });
}

/**
 * The `held_from` rows: one per `data.naming.heldFrom` entry.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function heldFromRows(records) {
    return listRows(
        records,
        (data) => namingOf(data).heldFrom,
        ["source", "takes", "clip", "joining", "elements"],
        { lists: ["joining", "elements"] },
    );
}

/**
 * The `near_names` rows: one per worked example of `data.naming.nearName`,
 * each with the language's `min_syllables`.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function nearNameRows(records) {
    const rows = [];
    for (const [language, record] of languagesOf(records)) {
        const near = namingOf(isMap(record.data) ? record.data : {}).nearName;
        if (!isMap(near) || !Array.isArray(near.examples)) continue;
        near.examples.forEach((example, position) => {
            if (!isMap(example)) return;
            rows.push({
                language,
                position,
                near: example.near ?? null,
                given: example.given ?? null,
                min_syllables: near.minSyllables ?? null,
            });
        });
    }
    return rows;
}

/**
 * The `read_past` rows: one per `data.sounds.readPast` entry.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function readPastRows(records) {
    return listRows(records, (data) => soundsOf(data).readPast, READ_PAST_KEYS);
}

/**
 * The `sound_changes` rows: one per step of each `data.soundChanges` set, with
 * the set's `position`, `name`, `from_language`, `to_language` and `takes`,
 * and the step's `step_position` within it.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function soundChangeRows(records) {
    const rows = [];
    for (const [language, record] of languagesOf(records)) {
        const sets = record.data?.soundChanges;
        if (!Array.isArray(sets)) continue;
        sets.forEach((set, position) => {
            if (!isMap(set) || !Array.isArray(set.steps)) return;
            set.steps.forEach((step, stepPosition) => {
                if (!isMap(step)) return;
                const row = {
                    language,
                    position,
                    name: set.name ?? null,
                    from_language: set.from ?? null,
                    to_language: set.to ?? null,
                    takes: set.takes ?? null,
                    step_position: stepPosition,
                };
                for (const key of SOUND_CHANGE_STEP_KEYS) row[key] = step[key] ?? null;
                rows.push(row);
            });
        });
    }
    return rows;
}

/**
 * The `elements` rows: one per `data.elements` entry, `examples` a list.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function elementRows(records) {
    return listRows(records, (data) => data.elements, ELEMENT_KEYS, {
        prefix: "element",
        lists: ["variants", "examples"],
    });
}

/**
 * The `roots` rows: one per `data.roots` entry.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function rootRows(records) {
    return listRows(records, (data) => data.roots, ROOT_KEYS);
}

/**
 * The `cognates` rows: one per form of each `data.cognates` set, in the order
 * the set writes them, with the set's `position`, `gloss` and `proto`.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function cognateRows(records) {
    const rows = [];
    for (const [language, record] of languagesOf(records)) {
        const sets = record.data?.cognates;
        if (!Array.isArray(sets)) continue;
        sets.forEach((set, position) => {
            if (!isMap(set) || !isMap(set.forms)) return;
            for (const [formLanguage, form] of Object.entries(set.forms))
                rows.push({
                    language,
                    position,
                    gloss: set.gloss ?? null,
                    proto: set.proto ?? null,
                    form_language: formLanguage,
                    form: form ?? null,
                });
        });
    }
    return rows;
}

/**
 * The `stress` rows: one per language stating `data.sounds.stress`.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function stressRows(records) {
    const rows = [];
    for (const [language, record] of languagesOf(records)) {
        const stress = soundsOf(isMap(record.data) ? record.data : {}).stress;
        if (isMap(stress))
            rows.push({
                language,
                two: stress.two ?? null,
                longer: stress.longer ?? null,
                mark: stress.mark ?? null,
            });
    }
    return rows;
}

/**
 * The `finals` rows: one per `data.sounds.finals` entry.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function finalRows(records) {
    return listRows(records, (data) => soundsOf(data).finals, FINAL_KEYS);
}

/**
 * The `syllables` rows: one per language stating `data.sounds.syllables`, a
 * list rule always a list (`any` a list of one), the harmony's sets each a
 * column of its own, its partners a list of `{ vowel, partner }` in the order
 * stated.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function syllableRows(records) {
    const rows = [];
    for (const [language, record] of languagesOf(records)) {
        const rules = soundsOf(isMap(record.data) ? record.data : {}).syllables;
        if (!isMap(rules)) continue;
        const harmony = isMap(rules.harmony) ? rules.harmony : {};
        rows.push({
            language,
            onsets: rules.onsets ?? null,
            codas: asList(rules.codas),
            finals: asList(rules.finals),
            doubled: asList(rules.doubled),
            vowelPairs: asList(rules.vowelPairs),
            initialVowel: typeof rules.initialVowel === "boolean" ? rules.initialVowel : null,
            finalVowel: typeof rules.finalVowel === "boolean" ? rules.finalVowel : true,
            neverInitial: asList(rules.neverInitial),
            signature: asList(rules.signature),
            harmony_back: asList(harmony.back),
            harmony_front: asList(harmony.front),
            harmony_neutral: asList(harmony.neutral),
            harmony_neutralAs: harmony.neutralAs ?? null,
            harmony_partners:
                isMap(harmony.partners) && Object.keys(harmony.partners).length ?
                    Object.entries(harmony.partners).map(([vowel, partner]) => ({
                        vowel,
                        partner: partner == null ? null : String(partner),
                    }))
                :   null,
        });
    }
    return rows;
}

/**
 * The `joining` rows: one per `data.sounds.joining` entry.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function joiningRows(records) {
    return listRows(records, (data) => soundsOf(data).joining, JOINING_KEYS, {
        lists: ["first", "second"],
    });
}

/**
 * The `joins` rows: one per `data.sounds.joins` entry.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function joinRows(records) {
    return listRows(records, (data) => soundsOf(data).joins, JOIN_KEYS, { lists: ["letters"] });
}

/**
 * The `marks` rows: one per `data.sounds.marks` entry of a language note or a
 * spelling guide.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function markRows(records) {
    return listRows(records, (data) => soundsOf(data).marks, MARK_KEYS, {
        lists: ["letters"],
        sources: soundSourcesOf,
    });
}

/**
 * The `skeleton` rows: one per `data.sounds.skeleton` entry, `second` a list.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function skeletonRows(records) {
    return listRows(records, (data) => soundsOf(data).skeleton, SKELETON_KEYS, {
        lists: ["second"],
    });
}

/**
 * The `frames` rows: one per `data.sounds.frames` entry, `examples` a list of
 * `{ root, form }` in the order the frame states them.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function frameRows(records) {
    const rows = [];
    for (const [language, record] of languagesOf(records)) {
        const frames = soundsOf(isMap(record.data) ? record.data : {}).frames;
        if (!Array.isArray(frames)) continue;
        frames.forEach((frame, position) => {
            if (!isMap(frame)) return;
            const examples =
                isMap(frame.examples) ?
                    Object.entries(frame.examples).map(([root, form]) => ({
                        root,
                        form: form == null ? null : String(form),
                    }))
                :   [];
            rows.push({
                language,
                position,
                frame: frame.frame ?? null,
                shape: frame.shape ?? null,
                class: asList(frame.class),
                makes: frame.makes ?? null,
                examples: examples.length ? examples : null,
            });
        });
    }
    return rows;
}

/**
 * The `calling_names` rows: one per `data.callingNames.closings` entry, each
 * with the language's `min_syllables`.
 *
 * @param {Iterable<Record<string, any>>} records - Index records.
 * @returns {object[]}
 */
export function callingNameRows(records) {
    const rows = [];
    for (const [language, record] of languagesOf(records)) {
        const calling = record.data?.callingNames;
        if (!isMap(calling) || !Array.isArray(calling.closings)) continue;
        calling.closings.forEach((closing, position) => {
            if (!isMap(closing)) return;
            rows.push({
                language,
                position,
                form: closing.form ?? null,
                doubled: closing.doubled === true,
                usual: closing.usual ?? null,
                min_syllables: calling.minSyllables ?? null,
            });
        });
    }
    return rows;
}

/**
 * Every relation of a language's register, sounds, history and names: its
 * name, its rows from the records the audience sees and every record of the
 * package, and its columns. {@link LANGUAGE_COLUMN_TYPES} types its columns.
 *
 * @type {ReadonlyArray<[string, (visible: object[], all: object[]) => object[], readonly string[]]>}
 */
export const LANGUAGE_RELATIONS = Object.freeze([
    ["register", registerRows, REGISTER_COLUMNS],
    ["retired", retiredRows, RETIRED_COLUMNS],
    ["tongues", tongueRows, TONGUE_COLUMNS],
    ["scope", scopeRows, SCOPE_COLUMNS],
    ["letters", letterRows, LETTER_COLUMNS],
    ["edges", edgeRows, EDGE_COLUMNS],
    ["clusters", clusterRows, CLUSTER_COLUMNS],
    ["cluster_groups", clusterGroupRows, CLUSTER_GROUP_COLUMNS],
    ["mutations", mutationRows, MUTATION_COLUMNS],
    ["stress", stressRows, STRESS_COLUMNS],
    ["finals", finalRows, FINAL_COLUMNS],
    ["syllables", syllableRows, SYLLABLE_COLUMNS],
    ["joining", joiningRows, JOINING_COLUMNS],
    ["joins", joinRows, JOIN_COLUMNS],
    ["marks", markRows, MARK_COLUMNS],
    ["skeleton", skeletonRows, SKELETON_COLUMNS],
    ["frames", frameRows, FRAME_COLUMNS],
    ["read_past", readPastRows, READ_PAST_COLUMNS],
    ["sound_changes", soundChangeRows, SOUND_CHANGE_COLUMNS],
    ["elements", elementRows, ELEMENT_COLUMNS],
    ["roots", rootRows, ROOT_COLUMNS],
    ["cognates", cognateRows, COGNATE_COLUMNS],
    ["calling_names", callingNameRows, CALLING_NAME_COLUMNS],
    ["older", olderRows, OLDER_COLUMNS],
    ["negation", negationRows, NEGATION_COLUMNS],
    ["name_shapes", nameShapeRows, NAME_SHAPE_COLUMNS],
    ["name_edges", nameEdgeRows, NAME_EDGE_COLUMNS],
    ["name_draws", nameDrawRows, NAME_DRAW_COLUMNS],
    ["held_from", heldFromRows, HELD_FROM_COLUMNS],
    ["near_names", nearNameRows, NEAR_NAME_COLUMNS],
]);
