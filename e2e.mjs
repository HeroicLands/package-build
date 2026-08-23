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
 * The end-to-end harness: a disposable Foundry world, served from a container,
 * with a browser suite driven against it.
 *
 * **The harness does not know what the suite is.** That is the whole division
 * of labour here. Standing a licensed Foundry up, seeding a world whose
 * Gamemaster password is known, waiting for that world to be *active* rather
 * than merely reachable, tearing it all down again — none of that is one
 * repository's problem, and all of it used to live in one. What runs against
 * the served world is named in `packageBuild.e2e.suite`, the same way an asset
 * transform or a manifest-flags module is named: the repository's code, the
 * toolchain's plumbing.
 *
 * Three shapes of run, and they answer different questions:
 *
 * - **`run`** — from scratch. Deploy, reseed, recreate the container, wait,
 *   run, tear down. The only path that may change Foundry build, because the
 *   seeded world is stamped with the build that created it and Foundry refuses
 *   to auto-launch a world stamped by another.
 * - **`fast`** — the iteration loop. Rebuild what changed, redeploy, cycle the
 *   world, wait, re-run. Every step of it has a quiet failure mode, which is
 *   why it is one command rather than a remembered sequence.
 * - **`sweep`** — the same full run against a build the repository does *not*
 *   pin, so `compatibility.verified` can be evidence rather than hope.
 *
 * @module
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { deployStage } from "./deploy.mjs";
import {
    containerAction,
    containerExists,
    dataEnvVar,
    resolveContainer,
    resolveDataRoot,
    runDocker,
    runningFoundryContainers,
} from "./container.mjs";

/**
 * The Gamemaster's document id in every seeded world.
 *
 * Fixed, and deliberately not derived from the package: a spec has to know it
 * without a handoff from the seed, and the world is disposable, so there is
 * nothing for a per-package id to disambiguate. Sixteen alphanumeric
 * characters, which is the shape Foundry document ids take.
 */
export const E2E_GM_ID = "heroiclandsE2EGM";

/**
 * The seeded, pre-activated default scene's id.
 *
 * A non-empty world means Foundry's New User Experience does not auto-start the
 * welcome tour, whose callout overlays sheets; an *active* scene at load means
 * the canvas is ready, which several read paths depend on.
 */
export const E2E_SCENE_ID = "heroiclandsScene";

/** The world setting that switches a module on. */
const E2E_MODULE_SETTING_ID = "heroiclandsMods1";

/** How the suite may be run. */
export const E2E_MODES = Object.freeze(["run", "open"]);

/** An exact Foundry build: a major and a build number, nothing else. */
const EXACT_BUILD = /^\d+\.\d+$/;

/**
 * Hash a password the way Foundry's `core/auth.mjs` does: pbkdf2, 1000 rounds,
 * 64 bytes, sha512. A different shape logs nobody in.
 *
 * @param {string} password - The plaintext password.
 * @param {string} salt - The hex salt.
 * @returns {string} The hex hash.
 */
export function hashPassword(password, salt) {
    return crypto
        .pbkdf2Sync(password, salt, 1000, 64, "sha512")
        .toString("hex");
}

/**
 * The disposable world's identity and credentials.
 *
 * @typedef {object} E2EWorld
 * @property {string} worldId
 * @property {string} worldTitle
 * @property {string} worldDescription
 * @property {string} gmId
 * @property {string} gmName
 * @property {string} gmPassword
 */

/**
 * Resolve the seeded world from configuration and the environment.
 *
 * Everything derives from the package id unless the repository says otherwise,
 * and the environment overrides under the repository's own variable prefix —
 * the same prefix the deploy already uses — so a contributor can point a run at
 * a scratch world without touching committed configuration.
 *
 * @param {object} config - The resolved package-build configuration.
 * @param {NodeJS.ProcessEnv} [env] - Environment to read.
 * @returns {E2EWorld} The resolved world.
 */
