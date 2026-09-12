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
 * @file The item catalogue of a package this repository depends on but does not
 * contain.
 *
 * A consuming repository may author **beings** without holding the items they
 * are assembled from. `sohl-thalorna` is the case: its being notes address
 * embedded items by `(type, shortcode)` — `attribute:str`, `skill:awar` — and
 * almost every one of those belongs to the `sohl` package. The actors pass
 * resolves against Item pack output, so with no local items there is nothing to
 * resolve against and every embedded item fails.
 *
 * The dependency is already declared, with a manifest URL and a version range:
 *
 * ```yaml
 * relationships:
 *     systems:
 *         - id: sohl
 *           manifest: https://…/releases/latest/download/system.json
 *           compatibility: { minimum: "0.8.2", verified: "0.8.2" }
 *           itemCatalog: true
 * ```
 *
 * `itemCatalog: true` opts that relationship in. This module turns it into
 * directories of item JSON that the actors pass reads exactly as it reads a
 * local pack's output — the resolution logic needs no knowledge of where an
 * item came from.
 *
 * **The network is never touched by a compile.** Fetching is its own command
 * (`content-build deps fetch`), and a compile whose cache is cold fails saying
 * so. A build that silently downloads is not reproducible, fails strangely
 * offline, and hides a version change behind a passing run.
 *
 * **Nor does the catalogue have to come from a release.** `deps fetch --from
 * <path>` takes a locally built artifact — the `.zip` a package build produces,
 * or the staged directory it produces it from — and fills the same cache with
 * it. Cutting a release is a publishing decision; needing one in order to test a
 * consumer against unreleased work would make it a build step too. This is also
 * how a consumer is tested against a dependency change before either ships.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { unzipSync } from "fflate";
import { extractPack } from "@foundryvtt/foundryvtt-cli";

import log from "loglevel";

import {
    metadataRelationships,
    metadataCacheDir,
    metadataFileName,
    newestVersionDir,
    isComplete as metadataIsComplete,
    markComplete as markMetadataComplete,
} from "./metadata-index.mjs";

/** Written once a fetch completes, so a half-finished cache is never used. */
const STAMP = ".complete";

/**
 * Every declared relationship that opted into supplying an item catalogue.
 *
 * @param {object} config - The resolved build configuration.
 * @returns {Array<{id: string, manifest: string, kind: string, verified: string|undefined}>}
 *   The opted-in relationships, in declaration order.
 */
export function itemCatalogRelationships(config) {
    const out = [];
    for (const [kind, entries] of Object.entries(config.relationships ?? {})) {
        for (const rel of entries ?? []) {
            if (rel.itemCatalog) {
                out.push({
                    id: rel.id,
                    manifest: rel.manifest,
                    kind,
                    verified: rel.compatibility?.verified,
                });
            }
        }
    }
    return out;
}

/**
 * The cache directory for one dependency at one version.
 *
 * Keyed by version so that changing the pinned version is a different cache
 * rather than a silent overwrite, and so a second build costs nothing.
 *
 * @param {object} config - The resolved build configuration.
 * @param {string} id - The dependency's package id.
 * @param {string} version - Its resolved version.
 * @returns {string} The directory.
 */
export function catalogDir(config, id, version) {
    return path.join(config.paths.foreignCache, `${id}@${version}`);
}

/**
 * The directory holding extracted item JSON for one cached dependency.
 *
 * @param {string} dir - The dependency's cache directory.
 * @returns {string} Its items directory.
 */
const itemsDir = (dir) => path.join(dir, "items");

/**
 * The file a system publishes its `system` field sets as.
 *
 * @type {string}
 */
export const SCHEMA_ARTIFACT_FILE = "schema.json";

/**
 * Where a cached dependency's published schema sits, if it shipped one.
 *
 * @param {object} config - The resolved configuration.
 * @param {string} id - The dependency's package id.
 * @param {string} version - Its resolved version.
 * @returns {string} The path, whether or not it exists.
 */
