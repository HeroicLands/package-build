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
 * The resolved package-build configuration the pack pipeline reads.
 *
 * One module, one import: everything the compilers used to hard-code — the
 * content package, the Foundry package and its kind, every path, the `_stats`
 * identity, the item-type membership, and the pack list — arrives from the
 * consuming repository's `package-build.config.yaml` (#1508).
 *
 * **The configuration is data, and a repository writes it as data.** Every
 * value in it is a literal; the three consumers' configs held no logic between
 * them, only the boilerplate a code file needs in order to *say* a literal — a
 * `rootDir` computed from `import.meta.url`, a version read out of
 * `package.json`, an imported registry constant. Each of those is something
 * this loader can derive from where the file sits, so the file itself is YAML
 * and the derivation happens once here rather than being copy-pasted into every
 * repository. YAML rather than JSON because these configurations carry their
 * reasoning in comments, and that reasoning is most of their value.
 *
 * **`.mjs` remains, as the escape hatch it always was.** A consumer whose
 * `itemBuilders` registry is its own code — not one of the built-in registries
 * named below — cannot express it in data, and writes
 * `package-build.config.mjs` calling `defineConfig` directly. Both forms end at
 * the same {@link defineConfig}, so they are validated and frozen identically;
 * only the derivations differ, and they differ because a code file can do its
 * own I/O while `defineConfig` deliberately does none.
 *
 * **Resolved on first read, never at import (#2).** {@link loadPackConfig}
 * is a function rather than a module-level constant, so importing this module —
 * or the `engine` barrel, or a leaf module that happens to sit downstream of it
 * — costs nothing and requires nothing. A repository with no configuration can
 * still ask the CLI its version, and a consumer can still import a pure helper
 * (`engine/content-slug`, `engine/wikilinks`) without standing up a whole pack
 * build. The absence is still loud, just at the moment a configured value is
 * actually needed: every accessor in the engine funnels through here, so
 * anything that reads configuration throws with the message below.
 *
 * **Located by walking up from this module, not from the working directory.**
 * The config file sits at the root of the repository that installed the
 * toolchain, so climbing out of
 * `node_modules/@heroiclands/package-build/engine/` lands on it either way.
 * Resolving it against `process.cwd()` instead would make the build read a
 * different tree depending on where it was launched from, which is the very
 * property #1508 removed. `PACKAGE_BUILD_CONFIG` names the file explicitly when
 * a consumer keeps it somewhere else.
 *
 * **Loaded synchronously.** A YAML config is parsed synchronously as a matter
 * of course; an `.mjs` one is loaded with `require` rather than `await import`,
 * so that reading configuration is an ordinary expression at any call site
 * instead of making every module downstream of it an async one. Node has
 * supported `require()` of an ES module since v22.12 and this package requires
 * v24, so the only shape it cannot load is a config whose own module graph uses
 * top-level `await` — which is reported as such rather than as an opaque loader
 * error.
 *
 * **An `.mjs` config must import `defineConfig` from
 * `@heroiclands/package-build/content-config`, never from the package root barrel.**
 * The barrel pulls in the compilers, the compilers read this module, and this
 * module loads the config file — so a config that reaches for the barrel closes
 * a cycle around its own evaluation. The leaf entry point performs no I/O and
 * imports nothing but `node:path`, so it cannot.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import YAML from "yaml";

import { defineConfig, DERIVED_SYSTEM_VERSION } from "../content-config.mjs";
import { formatDiagnostic, positionOfYamlPath, yamlKeyPath } from "./diagnostics.mjs";

/** The stem every consuming repository declares its build under. */
export const CONFIG_BASENAME = "package-build.config";

/**
 * The file names a configuration may be written as, in resolution order.
 *
 * Order settles nothing in practice — two of these in one directory is an
 * error, not a precedence question (see {@link findConfigFile}) — but it fixes
 * the order the names are *reported* in, which is the order a reader should
 * reach for them: YAML first, `.mjs` last.
 *
 * The `content-build.config.*` stem this package read before the two toolchains
 * merged is **not** resolved. 3.0.0 renames the file rather than accepting both:
 * a deprecation window here would mean a repository could sit indefinitely on a
 * name for a package that no longer exists, and the upgrade already requires
 * touching the consumer's manifest and imports.
 *
 * @type {readonly string[]}
 */
export const CONFIG_FILENAMES = Object.freeze([
    `${CONFIG_BASENAME}.yaml`,
    `${CONFIG_BASENAME}.yml`,
    `${CONFIG_BASENAME}.mjs`,
]);

/**
 * The nearest configuration file at or above a directory.
 *
 * **Two of them in one directory is an error.** Picking one by precedence would
 * mean a repository mid-conversion silently builds from the file its author is
 * no longer editing, and the build would look entirely healthy while doing it.
 * The walk continues past a directory holding none, so a repository may still
 * sit inside one that has its own.
 *
 * @param {string} from - The directory to start from.
 * @returns {string|undefined} Its absolute path, or `undefined` if the walk
 *   reaches the filesystem root without finding one.
 * @throws {Error} When one directory holds more than one of
 *   {@link CONFIG_FILENAMES}.
 */
export function findConfigFile(from) {
    let dir = path.resolve(from);
    for (;;) {
        const found = CONFIG_FILENAMES.map((name) => path.join(dir, name)).filter((candidate) =>
            fs.existsSync(candidate),
        );
        if (found.length > 1) {
            throw new Error(
                `package-build: ${dir} holds more than one configuration ` +
                    `(${found.map((f) => path.basename(f)).join(", ")}). A ` +
                    `repository declares its build in exactly one file — ` +
                    `delete the one you are no longer editing.`,
            );
        }
        if (found.length === 1) return found[0];
        const parent = path.dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}

const require = createRequire(import.meta.url);

/**
 * The item-type registries a data configuration can name.
 *
 * `itemBuilders` is the one part of the contract that is *code* — a table of
 * functions building each type's `system` block — so a YAML configuration names
 * a registry instead of supplying one. The tables themselves are ordinary
 * exports; this is only the map from the name a config may write to the module
 * holding it.
 *
 * Required lazily, so that importing this module does not drag the `sohl` half
 * of the package in behind it — the property #2 exists to protect. It is also
 * why the registry's own module graph must not read configuration: requiring it
 * here happens *during* the resolution such a read would be asking for. Nothing
 * in that graph does.
 *
 * @type {Readonly<Record<string, () => Record<string, unknown>>>}
 */
const ITEM_BUILDER_REGISTRIES = Object.freeze({
    sohl: () =>
        /** @type {{ ITEM_BUILDERS: Record<string, unknown> }} */ (
            require("../sohl/item-builders.mjs")
        ).ITEM_BUILDERS,
    hm3: () =>
        /** @type {{ HM3_ITEM_BUILDERS: Record<string, unknown> }} */ (
            require("../hm3/item-builders.mjs")
        ).HM3_ITEM_BUILDERS,
});

/**
 * The version of the system a repository ships content for, read from the
 * `package.json` beside its configuration.
 *
 * `stats.systemVersion` is stamped into every compiled document, and a
 * transcribed copy of it froze at `0.6.0` for four releases before anyone
 * noticed (#1548). `package.json` is the file Changesets bumps, so reading it
 * is what keeps the stamp equal to the version that did the compiling.
 *
 * The read happens *here*, in the loader, rather than in `defineConfig`:
 * validating a configuration is pure by design, and this is I/O. An `.mjs`
 * config does the same read itself, which it can, because it is code.
 *
 * @param {string} rootDir - The directory the configuration sits in.
 * @returns {string} The `version` field of the adjacent `package.json`.
 * @throws {Error} When there is no adjacent `package.json`, or it declares no
 *   version. Guessing one would produce documents claiming a version nothing
 *   ever shipped.
 */
function readPackageJson(rootDir) {
    const manifestPath = path.join(rootDir, "package.json");
    try {
        return {
            manifestPath,
            pkg: JSON.parse(fs.readFileSync(manifestPath, "utf8")),
        };
    } catch (err) {
        throw new Error(
            `package-build: ${manifestPath} could not be read, and the ` +
                `configuration derives both the Foundry package id and the ` +
                `system version from it.`,
            { cause: err },
        );
    }
}

/**
 * The Foundry package id, from the `name` of the adjacent `package.json`.
 *
 * Every project in this organisation carries a unique name by requirement, and
 * each `package.json` `name` maps directly onto its Foundry package id — all
 * three consumers matched exactly when this was still transcribed. So the value
 * is used **verbatim**: no normalisation, no legality check.
 *
 * That is a decision rather than an omission. A scoped npm name (`@scope/pkg`)
 * is not a legal Foundry id, but these packages are private and therefore never
 * scoped, so the case does not arise; guarding it would be inventing a rule the
 * project does not have.
 *
 * @param {string} rootDir - The directory the configuration sits in.
 * @returns {string} The package id.
 * @throws {Error} When `package.json` declares no name.
 */
function foundryPackageId(rootDir) {
    const { manifestPath, pkg } = readPackageJson(rootDir);
    if (typeof pkg.name !== "string" || pkg.name.length === 0) {
        throw new Error(
            `package-build: ${manifestPath} declares no \`name\`, which is ` +
                `what the Foundry package id is derived from.`,
        );
    }
    return pkg.name;
}

/**
 * The version of the game system a repository ships content *for*.
 *
 * The two package kinds derive it from different places, and the distinction is
 * the whole point:
 *
 * - A **system** ships itself, so its own `package.json` version *is* the
 *   system version. That is the read #1548 introduced after a transcribed copy
 *   froze at `0.6.0` for four releases.
 * - A **module** ships content *for* someone else's system. Its own version is
 *   the module's — `sohl-thalorna` sits at `0.0.1` — so deriving from it would
 *   stamp a SoHL version that has never existed, which is worse than a frozen
 *   one that at least was once true. The honest source is the system
 *   relationship the module already declares, and specifically `verified`:
 *   `_stats.systemVersion` records what the packs were built against, not the
 *   floor they tolerate.
 *
 * @param {string} rootDir - The directory the configuration sits in.
 * @param {Record<string, unknown>} input - The configuration being resolved.
 * @returns {string} The system version to stamp.
 * @throws {Error} When a module declares no usable system relationship. A wrong
 *   `_stats.systemVersion` is invisible until something migrates on it, so this
 *   fails rather than guessing.
 */
function shippedSystemVersion(rootDir, input) {
    if (input.packageKind === "systems") {
        const { manifestPath, pkg } = readPackageJson(rootDir);
        if (typeof pkg.version !== "string" || pkg.version.length === 0) {
            throw new Error(
                `package-build: ${manifestPath} declares no \`version\`, ` +
                    `which is what a system's stats.systemVersion is derived ` +
                    `from.`,
            );
        }
        return pkg.version;
    }

    const systemId = /** @type {Record<string, unknown>} */ (input.stats ?? {}).systemId;
    const declaredSystems = /** @type {Record<string, unknown>} */ (input.relationships ?? {})
        .systems;

    // The `systems:` block declares without requiring (#48), so it is consulted
    // first: a package that has adopted it needs no relationship, and one that
    // ships for two systems could not express itself through a relationship at
    // all. `requiresSystem` names the package-wide default when there is one;
    // otherwise a single declared system is unambiguous. With several and no
    // gate, there is no package-wide answer — each pack carries its own, and
    // {@link statsForPack} is what reads it.
    const systemsBlock = /** @type {Record<string, {compatibility?: {verified?: string}}>} */ (
        input.systems ?? {}
    );
    const systemIds = Object.keys(systemsBlock);
    if (systemIds.length) {
        const chosen =
            typeof input.requiresSystem === "string" ? input.requiresSystem
            : systemIds.length === 1 ? systemIds[0]
            : null;
        if (chosen) {
            const verified = systemsBlock[chosen]?.compatibility?.verified;
            if (typeof verified === "string" && verified.length) return verified;
        }
        // Several declared and none required: the package-wide value is
        // deliberately absent rather than one of them picked arbitrarily.
        return null;
    }

    // A module that names neither a system nor a relationship with one is
    // system-agnostic on purpose: its packs are core document types carrying no
    // system data, and it installs under any system. There is no version to
    // stamp, and inventing one would be the very thing the throw below guards
    // against. The two signals together are what separate this from a module
    // that simply forgot to declare its system (#43).
    if (
        (systemId === undefined || systemId === null) &&
        !(Array.isArray(declaredSystems) && declaredSystems.length)
    ) {
        return null;
    }

    const systems =
        /** @type {{id?: string, compatibility?: {verified?: string}}[]} */ (
            /** @type {Record<string, unknown>} */ (input.relationships ?? {}).systems
        ) ?? [];
    const relationship = systems.find((entry) => entry?.id === systemId) ?? systems[0];
    const verified = relationship?.compatibility?.verified;

    if (typeof verified !== "string" || verified.length === 0) {
        throw new Error(
            `package-build: a module's stats.systemVersion is derived from ` +
                `the system it declares a relationship with, and this ` +
                `configuration declares none usable. Add ` +
                `\`relationships.systems\` naming ` +
                `${systemId ? `\`${systemId}\`` : "the system"} with a ` +
                `\`compatibility.verified\` version. It is not taken from ` +
                `this package's own \`package.json\` version — that is the ` +
                `module's version, and stamping it would claim a system ` +
                `version that never existed.`,
        );
    }
    return verified;
}

/**
 * Where in the configuration file a dotted field path was written.
 *
 * Only a YAML configuration has text to resolve a path against. An `.mjs` one
 * is deliberately not searched: JavaScript source fed to a YAML parser is not
 * an error — it parses as *something*, and a path could resolve to a line that
 * has nothing to do with the key. A position that is wrong is worse than none,
 * so the extension decides.
 *
 * A path that names a key the file never declared — a missing required one —
 * has no node of its own. The position then names the **mapping it belongs
 * in**, one level up and no further: that entry is a real node, and it is the
 * one the reader has to edit. Walking further would drift away from the key
 * with each step, so a top-level key that is simply absent gets no position at
 * all.
 *
 * @param {string} configPath - Absolute path of the configuration file.
 * @param {string} field - The dotted path the diagnostic names.
 * @returns {{line?: number, column?: number}} Spreadable position fields,
 *   empty when nothing can be established honestly.
 */
function positionInConfig(configPath, field) {
    if (!/\.ya?ml$/i.test(configPath)) return {};

    let text;
    try {
        text = fs.readFileSync(configPath, "utf8");
    } catch {
        return {};
    }

    const keyPath = yamlKeyPath(field);
    if (keyPath.length === 0) return {};

    const declared = positionOfYamlPath(text, keyPath, { key: true });
    if (declared.line !== undefined) return declared;
    if (keyPath.length === 1) return {};
    return positionOfYamlPath(text, keyPath.slice(0, -1), { key: true });
}

/**
 * Attach the position of the key a configuration error names.
 *
 * Eighty-one checks across `content-config.mjs` and `config.mjs` report through
 * one `fail()`, which knows the offending key's dotted path and nothing
 * about where it was written. Locating one of them and not the rest would be
 * worse than locating none — a reader would learn that some configuration
 * errors carry a position and could not predict which — so the path rides on
 * the error and every one of them is located here, at the boundary that knows
 * which file was read (#95).
 *
 * The message keeps its body and gains the `file:line:column: error: ` prefix
 * every other finding in this build already uses, so nothing a reader has today
 * is lost. `located` marks it done, so an error crossing two boundaries is
 * decorated once; the fields are also left on the error, for a caller that
 * wants to re-render it.
 *
 * @param {unknown} err - What was thrown.
 * @param {string} [configPath] - The configuration file that was read.
 * @returns {unknown} The same error, decorated when it named a field.
 */
export function locateConfigError(err, configPath) {
    const failure =
        /** @type {{field?: unknown, located?: boolean, message?: string, file?: string, line?: number, column?: number}} */ (
            err
        );
    if (!(err instanceof Error)) return err;
    if (failure.located || typeof failure.field !== "string" || !failure.field) {
        return err;
    }
    if (!configPath) return err;

    const at = {
        file: configPath,
        ...positionInConfig(configPath, failure.field),
    };
    Object.assign(failure, at, { located: true });
    failure.message = formatDiagnostic({
        ...at,
        severity: "error",
        message: /** @type {string} */ (failure.message),
    });
    return err;
}

/**
 * Turn a parsed YAML configuration into the frozen one the engine reads.
 *
 * Three fields exist in a code configuration only because a code file has to
 * *compute* what a data file can simply be told, and each is derived here from
 * where the file sits:
 *
 * - **`rootDir`** is the configuration's own directory, always. A data file
 *   cannot write `import.meta.dirname`, and any absolute path it wrote instead
 *   would be one machine's — so authoring it is rejected rather than honoured.
 * - **`itemBuilders`** is a *name* (`sohl`) — or a list of names, for a tree
 *   feeding more than one system (#58) — resolved against the built-in
 *   registries. A registry's name is the system it belongs to. A registry of a
 *   consumer's own is code, and code goes in an `.mjs` configuration.
 * - **`stats.systemVersion`** is derived from the adjacent `package.json` when
 *   the configuration does not state it. Stating it is still allowed: a
 *   repository shipping content *for* another package (a module declaring
 *   `systemId: sohl`) may need a version that is not its own.
 *
 * Everything else passes through untouched, to be validated by the one
 * validator both configuration forms end at.
 *
 * @param {unknown} data - The parsed configuration document.
 * @param {string} configPath - Absolute path of the file it was parsed from.
 * @returns {import("../config.mjs").ContentBuildConfig} The frozen configuration.
 * @throws {Error} When the document is not a mapping, declares `rootDir`, or
 *   names an item-builder registry this package does not ship.
 */
export function configFromData(data, configPath) {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
        throw new Error(
            `package-build: ${configPath} does not parse to a mapping. A ` +
                `configuration is a block of top-level keys — see the README.`,
        );
    }
    const input = /** @type {Record<string, unknown>} */ ({ ...data });
    const rootDir = path.dirname(configPath);

    if (input.rootDir !== undefined) {
        throw new Error(
            `package-build: ${configPath} declares \`rootDir\`, which a data ` +
                `configuration may not: it is always the directory the file ` +
                `sits in. An absolute path written here would be one ` +
                `machine's; remove the key.`,
        );
    }
    input.rootDir = rootDir;

    // Transcribed from `package.json`, and therefore free to disagree with it.
    // Every consumer's copy matched exactly, which is what a transcription
    // looks like right up until it does not (#1548 froze one at `0.6.0` for
    // four releases while nothing said so).
    if (input.foundryPackage !== undefined) {
        throw new Error(
            `package-build: ${configPath} declares \`foundryPackage\`, which ` +
                `a data configuration may not: it is the \`name\` of the ` +
                `\`package.json\` beside it. Remove the key.`,
        );
    }
    input.foundryPackage = foundryPackageId(rootDir);

    if (input.itemBuilders !== undefined) {
        const declared = input.itemBuilders;
        const known = Object.keys(ITEM_BUILDER_REGISTRIES).join(", ");
        // One name or several. A repository feeding two systems needs both
        // vocabularies, and one registry can only carry one (#58); the scalar
        // form every existing configuration uses is the one-element case and
        // means exactly what it always did.
        const names = Array.isArray(declared) ? declared : [declared];
        const resolved = names.map((named, index) => {
            const where = Array.isArray(declared) ? `itemBuilders[${index}]` : "itemBuilders";
            if (typeof named !== "string") {
                throw new Error(
                    `package-build: ${configPath} must name its \`${where}\` ` +
                        `registry as a string — the registry is code, and data ` +
                        `cannot carry it. Known registries: ${known}; a registry ` +
                        `of your own goes in ${CONFIG_BASENAME}.mjs.`,
                );
            }
            const load = ITEM_BUILDER_REGISTRIES[named];
            if (!load) {
                throw new Error(
                    `package-build: ${configPath} names the \`${where}\` ` +
                        `registry "${named}", which this package does not ship. ` +
                        `Known registries: ${known}. To supply your own, declare ` +
                        `it in ${CONFIG_BASENAME}.mjs.`,
                );
            }
            // A shipped registry's *name* is the system it belongs to, which is
            // what lets a data configuration declare a set without carrying the
            // system id a second time.
            return { system: named, builders: load() };
        });
        // The scalar form stays the flat, system-less registry it has always
        // resolved to. Wrapping it as a one-entry set would be tidier and would
        // change what every existing configuration means — `itemBuildersBySystem`
        // would gain an entry the consumer never declared.
        input.itemBuilders = Array.isArray(declared) ? resolved : resolved[0].builders;
    }

    const stats = input.stats;
    if (stats !== null && typeof stats === "object" && !Array.isArray(stats)) {
        const declared = /** @type {Record<string, unknown>} */ (stats);
        // `stats.systemId` and `stats.systemVersion` are both refused by
        // `defineConfig`, which reports them with a locator — so nothing is
        // rejected here. This half only supplies the value the validator cannot
        // compute: resolving a system package's version means reading the
        // adjacent `package.json`, and `defineConfig` performs no I/O.
        //
        // Passed under a symbol so the channel is not a second, forgeable
        // spelling of the key that was just refused (see
        // {@link DERIVED_SYSTEM_VERSION}).
        input.stats = {
            ...declared,
            [DERIVED_SYSTEM_VERSION]: shippedSystemVersion(rootDir, input),
        };
    }

    try {
        return defineConfig(/** @type {never} */ (input));
    } catch (err) {
        // Every `fail()` in the validator names a key and knows nothing about
        // the file; this is where the two meet.
        throw locateConfigError(err, configPath);
    }
}

