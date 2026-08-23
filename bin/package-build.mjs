#!/usr/bin/env node
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
 * The `package-build` command line — clean, stage, check, package, deploy.
 *
 * **Why this exists.** This package was library-only, so every consuming
 * repository wrote a wrapper script per job: six of them in the Song of Heroic
 * Lands repository, 441 lines that between them contained no logic. `clean.mjs`
 * was 47 lines that computed a `repoRoot` from `import.meta.url`, read one
 * flag, and made one call. `push-stage.mjs` hard-coded `packageKind: "systems"`
 * and `packageId: "sohl"` beside a configuration that already declared both.
 * Each copy had drifted from its sibling in the other repositories, because
 * copies do.
 *
 * It is the same shape the configuration had before it became data: not logic,
 * but the boilerplate a code file needs in order to state a literal. So the
 * literals move into `content-build.config.yaml`'s reserved `packageBuild:`
 * section, and the boilerplate lives here, once.
 *
 * **Every side effect lives in this file.** argv parsing, the environment,
 * writing to the filesystem, and the process exit code. The library modules
 * stay import-safe, so a consuming repository's build — or a test — can call
 * them without any of it happening.
 *
 * **The shape of the command surface.** A capability with a single operation is
 * a bare command (`clean`, `assets`, `manifest`, `release`, `deploy <stage>`);
 * one with more than a single operation takes a positional action, so it can
 * grow another without renaming the first (`lang check`, `bundle check`). The
 * alternative — flat `lang:check`-style names — makes the second operation a
 * new top-level command and the relationship between them invisible.
 *
 * The side effects that need *configuration* live inside the command handlers,
 * never at module scope, so `--version` and `--help` answer in a directory with
 * no configuration at all. Running an actual command still resolves it, and
 * still fails loudly when it is missing.
 *
 * Usage:
 *   npx package-build clean [--distclean]
 *   npx package-build assets
 *   npx package-build manifest
 *   npx package-build lang check
 *   npx package-build lang coverage [--unused]
 *   npx package-build lang hardcoded
 *   npx package-build bundle check
 *   npx package-build release
 *   npx package-build deploy <stage>
 *   npx package-build container <stage> <action>
 *   npx package-build e2e <seed|run|open|fast|sweep>
 *
 * In a consuming repository, wrapped as npm scripts — SoHL spells them:
 *   npm run clean                          // → … clean
 *   npm run build:assets                   // → … assets
 *   npm run lint:lang                      // → … lang check
 *   npm run lint:lang-coverage             // → … lang coverage
 *   npm run lint:lang-hardcoded            // → … lang hardcoded
 *   npm run lint:bundle-globals            // → … bundle check
 *   npm run build:pack-release             // → … release
 *   npm run push:qa                        // → … deploy qa
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { globSync } from "glob";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { loadPackageBuildConfig } from "../config.mjs";
import { loadPackConfig } from "@heroiclands/content-build/engine/pack-config";
import { cleanBuildArtifacts, stageAssets } from "../stage.mjs";
import { validateLangSource } from "../lang.mjs";
import {
    analyzeCoverage,
    collectScriptReferences,
    collectTemplateReferences,
    keyRootsOf,
    mergeReferences,
} from "../coverage.mjs";
import { findHardcodedText, findTemplateSyntaxErrors } from "../templates.mjs";
import { checkBundleLoading } from "../bundle.mjs";
import { packRelease } from "../release.mjs";
import { writeManifest } from "../manifest.mjs";
import { deployStage } from "../deploy.mjs";
import { CONTAINER_ACTIONS, containerAction } from "../container.mjs";
import {
    E2E_MODES,
    e2eFast,
    e2eRun,
    e2eSweep,
    seedTestWorld,
} from "../e2e.mjs";
import { reportFindings } from "./report.mjs";

/**
 * How many unreferenced keys a run prints before it summarizes the rest.
 *
 * Enough to see the shape of the problem, few enough that the errors above
 * them are still on the screen.
 */
const ADVISORY_PREVIEW = 20;

