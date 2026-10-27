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
 * The labels a repository's changesets group under.
 *
 * They are the options of the changelog entry in `.changeset/config.json`,
 * beside the generator they configure:
 *
 * ```json
 * "changelog": ["@heroiclands/package-build/changelog", { "labels": ["Verse", "Rendering"] }]
 * ```
 *
 * `changelog check` accepts a label only if it is listed there or is
 * `Miscellaneous`, which every repository has and never declares.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { MISCELLANEOUS } from "./changelog-lint.mjs";

/**
 * Read `labels` from the changelog options in `.changeset/config.json`.
 *
 * @param {string} [cwd] - The repository root.
 * @returns {readonly string[]|null} The labels in display order, or `null`
 *   when the file, the options or `labels` is absent.
 * @throws {Error} When `config.json` is not JSON, or `labels` is not an array
 *   of distinct non-empty strings or names `Miscellaneous`.
 */
export function readChangelogLabels(cwd = process.cwd()) {
    const file = path.join(cwd, ".changeset", "config.json");
    if (!fs.existsSync(file)) return null;
    const where = path.relative(cwd, file);
    let config;
    try {
        config = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        throw new Error(`${where}: is not valid JSON (${error.message})`);
    }
    const entry = config?.changelog;
    const options = Array.isArray(entry) ? entry[1] : undefined;
    if (options === undefined || options === null) return null;
    if (typeof options !== "object" || Array.isArray(options))
        throw new Error(`${where}: the changelog options must be an object`);
    if (options.labels === undefined) return null;
    const { labels } = options;
    const bad = (problem) => new Error(`${where}: changelog \`labels\` ${problem}`);
    if (!Array.isArray(labels)) throw bad("must be an array of strings");
    const seen = new Set();
    for (const label of labels) {
        if (typeof label !== "string" || label.trim() === "")
            throw bad("must hold only non-empty strings");
        if (label === MISCELLANEOUS)
            throw bad(`declares \`${MISCELLANEOUS}\`, which is always available and always last`);
        if (seen.has(label)) throw bad(`declares \`${label}\` more than once`);
        seen.add(label);
    }
    return Object.freeze([...labels]);
}
