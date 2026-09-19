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
 * The art slots a note declares, and turning one of them into a path.
 *
 * A note names the art a *document field* needs, and every other image in it is
 * inline. Each slot is an ordinary `WikiLink` field declaring a default type,
 * exactly as `seat` declares `place`: a bare shortcode takes its type from the
 * declaration, and a value that qualifies itself climbs the same short-form
 * ladder every other link uses.
 *
 * **A bare shortcode is told from a written address by the separator alone.** A
 * shortcode is lowercase letters and digits (`ADDRESS_SEGMENT_PATTERN`), so a
 * hyphen can only be a segment boundary — which makes `anvil` the bare form and
 * `icon-anvil`, `none-icon-anvil` and `sohl-none-icon-anvil` the written ones,
 * with nothing to guess and no vocabulary to match against.
 *
 * **Resolution is one step, because the record carries the path.** The address
 * names a record, the record names the file's path inside its own package, and
 * the pathname rule ({@link module:engine/pathnames}) turns the pair into the
 * address each surface serves. So an art field and a body image go through the
 * same ownership rule rather than through two that agree by inspection, and a
 * package that ships no Foundry package — `packagebuild`, which is an npm
 * package and installs nowhere — yields no Foundry address rather than a
 * plausible broken one.
 *
 * @module
 */

import { expandAddress } from "./content-address.mjs";
import { hasTag } from "./note-vocabulary.mjs";
import { ASSET_SYSTEM } from "./asset-types.mjs";
import { ASSETS_SEGMENT } from "./pathnames.mjs";
import { readQualifier } from "./wikilinks.mjs";

/**
 * One art slot: the key a note authors, and the type a bare value takes.
 *
 * @typedef {object} ArtSlot
 * @property {string} key - The key under `data:`.
 * @property {string} type - The asset type a bare shortcode defaults to.
 * @property {boolean} document - Whether the slot reaches a compiled document.
 * @property {string} describe - One line, for the author-facing reference.
 */

/**
 * The four art slots, in the order the specification tabulates them.
 *
 * `banner` is the one that reaches no compiled document: it is the page's hero
 * image, read by the site and by the book's section plates and by nothing else.
 * That is what `document: false` states, and it is why the inert-art check
 * skips it — a key that is *meant* to reach no document is not an inert key.
 *
 * @type {readonly ArtSlot[]}
 */
export const ART_SLOTS = Object.freeze([
    Object.freeze({
        key: "icon",
        type: "icon",
        document: true,
        describe: "The document's profile art, resolved into `img`.",
    }),
    Object.freeze({
        key: "tokenIcon",
        type: "icon",
        document: true,
        describe: "What a token on the canvas wears; unset, it follows `icon`.",
    }),
    Object.freeze({
        key: "bgImage",
        type: "image",
        document: true,
        describe: "A map's background art, resolved into `background.src`.",
    }),
    Object.freeze({
        key: "banner",
        type: "image",
        document: false,
        describe: "The page's hero image. Reaches no compiled document.",
    }),
]);

/**
 * The art slot one key names, or `undefined`.
 *
 * @param {unknown} key - The key under `data:`.
 * @returns {ArtSlot|undefined} The slot.
 */
export function artSlot(key) {
    return ART_SLOTS.find((slot) => slot.key === key);
}

/**
 * The address an authored art value names.
 *
 * @param {string} value - The value as authored.
 * @param {string} defaultType - The type the field declares.
 * @returns {string} A written address, which may be partial.
 */
export function artTarget(value, defaultType) {
    const written = String(value);
    return written.includes("-") ? written : `${defaultType}-${written}`;
}

/**
 * The index record an art value resolves to, or `null`.
 *
 * Local files answer first and foreign ones after, which is an ordering of maps
 * rather than a precedence rule: an address carries its own package, so the two
 * cannot both hold one.
 *
 * @param {object} index - From {@link module:engine/wikilinks.buildWikilinkIndex}.
 * @param {unknown} value - The value as authored.
 * @param {string} defaultType - The type the field declares.
 * @returns {{package: string, asset: {path: string}}|null} The record.
 */
