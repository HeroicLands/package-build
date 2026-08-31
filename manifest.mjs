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
import fsSync from "node:fs";
import path from "node:path";

import { emitDiagnostic, positionOfYamlPath } from "./engine/diagnostics.mjs";

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
    const raw = typeof repository === "string" ? repository : (repository?.url ?? "");
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
 * The two used to be written separately — `package-build.config.yaml` declared
 * a pack's name and type, and the manifest template declared them again beside
 * a label, a path and a system id, with nothing checking that the pairs agreed.
 * They are one list now.
 *
 * Companions are flattened in, because Foundry sees no difference: a companion
 * is only a pack written by another pass rather than one of its own, and it
 * ships as an ordinary compendium. The order matches `packDirectories`, so the
 * manifest lists packs in the order the build compiles them.
 *
 * @param {object} config - The resolved content configuration.
 * @returns {object[]} The manifest's `packs` array.
 */
export function manifestPacks(config) {
    const flatten = (pack) => [pack, ...(pack.companions ?? []).flatMap(flatten)];
    return config.packs.flatMap(flatten).map((pack) => {
        // Foundry requires `system` on ActiveEffect, Actor and Item packs and
        // on no others, so the value is per pack: its own declaration first,
        // then the package-wide one. With neither, the key is omitted — an
        // Adventure, Scene or JournalEntry pack that declares a system is
        // hidden from every other system, which is rarely what a package that
        // declined to name one meant.
        const system = pack.system ?? config.stats.systemId;
        return {
            label: pack.label,
            type: pack.type,
            name: pack.name,
            ...(system ? { system } : {}),
            path: `packs/${pack.name}`,
            private: pack.private,
        };
    });
}

/**
 * Where a `packFolders` declaration lives in the configuration file.
 *
 * @type {readonly string[]}
 */
const PACK_FOLDERS_PATH = Object.freeze(["packageBuild", "manifest", "packFolders"]);

/**
 * Every pack name a folder tree names, with the folder that named it.
 *
 * Foundry nests pack folders three deep — `PackageCompendiumFolder` re-declares
 * itself while `depth < 4` — so a rule reading only the top level would miss
 * every nested name in both directions: a broken one it never checked, and a
 * working one it would then report as ungrouped.
 *
 * @param {unknown} folders - A `packFolders` list, or a nested `folders` list.
 * @param {Array<string|number>} at - Config key path of `folders`.
 * @returns {Array<{pack: string, folder: string, keyPath: Array<string|number>}>}
 *   One entry per named pack, in declaration order, depth first.
 */
function namedPacks(folders, at) {
    if (!Array.isArray(folders)) return [];
    const found = [];
    folders.forEach((folder, index) => {
        if (folder === null || typeof folder !== "object") return;
        const name = String(folder.name ?? "");
        const packs = Array.isArray(folder.packs) ? folder.packs : [];
        packs.forEach((pack, position) => {
            found.push({
                pack: String(pack),
                folder: name,
                keyPath: [...at, index, "packs", position],
            });
        });
        found.push(...namedPacks(folder.folders, [...at, index, "folders"]));
    });
    return found;
}

/**
 * What `packFolders` and the derived `packs[]` disagree about.
 *
 * `packFolders` is the one **declared** manifest key that names something the
 * build **derives**: every other declared key states a fact about the package
 * (`title`, `socket`, `grid`) or addresses a staged file (`esmodules`,
 * `styles`, `languages`), and a staged file is a different relation, checked
 * against the stage rather than against configuration. So this is the one place
 * a declaration can go stale against a value the build already computed — and
 * until now nothing compared them (#81).
 *
 * `HarnMaster-3-FoundryVTT` shipped the consequence: its folder named four
 * packs, three of which had not existed since the compendium was consolidated,
 * and omitted `items` — 1,577 of 1,597 documents, loose in Foundry's compendium
 * browser, with the build reporting nothing (HM3#420).
 *
 * **The two findings are not the same finding**, and giving them one severity
 * gets one of them wrong:
 *
 * - _A folder names a pack that does not exist_ is an **error**. Foundry
 *   resolves the name against the package's own packs and silently skips what
 *   it cannot find, so the declaration does nothing at all; there is no
 *   arrangement in which it is intended, and the fix is unambiguous.
 * - _A pack no folder names_ is a **warning**. It is legal and can be
 *   deliberate — a package may want one pack at the root — so failing on it
 *   would break working packages for a matter of taste. But a package that
 *   bothered to declare a folder rarely meant to leave one out, which is
 *   exactly how HM3's `items` went unnoticed.
 * - _A package declaring no folders_ says **nothing**. Everything at the root
 *   is the majority arrangement, not an omission.
 *
 * Errors come first, in declaration order, then warnings in pack order: the
 * unresolvable names are what a reader fixes, and a folder gaining a name often
 * settles a warning too.
 *
 * @param {object} options
 * @param {unknown} [options.packFolders] - The declared `packFolders`.
 * @param {ReadonlyArray<{name: string}>} [options.packs] - The derived packs,
 *   as {@link manifestPacks} returns them.
 * @returns {Array<{severity: "error"|"warning", message: string, pack: string,
 *   folder?: string, keyPath: Array<string|number>}>} The findings, ordered.
 */
