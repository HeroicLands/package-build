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

import path from "node:path";

import { encodeAddresses } from "./address-values.mjs";
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
        // Foreign first, local last: a renderer sizing a picture looks it up
        // by the pathname the record resolved to, never by address, and a
        // local record is entered after a foreign one so it wins the lookup on
        // the collision neither should ever cause.
        byPath: assetImageInfoByPathname([
            ...(foreign?.index?.values() ?? []),
            ...records.filter(isAssetRecord),
        ]),
    };
}

/**
 * What a renderer needs to size one picture, keyed by the pathname its
 * address resolves to.
 *
 * An image reaches a renderer as the resolved pathname an embed or an authored
 * body image already carries — see {@link readAssetAddress} — never as the
 * address that produced it, so the lookup a renderer wants is by pathname, not
 * by {@link assetAddressIndex}'s own `assets` map.
 *
 * @param {readonly object[]} records - Asset records, local or foreign.
 * @returns {Map<string, {type: string, role?: string, width: number|"", height: number|""}>}
 *   One entry per addressable file, carrying only what a renderer sizes a
 *   picture from. `role` is omitted when the record states none; `width` and
 *   `height` are always present, blank (`""`) for a vector — the record's own
 *   convention, carried through rather than collapsed into an absence a
 *   renderer could not tell apart from "no asset resolved at all".
 */
export function assetImageInfoByPathname(records = []) {
    const map = new Map();
    for (const record of records) {
        if (!record?.asset?.path || !record.package) continue;
        const key = `${record.package}/${ASSETS_SEGMENT}/${record.asset.path}`;
        map.set(key, {
            type: record.type,
            role: record.asset.role || undefined,
            width: typeof record.asset.width === "number" ? record.asset.width : "",
            height: typeof record.asset.height === "number" ? record.asset.height : "",
        });
    }
    return map;
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
 * Every asset's role, keyed by the pathname it resolves to — the form a body
 * carries once an embed's address has been rewritten into the ordinary image
 * every surface renders ({@link module:engine/content-embeds.resolveEmbeds}).
 *
 * This is the lookup a `:::figure` fence's `map` counter reaches through —
 * see {@link module:engine/content-figures.scanFigures}'s `resolveRole` —
 * for a caller that reads a body after that rewrite: a Foundry journal, an
 * item or actor's documentation, and the book.
 *
 * @param {object} index - From {@link module:engine/wikilinks.buildWikilinkIndex},
 *   or the equivalent the site and the book build.
 * @returns {Map<string, string>} Pathname → role, one entry per asset that
 *   declares one.
 */
export function pathnameRoles(index) {
    const roles = new Map();
    for (const record of [
        ...(index?.assets?.values() ?? []),
        ...(index?.foreign?.values() ?? []),
    ]) {
        const role = record?.asset?.role;
        if (!role || !record.asset?.path || !record.package) continue;
        roles.set(`${record.package}/${ASSETS_SEGMENT}/${record.asset.path}`, role);
    }
    return roles;
}

/**
 * Flag a note whose art slot names a picture that is not the size that slot
 * is cut to.
 *
 * The size is stated by the slot itself, in
 * {@link module:engine/art-slots.ART_SLOTS}, so it is written once and a slot
 * that states none asks nothing of the picture it names. Today the hero image
 * is the one slot with a fixed strip to fill; a picture written in prose is
 * fitted to the room it has and is never measured here.
 *
 * A vector carries no pixel size to compare, and neither does a raster whose
 * header cannot be read; neither is flagged.
 *
 * @param {readonly object[]} records - The corpus, notes and assets together.
 * @param {object} [opts]
 * @param {object} [opts.config] - The resolved build configuration.
 * @param {string} [opts.assetsBase] - Where the asset roots sit, so a finding
 *   names the file from the working directory as every other finding does.
 * @returns {object[]} A finding per picture off its slot's size,
 *   `severity: "error"`.
 */
export function checkArtSlotSizes(records = [], { config, assetsBase = "" } = {}) {
    const sized = ART_SLOTS.filter((slot) => slot.size);
    if (!sized.length) return [];
    const index = assetAddressIndex(records, { config });
    const findings = [];
    for (const record of records) {
        const data = record?.data;
        if (!data) continue;
        for (const slot of sized) {
            const value = data[slot.key];
            if (!value) continue;
            const asset = resolveArtRecord(index, value, slot.type, slot.accepts);
            const { path: file, width, height } = asset?.asset ?? {};
            if (!file || !width || !height) continue;
            if (Number(width) === slot.size.width && Number(height) === slot.size.height) continue;
            findings.push({
                file: path.join(assetsBase, file),
                severity: "error",
                message:
                    `${width}×${height} is not the ${slot.size.width}×${slot.size.height} ` +
                    `a \`${slot.key}\` is cut to`,
            });
        }
    }
    return findings;
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
 * The art a being falls back to, by its subtype.
 *
 * Both files ship in `sohl`, under `assets/icons/other/`, and both are named
 * here as addresses rather than as paths for the reason every art reference is:
 * the address resolves to a record that carries the owning package, so a
 * package borrowing the default gets the same file the system ships.
 *
 * **Only the compiler can choose between them**, because only the compiler
 * reads the note's subtype. A schema default is the last resort beneath this
 * one, and covers a world document created by hand, which no note describes.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const BEING_DEFAULT_ART = Object.freeze({
    character: "sohl-none-icon-defaultcharhead",
    creature: "sohl-none-icon-defaultcreathead",
});

/**
 * The default art address a being's subtype chooses, or `null`.
 *
 * An NPC and a character use person art; a creature uses creature art.
 *
 * @param {object} fm - The note's frontmatter.
 * @returns {string|null} The address, or `null` when no subtype selects one.
 */
export function beingDefaultArt(fm) {
    if (fm?.subType === "npc" || fm?.subType === "character") {
        return BEING_DEFAULT_ART.character;
    }
    if (fm?.subType === "creature") return BEING_DEFAULT_ART.creature;
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