export function cachedSchemaPath(config, id, version) {
    return path.join(catalogDir(config, id, version), SCHEMA_ARTIFACT_FILE);
}

/**
 * Keep the dependency's published schema beside its extracted items.
 *
 * **Copied to one known place rather than read from where it landed.** The two
 * fetch paths leave the unpacked archive in different states — a download
 * unzips into `<cache>/package/` and keeps it, while `--from` unzips into a
 * temporary directory and deletes it — so a reader that went looking in the
 * unpacked tree would find the schema for one and not the other, which is the
 * kind of difference that shows up as an unexplained skipped check.
 *
 * Absent is not an error: a system that has not adopted the artifact yet is
 * simply unchecked, and saying so is {@link module:engine/schema-check}'s job
 * rather than the fetch's.
 *
 * @param {string} root - The unpacked package root.
 * @param {string} dir - The dependency's cache directory.
 * @returns {boolean} Whether one was published.
 */
function cacheSchemaArtifact(root, dir) {
    const src = path.join(root, SCHEMA_ARTIFACT_FILE);
    if (!fs.existsSync(src)) return false;
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(src, path.join(dir, SCHEMA_ARTIFACT_FILE));
    return true;
}

/**
 * What each extracted pack is, written beside the items rather than inferred
 * from the directory it landed in.
 *
 * A dependency may ship a pack per system — `items-sohl` and `items-hm3` — and
 * the two hold documents of the *same* `(type, shortcode)` addresses with
 * different data models: `skill:awar` exists in both vocabularies and means two
 * different documents. So a consumer compiling an `hm3` pack has to read the
 * `hm3` half of the catalogue and no other, and the only place that says which
 * half a directory is, is the dependency's own manifest at fetch time.
 *
 * Held as a manifest at the cache root rather than a marker inside each pack
 * directory, because those directories are walked as JSON trees: a file dropped
 * in one would be loaded as though it were a document.
 *
 * @type {string}
 */
const ITEM_PACKS = "item-packs.json";

/**
 * What to record about the packs being extracted.
 *
 * Exported so the pair is one fact: {@link foreignItemCatalogDirs} reads what
 * this writes, and a test that hand-wrote the file would prove the reader
 * against a transcription of the format rather than against the format.
 *
 * A pack declaring no `system` records `null` — Foundry requires the field on
 * an Item pack, so this is the shape of a manifest that is wrong rather than a
 * case with a meaning, and `null` reads as "neutral", which is the safe way to
 * be wrong: a neutral pack is read by every system rather than by none.
 *
 * @param {readonly object[]} itemPacks - The manifest's Item pack entries.
 * @returns {Array<{name: string, system: string|null}>} What each one is.
 */
export function itemPackManifest(itemPacks) {
    return itemPacks.map((pack) => ({ name: pack.name, system: pack.system ?? null }));
}

/**
 * The system each extracted pack was published for.
 *
 * @param {string} dir - The dependency's cache directory.
 * @returns {Map<string, string|null>} Pack name → its declared system, `null`
 *   for a pack that declares none.
 */
function cachedItemPacks(dir) {
    const file = path.join(dir, ITEM_PACKS);
    const declared = JSON.parse(fs.readFileSync(file, "utf8"));
    return new Map(declared.map((pack) => [pack.name, pack.system ?? null]));
}

/**
 * Whether a dependency's cache is present and complete.
 *
 * **A cache without its pack manifest is incomplete**, not merely unlabelled.
 * An older one holds the items and not what they are, and the two
 * ways of proceeding without it are both wrong: reading every pack resolves an
 * `hm3` reference against `sohl` documents — the silent-wrong-output failure
 * this scoping exists to remove — and reading none fails a build that was
 * working. Treating it as incomplete makes `content-build deps fetch` refill
 * it, which is a command the cold-cache path already tells anyone to run.
 *
 * @param {string} dir - The dependency's cache directory.
 * @returns {boolean} True when it was fetched to completion.
 */
