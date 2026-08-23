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
    "container",
    "e2e",
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
const LANG_KEYS = ["sources", "help"];
const DEPLOY_KEYS = ["envPrefix"];
const RELEASE_KEYS = ["artifact"];
const CONTAINER_KEYS = ["image", "stages"];
const CONTAINER_STAGE_KEYS = ["port", "world", "version"];
const E2E_KEYS = ["stage", "suite", "build", "world", "gm", "documents"];
const E2E_SUITE_KEYS = ["run", "open"];
const E2E_WORLD_KEYS = ["id", "title", "description"];
const E2E_GM_KEYS = ["name", "password"];
const E2E_BUILD_TARGET_KEYS = ["script", "recreate"];
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
 * A container stage a repository runs beyond the conventional four.
 *
 * The four every HeroicLands package deploys to — dev, qa, prod, test — need no
 * entry: their data-root variable is derived and their ports are conventional.
 * This is for a stage that is genuinely one repository's, such as an older
 * Foundry serving a previous generation of the package.
 *
 * @param {unknown} value - The stage entry.
 * @param {string} name - The stage name, for the error path.
 * @returns {Readonly<{port: number|null, world: string|null, version: string|null}>}
 */
function normalizeContainerStage(value, name) {
    const where = `packageBuild.container.stages.${name}`;
    if (!isMapping(value)) fail(where, "must be a mapping");
    const stage = /** @type {Record<string, unknown>} */ (value);
    rejectUnknownKeys(stage, CONTAINER_STAGE_KEYS, `${where}.`);
    if (stage.port !== undefined && typeof stage.port !== "number") {
        fail(`${where}.port`, "must be a number");
    }
    if (stage.world !== undefined && typeof stage.world !== "string") {
        // An empty string is meaningful — it declares "never auto-launch" —
        // which is exactly why the type has to be checked rather than coerced.
        fail(`${where}.world`, 'must be a string ("" forces no auto-launch)');
    }
    return Object.freeze({
        port: /** @type {number|null} */ (stage.port ?? null),
        world: /** @type {string|null} */ (stage.world ?? null),
        version:
            stage.version === undefined ?
                null
            :   requireNonEmptyString(stage.version, `${where}.version`),
    });
}

/**
 * One end-to-end build target: the npm script that produces it, and whether
 * producing it means the world has to relaunch.
 *
 * A bare string is the common case and reads better than a mapping with one
 * key, so both are accepted. `recreate` is for a target that writes something
 * Foundry reads **once, at world launch** — the manifest — where deploying it
 * into a running world deploys a file nothing will look at.
 *
 * @param {unknown} value - The target entry.
 * @param {string} name - The target name, for the error path.
 * @returns {Readonly<{script: string, recreate: boolean}>}
 */
function normalizeE2EBuildTarget(value, name) {
    const where = `packageBuild.e2e.build.${name}`;
    if (typeof value === "string") {
        return Object.freeze({
            script: requireNonEmptyString(value, where),
            recreate: false,
        });
    }
    if (!isMapping(value)) fail(where, "must be a script name or a mapping");
    const target = /** @type {Record<string, unknown>} */ (value);
    rejectUnknownKeys(target, E2E_BUILD_TARGET_KEYS, `${where}.`);
    if (target.recreate !== undefined && typeof target.recreate !== "boolean") {
        fail(`${where}.recreate`, "must be a boolean");
    }
    return Object.freeze({
        script: requireNonEmptyString(target.script, `${where}.script`),
        recreate: Boolean(target.recreate),
    });
}

/**
 * The suite a repository runs against the served world.
 *
 * **This is the one thing the harness does not own.** Standing Foundry up,
 * seeding a world and waiting for it to activate are nobody's local problem;
 * what runs against it — a Cypress suite full of one system's helpers — is
 * entirely the repository's. So it is named here, the way an asset transform or
 * a manifest-flags module is named.
 *
 * @param {unknown} value - The `suite` block, or `undefined`.
 * @returns {Readonly<{run: readonly string[], open: readonly string[]|null}>|null}
 */
function normalizeE2ESuite(value) {
    if (value === undefined) return null;
    if (!isMapping(value)) fail("packageBuild.e2e.suite", "must be a mapping");
    const suite = /** @type {Record<string, unknown>} */ (value);
    rejectUnknownKeys(suite, E2E_SUITE_KEYS, "packageBuild.e2e.suite.");

    /**
     * @param {unknown} value_ - The declared command.
     * @param {string} where - Its path, for the error.
     * @returns {readonly string[]} The program and its arguments.
     */
    const commandList = (value_, where) => {
        if (!Array.isArray(value_) || value_.length === 0) {
            fail(where, "must be a non-empty list naming a program to run");
        }
        return Object.freeze(
            value_.map((part, i) =>
                requireNonEmptyString(part, `${where}[${i}]`),
            ),
        );
    };

    return Object.freeze({
        run: commandList(suite.run, "packageBuild.e2e.suite.run"),
        open:
            suite.open === undefined ?
                null
            :   commandList(suite.open, "packageBuild.e2e.suite.open"),
    });
}

