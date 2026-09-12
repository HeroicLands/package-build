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
 * through.
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

import { formatDiagnostic, positionOfLiteral } from "./diagnostics.mjs";
import { PACKAGE_BASE, readCanonicalKey, resolvePackageUrl } from "./content-address.mjs";

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
 * item references; a package citing addresses
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
    return cachedMetadataIndexes(config).map((entry) => entry.file);
}

/**
 * The same fetched indexes, each paired with the package that published it.
 *
 * The id is what a SQL content table addresses a dependency's notes by
 * (`FROM sohl.notes`), so the pairing has to survive the lookup —
 * {@link cachedMetadataFiles} drops it, and a caller reconstructing the id from
 * the file name would be parsing a path to recover something the declaration
 * already stated.
 *
 * @param {object} config - The resolved build configuration.
 * @returns {Array<{id: string, file: string}>} One entry per declared
 *   dependency.
 * @throws {Error} When a declared dependency has not been fetched.
 */
export function cachedMetadataIndexes(config) {
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
        files.push({ id: rel.id, file: newestIndex(cached) });
    }
    return files;
}

/**
 * The newest cached version among several version-keyed cache directories.
 *
 * Versions are compared **numerically per segment**, not as strings: a plain
 * sort puts `0.8.10` before `0.8.2`, so a build that had cached both would
 * silently resolve against the older one. A fetch always writes the currently
 * declared version, so several present at once means an earlier pin was left
 * behind rather than that a choice is genuinely open.
 *
 * **Both version-keyed caches under `build/cache` choose this way** — the
 * content index here and the item catalogue in
 * {@link module:engine/foreign-catalog} — so the comparison lives in one place
 * rather than being written once per cache. Two copies would be two chances to
 * get it wrong, and the wrong answer is invisible: every cached version is a
 * complete, stamped, perfectly valid artifact, so picking the older one reports
 * nothing and simply resolves against stale data.
 *
 * @param {string[]} dirs - Complete cache directories, named `<id>@<version>`.
 * @returns {string} The newest one.
 */
export function newestVersionDir(dirs) {
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
    return sorted[sorted.length - 1];
}

/**
 * The index file of the newest cached version among several.
 *
 * @param {string[]} dirs - Complete cache directories, named `<id>@<version>`.
 * @returns {string} The newest one's index file.
 */
function newestIndex(dirs) {
    const dir = newestVersionDir(dirs);
    const entries = fs.readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
    if (!entries.length) {
        throw new Error(`${dir} was fetched but holds no index file`);
    }
    return path.join(dir, entries[0]);
}

/**
 * Resolve every foreign address this build can cite, from the fetched indexes.
 *
 * The replacement for the vendored link manifest, and deliberately the same
 * return shape — a `Map` from canonical address to `{ url, name, uuid, … }` —
 * so a foreign entry and a local one stay interchangeable at the point of use.
 * What changed is where the data comes from: a file the producer published,
 * not a copy a consumer committed.
 *
 * **A package this build publishes is skipped**, however it got into the cache.
 * A build is authoritative in its own addresses, and reading them back from a
 * fetched artifact would let a stale copy overrule the tree that is being
 * compiled right now. It is also what stops a cycle forming: the mutual
 * vendoring this replaces deadlocked because each package had to read the
 * other's file before it could publish its own.
 *
 * **Nothing here can be stale.** The version gate the manifest needed existed
 * because a vendored copy could sit at any age; a fetched index is pinned to
 * the version the relationship declares, so `stale` now reports only what is
 * genuinely unusable — an unreadable file, or a package with pages and no base
 * to serve them from.
 *
 * @param {object} config - The resolved build configuration.
 * @param {Iterable<string>} localPackages - Packages this build publishes.
 * @param {Record<string, string>} [bases] - Where each package is served.
 * @returns {{index: Map<string, object>, packages: Set<string>,
 *   stale: Array<{package: string, reason: string}>}} The resolved addresses,
 *   which packages contributed, and what could not be read.
 */
export function loadForeignIndexes(config, localPackages, bases = PACKAGE_BASE) {
    const local = new Set(localPackages);
    const index = new Map();
    const packages = new Set();
    const stale = [];

    for (const file of cachedMetadataFiles(config)) {
        let records;
        try {
            records = fs
                .readFileSync(file, "utf8")
                .split("\n")
                .filter((line) => line.trim())
                .map((line) => JSON.parse(line));
        } catch (err) {
            stale.push({ package: packageOfCache(file), reason: `unreadable: ${err.message}` });
            continue;
        }

        const pkg = records[0]?.package ?? packageOfCache(file);
        if (local.has(pkg)) continue;

        // A base is only needed to resolve a page *URL*, so a pack-only
        // dependency — Foundry addresses and no site, which `kethira` is by
        // licensing rather than by accident — needs none. Demanding one would
        // make its documents uncitable from anywhere, which is a worse answer
        // than citing them by UUID and rendering the prose unlinked.
        //
        // So an absent base degrades rather than fails: every entry keeps its
        // `uuid` and simply has no `url`, exactly as a consumer must already
        // tolerate for an entry that compiles into no document.
        const base = bases?.[pkg];
        const web = typeof base === "string" && base.length > 0;

        for (const record of records) {
            const key = record?.address?.canonical;
            if (!key) continue;
            const parts = readCanonicalKey(key);
            if (!parts) continue;
            // First writer wins, so two packages claiming one address cannot
            // make the build depend on the order the cache was read in.
            if (index.has(key)) continue;
            const foundry = record.foundry?.[parts.system];
            index.set(key, {
                name: record.name?.full ?? record.name,
                // Absent where the package publishes no page for it. A consumer
                // must tolerate that rather than invent an href, exactly as it
                // already tolerates an entry with no `uuid`.
                url:
                    web && record.address.slug ?
                        resolvePackageUrl(`${record.address.slug}/`, base)
                    :   undefined,
                uuid: foundry?.uuid,
                doc: record.documentation ?? undefined,
                anchors: foundry?.anchors,
                type: parts.type,
                package: pkg,
            });
        }
        packages.add(pkg);
    }

    return { index, packages, stale };
}

