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

import fs from "node:fs";
import path from "node:path";

/**
 * Written once a fetch completes, so a half-finished cache is never used.
 *
 * The same sentinel the item catalogue uses, and deliberately the same value:
 * the two caches sit side by side under `build/cache`, and one convention read
 * by both is one thing to know.
 */
const STAMP = ".complete";

/**
 * The relationship kinds that are dependencies, and therefore citable.
 *
 * A package may cite what it depends on and nothing else. `recommends` and
 * `conflicts` are declarations *about* other packages rather than dependencies
 * on them, so an address resolved through one would emit a link into a package
 * the consumer does not require — a defect in the citing note, not a lookup to
 * satisfy.
 *
 * @type {readonly string[]}
 */
export const METADATA_RELATIONSHIP_KINDS = Object.freeze(["systems", "requires"]);

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

/**
 * Every dependency whose published index this build resolves addresses through.
 *
 * **Every declared dependency, not only those supplying an item catalogue.**
 * `itemCatalog: true` says a dependency supplies *items*; citing its
 * *addresses* is a separate edge, and a package may have either without the
 * other. `harn-ensemble` cites no foreign address and carries 324,016 embedded
 * item references (`HeroicLands/harn-ensemble#42`); a package citing addresses
 * and needing no items is the mirror of it. Gating the index on the catalogue
 * flag would serve neither.
 *
 * The declaration is the one already in the emitted `system.json` /
 * `module.json`, so it cannot drift from what Foundry itself installs, and
 * there is no new configuration key to keep in step. Each entry carries the
 * producer's own `manifest` URL, so the fetcher needs no address of its own:
 * it reads that manifest and takes the `flags.metadataUrl` it advertises.
 *
 * @param {object} config - The resolved build configuration.
 * @returns {Array<{id: string, manifest: string, kind: string,
 *   verified: string|undefined}>} The dependencies, in declaration order.
 */
export function metadataRelationships(config) {
    const out = [];
    for (const kind of METADATA_RELATIONSHIP_KINDS) {
        for (const rel of config?.relationships?.[kind] ?? []) {
            out.push({
                id: rel.id,
                manifest: rel.manifest,
                kind,
                verified: rel.compatibility?.verified,
            });
        }
    }
    return out;
}

/**
 * The cache directory for one dependency's index at one version.
 *
 * Keyed by version so that changing the pinned version is a different cache
 * rather than a silent overwrite, and so a second build costs nothing — the
 * same rule the item catalogue's cache follows, for the same reason.
 *
 * @param {object} config - The resolved build configuration.
 * @param {string} id - The dependency's package id.
 * @param {string} version - Its resolved version.
 * @returns {string} The directory.
 */
export function metadataCacheDir(config, id, version) {
    return path.join(config.paths.metadataCache, `${id}@${version}`);
}

/**
 * Whether a dependency's cache is present and complete.
 *
 * @param {string} dir - The dependency's cache directory.
 * @returns {boolean} True when it was fetched to completion.
 */
export const isComplete = (dir) => fs.existsSync(path.join(dir, STAMP));

/**
 * Mark a dependency's cache complete.
 *
 * @param {string} dir - The dependency's cache directory.
 * @returns {void}
 */
export function markComplete(dir) {
    fs.writeFileSync(path.join(dir, STAMP), "");
}

/**
 * The fetched index files this build resolves foreign addresses against.
 *
 * **Reads the cache only.** A cold cache is an error naming the command that
 * fills it, rather than a download nobody asked for: a compile that reaches the
 * network is not reproducible and fails strangely offline. That is the item
 * catalogue's rule, and it holds here for the same reason.
 *
 * A half-finished fetch counts as cold. A partial index resolves some addresses
 * and fails others with nothing to distinguish the two, which is worse than
 * resolving none — the failure would read as a typo in whichever note happened
 * to cite the missing half.
 *
 * @param {object} config - The resolved build configuration.
 * @returns {string[]} One index file per declared dependency.
 * @throws {Error} When a declared dependency has not been fetched.
 */
export function cachedMetadataFiles(config) {
    const files = [];
    const root = config.paths.metadataCache;
    for (const rel of metadataRelationships(config)) {
        const cached =
            fs.existsSync(root) ?
                fs
                    .readdirSync(root)
                    .filter((name) => name.startsWith(`${rel.id}@`))
                    .map((name) => path.join(root, name))
                    .filter(isComplete)
            :   [];
        if (!cached.length) {
            throw new Error(
                `${rel.id} is a declared dependency but its content index has ` +
                    `not been fetched. Run \`content-build deps fetch\` first.`,
            );
        }
        files.push(newestIndex(cached));
    }
    return files;
}

/**
 * The index file of the newest cached version among several.
 *
 * Versions are compared **numerically per segment**, not as strings: a plain
 * sort puts `0.8.10` before `0.8.2`, so a build that had cached both would
 * silently resolve against the older one. A fetch always writes the currently
 * declared version, so several present at once means an earlier pin was left
 * behind rather than that a choice is genuinely open.
 *
 * @param {string[]} dirs - Complete cache directories, named `<id>@<version>`.
 * @returns {string} The newest one's index file.
 */
function newestIndex(dirs) {
    const rank = (dir) =>
        path
            .basename(dir)
            .split("@")
            .slice(1)
            .join("@")
            .split(/[.-]/)
            .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
    const sorted = [...dirs].sort((a, b) => {
        const x = rank(a);
        const y = rank(b);
        for (let i = 0; i < Math.max(x.length, y.length); i++) {
            const p = x[i];
            const q = y[i];
            if (p === q) continue;
            if (p === undefined) return -1;
            if (q === undefined) return 1;
            return typeof p === "number" && typeof q === "number" ?
                    p - q
                :   String(p).localeCompare(String(q));
        }
        return 0;
    });
    const dir = sorted[sorted.length - 1];
    const entries = fs.readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
    if (!entries.length) {
        throw new Error(`${dir} was fetched but holds no index file`);
    }
    return path.join(dir, entries[0]);
}
