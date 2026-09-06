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
 * The published content index — the artifact packages exchange addresses
 * through (#239).
 *
 * **A package publishes its own index; a consumer fetches the ones it depends
 * on.** That is the whole mechanism, and it replaces a vendored link manifest
 * that each repository committed a copy of every other repository's file into.
 * Vendoring failed three ways, and only the last is about staleness:
 *
 * 1. **A copy goes stale silently.** `Song-of-Heroic-Lands-FoundryVTT` carried
 *    2,101 `thalorna` entries whose address was the old name-derived form, so
 *    every cross-package link it rendered pointed at a URL the site had stopped
 *    publishing. The format version gate saw nothing, because the format had
 *    not changed — only the values were wrong.
 * 2. **Mutual vendoring deadlocks.** Both packages vendored each other, so a
 *    format bump stopped both builds until the other had already published:
 *    neither could go first.
 * 3. **It was a second answer to a settled question.** The content index
 *    already carries the canonical key, the name, the anchors, the Foundry
 *    `uuid` and the web address. There was nothing in a manifest entry it did
 *    not hold.
 *
 * A fetched artifact cannot drift from its producer, and a consumer reads one
 * the producer has already shipped — so the cycle has no way to form.
 *
 * @module
 */

/**
 * What a package's content index is called, wherever it is written or fetched.
 *
 * **The local index and the published artifact are one file.** A package emits
 * this, ships it as a release asset, and advertises it as `flags.metadataUrl`;
 * a consumer fetches that same file into its cache and reads it. Naming it in
 * one function is what keeps the emitter, the release and the fetcher from
 * drifting into three spellings of one artifact.
 *
 * The `-metadata` suffix earns its place: a bare `<package>.jsonl` says nothing
 * about what it holds, and these files land in a cache directory beside other
 * packages' artifacts where the name is all a reader has.
 *
 * @param {string} pkg - The content package name.
 * @returns {string} The file name, e.g. `sohl-metadata.jsonl`.
 */
export function metadataFileName(pkg) {
    return `${pkg}-metadata.jsonl`;
}
