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
 * Default HM3 item artwork, keyed by the **note** type that compiles into it.
 *
 * The registry contract is fail-fast (see {@link module:engine/item-registry.itemArt}):
 * a type whose entry pairs no art aborts the pack build for a note that carries
 * no `img:` of its own, rather than shipping a mismatched icon. So every type
 * `item-builders.mjs` declares has a row here.
 *
 * **Paths are fully resolved.** `resolveImg` rewrites a leading `icons/` or
 * `images/` to the *consuming package's* asset root, which is not where these
 * live: they are shipped by the HM3 system. Written as `systems/hm3/images/…`
 * they pass through untouched and address the icons HM3's own compendiums
 * already use, so an item compiled from a note looks like its hand-authored
 * neighbours.
 *
 * **A one-to-many type gets one default**, because art is keyed by note type
 * and a note type is what a registry entry addresses. `weapongear` compiles
 * into a weapon or a missile and defaults to the sword either way; a note whose
 * subject is a thrown spear says so with an `img:` of its own. Keying art by
 * document subtype instead would mean a second lookup that could disagree with
 * the registry's, and the note-level override already answers the case.
 *
 * @module
 */

/**
 * Note type → the image an HM3 item of that type ships with.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const HM3_DEFAULT_ITEM_ART = Object.freeze({
    armorgear: "systems/hm3/images/icons/svg/armor.svg",
    armorlocation: "systems/hm3/images/icons/svg/anatomy.svg",
    containergear: "systems/hm3/images/icons/svg/sack.svg",
    miscgear: "systems/hm3/images/icons/svg/miscgear.svg",
    mysticalability: "systems/hm3/images/icons/svg/psionics.svg",
    projectilegear: "systems/hm3/images/icons/svg/arrow.svg",
    skill: "systems/hm3/images/icons/svg/skills.svg",
    trauma: "systems/hm3/images/icons/svg/injury.svg",
    weapongear: "systems/hm3/images/icons/svg/sword.svg",
});

/**
 * The default art path for an HM3 item type, or throw when the type is unknown.
 *
 * Reading this from `item-builders.mjs` is what keeps the two lists one: that
 * module cannot declare a type this map does not cover, because this throws and
 * that module evaluates at import.
 *
 * @param {string} type - The note type.
 * @returns {string} The default image path for it.
 * @throws {Error} When no art is paired with the type.
 */
export function hm3DefaultItemArt(type) {
    if (!(type in HM3_DEFAULT_ITEM_ART)) {
        throw new Error(
            `No default art for HM3 item type "${type}" — add one to ` +
                `@heroiclands/package-build/hm3/default-item-art`,
        );
    }
    return /** @type {Record<string, string>} */ (HM3_DEFAULT_ITEM_ART)[type];
}
