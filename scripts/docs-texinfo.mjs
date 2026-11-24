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
 * Write the Texinfo manual generated from `docs/`.
 *
 *     node scripts/docs-texinfo.mjs [--out <file>] [--check] [--help]
 *
 * Writes `build/docs/package-build.texi` beneath the repository root, or the
 * file `--out` names. `--check` converts and reports without writing. Every
 * construct the converter cannot map is printed to stderr as
 * `file:line:column: error: message`; any finding exits with status 1 and
 * writes nothing. `--help` prints the usage and exits with status 0.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { convertDocs, formatFinding } from "./docs-texinfo/convert.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = "usage: node scripts/docs-texinfo.mjs [--out <file>] [--check] [--help]";

const HELP = `${USAGE}

Convert the Markdown under docs/ into one Texinfo manual, in the order
scripts/docs-texinfo/manifest.mjs gives.

Options:
  --out <file>  Write the manual to <file> rather than
                build/docs/package-build.texi beneath the repository root.
  --check       Convert and report findings without writing the manual.
  --help        Print this help and exit.

Each construct the converter cannot map is printed to stderr as
file:line:column: error: message.

Exit status:
  0  the manual converted with no findings, or --help
  1  a finding, or an unknown option`;

let values;
try {
    ({ values } = parseArgs({
        options: {
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

const { texinfo, findings } = convertDocs({ root: ROOT });
for (const finding of findings) {
    console.error(
        formatFinding({
            ...finding,
            file: path.relative(process.cwd(), path.join(ROOT, finding.file)),
        }),
    );
}
if (findings.length) {
    console.error(`docs-texinfo: ${findings.length} construct(s) have no Texinfo mapping`);
    process.exit(1);
}
if (!values.check) {
    const out = path.resolve(values.out ?? path.join(ROOT, "build", "docs", "package-build.texi"));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, texinfo);
    console.log(`docs-texinfo: wrote ${path.relative(process.cwd(), out)}`);
}
