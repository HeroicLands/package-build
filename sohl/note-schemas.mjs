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
 * What every SoHL content type may write under `sohl:` — the vocabulary the
 * frontmatter linter checks a note against (#19).
 *
 * **Item types need no declaration here.** {@link ITEM_FIELDS} already is one,
 * and it is the same list the compiler obeys, so an item's schema and its
 * builder cannot disagree — they are one object. The linter simply reads it.
 *
 * **The other types are declared, because their compilers are hand-written.**
 * A being, a macro, a journal note and the three map types are built by code
 * that reads frontmatter directly rather than from a field list, so their
 * vocabulary has to be *stated* to be checkable. These entries carry no `to`:
 * nothing here builds anything, and claiming an emitted path they do not
 * produce would be a lie in the one place a reader would trust it. When one of
 * those compilers becomes declarative, its entry here becomes the builder, the
 * way `ITEM_FIELDS` did (#22).
 *
 * **Every consumer loads all of it.** An adventure module authors the full
 * vocabulary — a specific skill, a magic sword, an NPC, a custom beast is the
 * normal shape of an adventure — so nothing is withheld from one. The
 * `sohl/` ÷ `engine/` line is between knowledge of the *game system* and
 * knowledge of the *note format*, not a permission boundary between consumers.
 *
 * @module
 */

import { AS_AUTHORED, NUMBER, STRING } from "../engine/field-spec.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { ITEM_FIELDS } from "./item-fields.mjs";

/** A map-valued property, whose entries the compiler walks by key. */
const MAP = Object.freeze({ shape: "map of key → entry", kind: "map" });

/** A list-valued property. */
const LIST = Object.freeze({ shape: "list", kind: "list" });

/**
 * A `doc` note — free prose compiled into a JournalEntry.
 *
 * Empty on purpose: a documentation note carries the frontmatter envelope every
 * note carries, and nothing under `sohl:` beyond the universal keys the linter
 * allows for any type. Declaring the type with no fields is what distinguishes
 * a type with no vocabulary apart from a type that is unknown, which are
 * different findings.
 *
 * @type {readonly import("../engine/field-spec.mjs").FieldSpec[]}
 */
const DOC_FIELDS = Object.freeze([]);

/**
 * A `macro` note — a script compiled into a Foundry Macro.
 *
 * Neither field is required: the compiler defaults `macroType` to `script` and
 * `macroScope` to `global`, and both reject an unrecognised value outright, so
 * the value check here is about shape and the compiler's is about membership.
 *
 * @type {readonly import("../engine/field-spec.mjs").FieldSpec[]}
 */
const MACRO_FIELDS = Object.freeze([
    {
        name: "macroType",
        ...STRING,
        describe: 'What the macro is — "script" or "chat".',
    },
    {
        name: "macroScope",
        ...STRING,
        describe: "Which scope the macro is registered in.",
    },
]);

/**
 * A `being` note — an actor, with its body, movement and embedded items.
 *
 * @type {readonly import("../engine/field-spec.mjs").FieldSpec[]}
 */
const BEING_FIELDS = Object.freeze([
    {
        name: "body",
        ...MAP,
        describe: "The being's body structure, by part shortcode.",
    },
    {
        name: "attributes",
        ...MAP,
        describe: "Attribute scores, by attribute shortcode.",
    },
    {
        name: "items",
        ...LIST,
        describe:
            "Items embedded on the being, each addressed by (type, shortcode) or carrying enough fields to stand alone.",
    },
    {
        name: "currentMoveMedium",
        ...STRING,
        describe: "Which medium the being is currently moving through.",
    },
    {
        name: "movementProfiles",
        ...LIST,
        describe: "Movement rates, one profile per medium.",
    },
    {
        name: "defaultCombatGroup",
        ...AS_AUTHORED,
        describe: "The combat group the being joins by default.",
    },
]);

/**
 * A map note — `battlemap`, `localmap` or `regionalmap`, each compiled into a
 * Foundry Scene.
 *
 * The three differ only in derived canvas defaults, which is the map compiler's
 * business; their authored vocabulary is the same, so they share one
 * declaration rather than three copies that could drift.
 *
 * `image` is the one required field — the compiler refuses a map note without
 * it, since a scene with no background is not a map.
 *
 * @type {readonly import("../engine/field-spec.mjs").FieldSpec[]}
 */
const MAP_FIELDS = Object.freeze([
    {
        name: "image",
        ...STRING,
        required: true,
        describe: "The scene's background image.",
    },
    {
        name: "dimensions",
        ...LIST,
        required: true,
        describe: "`[width, height]` in whole pixels — the map art's own size.",
    },
    {
        name: "pxPerGrid",
        ...NUMBER,
        required: true,
        describe:
            "Whole pixels per grid square. Must match the art, so the compiler refuses a map note without it.",
    },
    {
        name: "navName",
        ...STRING,
        describe: "The scene's short name in Foundry's navigation bar.",
    },
    {
        name: "levelName",
        ...STRING,
        describe: "Name of the ground level.",
    },
    {
        name: "backgroundColor",
        ...STRING,
        describe: "Colour shown beyond the background image.",
    },
    {
        name: "overlay",
        ...STRING,
        describe: "Foreground image drawn over the scene.",
    },
    { name: "walls", ...MAP, describe: "Wall segments, by key." },
    { name: "doors", ...MAP, describe: "Doors, by key." },
    { name: "lights", ...MAP, describe: "Light sources, by key." },
    { name: "tiles", ...MAP, describe: "Tiles, by key." },
    { name: "sounds", ...MAP, describe: "Ambient sounds, by key." },
    {
        name: "locations",
        ...MAP,
        describe: "Map notes pinned to the scene, by key.",
    },
    {
        name: "regions",
        ...MAP,
        describe: "Regions and their behaviours, by key.",
    },
    {
        name: "place",
        ...AS_AUTHORED,
        describe: "The place this map depicts.",
    },
    {
        name: "placeName",
        ...STRING,
        describe: "Display name of the place this map depicts.",
    },
]);

/**
 * Authored, but not compiled — vocabulary the *presentation* surfaces read.
 *
 * A note feeds a knowledgebase and a website as well as a compendium pack, and
 * those consume classification the pack build never emits: a knowledgebase list
 * page groups armour by `armorType` and gear by `craft`, thalorna's site reads
 * `traits` on 163 notes. None of it appears in {@link ITEM_FIELDS}, because
 * that list is the *builder* and these are not built.
 *
 * They are declared here anyway, because the question this schema answers is
 * "what may a note of this type write", not "what does the compiler emit". The
 * distinction is not academic: treating the builder's allow-list as the whole
 * vocabulary reported 4,241 unknown properties against SoHL's own tree, every
 * one of them correctly authored.
 *
 * Each carries no `kind` unless its shape is certain, so the lint reports a
 * misspelling without making a claim about a value it does not consume.
 *
 * @type {Readonly<Record<string, readonly import("../engine/field-spec.mjs").FieldSpec[]>>}
 */
const PRESENTATION_FIELDS = Object.freeze({
    armorgear: Object.freeze([
        {
            name: "craft",
            ...MAP,
            describe:
                "The craft that makes it — `{skill, secondary}` — for knowledgebase grouping.",
        },
        {
            name: "armorType",
            ...STRING,
            describe: "Armour class, for knowledgebase grouping.",
        },
        {
            name: "detailMaterial",
            ...AS_AUTHORED,
            describe: "Material detail shown on the knowledgebase page.",
        },
    ]),
    weapongear: Object.freeze([
        {
            name: "craft",
            ...MAP,
            describe:
                "The craft that makes it — `{skill, secondary}` — for knowledgebase grouping.",
        },
        {
            name: "weaponType",
            ...STRING,
            describe: "Weapon class, for site grouping.",
        },
    ]),
    miscgear: Object.freeze([
        {
            name: "craft",
            ...MAP,
            describe:
                "The craft that makes it — `{skill, secondary}` — for knowledgebase grouping.",
        },
    ]),
    containergear: Object.freeze([
        {
            name: "craft",
            ...MAP,
            describe:
                "The craft that makes it — `{skill, secondary}` — for knowledgebase grouping.",
        },
    ]),
    projectilegear: Object.freeze([
        {
            name: "craft",
            ...MAP,
            describe:
                "The craft that makes it — `{skill, secondary}` — for knowledgebase grouping.",
        },
        {
            name: "traits",
            ...AS_AUTHORED,
            describe: "Descriptive traits, read by the publishing sites.",
        },
    ]),
    skill: Object.freeze([
        {
            name: "strikeMode",
            ...AS_AUTHORED,
            describe:
                "The strike mode a combat technique declares. Compiled, but applied by the builder rather than listed in the type's fields.",
        },
    ]),
    being: Object.freeze([
        {
            name: "attrRollFormula",
            ...AS_AUTHORED,
            describe: "Formula shown for the being's attribute rolls.",
        },
    ]),
});

/**
 * Every content type this package compiles, and what a note of that type may
 * write.
 *
 * The engine's own types are merged in first, so a SoHL tree is checked against
 * one vocabulary rather than two. They are declared there rather than here
 * because they are note-format knowledge — a `homepage` carries no `system`
 * block and would mean the same thing for a game system that is not SoHL — and
 * because a package declaring no `itemBuilders` never reaches this file (#51).
 *
 * @type {Readonly<Record<string, readonly import("../engine/field-spec.mjs").FieldSpec[]>>}
 */
export const NOTE_SCHEMAS = Object.freeze({
    ...ENGINE_NOTE_SCHEMAS,
    ...Object.fromEntries(
        Object.entries(ITEM_FIELDS).map(([type, fields]) => [
            type,
            // A new list, never a mutation: `ITEM_FIELDS[type]` is the identity
            // the builder registry holds, and the two must stay the same object.
            Object.freeze([...fields, ...(PRESENTATION_FIELDS[type] ?? [])]),
        ]),
    ),
    doc: DOC_FIELDS,
    macro: MACRO_FIELDS,
    being: Object.freeze([...BEING_FIELDS, ...PRESENTATION_FIELDS.being]),
    battlemap: MAP_FIELDS,
    localmap: MAP_FIELDS,
    regionalmap: MAP_FIELDS,
});
