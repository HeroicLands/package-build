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
 * (`package-build deps fetch`), and a compile whose cache is cold fails saying
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
import { createHash, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { unzipSync } from "fflate";

import log from "loglevel";

import {
    metadataRelationships,
    metadataCacheDir,
    metadataFileName,
    newestVersionDir,
    markComplete as markMetadataComplete,
} from "./metadata-index.mjs";
import { isPackageRecord } from "./index-records.mjs";
import { systemPackages } from "./item-entries.mjs";
import { downloadCached } from "./download-cache.mjs";
import { buildUserAgent, fetchFollowingRedirects } from "./user-agent.mjs";
import { forgeAssetUrl, forgeToken, resolveForge } from "./forge-url.mjs";
import { requirePathToken, versionMessage } from "./path-token.mjs";

/** Written once a fetch completes, so a half-finished cache is never used. */
const STAMP = ".complete";

/**
 * Every declared relationship that opted into supplying an item catalogue.
 *
 * @param {object} config - The resolved build configuration.
 * @returns {Array<{id: string, manifest: string, buildManifest: string|undefined, kind: string, verified: string|undefined}>}
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
                    buildManifest: rel.buildManifest,
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
    requirePathToken(id, `${id}: a dependency id must be one plain name`);
    requirePathToken(version, versionMessage(`${id}: the version is`, version));
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
 * working. Treating it as incomplete makes `package-build deps fetch` refill
 * it, which is a command the cold-cache path already tells anyone to run.
 *
 * @param {string} dir - The dependency's cache directory.
 * @returns {boolean} True when it was fetched to completion.
 */
const isComplete = (dir) =>
    fs.existsSync(path.join(dir, STAMP)) && fs.existsSync(path.join(dir, ITEM_PACKS));

/** Read the optional private credential for a configured build mirror. */
function mirrorToken(rel) {
    const mirror = rel.buildManifest;
    if (!mirror || !process.env.PACKAGE_BUILD_FORGE_TOKEN_FILE) return undefined;
    const url = new URL(mirror);
    const host = url.hostname;
    const loopback = host === "localhost" || host === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(host);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
        throw new Error(
            `${rel.id}: PACKAGE_BUILD_FORGE_TOKEN_FILE requires HTTPS for a non-loopback mirror`,
        );
    }
    let value;
    try {
        value = fs.readFileSync(process.env.PACKAGE_BUILD_FORGE_TOKEN_FILE, "utf8");
    } catch {
        throw new Error(
            `${rel.id}: the token file named by PACKAGE_BUILD_FORGE_TOKEN_FILE could not be read`,
        );
    }
    const token = value.replace(/\r?\n$/, "");
    if (!token || /[^\x21-\x7e]/.test(token)) {
        throw new Error(
            `${rel.id}: PACKAGE_BUILD_FORGE_TOKEN_FILE must contain one non-empty token`,
        );
    }
    return token;
}

/**
 * Read a dependency's manifest.
 * @param {string} url - The manifest URL.
 * @param {string|undefined} token - The mirror credential.
 * @param {object} rel - The dependency relationship being fetched.
 * @returns {Promise<object>} The parsed manifest.
 */
async function fetchManifest(url, token, rel) {
    const bytes = await fetchBytes(
        url,
        `${rel.id}: could not read the manifest at ${url}`,
        token,
        !!rel.buildManifest,
    );
    let manifest;
    try {
        manifest = JSON.parse(new TextDecoder().decode(bytes));
    } catch (cause) {
        if (token)
            throw new Error(`${rel.id}: could not read the manifest at ${url}: invalid JSON`);
        throw cause;
    }
    if (token) {
        const pending = [manifest];
        while (pending.length) {
            const value = pending.pop();
            if (typeof value === "string" && value.includes(token)) {
                throw new Error(
                    `${rel.id}: could not read the manifest at ${url}: credential in response`,
                );
            }
            if (value && typeof value === "object") {
                for (const [key, entry] of Object.entries(value)) pending.push(key, entry);
            }
        }
    }
    return manifest;
}

const DOWNLOAD_ATTEMPTS = 5;
const DOWNLOAD_DELAY_MS = 1000;
const DOWNLOAD_JITTER_MS = 250;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_MIRROR_REDIRECTS = 10;
/** The largest content index a mirror may serve, in bytes. */
export const MAX_INDEX_BYTES = 256 * 1024 * 1024;

class MirrorRedirectError extends Error {}

/**
 * Read a complete response, retrying transient failures with bounded delays.
 * @param {string} url - The resource URL.
 * @param {string} context - The failure description.
 * @param {string|undefined} [token] - The mirror credential.
 * @param {boolean} [mirror] - Whether the resource is served by a build mirror.
 * @returns {Promise<Uint8Array>} The complete response body.
 */
async function fetchBytes(url, context, token, mirror = false) {
    for (let attempt = 0; ; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
        let response;
        try {
            let current = url;
            for (let redirects = 0; ; redirects++) {
                response = undefined;
                response =
                    token ?
                        await fetch(current, {
                            redirect: "manual",
                            signal: controller.signal,
                            headers: {
                                Authorization: `token ${token}`,
                                "user-agent": buildUserAgent(current),
                            },
                        })
                    :   await fetchFollowingRedirects(current, { signal: controller.signal });
                if (!token || ![301, 302, 303, 307, 308].includes(response.status)) break;
                const location = response.headers.get("location");
                await response.body?.cancel().catch(() => {});
                let next;
                try {
                    next = location && new URL(location, current);
                } catch {
                    next = null;
                }
                if (
                    !next ||
                    next.origin !== new URL(url).origin ||
                    next.username ||
                    next.password ||
                    redirects >= MAX_MIRROR_REDIRECTS
                ) {
                    throw new MirrorRedirectError(`${context}: mirror redirect refused`);
                }
                current = next.href;
            }
            if (response.ok) return new Uint8Array(await response.arrayBuffer());
        } catch (cause) {
            if (cause instanceof MirrorRedirectError) throw cause;
            if (attempt === DOWNLOAD_ATTEMPTS - 1) {
                if (token) throw new Error(`${context}: request failed`);
                const message = cause instanceof Error ? cause.message : String(cause);
                throw new Error(`${context}: ${message}`, { cause });
            }
        } finally {
            clearTimeout(timeout);
        }
        if (response && !response.ok) {
            await response.body?.cancel().catch(() => {});
            const error = new Error(
                `${context}: HTTP ${response.status}${mirror ? "" : ` ${response.statusText}`}` +
                    (mirror && !token && response.status === 404 ?
                        "; a private mirror may require PACKAGE_BUILD_FORGE_TOKEN_FILE"
                    : mirror && [401, 403].includes(response.status) ?
                        "; set or check PACKAGE_BUILD_FORGE_TOKEN_FILE for this dependency"
                    :   ""),
            );
            if (
                response.status < 500 ||
                response.status >= 600 ||
                attempt === DOWNLOAD_ATTEMPTS - 1
            )
                throw error;
        }
        const delay =
            DOWNLOAD_DELAY_MS * 2 ** attempt + Math.floor(Math.random() * DOWNLOAD_JITTER_MS);
        await new Promise((resolve) => setTimeout(resolve, delay));
    }
}

