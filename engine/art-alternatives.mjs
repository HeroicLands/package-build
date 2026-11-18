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

import { MISSING_ALTERNATIVE } from "./art-provenance-core.mjs";
import { readCanonicalKey, renderAddress } from "./address.mjs";
import { artSource, hasMasterSource } from "./art-source.mjs";
import {
    DEPLOYED_ASSET_TYPES,
    deployedAssetPath,
    exclusionReason,
    shipsAsset,
} from "./asset-shipping.mjs";
import { METADATA_RELATIONSHIP_KINDS, metadataRelationships } from "./metadata-index.mjs";
import { packageAddresses, resolvePathname } from "./pathnames.mjs";

const ALTERNATIVE_TYPES = new Set(DEPLOYED_ASSET_TYPES.map((entry) => entry.type));

/**
 * Local and required packages whose asset indexes this build declares as inputs.
 * @param {object} config Resolved build configuration.
 * @returns {Set<string>} Own package and required content dependencies.
 */
export function alternativePackages(config) {
    const ids = new Set(
        metadataRelationships(config)
            .filter((entry) => METADATA_RELATIONSHIP_KINDS.includes(entry.kind))
            .map((entry) => entry.id),
    );
    return new Set([
        config.contentPackage,
        ...[...packageAddresses(config)]
            .filter(([, entry]) => ids.has(entry.id))
            .map(([name]) => name),
    ]);
}

/**
 * Validate the declared replacement against the existing asset index and shipping rules.
 * @param {object} record Asset record declaring an alternative.
 * @param {Map<string, object>} index Own and dependency asset records by canonical Address.
 * @param {object} config Resolved build configuration.
 * @returns {string} An author remedy, or an empty string for an eligible target.
 */
export function alternativeProblem(record, index, config) {
    const written = record.asset?.nonAiAlternative;
    const address = readCanonicalKey(record.address?.canonical);
    const targetAddress = readCanonicalKey(written);
    const remedy =
        "declare nonAiAlternative on the master with the Address of a different, explicitly non-AI image or icon licensed to ship in Foundry";
    if (written == null) return MISSING_ALTERNATIVE;
    if (
        !targetAddress ||
        targetAddress.system !== "none" ||
        !ALTERNATIVE_TYPES.has(targetAddress.type)
    )
        return `nonAiAlternative is missing or is not an image or icon Address; ${remedy}`;
    const key = renderAddress(targetAddress);
    if (address && key === renderAddress(address))
        return `nonAiAlternative ${key} names the master itself; ${remedy}`;
    if (!alternativePackages(config).has(targetAddress.package))
        return `nonAiAlternative ${key} names an undeclared or optional package; declare a required content dependency under systems or requires, or choose an asset in this package`;
    const target = index.get(key);
    if (!target?.asset)
        return `nonAiAlternative ${key} does not resolve to an asset; supply its indexed image or icon or correct the master's address`;
    if (
        target.package !== targetAddress.package ||
        target.type !== targetAddress.type ||
        deployedAssetPath(target) === undefined
    )
        return `nonAiAlternative ${key} is not a deployable image or icon; ${remedy}`;
    if (target.asset.ai !== false)
        return `nonAiAlternative ${key} is not explicitly non-AI; ${remedy}`;
    const additions =
        target.package === config.contentPackage ?
            (config.packageBuild?.shippingLicenses ?? [])
        :   [];
    if (!shipsAsset(target, additions))
        return `nonAiAlternative ${key} cannot ship because ${exclusionReason(target, additions)}; ${remedy}`;
    // A documentation-only producer has no own Foundry install. Its image paths
    // are still validated above; foreign targets must have an installed owner.
    if (
        target.package !== config.contentPackage &&
        !resolvePathname(`${target.package}/assets/${target.asset.path}`, config)?.foundry
    )
        return `nonAiAlternative ${key} has no Foundry path; declare its installed package relationship or choose an asset in this package`;
    return "";
}

/**
 * Check master alternatives after own records and dependency indexes are available.
 * Missing alternatives on ordinary sidecar assets are outside the master contract.
 * @param {object[]} records Own index records.
 * @param {{config: object, foreignIndex: () => Map<string, object>, assetsBase: string}} options Resolution context.
 * @returns {object[]} Located findings, without changing any record.
 */
export function checkArtAlternatives(records, { config, foreignIndex, assetsBase }) {
    const sources = records.filter(
        (record) =>
            record.asset?.nonAiAlternative != null ||
            (record.asset?.ai === true && hasMasterSource(record)),
    );
    if (!sources.length) return [];
    const index = new Map();
    for (const record of records) {
        const address = readCanonicalKey(record.address?.canonical);
        if (address) index.set(renderAddress(address), record);
    }
    if (
        sources.some((record) => {
            const address = readCanonicalKey(record.asset.nonAiAlternative);
            return address && address.package !== config.contentPackage;
        })
    )
        for (const [key, record] of foreignIndex()) if (!index.has(key)) index.set(key, record);
    return sources.flatMap((record) => {
        const message = alternativeProblem(record, index, config);
        return message ? [{ file: artSource(record, assetsBase), severity: "error", message }] : [];
    });
}
