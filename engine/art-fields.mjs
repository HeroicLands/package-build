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
 * inline. Each slot is an ordinary `Address` field declaring a default type,
 * exactly as `seat` declares `place`: a bare shortcode takes its type from the
 * declaration, and a value that qualifies itself climbs the same short-form
 * ladder every other link uses. {@link module:engine/address.parseAddress}
 * reads it, taking the slot's `type` as the default an omitted segment fills
 * in — this module states no separator rule of its own.
 *
 * **The accepted set is a slot's second declaration, and it is not the
 * default.** A slot's `type` says what a bare shortcode names; its `accepts`
 * says what a qualified one may name, and {@link module:engine/address.acceptsType}
 * checks a parsed value against it. `icon` defaults to `icon` and accepts
 * `image` too, because a faith tradition's profile art is a full illustration
 * rather than a game icon — twenty notes in `sohl-kethira-basic` author exactly
 * that. A type outside the set is an error naming the set, never a silent fall
 * back to the default art: the parser never refuses on type grounds, only the
 * slot does.
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

import { encodeAddresses } from "./address-values.mjs";
import { hasTag } from "./note-vocabulary.mjs";
import { ASSET_SYSTEM, isAssetType } from "./asset-types.mjs";
import { ASSETS_SEGMENT } from "./pathnames.mjs";
import { isAssetRecord } from "./index-records.mjs";
import { ASSET_TYPE_NAMES } from "./asset-types.mjs";
import { acceptsType, parseAddress, renderAddress } from "./address.mjs";

import { ART_SLOTS } from "./art-slots.mjs";
export { ART_SLOTS } from "./art-slots.mjs";
/** @typedef {import("./art-slots.mjs").ArtSlot} ArtSlot */

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
 * The Address an authored art value names, checked against what this position
 * accepts.
 *
 * The two questions {@link module:engine/address} keeps separate: does the
 * value parse, and is what it names acceptable *here*. {@link parseAddress}
 * answers the first, taking the slot's own `type` as the default an omitted
 * segment fills in; {@link acceptsType} answers the second, against the set
 * the position declares rather than against that same default.
 *
 * @param {unknown} value - The value as authored.
 * @param {string} defaultType - The type a bare value takes.
 * @param {Iterable<string>|undefined} accepts - The types this position
 *   accepts, or `undefined` to accept whatever parses.
 * @param {import("./address.mjs").AddressDefaults} [vocabulary] - The
 *   position's remaining defaults and the tree's vocabularies.
 * @returns {import("./address.mjs").AddressTuple
 *   |import("./address.mjs").AddressProblem
 *   |{reason: "not-accepted", type: string}} The Address; a reason it does
 *   not parse; or `not-accepted` when it parses to a type outside `accepts`.
 */
export function artTarget(value, defaultType, accepts, vocabulary = {}) {
    const tuple = parseAddress(value, { ...vocabulary, system: ASSET_SYSTEM, type: defaultType });
    if (tuple.reason) return tuple;
    if (accepts && !acceptsType(tuple, accepts)) {
        return { reason: "not-accepted", type: tuple.type };
    }
    return tuple;
}

/**
 * The address space an asset reference resolves against, from a corpus.
 *
 * Shaped exactly as {@link module:engine/wikilinks.buildWikilinkIndex}'s result
 * is in the parts a resolver reads, so the site, the book and the pack compilers
 * answer one authored address the same way.
 *
 * **The note types belong in `types` as well as the asset ones.** Without them
 * `being-thorn` does not parse as an address at all, and an embed naming a note
 * is reported as an unknown type on one surface and as the wrong kind of type on
 * another — one mistake, two verdicts, which is what the shared vocabulary
 * exists to prevent.
 *
 * @param {readonly object[]} records - The corpus, from
 *   {@link module:engine/content-index.indexRecordsFor}.
 * @param {object} [opts]
 * @param {object} [opts.config] - The resolved build configuration.
 * @param {{index?: Map<string, object>, packages?: Iterable<string>}} [opts.foreign] -
 *   The vendored indexes a dependency published.
 * @param {Iterable<string>} [opts.types] - The note types this tree knows.
 * @returns {object} The index.
 */
export function assetAddressIndex(records = [], { config, foreign, types = [] } = {}) {
    return {
        types: new Set([...ASSET_TYPE_NAMES, ...types]),
        packages: new Set([config?.contentPackage, ...(foreign?.packages ?? [])].filter(Boolean)),
        contentPackage: config?.contentPackage,
        assets: new Map(
            records
                .filter(isAssetRecord)
                .map((record) => [encodeAddresses(record.address?.canonical), record])
                .filter(([key]) => key),
        ),
        foreign: foreign?.index ?? new Map(),
    };
}