/**
 * Which package a cached index belongs to, read from its directory name.
 *
 * Used only to name a package in a diagnostic when its records could not be
 * read — the authoritative answer is the `package` field the records carry.
 *
 * @param {string} file - The cached index file.
 * @returns {string} The dependency id.
 */
function packageOfCache(file) {
    return path.basename(path.dirname(file)).split("@")[0];
}

/**
 * Where a dependency's fetched index sits, for naming it in a diagnostic.
 *
 * Best effort: the newest complete cache for that package, or the directory it
 * would occupy. A finding has to name *a* file even when the cache is in the
 * state the finding is about.
 *
 * @param {object} config - The resolved build configuration.
 * @param {string} pkg - The dependency's package id.
 * @returns {string} A path to name in a diagnostic.
 */
export function cachedIndexPath(config, pkg) {
    const root = config?.paths?.metadataCache ?? "build/cache/metadata";
    try {
        const dirs = fs
            .readdirSync(root)
            .filter((name) => name.startsWith(`${pkg}@`))
            .map((name) => path.join(root, name))
            .filter(isComplete);
        if (dirs.length) {
            const dir = dirs.sort()[dirs.length - 1];
            const file = fs.readdirSync(dir).find((n) => n.endsWith(".jsonl"));
            if (file) return path.join(dir, file);
        }
    } catch {
        // The cache is missing or unreadable, which is often the very thing
        // being reported. The conventional path is all that can be named.
    }
    return path.join(root, `${pkg}@<version>`, metadataFileName(pkg));
}

/**
 * Whether a fetched index can still be *addressed*, as distinct from read.
 *
 * A consumer resolves cross-package links by canonical key, so it needs both
 * sides to agree on the key's shape. When they drift the lookup cannot match on
 * *any* input — and because a miss is indistinguishable from a typo, the
 * symptom is a pile of dead addresses blamed on the notes that cite them rather
 * than on the index at fault. A package whose every key is unreadable is
 * therefore reported against the index, once, instead of once per citing note.
 *
 * The realistic cause is a version skew: a dependency released before the
 * address grammar gained its `<system>` segment ships three-segment keys.
 * Re-fetching after that dependency releases is the fix.
 *
 * @param {Map<string, object>} foreignIndex - The resolved foreign index.
 * @returns {Array<{package: string, entries: number, sampleKey: string}>} One
 *   finding per drifted package, in the order the index first names each.
 */
export function unaddressableForeignPackages(foreignIndex) {
    const byPackage = new Map();
    for (const [key, value] of foreignIndex ?? new Map()) {
        // The package is read from the entry rather than the key, since the key
        // is the very thing under suspicion — deriving it from a shape that may
        // not parse would report the finding against `undefined`.
        const pkg = value?.package;
        if (!pkg) continue;
        const seen = byPackage.get(pkg) ?? { entries: 0, readable: 0, sampleKey: key };
        seen.entries += 1;
        if (readCanonicalKey(key)) seen.readable += 1;
        byPackage.set(pkg, seen);
    }

    const findings = [];
    for (const [pkg, seen] of byPackage) {
        if (seen.entries > 0 && seen.readable === 0) {
            findings.push({ package: pkg, entries: seen.entries, sampleKey: seen.sampleKey });
        }
    }
    return findings;
}

/**
 * One finding, in the standard `file:line:column: severity: message` form.
 *
 * The position is recovered by locating the offending key in the index text:
 * the finding is about a literal the reader can see in the file, so its
 * position is implicit rather than absent. When the file cannot be read, or the
 * key is not in it, the locator degrades to the file alone — a dropped field,
 * never a guessed `1:1` that would send the reader to the top of a large file
 * for a finding that is not there.
 *
 * @param {{package: string, entries: number, sampleKey: string}} finding - One
 *   finding from {@link unaddressableForeignPackages}.
 * @param {object} config - The resolved build configuration.
 * @returns {string} The formatted diagnostic, path first on the line.
 */
export function formatUnaddressableFinding(finding, config) {
    const file = cachedIndexPath(config, finding.package);
    let at = {};
    try {
        at = positionOfLiteral(fs.readFileSync(file, "utf8"), `"${finding.sampleKey}"`);
    } catch {
        // Unreadable here is not itself the finding — the loader already
        // reports that. The file is simply all that is known about where this
        // one is.
    }
    return formatDiagnostic({
        file,
        ...at,
        severity: "error",
        message:
            "no key in this content index is a canonical " +
            `\`package-system-type-shortcode\` address (${finding.entries} ` +
            `${finding.entries === 1 ? "entry" : "entries"}, none addressable; ` +
            `first is \`${finding.sampleKey}\`) — every cross-package link to ` +
            `${finding.package} would resolve to nothing, silently`,
    });
}
