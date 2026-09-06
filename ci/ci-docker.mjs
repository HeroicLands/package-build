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
 * Run the Build & Test steps in a container, from a **clean export of HEAD**.
 *
 * The pre-push hook runs the same steps on this machine, which catches nearly
 * everything. Two things it structurally cannot catch, and this does:
 *
 * 1. **A dirty environment.** The hook runs against your working tree with its
 *    `node_modules`, its `build/`, its `.env.local` and whatever a previous run
 *    left behind. GitHub starts from a checkout of the commit and nothing else.
 *    So this exports `HEAD` with `git archive` — committed content only, no
 *    ignored files, no stale artifacts — and runs there.
 * 2. **macOS is case-insensitive; the runner is not.** An import whose case does
 *    not match its file resolves here and fails on Linux, and no amount of
 *    running the right commands locally will show it.
 *
 * **It runs `linux/amd64`, matching the runner, and that costs nothing.** The
 * expected objection is that this machine is arm64 and emulation is slow. It is
 * not, because Docker Desktop translates `linux/amd64` with **Rosetta** rather
 * than QEMU. Measured here, three runs each:
 *
 * | | arm64 native | amd64 |
 * | --- | --- | --- |
 * | JS compute | 1104 / 1071 / 1078 ms | 1098 / 1062 / 1093 ms |
 * | `npm ci`, 1,134 packages | 23s | 23s |
 *
 * Indistinguishable — so matching the runner is free, and the architecture gap
 * this otherwise carried is simply closed.
 *
 * ⚠️ **That speed is a setting, not a property of the machine.** It depends on
 * Docker Desktop's `UseVirtualizationFrameworkRosetta`; with it off the
 * translation falls back to QEMU and the picture reverses sharply. `--native`
 * runs on the host architecture if that ever becomes the better trade — it is
 * the faster-but-less-faithful option, which is why it is the one you ask for.
 *
 * @module
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** This package's `ci/` directory, mounted into the container. */
const CI_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * The repository under test — the git work tree the hook fired in, never this
 * package's own.
 *
 * Asked of git rather than assumed from the working directory, so the command
 * behaves the same run from a subdirectory as from the root.
 */
const ROOT = (() => {
    const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
    return (top.stdout ?? "").trim() || process.cwd();
})();

/** The image. Node's own, matching the `node-version` the workflow sets up. */
const DEFAULT_IMAGE = "node:24-bookworm";

/**
 * Exit status meaning *the check could not run*, as distinct from *it failed*.
 *
 * The caller has to tell those apart: one is a reason to refuse a push, the
 * other is a reason to say so and let it through.
 */
export const UNAVAILABLE = 2;

/**
 * Run a command, inheriting stdio, and return whether it succeeded.
 *
 * @param {string} command - The executable.
 * @param {string[]} args - Its arguments.
 * @param {object} [opts] - Passed to `spawnSync`.
 * @returns {number} The exit status.
 */
function run(command, args, opts = {}) {
    const result = spawnSync(command, args, { stdio: "inherit", ...opts });
    return result.status ?? 1;
}

/**
 * Export `HEAD` to a temporary directory — committed content, nothing else.
 *
 * @returns {string} The directory.
 * @throws {Error} When the export fails.
 */
function exportHead() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sohl-ci-"));
    const archive = spawnSync("git", ["archive", "--format=tar", "HEAD"], {
        cwd: ROOT,
        maxBuffer: 1024 * 1024 * 512,
    });
    if (archive.status !== 0) {
        throw new Error(`git archive HEAD failed: ${String(archive.stderr)}`);
    }
    const untar = spawnSync("tar", ["-x", "-C", dir], { input: archive.stdout });
    if (untar.status !== 0) throw new Error("could not unpack the export");
    return dir;
}

function main() {
    const argv = process.argv.slice(2);
    // Matching the runner is the default; `--native` opts out. See the module
    // note for why the usual speed objection does not apply here.
    const native = argv.includes("--native");
    const image =
        argv.find((a) => a.startsWith("--image="))?.slice("--image=".length) ?? DEFAULT_IMAGE;

    // Docker absent, or installed but not running. **Not a failure**: this
    // check is a convenience that saves a round trip, and the thing that
    // actually enforces the workflow is the workflow. A contributor without
    // Docker must still be able to push — blocking them would turn a courtesy
    // into a barrier, for exactly the people who are not its audience.
    //
    // `UNAVAILABLE` rather than success, so the hook can say so loudly instead
    // of passing in silence; a skipped check that looks like a green one is how
    // a guard stops being trusted.
    if (run("docker", ["info"], { stdio: "ignore" }) !== 0) {
        console.error(
            "ci-docker: Docker is not available, so the workflow was NOT checked here.\n" +
                "  This is not a failure — GitHub will run it. Install or start Docker\n" +
                "  to catch these before pushing.",
        );
        return UNAVAILABLE;
    }

    // Uncommitted work is invisible to this run *and* to GitHub, which is the
    // point — but say so, because a green run over a stale HEAD proves nothing
    // about what is on your disk.
    const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
    if (dirty.stdout?.trim()) {
        console.log(
            "ci-docker: NOTE — your working tree has uncommitted changes.\n" +
                "  This runs HEAD, exactly as GitHub would; those changes are not tested.",
        );
    }

    let dir;
    try {
        dir = exportHead();
    } catch (err) {
        console.error(`ci-docker: ${err.message}`);
        return 1;
    }

    const head = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
        cwd: ROOT,
        encoding: "utf8",
    });
    console.log(
        `ci-docker: running the workflow's steps in ${image} over a clean export of ` +
            `${head.stdout?.trim() ?? "HEAD"} ` +
            `(${native ? "linux/arm64, this machine's own" : "linux/amd64, as the runner"}).`,
    );

    const status = run("docker", [
        "run",
        "--rm",
        ...(native ? [] : ["--platform", "linux/amd64"]),
        "-v",
        `${dir}:/work`,
        // The step runner comes from this package, not from the export: the
        // repository under test does not carry it, and should not have to.
        "-v",
        `${CI_DIR}:/ci:ro`,
        "-w",
        "/work",
        image,
        "node",
        "/ci/ci-steps.mjs",
    ]);

    fs.rmSync(dir, { recursive: true, force: true });
    // The runner says 2 when the repository has nothing for it to check; that
    // travels back out unchanged so the hook can let the push through.
    if (status === UNAVAILABLE) {
        console.error("\nci-docker: nothing to check in this repository.");
        return UNAVAILABLE;
    }
    if (status !== 0) {
        console.error("\nci-docker: FAILED — GitHub would report the same.");
        return status;
    }
    console.log("\nci-docker: clean, from a fresh checkout on Linux.");
    return 0;
}

// Compared as *real* paths: a consumer reaches this through
// `node_modules/@heroiclands/package-build`, which npm may make a symlink, and
// `import.meta.url` is symlink-resolved while `process.argv[1]` is not. Comparing
// them raw makes the module exit 0 having done nothing — silently, which is the
// worst way for a check to fail.
const invokedDirectly = (() => {
    try {
        return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
})();
if (invokedDirectly) process.exit(main());
