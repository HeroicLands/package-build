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
 * The **deployed layout** of a package's pictures, and which of them ship.
 *
 * A repository keeps `assets/icons/` and `assets/images/` arranged however its
 * authors like. A Foundry package, the CDN and every location a GM fills hold
 * them flat instead:
 *
 * ```text
 * icons/<basename>
 * images/<basename>
 * ```
 *
 * The root is the type and the basename is the shortcode with its extension,
 * so the deployed path follows from the address alone. A root's shortcodes are
 * one flat namespace however deeply its source nests — two files sharing one
 * are already a finding in {@link module:engine/asset-index} — so flattening
 * never collides. Audio is not part of this layout.
 *
 * **What ships.** The stage copies a picture into the package only when its
 * resolved provenance record says `ai: false` and its `license` is on
 * {@link SHIPPING_LICENSES}. Everything else stays in the repository. The
 * selection is {@link selectStagedAssets}, one function, so the stage and any
 * command that publishes what the stage leaves out read the same answer.
 *
 * **An asset set** is a JSON file listing the pictures one location holds:
 *
 * ```json
 * {
 *     "name": "Thalorna — shipped art",
 *     "package": "thalorna",
 *     "assets": [
 *         { "address": "thalorna-none-image-thorn", "source": "../images/thorn.webp",
 *           "target": "images/thorn.webp", "size": 48213 }
 *     ]
 * }
 * ```
 *
 * `name` is the set's display name and `package` the content package its
 * addresses belong to — the address's first segment, not the Foundry id. Each
 * entry in `assets`:
 *
 * - `target` is the file's path relative to the location's root, in the
 *   deployed layout, extension included.
 * - `source` is where the file can be fetched from, resolved against the URL of
 *   the set file holding it — `new URL(source, setUrl)`.
 * - `size` is in bytes.
 *
 * The staged package's own set is always `asset-sets/default.json`, a fixed
 * name, and names itself after the package's manifest title with
 * ` — shipped art` appended. Its files sit one folder up from it, so each
 * `source` is `../<target>`.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { collectAssetRecords } from "./asset-index.mjs";
import { canonicalKey } from "./content-address.mjs";
import { ASSET_SYSTEM, DEPLOYED_ASSET_TYPES, deployedSuffix } from "./asset-types.mjs";

export { DEPLOYED_ASSET_TYPES, deployedSuffix } from "./asset-types.mjs";

/**
 * The licences a shipped picture may carry, as its provenance `license` spells
 * them.
 *
 * A package adds to this list with `packageBuild.shippingLicenses`; the list a
 * package ships under is this one together with its additions.
 *
 * `LicenseRef-PublicDomain` is the spelling for a work in the public domain,
 * which SPDX gives no identifier of its own. `CC0` is accepted beside
 * `CC0-1.0` because both spellings name the one dedication. Nothing is
 * normalised: a value off this list is excluded, however close it reads.
 *
 * @type {readonly string[]}
 */
export const SHIPPING_LICENSES = Object.freeze([
    "LicenseRef-PublicDomain",
    "CC0-1.0",
    "CC0",
    "CC-BY-3.0",
    "CC-BY-4.0",
    "CC-BY-SA-4.0",
    "LicenseRef-NounProject-Pro",
]);

/**
 * The staged package's own asset set, relative to the package root — the set
 * listing the pictures it ships.
 *
 * @type {string}
 */
export const SHIPPED_SET_FILE = "asset-sets/default.json";

/**
 * The shortcode a package's stand-in picture carries under each deployed root.
 *
 * @type {string}
 */
export const STAND_IN_SHORTCODE = "missing";

/**
 * The deployed path of one asset record, or `undefined` for a record of a type
 * that does not deploy flat.
 *
 * @param {{type?: string, asset?: {path?: string}}} record - An asset record.
 * @returns {string|undefined} `<icons|images>/<basename>`.
 */
export function deployedAssetPath(record) {
    const source = record?.asset?.path;
    if (!source) return undefined;
    const type = DEPLOYED_ASSET_TYPES.find((entry) => entry.type === record.type);
    if (!type) return undefined;
    const deployed = deployedSuffix(source);
    return deployed.startsWith(`${type.root}/`) ? deployed : undefined;
}