export function resolveE2EWorld(config, env = process.env) {
    const prefix = `${config.envPrefix}_E2E_`;
    const world = config.e2eWorld ?? {};
    const gm = config.e2eGm ?? {};
    return {
        worldId:
            env[`${prefix}WORLD_ID`]?.trim() ||
            world.id ||
            `${config.packageId}-e2e`,
        worldTitle:
            env[`${prefix}WORLD_TITLE`]?.trim() ||
            world.title ||
            `${config.packageId} E2E`,
        worldDescription:
            world.description ||
            `Disposable world for ${config.packageId} end-to-end tests.`,
        gmId: E2E_GM_ID,
        gmName: env[`${prefix}GM_NAME`]?.trim() || gm.name || "Gamemaster",
        gmPassword:
            env[`${prefix}GM_PASSWORD`]?.trim() ||
            gm.password ||
            `${config.packageId}-e2e`,
    };
}

/**
 * The `world.json` a seeded world carries.
 *
 * Foundry re-stamps `coreVersion`, `systemVersion` and `compatibility` from the
 * running core on launch, so a generation-level range is enough here — the
 * point is a world that launches without a migration prompt or a setup step.
 *
 * @param {object} opts
 * @param {string} opts.worldId
 * @param {string} opts.worldTitle
 * @param {string} opts.worldDescription
 * @param {string} opts.systemId - The system the world runs.
 * @param {string} opts.systemVersion - That system's version.
 * @param {string} opts.coreVersion - The Foundry generation.
 * @returns {object} The world manifest.
 */
export function worldManifest({
    worldId,
    worldTitle,
    worldDescription,
    systemId,
    systemVersion,
    coreVersion,
}) {
    return {
        id: worldId,
        title: worldTitle,
        description: worldDescription,
        system: systemId,
        coreVersion,
        systemVersion,
        compatibility: { minimum: coreVersion, verified: coreVersion },
        background: "",
        nextSession: null,
        resetKeys: false,
        safeMode: false,
    };
}

/**
 * The seeded world's single Gamemaster.
 *
 * @param {object} opts
 * @param {string} opts.id - The fixed document id.
 * @param {string} opts.name - The user name.
 * @param {string} opts.password - The plaintext password.
 * @param {string} opts.salt - The hex salt to hash it with.
 * @returns {object} The user document.
 */
export function gmDocument({ id, name, password, salt }) {
    return {
        _id: id,
        name,
        role: 4, // GAMEMASTER
        password: hashPassword(password, salt),
        passwordSalt: salt,
        permissions: {},
        flags: {},
        _key: `!users!${id}`,
    };
}

/**
 * The one pre-activated scene every seeded world carries.
 *
 * @returns {object} The scene document.
 */
export function defaultSceneDocument() {
    return {
        _id: E2E_SCENE_ID,
        name: "E2E Default Scene",
        active: true,
        width: 2000,
        height: 2000,
        padding: 0.25,
        grid: { type: 1, size: 100 }, // 1 = CONST.GRID_TYPES.SQUARE
        _key: `!scenes!${E2E_SCENE_ID}`,
    };
}

/**
 * The world setting that switches a module package on.
 *
 * A **system** is the world's own — `world.json` names it and Foundry loads it.
 * A **module** is not: it has to be activated, and the switch is
 * `core.moduleConfiguration`, a world setting holding a JSON map of package id
 * to enabled. Without it a module repository would stand its suite up against a
 * world that never loaded the very thing under test.
 *
 * @param {string} packageId - The module to enable.
 * @returns {object} The setting document.
 */
export function moduleConfigurationDocument(packageId) {
    return {
        _id: E2E_MODULE_SETTING_ID,
        key: "core.moduleConfiguration",
        value: JSON.stringify({ [packageId]: true }),
        _key: `!settings!${E2E_MODULE_SETTING_ID}`,
    };
}

/**
 * Whether a `/join` response shows a world that is actually **active**.
 *
 * Foundry answers on the port long before a world is serving; a suite started
 * at that moment fails every spec for no visible reason. The join screen
 * renders the form only once a world is active, so that is what is waited for.
 *
 * @param {string} body - The response body.
 * @returns {boolean} Whether the world is active.
 */
export function isWorldActive(body) {
    return body.includes('id="join-game"');
}

