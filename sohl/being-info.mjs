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

/** Shared being type and gear groups used by the SoHL infobox. @module */

/**
 * The note type for a being.
 */
export const BEING_TYPE = "being";

/**
 * Whether a note's frontmatter describes a being.
 *
 * @param {{type?: unknown}|null|undefined} fm - A note's frontmatter.
 * @returns {boolean} `true` when the note is a being.
 */
export function isBeing(fm) {
    return Boolean(fm) && fm.type === BEING_TYPE;
}

/**
 * The infobox group displayed for each gear note type.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const GEAR_TYPE_TO_KEY = Object.freeze({
    weapongear: "weapons",
    armorgear: "armor",
    projectilegear: "projectiles",
    miscgear: "misc",
    containergear: "containers",
    concoctiongear: "concoctions",
});
