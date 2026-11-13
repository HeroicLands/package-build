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
/** Item field declarations. @module */
/**
 * What sort of thing an item is, from one system-neutral list. It categorises
 * the item for the setting and has no mapping to a system's item types.
 *
 * @type {readonly string[]}
 */
export const ITEM_KINDS = Object.freeze([
    "weapon",
    "armor",
    "clothing",
    "container",
    "miscgear",
    "projectile",
    "concoction",
    "elixir",
    "potion",
    "simples",
    "disease",
    "poisontoxin",
    "maladiction",
    "physcond",
    "quirk",
    "disorder",
    "privation",
    "fear",
    "language",
    "script",
    "arcaneability",
    "spell",
    "psychicgift",
    "incantation",
    "divination",
]);

/**
 * The note types that are item notes: the things a setting defines for its
 * world, which a `data.items` entry may name as its `model`.
 *
 * @type {readonly string[]}
 */
export const ITEM_NOTE_TYPES = Object.freeze([
    "weapongear",
    "armorgear",
    "containergear",
    "miscgear",
    "projectilegear",
    "concoctiongear",
    "affliction",
    "trauma",
    "mysticalability",
]);

/** The keys of an entry's `system` block, shared with an item note's. */
const SYSTEM_FIELDS = Object.freeze([
    Object.freeze({
        name: "subType",
        kind: "string",
        shape: "string",
        describe: "The item's own genre within its kind, as a word.",
    }),
    Object.freeze({
        name: "quantity",
        kind: "number",
        shape: "number",
        describe: "How many of the item there are.",
    }),
    Object.freeze({
        name: "weight",
        kind: "number",
        shape: "number",
        describe: "What the item weighs.",
    }),
]);

/** The `system` map an entry or an item note's `data` carries. */
const SYSTEM_MAP = Object.freeze({
    kind: "map",
    shape: "a map of `subType`, `quantity` and `weight`",
    fields: SYSTEM_FIELDS,
});

/** The art Address an entry or an item note states as `img`. */
const IMG_FIELD = Object.freeze({
    name: "img",
    kind: "address",
    shape: "an Address",
    describe: "The item's image — an `icon` or `image` Address.",
});

/** The display name an entry or an item note states. */
const NAME_FIELD = Object.freeze({
    name: "name",
    kind: "string",
    shape: "string",
    describe: "The item's name.",
});

/** The `kind` an entry or an item note states. */
const KIND_FIELD = Object.freeze({
    name: "kind",
    kind: "string",
    shape: "one of the item kinds",
    allowed: ITEM_KINDS,
    describe: "What sort of thing the item is.",
});

/**
 * One `data.items` entry, as an inner-key declaration.
 *
 * @type {Readonly<{kind: "map", shape: string, fields: readonly object[]}>}
 */
export const ITEM_ENTRY = Object.freeze({
    kind: "map",
    shape: "an item entry — a map of the keys below",
    fields: Object.freeze([
        Object.freeze({
            name: "key",
            kind: "string",
            shape: "string",
            describe:
                "The entry's name among the items of its note, unique within `data.items`; " +
                "a system list's entry of the same `key` states what that system adds.",
        }),
        Object.freeze({
            name: "model",
            kind: "address",
            shape: "an Address",
            describe:
                "The item note this entry is an instance of — a note of this package or of a " +
                "required module, never of a game system. The entry's other fields override " +
                "what the note supplies.",
        }),
        NAME_FIELD,
        IMG_FIELD,
        KIND_FIELD,
        Object.freeze({
            name: "chance",
            kind: "number",
            shape: "a number from 0 to 100",
            describe:
                "On a culture or occupation, the percent chance that the item is drawn, each " +
                "item on its own.",
        }),
        Object.freeze({ name: "system", ...SYSTEM_MAP, describe: "Numbers about the item." }),
    ]),
});

/**
 * The inner keys of an item note's `data` block that the entry shape declares,
 * as `data` fields of the note types that are item notes.
 *
 * @type {readonly object[]}
 */
export const ITEM_NOTE_FIELDS = Object.freeze([
    Object.freeze({
        ...KIND_FIELD,
        describe:
            "What sort of thing the item is, one of the item kinds. Required; it categorises " +
            "the item for the setting and reaches no game system.",
    }),
    Object.freeze({ ...NAME_FIELD, describe: "The item's name as a list entry reads it." }),
    Object.freeze({
        ...IMG_FIELD,
        describe: "The item's image — an `icon` or `image` Address.",
    }),
    Object.freeze({
        name: "system",
        ...SYSTEM_MAP,
        describe: "Numbers about the item, shared by every game system.",
    }),
]);

/**
 * The `data.items` field declaration, shared by the types that list items.
 *
 * @param {typeof import("./item-entries.mjs").checkItems} checkItems
 * @returns {Readonly<{name: string, kind: string, shape: string, entries: typeof ITEM_ENTRY, check: typeof checkItems, describe: string}>} The items field declaration.
 */
export function itemsField(checkItems) {
    return Object.freeze({
        name: "items",
        kind: "list",
        shape: "list of item entries",
        entries: ITEM_ENTRY,
        check: checkItems,
        describe:
            "The items the subject has or typically carries, each an entry that names an item " +
            "note by `model` or defines an item inline with `name` and `kind`.",
    });
}