/**
 * This package's own version, for `--version`.
 *
 * Read from this package's manifest rather than left to yargs, which defaults
 * to the *nearest* `package.json` walking up from the working directory —
 * inside a consuming repository that is the consumer's, so the CLI would report
 * the consumer's version instead of the toolchain's.
 *
 * @returns {string} The `version` field of this package's manifest.
 */
function ownVersion() {
    return JSON.parse(
        fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ).version;
}

/**
 * Report a failure the way a build should: one line, no stack, non-zero exit.
 *
 * @param {unknown} err - What went wrong.
 * @returns {never}
 */
function die(err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`package-build: ${message}`);
    process.exit(1);
}

/**
 * Wrap a command handler so every failure is reported the same way.
 *
 * yargs' own `.fail()` sees a *synchronous* handler's throw but not an async
 * one's rejection, so without this a `clean` failure printed one clean line and
 * a `deploy` failure printed a stack trace. A build's diagnostics should not
 * depend on whether the command it ran happened to await something.
 *
 * @param {(args: object) => unknown} run - The handler body.
 * @returns {(args: object) => Promise<void>} The wrapped handler.
 */
function handler(run) {
    return async (args) => {
        try {
            await run(args);
        } catch (err) {
            die(err);
        }
    };
}

/**
 * Load the repository's environment files.
 *
 * Done inside a handler rather than at module scope: `--help` and `--version`
 * must answer in a directory with no environment file — or no configuration —
 * at all.
 *
 * @param {object} config - The resolved package-build configuration.
 * @returns {Promise<void>} Once `.env.local` and `.env` have been applied.
 */
async function loadEnvironment(config) {
    const dotenv = await import("dotenv");
    dotenv.config({
        path: path.join(config.rootDir, ".env.local"),
        quiet: true,
    });
    dotenv.config({ path: path.join(config.rootDir, ".env"), quiet: true });
}

/**
 * The repository's own `package.json`.
 *
 * @param {object} config - The resolved package-build configuration.
 * @returns {object} The parsed manifest.
 */
function readPackageJson(config) {
    return JSON.parse(
        fs.readFileSync(path.join(config.rootDir, "package.json"), "utf8"),
    );
}

/**
 * Everything the user typed after an `e2e` action, verbatim.
 *
 * Read from the raw arguments rather than from yargs, because most of it is not
 * this command line's to interpret: `--spec`, `--browser`, a `--` passthrough
 * and whatever else belongs to the repository's suite. Parsing it here would
 * mean this package learning the flags of a runner it deliberately knows
 * nothing about.
 *
 * @param {string} action - The action that was run.
 * @returns {string[]} The arguments after it.
 */
function e2eTail(action) {
    const raw = hideBin(process.argv);
    const at = raw.indexOf(action);
    return at === -1 ? [] : raw.slice(at + 1);
}

/**
 * `clean` — remove this repository's build artifacts.
 *
 * The conventional artifact directories are the library's; a repository that
 * generates more (a site's `content/`, `public/` and `resources/`) names them
 * in `packageBuild.clean.extra` rather than reimplementing the walk, which is
 * what every consumer's `clean.mjs` did.
 *
 * @returns {object} The yargs command module.
 */
function cleanCommand() {
    return {
        command: "clean",
        describe: "Remove build artifacts",
        builder: (y) =>
            y.option("distclean", {
                type: "boolean",
                default: false,
                describe: "Also remove node_modules",
            }),
        handler: handler((args) => {
            const config = loadPackageBuildConfig();
            const removed = cleanBuildArtifacts(config.rootDir, {
                includeNodeModules: args.distclean,
                extra: config.cleanExtra,
            });
            for (const dir of removed) console.log(`Removed ${dir}`);
            if (!removed.length) console.log("Nothing to clean.");
        }),
    };
}

/**
 * `assets` — stage the repository's static files into the package root.
 *
 * The table is data (`packageBuild.assets`). A repository that has to *change*
 * a file on the way — SoHL rewrites each SVG's hard-coded fill so icons follow
 * the Foundry theme — names a module in `packageBuild.assetTransform`, whose
 * `transform(sourcePath)` returns replacement text or `null` to copy verbatim.
 * That is the one genuine piece of code in the job, and it stays the
 * repository's.
 *
 * @returns {object} The yargs command module.
 */