const isComplete = (dir) =>
    fs.existsSync(path.join(dir, STAMP)) && fs.existsSync(path.join(dir, ITEM_PACKS));

/**
 * Read a dependency's manifest.
 *
 * @param {string} url - The manifest URL.
 * @returns {Promise<object>} The parsed manifest.
 */
async function fetchManifest(url) {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
        throw new Error(
            `could not read the manifest at ${url}: HTTP ${res.status} ${res.statusText}`,
        );
    }
    return await res.json();
}

/**
 * Write an unzipped archive's entries under `dest`.
 *
 * @param {Record<string, Uint8Array>} files - The archive's entries.
 * @param {string} dest - Where to write them.
 * @returns {void}
 */
export function writeZipEntries(files, dest) {
    for (const [name, bytes] of Object.entries(files)) {
        // A zip entry is a path; a directory entry has no bytes.
        if (name.endsWith("/") || bytes.length === 0) continue;
        const full = path.join(dest, name);
        // A zip may name entries outside the destination; refuse those rather
        // than write wherever the archive says.
        const rel = path.relative(dest, full);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
            throw new Error(`archive entry escapes the destination: ${name}`);
        }
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, bytes);
    }
}

/**
 * Extract every Item pack a manifest declares, and stamp the cache complete.
 *
 * Shared by both routes, so a catalogue built from a local artifact is byte-for
 * -byte the shape a compile expects from a released one.
 *
 * @param {string} id - The dependency's package id.
 * @param {string} version - Its resolved version.
 * @param {object} manifest - Its manifest.
 * @param {string} root - The unpacked package root.
 * @param {string} dir - The dependency's cache directory.
 * @returns {Promise<void>}
 */
async function extractItemPacks(id, version, manifest, root, dir) {
    const itemPacks = (manifest.packs ?? []).filter((pack) => pack.type === "Item");
    if (!itemPacks.length) {
        throw new Error(
            `${id}@${version}: its manifest declares no Item packs, so it ` +
                `cannot supply an item catalogue`,
        );
    }
    for (const pack of itemPacks) {
        const src = resolvePackPath(root, pack.path);
        if (!src) {
            throw new Error(
                `${id}@${version}: pack "${pack.name}" is declared at ` +
                    `${pack.path}, which the package does not contain`,
            );
        }
        const out = path.join(dir, "items", pack.name);
        fs.mkdirSync(out, { recursive: true });
        await extractPack(src, out, { log: false });
        log.info(
            `${id}@${version}: extracted pack "${pack.name}"` +
                (pack.system ? ` (system: ${pack.system})` : ""),
        );
    }
    // What each pack is, from the only place that knows: the manifest that
    // declared it. Written before the stamp, so the stamp continues to
    // mean the cache is whole.
    fs.writeFileSync(
        path.join(dir, ITEM_PACKS),
        `${JSON.stringify(itemPackManifest(itemPacks), null, 4)}\n`,
    );
    // Last, so a fetch that died partway is never mistaken for a complete one.
    fs.writeFileSync(path.join(dir, STAMP), `${version}\n`);
}

/**
 * Download a package archive and unzip it into `dest`.
 *
 * @param {string} url - The archive URL, from the manifest's `download`.
 * @param {string} dest - Where to write the archive's contents.
 * @returns {Promise<void>}
 */
async function downloadAndUnzip(url, dest) {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
        throw new Error(`could not download ${url}: HTTP ${res.status} ${res.statusText}`);
    }
    writeZipEntries(unzipSync(new Uint8Array(await res.arrayBuffer())), dest);
}

