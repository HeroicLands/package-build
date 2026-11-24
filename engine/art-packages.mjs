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
 * Picture packages: masters addressed in another package, accepted because
 * this package pins that package's index under `art.packages`.
 *
 * The pinned index is authoritative for every picture's metadata. A master
 * supplies only the pixels the build renders, and a master whose creator,
 * license, AI status or dimensions differ from its indexed row is a finding at
 * the master.
 *
 * @module
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { readCanonicalKey, renderAddress } from "./address.mjs";
import { collectArtMasters } from "./art-masters.mjs";
import { pictureReferences } from "./art-naming.mjs";
import { provenanceAi } from "./art-provenance-core.mjs";
import { positionOfLiteral } from "./diagnostics.mjs";
import { downloadCached } from "./download-cache.mjs";
import {
    artPackageError,
    artPackageIndexFile,
    cachedArtPackageIndexes,
    isComplete,
    markComplete,
} from "./metadata-index.mjs";
import { isPackageRecord } from "./index-records.mjs";
import { decodeIndexAddresses, noteAddressContext } from "./note-addresses.mjs";

/**
 * The picture packages a configuration declares, by name.
 *
 * @param {object} config - The resolved build configuration.
 * @returns {string[]} The package names, in declaration order.
 */
export function artPackageNames(config) {
    return (config?.art?.packages ?? []).map((entry) => entry.package);
}