/**
 * Read bounded forge API JSON without passing mirror credentials.
 *
 * @param {import("./forge-url.mjs").Forge} forge - The forge the API belongs to.
 * @param {string} url - The API URL.
 * @param {AbortSignal} signal - Aborts the request.
 * @param {string} [etag] - A stored entity tag to revalidate.
 * @returns {Promise<{notModified: true}|{notModified: false, body: any, etag: string|null}>}
 */
async function forgeJson(forge, url, signal, etag) {
    const target = new URL(url);
    if (target.origin !== forge.apiOrigin || target.username || target.password)
        throw new Error(
            `${forge.name} metadata requires the HTTPS ${new URL(forge.apiOrigin).host} origin`,
        );
    let token;
    try {
        token = forgeToken(forge);
    } catch (error) {
        // The message names the variable and never its value, so it is shown as written.
        error.showAsIs = true;
        throw error;
    }
    let response;
    try {
        try {
            response = await fetch(url, {
                redirect: "manual",
                signal,
                headers: {
                    Accept:
                        forge.kind === "github" ?
                            "application/vnd.github+json"
                        :   "application/json",
                    "user-agent": buildUserAgent(url),
                    ...(etag ? { "If-None-Match": etag } : {}),
                    ...(token ?
                        {
                            Authorization:
                                forge.kind === "github" ? `Bearer ${token}` : `token ${token}`,
                        }
                    :   {}),
                },
            });
        } catch {
            const error = new Error(`${forge.name} release metadata request failed`);
            error.retryable = true;
            throw error;
        }
        if (response.status === 304 && etag) return { notModified: true };
        if (!response.ok || !response.body) {
            const rateLimited =
                response.status === 429 ||
                (response.status === 403 &&
                    (response.headers.get("x-ratelimit-remaining") === "0" ||
                        response.headers.has("retry-after")));
            const unauthorised = response.status === 401;
            const error = new Error(
                rateLimited ?
                    `${forge.name} API rate limit reached (HTTP ${response.status}); retry after the quota resets or set ${forge.tokenVariable} to a ${forge.name}-issued token`
                : unauthorised ?
                    `${forge.name} rejected the credential (HTTP 401); check ${forge.tokenVariable}`
                :   `${forge.name} release metadata request failed (HTTP ${response.status})`,
            );
            error.rateLimited = rateLimited;
            error.showAsIs = unauthorised;
            error.retryable = response.status >= 500 && response.status < 600;
            throw error;
        }
        const chunks = [];
        let size = 0;
        try {
            for await (const chunk of response.body) {
                size += chunk.length;
                if (size > 2 * 1024 * 1024)
                    throw new Error(`${forge.name} release metadata exceeds size limit`);
                chunks.push(chunk);
            }
        } catch (cause) {
            if (size > 2 * 1024 * 1024) throw cause;
            const error = new Error(`${forge.name} release metadata response interrupted`);
            error.retryable = true;
            throw error;
        }
        try {
            return {
                notModified: false,
                etag: response.headers.get("etag"),
                body: JSON.parse(
                    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
                ),
            };
        } catch {
            throw new Error(`${forge.name} release metadata is not valid UTF-8 JSON`);
        }
    } finally {
        if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
    }
}

const confirmedForges = new Map();

/**
 * Confirm a non-GitHub forge is a Gitea instance before any token goes to it.
 *
 * One unauthenticated, redirect-free `GET /api/v1/version` per origin per process.
 */
function confirmGitea(forge) {
    let pending = confirmedForges.get(forge.origin);
    if (!pending) {
        pending = (async () => {
            const refuse = (why) => {
                const error = new Error(
                    `PACKAGE_BUILD_FORGE_URL names ${forge.origin}, which ${why}; set it to a Gitea forge or to https://github.com`,
                );
                error.showAsIs = true;
                return error;
            };
            let response;
            try {
                response = await fetch(`${forge.origin}/api/v1/version`, {
                    redirect: "manual",
                    signal: AbortSignal.timeout(10_000),
                    headers: {
                        Accept: "application/json",
                        "user-agent": buildUserAgent(forge.origin),
                    },
                });
            } catch {
                throw refuse("could not be reached");
            }
            try {
                if (!response.ok) throw refuse("does not answer the Gitea version API");
                let body;
                try {
                    const chunks = [];
                    let size = 0;
                    for await (const chunk of response.body ?? []) {
                        size += chunk.length;
                        if (size > 64 * 1024) throw new Error("too large");
                        chunks.push(chunk);
                    }
                    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                } catch {
                    throw refuse("does not answer the Gitea version API");
                }
                if (typeof body?.version !== "string" || !body.version)
                    throw refuse("does not answer the Gitea version API");
            } finally {
                await response.body?.cancel().catch(() => {});
            }
        })();
        confirmedForges.set(forge.origin, pending);
    }
    return pending;
}

