/* SPDX-License-Identifier: GPL-3.0-or-later */

import fs from "node:fs";
import path from "node:path";

import { isAddressSegment } from "./address-charset.mjs";
import { canonicalKey } from "./content-address.mjs";
import { loadForeignIndexes, metadataRelationships } from "./metadata-index.mjs";

/** Files under a configured staging root, without provenance sidecars. */
function assetFiles(root) {
    if (!fs.existsSync(root)) return [];
    const files = [];
    const visit = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) visit(file);
            else if (entry.isFile() && !entry.name.endsWith(".yaml")) files.push(file);
        }
    };
    visit(root);
    return files;
}

/** Check configured foreign Address bindings against fetched indexes. */
export function checkForeignAssetBindings(config, { foreignIndex, assets } = {}) {
    const copies = (assets ?? config.packageBuild?.assets ?? []).filter((asset) => asset.bindsTo);
    if (!copies.length) return [];
    const relationships = metadataRelationships(config);
    const active = copies.filter(({ bindsTo }) =>
        relationships.some((rel) => rel.id === bindsTo.package),
    );
    if (!active.length) return [];
    const fetched = foreignIndex ? null : loadForeignIndexes(config, [config.contentPackage]);
    const foreign = foreignIndex ?? fetched.index;
    for (const { bindsTo } of active) {
        if (fetched && !fetched.packages.has(bindsTo.package))
            return [
                {
                    file: "package-build.config.yaml",
                    severity: "error",
                    message: `asset binding index for ${bindsTo.package} is unavailable; run package-build deps fetch`,
                },
            ];
    }
    const findings = [];
    for (const { from, bindsTo } of active) {
        const root = path.resolve(config.rootDir, from);
        if (path.relative(config.rootDir, root).startsWith(".."))
            throw new Error(`packageBuild.assets source ${from} escapes the repository`);
        for (const file of assetFiles(root)) {
            const shortcode = path.parse(file).name;
            const key =
                isAddressSegment(shortcode) ?
                    canonicalKey(bindsTo.package, bindsTo.system ?? "note", bindsTo.type, shortcode)
                :   null;
            if (!key || !foreign.has(key))
                findings.push({
                    file: path.relative(config.rootDir, file),
                    severity: "error",
                    message: `asset binding ${key ?? JSON.stringify(shortcode)} resolves to no ${bindsTo.type} in ${bindsTo.package}`,
                });
        }
    }
    return findings;
}
