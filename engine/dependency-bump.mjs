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
 * Taking a newer version of a dependency.
 *
 * npm does the resolution, and that is the point of the command: editing the
 * three `version` / `resolved` / `integrity` lines by hand is correct only
 * while the new version's dependency set is identical to the old one's, and
 * nothing tells the author when it is not. npm is what knows.
 *
 * npm writes `package-lock.json` with the indentation `package.json` uses, so
 * a consumer whose two files agree sees only the lines that moved. Each file
 * is written back with the indent it already carried, so a lockfile indented
 * unlike its manifest keeps its own.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** Dependency sections a bump may read a package's declared range from. */
const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"];

/**
 * The indentation a JSON file already uses, as the literal string to indent
 * with.
 *
 * Read from the first indented line rather than assumed, because the two-space
 * default is right for some consumers and wrong for most of them. A file whose
 * second line is not indented — a one-line document — reports the npm default,
 * which is what rewriting it would produce anyway.
 *
 * @param {string} text - The file's contents.
 * @returns {string} The indent string, e.g. `"    "` or `"  "`.
 */
export function detectJsonIndent(text) {
    const match = /\n([ \t]+)\S/.exec(text);
    return match ? match[1] : "  ";
}

/**
 * Rewrite a JSON file with a given indent, leaving its content untouched.
 *
 * @param {string} file - Absolute path to the JSON file.
 * @param {string} indent - The indent string to write with.
 * @returns {boolean} Whether the file's bytes changed.
 */
export function reindentJsonFile(file, indent) {
    if (!fs.existsSync(file)) return false;
    const before = fs.readFileSync(file, "utf8");
    const trailingNewline = before.endsWith("\n") ? "\n" : "";
    const after = JSON.stringify(JSON.parse(before), null, indent) + trailingNewline;
    if (after === before) return false;
    fs.writeFileSync(file, after);
    return true;
}

/**
 * Every package name a manifest declares a range for, in declaration order.
 *
 * @param {object} manifest - The parsed `package.json`.
 * @returns {string[]} The declared package names.
 */
export function declaredDependencies(manifest) {
    const names = [];
    for (const section of DEPENDENCY_SECTIONS) {
        for (const name of Object.keys(manifest?.[section] ?? {})) {
            if (!names.includes(name)) names.push(name);
        }
    }
    return names;
}

/**
 * The packages a bump targets when the caller names none.
 *
 * The first-party scope, because that is the bump a consumer runs by hand: a
 * third-party one arrives from Dependabot on its own schedule, while a
 * first-party release is taken the moment it publishes, usually to unblock the
 * very change that prompted it.
 *
 * @param {object} manifest - The parsed `package.json`.
 * @param {string} [scope] - The scope prefix to match.
 * @returns {string[]} The package names to bump.
 */
export function firstPartyDependencies(manifest, scope = "@heroiclands/") {
    return declaredDependencies(manifest).filter((name) => name.startsWith(scope));
}

/**
 * The version the lockfile currently resolves a package to.
 *
 * Read from the lockfile rather than the manifest, because the manifest states
 * a *range* and the lockfile states what `npm ci` will actually install — which
 * is the thing a bump moves. A caret range that already admits the new version
 * needs no manifest change at all, and reporting the range would then show a
 * bump as changing nothing.
 *
 * @param {object} lock - The parsed `package-lock.json`.
 * @param {string} name - The package name.
 * @returns {string|undefined} The locked version, if the lockfile holds one.
 */
export function lockedVersion(lock, name) {
    return lock?.packages?.[`node_modules/${name}`]?.version;
}

/**
 * Take the newest published version of one or more dependencies.
 *
 * npm performs the resolution — so a bump that changes the dependency set is
 * as correct as one that moves three lines — and both JSON files are written
 * back with the indentation they already used.
 *
 * @param {object} options - Options.
 * @param {string} options.rootDir - The repository root holding `package.json`.
 * @param {string[]} [options.packages] - Packages to bump. Defaults to every
 *   first-party dependency the manifest declares.
 * @param {string} [options.tag] - The dist-tag to take. Defaults to `latest`.
 * @param {boolean} [options.check] - Report what would change and write nothing.
 * @param {(command: string, args: string[], cwd: string) => void} [options.run] -
 *   How to invoke npm. Injected by the tests, which have no registry.
 * @returns {{changes: Array<{name: string, from: string|undefined, to: string|undefined}>,
 *   unchanged: string[], reindented: string[], checked: boolean}} What moved.
 */
export function bumpDependencies({ rootDir, packages, tag = "latest", check = false, run }) {
    const manifestPath = path.join(rootDir, "package.json");
    const lockPath = path.join(rootDir, "package-lock.json");

    if (!fs.existsSync(manifestPath)) {
        throw new Error(`no package.json at ${rootDir}`);
    }
    if (!fs.existsSync(lockPath)) {
        throw new Error(
            `no package-lock.json at ${rootDir}: this bump moves the lockfile, ` +
                `which is what \`npm ci\` resolves from`,
        );
    }

    const manifestText = fs.readFileSync(manifestPath, "utf8");
    const lockText = fs.readFileSync(lockPath, "utf8");
    const manifest = JSON.parse(manifestText);
    const lockBefore = JSON.parse(lockText);

    const declared = declaredDependencies(manifest);
    const targets = packages?.length ? packages : firstPartyDependencies(manifest);

    if (targets.length === 0) {
        return { changes: [], unchanged: [], reindented: [], checked: check };
    }

    const unknown = targets.filter((name) => !declared.includes(name));
    if (unknown.length > 0) {
        throw new Error(
            `not a declared dependency: ${unknown.join(", ")} — ` +
                `a bump takes a newer version of something already depended on`,
        );
    }

    const before = new Map(targets.map((name) => [name, lockedVersion(lockBefore, name)]));

    if (check) {
        const latest = (name) =>
            execFileSync("npm", ["view", `${name}@${tag}`, "version"], {
                cwd: rootDir,
                encoding: "utf8",
            }).trim();
        const changes = [];
        const unchanged = [];
        for (const name of targets) {
            const to = latest(name);
            if (to && to !== before.get(name)) changes.push({ name, from: before.get(name), to });
            else unchanged.push(name);
        }
        return { changes, unchanged, reindented: [], checked: true };
    }

    const invoke =
        run ?? ((command, args, cwd) => execFileSync(command, args, { cwd, stdio: "pipe" }));

    invoke(
        "npm",
        ["install", "--package-lock-only", ...targets.map((name) => `${name}@${tag}`)],
        rootDir,
    );

    // Hold each file to the indent it already carried. Both, because npm
    // rewrites the manifest too when a range has to move — which below 1.0 it
    // always does, a caret there being locked to the minor.
    const reindented = [];
    if (reindentJsonFile(lockPath, detectJsonIndent(lockText))) reindented.push(lockPath);
    if (reindentJsonFile(manifestPath, detectJsonIndent(manifestText))) {
        reindented.push(manifestPath);
    }

    const lockAfter = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    const changes = [];
    const unchanged = [];
    for (const name of targets) {
        const to = lockedVersion(lockAfter, name);
        if (to !== before.get(name)) changes.push({ name, from: before.get(name), to });
        else unchanged.push(name);
    }

    return { changes, unchanged, reindented, checked: false };
}