/**
 * Load an `.mjs` configuration — one that called `defineConfig` itself.
 *
 * @param {string} configPath - Absolute path of the file.
 * @returns {import("../config.mjs").ContentBuildConfig} What it exported.
 * @throws {Error} When its module graph uses top-level `await`, which a
 *   synchronously-read configuration cannot.
 */
function loadCodeConfig(configPath) {
    let module;
    try {
        module = require(configPath);
    } catch (err) {
        // A code configuration calls `defineConfig` itself, so its rejections
        // arrive here. There is no YAML to locate into, but the file is known —
        // `locateConfigError` names it and drops the line.
        locateConfigError(err, configPath);
        if (/** @type {{ code?: string }} */ (err)?.code === "ERR_REQUIRE_ASYNC_MODULE") {
            throw new Error(
                `package-build: ${configPath} (or something it imports) uses ` +
                    `top-level await, which the configuration cannot: it is ` +
                    `read synchronously so that reading a configured value ` +
                    `stays an ordinary expression. Move the awaited work into ` +
                    `the build that consumes the configuration.`,
                { cause: err },
            );
        }
        throw err;
    }
    return module.default ?? module;
}

/** The loaded configuration, memoised — the file is read at most once. */
let loaded;

/** The file {@link loadPackConfig} read, alongside the memoised result. */
let loadedFrom;

