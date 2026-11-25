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
 * Build the Info manuals the package ships.
 *
 *     node scripts/build-info.mjs [--root <dir>] [--help]
 *
 * Runs `scripts/docs-texinfo.mjs` to write the Texinfo manuals into
 * `build/docs/` beneath the repository root (or the one `--root` names), runs
 * `makeinfo` on each manual into `info/`, and lists each in `info/dir` with
 * `install-info`. `makeinfo` and `install-info` must be Texinfo 7.0 or later;
 * a missing or older tool, a nonzero exit and any warning `makeinfo` prints
 * are errors, printed to stderr as `file:line:column: error: message`, and the
 * script exits with status 1. `--help` prints the usage and exits with
 * status 0.
 *
 * `prepack` runs this script, so the published package carries
 * `info/package-build.info` and `info/dir`.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { resolvePackageBuildConfig } from "../config.mjs";
import { locateConfigError, readPackConfig } from "../engine/pack-config.mjs";

const OWN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MINIMUM_MAJOR = 7;

const USAGE = "usage: node scripts/build-info.mjs [--root <dir>] [--help]";

const HELP = `${USAGE}

Build the Info manuals that packageBuild.texinfo declares: write the Texinfo
source to build/docs, run makeinfo on each manual into info/, and list the
manuals in info/dir with install-info.

Options:
  --root <dir>  Build the repository at <dir> rather than this one.
  --help        Print this help and exit.

makeinfo and install-info must be Texinfo ${MINIMUM_MAJOR}.0 or later. Any warning makeinfo
prints is an error.

Exit status:
  0  every manual built with no warning, or --help
  1  an error, or an unknown option`;

const SCRIPT_REL = path.relative(process.cwd(), fileURLToPath(import.meta.url));

/**
 * Print a diagnostic and exit with status 1. A failure with no source position
 * of its own is located at the first line of this script, because the problem
 * is the environment this script ran in, not a line of a source file.
 *
 * @param {string} message - What failed.
 * @param {string} [file] - The file the failure is about, relative to the working directory.
 * @returns {never}
 */
function fail(message, file = `${SCRIPT_REL}:1:1`) {
    console.error(`${file}: error: ${message}`);
    process.exit(1);
}

/**
 * Require `tool` on `PATH` at Texinfo 7.0 or later.
 *
 * @param {string} tool - `makeinfo` or `install-info`.
 */
function requireTool(tool) {
    const run = spawnSync(tool, ["--version"], { encoding: "utf8" });
    if (run.error || run.status !== 0)
        fail(
            `${tool} is not installed; install Texinfo ${MINIMUM_MAJOR}.0 or later so the Info manual can be built`,
        );
    const first = run.stdout.split("\n")[0] ?? "";
    const match = /\(GNU texinfo\)\s+(\d+)\.(\d+)/.exec(first);
    if (!match) fail(`${tool} reports "${first}", which is not a GNU Texinfo version`);
    if (Number(match[1]) < MINIMUM_MAJOR)
        fail(
            `${tool} ${match[1]}.${match[2]} is too old; Texinfo ${MINIMUM_MAJOR}.0 or later is required`,
        );
}

/**
 * Run a tool and fail on a nonzero exit or any output on stderr.
 *
 * @param {string} tool - The program.
 * @param {string[]} args - Its arguments.
 * @param {object} [options] - `spawnSync` options.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} The run.
 */
function run(tool, args, options = {}) {
    const result = spawnSync(tool, args, {
        encoding: "utf8",
        maxBuffer: 1 << 26,
        ...options,
    });
    if (result.error) fail(`${tool} did not run: ${result.error.message}`);
    const warnings = (result.stderr ?? "").trim();
    if (result.status !== 0)
        fail(`${tool} exited with status ${result.status}\n${warnings}`.trim());
    if (warnings) fail(`${tool} reported:\n${warnings}`);
    return result;
}

let values;
try {
    ({ values } = parseArgs({
        options: {
            root: { type: "string" },
            help: { type: "boolean", default: false },
        },
        strict: true,
    }));
} catch (error) {
    console.error(`build-info: ${error.message}`);
    console.error(USAGE);
    process.exit(1);
}
if (values.help) {
    console.log(HELP);
    process.exit(0);
}

const ROOT = path.resolve(values.root ?? OWN_ROOT);
const CONFIG = path.join(ROOT, "package-build.config.yaml");
const DOCS_OUT = path.join(ROOT, "build", "docs");
const INFO_OUT = path.join(ROOT, "info");

requireTool("makeinfo");
requireTool("install-info");

let manuals;
try {
    manuals = resolvePackageBuildConfig(readPackConfig(CONFIG)).texinfo;
} catch (error) {
    console.error(
        String(locateConfigError(error, path.relative(process.cwd(), CONFIG)).message ?? error),
    );
    process.exit(1);
}
if (!manuals.length)
    fail("packageBuild.texinfo declares no manual", `${path.relative(process.cwd(), CONFIG)}:1:1`);

const converter = spawnSync(
    process.execPath,
    [path.join(OWN_ROOT, "scripts", "docs-texinfo.mjs"), "--root", ROOT, "--out", DOCS_OUT],
    { stdio: ["ignore", "ignore", "inherit"] },
);
if (converter.status !== 0) fail("scripts/docs-texinfo.mjs did not write the manuals");

fs.rmSync(INFO_OUT, { recursive: true, force: true });
fs.mkdirSync(INFO_OUT, { recursive: true });
fs.copyFileSync(path.join(DOCS_OUT, "dir"), path.join(INFO_OUT, "dir"));
for (const manual of manuals) {
    const info = path.join(INFO_OUT, `${manual.out}.info`);
    // One unsplit file, so the package ships exactly `info/<name>.info`; the
    // input is relative to the working directory so a warning names it relatively.
    run("makeinfo", [
        "--no-split",
        "-I",
        DOCS_OUT,
        "-o",
        info,
        path.relative(process.cwd(), path.join(DOCS_OUT, `${manual.out}.texi`)),
    ]);
    run("install-info", [info, path.join(INFO_OUT, "dir")]);
    console.log(`build-info: wrote ${path.relative(process.cwd(), info)}`);
}