function assetsCommand() {
    return {
        command: "assets",
        describe: "Stage static assets into the package root",
        builder: (y) => y,
        handler: handler(async () => {
            const config = loadPackageBuildConfig();
            if (!config.assets.length) {
                console.log(
                    "package-build: no `packageBuild.assets` declared; nothing to stage.",
                );
                return;
            }

            let transform;
            if (config.assetTransform) {
                const module = await import(
                    `file://${config.assetTransform}`
                ).catch((err) =>
                    die(
                        `cannot load \`packageBuild.assetTransform\` ` +
                            `(${config.assetTransform}): ${err.message}`,
                    ),
                );
                transform = module.transform;
                if (typeof transform !== "function") {
                    die(
                        `\`packageBuild.assetTransform\` ` +
                            `(${config.assetTransform}) exports no \`transform\` ` +
                            `function. It must export ` +
                            `\`transform(sourcePath) -> string | null\`.`,
                    );
                }
            }

            // `to:` is relative to the staged package root, so a
            // repository's table reads `lang`, not `build/stage/lang`.
            const entries = config.assets.map(({ from, to }) => [
                from,
                path.join(config.stageDir, to),
            ]);
            const { entries: count, files } = stageAssets(entries, {
                cwd: config.rootDir,
                transform,
            });
            console.log(
                `✅ Static assets staged (${count} entries, ${files} files).`,
            );
        }),
    };
}

/**
 * `manifest` — generate `system.json` / `module.json` into the build stage.
 *
 * There is no template to read. Everything the manifest needs is either
 * declared in `packageBuild.manifest`, derived from configuration this
 * repository already carries, or computed by a module the repository names in
 * `packageBuild.manifestFlags` — for a namespaced flag it has to work out, such
 * as the compendium address of a document that only exists once the content
 * tree has been walked.
 *
 * @returns {object} The yargs command module.
 */
function manifestCommand() {
    return {
        command: "manifest",
        describe: "Generate the Foundry package manifest",
        builder: (y) => y,
        handler: handler(async () => {
            const config = loadPackageBuildConfig();
            const shared = loadPackConfig();
            const packageJson = readPackageJson(config);

            let flags;
            if (config.manifestFlags) {
                const module = await import(
                    `file://${config.manifestFlags}`
                ).catch((err) =>
                    die(
                        `cannot load \`packageBuild.manifestFlags\` ` +
                            `(${config.manifestFlags}): ${err.message}`,
                    ),
                );
                if (typeof module.flags !== "function") {
                    die(
                        `\`packageBuild.manifestFlags\` ` +
                            `(${config.manifestFlags}) exports no \`flags\` ` +
                            `function. It must export ` +
                            `\`flags(config) -> Record<string, object>\`.`,
                    );
                }
                flags = await module.flags(shared);
            }

            const { path: written, manifest } = await writeManifest({
                config: shared,
                packageJson,
                artifact: config.artifact,
                outDir: path.join(config.rootDir, config.stageDir),
                flags,
            });
            console.log(
                `✅ Wrote ${path.relative(config.rootDir, written)} ` +
                    `(${Object.keys(manifest).length} keys, ` +
                    `${manifest.packs.length} packs).`,
            );
        }),
    };
}

/**
 * Every file matching a glob, as `{ path, text }` with the path relative to the
 * repository root — the form both the rules and the findings want.
 *
 * @param {string|readonly string[]} globs - Glob or globs, relative to the root.
 * @param {string} rootDir - The repository root.
 * @returns {{path: string, text: string}[]} The files, in path order.
 */
function readMatching(globs, rootDir) {
    return globSync([...(Array.isArray(globs) ? globs : [globs])], {
        cwd: rootDir,
        absolute: true,
    })
        .sort()
        .map((file) => ({
            path: path.relative(rootDir, file),
            text: fs.readFileSync(file, "utf8"),
        }));
}

/**
 * `lang check` — verify every localization file survives `expandObject`.
 *
 * A dotted-prefix collision makes `foundry.utils.expandObject` throw, and
 * Foundry then drops the whole translation file silently. The rule is the
 * library's; the glob and any repository-specific guidance are data.
 *
 * @param {Readonly<import("../config.mjs").PackageBuildConfig>} config
 * @returns {void}
 */