/** The forge to read from, confirmed when it is not GitHub. */
async function readyForge() {
    const forge = resolveForge();
    if (forge.kind === "gitea") await confirmGitea(forge);
    return forge;
}

/**
 * The credential for a manifest, archive or index download: the build mirror's
 * when a mirror serves it, otherwise the Gitea forge token when the URL's origin
 * is the forge's own. Every other URL is read anonymously, and GitHub downloads
 * carry none.
 */
function downloadToken(rel, forge, url) {
    if (rel.buildManifest) return mirrorToken(rel);
    if (forge.kind !== "gitea") return undefined;
    let origin;
    try {
        origin = new URL(url).origin;
    } catch {
        return undefined;
    }
    return origin === forge.origin ? forgeToken(forge) : undefined;
}

class MetadataSourceError extends Error {}

/** Require an exact public release asset on the chosen forge as the checksum source. */
function forgeReleaseAsset(forge, value) {
    const message = `content index fetching requires a pinned ${forge.name} release asset URL; use a ${forge.name} release or package-build deps fetch --from <path> for a local artifact`;
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new MetadataSourceError(message);
    }
    if (
        url.protocol !== "https:" ||
        url.origin !== forge.origin ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
    )
        throw new MetadataSourceError(message);
    const parts = url.pathname.split("/");
    if (
        parts.length !== 7 ||
        parts[0] !== "" ||
        parts[3] !== "releases" ||
        parts[4] !== "download" ||
        !parts[1] ||
        !parts[2] ||
        !parts[5] ||
        !parts[6]
    )
        throw new MetadataSourceError(message);
    return parts;
}

/** Bind the manifest and index to the same exact public release. */
function forgeReleaseIdentity(forge, manifestUrl, assetUrl) {
    const manifest = forgeReleaseAsset(forge, manifestUrl);
    const asset = forgeReleaseAsset(forge, assetUrl);
    if (manifest.slice(1, 6).join("/") !== asset.slice(1, 6).join("/"))
        throw new MetadataSourceError(`content index is not in the pinned ${forge.name} release`);
    return manifest;
}

/** The file beside a dependency's index that remembers its release lookup. */
const RELEASE_RECORD = "release.json";

function readReleaseRecord(dir, api) {
    try {
        const record = JSON.parse(fs.readFileSync(path.join(dir, RELEASE_RECORD), "utf8"));
        if (record.api === api && typeof record.etag === "string" && record.release) return record;
    } catch {
        // No usable record: the lookup is unconditional.
    }
    return undefined;
}

function writeReleaseRecord(dir, api, etag, release) {
    try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, RELEASE_RECORD), JSON.stringify({ api, etag, release }));
    } catch {
        // The record only saves a request; failing to keep it costs nothing else.
    }
}

/** The release's id, tag and assets, as the lookup keeps them. */
function releaseSummary(release) {
    return {
        id: release.id,
        tag_name: release.tag_name,
        assets:
            Array.isArray(release.assets) ?
                release.assets.map((asset) => ({
                    id: asset.id,
                    browser_download_url: asset.browser_download_url,
                    digest: asset.digest,
                }))
            :   undefined,
    };
}

/**
 * Resolve a pinned release asset's digest from its exact advertised URL.
 *
 * One release lookup serves every asset of that release in the run; a stored
 * entity tag turns a repeat lookup into a conditional request. A forge that
 * publishes no asset digest (Gitea) yields `undefined`.
 *
 * The release record that saves the next lookup is handed back in `record.store` and written by
 * the caller once the index is accepted, so a refused fetch leaves it unwritten.
 *
 * @returns {Promise<string|undefined>} The SHA-256, or undefined when the forge publishes none.
 */
async function forgeAssetDigest(forge, manifestUrl, assetUrl, cache, dir, record) {
    const manifest = forgeReleaseIdentity(forge, manifestUrl, assetUrl);
    const base =
        forge.kind === "github" ? `${forge.apiOrigin}/repos` : `${forge.apiOrigin}/api/v1/repos`;
    const api = `${base}/${manifest[1]}/${manifest[2]}/releases/tags/${manifest[5]}`;
    let pending = cache.get(api);
    if (!pending) {
        pending = (async () => {
            const stored = readReleaseRecord(dir, api);
            const reply = await retryMetadata((signal) =>
                forgeJson(forge, api, signal, stored?.etag),
            );
            const release = reply.notModified ? stored.release : releaseSummary(reply.body);
            const store =
                !reply.notModified && reply.etag ? { api, etag: reply.etag, release } : undefined;
            if (
                !Number.isSafeInteger(release.id) ||
                release.id <= 0 ||
                release.tag_name !== decodeURIComponent(manifest[5])
            )
                throw new Error(`${forge.name} release identity mismatch`);
            if (forge.kind === "gitea") {
                if (!Array.isArray(release.assets))
                    throw new Error(`${forge.name} release lists no assets`);
                return { assets: release.assets, store };
            }
            if (Array.isArray(release.assets) && release.assets.length < 100)
                return { assets: release.assets, store };
            const assets = [];
            for (let page = 1; page <= 100; page++) {
                const url = `${base}/${manifest[1]}/${manifest[2]}/releases/${release.id}/assets?per_page=100&page=${page}`;
                const batch = (await retryMetadata((signal) => forgeJson(forge, url, signal))).body;
                if (!Array.isArray(batch) || batch.length > 100)
                    throw new Error(`invalid ${forge.name} asset listing`);
                assets.push(...batch);
                if (batch.length < 100) return { assets, store };
            }
            throw new Error(`${forge.name} asset listing exceeds page limit`);
        })();
        cache.set(api, pending);
    }
    const listed = await pending;
    if (record) record.store = listed.store;
    const matches = listed.assets.filter((entry) => entry.browser_download_url === assetUrl);
    if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id) || matches[0].id <= 0)
        throw new Error(`${forge.name} release asset digest unavailable or ambiguous`);
    const digest = matches[0].digest;
    if (digest === undefined || digest === null || digest === "") {
        if (forge.kind === "gitea") return undefined;
        throw new Error(`${forge.name} release asset digest unavailable or ambiguous`);
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(digest))
        throw new Error(`${forge.name} release asset digest unavailable or ambiguous`);
    return digest.slice(7);
}