/**
 * The manifest URL to actually read, pinned to the declared version.
 *
 * A consumer writes `releases/latest/download/system.json`, which is the right
 * thing to publish and the wrong thing to build against: the artifact behind it
 * changes when somebody else cuts a release, so a build names no particular
 * dependency and "thalorna 0.1.0" stops being reproducible. The declared
 * `compatibility.verified` is the version this repository was actually built
 * against, so that is the one to fetch.
 *
 * GitHub's release URLs are rewritable — `releases/latest/download/X` is
 * `releases/download/v<version>/X`. Where the URL is not that shape there is
 * nothing to rewrite, so the declared URL is read and its version checked
 * instead: floating silently is the one outcome not on offer.
 *
 * @param {string} url - The declared manifest URL.
 * @param {string|undefined} verified - The declared verified version.
 * @returns {{url: string, pinned: boolean}} The URL to read.
 */
export function pinnedManifestUrl(url, verified) {
    if (!verified) return { url, pinned: false };
    const marker = "/releases/latest/download/";
    const at = url.indexOf(marker);
    if (at === -1) return { url, pinned: false };
    const tag = verified.startsWith("v") ? verified : `v${verified}`;
    return {
        url: url.slice(0, at) + `/releases/download/${tag}/` + url.slice(at + marker.length),
        pinned: true,
    };
}

/**
 * Fetch one dependency and extract its Item packs.
 *
 * Idempotent: a complete cache for the resolved version is left alone.
 *
 * @param {object} config - The resolved build configuration.
 * @param {{id: string, manifest: string}} rel - The declared relationship.
 * @returns {Promise<string>} The dependency's cache directory.
 */
export async function fetchCatalog(config, rel) {
    const { url, pinned } = pinnedManifestUrl(rel.manifest, rel.verified);
    const manifest = await fetchManifest(url);
    const version = manifest.version;
    if (!version) {
        throw new Error(`${rel.id}: its manifest declares no \`version\``);
    }
    if (!pinned && rel.verified && version !== rel.verified) {
        throw new Error(
            `${rel.id}: declares \`compatibility.verified: ${rel.verified}\` but ` +
                `${url} offers ${version}. Building against a moving target is ` +
                `not reproducible — update \`verified\`, or point \`manifest\` ` +
                `at a pinned release.`,
        );
    }
    if (!rel.verified) {
        log.warn(
            `${rel.id}: no \`compatibility.verified\`, so its catalogue floats ` +
                `with whatever ${url} currently serves`,
        );
    }
    const dir = catalogDir(config, rel.id, version);
    if (isComplete(dir)) {
        log.info(`${rel.id}@${version}: already cached`);
        return dir;
    }

    const download = manifest.download;
    if (!download) {
        throw new Error(`${rel.id}@${version}: its manifest declares no \`download\``);
    }

    // Rebuild from empty: a previous run may have died partway, and a stale
    // half-tree is worse than no tree.
    fs.rmSync(dir, { recursive: true, force: true });
    const raw = path.join(dir, "package");
    fs.mkdirSync(raw, { recursive: true });

    log.info(`${rel.id}@${version}: downloading ${download}`);
    await downloadAndUnzip(download, raw);

    await extractItemPacks(rel.id, version, manifest, raw, dir);
    cacheSchemaArtifact(raw, dir);
    return dir;
}

/**
 * Locate a declared pack inside an unpacked archive.
 *
 * Foundry archives are inconsistent about whether they nest their contents
 * under a top-level directory, so try the path as given and then one level in.
 *
 * @param {string} root - The unpacked archive root.
 * @param {string} packPath - The manifest's declared pack path.
 * @returns {string|null} The directory, or null when absent.
 */
function resolvePackPath(root, packPath) {
    const direct = path.join(root, packPath);
    if (fs.existsSync(direct)) return direct;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const nested = path.join(root, entry.name, packPath);
        if (fs.existsSync(nested)) return nested;
    }
    return null;
}

