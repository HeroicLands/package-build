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
 * repository root (or the one `--root` names) and writes one `<name>.texi` per manual with its chapter files, images and
 * report, and the Info `dir` file that lists them, into `build/docs/` beneath the repository root
 * or the directory `--out` names. `--check` converts and reports without
 * writing. Every finding is printed to stderr as
 * `file:line:column: severity: message`; an error exits with status 1 and
 * writes nothing, and a warning is reported and the manual is written. `--help` prints the usage and exits with status 0.
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
at its top page and follows links to the pages that take part, and takes its
structure and order from each page's texinfo front matter.

Options:
  --root <dir>  Read the configuration and docs/ of the repository at <dir>
                rather than this one.
  --out <dir>   Write the manuals and the Info dir file to <dir> rather than
                build/docs beneath the repository root.
  --check       Convert and report findings without writing.
  --help        Print this help and exit.

Each finding is printed to stderr as
file:line:column: severity: message, and the warnings are also written to
<name>.report.txt beside the manual.

Exit status:
  0  every manual converted with no error (warnings are reported), or --help
  1  an error, or an unknown option`;

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
let configAuthors = [];
let contentPackage;
try {
    const raw = readPackConfig(CONFIG);
    configured = resolvePackageBuildConfig(raw).texinfo;
    contentPackage = raw.contentPackage;
    configAuthors = (raw.authors ?? []).map((author) => author?.name).filter(Boolean);
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
    authors: configAuthors,
    contentPackage,
    config: { file: "package-build.config.yaml", text: fs.readFileSync(CONFIG, "utf8") },
});
const lines = findings.map((finding) =>
    formatFinding({
        ...finding,
        file: path.relative(process.cwd(), path.join(ROOT, finding.file)),
    }),
);
for (const text of lines) console.error(text);
const errors = findings.filter((finding) => finding.severity === "error").length;
if (errors) {
    console.error(`docs-texinfo: ${errors} error(s); no manual written`);
    process.exit(1);
}
if (!values.check) {
    const out = path.resolve(values.out ?? path.join(ROOT, "build", "docs"));
    const show = (file) => path.relative(process.cwd(), file);
    for (const manual of manuals) {
        fs.mkdirSync(path.join(out, `${manual.out}-chapters`), { recursive: true });
        fs.writeFileSync(path.join(out, `${manual.out}.texi`), manual.texinfo);
        for (const chapter of manual.chapters)
            fs.writeFileSync(path.join(out, chapter.path), chapter.texinfo);
        for (const asset of manual.assets) {
            fs.mkdirSync(path.dirname(path.join(out, asset.to)), { recursive: true });
            fs.copyFileSync(path.join(ROOT, asset.from), path.join(out, asset.to));
        }
        const own = manual.findings.map((finding) =>
            formatFinding({
                ...finding,
                file: path.relative(process.cwd(), path.join(ROOT, finding.file)),
            }),
        );
        fs.writeFileSync(
            path.join(out, `${manual.out}.report.txt`),
            own.length ? `${own.join("\n")}\n` : "",
        );
        console.log(`docs-texinfo: wrote ${show(path.join(out, `${manual.out}.texi`))}`);
    }
    fs.writeFileSync(path.join(out, "dir"), dir);
    console.log(`docs-texinfo: wrote ${show(path.join(out, "dir"))}`);
}
