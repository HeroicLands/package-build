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
 * Running a built package inside a Foundry VTT container.
 *
 * **The seam is the deploy's own.** `package-build deploy <stage>` installs a
 * staged package into `FOUNDRYVTT_<STAGE>_DATA`; this module bind-mounts that
 * same directory at `/data` and serves it. Nothing about the destination is
 * restated — running Foundry against what was just deployed is the next step
 * from one variable.
 *
 * The container runs the community `felddy/foundryvtt` image, which downloads
 * the correct Foundry build for its platform at run time. A local Foundry
 * install is deliberately **not** mounted: Foundry's Node distribution bundles
 * per-platform native modules (`better-sqlite3`, `classic-level`), so a macOS
 * install cannot run inside a Linux container.
 *
 * Licensing and provisioning are left to the image. Every `FOUNDRY_*` and
 * `CONTAINER_*` variable in the environment is passed through, so credentials,
 * a timed `FOUNDRY_RELEASE_URL`, or a pre-seeded cache are all a matter of
 * configuration rather than code. See https://hub.docker.com/r/felddy/foundryvtt.
 *
 * **The environment is baked in at create time.** `FOUNDRY_*` values are fixed
 * when the container is first created; a plain `start` or `restart` does not
 * pick up a change to one. `recreate` is what applies it.
 *
 * The rules are pure functions over data — what a stage resolves to, which
 * build a run pins, the argument vector that follows. The functions that talk
 * to `docker` or the filesystem are named for it.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

/**
 * Host port each conventional stage publishes, chosen so they can run at once.
 *
 * A stage a repository adds of its own declares its port in
 * `packageBuild.container.stages`; these four need no entry because every
 * HeroicLands package deploys to the same four.
 */
export const DEFAULT_STAGE_PORTS = Object.freeze({
    dev: 30000,
    qa: 30001,
    prod: 30002,
    test: 30003,
});

/** The port Foundry listens on inside the container. */
export const CONTAINER_PORT = 30000;

/**
 * Where a host-provided download cache is mounted.
 *
 * A dedicated mount point rather than a subpath of `/data` keeps the cache
 * independent of the data root, so one cache can serve every stage.
 */
export const CACHE_MOUNT = "/container_cache";

/** What `package-build container` can be asked to do. */
export const CONTAINER_ACTIONS = Object.freeze([
    "start",
    "stop",
    "restart",
    "recreate",
    "rm",
    "status",
    "logs",
    "pull",
]);

/**
 * The image tag used when the package claims no Foundry version at all.
 *
 * Deliberately not a major: a hard-coded `:14` here would be this package
 * choosing a Foundry generation on every consumer's behalf, and would rot on
 * the next one. A package that states a `compatibility.minimum` gets its own
 * major; one that states nothing floats, visibly.
 */
const FLOATING_IMAGE = "felddy/foundryvtt:release";

/**
 * The environment variable naming a stage's Foundry data root.
 *
 * Derived rather than tabulated, so a repository that adds a stage of its own
 * gets the variable without this package learning its name.
 *
 * @param {string} stage - The stage name.
 * @returns {string} The variable to read.
 */
export function dataEnvVar(stage) {
    return `FOUNDRYVTT_${stage.toUpperCase()}_DATA`;
}

/**
 * The container name for a package's stage.
 *
 * Named after the package so two HeroicLands packages can run their own
 * containers side by side, and stable so Foundry's signed licence — which is
 * bound to the container hostname — survives a recreate.
 *
 * @param {string} packageId - The Foundry package id.
 * @param {string} stage - The stage name.
 * @returns {string} The container name.
 */
export function containerName(packageId, stage) {
    return `${packageId}-foundry-${stage}`;
}

/**
 * A stage declared in `packageBuild.container.stages`.
 *
 * @typedef {object} ContainerStage
 * @property {number|null} port      Host port to publish.
 * @property {string|null} world     World to auto-launch; `""` forces none.
 * @property {string|null} version   Exact Foundry build to pin.
 */