function langCheck(config) {
    const files = readMatching(config.langSources, config.rootDir);
    if (!files.length) {
        die(
            `no localization files matched \`${config.langSources}\` under ` +
                `${config.rootDir}.`,
        );
    }

    let total = 0;
    for (const file of files) {
        total += reportFindings(validateLangSource(file.text), {
            file: file.path,
        });
    }

    if (total) {
        if (config.langHelp) console.error(`\n${config.langHelp}`);
        process.exit(1);
    }
    console.log(
        `package-build: ${files.length} localization file(s) are ` +
            `expandObject-safe.`,
    );
}

/**
 * `lang coverage` — does every key the package references exist, and is every
 * key it declares referenced?
 *
 * The two halves are not the same severity. A referenced key that is missing
 * renders to a player as its own raw key string, so it fails the run; a key
 * nothing references is reported and does not, because no scan can see every
 * way a key is reached and a guard that fails over one teaches people to switch
 * it off.
 *
 * A repository that *generates* keys by a convention of its own names a module
 * in `packageBuild.lang.references`, exporting
 * `references(context) -> ReferenceSet`. That is the same shape as
 * `assetTransform` and `manifestFlags`, and for the same reason: only that
 * repository can know its rule, and only this package can compare the result
 * against the file.
 *
 * @param {Readonly<import("../config.mjs").PackageBuildConfig>} config
 * @param {object} args - The parsed argv.
 * @returns {Promise<void>}
 */
async function langCoverage(config, args) {
    const langFile = config.langPrimary;
    const langPath = path.join(config.rootDir, langFile);
    if (!fs.existsSync(langPath)) {
        die(
            `no localization file at ${langFile} — name the one this package ` +
                `authors in \`packageBuild.lang.primary\`.`,
        );
    }
    const langSource = fs.readFileSync(langPath, "utf8");

    /**
     * Report and exit, so the two exits — nothing to compare against, and a
     * comparison that failed — read the same way.
     *
     * @param {object} analysis - What {@link analyzeCoverage} returned.
     * @returns {void}
     */
    const finish = ({ findings, unreferenced, stats }) => {
        const errors = reportFindings(findings, {});
        // Capped by default: the advisory half of a large package is pages
        // long, and pages of warnings on every build is how a guard stops being
        // read at all. The count is always stated, so nothing is hidden.
        const shown =
            args.unused ? unreferenced : (
                unreferenced.slice(0, ADVISORY_PREVIEW)
            );
        reportFindings(shown, {});
        if (shown.length < unreferenced.length) {
            console.error(
                `package-build: ${unreferenced.length - shown.length} further ` +
                    `unreferenced key(s) not shown — run with --unused.`,
            );
        }

        console.log(
            `package-build: ${stats.declared} key(s) declared in ${langFile} · ` +
                `${stats.referenced} referenced · ` +
                `${stats.namespaces} namespace(s) · ` +
                `${stats.patterns} dynamic shape(s) · ` +
                `${stats.missing} missing · ` +
                `${stats.unreferenced} unreferenced`,
        );
        if (errors) process.exit(1);
    };

    let declaredKeys;
    try {
        declaredKeys = Object.keys(JSON.parse(langSource));
    } catch {
        // Scanning would be pointless: with nothing to compare against, every
        // key the package references reports as missing. `analyzeCoverage`
        // says the one true thing instead.
        finish(
            analyzeCoverage({
                langSource,
                langFile,
                references: {
                    keys: [],
                    namespaces: [],
                    patterns: [],
                    findings: [],
                },
            }),
        );
        return;
    }

    const roots = config.langKeyRoots ?? keyRootsOf(declaredKeys);
    const scripts = readMatching(config.langScripts, config.rootDir);
    const templates = readMatching(config.langTemplates, config.rootDir);
    // Named rather than left to pass: with nothing scanned, every key reports
    // as unreferenced and nothing reports as missing, so a run that looked at
    // no files at all would exit zero and prove nothing.
    if (!scripts.length && !templates.length) {
        die(
            `no sources matched \`${config.langScripts.join("`, `")}\` or ` +
                `\`${config.langTemplates.join("`, `")}\` under ` +
                `${config.rootDir}.`,
        );
    }
    const sets = [
        ...scripts.map((file) =>
            collectScriptReferences(file.text, { file: file.path, roots }),
        ),
        ...templates.map((file) =>
            collectTemplateReferences(file.text, { file: file.path, roots }),
        ),
    ];

    if (config.langReferences) {
        const module = await import(`file://${config.langReferences}`).catch(
            (err) =>
                die(
                    `cannot load \`packageBuild.lang.references\` ` +
                        `(${config.langReferences}): ${err.message}`,
                ),
        );
        if (typeof module.references !== "function") {
            die(
                `\`packageBuild.lang.references\` ` +
                    `(${config.langReferences}) exports no \`references\` ` +
                    `function. It must export ` +
                    `\`references(context) -> ReferenceSet\`.`,
            );
        }
        sets.push(
            await module.references({
                config: loadPackConfig(),
                rootDir: config.rootDir,
                roots,
                // The sources, already read, so the contributor sees exactly
                // the text the built-in scan saw.
                files: scripts,
            }),
        );
    }

    finish(
        analyzeCoverage({
            langSource,
            langFile,
            references: mergeReferences(sets),
            retained: config.langRetained,
            roots,
        }),
    );
}