export function resolveArtRecord(index, value, defaultType) {
    if (typeof value !== "string" || !value) return null;
    const read = readQualifier(artTarget(value, defaultType), index?.types, index?.packages);
    if (!read || read.reason) return null;
    // The system segment is fixed at `none` for an asset type, so where the
    // value was written does not enter into it — an embedded item's art is
    // authored inside a system block and still names the same file.
    const canonical = expandAddress(read, {
        package: index?.contentPackage ?? index?.packageId,
        system: ASSET_SYSTEM,
    });
    const hit = index?.assets?.get(canonical) ?? index?.foreign?.get(canonical) ?? null;
    return hit?.asset?.path && hit.package ? hit : null;
}

/**
 * The pathname an art value names, in the form an authored one takes.
 *
 * Handing the result to {@link module:engine/helpers.resolveImg} is what puts an
 * art address and a body image through one ownership rule. The two empties
 * survive it unchanged: `null` and an absent key mean *no art named, apply the
 * default*, and `""` means *ship blank on purpose*.
 *
 * @param {object} index - From {@link module:engine/wikilinks.buildWikilinkIndex}.
 * @param {unknown} value - The value as authored.
 * @param {string} defaultType - The type the field declares.
 * @returns {{pathname: string|null, resolved: boolean}} The pathname, and
 *   whether an address was actually answered — which tells a caller applying a
 *   default apart from one whose address named nothing.
 */
export function artPathname(index, value, defaultType) {
    if (value == null) return { pathname: null, resolved: true };
    if (value === "") return { pathname: "", resolved: true };
    const record = resolveArtRecord(index, value, defaultType);
    if (!record) return { pathname: null, resolved: false };
    return {
        pathname: `${record.package}/${ASSETS_SEGMENT}/${record.asset.path}`,
        resolved: true,
    };
}

/**
 * The art a being falls back to, by the kind it is tagged.
 *
 * Both files ship in `sohl`, under `assets/icons/other/`, and both are named
 * here as addresses rather than as paths for the reason every art reference is:
 * the address resolves to a record that carries the owning package, so a
 * package borrowing the default gets the same file the system ships.
 *
 * **Only the compiler can choose between them**, because only the compiler
 * reads the note's tags. A schema default is the last resort beneath this one,
 * and covers a world document created by hand, which no note describes.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const BEING_DEFAULT_ART = Object.freeze({
    character: "sohl-none-icon-defaultcharhead",
    creature: "sohl-none-icon-defaultcreathead",
});

/**
 * The default art address a being's own tags choose, or `null`.
 *
 * `character` means a **person**, not a human, and `creature` everything else;
 * a being carries exactly one of the two, which is what makes the choice a
 * lookup rather than a precedence rule.
 *
 * @param {object} fm - The note's frontmatter.
 * @returns {string|null} The address, or `null` for a note carrying neither tag.
 */
export function beingDefaultArt(fm) {
    for (const [tag, address] of Object.entries(BEING_DEFAULT_ART)) {
        if (hasTag(fm, tag)) return address;
    }
    return null;
}

/**
 * What an unresolved art address is reported as.
 *
 * One wording, so the four compilers that can meet the case do not each invent
 * their own.
 *
 * @param {string} key - The key that was authored.
 * @param {unknown} value - The value it carried.
 * @param {string} defaultType - The type the field declares.
 * @returns {string} The message.
 */
export function unresolvedArtMessage(key, value, defaultType) {
    return (
        `\`data.${key}\` names \`${artTarget(String(value), defaultType)}\`, and no ` +
        `asset in this package or in a fetched index carries that address — the ` +
        `document takes its default art instead`
    );
}