/**
 * The host port a stage publishes.
 *
 * `FOUNDRYVTT_<STAGE>_PORT` first, then the stage's declared port, then the
 * conventional default.
 *
 * @param {string} stage - The stage name.
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env] - Environment to read.
 * @param {Record<string, ContainerStage>} [opts.stages] - Declared stages.
 * @returns {number} The host port.
 * @throws {Error} When the stage has no port from any source.
 */
export function resolveStagePort(
    stage,
    { env = process.env, stages = {} } = {},
) {
    const fromEnv = env[`FOUNDRYVTT_${stage.toUpperCase()}_PORT`]?.trim();
    const port =
        fromEnv ? Number(fromEnv)
        : stages[stage]?.port != null ? stages[stage].port
        : DEFAULT_STAGE_PORTS[stage];
    if (!Number.isFinite(port)) {
        throw new Error(
            `No host port for stage '${stage}'. Declare it under ` +
                `\`packageBuild.container.stages.${stage}.port\`, or set ` +
                `FOUNDRYVTT_${stage.toUpperCase()}_PORT.`,
        );
    }
    return Number(port);
}

/** An exact Foundry build: a major and a build number, nothing else. */
const EXACT_BUILD = /^\d+\.\d+$/;

/**
 * The exact Foundry build a stage is pinned to, or `null` to float.
 *
 * `FOUNDRYVTT_<STAGE>_VERSION` wins — that is how a sweep runs against a build
 * without touching committed configuration. Then the stage's own declared
 * version. Then, **for the end-to-end stage only**, the package's
 * `compatibility.minimum`.
 *
 * That last rule is the point. `compatibility.minimum` is a promise the
 * manifest makes to every user, and a promise is only defended if something
 * exercises it: a regression that breaks the floor while working on a newer
 * build passes a suite run above the floor in silence. Deriving the pin from
 * the claim means the evidence and the claim are the same number, and neither
 * can drift from the other.
 *
 * A floor that names no build (`"14"`) cannot pin one, so the run floats on the
 * major tag — visibly, rather than by pretending to a precision it lacks.
 *
 * @param {string} stage - The stage name.
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env] - Environment to read.
 * @param {Record<string, ContainerStage>} [opts.stages] - Declared stages.
 * @param {string|null} [opts.compatibilityMinimum] - The claimed floor.
 * @param {string} [opts.e2eStage] - Which stage the suite runs against.
 * @returns {string|null} The exact build, or `null`.
 */
export function resolveFoundryVersion(
    stage,
    {
        env = process.env,
        stages = {},
        compatibilityMinimum = null,
        e2eStage = "test",
    } = {},
) {
    const fromEnv = env[`FOUNDRYVTT_${stage.toUpperCase()}_VERSION`]?.trim();
    if (fromEnv) return fromEnv;
    const declared = stages[stage]?.version;
    if (declared) return declared;
    if (stage !== e2eStage) return null;
    return EXACT_BUILD.test(compatibilityMinimum ?? "") ?
            /** @type {string} */ (compatibilityMinimum)
        :   null;
}

/**
 * The image a run uses.
 *
 * `FOUNDRYVTT_CONTAINER_IMAGE` wins, then `packageBuild.container.image`, then
 * felddy's major tag for whichever version the package already implies — the
 * pinned build, or failing that the compatibility floor. Only a package that
 * claims neither floats.
 *
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env] - Environment to read.
 * @param {string|null} [opts.image] - The configured image.
 * @param {string|null} [opts.version] - The pinned build, if any.
 * @param {string|null} [opts.compatibilityMinimum] - The claimed floor.
 * @returns {string} The image reference.
 */
