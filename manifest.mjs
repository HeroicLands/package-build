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
 * Building the Foundry package manifest — `system.json` or `module.json`.
 *
 * Foundry defines exactly two package kinds, and a repository is one of them,
 * so there is one job here with two spellings: assemble the manifest from the
 * repository's configuration and write it into the build stage.
 *
 * **There is no template any more.** A manifest used to be a hand-authored
 * `system.template.json` that this module stamped a few fields into — which
 * made it the one build input still written as JSON, by hand, per repository,
 * with no schema and nothing checking it. Worse, it declared facts the
 * configuration also declared: the pack list twice, in two formats, with
 * nothing checking that the pairs agreed. `sohl-kethira-basic` hand-maintained
 * its whole `module.json`, and its `download` named an older version than the
 * module claimed.
 *
 * So the manifest is generated (#9). Three kinds of key end up in it:
 *
 * - **Declared** — the `packageBuild.manifest` block, emitted unchanged, so a
 *   key Foundry adds in a later version needs no release of this package.
 * - **Derived** — the identity, the version, the release addresses, the
 *   compatibility ranges and the pack list. Declaring one of these is an error
 *   rather than an override: the authored copy would be silently overwritten.
 * - **Computed** — namespaced `flags` a repository works out for itself.
 *
 * **Nothing here invents an address.** The repository URL is read from
 * `package.json`'s `repository` field, normalised, and everything else derived
 * from it. A manifest advertising another package's URLs would send Foundry to
 * the wrong release on every update check — exactly what a template copied
 * between repositories produced.
 *
 * The rules are pure functions over data. I/O is confined to
 * {@link writeManifest}, which is the only export that touches disk.
 *
 * @module
 */

import fs from "node:fs/promises";
import path from "node:path";

/**
 * The two package kinds Foundry defines, as the artifact name each one's
 * manifest and release archive are called.
 *
 * A system ships `system.json` / `system.zip`; a module ships `module.json` /
 * `module.zip`. Foundry fetches those exact names, so the pair is not a naming
 * convention this project is free to choose.
 */
export const ARTIFACTS = Object.freeze(["system", "module"]);

/**
 * The repository's web address, from whatever spelling `package.json` carries.
 *
 * npm accepts several: a plain `https://` URL, the `git+https://…​.git` form npm
 * itself writes, and a trailing slash either way. Foundry fetches
 * `<url>/releases/latest/download/<artifact>.json` literally, so a `git+` prefix
 * or a `.git` suffix left in place yields a 404 on every update check — with no
 * error anywhere, because nothing fetches that URL until a user's Foundry does.
 * `sohl-kethira-basic` declares the `git+…​.git` form today.
 *
 * @param {string|{url?: string}} repository - `package.json`'s `repository`
 *   field, in either object or shorthand-string form.
 * @returns {string} The normalised `https://` URL, with no trailing slash.
 * @throws {TypeError} When no URL can be read. A manifest with no addresses is
 *   worse than a missing one: Foundry installs it and never offers an update.
 */
export function normalizeRepoUrl(repository) {
    const raw =
        typeof repository === "string" ? repository : (repository?.url ?? "");
    const url = String(raw)
        .trim()
        .replace(/^git\+/, "")
        .replace(/\.git$/, "")
        .replace(/\/+$/, "");
    if (!url) {
        throw new TypeError(
            "package.json declares no `repository.url`, so the manifest has no " +
                "release addresses to advertise. Add it.",
        );
    }
    return url;
}

/**
 * The four addresses a Foundry manifest advertises.
 *
 * `manifest` deliberately points at **`releases/latest`** rather than at this
 * version: it is the URL an *installed* package re-fetches to discover that a
 * newer one exists, so pinning it to the version being built would freeze every
 * install at that release forever. `download` points at this exact version,
 * because that is the archive this manifest describes.
 *
 * @param {object} opts
 * @param {string} opts.repoUrl - Normalised repository URL.
 * @param {string} opts.version - The version being built.
 * @param {"system"|"module"} opts.artifact - Which artifact is shipped.
 * @returns {{url: string, bugs: string, manifest: string, download: string}}
 */
export function releaseUrls({ repoUrl, version, artifact }) {
    return {
        url: repoUrl,
        bugs: `${repoUrl}/issues`,
        manifest: `${repoUrl}/releases/latest/download/${artifact}.json`,
        download: `${repoUrl}/releases/download/v${version}/${artifact}.zip`,
    };
}

/**
 * The order the manifest's keys are written in.
 *
 * Foundry does not care, but a human reading a diff does, and the generated
 * file has to be comparable against the hand-authored template it replaces —
 * which is only possible if the order is fixed rather than incidental to which
 * keys a repository happened to declare. Anything not listed keeps its declared
 * order, after these.
 *
 * @type {readonly string[]}
 */
const MANIFEST_KEY_ORDER = Object.freeze([
    "id",
    "title",
    "description",
    "version",
    "authors",
    "license",
    "readme",
    "changelog",
    "flags",
    "compatibility",
    "relationships",
    "esmodules",
    "styles",
    "languages",
    "documentTypes",
    "packFolders",
    "packs",
    "media",
    "socket",
    "grid",
    "primaryTokenAttribute",
    "url",
    "bugs",
    "manifest",
    "download",
]);

/**
 * The manifest's `packs`, derived from the one pack list the build already has.
 *
 * The two used to be written separately — `content-build.config.yaml` declared
 * a pack's name and type, and the manifest template declared them again beside
 * a label, a path and a system id, with nothing checking that the pairs agreed.
 * They are one list now.
 *
 * Companions are flattened in, because Foundry sees no difference: a companion
 * is only a pack written by another pass rather than one of its own, and it
 * ships as an ordinary compendium. The order matches `packDirectories`, so the
 * manifest lists packs in the order the build compiles them.
 *
 * @param {object} config - The resolved content-build configuration.
 * @returns {object[]} The manifest's `packs` array.
 */
export function manifestPacks(config) {
    const flatten = (pack) => [
        pack,
        ...(pack.companions ?? []).flatMap(flatten),
    ];
    return config.packs.flatMap(flatten).map((pack) => ({
        label: pack.label,
        type: pack.type,
        name: pack.name,
        system: config.stats.systemId,
        path: `packs/${pack.name}`,
        private: pack.private,
    }));
}

/**
 * Relationship keys that direct the **build**, rather than describe the
 * package.
 *
 * `relationships` is the one manifest block with a second reader.
 * `@heroiclands/content-build` consumes it too, and v1.8.0 added
 * `itemCatalog: true` as an opt-in on a declared dependency
 * (content-build#82): it selects that package's Item packs as a resolution
 * source for the actors pass. That is an instruction to the build, not a fact
 * about the shipped package — Foundry's relationship schema does not define
 * it, and someone reading a published manifest cannot tell a build directive
 * from a declaration about what the package needs.
 *
 * So the block is filtered rather than copied whole (#29). The rule is the
 * distinction, not the name: a key listed here answers *how is this built?*,
 * and every key that survives answers *what does this package depend on?*.
 * `itemCatalog` is the first build-time key to land on a relationship and is
 * unlikely to be the last.
 *
 * A list is enough, and needs no prefix agreed between the two packages,
 * because the input is already closed: content-build normalises a relationship
 * to `id`, `type`, `manifest`, `compatibility` and its own build keys, and
 * rejects anything else at configuration time. A key that reaches here is one
 * the toolchain itself put there.
 *
 * @type {readonly string[]}
 */
export const BUILD_ONLY_RELATIONSHIP_KEYS = Object.freeze(["itemCatalog"]);

/**
 * The `relationships` block as published — every declared dependency, with the
 * build's own keys dropped.
 *
 * Shape is otherwise preserved: kinds keep their order and their entries, an
 * entry keeps its remaining keys in the order it declared them, and a block
 * carrying no build-only key comes back equal to what went in. Only
 * {@link BUILD_ONLY_RELATIONSHIP_KEYS} are removed — an unrecognised key is
 * left alone, on the same reasoning that lets a declared manifest key through
 * unread: a key Foundry adds later should not need a release of this package.
 *
 * @param {Record<string, unknown>} relationships - The declared block, as
 *   content-build resolved it.
 * @returns {Record<string, unknown>} It, without the build-only keys.
 */
export function publishedRelationships(relationships) {
    const published = {};
    for (const [kind, entries] of Object.entries(relationships)) {
        published[kind] =
            Array.isArray(entries) ? entries.map(withoutBuildKeys) : entries;
    }
    return published;
}

/**
 * One relationship entry, minus the build-only keys.
 *
 * @param {unknown} entry - A declared dependency.
 * @returns {unknown} It, filtered; anything that is not a mapping unchanged.
 */
function withoutBuildKeys(entry) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return entry;
    }
    return Object.fromEntries(
        Object.entries(entry).filter(
            ([key]) => !BUILD_ONLY_RELATIONSHIP_KEYS.includes(key),
        ),
    );
}

