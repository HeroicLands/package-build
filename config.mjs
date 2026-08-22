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
 * The per-repository configuration this package reads.
 *
 * **One repository, one configuration file.** A repository already declares
 * itself in `content-build.config.yaml`, and two of the values this package
 * needs — `packageKind` and `foundryPackage` — are already in it. A second file
 * would restate them, which is two places for one fact; that is precisely what
 * every consumer's `push-stage.mjs` did, hard-coding `packageKind: "systems"`
 * and `packageId: "sohl"` beside a config that already said both.
 *
 * So this package reads the *same* file, through content-build's loader, and
 * takes its own settings from the reserved `packageBuild:` section. The two
 * packages split by **input** — content-build reads the content tree, this one
 * reads `lang/`, `styles/`, `src/`, the assets and the manifest template — and
 * neither validates the other's keys. content-build checks that the section is
 * a mapping and hands it back frozen; everything inside it is validated here.
 *
 * **The dependency runs one way.** This package depends on content-build;
 * content-build must never depend on this one. It is the same direction the
 * loader already implies, and keeping it means content-build stays usable by a
 * repository that ships content and no Foundry package at all.
 *
 * ```yaml
 * # content-build.config.yaml
 * packageKind: systems       # read from the top level, not restated below
 * foundryPackage: sohl
 *
 * packageBuild:
 *     assets:
 *         - { from: lang, to: lang }
 *         - { from: assets/icons, to: assets/icons }
 *     assetTransform: ./utils/svg-theme.mjs
 *     stageDir: build/stage
 *     clean:
 *         extra: [site/content, site/public]
 *     lang:
 *         sources: lang/*.json
 *     deploy:
 *         envPrefix: SOHL
 * ```
 *
 * @module
 */

import path from "node:path";
import { loadPackConfig } from "@heroiclands/content-build/engine/pack-config";

/** Keys the reserved section may declare. */
const SECTION_KEYS = [
    "stageDir",
    "assets",
    "assetTransform",
    "clean",
    "lang",
    "deploy",
    "release",
];
const ASSET_KEYS = ["from", "to"];
const CLEAN_KEYS = ["extra"];
const LANG_KEYS = ["sources", "help"];
const DEPLOY_KEYS = ["envPrefix"];
const RELEASE_KEYS = ["artifact"];

/**
 * The artifact name each package kind ships, so no repository states it.
 *
 * Foundry installs a system from `system.json` and a module from `module.json`;
 * the kind already says which, so `pack-release.mjs` passing
 * `{ artifact: "system" }` by hand was restating `packageKind`.
 */
const ARTIFACT_OF_KIND = Object.freeze({
    systems: "system",
    modules: "module",
});

/**
 * @param {string} where - Dotted path of the offending key.
 * @param {string} problem - What is wrong with it.
 * @returns {never}
 */
function fail(where, problem) {
    throw new TypeError(`package-build config: \`${where}\` ${problem}.`);
}

/**
 * @param {unknown} value
 * @returns {boolean} Whether it is a plain mapping.
 */
function isMapping(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} object - The mapping to check.
 * @param {readonly string[]} allowed - The keys it may declare.
 * @param {string} prefix - Dotted path prefix for the error.
 */
function rejectUnknownKeys(object, allowed, prefix) {
    for (const key of Object.keys(object)) {
        if (!allowed.includes(key)) {
            fail(
                `${prefix}${key}`,
                `is not a recognised key (expected one of: ${allowed.join(", ")})`,
            );
        }
    }
}

/**
 * @param {unknown} value
 * @param {string} where
 * @returns {string}
 */
function requireNonEmptyString(value, where) {
    if (typeof value !== "string" || value.trim() === "") {
        fail(where, "must be a non-empty string");
    }
    return /** @type {string} */ (value);
}

/**
 * One staging copy: a source path in the repository, and where it lands under
 * the staged package root.
 *
 * @typedef {object} AssetSpec
 * @property {string} from  Source path, relative to the repository root.
 * @property {string} to    Destination, relative to the staged package root.
 */

/**
 * @param {unknown} value
 * @param {number} index
 * @returns {Readonly<AssetSpec>}
 */
function normalizeAsset(value, index) {
    const where = `packageBuild.assets[${index}]`;
    if (!isMapping(value)) fail(where, "must be a mapping");
    const asset = /** @type {Record<string, unknown>} */ (value);
    rejectUnknownKeys(asset, ASSET_KEYS, `${where}.`);
    return Object.freeze({
        from: requireNonEmptyString(asset.from, `${where}.from`),
        to: requireNonEmptyString(asset.to, `${where}.to`),
    });
}

/**
 * The resolved `packageBuild` section, every optional half filled in.
 *
 * @typedef {object} PackageBuildConfig
 * @property {string} rootDir        The repository root, from content-build.
 * @property {string} packageKind    `systems` or `modules`.
 * @property {string} packageId      The Foundry package id.
 * @property {string} artifact       Derived: `system` or `module`.
 * @property {string} stageDir      The staged package root, relative to
 *                                   `rootDir`. Every asset `to:` lands under it.
 * @property {readonly Readonly<AssetSpec>[]} assets
 * @property {string|null} assetTransform  Module to load a `transform` from,
 *                                   resolved against `rootDir`. `null` when
 *                                   the repository stages assets verbatim.
 * @property {readonly string[]} cleanExtra  Directories to remove beyond the
 *                                   conventional build artifacts.
 * @property {string} langSources    Glob for the localization files to check.
 * @property {string|null} langHelp  Extra guidance printed after a failure.
 * @property {string} envPrefix      Prefix of the deploy environment variables.
 */

