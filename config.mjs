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
    "manifest",
    "manifestFlags",
    "clean",
    "lang",
    "deploy",
    "release",
    "bundle",
];

/**
 * Manifest keys a repository may **not** declare, because the build derives
 * them and would only overwrite what was written.
 *
 * Silently overwriting is the failure this list exists to prevent: a
 * `version` typed into the configuration would look authoritative, sit there
 * unread, and disagree with the shipped package forever. Declaring one is an
 * error naming the key and where the value actually comes from.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const DERIVED_MANIFEST_KEYS = Object.freeze({
    id: "`foundryPackage`, itself derived from package.json `name`",
    version: "package.json `version`",
    url: "package.json `repository`",
    bugs: "package.json `repository`",
    manifest: "package.json `repository` and the release tag",
    download: "package.json `repository` and the release tag",
    compatibility: "the top level of content-build.config.yaml",
    relationships: "the top level of content-build.config.yaml",
    packs: "the `packs` list at the top level of content-build.config.yaml",
});
const ASSET_KEYS = ["from", "to"];
const CLEAN_KEYS = ["extra"];
const LANG_KEYS = [
    "sources",
    "help",
    "primary",
    "scripts",
    "templates",
    "keyRoots",
    "references",
    "retained",
    "allow",
];
const DEPLOY_KEYS = ["envPrefix"];
const RELEASE_KEYS = ["artifact"];
const BUNDLE_KEYS = ["entry"];

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
 * Validate the manifest specification.
 *
 * **Deliberately not key-checked.** Everything a repository declares here is
 * emitted into the manifest unchanged, so a key Foundry adds in a later version
 * can be declared without waiting for a release of this package. The only rule
 * is the one that has a wrong answer rather than an unknown one: a key the
 * build *derives* must not also be authored, because the authored value would
 * be silently overwritten.
 *
 * That is also why it is its own block rather than being spread across
 * `packageBuild:` directly — pass-through and unknown-key checking cannot
 * coexist in one mapping, and the keys around it are worth checking.
 *
 * @param {unknown} value - The `manifest` block, or `undefined`.
 * @returns {Readonly<Record<string, unknown>>} It, frozen; `{}` when absent.
 */
function normalizeManifest(value) {
    if (value === undefined) return Object.freeze({});
    if (!isMapping(value)) fail("packageBuild.manifest", "must be a mapping");
    const input = /** @type {Record<string, unknown>} */ (value);

    for (const [key, source] of Object.entries(DERIVED_MANIFEST_KEYS)) {
        if (input[key] !== undefined) {
            fail(
                `packageBuild.manifest.${key}`,
                `is derived from ${source} and must not be declared — it ` +
                    `would be overwritten, and the two would disagree with ` +
                    `nothing to say so`,
            );
        }
    }
    return Object.freeze(structuredClone(input));
}

/**
 * Normalize a setting that is one glob or several.
 *
 * A repository with a single conventional directory writes a string and a
 * repository with two writes a list; requiring the list form from both would
 * make the common case read like the exception.
 *
 * @param {unknown} value - What was declared, or `undefined`.
 * @param {string[]} fallback - The conventional layout.
 * @param {string} where - Dotted path, for the error.
 * @returns {readonly string[]} The globs, frozen.
 */
function normalizeGlobs(value, fallback, where) {
    if (value === undefined) return Object.freeze(fallback);
    const list = Array.isArray(value) ? value : [value];
    return Object.freeze(
        list.map((glob, index) =>
            requireNonEmptyString(
                glob,
                Array.isArray(value) ? `${where}[${index}]` : where,
            ),
        ),
    );
}

/**
 * Normalize an escape-hatch list: entries of `{ <field>, reason }`.
 *
 * Both escape hatches — a key kept despite looking unreferenced, a literal kept
 * despite looking like prose — are a claim about something no scan can see, so
 * each entry states the claim in prose a reviewer can check. Requiring the
 * reason is what keeps the list from silently becoming the place unexplained
 * exceptions accumulate.
 *
 * @param {unknown} value - The declared list, or `undefined`.
 * @param {string} field - The name of the entry's own field.
 * @param {string} where - Dotted path, for the error.
 * @returns {readonly string[]} The field values, frozen; `[]` when absent.
 */