/** Retry transient metadata requests with bounded time per attempt. */
export async function retryMetadata(action) {
    for (let attempt = 0; ; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
        try {
            return await action(controller.signal);
        } catch (error) {
            if (
                !(error.retryable || controller.signal.aborted) ||
                attempt === DOWNLOAD_ATTEMPTS - 1
            )
                throw error;
        } finally {
            clearTimeout(timeout);
        }
        await new Promise((resolve) =>
            setTimeout(
                resolve,
                DOWNLOAD_DELAY_MS * 2 ** attempt + Math.floor(Math.random() * DOWNLOAD_JITTER_MS),
            ),
        );
    }
}

/** Hash an index without buffering it in memory. */
async function indexDigest(file) {
    const handle = await fs.promises.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_INDEX_BYTES)
            throw new Error("content index is not a regular file within the size limit");
        const hash = createHash("sha256");
        let size = 0;
        for await (const chunk of handle.createReadStream({ autoClose: false })) {
            size += chunk.length;
            if (size > MAX_INDEX_BYTES) throw new Error("content index exceeds size limit");
            hash.update(chunk);
        }
        return hash.digest("hex");
    } finally {
        await handle.close();
    }
}

/** The largest receipt, in bytes, that is read. */
const MAX_RECEIPT_BYTES = 16 * 1024;
/** The largest stored manifest, in bytes, that is read. */
const MAX_STORED_MANIFEST_BYTES = 2 * 1024 * 1024;

/**
 * Read a small cache file without following a symlink.
 *
 * @param {string} file - The file.
 * @param {number} maxBytes - The largest size read.
 * @returns {{missing: true}|{unusable: string}|{bytes: Buffer}} The file's bytes, its absence, or
 *   why it is not a plain regular file within the limit.
 */
function readGuarded(file, maxBytes) {
    let fd;
    try {
        fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const stat = fs.fstatSync(fd);
        if (!stat.isFile()) return { unusable: "it is not a regular file" };
        if (stat.size > maxBytes) return { unusable: `it is larger than ${maxBytes} bytes` };
        return { bytes: fs.readFileSync(fd) };
    } catch (error) {
        if (error.code === "ENOENT") return { missing: true };
        if (error.code === "ELOOP") return { unusable: "it is a symbolic link" };
        return { unusable: `it cannot be read (${error.code ?? "error"})` };
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
}

/** A dependency's receipt, or undefined when it is absent or unusable. */
function readMarker(dir) {
    const read = readGuarded(path.join(dir, STAMP), MAX_RECEIPT_BYTES);
    if (!read.bytes) return undefined;
    try {
        return JSON.parse(read.bytes.toString("utf8"));
    } catch {
        return undefined;
    }
}

/** Reuse a checksum only when its source identity and materialized bytes verify. */
async function verifiedMetadataDigest(dir, source, marker = readMarker(dir)) {
    try {
        if (
            !marker ||
            !/^[0-9a-f]{64}$/.test(marker.sha256 ?? "") ||
            marker.file !== `${marker.sha256}.jsonl` ||
            !marker.source ||
            Object.keys(source).some((key) => marker.source[key] !== source[key])
        )
            return undefined;
        return (await indexDigest(path.join(dir, marker.file))) === marker.sha256 ?
                marker.sha256
            :   undefined;
    } catch {
        return undefined;
    }
}

/**
 * The pin receipt of a content index that its forge publishes without a digest.
 *
 * The first download of such an index is trusted over HTTPS, and its checksum is
 * recorded in one receipt per identity: the forge origin, the build mirror (or
 * none), the dependency and the declared manifest URL. The version the manifest
 * reports and the index URL it advertises are recorded in it and compared, never
 * part of the identity, so a republished release cannot step outside the pin.
 * Only a missing receipt means that nothing is pinned.
 */
function pinFile(config, rel, forge, declaredUrl) {
    const identity = {
        forge: forge.origin,
        mirror: rel.buildManifest ?? null,
        id: rel.id,
        manifest: declaredUrl,
    };
    const name = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
    return { identity, file: path.join(config.paths.metadataCache, ".pins", `${name}.json`) };
}

/** The sentence that says how to accept a legitimately republished release. */
const repinAdvice = (file) =>
    `To accept the release as it is now published, delete the pin receipt ${file} and fetch again.`;

/**
 * Read a pin receipt, refusing every receipt that is present but unusable.
 *
 * @returns {{version: string, index: string, sha256: string}|undefined} The pin, or undefined
 *   when no receipt exists.
 */
function readPin({ identity, file }, rel) {
    const read = readGuarded(file, MAX_RECEIPT_BYTES);
    if (read.missing) return undefined;
    const refuse = (why) => {
        const error = new Error(
            `${rel.id}: the pin receipt ${file} is unusable (${why}). Nothing was cached or recorded. To accept the release as it is now published, delete that receipt and fetch again.`,
        );
        error.showAsIs = true;
        return error;
    };
    if (!read.bytes) throw refuse(read.unusable);
    let pin;
    try {
        pin = JSON.parse(read.bytes.toString("utf8"));
    } catch {
        throw refuse("it is not valid JSON");
    }
    if (
        !pin ||
        typeof pin !== "object" ||
        !/^[0-9a-f]{64}$/.test(pin.sha256 ?? "") ||
        typeof pin.version !== "string" ||
        typeof pin.index !== "string" ||
        JSON.stringify(pin.identity) !== JSON.stringify(identity)
    )
        throw refuse("it does not describe this release");
    return pin;
}

/**
 * Record a pin receipt, creating it exclusively.
 *
 * The receipt is written to a freshly created, unpredictable temporary file and
 * linked into place, which fails when a receipt exists. Where hard links are not
 * supported, the receipt is created in place with `O_EXCL`, which fails the same
 * way; a reader that meets a half-written receipt in that window refuses it. A run that loses the race
 * compares its pin with the one that won and is refused when they differ.
 *
 * @throws {Error} When another fetch pinned a different release first.
 */
function writePin(pinned, rel, pin) {
    const { identity, file } = pinned;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const body = JSON.stringify({ identity, ...pin });
    const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
    const fd = fs.openSync(
        temporary,
        fs.constants.O_WRONLY |
            fs.constants.O_CREAT |
            fs.constants.O_EXCL |
            fs.constants.O_NOFOLLOW,
        0o600,
    );
    try {
        try {
            fs.writeFileSync(fd, body);
        } finally {
            fs.closeSync(fd);
        }
        try {
            fs.linkSync(temporary, file);
        } catch (error) {
            // A filesystem without hard links creates the receipt itself, still
            // exclusively, so an existing receipt is never overwritten.
            if (!["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV"].includes(error.code))
                throw error;
            const direct = fs.openSync(
                file,
                fs.constants.O_WRONLY |
                    fs.constants.O_CREAT |
                    fs.constants.O_EXCL |
                    fs.constants.O_NOFOLLOW,
                0o600,
            );
            try {
                fs.writeFileSync(direct, body);
            } finally {
                fs.closeSync(direct);
            }
        }
    } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const winner = readPin(pinned, rel);
        if (
            winner?.sha256 !== pin.sha256 ||
            winner.version !== pin.version ||
            winner.index !== pin.index
        ) {
            const refusal = new Error(
                `${rel.id}: another fetch pinned a different content index for this release first. ${repinAdvice(file)}`,
            );
            refusal.showAsIs = true;
            throw refusal;
        }
    } finally {
        fs.rmSync(temporary, { force: true });
    }
}