/**
 * Resolve a package-build configuration from an already-loaded shared one.
 *
 * Separate from {@link loadPackageBuildConfig} because this half is pure: it
 * reads no file and touches no environment, so the validation rules can be
 * described directly by a test instead of through a fixture repository on
 * disk. {@link loadPackageBuildConfig} is the same function with the loading
 * put back.
 *
 * @param {object} shared - The resolved content-build configuration.
 * @returns {Readonly<PackageBuildConfig>} The frozen configuration.
 * @throws {TypeError} When the reserved section declares something malformed.
 */
export function resolvePackageBuildConfig(shared) {
    const section = /** @type {Record<string, unknown>} */ (
        shared.packageBuild ?? {}
    );
    rejectUnknownKeys(section, SECTION_KEYS, "packageBuild.");

    if (section.assets !== undefined && !Array.isArray(section.assets)) {
        fail("packageBuild.assets", "must be a list");
    }
    const assets = (section.assets ?? []).map(normalizeAsset);

    const clean = section.clean ?? {};
    if (!isMapping(clean)) fail("packageBuild.clean", "must be a mapping");
    rejectUnknownKeys(
        /** @type {Record<string, unknown>} */ (clean),
        CLEAN_KEYS,
        "packageBuild.clean.",
    );
    const extra = /** @type {Record<string, unknown>} */ (clean).extra ?? [];
    if (!Array.isArray(extra)) {
        fail("packageBuild.clean.extra", "must be a list");
    }
    const cleanExtra = extra.map((dir, i) =>
        requireNonEmptyString(dir, `packageBuild.clean.extra[${i}]`),
    );

    const lang = section.lang ?? {};
    if (!isMapping(lang)) fail("packageBuild.lang", "must be a mapping");
    rejectUnknownKeys(
        /** @type {Record<string, unknown>} */ (lang),
        LANG_KEYS,
        "packageBuild.lang.",
    );
    const langInput = /** @type {Record<string, unknown>} */ (lang);

    const deploy = section.deploy ?? {};
    if (!isMapping(deploy)) fail("packageBuild.deploy", "must be a mapping");
    rejectUnknownKeys(
        /** @type {Record<string, unknown>} */ (deploy),
        DEPLOY_KEYS,
        "packageBuild.deploy.",
    );
    const deployInput = /** @type {Record<string, unknown>} */ (deploy);

    const release = section.release ?? {};
    if (!isMapping(release)) fail("packageBuild.release", "must be a mapping");
    rejectUnknownKeys(
        /** @type {Record<string, unknown>} */ (release),
        RELEASE_KEYS,
        "packageBuild.release.",
    );
    const releaseInput = /** @type {Record<string, unknown>} */ (release);

    return Object.freeze({
        rootDir: shared.rootDir,
        // Where the package is assembled before it is zipped or deployed. Every
        // asset destination is relative to it, so a repository's table says
        // `lang`, not `build/stage/lang` — the latter is what each consumer's
        // `copy-assets.mjs` spelled out on every row.
        stageDir:
            section.stageDir === undefined ?
                "build/stage"
            :   requireNonEmptyString(
                    section.stageDir,
                    "packageBuild.stageDir",
                ),
        packageKind: shared.packageKind,
        packageId: shared.foundryPackage,
        // Derived from the kind, which already decides it. Stating it was one
        // more literal every consumer's release script carried.
        artifact:
            releaseInput.artifact === undefined ?
                ARTIFACT_OF_KIND[
                    /** @type {"systems"|"modules"} */ (shared.packageKind)
                ]
            :   requireNonEmptyString(
                    releaseInput.artifact,
                    "packageBuild.release.artifact",
                ),
        assets: Object.freeze(assets),
        assetTransform:
            section.assetTransform === undefined ?
                null
            :   path.resolve(
                    shared.rootDir,
                    requireNonEmptyString(
                        section.assetTransform,
                        "packageBuild.assetTransform",
                    ),
                ),
        cleanExtra: Object.freeze(cleanExtra),
        langSources:
            langInput.sources === undefined ?
                "lang/*.json"
            :   requireNonEmptyString(
                    langInput.sources,
                    "packageBuild.lang.sources",
                ),
        langHelp:
            langInput.help === undefined ?
                null
            :   requireNonEmptyString(langInput.help, "packageBuild.lang.help"),
        envPrefix:
            deployInput.envPrefix === undefined ?
                "SOHL"
            :   requireNonEmptyString(
                    deployInput.envPrefix,
                    "packageBuild.deploy.envPrefix",
                ),
    });
}

/**
 * The repository's resolved package-build configuration.
 *
 * Read on call rather than at import, exactly as content-build resolves its
 * own: importing a module of this package must not require a configuration to
 * exist anywhere above it.
 *
 * @returns {Readonly<PackageBuildConfig>} The frozen configuration.
 * @throws {TypeError} When there is no configuration, or the reserved section
 *   declares something malformed.
 */
export function loadPackageBuildConfig() {
    return resolvePackageBuildConfig(loadPackConfig());
}
