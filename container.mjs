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
 * Stable, so Foundry's signed licence — which is bound to the container
 * hostname — survives a recreate. Named after the package by default, so two
 * HeroicLands packages run their own containers side by side.
 *
 * A declared `base` replaces the package-scoped half, which is what lets
 * several packages share one container and so one signed licence: a signature
 * is issued for a hostname, not for a package, and a package that cannot name
 * the host cannot be pointed at a signature that already exists.
 *
 * The stage stays in the name either way. Two stages are two containers over
 * two data roots, and docker names are unique: were a declared name used
 * whole, `container dev` would find the `test` container already there, start
 * it, and serve the test data root on the dev port.
 *
 * @param {string} packageId - The Foundry package id.
 * @param {string} stage - The stage name.
 * @param {string|null} [base] - Declared name, shareable between packages.
 * @returns {string} The container name.
 */
export function containerName(packageId, stage, base = null) {
    return `${base ?? `${packageId}-foundry`}-${stage}`;
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
export function resolveStagePort(stage, { env = process.env, stages = {} } = {}) {
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
    { env = process.env, stages = {}, compatibilityMinimum = null, e2eStage = "test" } = {},
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
 * `FOUNDRYVTT_CONTAINER_IMAGE` wins, then `packageBuild.container.image`. A
 * pinned exact build takes felddy's tag for that build: each image installs its
 * own build by default and warns that a different `FOUNDRY_VERSION` "may not
 * function properly". Otherwise felddy's major tag for whichever version the
 * package implies — the pin, or failing that the compatibility floor. Only a
 * package that claims neither floats.
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
    if (EXACT_BUILD.test(version ?? "")) return `felddy/foundryvtt:${version}`;
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
    return declared === undefined || declared === null ? null : String(declared);
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

/** The account variables the image signs in to foundryvtt.com with. */
const ACCOUNT_VARIABLES = Object.freeze(["FOUNDRY_USERNAME", "FOUNDRY_PASSWORD"]);

/** The shortest value the image reads as a licence key rather than an index. */
const LICENSE_KEY_MIN_LENGTH = 24;

/**
 * Whether the image has to sign in to foundryvtt.com to start.
 *
 * Given `FOUNDRY_USERNAME` and `FOUNDRY_PASSWORD`, the image signs in and asks
 * for a download URL on every container it creates, even when the release is
 * already in its cache. Each of those is a request foundryvtt.com rate-limits,
 * and one refused with HTTP 429 stops the container before Foundry starts. The
 * account serves two purposes only: downloading a release that is not cached,
 * and fetching a licence key for an unlicensed data root. When neither applies
 * the account is withheld, and the release installs from the cache with no
 * network request.
 *
 * The image caches `foundryvtt-<version>.zip` in the mounted cache, or in
 * `container_cache` beneath the data root when no cache is mounted.
 *
 * @param {object} opts
 * @param {string|null} [opts.cacheDir] - The host cache mounted into the container.
 * @param {string} opts.dataRoot - The host data root mounted at `/data`.
 * @param {string|null} [opts.version] - The pinned build; with none, the
 *   archive's name is unknown.
 * @param {string|null} [opts.licenseKey] - The licence key the image is given.
 * @param {(file: string) => boolean} [opts.fileExists] - Replaceable for tests.
 * @returns {boolean} Whether to pass the account through.
 */
export function needsFoundryAccount({
    cacheDir = null,
    dataRoot,
    version = null,
    licenseKey = null,
    fileExists = (file) => fs.existsSync(file),
}) {
    if (!version) return true;
    const cache = cacheDir ?? path.join(dataRoot, "container_cache");
    if (!fileExists(path.join(cache, `foundryvtt-${version}.zip`))) return true;
    const licensed =
        (licenseKey?.length ?? 0) >= LICENSE_KEY_MIN_LENGTH ||
        fileExists(path.join(dataRoot, "Config", "license.json"));
    return !licensed;
}

/** The S3 image: MinIO images cannot be pulled everywhere, SeaweedFS can. */
export const S3_IMAGE = "chrislusf/seaweedfs:3.80";

/** The name the S3 server answers to on the shared network, and in `awsConfig`. */
export const S3_ALIAS = "s3.localhost";

/** The port the S3 server listens on and publishes. */
export const S3_PORT = 8333;

/** The bucket the S3 server is created with. */
export const S3_BUCKET = "sohl-e2e";

/** The consumer's S3 identities, relative to the repository root. */
export const S3_IDENTITIES_FILE = "cypress/s3/s3-identities.json";

/** The consumer's Foundry `awsConfig`, relative to the repository root. */
export const S3_AWS_CONFIG_FILE = "cypress/s3/aws-e2e.json";

/**
 * Whether the S3 server is asked for: `FOUNDRYVTT_CONTAINER_S3` set to `1` or
 * `true`. Anything else, including unset, leaves the container as it is.
 *
 * @param {NodeJS.ProcessEnv} [env] - Environment to read.
 * @returns {boolean} Whether to run the S3 server.
 */
export function s3Requested(env = process.env) {
    return ["1", "true"].includes(env.FOUNDRYVTT_CONTAINER_S3?.trim().toLowerCase() ?? "");
}

/**
 * Everything the S3 opt-in does, as data.
 *
 * @typedef {object} S3Plan
 * @property {string} network - The user-defined network the Foundry container
 *   and the S3 server share.
 * @property {string} server - The S3 server's container name.
 * @property {string} identities - Absolute path of the identities file.
 * @property {string} awsConfig - Absolute path of the Foundry `awsConfig`.
 * @property {string} awsConfigName - The file's name under the data root's
 *   `Config/`, and the value of `FOUNDRY_AWS_CONFIG`.
 */

/**
 * The S3 plan for a container, or `null` when the opt-in is off.
 *
 * @param {object} opts
 * @param {string} opts.name - The Foundry container's name.
 * @param {string} opts.rootDir - The consumer repository root, which holds the
 *   identities and the `awsConfig`.
 * @param {NodeJS.ProcessEnv} [opts.env] - Environment to read.
 * @returns {S3Plan|null} The plan.
 */
export function resolveS3({ name, rootDir, env = process.env }) {
    if (!s3Requested(env)) return null;
    return {
        network: `${name}-net`,
        server: `${name}-s3`,
        identities: path.resolve(rootDir, S3_IDENTITIES_FILE),
        awsConfig: path.resolve(rootDir, S3_AWS_CONFIG_FILE),
        awsConfigName: path.basename(S3_AWS_CONFIG_FILE),
    };
}

/**
 * The `docker run` argument vector for the S3 server.
 *
 * @param {S3Plan} plan - The S3 plan.
 * @returns {string[]} Arguments after `docker`.
 */
export function s3RunArgs(plan) {
    return [
        "run",
        "--detach",
        "--name",
        plan.server,
        "--network",
        plan.network,
        "--network-alias",
        S3_ALIAS,
        "--publish",
        `${S3_PORT}:${S3_PORT}`,
        "--volume",
        `${plan.identities}:/etc/seaweedfs/s3.json:ro`,
        S3_IMAGE,
        "server",
        "-dir=/data",
        "-s3",
        `-s3.port=${S3_PORT}`,
        "-s3.config=/etc/seaweedfs/s3.json",
        "-s3.allowedOrigins=*",
    ];
}

/**
 * The `docker exec` argument vector that runs one `weed shell` command in the
 * S3 server.
 *
 * @param {S3Plan} plan - The S3 plan.
 * @param {string} command - The shell command, such as `s3.bucket.list`.
 * @returns {string[]} Arguments after `docker`.
 */
export function s3ShellArgs(plan, command) {
    return [
        "exec",
        plan.server,
        "sh",
        "-c",
        `echo "${command}" | weed shell -master=localhost:9333`,
    ];
}

/**
 * Start or reuse the S3 server on its network, wait for readiness, ensure the
 * bucket exists, and copy the `awsConfig` into the data root.
 *
 * @param {object} opts
 * @param {S3Plan} opts.plan - The S3 plan.
 * @param {string} opts.dataRoot - The Foundry user-data root.
 * @param {(message: string) => void} [opts.log] - Progress reporting.
 * @param {(args: string[]) => number} [opts.run] - Runs docker, returning the
 *   exit status.
 * @param {(args: string[]) => string} [opts.capture] - Runs docker, returning
 *   its stdout, or `""` on failure.
 * @param {(ms: number) => void} [opts.sleep] - Waits.
 * @param {number} [opts.attempts] - How often to ask the server whether it is
 *   ready.
 * @throws {Error} When an input file is missing or the server never answers.
 */
export function ensureS3({
    plan,
    dataRoot,
    log = () => {},
    run = runDocker,
    capture = captureDocker,
    sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
    attempts = 60,
}) {
    for (const file of [plan.identities, plan.awsConfig]) {
        if (!fs.existsSync(file)) {
            throw new Error(`FOUNDRYVTT_CONTAINER_S3 needs ${file}, which does not exist.`);
        }
    }
    const configDir = path.join(dataRoot, "Config");
    fs.mkdirSync(configDir, { recursive: true });
    fs.copyFileSync(plan.awsConfig, path.join(configDir, plan.awsConfigName));

    if (
        !capture(["network", "ls", "--filter", `name=^${plan.network}$`, "--format", "{{.Name}}"])
    ) {
        run(["network", "create", plan.network]);
    }
    const present = capture([
        "ps",
        "-a",
        "--filter",
        `name=^${plan.server}$`,
        "--format",
        "{{.Names}}",
    ]);
    if (present.split("\n").includes(plan.server)) {
        const running = capture([
            "ps",
            "--filter",
            `name=^${plan.server}$`,
            "--format",
            "{{.Names}}",
        ]);
        if (!running.split("\n").includes(plan.server)) run(["start", plan.server]);
    } else {
        log(`Starting S3 server '${plan.server}' (${S3_IMAGE}) as ${S3_ALIAS}:${S3_PORT}`);
        const status = run(s3RunArgs(plan));
        if (status !== 0) throw new Error(`Starting the S3 server failed with status ${status}.`);
    }
    // `weed shell` exits 0 whether or not the filer is up; it names the filers
    // it found once there is one.
    for (let attempt = 0; ; attempt++) {
        if (capture(s3ShellArgs(plan, "s3.bucket.list")).includes("filers: [")) break;
        if (attempt >= attempts) {
            throw new Error(`The S3 server '${plan.server}' did not become ready.`);
        }
        sleep(1000);
    }
    run(s3ShellArgs(plan, `s3.bucket.create -name ${S3_BUCKET}`));
}

/**
 * Remove the S3 server and its network, tolerating either being absent.
 *
 * @param {S3Plan} plan - The S3 plan.
 * @param {(args: string[]) => number} [run] - Runs docker.
 * @param {(args: string[]) => string} [capture] - Runs docker for its stdout.
 */
export function removeS3(plan, run = runDocker, capture = captureDocker) {
    const present = capture([
        "ps",
        "-a",
        "--filter",
        `name=^${plan.server}$`,
        "--format",
        "{{.Names}}",
    ]);
    if (present.split("\n").includes(plan.server)) {
        run(["stop", plan.server]);
        run(["rm", plan.server]);
    }
    if (capture(["network", "ls", "--filter", `name=^${plan.network}$`, "--format", "{{.Name}}"])) {
        run(["network", "rm", plan.network]);
    }
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
 * @param {boolean} [opts.account] - Whether to pass `FOUNDRY_USERNAME` and
 *   `FOUNDRY_PASSWORD` through; see {@link needsFoundryAccount}.
 * @param {string|null} [opts.network] - A user-defined network to attach the
 *   container to as it is created, so it can reach the S3 server before Foundry
 *   starts.
 * @param {string|null} [opts.awsConfig] - Name of the `awsConfig` file under the
 *   data root's `Config/`, passed as `FOUNDRY_AWS_CONFIG`.
 * @param {string|null} [opts.user] - `--user` value to run the container as.
 *   `felddy/foundryvtt` runs Foundry as user 1000 and ignores `FOUNDRY_UID` and
 *   `FOUNDRY_GID`; under rootless Docker, container root is the host user, so
 *   `0:0` makes every file under the data root theirs. Blank or `null` leaves
 *   the image's own user.
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
    account = true,
    network = null,
    awsConfig = null,
    user = null,
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
        args.push("--volume", `${cacheDir}:${CACHE_MOUNT}`, "-e", `CONTAINER_CACHE=${CACHE_MOUNT}`);
    }
    for (const [key, value] of passthroughEnv(env)) {
        if (!account && ACCOUNT_VARIABLES.includes(key)) continue;
        args.push("-e", `${key}=${value}`);
    }
    if (version) args.push("-e", `FOUNDRY_VERSION=${version}`);
    if (world !== null) args.push("-e", `FOUNDRY_WORLD=${world}`);
    if (licenseKey) args.push("-e", `FOUNDRY_LICENSE_KEY=${licenseKey}`);
    if (network) args.push("--network", network);
    if (awsConfig) args.push("-e", `FOUNDRY_AWS_CONFIG=${awsConfig}`);
    if (user?.trim()) args.push("--user", user.trim());
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
        if (/** @type {NodeJS.ErrnoException} */ (result.error).code === "ENOENT") {
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
 * The `docker run` argument vector for a short-lived container that runs a
 * shell script against a stage's data root.
 *
 * It uses the stage's own image and mounts the data root at `/data`, so the
 * script sees files exactly as the Foundry container does. Under rootless
 * Docker, only the container's user namespace can unlink what the container's
 * user wrote, and only it can hand files to that user.
 *
 * @param {object} opts
 * @param {string} opts.image - Image reference.
 * @param {string} opts.dataRoot - Host directory to mount at `/data`.
 * @param {string} opts.script - A `sh` script; `$1`, `$2` … are `args`.
 * @param {string[]} [opts.args] - Positional arguments for the script.
 * @param {string|null} [opts.user] - `--user` value; `null` runs as the image's
 *   own user.
 * @returns {string[]} Arguments after `docker`.
 */
export function dataRootScriptArgs({ image, dataRoot, script, args = [], user = null }) {
    const argv = [
        "run",
        "--rm",
        "--volume",
        `${path.resolve(dataRoot)}:/data`,
        "--entrypoint",
        "sh",
    ];
    if (user?.trim()) argv.push("--user", user.trim());
    argv.push(image, "-c", script, "sh", ...args);
    return argv;
}

/**
 * Run a shell script against a stage's data root in a throwaway container.
 *
 * @param {object} opts - As for {@link dataRootScriptArgs}.
 * @returns {string} The script's standard output.
 * @throws {Error} When `docker` is missing or the script exits non-zero.
 */
export function runDataRootScript(opts) {
    const result = spawnSync("docker", dataRootScriptArgs(opts), { encoding: "utf8" });
    if (result.error?.code === "ENOENT") {
        throw new Error(
            "docker was not found on PATH. Install Docker and make sure the `docker` CLI is available.",
        );
    }
    if (result.status !== 0) {
        throw new Error(
            `A helper container failed (exit ${result.status}): ` +
                `${(result.stderr || result.stdout || "").trim()}`,
        );
    }
    return result.stdout ?? "";
}

/**
 * A tree's path beneath the data root, as the helper container sees it there.
 *
 * @param {string} dataRoot - Host directory mounted at `/data`.
 * @param {string} tree - A host path beneath it.
 * @returns {string} The `/`-separated path relative to the data root.
 * @throws {Error} When the tree is the data root or lies outside it.
 */
function beneathDataRoot(dataRoot, tree) {
    const relative = path.relative(path.resolve(dataRoot), path.resolve(tree));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`${tree} is not beneath the data root ${dataRoot}.`);
    }
    return relative.split(path.sep).join("/");
}

/**
 * A remover for trees under a stage's data root that the container's user
 * owns, run as root in a throwaway container on that data root — the same
 * mechanism that hands an end-to-end install to the container's user.
 *
 * @param {object} opts
 * @param {ResolvedContainer} opts.container - The stage's container.
 * @param {(opts: object) => string} [opts.runScript] - Throwaway-container runner.
 * @returns {(tree: string, where: {dataRoot: string}) => void} Removes one tree.
 */
export function containerTreeRemover({ container, runScript = runDataRootScript }) {
    return (tree, { dataRoot }) => {
        const relative = beneathDataRoot(dataRoot, tree);
        runScript({
            image: container.image,
            dataRoot,
            user: "0:0",
            script: 'rm -rf "/data/$1"',
            args: [relative],
        });
    };
}

/**
 * The command {@link containerTreeRemover} runs, written out for a person to
 * paste when the deploy could not run it.
 *
 * @param {object} opts
 * @param {string} opts.image - Image reference.
 * @param {string} opts.dataRoot - Host directory mounted at `/data`.
 * @param {string} opts.tree - The tree to remove, beneath the data root.
 * @returns {string} A `docker run` command line.
 */
export function containerRemovalCommand({ image, dataRoot, tree }) {
    const relative = beneathDataRoot(dataRoot, tree);
    return (
        `docker run --rm --user 0:0 --volume ${path.resolve(dataRoot)}:/data ` +
        `--entrypoint rm ${image} -rf /data/${relative}`
    );
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
    return captureDocker(["ps", "--filter", "name=-foundry-", "--format", "{{.Names}}"])
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
 * @property {string|null} user - From `FOUNDRYVTT_CONTAINER_USER`.
 * @property {S3Plan|null} s3 - Set by `FOUNDRYVTT_CONTAINER_S3`.
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
    const name = containerName(config.packageId, stage, config.containerName);
    return {
        stage,
        name,
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
        user: env.FOUNDRYVTT_CONTAINER_USER?.trim() || null,
        s3: resolveS3({ name, rootDir: config.rootDir, env }),
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
export function startContainer(container, { dataRoot, env = process.env, log = () => {} }) {
    // Before Foundry starts, so its S3 client finds the server on the first try.
    if (container.s3) ensureS3({ plan: container.s3, dataRoot, log });
    if (containerExists(container.name)) {
        // Nothing is running against this data root — we are about to start it
        // — so any lock present was left by a previous crash.
        if (!containerExists(container.name, true)) clearStaleLock(dataRoot, log);
        if (container.s3) {
            // Fails harmlessly when the container is already on the network.
            captureDocker(["network", "connect", container.s3.network, container.name]);
        }
        log(`Starting existing container '${container.name}' → ${container.url}`);
        return runDocker(["start", container.name]);
    }

    clearStaleLock(dataRoot, log);
    if (container.cacheDir && !fs.existsSync(container.cacheDir)) {
        throw new Error(`FOUNDRYVTT_CACHE directory does not exist: ${container.cacheDir}.`);
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
            account: needsFoundryAccount({
                cacheDir: container.cacheDir,
                dataRoot,
                version: container.version,
                licenseKey: container.licenseKey ?? env.FOUNDRY_LICENSE_KEY?.trim() ?? null,
            }),
            network: container.s3?.network ?? null,
            awsConfig: container.s3?.awsConfigName ?? null,
            user: container.user,
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
export function containerAction({ action, stage, config, env = process.env, log = () => {} }) {
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
            if (container.s3) removeS3(container.s3);
            return 0;
        case "status":
            return runDocker(["ps", "-a", "--filter", `name=^${container.name}$`]);
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
            `Data directory does not exist: ${dataRoot} (from ` + `${dataEnvVar(stage)}).`,
        );
    }
    return dataRoot;
}