/**
 * Build a Foundry package manifest from the resolved configuration.
 *
 * Three kinds of key end up in the result:
 *
 * - **Declared** — everything in `packageBuild.manifest`, emitted unchanged, so
 *   a key Foundry adds later needs no release of this package.
 * - **Derived** — the identity, the release addresses, the version, the Foundry
 *   and system compatibility ranges, and the pack list. These are refused if
 *   also declared: an authored copy would be overwritten and the two would
 *   disagree with nothing to say so.
 * - **Computed** — namespaced `flags` a repository works out for itself, merged
 *   over any it declared.
 *
 * `relationships` is derived but not copied whole: the keys that direct the
 * build rather than describe the package are dropped first — see
 * {@link publishedRelationships}.
 *
 * @param {object} options - Inputs.
 * @param {object} options.config - The resolved content-build configuration.
 * @param {object} options.packageJson - The repository's `package.json`.
 * @param {string} options.artifact - `system` or `module`.
 * @param {Record<string, object>} [options.flags] - Namespaced flags to merge.
 * @returns {object} The manifest, ready to serialise.
 */
export function buildManifest({ config, packageJson, artifact, flags }) {
    const declared = config.packageBuild?.manifest ?? {};
    const repoUrl = normalizeRepoUrl(packageJson.repository);

    const derived = {
        id: config.foundryPackage,
        version: packageJson.version,
        packs: manifestPacks(config),
        ...releaseUrls({ repoUrl, version: packageJson.version, artifact }),
    };
    if (config.compatibility) derived.compatibility = config.compatibility;
    if (config.relationships && Object.keys(config.relationships).length) {
        derived.relationships = publishedRelationships(config.relationships);
    }

    const merged = { ...declared, ...derived };

    if (flags && Object.keys(flags).length) {
        merged.flags = { ...(declared.flags ?? {}) };
        for (const [namespace, values] of Object.entries(flags)) {
            merged.flags[namespace] = {
                ...(declared.flags?.[namespace] ?? {}),
                ...values,
            };
        }
    }

    // Ordered, so the generated file diffs against the template it replaces.
    const ordered = {};
    for (const key of MANIFEST_KEY_ORDER) {
        if (merged[key] !== undefined) ordered[key] = merged[key];
    }
    for (const [key, value] of Object.entries(merged)) {
        if (!(key in ordered)) ordered[key] = value;
    }
    return ordered;
}

/**
 * Write the generated manifest into the staged package.
 *
 * @param {object} options - As {@link buildManifest}, plus where to write.
 * @param {object} options.config - The resolved content-build configuration.
 * @param {object} options.packageJson - The repository's `package.json`.
 * @param {string} options.artifact - `system` or `module`.
 * @param {string} options.outDir - Directory to write into.
 * @param {Record<string, object>} [options.flags] - Namespaced flags to merge.
 * @returns {Promise<{path: string, manifest: object}>} Where it went, and what.
 */
export async function writeManifest({
    config,
    packageJson,
    artifact,
    outDir,
    flags,
}) {
    const manifest = buildManifest({ config, packageJson, artifact, flags });
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `${artifact}.json`);
    // Trailing newline: the file is committed to a release archive and read by
    // humans as often as by Foundry.
    await fs.writeFile(
        outPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
    );
    return { path: outPath, manifest };
}