/**
 * The build a sweep was asked to run against.
 *
 * There is no default, deliberately. The product of a sweep is a citable result
 * — "the full suite passed on 14.367" — and a hard-coded "newest release" would
 * rot on Foundry's next release day, quietly turning the sweep into a second
 * pinned build. A bare major or a tag is refused for the same reason: the image
 * passes it through verbatim, so the run would name no particular Foundry.
 *
 * @param {string[]} argv - Arguments after the action.
 * @returns {string} The exact build, trimmed.
 * @throws {Error} When none was given, or it is not an exact build.
 */
export function resolveSweepVersion(argv) {
    const version = (argv[0] ?? "").trim();
    if (!version) {
        throw new Error(
            "A sweep must name the build it runs against, e.g. " +
                "`package-build e2e sweep 14.367`. There is no default: the " +
                "point of a sweep is a result you can cite, and the newest " +
                "release is not a constant a repository can hold.",
        );
    }
    if (!EXACT_BUILD.test(version)) {
        throw new Error(
            `"${version}" is not an exact Foundry build. Name a major and a ` +
                "build number (e.g. `14.367`) — a bare major or a tag resolves " +
                "to whatever the registry serves that day, so the run would " +
                "name no particular Foundry.",
        );
    }
    return version;
}

/**
 * What a fast loop was asked to do.
 *
 * @typedef {object} FastArgs
 * @property {string[]} targets    Build targets, in declared order.
 * @property {boolean} recreate    Whether the container must be recreated.
 * @property {boolean} runSuite    Whether to run the suite at all.
 * @property {string[]} suiteArgs  Arguments handed to the suite verbatim.
 */

/**
 * Parse the fast loop's arguments against the repository's build table.
 *
 * Build order is **declaration order**, not the order they were asked for: a
 * bundler that empties the stage has to run before the passes that copy into
 * it, and the repository already stated that by writing them down in order.
 *
 * @param {string[]} argv - Arguments after the action.
 * @param {Record<string, {script: string, recreate: boolean}>} build - The
 *   declared build table.
 * @returns {FastArgs} What to do.
 * @throws {Error} On an unknown build target.
 */
export function parseFastArgs(argv, build) {
    const passthroughAt = argv.indexOf("--");
    const own = passthroughAt === -1 ? argv : argv.slice(0, passthroughAt);
    const suiteArgs = passthroughAt === -1 ? [] : argv.slice(passthroughAt + 1);

    let requested = "all";
    let recreate = false;
    let runSuite = true;

    for (let i = 0; i < own.length; i += 1) {
        const arg = /** @type {string} */ (own[i]);
        if (arg.startsWith("--build="))
            requested = arg.slice("--build=".length);
        else if (arg === "--recreate") recreate = true;
        else if (arg === "--no-run") runSuite = false;
        else if (arg === "--spec") {
            suiteArgs.push("--spec", own[i + 1] ?? "");
            i += 1;
        } else if (arg.startsWith("--spec=")) {
            suiteArgs.push("--spec", arg.slice("--spec=".length));
        } else suiteArgs.push(arg);
    }

    const declared = Object.keys(build);
    let wanted;
    if (requested === "all") wanted = declared;
    else if (requested === "none") wanted = [];
    else {
        wanted = requested
            .split(",")
            .map((target) => target.trim())
            .filter(Boolean);
        for (const target of wanted) {
            if (!build[target]) {
                throw new Error(
                    `Unknown build target '${target}'. ` +
                        (declared.length ?
                            `Declared under \`packageBuild.e2e.build\`: ` +
                            `${declared.join(", ")}, plus all and none.`
                        :   `This repository declares none.`),
                );
            }
        }
    }

    const targets = declared.filter((target) => wanted.includes(target));
    // A target that changes something read once at world launch — the manifest
    // — needs the world relaunched, not merely the files replaced.
    if (targets.some((target) => build[target].recreate)) recreate = true;

    return { targets, recreate, runSuite, suiteArgs };
}