/**
 * Hold a fetch to its pin.
 *
 * @param {{version: string, index: string, sha256: string}} pin - The pin.
 * @param {string} file - The pin receipt's path.
 * @param {{version: string, index: string, digest?: string}} now - What the release publishes now.
 * @throws {Error} When the release changed after it was pinned.
 */
function checkPin(pin, file, rel, now) {
    const changed = (what) => {
        const error = new Error(
            `the release changed after its content index was pinned: ${what}. ${repinAdvice(file)}`,
        );
        error.showAsIs = true;
        return error;
    };
    if (now.version !== pin.version)
        throw changed(`it now reports version ${now.version}, not ${pin.version}`);
    if (now.index !== pin.index) throw changed(`it now advertises ${now.index}, not ${pin.index}`);
    if (now.digest !== undefined && now.digest !== pin.sha256)
        throw changed("the forge now publishes a different digest for the index");
}

const MANIFEST_RECORD = "manifest.json";

/**
 * A dependency's manifest and index as a finished fetch left them, when the
 * receipt names this source, the index bytes match the receipt and the stored
 * manifest matches its recorded checksum.
 */
async function storedMetadata(dir, source) {
    const marker = readMarker(dir);
    const sha256 = await verifiedMetadataDigest(dir, source, marker);
    if (!sha256) return undefined;
    try {
        const read = readGuarded(path.join(dir, MANIFEST_RECORD), MAX_STORED_MANIFEST_BYTES);
        if (
            !read.bytes ||
            !/^[0-9a-f]{64}$/.test(marker.manifestSha256 ?? "") ||
            createHash("sha256").update(read.bytes).digest("hex") !== marker.manifestSha256
        )
            return undefined;
        const manifest = JSON.parse(read.bytes.toString("utf8"));
        if (
            manifest.version !== source.version ||
            manifest.flags?.metadataUrl !== marker.source.index
        )
            return undefined;
        return {
            file: path.join(dir, marker.file),
            manifest,
            sha256,
            index: marker.source.index,
        };
    } catch {
        return undefined;
    }
}

/** Atomically publish a verified index and its exact checksum source identity. */
function markVerifiedMetadataComplete(dir, file, sha256, source, manifest) {
    const temporary = fs.mkdtempSync(path.join(dir, ".marker-"));
    try {
        const manifestBytes = JSON.stringify(manifest);
        fs.writeFileSync(path.join(dir, MANIFEST_RECORD), manifestBytes);
        const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
        fs.writeFileSync(
            path.join(temporary, STAMP),
            JSON.stringify({ file, sha256, source, manifestSha256 }),
        );
        fs.renameSync(path.join(temporary, STAMP), path.join(dir, STAMP));
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
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
        if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
            throw new Error(`archive entry escapes the destination: ${name}`);
        }
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, bytes);
    }
}

/**
 * The file name an extracted document is written under.
 *
 * The extractor names a file from the document's database key, which a
 * downloaded pack controls. The name is built here instead, from the document's
 * id, which must be one plain token, and its name with every character outside
 * letters and digits replaced, so it holds no separator and no leading dot. A
 * document that is named and one that is not get the names the extractor gives
 * them for an ordinary id.
 *
 * @param {{_id?: unknown, _key?: unknown, name?: unknown}} doc - The document.
 * @param {string} out - The directory the file is written into.
 * @param {string} where - What the diagnostic calls the pack.
 * @returns {string} The file name.
 */