/**
 * Why one asset record does not ship, or `""` when it does.
 *
 * @param {{asset?: {ai?: unknown, license?: unknown}}} record - An asset record.
 * @param {readonly string[]} [additions] - Licences the package adds to
 *   {@link SHIPPING_LICENSES}, from `packageBuild.shippingLicenses`.
 * @returns {string} The reason, as a clause, or `""`.
 */
export function exclusionReason(record, additions = []) {
    const ai = record?.asset?.ai;
    if (ai === true) return "it is machine-generated (`ai: true`)";
    if (ai !== false) return "its provenance does not state `ai`";
    const license = record?.asset?.license;
    if (
        !SHIPPING_LICENSES.includes(/** @type {string} */ (license)) &&
        !additions.includes(/** @type {string} */ (license))
    ) {
        return license ?
                `its licence \`${license}\` is not one a package ships`
            :   "its provenance states no licence";
    }
    return "";
}

/**
 * Whether one asset record ships in the Foundry package.
 *
 * @param {object} record - An asset record.
 * @param {readonly string[]} [additions] - The package's added licences.
 * @returns {boolean} True for a deployed type with `ai: false` and a licence on
 *   {@link SHIPPING_LICENSES} or in `additions`.
 */
export function shipsAsset(record, additions = []) {
    return deployedAssetPath(record) !== undefined && exclusionReason(record, additions) === "";
}

/**
 * The canonical address of a package's stand-in for one asset type.
 *
 * @param {string} pkg - The content package.
 * @param {string} type - `icon` or `image`.
 * @returns {string} `<package>-none-<type>-missing`.
 */
export function standInAddress(pkg, type) {
    return canonicalKey(pkg, ASSET_SYSTEM, type, STAND_IN_SHORTCODE);
}

/**
 * Split a package's picture records into those the stage ships and those it
 * leaves out.
 *
 * Audio and every other record are in neither list.
 *
 * @param {readonly object[]} records - Asset records, in any order.
 * @param {readonly string[]} [additions] - The package's added licences.
 * @returns {{staged: object[], excluded: {record: object, reason: string}[]}}
 *   Both in address order.
 */
export function selectStagedAssets(records, additions = []) {
    const pictures = records
        .filter((record) => deployedAssetPath(record) !== undefined)
        .sort((a, b) => (a.address.canonical < b.address.canonical ? -1 : 1));
    const staged = [];
    const excluded = [];
    for (const record of pictures) {
        const reason = exclusionReason(record, additions);
        if (reason) excluded.push({ record, reason });
        else staged.push(record);
    }
    return { staged, excluded };
}

/**
 * One asset-set entry.
 *
 * @typedef {object} AssetsManifestEntry
 * @property {string} address - The canonical address.
 * @property {string} source - Where the file is fetched from, resolved against
 *   the URL of the set file holding it.
 * @property {string} target - Its path relative to the location's root, in the
 *   deployed layout.
 * @property {number} size - Its size in bytes.
 */

/**
 * An asset set: a display name, the package its addresses belong to, and one
 * entry per file.
 *
 * @typedef {object} AssetSet
 * @property {string} name - The set's display name.
 * @property {string} package - The content package.
 * @property {AssetsManifestEntry[]} assets - The files, in target order.
 */

/**
 * The display name of a staged package's own asset set.
 *
 * @param {string} title - The package's manifest title.
 * @returns {string} `<title> — shipped art`.
 */
export function shippedSetName(title) {
    return `${title} — shipped art`;
}

/**
 * The asset-set entries for a set of staged files, as the staged package's own
 * set lists them.
 *
 * The set sits in `asset-sets/` under the package root, so each `source` is
 * `../<target>`.
 *
 * @param {readonly object[]} staged - The records staged.
 * @param {string} stageDir - The staged package root, where each file's size
 *   is measured — after any transform, since that is the file a location holds.
 * @returns {AssetsManifestEntry[]} In target order.
 */
export function assetsManifest(staged, stageDir) {
    return staged
        .map((record) => {
            const target = /** @type {string} */ (deployedAssetPath(record));
            return {
                address: record.address.canonical,
                source: path.posix.relative(path.posix.dirname(SHIPPED_SET_FILE), target),
                target,
                size: fs.statSync(path.join(stageDir, ...target.split("/"))).size,
            };
        })
        .sort((a, b) => (a.target < b.target ? -1 : 1));
}

