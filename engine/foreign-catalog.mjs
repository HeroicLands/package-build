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
 * The file a system publishes its `system` field sets as (#60).
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
 * Whether a dependency's cache is present and complete.
 *
 * @param {string} dir - The dependency's cache directory.
 * @returns {boolean} True when it was fetched to completion.
 */
const isComplete = (dir) => fs.existsSync(path.join(dir, STAMP));

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
        log.info(`${id}@${version}: extracted pack "${pack.name}"`);
    }
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
 * @param {object} config - The resolved build configuration.
 * @returns {string[]} Every cached dependency's item directories.
 */
export function foreignItemCatalogDirs(config) {
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
        // Newest last wins if several versions are cached; a fetch always
        // writes the currently declared one, so that is the one to use.
        cached.sort();
        const items = itemsDir(cached[cached.length - 1]);
        for (const name of fs.readdirSync(items)) {
            dirs.push(path.join(items, name));
        }
    }
    return dirs;
}