/**
 * The asset one authored value names, or why it names none.
 *
 * The whole lookup in one place, because two callers need it and they need
 * different halves of the answer: an art slot needs the record, and an embed
 * needs to tell an address that resolves to nothing from one that reaches the
 * wrong *kind* of type. Those are different mistakes with different fixes, and a
 * single `null` would collapse them into one message.
 *
 * Local files answer first and foreign ones after, which is an ordering of maps
 * rather than a precedence rule: an address carries its own package, so the two
 * cannot both hold one.
 *
 * @param {object} index - From {@link module:engine/wikilinks.buildWikilinkIndex},
 *   or the equivalent the site and the book build.
 * @param {unknown} value - The value as authored.
 * @param {string} defaultType - The type a bare value takes.
 * @param {Iterable<string>} [accepts] - The types this position accepts, for a
 *   position that declares a set narrower than "every asset type" — an art
 *   slot's. Omitted, any asset type is taken, which is an embed's rule: it
 *   draws a file, and every asset type is a file.
 * @returns {{record: {package: string, asset: {path: string}}, pathname: string}
 *   |{record: null, reason: string, type?: string}} The asset and the pathname
 *   it is at, or a reason from
 *   {@link module:engine/wikilink-syntax.LINK_FINDING_REASONS}, or `not-accepted`
 *   when `accepts` is given and the parsed type falls outside it.
 */
export function readAssetAddress(index, value, defaultType, accepts) {
    if (!value) {
        return { record: null, reason: "not-an-address" };
    }
    const read = artTarget(value, defaultType, accepts, {
        system: ASSET_SYSTEM,
        package: index?.contentPackage ?? index?.packageId,
        types: index?.types,
        packages: index?.packages,
    });
    if (read.reason === "not-accepted") {
        return { record: null, reason: "not-accepted", type: read.type };
    }
    if (read.reason) return { record: null, reason: read.reason, type: read.type };
    // **Asset types only**, where the position declares no narrower set. An
    // address may name any type the vocabulary holds, and most of them name a
    // note — which has no file to draw. Refused by its own reason rather than
    // left to resolve to nothing, because the fix is a different one: an
    // ordinary link, not a corrected shortcode.
    if (!accepts && !isAssetType(read.type)) {
        return { record: null, reason: "not-an-asset", type: String(read.type) };
    }
    const canonical = renderAddress(read);
    const hit = index?.assets?.get(canonical) ?? index?.foreign?.get(canonical) ?? null;
    if (!hit?.asset?.path || !hit.package) return { record: null, reason: "unresolved" };
    return { record: hit, pathname: `${hit.package}/${ASSETS_SEGMENT}/${hit.asset.path}` };
}

/**
 * The index record an art value resolves to, or `null`.
 *
 * @param {object} index - From {@link module:engine/wikilinks.buildWikilinkIndex}.
 * @param {unknown} value - The value as authored.
 * @param {string} defaultType - The type the field declares.
 * @param {Iterable<string>} [accepts] - The types this position accepts.
 * @returns {{package: string, asset: {path: string}}|null} The record.
 */
export function resolveArtRecord(index, value, defaultType, accepts) {
    return readAssetAddress(index, value, defaultType, accepts).record;
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
 * @param {Iterable<string>} [accepts] - The types this position accepts.
 * @returns {{pathname: string|null, resolved: boolean, reason?: string,
 *   type?: string}} The pathname, and whether an address was actually
 *   answered — which tells a caller applying a default apart from one whose
 *   address named nothing. `reason` and `type` carry why, unresolved — in
 *   particular `not-accepted`, which the caller reports as an error rather
 *   than falling back silently.
 */
export function artPathname(index, value, defaultType, accepts) {
    if (value == null) return { pathname: null, resolved: true };
    if (value === "") return { pathname: "", resolved: true };
    const read = readAssetAddress(index, value, defaultType, accepts);
    if (!read.record) {
        return { pathname: null, resolved: false, reason: read.reason, type: read.type };
    }
    return { pathname: read.pathname, resolved: true };
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
 * their own. A **warning**: nothing in this package or a fetched index answers
 * the address, so the document falls back to its default art rather than
 * shipping a path that installs nowhere.
 *
 * @param {string} key - The key that was authored.
 * @param {unknown} value - The value it carried, named exactly as written.
 * @returns {string} The message.
 */
export function unresolvedArtMessage(key, value) {
    return (
        `\`data.${key}\` names \`${encodeAddresses(value)}\`, and no asset in this package or in ` +
        `a fetched index carries that address — the document takes its default art ` +
        `instead`
    );
}

/**
 * What an art address naming a type this slot does not accept is reported as.
 *
 * An **error**, not a warning: unlike an address nothing answers, this one
 * names a real type, and no default art repairs an author asking for a sound
 * where the slot takes an icon or an image.
 *
 * @param {string} key - The key that was authored.
 * @param {unknown} value - The value it carried, named exactly as written.
 * @param {string} type - The type the address named.
 * @param {Iterable<string>} accepts - The types this slot accepts.
 * @returns {string} The message.
 */
export function unacceptedArtMessage(key, value, type, accepts) {
    return (
        `\`data.${key}\` names \`${encodeAddresses(value)}\`, whose type \`${type}\` this slot does ` +
        `not accept — it accepts ${[...accepts].join(" or ")}`
    );
}