export function resolveImage({
    env = process.env,
    image = null,
    version = null,
    compatibilityMinimum = null,
} = {}) {
    const explicit = env.FOUNDRYVTT_CONTAINER_IMAGE?.trim();
    if (explicit) return explicit;
    if (image) return image;
    const major = (version ?? compatibilityMinimum ?? "").split(".")[0];
    return major ? `felddy/foundryvtt:${major}` : FLOATING_IMAGE;
}

/**
 * The world a stage auto-launches.
 *
 * `null` leaves `FOUNDRY_WORLD` alone, so whatever the image was given decides.
 * An empty string is a *declared* "never auto-launch" — the shape a stage whose
 * world is managed by hand needs, and distinct from saying nothing.
 *
 * @param {string} stage - The stage name.
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env] - Environment to read.
 * @param {Record<string, ContainerStage>} [opts.stages] - Declared stages.
 * @returns {string|null} The world id, `""`, or `null`.
 */
export function resolveWorld(stage, { env = process.env, stages = {} } = {}) {
    const fromEnv = env[`FOUNDRYVTT_${stage.toUpperCase()}_WORLD`];
    if (fromEnv !== undefined) return fromEnv.trim();
    const declared = stages[stage]?.world;
    return declared === undefined || declared === null ?
            null
        :   String(declared);
}

/**
 * A stage's dedicated Foundry licence key, if it has one.
 *
 * Foundry is single-seat, so running a `dev` and a `test` container at once
 * needs two keys. `FOUNDRYVTT_<STAGE>_LICENSE_KEY` dedicates one to a stage,
 * overriding any global `FOUNDRY_LICENSE_KEY` passed through.
 *
 * @param {string} stage - The stage name.
 * @param {NodeJS.ProcessEnv} [env] - Environment to read.
 * @returns {string|null} The key, or `null`.
 */
export function resolveLicenseKey(stage, env = process.env) {
    return env[`FOUNDRYVTT_${stage.toUpperCase()}_LICENSE_KEY`]?.trim() || null;
}

/**
 * The Foundry data root for a stage, checked for what a bind mount needs.
 *
 * @param {string} stage - The stage name.
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env] - Environment to read.
 * @returns {string} The local path.
 * @throws {Error} When it is unset, or names a remote host.
 */
export function resolveDataRoot(stage, { env = process.env } = {}) {
    const variable = dataEnvVar(stage);
    const dataRoot = env[variable]?.trim() ?? "";
    if (!dataRoot) {
        throw new Error(
            `No data directory configured for stage '${stage}'. Set ` +
                `${variable} — for example ${variable}="/path/to/foundryvtt/data".`,
        );
    }
    // A remote SFTP target (`[user@]host:/path`) is a perfectly good deploy
    // destination and an impossible bind mount.
    const colon = dataRoot.indexOf(":");
    const isWindowsPath = /^[A-Za-z]:[\\/]/.test(dataRoot);
    if (!dataRoot.startsWith("/") && !isWindowsPath && colon > 0) {
        throw new Error(
            `${variable} is a remote target ('${dataRoot}'). A container needs ` +
                `a local path to bind-mount.`,
        );
    }
    return dataRoot;
}

/**
 * The image's own environment variables, as key/value pairs.
 *
 * `CONTAINER_CACHE` is deliberately withheld: it names a path *inside* the
 * container, and {@link dockerRunArgs} sets it to match a mount it actually
 * makes. A host path from a `.env` file would otherwise reach the image naming
 * a directory that is not there.
 *
 * @param {NodeJS.ProcessEnv} [env] - Environment to read.
 * @returns {[string, string][]} The pairs to pass through.
 */
export function passthroughEnv(env = process.env) {
    const pairs = [];
    for (const [key, value] of Object.entries(env)) {
        if (value == null) continue;
        const passes =
            key.startsWith("FOUNDRY_") ||
            (key.startsWith("CONTAINER_") && key !== "CONTAINER_CACHE");
        if (passes) pairs.push([key, value]);
    }
    return pairs;
}