/**
 * The manifest of a package sitting on disk, unpacked or zipped.
 *
 * @param {string} root - The unpacked package root.
 * @returns {object|null} Its parsed manifest, or null when it holds none.
 */
function readLocalManifest(root) {
    for (const name of ["system.json", "module.json"]) {
        const direct = path.join(root, name);
        if (fs.existsSync(direct)) {
            return JSON.parse(fs.readFileSync(direct, "utf8"));
        }
    }
    // A zip commonly nests everything under one directory.
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const nested = readLocalManifest(path.join(root, entry.name));
        if (nested) return nested;
    }
    return null;
}

/**
 * Fill the cache from a locally built artifact rather than a release.
 *
 * `source` is either the `.zip` a package build emits or the directory it was
 * built from. Either way the manifest inside it names the version, so the cache
 * stays version-keyed and a compile cannot tell the difference — which is the
 * point: a consumer can be built against a dependency that has not shipped.
 *
 * @param {object} config - The resolved build configuration.
 * @param {{id: string}} rel - The declared relationship.
 * @param {string} source - Path to the artifact or its directory.
 * @returns {Promise<string>} The dependency's cache directory.
 */
export async function fetchCatalogFromPath(config, rel, source) {
    if (!fs.existsSync(source)) {
        throw new Error(`${rel.id}: nothing at ${source}`);
    }

    const staging = fs.mkdtempSync(path.join(os.tmpdir(), `content-build-${rel.id}-`));
    try {
        let root;
        if (fs.statSync(source).isDirectory()) {
            root = source;
        } else {
            const bytes = new Uint8Array(fs.readFileSync(source));
            writeZipEntries(unzipSync(bytes), staging);
            root = staging;
        }

        const manifest = readLocalManifest(root);
        if (!manifest) {
            throw new Error(
                `${rel.id}: ${source} holds no system.json or module.json, so ` +
                    `its version and packs cannot be read`,
            );
        }
        if (manifest.id && manifest.id !== rel.id) {
            throw new Error(`${rel.id}: ${source} is package "${manifest.id}", not "${rel.id}"`);
        }
        const version = manifest.version;
        if (!version) {
            throw new Error(`${rel.id}: ${source} declares no \`version\``);
        }

        const dir = catalogDir(config, rel.id, version);
        fs.rmSync(dir, { recursive: true, force: true });
        await extractItemPacks(rel.id, version, manifest, root, dir);
        cacheSchemaArtifact(root, dir);
        log.info(`${rel.id}@${version}: cached from ${source}`);
        return dir;
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
    }
}

/**
 * Fetch one dependency's published content index.
 *
 * **The chain is entirely declared.** The relationship names the dependency's
 * manifest, the manifest advertises `flags.metadataUrl`, and that URL is the
 * index — so nothing here holds an address of its own, and a dependency that
 * moves its release assets does not break its consumers.
 *
 * Pinned by the same rule as the catalogue: `compatibility.verified` is the
 * version this repository was built against, so a floating `releases/latest`
 * URL is rewritten to it. A consumer resolving addresses against whatever the
 * dependency published this morning is not reproducible.
 *
 * Idempotent: a complete cache for the resolved version is left alone.
 *
 * @param {object} config - The resolved build configuration.
 * @param {{id: string, manifest: string, verified?: string}} rel - The declared
 *   relationship.
 * @returns {Promise<string>} The cached index file.
 */