function extractedName(doc, out, where) {
    requirePathToken(
        doc._id,
        `${where} holds a document whose id ${JSON.stringify(doc._id)} is not one plain name`,
    );
    const collection = String(doc._key ?? "").split("!")[1] ?? "";
    const name =
        typeof doc.name === "string" && doc.name ?
            `${doc.name.replace(/[^a-zA-Z0-9А-я]/g, "_").slice(0, 200)}_${doc._id}.json`
        :   `!${collection}!${doc._id}.json`;
    if (!/^[A-Za-z]+$/.test(collection) || path.relative(out, path.join(out, name)) !== name)
        throw new Error(`${where} holds a document that cannot be extracted under a plain name`);
    return name;
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
async function extractItemPacks(id, version, manifest, root, dir, from) {
    const itemPacks = (manifest.packs ?? []).filter((pack) => pack.type === "Item");
    if (!itemPacks.length) {
        throw new Error(
            `${id}@${version}: its manifest declares no Item packs, so it ` +
                `cannot supply an item catalogue`,
        );
    }
    // Loaded here so importing the content index does not load the extractor.
    const { extractPack } = await import("@foundryvtt/foundryvtt-cli");
    for (const pack of itemPacks) {
        requirePathToken(
            pack.name,
            `${id}@${version}: its manifest ${from} declares the Item pack ${JSON.stringify(pack.name)}, which is not one plain name`,
        );
        const src = resolvePackPath(root, pack.path, `${id}@${version}: pack "${pack.name}"`);
        if (!src) {
            throw new Error(
                `${id}@${version}: pack "${pack.name}" is declared at ` +
                    `${pack.path}, which the package does not contain`,
            );
        }
        const out = path.join(dir, "items", pack.name);
        fs.mkdirSync(out, { recursive: true });
        await extractPack(src, out, {
            log: false,
            transformName: (doc) =>
                extractedName(doc, out, `${id}@${version}: pack "${pack.name}" of ${from}`),
        });
        const realItems = fs.realpathSync(path.join(dir, "items"));
        const realOut = path.relative(realItems, fs.realpathSync(out));
        if (realOut === ".." || realOut.startsWith(`..${path.sep}`) || path.isAbsolute(realOut))
            throw new Error(
                `${id}@${version}: pack "${pack.name}" of ${from} was extracted outside the cache`,
            );
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
 * @param {string|undefined} token - The mirror credential.
 * @param {object} rel - The dependency relationship being fetched.
 * @returns {Promise<void>}
 */
async function downloadAndUnzip(url, dest, token, rel) {
    const bytes = await fetchBytes(
        url,
        `${rel.id}: could not download ${url}`,
        token,
        !!rel.buildManifest,
    );
    writeZipEntries(unzipSync(bytes), dest);
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
 * Resolve a release asset against the declared build mirror.
 *
 * @param {string} asset - The asset advertised by the published manifest.
 * @param {string} manifest - The pinned published manifest URL.
 * @param {string|undefined} mirror - The pinned build manifest URL.
 * @returns {string} The URL to fetch.
 */
export function mirroredAssetUrl(asset, manifest, mirror) {
    if (!mirror) return asset;
    const original = new URL(manifest);
    const target = new URL(asset);
    const copy = new URL(mirror);
    const dir = original.pathname.slice(0, original.pathname.lastIndexOf("/") + 1);
    const name = target.pathname.slice(dir.length);
    if (
        target.origin !== original.origin ||
        !target.pathname.startsWith(dir) ||
        !name ||
        name.includes("/") ||
        /%|\\/.test(name) ||
        target.search ||
        target.hash ||
        target.username ||
        target.password
    ) {
        throw new Error(`asset ${asset} is not beside its manifest ${manifest}`);
    }
    copy.pathname = copy.pathname.slice(0, copy.pathname.lastIndexOf("/") + 1) + name;
    return copy.href;
}

/**
 * Resolve a dependency's manifest, pinned to `compatibility.verified`.
 *
 * @param {{id: string, manifest: string, buildManifest?: string, verified?: string}} rel - The
 *   declared relationship.
 * @returns {Promise<{manifest: object, version: string}>} The manifest and
 *   its resolved version.
 */
async function resolveManifest(rel, forge = resolveForge()) {
    const pin = pinnedManifestUrl(rel.manifest, rel.verified);
    const pinned = pin.pinned;
    const url = forgeAssetUrl(forge, pin.url);
    const manifest = await fetchManifest(
        rel.buildManifest ?? url,
        downloadToken(rel, forge, rel.buildManifest ?? url),
        rel,
    );
    const version = manifest.version;
    if (!version) {
        throw new Error(`${rel.id}: its manifest declares no \`version\``);
    }
    if ((!pinned || rel.buildManifest) && rel.verified && version !== rel.verified) {
        throw new Error(
            `${rel.id}: declares \`compatibility.verified: ${rel.verified}\` but ` +
                `${rel.buildManifest ?? url} offers ${version}. Building against a moving target is ` +
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
    return { manifest, version };
}

/**
 * Fetch one dependency and extract its Item packs.
 *
 * A complete catalogue cache is reused for the resolved version.
 *
 * @param {object} config - The resolved build configuration.
 * @param {{id: string, manifest: string, buildManifest?: string, verified?: string}} rel - The declared relationship.
 * @returns {Promise<string>} The dependency's cache directory.
 */
export async function fetchCatalog(config, rel) {
    const forge = await readyForge();
    const { manifest, version } = await resolveManifest(rel, forge);
    requirePathToken(
        version,
        versionMessage(
            `${rel.id}: its manifest ${rel.buildManifest ?? rel.manifest} reports version`,
            version,
        ),
    );
    const dir = catalogDir(config, rel.id, version);
    if (isComplete(dir)) {
        log.info(`${rel.id}@${version}: already cached`);
        return dir;
    }

    const download =
        manifest.download &&
        mirroredAssetUrl(
            forgeAssetUrl(forge, manifest.download),
            forgeAssetUrl(forge, pinnedManifestUrl(rel.manifest, rel.verified).url),
            rel.buildManifest,
        );
    if (!download) {
        throw new Error(`${rel.id}@${version}: its manifest declares no \`download\``);
    }

    // Rebuild from empty: a previous run may have died partway, and a stale
    // half-tree is worse than no tree.
    fs.rmSync(dir, { recursive: true, force: true });
    const raw = path.join(dir, "package");
    fs.mkdirSync(raw, { recursive: true });

    log.info(`${rel.id}@${version}: downloading ${download}`);
    await downloadAndUnzip(download, raw, downloadToken(rel, forge, download), rel);

    await extractItemPacks(rel.id, version, manifest, raw, dir, rel.buildManifest ?? rel.manifest);
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
 * @param {string} [label] - What the diagnostic calls the pack.
 * @returns {string|null} The directory, or null when absent.
 * @throws {Error} When the path resolves outside the root, symbolic links included.
 */
export function resolvePackPath(root, packPath, label = "pack") {
    if (typeof packPath !== "string" || packPath === "" || packPath.includes("\0"))
        throw new Error(`${label} declares no usable path`);
    const realRoot = fs.realpathSync(root);
    const inside = (candidate) => {
        const real = fs.realpathSync(candidate);
        const relative = path.relative(realRoot, real);
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
            throw new Error(
                `${label} is declared at ${packPath}, which resolves outside the unpacked package`,
            );
        return candidate;
    };
    const direct = path.join(root, packPath);
    if (fs.existsSync(direct)) return inside(direct);
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const nested = path.join(root, entry.name, packPath);
        if (fs.existsSync(nested)) return inside(nested);
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

    const staging = fs.mkdtempSync(path.join(os.tmpdir(), `package-build-${rel.id}-`));
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

        requirePathToken(
            version,
            versionMessage(`${rel.id}: the manifest in ${source} reports version`, version),
        );
        const dir = catalogDir(config, rel.id, version);
        fs.rmSync(dir, { recursive: true, force: true });
        await extractItemPacks(rel.id, version, manifest, root, dir, source);
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
 * The relationship names the dependency's manifest, which advertises
 * `flags.metadataUrl`. A build mirror supplies the same release assets.
 *
 * Pinned by the same rule as the catalogue: `compatibility.verified` is the
 * version this repository was built against, so a floating `releases/latest`
 * URL is rewritten to it. A consumer resolving addresses against whatever the
 * dependency published this morning is not reproducible.
 *
 * A matching verified cache receipt supplies the checksum; a miss reads it from the chosen forge.
 * The shared cache is verified before use.
 *
 * @param {object} config - The resolved build configuration.
 * @param {{id: string, manifest: string, buildManifest?: string, verified?: string}} rel - The declared
 *   relationship.
 * @returns {Promise<string>} The cached index file.
 */
export async function fetchMetadata(config, rel) {
    return (await fetchMetadataWithManifest(config, rel)).file;
}

/**
 * Fetch one dependency's content index and return it with the manifest it was
 * read through, so a caller can follow the manifest's own requirement edges.
 *
 * @param {object} config - The resolved build configuration.
 * @param {{id: string, manifest: string, verified?: string}} rel - The declared
 *   relationship.
 * @returns {Promise<{file: string, manifest: object}>} The cached index file
 *   and the parsed manifest.
 */
async function fetchMetadataWithManifest(config, rel, releaseCache = new Map()) {
    const forge = resolveForge();
    if (!rel.verified && rel.manifest?.includes("/releases/latest/download/"))
        throw new Error(
            `${rel.id}: set compatibility.verified to the dependency version or use a pinned release manifest URL before package-build deps fetch`,
        );
    requirePathToken(
        rel.id,
        `${rel.id}: a dependency id must be one plain name (declared for the manifest ${rel.manifest})`,
    );
    if (rel.verified !== undefined)
        requirePathToken(
            rel.verified,
            versionMessage(
                `${rel.id}: compatibility.verified (declared for the manifest ${rel.manifest}) is`,
                rel.verified,
            ),
        );
    const declaredUrl = pinnedManifestUrl(rel.manifest, rel.verified).url;
    const url = forgeAssetUrl(forge, declaredUrl);
    const pinned = pinFile(config, rel, forge, declaredUrl);
    if (rel.verified) {
        const kept = await storedMetadata(metadataCacheDir(config, rel.id, rel.verified), {
            id: rel.id,
            version: rel.verified,
            manifest: declaredUrl,
            forge: forge.origin,
            mirror: rel.buildManifest ?? null,
        });
        if (kept) {
            if (forge.kind === "gitea" && !readPin(pinned, rel))
                writePin(pinned, rel, {
                    version: rel.verified,
                    index: kept.index,
                    sha256: kept.sha256,
                });
            log.info(`${rel.id}@${rel.verified}: content index already cached`);
            return { file: kept.file, manifest: kept.manifest };
        }
    }
    if (forge.kind === "gitea") await confirmGitea(forge);
    const token = downloadToken(rel, forge, rel.buildManifest ?? url);
    const manifest = await fetchManifest(rel.buildManifest ?? url, token, rel);
    const version = manifest.version;
    if (!version) {
        throw new Error(`${rel.id}: its manifest declares no \`version\``);
    }
    if (rel.verified && version !== rel.verified) {
        throw new Error(
            `${rel.id}: declares \`compatibility.verified: ${rel.verified}\` but ` +
                `${rel.buildManifest ?? url} offers ${version}. Building against a moving target is ` +
                `not reproducible — update \`verified\`, or point \`manifest\` ` +
                `at a pinned release.`,
        );
    }

    requirePathToken(
        version,
        versionMessage(
            `${rel.id}: its manifest ${rel.buildManifest ?? url} reports version`,
            version,
        ),
    );
    const pin = readPin(pinned, rel);
    const dir = metadataCacheDir(config, rel.id, version);
    const advertisedIndex = manifest.flags?.metadataUrl;
    const effectiveIndex = advertisedIndex && forgeAssetUrl(forge, advertisedIndex);
    const indexUrl = effectiveIndex && mirroredAssetUrl(effectiveIndex, url, rel.buildManifest);
    if (!indexUrl) {
        throw new Error(
            `${rel.id}@${version}: its manifest advertises no ` +
                `\`flags.metadataUrl\`, so it publishes no content index and ` +
                `nothing can link into it. It needs a release built with ` +
                `package-build 18 or later.`,
        );
    }

    const source = {
        id: rel.id,
        version,
        manifest: declaredUrl,
        forge: forge.origin,
        mirror: rel.buildManifest ?? null,
    };
    let expected;
    const release = {};
    try {
        forgeReleaseIdentity(forge, url, effectiveIndex);
        if (pin) checkPin(pin, pinned.file, rel, { version, index: advertisedIndex });
        const kept = await verifiedMetadataDigest(dir, { ...source, index: advertisedIndex });
        const published =
            kept ??
            (await forgeAssetDigest(forge, url, effectiveIndex, releaseCache, dir, release));
        if (pin)
            checkPin(pin, pinned.file, rel, { version, index: advertisedIndex, digest: published });
        expected = published ?? pin?.sha256;
    } catch (cause) {
        if (cause instanceof MetadataSourceError || cause.rateLimited || cause.showAsIs)
            throw new Error(`${rel.id}@${version}: ${cause.message}`);
        const status =
            cause instanceof Error ?
                /^.* release metadata request failed \(HTTP ([0-9]{3})\)$/.exec(cause.message)?.[1]
            :   undefined;
        throw new Error(
            `${rel.id}@${version}: content index ${forge.name} checksum unavailable${status ? ` (${forge.name} HTTP ${status})` : ""}`,
            token ? undefined : { cause },
        );
    }
    let cached;
    try {
        cached = await retryMetadata((signal) =>
            downloadCached(indexUrl, expected ?? null, {
                trustOnFirstUse: expected === undefined,
                token: downloadToken(rel, forge, indexUrl),
                allowLoopback: !!rel.buildManifest,
                maxBytes: MAX_INDEX_BYTES,
                signal,
            }),
        );
    } catch (cause) {
        if (pin && /SHA-256 does not match/.test(cause.message))
            throw new Error(
                `${rel.id}@${version}: the downloaded content index does not match the checksum pinned at its first download, and it was rejected. ${repinAdvice(pinned.file)}`,
            );
        throw cause;
    }
    expected ??= path.basename(cached);
    if (forge.kind === "gitea" && !pin)
        writePin(pinned, rel, { version, index: advertisedIndex, sha256: expected });
    if (release.store)
        writeReleaseRecord(dir, release.store.api, release.store.etag, release.store.release);
    fs.mkdirSync(dir, { recursive: true });
    const temporary = fs.mkdtempSync(path.join(dir, ".metadata-"));
    const file = path.join(dir, `${expected}.jsonl`);
    try {
        const staged = path.join(temporary, "index.jsonl");
        fs.copyFileSync(cached, staged);
        if ((await indexDigest(staged)) !== expected)
            throw new Error(`${rel.id}@${version}: cached content index failed verification`);
        fs.renameSync(staged, file);
        markVerifiedMetadataComplete(
            dir,
            path.basename(file),
            expected,
            { ...source, index: advertisedIndex },
            manifest,
        );
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
    return { file, manifest };
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

    const staging = fs.mkdtempSync(path.join(os.tmpdir(), `package-build-meta-${rel.id}-`));
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
        requirePathToken(
            name,
            `${rel.id}: the index name ${JSON.stringify(name)} in ${source} is not one plain file name`,
        );
        const found = findLocalIndex(root, name);
        if (!found) {
            throw new Error(
                `${rel.id}: ${source} holds no ${name}, so it publishes no ` +
                    `content index. Build it before fetching from it.`,
            );
        }

        requirePathToken(
            version,
            versionMessage(`${rel.id}: the manifest in ${source} reports version`, version),
        );
        const dir = metadataCacheDir(config, rel.id, version);
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, name);
        fs.copyFileSync(found, file);
        markMetadataComplete(dir, name);
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
 * The modules a fetched index's package record publishes as required.
 *
 * @param {string} file - The cached index file.
 * @returns {string[]} The module ids; empty when the package requires none.
 */
function publishedModules(file) {
    const modules = new Set();
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const record = JSON.parse(line);
        if (isPackageRecord(record)) for (const id of record.packageModules) modules.add(id);
    }
    return [...modules];
}

/**
 * Fetch every declared dependency's content index, and the index of every
 * module reachable from them.
 *
 * A wider set than {@link fetchAllCatalogs}: an index is fetched for *every*
 * dependency, plus every other relationship declaring `itemCatalog: true`; a
 * catalogue only for those declaring `itemCatalog: true`. See
 * {@link metadataRelationships} for why the two sets differ.
 *
 * **Follows the modules each fetched package requires, transitively.** The
 * package's own index record names them and its manifest's
 * `relationships.requires` names where each manifest lives, so a module reached
 * only through another module is fetched without being declared. Each module is
 * fetched once, which ends a cycle. A game system is fetched when declared and
 * is never followed, nor fetched when only a module requires it.
 *
 * @param {object} config - The resolved build configuration.
 * @returns {Promise<number>} How many indexes were fetched or already cached.
 */
export async function fetchAllMetadata(config) {
    const systems = systemPackages(config);
    const queue = metadataRelationships(config);
    const seen = new Set([config.contentPackage, ...queue.map((rel) => rel.id)]);
    let count = 0;
    const releaseCache = new Map();
    while (queue.length) {
        const rel = queue.shift();
        const { file, manifest } = await fetchMetadataWithManifest(config, rel, releaseCache);
        count += 1;
        if (systems.has(rel.id)) continue;
        for (const id of publishedModules(file)) {
            if (seen.has(id) || systems.has(id)) continue;
            seen.add(id);
            const edge = (manifest.relationships?.requires ?? []).find((entry) => entry.id === id);
            if (!edge?.manifest) {
                throw new Error(
                    `${rel.id}: its index requires module \`${id}\`, but its manifest's ` +
                        `\`relationships.requires\` gives no \`manifest\` URL for it, so its ` +
                        `content index cannot be fetched.`,
                );
            }
            queue.push({
                id,
                manifest: edge.manifest,
                kind: "requires",
                verified: edge.compatibility?.verified,
            });
        }
    }
    return count;
}

/**
 * Fetch every opted-in dependency. The `deps fetch` command.
 *
 *
 * @param {object} config - The resolved build configuration.
 * @returns {Promise<number>} How many dependencies were fetched.
 */
export async function fetchAllCatalogs(config) {
    const itemRels = itemCatalogRelationships(config);
    if (!itemRels.length) {
        log.info("No relationship declares `itemCatalog: true`; nothing to fetch.");
        return 0;
    }
    for (const rel of itemRels) await fetchCatalog(config, rel);
    return itemRels.length;
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
                    `fetched. Run \`package-build deps fetch\` first.`,
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