/** The SHA-256 of a file, as lowercase hex. */
function fileDigest(file) {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * Fill the cache with every index `art.packages` pins.
 *
 * An index already cached with its pinned digest is kept. Otherwise it is
 * downloaded through the shared download cache, which refuses bytes whose
 * SHA-256 is not the pinned one; the failure is located at the entry.
 *
 * @param {object} config - The resolved build configuration.
 * @param {{fetch?: typeof globalThis.fetch, cacheDir?: string}} [options] -
 *   The fetch implementation and the shared download cache directory.
 * @returns {Promise<number>} How many picture-package indexes are cached.
 */
export async function fetchArtPackageIndexes(config, { fetch, cacheDir } = {}) {
    const { MAX_INDEX_BYTES, retryMetadata } = await import("./foreign-catalog.mjs");
    let count = 0;
    for (const [index, entry] of (config?.art?.packages ?? []).entries()) {
        const file = artPackageIndexFile(config, entry);
        const dir = path.dirname(file);
        if (isComplete(dir) && fileDigest(file) === entry.sha256) {
            count += 1;
            continue;
        }
        let downloaded;
        try {
            downloaded = await retryMetadata((signal) =>
                downloadCached(entry.url, entry.sha256, {
                    fetch,
                    cacheDir,
                    signal,
                    maxBytes: MAX_INDEX_BYTES,
                }),
            );
        } catch (cause) {
            throw artPackageError(config, index, cause.message);
        }
        fs.mkdirSync(dir, { recursive: true });
        const temporary = fs.mkdtempSync(path.join(dir, ".metadata-"));
        try {
            const staged = path.join(temporary, "index.jsonl");
            fs.copyFileSync(downloaded, staged);
            if (fileDigest(staged) !== entry.sha256)
                throw artPackageError(
                    config,
                    index,
                    `the downloaded index of \`${entry.package}\` failed verification`,
                );
            fs.renameSync(staged, file);
            markComplete(dir, path.basename(file), entry.sha256);
        } finally {
            fs.rmSync(temporary, { recursive: true, force: true });
        }
        count += 1;
    }
    return count;
}

/**
 * The image and icon rows of each pinned picture-package index, by address.
 *
 * @param {object} config - The resolved build configuration.
 * @returns {Map<string, Map<string, Record<string, any>>>} Rows by rendered
 *   address, per package.
 * @throws {Error} Located at the entry, as {@link cachedArtPackageIndexes}, or
 *   at the cached file and line, when a row's addresses cannot be decoded.
 */
function artPackageRows(config) {
    const out = new Map();
    const context = noteAddressContext(config);
    for (const { id, file, text } of cachedArtPackageIndexes(config)) {
        const rows = new Map();
        text.split("\n").forEach((line, at) => {
            if (!line.trim()) return;
            const parsed = JSON.parse(line);
            if (isPackageRecord(parsed)) return;
            const row = decodeIndexAddresses(parsed, context, { package: id, file, line: at + 1 });
            const tuple = readCanonicalKey(row?.address?.canonical);
            if (
                !tuple ||
                !row.asset ||
                tuple.package !== id ||
                tuple.system !== "none" ||
                !["image", "icon"].includes(tuple.type)
            )
                return;
            rows.set(renderAddress(tuple), row);
        });
        out.set(id, rows);
    }
    return out;
}

/** A value as a finding states it. */
function shown(value) {
    return value === undefined || value === "" ? "nothing" : JSON.stringify(value);
}

/**
 * Bind each picture-package master to its indexed row.
 *
 * Every master marked `dependency` gains `indexed`, the row's creator, license,
 * AI status, alternative and dimensions, which
 * {@link module:engine/art-masters.masterAssetRecords} publishes in place of the
 * master's own. A master absent from its package's index, or one whose
 * creator, license, AI status or dimensions differ from the row, is a finding
 * at the master. A collection with no such master reads no index.
 *
 * @param {ReturnType<typeof collectArtMasters>} collected - Collected masters.
 * @param {object} config - The resolved build configuration.
 * @returns {object[]} Findings.
 * @throws {Error} Located at the `art.packages` entry, when a pinned index is
 *   not cached or does not match its pinned digest.
 */
export function bindDependencyMasters(collected, config) {
    const dependants = [...collected.masters].filter(([, master]) => master.dependency);
    if (!dependants.length) return [];
    const indexes = artPackageRows(config);
    const findings = [];
    for (const [address, master] of dependants) {
        const pkg = readCanonicalKey(address).package;
        const row = indexes.get(pkg)?.get(address);
        if (!row) {
            findings.push({
                file: master.file,
                severity: "error",
                message:
                    `master address ${address} is not an image or icon in the index of ` +
                    `\`${pkg}\` pinned under \`art.packages\``,
            });
            continue;
        }
        const asset = row.asset;
        const compared = [
            ["creator", master.record.creator ?? [], asset.attribution ?? []],
            ["license", master.record.license ?? "", asset.license ?? ""],
            ["AI status", provenanceAi(master.record), asset.ai ?? null],
            ["width", master.dimensions?.width ?? "", asset.width ?? ""],
            ["height", master.dimensions?.height ?? "", asset.height ?? ""],
        ];
        const differences = compared
            .filter(([, local, indexed]) => JSON.stringify(local) !== JSON.stringify(indexed))
            .map(
                ([field, local, indexed]) =>
                    `${field} is ${shown(local)} in the master and ${shown(indexed)} in the index`,
            );
        if (differences.length) {
            findings.push({
                file: master.file,
                severity: "error",
                message:
                    `master ${address} differs from the index of \`${pkg}\` pinned under ` +
                    `\`art.packages\`: ${differences.join("; ")}`,
            });
            continue;
        }
        const alternative = asset.nonAiAlternative;
        master.indexed = {
            attribution: asset.attribution ?? [],
            license: asset.license ?? "",
            ai: asset.ai ?? null,
            nonAiAlternative:
                alternative == null ? null
                : typeof alternative === "string" ? alternative
                : renderAddress(alternative),
            width: asset.width ?? "",
            height: asset.height ?? "",
        };
    }
    return findings;
}

/**
 * Collect a package's masters and components, accepting the masters of every
 * picture package it declares, and bind those to their pinned indexes.
 *
 * @param {readonly string[]} roots - Private master roots or extracted archives.
 * @param {object} config - The resolved build configuration.
 * @param {{componentRoots?: readonly string[]}} [options] - Component roots.
 * @returns {ReturnType<typeof collectArtMasters>} Masters, components,
 *   findings and input paths.
 */
export function collectPackageArtMasters(roots, config, { componentRoots = [] } = {}) {
    const collected = collectArtMasters(roots, config.contentPackage, {
        componentRoots,
        dependencyPackages: artPackageNames(config),
    });
    collected.findings.push(...bindDependencyMasters(collected, config));
    return collected;
}

/**
 * Report each reference to a picture-package picture whose master this build
 * does not hold.
 *
 * Such a picture is in its package's pinned index but has nothing to render
 * from, so no surface of this package carries it. With `art.archives` or
 * `art.masterRoots` configured, the originals this build was given disagree
 * with the pinned index, and the finding is an error; with neither, it is a
 * warning. A reference to an address the index does not hold is left to the
 * ordinary unresolved-address findings.
 *
 * @param {readonly Record<string, any>[]} records - This build's index records.
 * @param {object} options
 * @param {Map<string, {frontmatter: object, body: string, raw: string}>} options.parsed -
 *   Each note as authored, by file.
 * @param {object} options.config - The resolved build configuration.
 * @param {(address: string) => object|undefined} options.indexed - The pinned
 *   index's record for an address.
 * @returns {object[]} Findings at each citing note, located at the reference.
 */
export function checkUnmasteredPictures(records, { parsed, config, indexed }) {
    const declared = new Set(artPackageNames(config));
    if (!declared.size) return [];
    const mastered = new Set(
        records
            .filter((record) => record.asset && declared.has(record.package))
            .map((record) => renderAddress(readCanonicalKey(record.address.canonical))),
    );
    const severity =
        config.art?.archives?.length || config.art?.masterRoots?.length ? "error" : "warning";
    const findings = [];
    for (const [file, note] of parsed) {
        const seen = new Map();
        for (const { address, written } of pictureReferences({
            frontmatter: note.frontmatter,
            body: note.body,
            contentPackage: config.contentPackage,
            packages: declared,
            config,
        })) {
            const occurrence = (seen.get(written) ?? 0) + 1;
            seen.set(written, occurrence);
            if (mastered.has(address) || !indexed(address)?.asset) continue;
            findings.push({
                file,
                ...positionOfLiteral(note.raw, written, occurrence),
                severity,
                message:
                    `\`${written}\` names ${address}, a picture of \`${readCanonicalKey(address).package}\` ` +
                    "whose master this build does not hold, so this package does not ship it; " +
                    "supply its original in the artwork archives or master roots, or name " +
                    "another picture",
            });
        }
    }
    return findings;
}