export async function fetchMetadata(config, rel) {
    const { url, pinned } = pinnedManifestUrl(rel.manifest, rel.verified);
    const manifest = await fetchManifest(url);
    const version = manifest.version;
    if (!version) {
        throw new Error(`${rel.id}: its manifest declares no \`version\``);
    }
    if (!pinned && rel.verified && version !== rel.verified) {
        throw new Error(
            `${rel.id}: declares \`compatibility.verified: ${rel.verified}\` but ` +
                `${url} offers ${version}. Building against a moving target is ` +
                `not reproducible — update \`verified\`, or point \`manifest\` ` +
                `at a pinned release.`,
        );
    }

    const dir = metadataCacheDir(config, rel.id, version);
    const indexUrl = manifest.flags?.metadataUrl;
    if (!indexUrl) {
        throw new Error(
            `${rel.id}@${version}: its manifest advertises no ` +
                `\`flags.metadataUrl\`, so it publishes no content index and ` +
                `nothing can link into it. It needs a release built with ` +
                `package-build 18 or later.`,
        );
    }

    if (metadataIsComplete(dir)) {
        log.info(`${rel.id}@${version}: index already cached`);
        return path.join(dir, path.basename(new URL(indexUrl).pathname));
    }

    // Rebuild from empty: a previous run may have died partway, and a stale
    // half-written index is worse than none.
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    log.info(`${rel.id}@${version}: downloading ${indexUrl}`);
    const res = await fetch(indexUrl, { redirect: "follow" });
    if (!res.ok) {
        throw new Error(
            `${rel.id}@${version}: could not download its content index at ` +
                `${indexUrl}: HTTP ${res.status} ${res.statusText}`,
        );
    }
    const file = path.join(dir, path.basename(new URL(indexUrl).pathname));
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    markMetadataComplete(dir);
    return file;
}

/**
 * Fill the index cache from a locally built artifact rather than a release.
 *
 * The counterpart of {@link fetchCatalogFromPath}, and the same escape hatch
 * for the same reason: two packages being changed together cannot each wait for
 * the other to ship. The index is looked for beside the manifest — which is
 * where a build leaves it and where the release publishes it — so a package
 * directory and an unpacked zip are both usable as-is.
 *
 * @param {object} config - The resolved build configuration.
 * @param {{id: string}} rel - The declared relationship.
 * @param {string} source - Path to the artifact or its directory.
 * @returns {Promise<string>} The cached index file.
 */
export async function fetchMetadataFromPath(config, rel, source) {
    if (!fs.existsSync(source)) {
        throw new Error(`${rel.id}: nothing at ${source}`);
    }

    const staging = fs.mkdtempSync(path.join(os.tmpdir(), `content-build-meta-${rel.id}-`));
    try {
        let root = source;
        if (!fs.statSync(source).isDirectory()) {
            writeZipEntries(unzipSync(new Uint8Array(fs.readFileSync(source))), staging);
            root = staging;
        }

        const manifest = readLocalManifest(root);
        if (!manifest) {
            throw new Error(
                `${rel.id}: ${source} holds no system.json or module.json, so ` +
                    `its version cannot be read`,
            );
        }
        if (manifest.id && manifest.id !== rel.id) {
            throw new Error(`${rel.id}: ${source} is package "${manifest.id}", not "${rel.id}"`);
        }
        const version = manifest.version;
        if (!version) {
            throw new Error(`${rel.id}: ${source} declares no \`version\``);
        }

        // Named by the manifest where it advertises one, so a local artifact
        // and a released one are cached under the same name; falling back to
        // the id covers a build whose manifest predates the flag.
        const name =
            manifest.flags?.metadataUrl ?
                path.basename(new URL(manifest.flags.metadataUrl).pathname)
            :   metadataFileName(rel.id);
        const found = findLocalIndex(root, name);
        if (!found) {
            throw new Error(
                `${rel.id}: ${source} holds no ${name}, so it publishes no ` +
                    `content index. Build it before fetching from it.`,
            );
        }

        const dir = metadataCacheDir(config, rel.id, version);
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, name);
        fs.copyFileSync(found, file);
        markMetadataComplete(dir);
        log.info(`${rel.id}@${version}: index cached from ${source}`);
        return file;
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
    }
}