/**
 * Seed the disposable world into the end-to-end stage's data root.
 *
 * Writes `world.json` and compiles each LevelDB collection from JSON, so the
 * result is a genuine world Foundry launches without migration or setup. The
 * world directory is wiped and rewritten each time, which is what makes a run
 * repeatable.
 *
 * @param {object} opts
 * @param {object} opts.config - The resolved package-build configuration.
 * @param {object} opts.packageJson - The repository's `package.json`.
 * @param {NodeJS.ProcessEnv} [opts.env] - Environment to read.
 * @param {(message: string) => void} [opts.log] - Progress reporting.
 * @returns {Promise<{worldDir: string, world: E2EWorld}>} Where it landed.
 */
export async function seedTestWorld({
    config,
    packageJson,
    env = process.env,
    log = () => {},
}) {
    const stage = config.e2eStage;
    const dataRoot = requireIsolatedDataRoot(stage, env);
    const world = resolveE2EWorld(config, env);

    const worldDir = path.join(dataRoot, "Data", "worlds", world.worldId);
    await fs.rm(worldDir, { recursive: true, force: true });
    await fs.mkdir(worldDir, { recursive: true });

    const coreVersion = String(config.compatibilityMinimum ?? "").split(".")[0];
    if (!coreVersion) {
        throw new Error(
            "Cannot seed a world without knowing which Foundry generation it " +
                "is for. Declare `compatibility.minimum` at the top level of " +
                "content-build.config.yaml.",
        );
    }

    await fs.writeFile(
        path.join(worldDir, "world.json"),
        JSON.stringify(
            worldManifest({
                ...world,
                systemId: config.systemId,
                systemVersion: config.systemVersion ?? packageJson.version,
                coreVersion,
            }),
            null,
            2,
        ) + "\n",
    );

    // Everything the world holds, as collection → documents. The built-ins are
    // what makes a world *testable* rather than what makes it this
    // repository's: one known Gamemaster, and one active scene.
    const salt = crypto.randomBytes(32).toString("hex");
    const collections = {
        users: [
            gmDocument({
                id: world.gmId,
                name: world.gmName,
                password: world.gmPassword,
                salt,
            }),
        ],
        scenes: [defaultSceneDocument()],
    };
    if (config.packageKind === "modules") {
        collections.settings = [moduleConfigurationDocument(config.packageId)];
    }

    const { compilePack } = await import("@foundryvtt/foundryvtt-cli");
    const sourceRoot = path.join(worldDir, ".seed-src");
    for (const [collection, documents] of Object.entries(collections)) {
        const sourceDir = path.join(sourceRoot, collection);
        await fs.mkdir(sourceDir, { recursive: true });
        for (const [index, document] of documents.entries()) {
            await fs.writeFile(
                path.join(sourceDir, `${index}-${document._id}.json`),
                JSON.stringify(document, null, 2) + "\n",
            );
        }
    }

    // Whatever else the repository wants in the world — which actors, which
    // journals. Copied in beside the built-ins so a declared `scenes` directory
    // joins the default scene rather than replacing the collection.
    for (const [collection, from] of Object.entries(config.e2eDocuments)) {
        const sourceDir = path.join(sourceRoot, collection);
        await fs.mkdir(sourceDir, { recursive: true });
        await fs.cp(path.join(config.rootDir, from), sourceDir, {
            recursive: true,
        });
    }

    for (const collection of await fs.readdir(sourceRoot)) {
        await compilePack(
            path.join(sourceRoot, collection),
            path.join(worldDir, "data", collection),
            { log: false },
        );
    }
    await fs.rm(sourceRoot, { recursive: true, force: true });

    log(`Seeded world '${world.worldId}' at ${worldDir}`);
    log(`  GM user:  ${world.gmName} (id ${world.gmId})`);
    log(`  password: ${world.gmPassword}`);
    return { worldDir, world };
}

/**
 * The end-to-end stage's data root, refused when it is another stage's.
 *
 * Pointing it at a real stage would let the seed wipe worlds there, and would
 * make the image reuse that stage's `Config/license.json` — ignoring the key
 * dedicated to the suite. Both failures are quiet and one of them loses data.
 *
 * @param {string} stage - The end-to-end stage.
 * @param {NodeJS.ProcessEnv} env - Environment to read.
 * @returns {string} The local path.
 * @throws {Error} When it is unset, remote, or shared with another stage.
 */
