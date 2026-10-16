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
 * The characters a content or picture path may hold.
 *
 * Every character of a path is printable 7-bit ASCII, U+0020 to U+007E. A note's
 * identity comes from its `shortcode` and a picture's from its basename, so a
 * path's spelling changes no address; what a non-ASCII path does change is how
 * the file travels. Filesystems disagree on Unicode normalisation, shells and
 * `git ls-files` quote the bytes, and archive tools and CDN keys each encode
 * the name their own way.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { DEPLOYED_ASSET_TYPES } from "./asset-types.mjs";

/**
 * The distinct characters of a string outside U+0020 to U+007E, in order of
 * first appearance.
 *
 * @param {string} text - A path, or one component of one.
 * @returns {string[]} The offending characters; empty when the text is clean.
 */
export function offendingPathCharacters(text) {
    const found = [];
    for (const ch of text) {
        const point = ch.codePointAt(0) ?? 0;
        if ((point < 0x20 || point > 0x7e) && !found.includes(ch)) found.push(ch);
    }
    return found;
}

/**
 * The message for a path holding characters outside printable ASCII.
 *
 * @param {string[]} characters - The offending characters.
 * @returns {string} The finding's message.
 */
function pathMessage(characters) {
    const named = characters.map((ch) => {
        const point = ch.codePointAt(0) ?? 0;
        const code = `U+${point.toString(16).toUpperCase().padStart(4, "0")}`;
        return point < 0x20 || point === 0x7f ? code : `${code} (${ch})`;
    });
    return (
        `the path holds ${named.join(", ")}, outside printable ASCII; ` +
        "rename the file using ASCII only"
    );
}

/**
 * Walk the content tree and the package's picture roots, reporting each entry
 * whose name holds a character outside printable ASCII.
 *
 * An entry is checked by its own name as the walk reaches it, so a directory
 * with a bad name is reported once and not again for every file beneath it.
 * Dot-entries and `skipDirectories` are skipped, as in the other content walks.
 * A finding names its file relative to the working directory, with no line or
 * column.
 *
 * @param {object} opts - Options.
 * @param {string} opts.contentBase - Root of the content tree.
 * @param {string} opts.assetsBase - The package's asset directory, whose
 *   picture roots are walked.
 * @param {readonly string[]} [opts.skipDirectories] - Directory names to ignore.
 * @param {ReturnType<import("./content-sources.mjs").captureContentSources>} [opts.inventory] - Captured physical paths in root walk order.
 * @returns {{findings: Array<{file: string, severity: "error", message: string}>,
 *   files: number}} The findings, and how many paths were checked.
 */
export function lintPathCharset({ contentBase, assetsBase, skipDirectories = [], inventory }) {
    const skip = new Set(skipDirectories);
    const findings = [];
    let files = 0;
    if (inventory) {
        const roots = new Set(
            [
                contentBase,
                ...DEPLOYED_ASSET_TYPES.map((entry) => path.join(assetsBase, entry.root)),
            ].map((root) => path.resolve(root)),
        );
        for (const entry of inventory.paths) {
            if (!roots.has(entry.root)) continue;
            const parts = path.relative(entry.root, entry.file).split(path.sep);
            if (parts.some((name) => name.startsWith(".") || skip.has(name))) continue;
            files++;
            const bad = offendingPathCharacters(entry.name);
            if (bad.length)
                findings.push({
                    file: path.relative(process.cwd(), entry.file),
                    severity: "error",
                    message: pathMessage(bad),
                });
        }
        return { findings, files };
    }

    /** @param {string} dir - Directory to descend into. */
    const walk = (dir) => {
        /** @type {import("node:fs").Dirent[]} */
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name.startsWith(".") || skip.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            files += 1;
            const bad = offendingPathCharacters(entry.name);
            if (bad.length) {
                findings.push({
                    file: path.relative(process.cwd(), full),
                    severity: /** @type {const} */ ("error"),
                    message: pathMessage(bad),
                });
            }
            if (entry.isDirectory()) walk(full);
        }
    };

    const roots = new Set([
        path.resolve(contentBase),
        ...DEPLOYED_ASSET_TYPES.map((entry) => path.resolve(assetsBase, entry.root)),
    ]);
    for (const root of roots) walk(root);
    return { findings, files };
}
