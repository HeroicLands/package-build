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

/** Physical source capture, independent of whether a note can be indexed. */
import fs from "node:fs";
import path from "node:path";
import log from "loglevel";
import { DEPLOYED_ASSET_TYPES } from "./asset-types.mjs";

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".yaml", ".yml", ".json"]);

/**
 * Capture exact text once and retain directory entries for physical checks.
 * The index walk and raw check walks retain their established traversal orders.
 * @param {string} contentBase - Absolute content root.
 * @param {string} assetsBase - Absolute assets root.
 * @param {readonly string[]} skipDirectories - Resolved directory scope.
 * @returns {{sources: Map<string, {raw: string}>, indexSources: Map<string, {raw: string}>, paths: Array<{root: string, file: string, name: string, directory: boolean}>}} Captured input and physical walk order.
 */
export function captureContentSources(contentBase, assetsBase, skipDirectories) {
    const sources = new Map();
    const directories = new Map();
    const readErrors = new Map();
    const paths = [];
    const skip = new Set(skipDirectories);
    const walk = (dir, text, includeHidden = false, root = dir) => {
        if (!fs.existsSync(dir)) return;
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (error) {
            if (text) log.warn(`Cannot read directory ${dir}: ${error.message}`);
            return;
        }
        if (text) directories.set(dir, entries);
        for (const entry of entries) {
            if (
                (!includeHidden && entry.name.startsWith(".")) ||
                (entry.isDirectory() && skip.has(entry.name))
            )
                continue;
            const file = path.join(dir, entry.name);
            paths.push({ root, file, name: entry.name, directory: entry.isDirectory() });
            if (entry.isDirectory()) walk(file, text, includeHidden, root);
            else if (text && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
                try {
                    sources.set(file, { raw: fs.readFileSync(file, "utf8") });
                } catch (error) {
                    // Selected Markdown must retain the index reader's refusal.
                    // Only the independent raw-checker inputs skip read errors.
                    if (entry.isFile() && entry.name.endsWith(".md")) readErrors.set(file, error);
                }
            }
        }
    };
    // The index scope includes dot paths; individual raw checks
    // filter those paths through capturedSources below.
    walk(contentBase, true, true);
    for (const root of new Set(
        DEPLOYED_ASSET_TYPES.map((entry) => path.resolve(assetsBase, entry.root)),
    ))
        if (root !== path.resolve(contentBase)) walk(root, false);
    const indexSources = new Map();
    const stack = [contentBase];
    while (stack.length) {
        const dir = stack.pop();
        for (const entry of directories.get(dir) ?? []) {
            if (entry.isDirectory() && skip.has(entry.name)) continue;
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) stack.push(file);
            else if (readErrors.has(file)) throw readErrors.get(file);
            else if (entry.isFile() && entry.name.endsWith(".md") && sources.has(file))
                indexSources.set(file, sources.get(file));
        }
    }
    return { sources, indexSources, paths };
}

/**
 * Select the exact physical scope of a raw checker from a captured map.
 * @param {string} contentBase - Content root.
 * @param {Map<string, {raw: string}>} sources - Captured physical sources.
 * @param {readonly string[]} skipDirectories - Directory names to ignore.
 * @param {Set<string>} extensions - Lowercase extensions accepted by the caller.
 */
export function* capturedSources(contentBase, sources, skipDirectories, extensions) {
    const root = path.resolve(contentBase);
    for (const [file, source] of sources) {
        const relative = path.relative(root, file);
        if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
        if (
            relative
                .split(path.sep)
                .some((name) => name.startsWith(".") || skipDirectories.includes(name))
        )
            continue;
        if (extensions.has(path.extname(file).toLowerCase()) && typeof source.raw === "string")
            yield [file, source.raw];
    }
}