function requireIsolatedDataRoot(stage, env) {
    const dataRoot = resolveDataRoot(stage, { env });
    const resolved = path.resolve(dataRoot);
    for (const other of ["dev", "qa", "prod"]) {
        if (other === stage) continue;
        const target = env[dataEnvVar(other)]?.trim();
        if (target && path.resolve(target) === resolved) {
            throw new Error(
                `${dataEnvVar(stage)} must be a separate, empty directory — it ` +
                    `currently matches ${dataEnvVar(other)} (${resolved}). Point ` +
                    `it at a fresh directory so the disposable world and the ` +
                    `licence stay isolated.`,
            );
        }
    }
    return dataRoot;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll until the world is active, or fail with a diagnosis.
 *
 * A licence failure never recovers, so it is detected from the container's own
 * log and reported at once rather than after a three-minute timeout that says
 * nothing about why.
 *
 * @param {object} opts
 * @param {string} opts.url - The container's base URL.
 * @param {string} opts.container - The container name, for its log.
 * @param {string} opts.stage - The stage, named in a licence failure.
 * @param {number} [opts.timeoutMs] - How long to wait.
 * @param {(message: string) => void} [opts.log] - Progress reporting.
 * @returns {Promise<void>} Resolves once the world is active.
 * @throws {Error} On a licence failure or a timeout.
 */
export async function waitForWorld({
    url,
    container,
    stage,
    timeoutMs = 180_000,
    log = () => {},
}) {
    const join = `${url}/join`;
    const deadline = Date.now() + timeoutMs;
    log(`Waiting for the world at ${join} …`);
    while (Date.now() < deadline) {
        const logs = captureContainerLog(container);
        if (/license verification failed/i.test(logs)) {
            throw new Error(
                "Foundry licence verification failed. The end-to-end container " +
                    "needs its own SIGNED licence: dedicate one with " +
                    `FOUNDRYVTT_${stage.toUpperCase()}_LICENSE_KEY ` +
                    "plus FOUNDRY_USERNAME/FOUNDRY_PASSWORD so the image signs " +
                    "it — a bare key stays unsigned, and another installation's " +
                    "license.json does not verify. A licence shared with a " +
                    "running container is single-seat and will fail too.",
            );
        }
        try {
            const response = await fetch(join);
            if (isWorldActive(await response.text())) {
                log("The world is active.");
                return;
            }
        } catch {
            // Not answering yet — the server is still booting.
        }
        await sleep(2000);
    }
    throw new Error(
        `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the ` +
            `world to activate. Check \`package-build container logs\`.`,
    );
}

/**
 * @param {string} container - Container name.
 * @returns {string} The tail of its log, or `""`.
 */
function captureContainerLog(container) {
    const result = spawnSync("docker", ["logs", "--tail", "40", container], {
        encoding: "utf8",
    });
    return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

/**
 * Run the repository's suite.
 *
 * `ELECTRON_RUN_AS_NODE` is stripped from the child environment. Editor
 * terminals and most agent shells export it, and with it set an Electron-based
 * runner launches as plain Node, rejects its own flags, and dies with a
 * `MODULE_NOT_FOUND` naming nothing relevant.
 *
 * @param {object} opts
 * @param {string[]} opts.command - The program and its arguments.
 * @param {string[]} [opts.args] - Extra arguments, appended verbatim.
 * @param {string} opts.cwd - The repository root.
 * @param {NodeJS.ProcessEnv} [opts.env] - Environment for the child.
 * @param {(message: string) => void} [opts.log] - Progress reporting.
 * @returns {number} The suite's exit status.
 */
export function runSuite({
    command,
    args = [],
    cwd,
    env = process.env,
    log = () => {},
}) {
    const [program, ...rest] = command;
    const childEnv = { ...env };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    log(`▸ ${[...command, ...args].join(" ")}`);
    const result = spawnSync(
        /** @type {string} */ (program),
        [...rest, ...args],
        {
            stdio: "inherit",
            cwd,
            env: childEnv,
            shell: process.platform === "win32",
        },
    );
    if (result.error) throw result.error;
    return result.status ?? 1;
}

/**
 * The suite command for a mode, or a clear failure when none is declared.
 *
 * @param {object} config - The resolved package-build configuration.
 * @param {"run"|"open"} mode - Which command to take.
 * @returns {string[]} The program and its arguments.
 * @throws {Error} When the repository declares no such command.
 */
export function suiteCommand(config, mode) {
    const command = config.e2eSuite?.[mode];
    if (!command?.length) {
        throw new Error(
            `This repository declares no end-to-end suite to \`${mode}\`. Name ` +
                `one under \`packageBuild.e2e.suite.${mode}\` — for example ` +
                `\`${mode}: [npx, cypress, ${mode}]\`.`,
        );
    }
    return command;
}

/**
 * A full, from-scratch end-to-end run.
 *
 * Deploy the staged package, reseed the world, recreate the container onto it,
 * wait for it to activate, run the suite, and tear the container down again —
 * except in interactive mode, where it is left serving.
 *
 * This is the only path that may change Foundry build: the seeded world is
 * stamped with the build that created it, and Foundry refuses to auto-launch a
 * world stamped by another.
 *
 * @param {object} opts
 * @param {object} opts.config - The resolved package-build configuration.
 * @param {object} opts.packageJson - The repository's `package.json`.
 * @param {"run"|"open"} [opts.mode] - Headless or interactive.
 * @param {string[]} [opts.suiteArgs] - Extra arguments for the suite.
 * @param {NodeJS.ProcessEnv} [opts.env] - Environment to read.
 * @param {(message: string) => void} [opts.log] - Progress reporting.
 * @returns {Promise<number>} The suite's exit status.
 */
export async function e2eRun({
    config,
    packageJson,
    mode = "run",
    suiteArgs = [],
    env = process.env,
    log = () => {},
}) {
    if (!E2E_MODES.includes(mode)) {
        throw new Error(`Invalid mode '${mode}'. Valid modes: run, open.`);
    }
    const command = suiteCommand(config, mode);
    const stage = config.e2eStage;
    const container = resolveContainer({ stage, config, env });

    // Foundry is single-seat, so a second licensed instance will simply refuse
    // to verify. Say so before the run rather than after the timeout.
    const others = runningFoundryContainers(container.name);
    if (others.length) {
        log(
            `⚠ Other Foundry container(s) running: ${others.join(", ")}. Fine ` +
                `if this stage uses a DIFFERENT licence ` +
                `(FOUNDRYVTT_${stage.toUpperCase()}_LICENSE_KEY); a shared one ` +
                `is single-seat and will fail to verify.`,
        );
    }

    log(`▸ deploy ${stage}`);
    await deployStage({
        stage,
        source: path.join(config.rootDir, config.stageDir),
        packageKind: config.packageKind,
        packageId: config.packageId,
        env,
        prefix: config.envPrefix,
        log,
    });

    log("▸ seed");
    const { world } = await seedTestWorld({ config, packageJson, env, log });

    // The world is chosen at container-create time, so it is passed in the
    // environment the recreate bakes in.
    const runEnv = {
        ...env,
        [`FOUNDRYVTT_${stage.toUpperCase()}_WORLD`]: world.worldId,
    };
    log(`▸ container recreate (world ${world.worldId})`);
    const status = containerAction({
        action: "recreate",
        stage,
        config,
        env: runEnv,
        log,
    });
    if (status !== 0) return status;

    try {
        await waitForWorld({
            url: container.url,
            container: container.name,
            stage,
            log,
        });
        return runSuite({
            command,
            args: suiteArgs,
            cwd: config.rootDir,
            env: runEnv,
            log,
        });
    } finally {
        // Interactive mode leaves the server up; a headless run does not.
        if (mode === "run") runDocker(["stop", container.name]);
    }
}

/**
 * The iteration loop: rebuild what changed, redeploy, cycle, re-run.
 *
 * Each step has a quiet failure mode, and hand-rolling the sequence means
 * meeting them one at a time. The bundler empties the stage, so build order is
 * the declared one; the deploy is a destructive mirror, so it runs on a
 * complete stage; a running Foundry holds its packs open, so the world is
 * always cycled; the container answers on its port long before the world is
 * serving, so the loop waits for the world.
 *
 * @param {object} opts
 * @param {object} opts.config - The resolved package-build configuration.
 * @param {string[]} [opts.argv] - Arguments after the action.
 * @param {NodeJS.ProcessEnv} [opts.env] - Environment to read.
 * @param {(message: string) => void} [opts.log] - Progress reporting.
 * @returns {Promise<number>} The suite's exit status.
 */
export async function e2eFast({
    config,
    argv = [],
    env = process.env,
    log = () => {},
}) {
    const {
        targets,
        recreate,
        runSuite: shouldRun,
        suiteArgs,
    } = parseFastArgs(argv, config.e2eBuild);
    const command = shouldRun ? suiteCommand(config, "run") : null;
    const stage = config.e2eStage;
    const container = resolveContainer({ stage, config, env });

    for (const target of targets) {
        const script = config.e2eBuild[target].script;
        log(`▸ npm run ${script}`);
        const result = spawnSync("npm", ["run", script], {
            stdio: "inherit",
            cwd: config.rootDir,
            env,
            shell: process.platform === "win32",
        });
        if (result.error) throw result.error;
        if ((result.status ?? 0) !== 0) return result.status ?? 1;
    }

    // Whether a container exists decides restart vs recreate, and it has to be
    // asked before the deploy — a first-ever run has no container to restart.
    const exists = containerExists(container.name);

    log(`▸ deploy ${stage}`);
    await deployStage({
        stage,
        source: path.join(config.rootDir, config.stageDir),
        packageKind: config.packageKind,
        packageId: config.packageId,
        env,
        prefix: config.envPrefix,
        log,
    });

    const action = !exists || recreate ? "recreate" : "restart";
    log(`▸ container ${action}`);
    const status = containerAction({ action, stage, config, env, log });
    if (status !== 0) return status;

    await waitForWorld({
        url: container.url,
        container: container.name,
        stage,
        log,
    });

    if (!command) {
        log("✅ The environment is current. Skipping the suite (--no-run).");
        return 0;
    }
    return runSuite({
        command,
        args: suiteArgs,
        cwd: config.rootDir,
        env,
        log,
    });
}

/**
 * The forward sweep: the full suite against a build the repository does not
 * pin.
 *
 * Routine runs go against the pinned build, which is the manifest's
 * `compatibility.minimum` — the claim the suite exists to defend. That leaves
 * the other direction untested: a new Foundry release can break the package and
 * nothing would notice until a user did.
 *
 * A green sweep is what licenses moving `compatibility.verified` to that build.
 * A red one is the early warning it exists to produce.
 *
 * @param {object} opts
 * @param {object} opts.config - The resolved package-build configuration.
 * @param {object} opts.packageJson - The repository's `package.json`.
 * @param {string[]} [opts.argv] - Arguments after the action.
 * @param {NodeJS.ProcessEnv} [opts.env] - Environment to read.
 * @param {(message: string) => void} [opts.log] - Progress reporting.
 * @returns {Promise<number>} The suite's exit status.
 */
export async function e2eSweep({
    config,
    packageJson,
    argv = [],
    env = process.env,
    log = () => {},
}) {
    const version = resolveSweepVersion(argv);
    const stage = config.e2eStage;
    log(
        `\ne2e sweep → Foundry ${version} (full suite, reseeded world)\n` +
            "This overrides the pin for this run only; nothing on disk " +
            "changes.\n",
    );
    // A full run, not a fast one: the seeded world is stamped with the build
    // that created it, so changing build requires the reseed only this path
    // does. Overriding the variable here also beats one set in a `.env` file,
    // which is loaded without overwriting what is already set.
    return e2eRun({
        config,
        packageJson,
        suiteArgs: argv.slice(1),
        env: {
            ...env,
            [`FOUNDRYVTT_${stage.toUpperCase()}_VERSION`]: version,
        },
        log,
    });
}