/**
 * `lang hardcoded` — does the markup's user-visible text go through
 * localization, and does each template still compile?
 *
 * The reverse of `lang coverage`, which walks key → file and is blind to a
 * template that mentions no key at all.
 *
 * @param {Readonly<import("../config.mjs").PackageBuildConfig>} config
 * @returns {void}
 */
function langHardcoded(config) {
    const templates = readMatching(config.langTemplates, config.rootDir);
    if (!templates.length) {
        die(
            `no templates matched ` +
                `\`${config.langTemplates.join("`, `")}\` under ` +
                `${config.rootDir}.`,
        );
    }

    let literals = 0;
    let broken = 0;
    for (const file of templates) {
        literals += reportFindings(
            findHardcodedText(file.text, { allow: config.langAllow }),
            { file: file.path },
        );
        broken += reportFindings(findTemplateSyntaxErrors(file.text), {
            file: file.path,
        });
    }

    if (literals || broken) {
        if (literals) {
            console.error(
                `\npackage-build: ${literals} user-visible literal(s) are not ` +
                    `localized. Replace each with a {{localize}} call and add ` +
                    `the key, or record it in \`packageBuild.lang.allow\` with ` +
                    `the reason it is not prose.`,
            );
        }
        if (broken) {
            console.error(
                `\npackage-build: ${broken} template(s) do not compile. A ` +
                    `{{localize …}} nested inside another mustache is legal in ` +
                    `an HTML attribute but a parse error inside a helper's ` +
                    `hash — use a (localize …) subexpression there.`,
            );
        }
        process.exit(1);
    }

    console.log(
        `package-build: ${templates.length} template(s) fully localized and ` +
            `compiling.`,
    );
}

/**
 * `lang <action>` — the three localization guards.
 *
 * They are three questions about one subject, and each is blind to what the
 * others see: `check` asks whether the file will load at all, `coverage`
 * whether the keys and the code agree, `hardcoded` whether the markup ever
 * asks for a key in the first place.
 *
 * @returns {object} The yargs command module.
 */
function langCommand() {
    return {
        command: "lang <action>",
        describe: "Localization checks",
        builder: (y) =>
            y
                .positional("action", {
                    choices: ["check", "coverage", "hardcoded"],
                    describe:
                        "check: the files are expandObject-safe · " +
                        "coverage: keys and code agree · " +
                        "hardcoded: templates localize their text",
                })
                .option("unused", {
                    type: "boolean",
                    default: false,
                    describe:
                        "coverage: list every unreferenced key, not a preview",
                }),
        handler: handler(async (args) => {
            const config = loadPackageBuildConfig();
            if (args.action === "check") return langCheck(config);
            if (args.action === "hardcoded") return langHardcoded(config);
            return langCoverage(config, args);
        }),
    };
}