/**
 * The full `docker run` argument vector for a stage's container.
 *
 * Order matters at the end: docker takes the **last** `-e` for a repeated key,
 * so the per-stage version, world and licence are appended after the
 * passthrough and win over anything it carried.
 *
 * @param {object} opts
 * @param {string} opts.name - Container name.
 * @param {string} opts.image - Image reference.
 * @param {number} opts.port - Host port to publish.
 * @param {string} opts.dataRoot - Host directory to mount at `/data`.
 * @param {NodeJS.ProcessEnv} [opts.env] - Environment to pass through.
 * @param {string|null} [opts.cacheDir] - Host download cache to mount.
 * @param {string|null} [opts.version] - Exact build to pin.
 * @param {string|null} [opts.world] - World to auto-launch; `""` forces none.
 * @param {string|null} [opts.licenseKey] - Dedicated licence key.
 * @returns {string[]} Arguments after `docker`.
 */
export function dockerRunArgs({
    name,
    image,
    port,
    dataRoot,
    env = process.env,
    cacheDir = null,
    version = null,
    world = null,
    licenseKey = null,
}) {
    const args = [
        "run",
        "--detach",
        "--name",
        name,
        // Foundry binds a signed licence to the hostname. Without a stable one
        // docker assigns a fresh container id each run and the licence reverts
        // to "requires signature" on every recreate.
        "--hostname",
        name,
        "--publish",
        `${port}:${CONTAINER_PORT}`,
        "--volume",
        `${dataRoot}:/data`,
    ];
    if (cacheDir) {
        args.push(
            "--volume",
            `${cacheDir}:${CACHE_MOUNT}`,
            "-e",
            `CONTAINER_CACHE=${CACHE_MOUNT}`,
        );
    }
    for (const [key, value] of passthroughEnv(env)) {
        args.push("-e", `${key}=${value}`);
    }
    if (version) args.push("-e", `FOUNDRY_VERSION=${version}`);
    if (world !== null) args.push("-e", `FOUNDRY_WORLD=${world}`);
    if (licenseKey) args.push("-e", `FOUNDRY_LICENSE_KEY=${licenseKey}`);
    args.push(image);
    return args;
}

/**
 * Run the `docker` CLI, inheriting stdio.
 *
 * @param {string[]} args - Arguments after `docker`.
 * @returns {number} The exit status.
 * @throws {Error} When `docker` is not on `PATH`.
 */
export function runDocker(args) {
    const result = spawnSync("docker", args, { stdio: "inherit" });
    if (result.error) {
        if (
            /** @type {NodeJS.ErrnoException} */ (result.error).code ===
            "ENOENT"
        ) {
            throw new Error(
                "docker was not found on PATH. Install Docker and make sure " +
                    "the `docker` CLI is available.",
            );
        }
        throw result.error;
    }
    return result.status ?? 0;
}

/**
 * Run the `docker` CLI and capture its output, tolerating failure.
 *
 * @param {string[]} args - Arguments after `docker`.
 * @returns {string} Trimmed stdout, or `""` when the command failed.
 */
export function captureDocker(args) {
    const result = spawnSync("docker", args, { encoding: "utf8" });
    if (result.error || result.status !== 0) return "";
    return (result.stdout ?? "").trim();
}

/**
 * @param {string} name - Container name.
 * @param {boolean} [runningOnly] - Only count a running container.
 * @returns {boolean} Whether a container with exactly this name is present.
 */
export function containerExists(name, runningOnly = false) {
    const args = ["ps"];
    if (!runningOnly) args.push("-a");
    args.push("--filter", `name=^${name}$`, "--format", "{{.Names}}");
    return captureDocker(args).split("\n").includes(name);
}

/**
 * The HeroicLands-convention Foundry containers currently running.
 *
 * Used to warn about a single-seat licence clash before a run starts, which is
 * why the filter is the shared `-foundry-` convention rather than one package's
 * prefix: the clash is between *any* two licensed instances, not between two
 * containers of the same package.
 *
 * @param {string} [except] - A container to omit from the list.
 * @returns {string[]} The container names.
 */
