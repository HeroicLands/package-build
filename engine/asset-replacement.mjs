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
 * A declared replacement package's asset record, picked over the local one,
 * by address.
 *
 * A package may declare, on a `relationships.<kind>[]` entry, that a
 * dependency's asset tree answers its own asset addresses —
 * `assetReplacement: true` in `package-build.config.yaml`:
 *
 * ```yaml
 * relationships:
 *     requires:
 *         - id: thalornaaltart
 *           manifest: https://…/releases/latest/download/module.json
 *           assetReplacement: true
 *           contentIndex: true
 * ```
 *
 * `assetReplacement: true` opts that relationship in. `resolveAssetReplacement`
 * is what turns the declaration into an answer, one address at a time, against
 * four rules:
 *
 * 1. **Scoped to asset types.** A non-asset address, or one whose package
 *    segment is not the compiling package's own, resolves to `null` at once —
 *    tested with {@link module:engine/asset-types.isAssetType} rather than
 *    reimplemented. A being, an item or a lore note is never replaced this
 *    way.
 * 2. **Ordered, single pass.** Replacements are tried in declaration order —
 *    the order their relationships appear in `package-build.config.yaml` —
 *    and the first one carrying the address wins.
 * 3. **Never recursive.** A replacement's own output address is not itself
 *    looked up against another replacement: resolving
 *    `thalornaaltart-none-image-thorn` never asks whether something replaces
 *    `thalornaaltart`. This forecloses a cycle by construction — there is
 *    nothing to loop.
 * 4. **A miss falls through.** `null` means no declared replacement carries
 *    the address, and the caller falls back to the local address exactly as
 *    it does today. This function never decides that a missing replacement is
 *    an error; a caller that wants that is free to build it on the answer.
 *
 * This resolver answers a different question from
 * {@link module:engine/asset-bindings.checkForeignAssetBindings}: that check
 * validates an art module's own staged files against another package's
 * addresses, at that module's own build time. This one runs at the *replaced*
 * package's build, consulted by its book, and asks whether a declared
 * replacement carries an address this package would otherwise answer itself.
 *
 * @module
 */

import { isAssetType } from "./asset-types.mjs";
import { canonicalKey, readCanonicalKey } from "./content-address.mjs";

/**
 * The replacement record for one asset address, or `null`.
 *
 * @param {string} address - A canonical asset address.
 * @param {object} opts
 * @param {string} opts.localPackage - The compiling package's own segment.
 * @param {readonly string[]} opts.replacements - The package segments of
 *   every relationship declaring `assetReplacement: true`, in declaration
 *   order.
 * @param {Map<string, object>} opts.index - The merged content index, keyed
 *   by canonical address.
 * @returns {{record: object, package: string}|null} The first replacement
 *   carrying the address, or `null` when none does.
 */
export function resolveAssetReplacement(address, { localPackage, replacements, index }) {
    const parts = readCanonicalKey(address);
    if (!parts) return null;
    if (!isAssetType(parts.type)) return null;
    if (parts.package !== localPackage) return null;
    for (const replacementPackage of replacements ?? []) {
        const key = canonicalKey(replacementPackage, parts.system, parts.type, parts.shortcode);
        const record = index?.get(key);
        if (record?.asset?.path && record.package) {
            return { record, package: replacementPackage };
        }
    }
    return null;
}
