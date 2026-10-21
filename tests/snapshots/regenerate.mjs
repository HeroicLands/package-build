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
 * Regenerate the thalorna content snapshots.
 *
 *     node tests/snapshots/regenerate.mjs <thalorna-checkout> [--verify]
 *
 * `<thalorna-checkout>` is a checkout of the thalorna repository with its
 * dependencies installed (`npm ci`). The script installs this package into it
 * from a tarball (`npm pack`, then `npm i --no-save`), builds the site with
 * `package-build site build` into a scratch directory, builds each book's
 * Typst source without compiling it, and writes:
 *
 * - `tests/fixtures/snapshots/thalorna-site.json.br`: each page's title,
 *   visible text and outgoing link targets;
 * - `tests/fixtures/snapshots/thalorna-book.json.br`: each book entry's text.
 *
 * Both are Brotli-compressed JSON; `readSnapshot` in `content-snapshot.mjs`
 * reads them.
 *
 * With `--verify` the whole run is repeated and the two snapshots must match
 * byte for byte, which proves the snapshot holds no date, hash or search-index
 * id.
 *
 * The scratch directory is removed at the end. The checkout's tracked files are
 * not changed; its `build/` directory is.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

import { snapshotBooks, snapshotSite, writeSnapshot } from "./content-snapshot.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..", "..");
const FIXTURES = path.join(PACKAGE_ROOT, "tests", "fixtures", "snapshots");

/** Run a command, failing the script on a nonzero exit. */
function run(command, args, cwd) {
    const result = spawnSync(command, args, { cwd, stdio: "inherit", encoding: "utf8" });
    if (result.status !== 0)
        throw new Error(`${command} ${args.join(" ")} exited ${result.status} in ${cwd}`);
}

/** The output of a command run in `cwd`. */
function output(command, args, cwd) {
    const result = spawnSync(command, args, { cwd, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed in ${cwd}`);
    return result.stdout.trim();
}

/**
 * Build the snapshots once.
 *
 * @param {string} checkout - The thalorna checkout.
 * @param {string} scratch - A directory to render into.
 * @returns {{site: object, book: object}} The two snapshots.
 */
function build(checkout, scratch) {
    const deployed = path.join(scratch, "site");
    fs.rmSync(deployed, { recursive: true, force: true });
    run("npx", ["package-build", "site", "build", "--out", deployed], checkout);
    const configured = YAML.parse(
        fs.readFileSync(path.join(checkout, "package-build.config.yaml"), "utf8"),
    );
    const dist = path.join(checkout, configured.pdf?.out ?? path.join("build", "dist"));
    fs.rmSync(dist, { recursive: true, force: true });
    run("npx", ["package-build", "pdf", "--no-compile"], checkout);
    const origin = output("git", ["rev-parse", "HEAD"], checkout);
    const baseURL = JSON.parse(
        fs.readFileSync(path.join(checkout, "package.json"), "utf8"),
    ).homepage;
    if (!baseURL) throw new Error("package.json states no homepage");
    const site = path.join(deployed, configured.contentPackage);
    fs.rmSync(path.join(site, "pagefind"), { recursive: true, force: true });
    const siteSnapshot = snapshotSite(site, new URL(baseURL).origin);
    const bookSnapshot = snapshotBooks(dist);
    return {
        site: {
            ...siteSnapshot,
            source: { repository: "thalorna", commit: origin, base: new URL(baseURL).pathname },
        },
        book: { ...bookSnapshot, source: { repository: "thalorna", commit: origin } },
    };
}

const args = process.argv.slice(2);
const verify = args.includes("--verify");
const checkout = args.find((arg) => !arg.startsWith("--"));
if (!checkout) {
    console.error("usage: node tests/snapshots/regenerate.mjs <thalorna-checkout> [--verify]");
    process.exit(2);
}
const root = path.resolve(checkout);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "content-snapshot-"));

try {
    const packed = path.join(scratch, "pack");
    fs.mkdirSync(packed);
    run("npm", ["pack", "--pack-destination", packed], PACKAGE_ROOT);
    const tarball = path.join(
        packed,
        fs.readdirSync(packed).find((f) => f.endsWith(".tgz")),
    );
    run("npm", ["i", "--no-save", tarball], root);
    run("npm", ["run", "build:deps"], root);

    const first = build(root, scratch);
    writeSnapshot(path.join(FIXTURES, "thalorna-site.json.br"), first.site);
    writeSnapshot(path.join(FIXTURES, "thalorna-book.json.br"), first.book);

    if (verify) {
        const again = build(root, scratch);
        const same =
            JSON.stringify(first.site) === JSON.stringify(again.site) &&
            JSON.stringify(first.book) === JSON.stringify(again.book);
        if (!same) {
            console.error("The second run produced a different snapshot: it is not deterministic.");
            process.exitCode = 1;
        } else console.log("The second run produced an identical snapshot.");
    }
    console.log(
        `${first.site.pages.length} pages, ${first.book.books.length} books, ` +
            `${first.book.books.reduce((n, book) => n + book.entries.length, 0)} entries recorded.`,
    );
} finally {
    fs.rmSync(scratch, { recursive: true, force: true });
}