export function runningFoundryContainers(except = "") {
    return captureDocker([
        "ps",
        "--filter",
        "name=-foundry-",
        "--format",
        "{{.Names}}",
    ])
        .split("\n")
        .filter((name) => name && name !== except);
}

/**
 * Remove the data-root lock a container left behind when it did not shut down
 * cleanly (`docker rm -f`, a crash, an OOM).
 *
 * Foundry then refuses to start with "already locked by another process",
 * naming no owner — so a stale lock turns every later boot into a failure that
 * reads like corruption rather than litter.
 *
 * **Only safe while the container is stopped**, which is exactly when every
 * boot path here calls it: with nothing running against the data root, a lock
 * present is by definition stale.
 *
 * @param {string} dataRoot - The Foundry user-data root.
 * @param {(message: string) => void} [log] - Progress reporting.
 */
export function clearStaleLock(dataRoot, log = () => {}) {
    const lock = path.join(dataRoot, "Config", "options.json.lock");
    if (!fs.existsSync(lock)) return;
    fs.rmSync(lock, { recursive: true, force: true });
    log(`Cleared stale Foundry lock: ${lock}`);
}

/**
 * Everything a container action needs, resolved from configuration and the
 * environment once.
 *
 * @typedef {object} ResolvedContainer
 * @property {string} stage
 * @property {string} name
 * @property {number} port
 * @property {string} image
 * @property {string} url
 * @property {string|null} version
 * @property {string|null} world
 * @property {string|null} licenseKey
 * @property {string|null} cacheDir
 */

/**
 * Resolve a stage's container settings.
 *
 * @param {object} opts
 * @param {string} opts.stage - The stage name.
 * @param {object} opts.config - The resolved package-build configuration.
 * @param {NodeJS.ProcessEnv} [opts.env] - Environment to read.
 * @returns {ResolvedContainer} The resolved settings.
 */
export function resolveContainer({ stage, config, env = process.env }) {
    const stages = config.containerStages;
    const version = resolveFoundryVersion(stage, {
        env,
        stages,
        compatibilityMinimum: config.compatibilityMinimum,
        e2eStage: config.e2eStage,
    });
    const port = resolveStagePort(stage, { env, stages });
    return {
        stage,
        name: containerName(config.packageId, stage),
        port,
        image: resolveImage({
            env,
            image: config.containerImage,
            version,
            compatibilityMinimum: config.compatibilityMinimum,
        }),
        url: `http://localhost:${port}`,
        version,
        world: resolveWorld(stage, { env, stages }),
        licenseKey: resolveLicenseKey(stage, env),
        cacheDir: env.FOUNDRYVTT_CACHE?.trim() || null,
    };
}

/**
 * Start a stage's container, creating it when it does not exist yet.
 *
 * @param {ResolvedContainer} container - Resolved settings.
 * @param {object} opts
 * @param {string} opts.dataRoot - Host directory to mount at `/data`.
 * @param {NodeJS.ProcessEnv} [opts.env] - Environment to pass through.
 * @param {(message: string) => void} [opts.log] - Progress reporting.
 * @returns {number} The exit status.
 */
