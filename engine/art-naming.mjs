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
 * The images one note names, as Addresses.
 *
 * A note names an image in three places: an art slot under `data:`, an embed
 * (`![[address|label]]`) and a body image whose pathname is its own package's.
 * The content index records the result on the note's record as `namedImages`,
 * so a consumer asking which notes name an image reads the index and never the
 * note files.
 *
 * @module engine/art-naming
 */

import { artTarget, ART_SLOTS } from "./art-fields.mjs";
import { isAddressTuple, renderAddress } from "./address.mjs";
import {
    ASSET_SYSTEM,
    ASSET_TYPE_NAMES,
    DEPLOYED_ASSET_TYPES,
    isAssetType,
} from "./asset-types.mjs";
import { EMBED_DEFAULT_TYPE, embedsIn } from "./content-embeds.mjs";
import { imagesIn } from "./content-images.mjs";
import { resolvePathname } from "./pathnames.mjs";

/**
 * The canonical Addresses of the package's own images a note names.
 *
 * A reference naming another package, or one that does not parse as an
 * Address, is not returned. A body image names a file by pathname, so it is
 * mapped to its Address through the package's asset records.
 *
 * @param {object} input
 * @param {Record<string, any>} input.frontmatter - The note's frontmatter as authored.
 * @param {string} [input.body] - The note's markdown body.
 * @param {string} input.contentPackage - The content package.
 * @param {readonly Record<string, any>[]} [input.assetRecords] - The package's
 *   asset records, from {@link module:engine/asset-index.collectAssetRecords}.
 * @returns {string[]} Distinct canonical Addresses, sorted.
 */
export function namedImages({ frontmatter, body, contentPackage, assetRecords = [] }) {
    const vocabulary = {
        system: ASSET_SYSTEM,
        package: contentPackage,
        types: ASSET_TYPE_NAMES,
        packages: new Set([contentPackage]),
    };
    const own = (value, defaultType, accepts) => {
        if (isAddressTuple(value)) {
            return value.package === contentPackage && isAssetType(value.type) ?
                    renderAddress(value)
                :   undefined;
        }
        const tuple = artTarget(value, defaultType, accepts, vocabulary);
        if (tuple.reason || tuple.package !== contentPackage || !isAssetType(tuple.type)) {
            return undefined;
        }
        return renderAddress(tuple);
    };
    const byPath = new Map(
        assetRecords
            .filter((record) => record.asset?.path && record.address?.canonical)
            .map((record) => [record.asset.path, record.address.canonical]),
    );
    const found = new Set();
    for (const slot of ART_SLOTS) {
        const value = frontmatter?.data?.[slot.key];
        if (!value || value === slot.declines) continue;
        if (typeof value !== "string" && !isAddressTuple(value)) continue;
        const address = own(value, slot.type, slot.accepts);
        if (address) found.add(address);
    }
    const text = body ?? "";
    for (const embed of embedsIn(text)) {
        const address = own(embed.written, EMBED_DEFAULT_TYPE, undefined);
        if (address) found.add(address);
    }
    for (const image of imagesIn(text)) {
        let forms;
        try {
            forms = resolvePathname(image.src, { contentPackage });
        } catch {
            continue;
        }
        if (forms?.state !== "package" || forms.package !== contentPackage) continue;
        const root = forms.suffix.split("/")[0];
        if (!DEPLOYED_ASSET_TYPES.some((type) => type.root === root)) continue;
        const canonical = byPath.get(forms.suffix);
        if (canonical) {
            found.add(isAddressTuple(canonical) ? renderAddress(canonical) : String(canonical));
        }
    }
    return [...found].sort();
}
