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
 * Default item artwork, keyed by item `type` — the single source of truth for
 * both the compendium builder (the items pack compiler, at build time) and the
 * runtime `SohlItem.getDefaultArtwork` override (fresh, ad-hoc-created items).
 *
 * Foundry's `Item.DEFAULT_ICON` is the white `icons/svg/item-bag.svg`, which is
 * invisible on the light Manuscript sheet and does not adapt to theme; every
 * SoHL item type instead defaults to a themed `sohl/assets/icons/**`
 * SVG here (dark ink in light mode, cream in dark, via the build-time
 * adaptive-fill injection in `utils/svg-theme.mjs`).
 *
 * This module is deliberately **plain ESM** — no TypeScript, no `@src` aliases,
 * no Foundry — precisely so the plain-`node` pack scripts *and* the bundled TS
 * runtime can both import it. A `.ts` module could not be required by the build
 * scripts (they run under bare `node`, without the bundler that resolves the
 * `@src` alias and strips types). Keeping one map here is what prevents the
 * build-time and runtime defaults from drifting apart (which is exactly
 * that drift: the builder had a default, runtime did not).
 *
 * It lives in this package rather than in the system's `src/` tree because the
 * pack pipeline is installed as a dependency: a relative path out of
 * the package would resolve to garbage once the pipeline runs from
 * `node_modules`. The runtime imports it back through the package's
 * `./sohl/default-item-art` entry point, so there is still exactly one map.
 * Injecting the map through configuration instead would re-open that drift,
 * because the two sides would once more be free to disagree.
 *
 * **Values are the deployed form of the file's path**, `sohl/icons/<basename>`:
 * the owning package's name, then the flat location a staged package serves its
 * icons from. A runtime prefixes `systems/` and has a Foundry address.
 * {@link defaultItemArt} returns the same file as an authored pathname,
 * `sohl/assets/icons/<basename>`, which is what the build resolves through
 * `resolveImg`. If a new item type is added, add its default here.
 *
 * **The keys are SoHL *document* subtypes, not markdown note types.** The
 * runtime reads this with `itemData.type`, which is a Foundry Item subtype, and
 * that is the vocabulary a compendium document carries. The two vocabularies
 * are the same string but for three note types (`armor` and its two siblings,
 * whose document subtypes are `armorgear` and its siblings), and this map stays
 * on the document side because that is the side the runtime cannot translate: `sohl/item-builders.mjs`
 * asks SoHL's own note-type → subtype map before it looks art up here, so the
 * build translates once and no second copy of those three rows exists.
 */
export const DEFAULT_ITEM_ART = {
    affiliation: "sohl/icons/shieldnn.svg",
    affliction: "sohl/icons/sick.svg",
    armorgear: "sohl/icons/breastplate.svg",
    attribute: "sohl/icons/charm.svg",
    concoctiongear: "sohl/icons/flask.svg",
    containergear: "sohl/icons/sack.svg",
    miscgear: "sohl/icons/questionmark.svg",
    mystery: "sohl/icons/sparkles.svg",
    mysticalability: "sohl/icons/handsparkles.svg",
    projectilegear: "sohl/icons/arrow.svg",
    skill: "sohl/icons/headgear.svg",
    trauma: "sohl/icons/injury.svg",
    weapongear: "sohl/icons/sword.svg",
};

/**
 * The default art path for an item **document subtype**, or throw when it is
 * unknown —
 * the build's fail-fast contract, so an unrecognized type is never silently
 * defaulted (aborting the pack build rather than shipping a mismatched icon).
 *
 * Runtime callers that must tolerate unknown or `base`-typed items should read
 * {@link DEFAULT_ITEM_ART} directly and fall back to Foundry's default instead
 * of calling this — see `SohlItem.getDefaultArtwork`.
 *
 * @param {string} type - The SoHL Item document subtype — `armorgear`, not the
 *   `armor` note type that compiles into one.
 * @returns {string} the default image as an authored pathname,
 *   `sohl/assets/icons/<basename>`.
 */
export function defaultItemArt(type) {
    if (!(type in DEFAULT_ITEM_ART)) {
        throw new Error(
            `No default art for item type "${type}" — add one to @heroiclands/package-build/sohl/default-item-art`,
        );
    }
    // The map's inferred type has no index signature — deliberately, so callers
    // reading it directly get the precise key set. The `in` guard above has
    // already proved this key is present.
    const deployed = /** @type {Record<string, string>} */ (DEFAULT_ITEM_ART)[type];
    return deployed.replace("/icons/", "/assets/icons/");
}