function normalizeExceptions(value, field, where) {
    if (value === undefined) return Object.freeze([]);
    if (!Array.isArray(value)) fail(where, "must be a list");
    return Object.freeze(
        value.map((entry, index) => {
            const at = `${where}[${index}]`;
            if (!isMapping(entry)) fail(at, "must be a mapping");
            const item = /** @type {Record<string, unknown>} */ (entry);
            rejectUnknownKeys(item, [field, "reason"], `${at}.`);
            requireNonEmptyString(item.reason, `${at}.reason`);
            return requireNonEmptyString(item[field], `${at}.${field}`);
        }),
    );
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
 * @property {Readonly<Record<string, unknown>>} manifest  The manifest
 *                                   specification, emitted as declared.
 * @property {string|null} manifestFlags  Module to load a `flags` function
 *                                   from, for namespaced flags a repository has
 *                                   to compute. `null` when it declares none.
 * @property {string|null} assetTransform  Module to load a `transform` from,
 *                                   resolved against `rootDir`. `null` when
 *                                   the repository stages assets verbatim.
 * @property {readonly string[]} cleanExtra  Directories to remove beyond the
 *                                   conventional build artifacts.
 * @property {string} langSources    Glob for the localization files to check.
 * @property {string|null} langHelp  Extra guidance printed after a failure.
 * @property {string} langPrimary    The localization file coverage is measured
 *                                   against — the one the package authors.
 * @property {readonly string[]} langScripts    Globs for the sources scanned
 *                                   for key references.
 * @property {readonly string[]} langTemplates  Globs for the templates scanned
 *                                   for references and for hardcoded text.
 * @property {readonly string[]|null} langKeyRoots  The key roots, when the
 *                                   package references one its file does not
 *                                   yet declare. `null` derives them.
 * @property {string|null} langReferences  Module to load a `references`
 *                                   function from, contributing the keys only
 *                                   this repository's conventions can find.
 * @property {readonly string[]} langRetained  Key prefixes exempt from the
 *                                   unreferenced advisory.
 * @property {readonly string[]} langAllow  Template literals that are
 *                                   deliberately not localization keys.
 * @property {string} envPrefix      Prefix of the deploy environment variables.
 * @property {string} bundleEntry   The bundle file Foundry loads, as the
 *   manifest spells it. Derived from the package id.
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

    const bundle = section.bundle ?? {};
    if (!isMapping(bundle)) fail("packageBuild.bundle", "must be a mapping");
    rejectUnknownKeys(
        /** @type {Record<string, unknown>} */ (bundle),
        BUNDLE_KEYS,
        "packageBuild.bundle.",
    );
    const bundleInput = /** @type {Record<string, unknown>} */ (bundle);

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
        manifest: normalizeManifest(section.manifest),
        manifestFlags:
            section.manifestFlags === undefined ?
                null
            :   path.resolve(
                    shared.rootDir,
                    requireNonEmptyString(
                        section.manifestFlags,
                        "packageBuild.manifestFlags",
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
        // The file the package authors, and the one every other translation is
        // measured against. Coverage is a question about *this* file: another
        // language missing a key is a translation in progress, not a defect.
        langPrimary:
            langInput.primary === undefined ?
                "lang/en.json"
            :   requireNonEmptyString(
                    langInput.primary,
                    "packageBuild.lang.primary",
                ),
        langScripts: normalizeGlobs(
            langInput.scripts,
            ["src/**/*.{ts,mjs}"],
            "packageBuild.lang.scripts",
        ),
        langTemplates: normalizeGlobs(
            langInput.templates,
            ["templates/**/*.hbs"],
            "packageBuild.lang.templates",
        ),
        // Derived from the file's own keys unless stated — a package states
        // them only when it references a root the file does not yet declare at
        // all, which is the one case deriving them cannot cover.
        langKeyRoots:
            langInput.keyRoots === undefined ?
                null
            :   normalizeGlobs(
                    langInput.keyRoots,
                    [],
                    "packageBuild.lang.keyRoots",
                ),
        langReferences:
            langInput.references === undefined ?
                null
            :   path.resolve(
                    shared.rootDir,
                    requireNonEmptyString(
                        langInput.references,
                        "packageBuild.lang.references",
                    ),
                ),
        langRetained: normalizeExceptions(
            langInput.retained,
            "prefix",
            "packageBuild.lang.retained",
        ),
        langAllow: normalizeExceptions(
            langInput.allow,
            "literal",
            "packageBuild.lang.allow",
        ),
        envPrefix:
            deployInput.envPrefix === undefined ?
                "SOHL"
            :   requireNonEmptyString(
                    deployInput.envPrefix,
                    "packageBuild.deploy.envPrefix",
                ),
        // The file Foundry loads, as the manifest spells it. Named after the
        // package by convention, and the id is already derived from
        // package.json `name` — so a repository states this only when its
        // bundler emits something else.
        //
        // Deliberately *not* read back out of the generated manifest: the
        // check's question is whether the manifest declares this file the way
        // Foundry needs it, and a value taken from the manifest could never
        // answer that — it would agree with itself by construction.
        bundleEntry:
            bundleInput.entry === undefined ?
                `${shared.foundryPackage}.mjs`
            :   requireNonEmptyString(
                    bundleInput.entry,
                    "packageBuild.bundle.entry",
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