/**
 * A mapping whose every value is a non-empty string, frozen.
 *
 * @param {unknown} value - The mapping, or `undefined`.
 * @param {string} where - Its path, for the error.
 * @param {readonly string[]} [allowed] - Keys it may declare.
 * @returns {Readonly<Record<string, string>>}
 */
function normalizeStringMap(value, where, allowed) {
    if (value === undefined) return Object.freeze({});
    if (!isMapping(value)) fail(where, "must be a mapping");
    const input = /** @type {Record<string, unknown>} */ (value);
    if (allowed) rejectUnknownKeys(input, allowed, `${where}.`);
    return Object.freeze(
        Object.fromEntries(
            Object.entries(input).map(([key, entry]) => [
                key,
                requireNonEmptyString(entry, `${where}.${key}`),
            ]),
        ),
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
 * @property {string} envPrefix      Prefix of the deploy environment variables.
 * @property {string} bundleEntry   The bundle file Foundry loads, as the
 *   manifest spells it. Derived from the package id.
 * @property {string|null} compatibilityMinimum  The Foundry floor the package
 *   claims, read from the shared configuration's top level.
 * @property {string} systemId       The system a world runs — the package
 *   itself for a system, its target for a module.
 * @property {string|null} systemVersion  That system's version, when the shared
 *   configuration stamps one.
 * @property {string|null} containerImage  Image override for every stage.
 * @property {Readonly<Record<string, Readonly<{port: number|null, world: string|null, version: string|null}>>>} containerStages
 *   Container stages beyond the conventional four.
 * @property {string} e2eStage       Which stage the suite runs against.
 * @property {Readonly<{run: readonly string[], open: readonly string[]|null}>|null} e2eSuite
 *   What to run against the served world; `null` when the repository has none.
 * @property {Readonly<Record<string, Readonly<{script: string, recreate: boolean}>>>} e2eBuild
 *   Build targets the fast loop can produce, in declaration order.
 * @property {Readonly<Record<string, string>>} e2eWorld  Declared world identity.
 * @property {Readonly<Record<string, string>>} e2eGm  Declared GM credentials.
 * @property {Readonly<Record<string, string>>} e2eDocuments  Extra world
 *   collections, as collection → source directory.
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

    const container = section.container ?? {};
    if (!isMapping(container)) {
        fail("packageBuild.container", "must be a mapping");
    }
    rejectUnknownKeys(
        /** @type {Record<string, unknown>} */ (container),
        CONTAINER_KEYS,
        "packageBuild.container.",
    );
    const containerInput = /** @type {Record<string, unknown>} */ (container);
    const declaredStages = containerInput.stages ?? {};
    if (!isMapping(declaredStages)) {
        fail("packageBuild.container.stages", "must be a mapping");
    }
    const containerStages = Object.freeze(
        Object.fromEntries(
            Object.entries(
                /** @type {Record<string, unknown>} */ (declaredStages),
            ).map(([name, entry]) => [
                name,
                normalizeContainerStage(entry, name),
            ]),
        ),
    );

    const e2e = section.e2e ?? {};
    if (!isMapping(e2e)) fail("packageBuild.e2e", "must be a mapping");
    rejectUnknownKeys(
        /** @type {Record<string, unknown>} */ (e2e),
        E2E_KEYS,
        "packageBuild.e2e.",
    );
    const e2eInput = /** @type {Record<string, unknown>} */ (e2e);
    const declaredBuild = e2eInput.build ?? {};
    if (!isMapping(declaredBuild)) {
        fail("packageBuild.e2e.build", "must be a mapping");
    }
    // Declaration order is build order — a mapping preserves it, and the
    // bundler has to run before the passes that copy into the stage it empties.
    const e2eBuild = Object.freeze(
        Object.fromEntries(
            Object.entries(
                /** @type {Record<string, unknown>} */ (declaredBuild),
            ).map(([name, entry]) => [
                name,
                normalizeE2EBuildTarget(entry, name),
            ]),
        ),
    );

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
        // Read from the top level, where the package already claims it. The
        // end-to-end pin derives from this, so the claim and the evidence for
        // it are the same number and cannot drift apart.
        compatibilityMinimum: shared.compatibility?.minimum ?? null,
        // The system a seeded world runs. For a system package that is itself;
        // for a module it is the system it targets, which the shared
        // configuration already names.
        systemId: shared.stats?.systemId ?? shared.foundryPackage,
        systemVersion: shared.stats?.systemVersion ?? null,
        containerImage:
            containerInput.image === undefined ?
                null
            :   requireNonEmptyString(
                    containerInput.image,
                    "packageBuild.container.image",
                ),
        containerStages,
        e2eStage:
            e2eInput.stage === undefined ?
                "test"
            :   requireNonEmptyString(e2eInput.stage, "packageBuild.e2e.stage"),
        e2eSuite: normalizeE2ESuite(e2eInput.suite),
        e2eBuild,
        e2eWorld: normalizeStringMap(
            e2eInput.world,
            "packageBuild.e2e.world",
            E2E_WORLD_KEYS,
        ),
        e2eGm: normalizeStringMap(
            e2eInput.gm,
            "packageBuild.e2e.gm",
            E2E_GM_KEYS,
        ),
        e2eDocuments: normalizeStringMap(
            e2eInput.documents,
            "packageBuild.e2e.documents",
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