/**
 * The consuming repository's resolved, frozen configuration.
 *
 * Every engine module that needs a configured value calls this, rather than
 * hoisting one at import: that is what keeps the library importable without a
 * configuration (#2). The result is memoised, so calling it in a default
 * parameter — the usual spelling here — costs one property read per call.
 *
 * @returns {import("../config.mjs").ContentBuildConfig} The frozen configuration.
 * @throws {Error} When no configuration file can be found, or the one named
 *   cannot be loaded. Absence is a defect, not a fallback: without it the
 *   compilers know neither what to compile nor where to put it.
 */
export function loadPackConfig() {
    if (loaded) return loaded;

    const explicit = process.env.PACKAGE_BUILD_CONFIG;
    const configPath = explicit ? path.resolve(explicit) : findConfigFile(import.meta.dirname);

    if (!configPath || !fs.existsSync(configPath)) {
        throw new Error(
            explicit ?
                `package-build: PACKAGE_BUILD_CONFIG names ${configPath}, ` +
                    `which does not exist.`
            :   `package-build: no ${CONFIG_FILENAMES.join(" or ")} found at ` +
                    `or above ${import.meta.dirname}. A consuming repository ` +
                    `declares its build in one file at its root; set ` +
                    `PACKAGE_BUILD_CONFIG to name it elsewhere.`,
        );
    }

    loaded =
        configPath.endsWith(".mjs") ?
            loadCodeConfig(configPath)
        :   configFromData(YAML.parse(fs.readFileSync(configPath, "utf8")), configPath);
    loadedFrom = configPath;
    return loaded;
}

/**
 * The file {@link loadPackConfig} resolved the configuration from.
 *
 * A diagnostic about a *configured* value has to name the file it was declared
 * in, and re-deriving that path at the point of the finding would be a second
 * resolution free to disagree with the first — the `PACKAGE_BUILD_CONFIG`
 * override, the upward walk and the one-file-per-directory rule all have to
 * come out the same way. This reports the path actually read.
 *
 * @returns {string} Its absolute path.
 * @throws {Error} As {@link loadPackConfig}, when there is no configuration.
 */
export function packConfigPath() {
    loadPackConfig();
    return /** @type {string} */ (loadedFrom);
}