/**
 * `bundle check` — does the manifest agree with the bundle it points at?
 *
 * Three ways a package can be built successfully and still not load, none of
 * which the bundler can see because each is a disagreement between two files:
 * the entry listed under both `esmodules` and `scripts` (Foundry loads it
 * twice), under neither (Foundry never loads it), or under `esmodules` while
 * the emitted file only parses as a classic script. The last fails at runtime
 * with a message about whichever `import` came first and says nothing about the
 * manifest, which is the kind of error that costs an afternoon.
 *
 * Both files are read from the stage, because the stage is what ships. Checking
 * sources would answer for a package nobody installs.
 *
 * @returns {object} The yargs command module.
 */
function bundleCommand() {
    return {
        command: "bundle <action>",
        describe: "Code-bundle checks",
        builder: (y) =>
            y.positional("action", {
                choices: ["check"],
                describe:
                    "check: verify the manifest and the staged bundle agree",
            }),
        handler: handler(() => {
            const config = loadPackageBuildConfig();
            const stageDir = path.join(config.rootDir, config.stageDir);
            const manifestPath = path.join(stageDir, `${config.artifact}.json`);
            const bundlePath = path.join(stageDir, config.bundleEntry);

            // Named explicitly rather than left to a missing-file stack trace:
            // both absences mean "the stage was not built", and a reader who
            // sees the path knows which step to run.
            for (const [what, where] of [
                ["manifest", manifestPath],
                ["bundle", bundlePath],
            ]) {
                if (!fs.existsSync(where)) {
                    die(
                        `no staged ${what} at ` +
                            `${path.relative(config.rootDir, where)} — build ` +
                            `the stage before checking it.`,
                    );
                }
            }

            const relative = path.relative(config.rootDir, bundlePath);
            const { findings, declaredAs } = checkBundleLoading({
                manifest: JSON.parse(fs.readFileSync(manifestPath, "utf8")),
                source: fs.readFileSync(bundlePath, "utf8"),
                entry: config.bundleEntry,
                manifestName: path.relative(config.rootDir, manifestPath),
            });

            if (reportFindings(findings, { file: relative })) process.exit(1);

            console.log(
                `package-build: ${config.bundleEntry} is declared under ` +
                    `"${declaredAs}" and loads as one.`,
            );
        }),
    };
}

/**
 * `release` — zip the staged package for a GitHub release.
 *
 * The artifact name is derived from `packageKind`: Foundry installs a system
 * from `system.json` and a module from `module.json`, so the kind already
 * decides it and no repository states it.
 *
 * @returns {object} The yargs command module.
 */
function releaseCommand() {
    return {
        command: "release",
        describe: "Package the staged build for release",
        builder: (y) => y,
        handler: handler(async () => {
            const config = loadPackageBuildConfig();
            const { zip, version, bytes } = await packRelease({
                artifact: config.artifact,
            });
            console.log(
                `✅ Packaged ${version} for release: ` +
                    `${path.relative(config.rootDir, zip)} ` +
                    `(${(bytes / 1024 / 1024).toFixed(1)} MB)`,
            );
        }),
    };
}

/**
 * `deploy <stage>` — push the staged package to a Foundry data directory.
 *
 * `packageKind` and `packageId` come from the shared configuration, where they
 * were already declared. Every consumer's `push-stage.mjs` hard-coded them a
 * second time, which is two places for one fact and exactly the drift this
 * command removes.
 *
 * @returns {object} The yargs command module.
 */
function deployCommand() {
    return {
        command: "deploy <stage>",
        describe: "Deploy the staged package to a stage",
        builder: (y) =>
            y.positional("stage", {
                type: "string",
                describe: "Target stage (e.g. dev, qa, prod, test)",
            }),
        handler: handler(async (args) => {
            const config = loadPackageBuildConfig();

            await loadEnvironment(config);

            const { stage } = await deployStage({
                stage: args.stage,
                source: path.join(config.rootDir, config.stageDir),
                packageKind: config.packageKind,
                packageId: config.packageId,
                prefix: config.envPrefix,
                log: (message) => console.log(message),
            });
            console.log(`Deployed stage '${stage}' successfully.`);
        }),
    };
}

