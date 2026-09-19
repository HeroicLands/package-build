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
 * The toolchain's own content index — the files it ships, addressed.
 *
 * package-build ships a set of images, section banners chiefly, that many
 * packages draw on. `packagebuild-none-image-<shortcode>` lets a note reach one
 * without declaring a dependency on some parent system or module it otherwise
 * has no relationship with, which is the whole point: the alternative is every
 * package depending on one of the others just to borrow a banner.
 *
 * **Every other package's index is fetched; this one is read from disk.**
 * package-build is an npm dependency of every consumer rather than a Foundry
 * package, so there is no release archive to fetch and no reason to fetch one —
 * `node_modules/@heroiclands/package-build/assets/` is already there. That is
 * the one difference, and it is entirely about *acquisition*: the records join
 * `foreign.index` like any other package's, so every lookup stays one path.
 *
 * **A cold cache is not a failure mode here**, and the walk is why. The records
 * are derived from the shipped tree each time they are asked for rather than
 * read back from a file, so an installed copy and a git checkout answer alike
 * and nothing can be half-fetched. {@link emitPackageBuildIndex} publishes the
 * same walk as a file for the readers that are not this process — the website,
 * the book, the Foundry runtime — and a guard holds the two together.
 *
 * **These addresses have no Foundry form, by construction.** Foundry installs
 * no package for this one, so `packageAddresses` has no entry and
 * `resolvePathname` yields `null` rather than deriving
 * `modules/packagebuild/assets/…`, which installs nowhere. The only slot that
 * names them is `banner`, which reaches no compiled document at all.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectAssetRecords } from "./asset-index.mjs";
import { recordPath, sortKeysDeep } from "./index-records.mjs";
import { PACKAGEBUILD_PACKAGE, metadataFileName } from "./packages.mjs";

/**
 * This package's own root, wherever it is installed.
 *
 * Derived from this module's location rather than from a configuration: the
 * files being indexed sit beside it in the same tarball, so the one reliable
 * answer is "up from here". A consuming repository's `rootDir` names its own
 * tree and says nothing about where its dependencies live.
 *
 * @type {string}
 */
export const PACKAGEBUILD_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * The asset directory this package ships.
 *
 * @type {string}
 */
export const PACKAGEBUILD_ASSETS = path.join(PACKAGEBUILD_ROOT, "assets");

/**
 * Where the published index sits, beside the files it describes.
 *
 * @type {string}
 */
export const PACKAGEBUILD_INDEX_FILE = path.join(
    PACKAGEBUILD_ROOT,
    metadataFileName(PACKAGEBUILD_PACKAGE),
);

/**
 * The index records for the files this package ships.
 *
 * Walked rather than read back, so an installed copy and a git checkout answer
 * alike and there is no state to be stale. The tree is small — a handful of
 * banners — so the walk costs nothing a build would notice.
 *
 * @param {string} [assetsBase] - The asset directory, for a caller testing
 *   against a tree of its own.
 * @returns {Array<Record<string, any>>} One record per addressable file.
 */
export function packageBuildRecords(assetsBase = PACKAGEBUILD_ASSETS) {
    const records = collectAssetRecords(assetsBase, {
        contentPackage: PACKAGEBUILD_PACKAGE,
    }).map((record) => /** @type {Record<string, any>} */ (sortKeysDeep(record)));
    // Ordered and key-sorted like every other index, and for the same reason:
    // directory-read order is a fact about the filesystem, so two runs over an
    // unchanged tree have to produce an identical file.
    records.sort((a, b) => recordPath(a).localeCompare(recordPath(b), "en"));
    return records;
}

/**
 * Publish the index as a file, for the readers that are not this process.
 *
 * The website, the book and the Foundry runtime each read a package's index as
 * JSON Lines; this package's has to be one too, and it ships in the tarball
 * beside the images it describes.
 *
 * @param {object} [options] - Options.
 * @param {string} [options.assetsBase] - The asset directory to walk.
 * @param {string} [options.file] - Where to write it.
 * @returns {{file: string, assets: number, bytes: number}} Where it was
 *   written, how many files it holds, and its size.
 */
export function emitPackageBuildIndex({ assetsBase, file = PACKAGEBUILD_INDEX_FILE } = {}) {
    const records = packageBuildRecords(assetsBase);
    const text = records.length ? `${records.map((r) => JSON.stringify(r)).join("\n")}\n` : "";
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return { file, assets: records.length, bytes: Buffer.byteLength(text) };
}