export function packFolderFindings({ packFolders, packs = [] }) {
    if (!Array.isArray(packFolders) || packFolders.length === 0) return [];

    const shipped = packs.map((pack) => pack?.name).filter(Boolean);
    const known = new Set(shipped);
    const named = namedPacks(packFolders, PACK_FOLDERS_PATH);
    const grouped = new Set(named.map((entry) => entry.pack));

    const findings = named
        .filter((entry) => !known.has(entry.pack))
        .map((entry) => ({
            severity: /** @type {const} */ ("error"),
            pack: entry.pack,
            folder: entry.folder,
            keyPath: entry.keyPath,
            message:
                `packFolders: folder "${entry.folder}" names pack ` +
                `"${entry.pack}", which this package does not ship ` +
                `(packs: ${shipped.join(", ")})`,
        }));

    for (const name of shipped) {
        if (grouped.has(name)) continue;
        findings.push({
            severity: /** @type {const} */ ("warning"),
            pack: name,
            // No folder omitted it in particular — every one of them did — so
            // the position is the declaration a reader edits, not one entry
            // inside it. Each warning names its own pack, so they stay
            // distinguishable despite sharing a line.
            keyPath: [...PACK_FOLDERS_PATH],
            message:
                `packFolders: pack "${name}" is named by no folder, so it ` +
                `ships outside every folder this package declares`,
        });
    }
    return findings;
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
        published[kind] = Array.isArray(entries) ? entries.map(withoutBuildKeys) : entries;
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
        Object.entries(entry).filter(([key]) => !BUILD_ONLY_RELATIONSHIP_KEYS.includes(key)),
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
 * @param {object} options.config - The resolved content configuration.
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

    // `requiresSystem` is the gate half of the declare/require split (#48). It
    // emits the `relationships.systems` entry Foundry's `supportsSystem` reads,
    // reusing the `systems:` declaration rather than restating it — a second
    // transcription is free to disagree with what it copied, which is how
    // `stats.systemVersion` came to sit at `0.6.0` for four releases.
    //
    // Declaring a system emits nothing on its own. That is the point: a module
    // shipping content for two systems names both under `systems:`, stamps each
    // pack accordingly, and stays loadable everywhere because it requires
    // neither.
    const relationships = { ...(config.relationships ?? {}) };
    if (config.requiresSystem) {
        const declaredSystem = config.systems?.[config.requiresSystem];
        const entry = {
            id: config.requiresSystem,
            type: "system",
            ...(declaredSystem?.manifest ? { manifest: declaredSystem.manifest } : {}),
            ...(declaredSystem?.compatibility ?
                {
                    compatibility: Object.fromEntries(
                        Object.entries(declaredSystem.compatibility).filter(([, v]) => v != null),
                    ),
                }
            :   {}),
        };
        // An explicit `relationships.systems` still wins, so a repository
        // mid-migration is never told two different things about itself.
        relationships.systems = relationships.systems?.length ? relationships.systems : [entry];
    }
    if (Object.keys(relationships).length) {
        derived.relationships = publishedRelationships(relationships);
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
 * Report what {@link packFolderFindings} found, and say whether it was fatal.
 *
 * The position comes from the configuration file, when one was named and can be
 * read: a `packFolders` finding is about a line of YAML, and the file is the
 * only place a line exists. Anything that cannot be established — an `.mjs`
 * configuration, an unreadable file, a path that resolves to nothing — is
 * dropped rather than guessed, so the diagnostic degrades from
 * `file:line:column:` to `file:` to no locator at all.
 *
 * @param {ReturnType<typeof packFolderFindings>} findings - What was found.
 * @param {string} [configFile] - Absolute path of the configuration file.
 * @returns {number} How many of them were errors.
 */
function reportPackFolders(findings, configFile) {
    if (!findings.length) return 0;

    let text;
    if (configFile) {
        try {
            text = fsSync.readFileSync(configFile, "utf8");
        } catch {
            text = undefined;
        }
    }

    let errors = 0;
    for (const finding of findings) {
        if (finding.severity === "error") errors += 1;
        emitDiagnostic({
            ...(configFile ? { file: configFile } : {}),
            ...(text ? positionOfYamlPath(text, finding.keyPath) : {}),
            severity: finding.severity,
            message: finding.message,
        });
    }
    return errors;
}

/**
 * Write the generated manifest into the staged package.
 *
 * The declared `packFolders` is checked against the derived `packs[]` first,
 * and an unresolvable name **stops the write**: a manifest already known to
 * describe packs the package does not ship should not reach the stage, where
 * the next command would deploy it (#81). See {@link packFolderFindings} for
 * the rule and why its two findings carry different severities.
 *
 * @param {object} options - As {@link buildManifest}, plus where to write.
 * @param {object} options.config - The resolved content configuration.
 * @param {object} options.packageJson - The repository's `package.json`.
 * @param {string} options.artifact - `system` or `module`.
 * @param {string} options.outDir - Directory to write into.
 * @param {Record<string, object>} [options.flags] - Namespaced flags to merge.
 * @param {string} [options.configFile] - Absolute path of the configuration
 *   file the manifest was resolved from, so a finding about it can be located.
 *   Omitting it costs the position, not the finding.
 * @returns {Promise<{path: string, manifest: object}>} Where it went, and what.
 * @throws {Error} When a `packFolders` entry names a pack the package does not
 *   ship. Nothing is written in that case.
 */
export async function writeManifest({ config, packageJson, artifact, outDir, flags, configFile }) {
    const manifest = buildManifest({ config, packageJson, artifact, flags });

    const errors = reportPackFolders(
        packFolderFindings({
            packFolders: manifest.packFolders,
            packs: manifest.packs,
        }),
        configFile,
    );
    if (errors) {
        throw new Error(
            `packFolders names ${errors} pack${errors === 1 ? "" : "s"} this ` +
                `package does not ship (reported above). Foundry skips a name ` +
                `it cannot resolve, so the folder would ship missing those ` +
                `packs — correct \`packageBuild.manifest.packFolders\`.`,
        );
    }

    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `${artifact}.json`);
    // Trailing newline: the file is committed to a release archive and read by
    // humans as often as by Foundry.
    await fs.writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return { path: outPath, manifest };
}
