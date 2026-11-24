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
 * Write the Texinfo manuals the configuration declares.
 *
 *     node scripts/docs-texinfo.mjs [--root <dir>] [--out <dir>] [--check] [--help]
 *
 * Reads `packageBuild.texinfo` from `package-build.config.yaml` at the
 * repository root (or the one `--root` names) and writes one `<name>.texi` per manual, with the Info
 * `dir` file that lists them, into `build/docs/` beneath the repository root
 * or the directory `--out` names. `--check` converts and reports without
 * writing. Every finding is printed to stderr as
 * `file:line:column: error: message`; any finding exits with status 1 and
 * writes nothing. `--help` prints the usage and exits with status 0.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { resolvePackageBuildConfig } from "../config.mjs";
import { locateConfigError, readPackConfig } from "../engine/pack-config.mjs";
import { convertDocs, formatFinding } from "./docs-texinfo/convert.mjs";

const OWN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USAGE =
    "usage: node scripts/docs-texinfo.mjs [--root <dir>] [--out <dir>] [--check] [--help]";

const HELP = `${USAGE}

Convert the Markdown under docs/ into the Texinfo manuals that
packageBuild.texinfo declares in package-build.config.yaml. Each manual starts
at its top page and follows links to the other pages, in the order it first
meets them.

Options:
  --root <dir>  Read the configuration and docs/ of the repository at <dir>
                rather than this one.
  --out <dir>   Write the manuals and the Info dir file to <dir> rather than
                build/docs beneath the repository root.
  --check       Convert and report findings without writing.
  --help        Print this help and exit.

Each finding is printed to stderr as
file:line:column: error: message.

Exit status:
  0  every manual converted with no findings, or --help
  1  a finding, or an unknown option`;

let values;
try {
    ({ values } = parseArgs({
        options: {
            root: { type: "string" },
            out: { type: "string" },
            check: { type: "boolean", default: false },
            help: { type: "boolean", default: false },
        },
        strict: true,
    }));
} catch (error) {
    console.error(`docs-texinfo: ${error.message}`);
    console.error(USAGE);
    process.exit(1);
}
if (values.help) {
    console.log(HELP);
    process.exit(0);
}

const ROOT = path.resolve(values.root ?? OWN_ROOT);
const CONFIG = path.join(ROOT, "package-build.config.yaml");
const CONFIG_REL = path.relative(process.cwd(), CONFIG);

let configured;
try {
    configured = resolvePackageBuildConfig(readPackConfig(CONFIG)).texinfo;
} catch (error) {
    console.error(String(locateConfigError(error, CONFIG_REL).message ?? error));
    process.exit(1);
}
if (!configured.length) {
    console.error(`${CONFIG_REL}:1:1: error: packageBuild.texinfo declares no manual`);
    process.exit(1);
}

const { manuals, dir, findings } = convertDocs({
    root: ROOT,
    manuals: configured,
    config: { file: "package-build.config.yaml", text: fs.readFileSync(CONFIG, "utf8") },
});
for (const finding of findings) {
    console.error(
        formatFinding({
            ...finding,
            file: path.relative(process.cwd(), path.join(ROOT, finding.file)),
        }),
    );
}
if (findings.length) {
    console.error(`docs-texinfo: ${findings.length} finding(s)`);
    process.exit(1);
}
if (!values.check) {
    const out = path.resolve(values.out ?? path.join(ROOT, "build", "docs"));
    fs.mkdirSync(out, { recursive: true });
    for (const manual of manuals) {
        fs.writeFileSync(path.join(out, `${manual.out}.texi`), manual.texinfo);
        console.log(
            `docs-texinfo: wrote ${path.relative(process.cwd(), path.join(out, `${manual.out}.texi`))}`,
        );
    }
    fs.writeFileSync(path.join(out, "dir"), dir);
    console.log(`docs-texinfo: wrote ${path.relative(process.cwd(), path.join(out, "dir"))}`);
}
