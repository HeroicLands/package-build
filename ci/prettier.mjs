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
 * Runs this repository's Prettier over the paths given, or over the whole tree
 * when none are.
 *
 * `npm run format -- a.mjs b.md` appends `a.mjs b.md` to the script's command
 * line, so a script of `prettier --write .` formats everything regardless.
 * This wrapper takes the mode first and treats whatever follows as the paths.
 * A path that no longer exists, such as a file a branch deleted, is skipped
 * rather than failing the run. Prettier still resolves the repository's own
 * configuration and ignore file.
 *
 * ```text
 * node ci/prettier.mjs --write [paths...]
 * node ci/prettier.mjs --check [paths...]
 * ```
 *
 * @module
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * The Prettier arguments for one invocation.
 *
 * @param {readonly string[]} args - The mode, `--write` or `--check`, then the
 *   paths.
 * @param {(path: string) => boolean} [exists] - Whether a path exists.
 * @returns {string[]|null} The arguments, `.` when no path was given, or `null`
 *   when paths were given and none exists, so there is nothing to run.
 * @throws {Error} When the mode is missing or unknown.
 */
export function prettierArgs(args, exists = fs.existsSync) {
    const [mode, ...paths] = args;
    if (mode !== "--write" && mode !== "--check") {
        throw new Error("the first argument must be --write or --check");
    }
    if (paths.length === 0) return [mode, "."];
    const present = paths.filter((entry) => exists(entry));
    return present.length ? [mode, ...present] : null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    let args;
    try {
        args = prettierArgs(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        process.exit(2);
    }
    if (args === null) {
        console.log("None of the given paths exist; nothing to format.");
    } else {
        const bin = createRequire(import.meta.url).resolve("prettier/bin/prettier.cjs");
        const result = spawnSync(process.execPath, [bin, ...args], { stdio: "inherit" });
        process.exit(result.status ?? 1);
    }
}
