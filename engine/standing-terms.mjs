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
 * The terms of a body's standing — what a membership carries, and the rungs
 * and posts a body confers — as inner-key declarations.
 *
 * A leaf module, importing nothing: the note vocabulary reads these
 * declarations as it loads, and the checks that judge what the values mean
 * reach the vocabulary through the Address reader.
 *
 * @module
 */

/**
 * The note type a standing is held in.
 *
 * A standing is always held in a body: the entry is keyed by that body's
 * Address, which is what lets the rung and the post be checked against what
 * the body itself declares.
 */
export const STANDING_BODY_TYPES = Object.freeze(["affiliation"]);

/**
 * The keys one standing carries, as inner-key declarations.
 *
 * `rank` is the level on the body's own `governance.ranks` ladder, and every
 * membership states one. `office` is a key of its `governance.offices` map, and
 * is stated only where the being holds a post.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const STANDING_FIELDS = Object.freeze([
    Object.freeze({
        name: "rank",
        kind: "integer",
        required: true,
        shape:
            "the level on that body's own ladder, as a whole number — an ordinary " +
            "member is `1`, and `0` is the rung for someone cast out",
        describe: "The level on the body's own `governance.ranks` ladder.",
    }),
    Object.freeze({
        name: "office",
        kind: "string",
        shape: "a post from that body's `governance.offices`",
        describe: "A post the body names in its `governance.offices`, where one is held.",
    }),
]);

/** The keys of {@link STANDING_FIELDS}, in declared order. */
export const STANDING_KEYS = Object.freeze(STANDING_FIELDS.map((field) => field.name));

/**
 * The keys a rung carries, as inner-key declarations.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const RUNG_FIELDS = Object.freeze([
    Object.freeze({
        name: "level",
        kind: "integer",
        required: true,
        shape: "a whole number — the rung's position on this body's own ladder",
        describe: "The rung's position on the ladder; a member's `rank` names it.",
    }),
    Object.freeze({
        name: "title",
        kind: "string",
        required: true,
        shape: "what the standing is called",
        describe: "What the standing is called.",
    }),
    Object.freeze({
        name: "description",
        kind: "string",
        required: true,
        shape: "what the standing is",
        describe: "What the standing is.",
    }),
    Object.freeze({
        name: "lore",
        kind: "address",
        shape: "a lore Address",
        describe: "Lore saying more about the standing than a description holds.",
    }),
]);

/**
 * The keys one row of an office's `holders` carries, as inner-key declarations.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const HOLDER_FIELDS = Object.freeze([
    Object.freeze({
        name: "being",
        kind: "address",
        required: true,
        shape: "a being Address",
        describe: "Who held the office.",
    }),
    Object.freeze({
        name: "start",
        kind: "date",
        shape: "a date",
        describe: "When the term began; unstated, it began before anything recorded.",
    }),
    Object.freeze({
        name: "end",
        kind: "date",
        shape: "a date",
        describe: "When the term ended; unstated, the being holds the office now.",
    }),
    Object.freeze({
        name: "contested",
        kind: "boolean",
        shape: "`true` or `false`",
        describe: "The term may overlap another holder's.",
    }),
]);

/**
 * The keys an office written as a map carries. An office may instead be its
 * description alone, as a string.
 *
 * @type {readonly import("./data-keys.mjs").InnerKeySpec[]}
 */
export const OFFICE_FIELDS = Object.freeze([
    Object.freeze({
        name: "description",
        kind: "string",
        required: true,
        shape: "a string",
        describe: "What the office is.",
    }),
    Object.freeze({
        name: "holders",
        kind: "list",
        required: true,
        shape: "a list of `{ being, start?, end?, contested? }`",
        entries: Object.freeze({
            kind: "map",
            shape: "a map — `{ being, start?, end?, contested? }`",
            fields: HOLDER_FIELDS,
        }),
        describe: "Who has held it, each with the dates of the term.",
    }),
]);
