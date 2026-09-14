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
 * **HM3's half of the infobox** — what this system's summary panel carries.
 *
 * Read straight off {@link HM3_ITEM_FIELDS}, the same list the item builders
 * obey, so a field added to a type reaches the box with no second edit. HM3
 * describes a weapon, a skill and a piece of gear with its own values, which
 * is the whole reason a system box exists per system rather than once: the two
 * systems disagree about impact, heft, reach and draw, so neither box can
 * stand for the other.
 *
 * A note that says nothing about HM3 gets a box reading _Not available_, and a
 * note type HM3 has no concept of — an affiliation, a mystery, an attribute —
 * gets no box at all. Both answers come from the note-type → document-subtype
 * map, so neither is stated here.
 *
 * @module
 */

import { defineInfobox } from "../engine/infobox.mjs";
import { HM3_ITEM_FIELDS } from "./item-fields.mjs";

/** What this system's box is called. @type {string} */
export const HM3_INFOBOX_TITLE = "HM3";

/**
 * HM3's presentation overlay: what one of this system's fields is called where
 * humanising its key gives the wrong word.
 *
 * **Not a second field list.** A field it does not mention still gets a row
 * under its own humanised name, so a field added to {@link HM3_ITEM_FIELDS}
 * reaches the box with no edit here.
 *
 * @type {Readonly<Record<string, {label?: string, withheld?: string}>>}
 */
export const HM3_FIELD_PRESENTATION = Object.freeze({
    value: Object.freeze({ label: "Price" }),
    masteryLevel: Object.freeze({ label: "Mastery" }),
});

/**
 * HM3's infobox declaration.
 *
 * @type {object}
 */
export const HM3_INFOBOX = defineInfobox({
    system: "hm3",
    title: HM3_INFOBOX_TITLE,
    fields: HM3_ITEM_FIELDS,
    presentation: HM3_FIELD_PRESENTATION,
});