/**
 * Locate an index file in an unpacked artifact.
 *
 * Foundry archives are inconsistent about whether they nest their contents
 * under a top-level directory, so try the root and then one level in — the same
 * allowance {@link resolvePackPath} makes for packs.
 *
 * @param {string} root - The unpacked package root.
 * @param {string} name - The index file name.
 * @returns {string|null} The path, or null when absent.
 */
function findLocalIndex(root, name) {
    const direct = path.join(root, name);
    if (fs.existsSync(direct)) return direct;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const nested = path.join(root, entry.name, name);
        if (fs.existsSync(nested)) return nested;
    }
    return null;
}

/**
 * Fetch every declared dependency's content index.
 *
 * A wider set than {@link fetchAllCatalogs}: an index is fetched for *every*
 * dependency, a catalogue only for those declaring `itemCatalog: true`. See
 * {@link metadataRelationships} for why the two sets differ.
 *
 * @param {object} config - The resolved build configuration.
 * @returns {Promise<number>} How many indexes were fetched.
 */
export async function fetchAllMetadata(config) {
    const rels = metadataRelationships(config);
    for (const rel of rels) await fetchMetadata(config, rel);
    return rels.length;
}

/**
 * Fetch every opted-in dependency. The `deps fetch` command.
 *
 * @param {object} config - The resolved build configuration.
 * @returns {Promise<number>} How many dependencies were fetched.
 */
export async function fetchAllCatalogs(config) {
    const rels = itemCatalogRelationships(config);
    if (!rels.length) {
        log.info("No relationship declares `itemCatalog: true`; nothing to fetch.");
        return 0;
    }
    for (const rel of rels) await fetchCatalog(config, rel);
    return rels.length;
}

/**
 * The extracted item directories the actors pass should resolve against, on
 * top of this repository's own.
 *
 * Reads the cache only. A cold cache is an error naming the command that fills
 * it, rather than a download nobody asked for.
 *
 * **Scoped to one system when the caller compiles for one**, exactly as
 * {@link module:engine/generate.itemPackJsonDirs} scopes the local half. The
 * two halves answer the same lookup — `loadItemsMap` merges them into one
 * address space keyed by `subType:shortcode` — so scoping only the local one
 * leaves the collision it was meant to remove: `skill:awar` is a real address
 * in both vocabularies, and a `harn-ensemble` actor compiled for `hm3` would
 * resolve three quarters of its references against whichever document the
 * dependency's `sohl` pack happened to supply. A pack that declares no system
 * is neutral and always read; asking for no system reads every pack, which is
 * every single-system build.
 *
 * @param {object} config - The resolved build configuration.
 * @param {string|null} [system] - The system the caller is compiling for.
 *   Omitted or `null`, every cached pack is read.
 * @returns {Array<{dir: string, package: string}>} Every cached dependency's
 *   item directories, each with the package that published it.
 */
export function foreignItemCatalogDirs(config, system = null) {
    const dirs = [];
    for (const rel of itemCatalogRelationships(config)) {
        const root = config.paths.foreignCache;
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
                `${rel.id} declares \`itemCatalog: true\` but has not been ` +
                    `fetched. Run \`content-build deps fetch\` first.`,
            );
        }
        // Newest wins if several versions are cached; a fetch always writes
        // the currently declared one, so that is the one to use. The
        // comparison is the content-index cache's, shared rather than
        // rewritten: a plain string sort would put `0.8.10` before `0.8.2` and
        // silently resolve every embedded item against the older catalogue.
        const newest = newestVersionDir(cached);
        const packSystems = cachedItemPacks(newest);
        const items = itemsDir(newest);
        for (const entry of fs.readdirSync(items, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const packSystem = packSystems.get(entry.name) ?? null;
            if (system != null && packSystem != null && packSystem !== system) continue;
            // The dependency's own id travels with its directory: a
            // being's `model:` names the package its template comes from, and
            // the address cannot be built from the path.
            dirs.push({ dir: path.join(items, entry.name), package: rel.id });
        }
    }
    return dirs;
}