export function startContainer(
    container,
    { dataRoot, env = process.env, log = () => {} },
) {
    if (containerExists(container.name)) {
        // Nothing is running against this data root — we are about to start it
        // — so any lock present was left by a previous crash.
        if (!containerExists(container.name, true))
            clearStaleLock(dataRoot, log);
        log(
            `Starting existing container '${container.name}' → ${container.url}`,
        );
        return runDocker(["start", container.name]);
    }

    clearStaleLock(dataRoot, log);
    if (container.cacheDir && !fs.existsSync(container.cacheDir)) {
        throw new Error(
            `FOUNDRYVTT_CACHE directory does not exist: ${container.cacheDir}.`,
        );
    }
    log(
        `Creating container '${container.name}' from ${container.image}\n` +
            `  data: ${dataRoot}\n  url:  ${container.url}`,
    );
    const status = runDocker(
        dockerRunArgs({
            name: container.name,
            image: container.image,
            port: container.port,
            dataRoot,
            env,
            cacheDir: container.cacheDir,
            version: container.version,
            world: container.world,
            licenseKey: container.licenseKey,
        }),
    );
    if (status === 0) {
        log(
            `Started. Open ${container.url} (a first run installs Foundry — ` +
                `see \`container logs\`).`,
        );
    }
    return status;
}

/**
 * Stop and remove a container, tolerating "not running" and "no such
 * container".
 *
 * @param {string} name - Container name.
 * @param {(message: string) => void} [log] - Progress reporting.
 */
export function removeContainer(name, log = () => {}) {
    if (!containerExists(name)) {
        log(`No container '${name}' to remove.`);
        return;
    }
    runDocker(["stop", name]);
    runDocker(["rm", name]);
}

/**
 * Perform one container action for a stage.
 *
 * @param {object} opts
 * @param {string} opts.action - One of {@link CONTAINER_ACTIONS}.
 * @param {string} opts.stage - The stage name.
 * @param {object} opts.config - The resolved package-build configuration.
 * @param {NodeJS.ProcessEnv} [opts.env] - Environment to read.
 * @param {(message: string) => void} [opts.log] - Progress reporting.
 * @returns {number} The exit status.
 * @throws {Error} On an unknown action, or a stage with no usable data root.
 */
export function containerAction({
    action,
    stage,
    config,
    env = process.env,
    log = () => {},
}) {
    if (!CONTAINER_ACTIONS.includes(action)) {
        throw new Error(
            `Invalid container action '${action}'. Valid actions are: ` +
                `${CONTAINER_ACTIONS.join(", ")}.`,
        );
    }
    const container = resolveContainer({ stage, config, env });

    switch (action) {
        case "start": {
            const dataRoot = requireDataRoot(stage, env);
            return startContainer(container, { dataRoot, env, log });
        }
        case "stop":
            return runDocker(["stop", container.name]);
        case "restart": {
            // Not `docker restart`: that leaves no window in which to sweep the
            // lock, so a container that died holding one could never be
            // restarted back into a working state.
            const dataRoot = requireDataRoot(stage, env);
            runDocker(["stop", container.name]);
            clearStaleLock(dataRoot, log);
            return runDocker(["start", container.name]);
        }
        case "recreate": {
            // The image's environment is fixed at `docker run` time, so this is
            // what applies a changed FOUNDRY_WORLD, licence or cache.
            removeContainer(container.name, log);
            const dataRoot = requireDataRoot(stage, env);
            clearStaleLock(dataRoot, log);
            return startContainer(container, { dataRoot, env, log });
        }
        case "rm":
            removeContainer(container.name, log);
            return 0;
        case "status":
            return runDocker([
                "ps",
                "-a",
                "--filter",
                `name=^${container.name}$`,
            ]);
        case "logs":
            return runDocker(["logs", "-f", container.name]);
        default:
            return runDocker(["pull", container.image]);
    }
}

/**
 * The stage's data root, checked for existence as well as shape.
 *
 * @param {string} stage - The stage name.
 * @param {NodeJS.ProcessEnv} env - Environment to read.
 * @returns {string} The local path.
 * @throws {Error} When it is unset, remote, or absent from disk.
 */
function requireDataRoot(stage, env) {
    const dataRoot = resolveDataRoot(stage, { env });
    if (!fs.existsSync(dataRoot)) {
        throw new Error(
            `Data directory does not exist: ${dataRoot} (from ` +
                `${dataEnvVar(stage)}).`,
        );
    }
    return dataRoot;
}