/**
 * `container <stage> <action>` — run a stage's Foundry in a container.
 *
 * The seam is the deploy's own: `deploy <stage>` installs the staged package
 * into `FOUNDRYVTT_<STAGE>_DATA`, and this mounts that same directory and
 * serves it. Nothing about the destination is stated twice.
 *
 * Every action shares one shape — a stage and an action — so this is a single
 * command with a closed set of choices rather than eight of them. The stage
 * leads, as it does in `deploy <stage>`, which is also what lets a consumer
 * wrap it once per stage: `npm run container:dev start`.
 *
 * @returns {object} The yargs command module.
 */
function containerCommand() {
    return {
        command: "container <stage> <action>",
        describe: "Run a stage's Foundry in a container",
        builder: (y) =>
            y
                .positional("stage", {
                    type: "string",
                    describe: "Target stage (e.g. dev, qa, prod, test)",
                })
                .positional("action", {
                    choices: [...CONTAINER_ACTIONS],
                    describe: "What to do with the stage's container",
                }),
        handler: handler(async (args) => {
            const config = loadPackageBuildConfig();
            await loadEnvironment(config);
            const status = containerAction({
                action: String(args.action),
                stage: String(args.stage).trim().toLowerCase(),
                config,
                log: (message) => console.log(message),
            });
            process.exit(status);
        }),
    };
}

/** What `package-build e2e` can be asked to do. */
const E2E_ACTIONS = ["seed", ...E2E_MODES, "fast", "sweep"];

/**
 * `e2e <action>` — stand a Foundry world up and drive a suite against it.
 *
 * **The suite itself is never this package's.** Seeding a disposable world,
 * waiting for it to become *active* rather than merely reachable, and tearing
 * it down again are nobody's local problem; what runs against it is entirely
 * the repository's, and is named in `packageBuild.e2e.suite`.
 *
 * The actions answer different questions. `seed` writes the world.
 * `run` and `open` are the from-scratch path — deploy, reseed, recreate, wait,
 * run — and are the only ones that may change Foundry build, because a seeded
 * world is stamped with the build that created it. `fast` is the iteration
 * loop. `sweep` is the same full run against a build the repository does not
 * pin, so `compatibility.verified` can be evidence rather than hope.
 *
 * Everything after the action is the suite's, and is passed through untouched.
 *
 * @returns {object} The yargs command module.
 */
function e2eCommand() {
    return {
        command: "e2e <action>",
        describe: "Run a suite against a served Foundry world",
        builder: (y) =>
            y
                .positional("action", {
                    choices: E2E_ACTIONS,
                    describe:
                        "seed: write the world · run/open: from scratch · " +
                        "fast: rebuild and re-run · sweep: another Foundry build",
                })
                // Everything after the action belongs to the suite or to the
                // fast loop, so this command line must not judge it.
                .strict(false),
        handler: handler(async (args) => {
            const action = String(args.action);
            const config = loadPackageBuildConfig();
            await loadEnvironment(config);
            const log = (message) => console.log(message);
            const tail = e2eTail(action);

            if (action === "seed") {
                await seedTestWorld({
                    config,
                    packageJson: readPackageJson(config),
                    log,
                });
                return;
            }

            const status =
                action === "fast" ? await e2eFast({ config, argv: tail, log })
                : action === "sweep" ?
                    await e2eSweep({
                        config,
                        packageJson: readPackageJson(config),
                        argv: tail,
                        log,
                    })
                :   await e2eRun({
                        config,
                        packageJson: readPackageJson(config),
                        mode: /** @type {"run"|"open"} */ (action),
                        suiteArgs: tail,
                        log,
                    });
            process.exit(status);
        }),
    };
}

yargs(hideBin(process.argv))
    .scriptName("package-build")
    .command(cleanCommand())
    .command(assetsCommand())
    .command(manifestCommand())
    .command(langCommand())
    .command(bundleCommand())
    .command(releaseCommand())
    .command(deployCommand())
    .command(containerCommand())
    .command(e2eCommand())
    .demandCommand(1, "Name a command.")
    .strict()
    .version(ownVersion())
    .help()
    .alias("help", "h")
    .fail((message, err) => die(err ?? message)).argv;