/**
 * Stage a package's shipped pictures flat at the package root, and write the
 * package's own asset set, `asset-sets/default.json`.
 *
 * The records are read by {@link module:engine/asset-index.collectAssetRecords},
 * so provenance resolves exactly as the content index resolves it — per file,
 * a sidecar replacing an inherited record. Any finding that walk makes stops the
 * stage before a file is copied: a package whose provenance cannot be read is
 * not one whose shipping can be decided.
 *
 * @param {object} opts - Options.
 * @param {string} opts.assetsBase - The package's asset directory, the roots'
 *   parent.
 * @param {string} opts.contentPackage - The package the trees belong to.
 * @param {string} opts.stageDir - The staged package root.
 * @param {string} opts.title - The package's manifest title, which names the
 *   set.
 * @param {(sourcePath: string) => string|null|undefined} [opts.transform] -
 *   The repository's per-file transform.
 * @param {readonly string[]} [opts.shippingLicenses] - Licences the package
 *   adds to {@link SHIPPING_LICENSES}.
 * @returns {{staged: object[], excluded: {record: object, reason: string}[],
 *   findings: object[], manifest: AssetSet|null}}
 *   What was staged and left out, and the findings that stopped the stage —
 *   nothing is staged when `findings` is non-empty. A package with neither
 *   picture root stages nothing and writes no asset set.
 */
export function stagePackageAssets({
    assetsBase,
    contentPackage,
    stageDir,
    title,
    transform,
    shippingLicenses = [],
}) {
    const findings = [];
    const hasPictures = DEPLOYED_ASSET_TYPES.some(({ root }) =>
        fs.existsSync(path.join(assetsBase, root)),
    );
    if (!hasPictures) return { staged: [], excluded: [], findings, manifest: null };
    const records = collectAssetRecords(assetsBase, { contentPackage, problems: findings });
    if (findings.length) return { staged: [], excluded: [], findings, manifest: null };

    const { staged, excluded } = selectStagedAssets(records, shippingLicenses);
    for (const { root } of DEPLOYED_ASSET_TYPES) {
        fs.rmSync(path.join(stageDir, root), { recursive: true, force: true });
    }
    for (const record of staged) {
        const from = path.join(assetsBase, ...record.asset.path.split("/"));
        const to = path.join(
            stageDir,
            .../** @type {string} */ (deployedAssetPath(record)).split("/"),
        );
        fs.mkdirSync(path.dirname(to), { recursive: true });
        const transformed = transform ? transform(from) : null;
        if (transformed != null) fs.writeFileSync(to, transformed);
        else fs.copyFileSync(from, to);
    }
    const manifest = {
        name: shippedSetName(title),
        package: contentPackage,
        assets: assetsManifest(staged, stageDir),
    };
    const setFile = path.join(stageDir, ...SHIPPED_SET_FILE.split("/"));
    fs.mkdirSync(path.dirname(setFile), { recursive: true });
    fs.writeFileSync(setFile, `${JSON.stringify(manifest, null, 4)}\n`);
    return { staged, excluded, findings, manifest };
}

/**
 * The `packageBuild.assets` rows that would stage a picture root themselves.
 *
 * The stage copies `icons/` and `images/` itself, filtered; a row copying
 * either root, a directory inside one, or a directory holding one would put
 * every file back unfiltered, so each is refused.
 *
 * @param {readonly {from: string, to: string}[]} rows - The configured rows.
 * @param {object} opts - Options.
 * @param {string} opts.rootDir - The repository root rows resolve against.
 * @param {string} opts.assetsBase - The package's asset directory.
 * @returns {{index: number, from: string, root: string}[]} One per offending
 *   row, naming the root it reaches.
 */
export function rowsStagingPictureRoots(rows, { rootDir, assetsBase }) {
    const out = [];
    rows.forEach(({ from }, index) => {
        const source = path.resolve(rootDir, from);
        for (const { root } of DEPLOYED_ASSET_TYPES) {
            const rootPath = path.resolve(assetsBase, root);
            const inside = (child, parent) => {
                const rel = path.relative(parent, child);
                return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
            };
            if (inside(source, rootPath) || inside(rootPath, source)) {
                out.push({ index, from, root: path.relative(rootDir, rootPath) });
                break;
            }
        }
    });
    return out;
}
