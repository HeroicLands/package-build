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
 * The repository walk shared by the prose checks.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Directories never walked, whatever the ignore files say.
 *
 * `node_modules` is in every consumer's `.gitignore` and would be excluded
 * anyway; skipping it in the walk rather than per file is the difference
 * between a check that takes a second and one that stats a hundred thousand
 * files to be told each is ignored. `.git` is in nobody's `.gitignore`, so it
 * has to be named.
 */
const NEVER_WALK = Object.freeze(new Set([".git", "node_modules"]));

/**
 * Every file under a root, minus the directories nothing should walk.
 *
 * @param {string} root - Absolute path to walk.
 * @param {object} [hooks]
 * @param {(dir: string) => void} [hooks.enter] - Called with each directory
 *   before its entries are read.
 * @param {(abs: string, isDirectory: boolean) => boolean} [hooks.skip] -
 *   Whether to leave a path out; a skipped directory is not entered.
 * @returns {string[]} Absolute file paths, in directory order.
 */
export function walkFiles(root, hooks = {}) {
    const out = [];
    /** @param {string} dir - Directory to descend into. */
    const descend = (dir) => {
        hooks.enter?.(dir);
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            // A directory that vanished or cannot be read is not a finding
            // about prose; leave it to whatever owns it.
            return;
        }
        for (const entry of entries) {
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!NEVER_WALK.has(entry.name) && !hooks.skip?.(abs, true)) descend(abs);
            } else if (entry.isFile() && !hooks.skip?.(abs, false)) {
                out.push(abs);
            }
        }
    };
    descend(root);
    return out;
}
