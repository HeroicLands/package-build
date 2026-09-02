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
 * **The resolved item-type registry** — the consuming repository's
 * `itemBuilders` table, and the type whitelist derived from its keys.
 *
 * Both are read from the one resolved configuration, so they are literally the
 * same object's keys and values: a type cannot be whitelisted for compilation
 * without the builder that compiles it, which is the guarantee #1504 exists
 * for. Where a consumer declares **several** registries, one per system (#58),
 * the vocabulary is their union and every lookup below takes the system that is
 * asking — a type both systems declare has two builders, and answering with one
 * of them because it was declared first is the silent-wrong-output failure this
 * package spends its time removing. The Item compiler dispatches through {@link itemBuilder}, so the table a
 * consumer configured is the table its notes compile with — the whitelist and
 * the dispatch used to come from different places, and a consumer supplying its
 * own registry got the types it asked for and the builders it did not (#1563).
 *
 * **The registry itself is a consumer's, and stays a leaf.** SoHL's lives in
 * `@heroiclands/package-build/sohl/item-builders`; the consumer names it in
 * `package-build.config.yaml`. That module must never read the resolved
 * configuration — it is loaded *during* the resolution such a read would be
 * asking for, whether the loader requires it by name for a data config or a
 * code config imports it directly, so a read from there would close a cycle
 * around the configuration's own evaluation. Data travels *into*
 * configuration; only modules like this one, which nothing on that path
 * imports, read back out of it.
 *
 * @module
 */

import { loadPackConfig } from "./pack-config.mjs";
import { resolveImg } from "./helpers.mjs";

/**
 * Every content type that compiles into an item — and therefore into an item
 * doc. Read by the Item compiler to know what to claim, and by the journals
 * pass to know whose prose it is holding.
 *
 * **Derived, never authored.** These are the keys of the consuming
 * repository's `itemBuilders` registry, so the whitelist and the builder table
 * are the same list and cannot drift apart. They already had: `trait` was
 * whitelisted long after the item type was retired (#651), with no builder
 * behind it, so every `type: trait` note passed the gate and then failed to
 * compile (#1504).
 *
 * An accessor rather than a hoisted constant, so that importing this module
 * needs no configuration (#2).
 *
 * @returns {ReadonlySet<string>} The configured item types.
 */
export function itemTypes() {
    return loadPackConfig().itemTypes;
}

/**
 * Look one type up in the table a system declared, or in the flat one.
 *
 * The flat table is the union with the first declaring registry winning, which
 * is the right answer for every single-system build and no answer at all where
 * two systems declare the type. So a contested type without a system **throws**
 * rather than resolving: the alternative is a document built by one system's
 * builder and stamped with another's, which is exactly the shape of defect the
 * document-subtype map exists to stop (#79).
 *
 * @param {string} what - What is being looked up, for the message.
 * @param {"itemBuilders"|"itemArt"|"itemFields"} table - Which table.
 * @param {string} type - The item type.
 * @param {string} [system] - The system asking, where a build has more than one.
 * @returns {any} The entry, or `undefined`.
 * @throws {Error} When several systems declare the type and none is named.
 */
function lookup(what, table, type, system) {
    const config = loadPackConfig();
    if (system !== undefined) {
        const perSystem = /** @type {Record<string, Record<string, unknown>>} */ (
            config[`${table}BySystem`]
        );
        // A consumer declaring one, system-less registry keeps answering for
        // every system: it *is* the only vocabulary in the build.
        if (Object.keys(perSystem).length) return perSystem[system]?.[type];
    } else if (config.itemTypesBySeveralSystems.has(type)) {
        throw new Error(
            `More than one declared registry defines the item type "${type}", so ` +
                `the ${what} of a "${type}" depends on which system is asking. ` +
                `Name the system at the call site, or stop declaring the type ` +
                `twice.`,
        );
    }
    return /** @type {Record<string, unknown>} */ (config[table])[type];
}

/**
 * The builder the consuming repository registered for an item type.
 *
 * Unreachable through the compiler — its whitelist *is* this registry's keys —
 * so a throw here means a caller invented a type. It names the type rather than
 * failing as an anonymous `is not a function` (#1504).
 *
 * @param {string} type - The note's `type` frontmatter.
 * @param {string} [system] - The system compiling it, where a build declares
 *   more than one registry. Omitted, a type only one registry declares still
 *   resolves; a contested one throws rather than picking a side.
 * @returns {(fm: object) => object} The builder for that type.
 * @throws {Error} When the configuration registers no builder for `type`.
 */
export function itemBuilder(type, system) {
    const builder = /** @type {Function|undefined} */ (
        lookup("builder", "itemBuilders", type, system)
    );
    if (typeof builder !== "function") {
        throw new Error(
            `No builder registered for item type "${type}" — add one to the ` +
                `\`itemBuilders\` registry this repository declares in ` +
                `package-build.config.yaml, or stop declaring the type.`,
        );
    }
    return /** @type {(fm: object) => object} */ (builder);
}

/**
 * The frontmatter fields a type's registry entry declares, if any.
 *
 * Sparse by design: a type whose entry declares none compiles normally and is
 * simply undocumented (#22). What reads it is the `system`-block passthrough,
 * which has to know which paths a declared field already writes before it
 * writes the rest (#58).
 *
 * @param {string} type - The item type.
 * @param {string} [system] - The system compiling it, where a build declares
 *   more than one registry.
 * @returns {readonly object[]|undefined} The declaration, or `undefined`.
 */
export function itemFields(type, system) {
    return /** @type {readonly object[]|undefined} */ (
        lookup("field declaration", "itemFields", type, system)
    );
}

/**
 * The default art for an item type — the image a note of that type is given
 * when it carries no `img:` of its own.
 *
 * Read from the consuming repository's `itemBuilders` registry, the same place
 * the type itself is declared, so a consumer's own type can bring art a
 * SoHL-owned table could never hold. Art used to be looked up in
 * `sohl/default-item-art.mjs` instead: a type was configurable while its
 * default art was not, so a second consumer's items compiled only if every one
 * of its notes set `img:` (#7).
 *
 * **Still fail-fast.** A type with neither a note-level `img:` nor paired art
 * aborts the pack build rather than shipping a mismatched icon — the contract
 * `defaultItemArt` was written for. Only the error's *owner* changed: it now
 * names the registry the consumer declares and can add to.
 *
 * **Resolved by the same rule a note's `img:` is.** The path goes through
 * {@link resolveImg}, so `icons/relic.svg` means the consumer's own asset root
 * in the registry exactly as it does on a note, and an already-served path
 * (`systems/sohl/assets/…`, as every SoHL default is) passes through untouched.
 * One spelling, one meaning, wherever it is written.
 *
 * @param {string} type - the item type.
 * @param {string} [system] - The system compiling it, where a build declares
 *   more than one registry.
 * @returns {string} The default image path for that type.
 * @throws {Error} When the type's registry entry pairs no `img`.
 */
export function itemArt(type, system) {
    const art = /** @type {string|undefined} */ (lookup("default art", "itemArt", type, system));
    if (!art) {
        throw new Error(
            `No default art for item type "${type}" — the note carries no ` +
                `\`img:\`, and the \`itemBuilders\` entry for "${type}" in this ` +
                `repository's package-build.config.yaml pairs none with its ` +
                `builder. Write the entry as ` +
                `\`${type}: { system: <builder>, img: "<path>" }\`, or give the ` +
                `note an \`img:\` of its own.`,
        );
    }
    return resolveImg(art);
}
