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
 * GraphViz, as `content-build map` reaches it.
 *
 * GraphViz is a build-time tool of the map command alone: nothing else in the
 * toolchain draws, so nothing else depends on it, and a package that never
 * runs `map` never needs it installed. The command finds the engine it needs
 * once, names what to install when it is absent, and runs it over a `.dot`
 * file it has already written — the `.dot` is always kept beside the `.svg`,
 * so a drawing can be re-rendered, inspected or diffed without re-reading the
 * content index.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * The layout engines the map command may ask for. `dot` draws a tree by
 * rank, `twopi` the same tree radially, `neato` a graph by its edge lengths —
 * and, with every node pinned, the map from a place.
 *
 * @type {readonly string[]}
 */
export const GRAPHVIZ_ENGINES = Object.freeze(["dot", "twopi", "neato"]);

/**
 * Where a package manager puts GraphViz when `PATH` does not say: Homebrew
 * on Apple silicon, Homebrew on Intel, and the system directories.
 *
 * @type {readonly string[]}
 */
const KNOWN_DIRECTORIES = Object.freeze([
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/opt/local/bin",
]);

/**
 * Find a GraphViz engine's binary.
 *
 * `PATH` first, then the directories a package manager installs into, so a
 * shell whose profile does not export Homebrew's directory still finds it.
 * The result is a path to a file that exists; whether it runs is the render's
 * business.
 *
 * @param {string} engine - One of {@link GRAPHVIZ_ENGINES}.
 * @param {object} [opts]
 * @param {Record<string, string|undefined>} [opts.env] - The environment to
 *   read `PATH` from, defaulting to the process's.
 * @param {readonly string[]} [opts.fallbacks] - The directories tried after
 *   `PATH`, defaulting to the package managers' ones.
 * @returns {string|undefined} The binary, or `undefined` when none is found.
 * @throws {Error} When `engine` is not a GraphViz engine this command uses.
 */
export function findGraphviz(engine, { env = process.env, fallbacks = KNOWN_DIRECTORIES } = {}) {
    if (!GRAPHVIZ_ENGINES.includes(engine)) {
        throw new Error(
            `"${engine}" is not a GraphViz engine the map command uses; ` +
                `choose ${GRAPHVIZ_ENGINES.join(", ")}`,
        );
    }
    const onPath = String(env.PATH ?? "")
        .split(path.delimiter)
        .filter(Boolean);
    for (const dir of [...onPath, ...fallbacks]) {
        const candidate = path.join(dir, engine);
        try {
            if (fs.statSync(candidate).isFile()) return candidate;
        } catch {
            // Not here; the next directory may have it.
        }
    }
    return undefined;
}

/**
 * What to say when an engine is not installed: the name, and what installs
 * it on the two platforms a contributor is likely to be on.
 *
 * @param {string} engine - The engine that was wanted.
 * @returns {string} The message.
 */
export function graphvizMissingMessage(engine) {
    return (
        `GraphViz's \`${engine}\` is not installed, and \`content-build map\` draws with it; ` +
        `install GraphViz (\`brew install graphviz\` on macOS, ` +
        `\`apt-get install graphviz\` on Debian or Ubuntu) and run the command again`
    );
}

/**
 * Render a `.dot` file with a GraphViz engine.
 *
 * The engine is run over the file rather than fed the text, so the file the
 * command keeps is exactly what was drawn. Warnings GraphViz prints — an
 * unknown font, an overlapping label — are returned rather than swallowed,
 * and a non-zero exit is an error naming the file.
 *
 * @param {string} dotPath - The `.dot` file.
 * @param {string} outPath - Where to write the rendering.
 * @param {object} opts
 * @param {string} opts.binary - The engine's binary, from {@link findGraphviz}.
 * @param {string} [opts.format="svg"] - The `-T` format.
 * @param {string[]} [opts.args] - Further arguments, before the file.
 * @returns {{warnings: string}} What the engine printed on stderr.
 * @throws {Error} When the engine exits non-zero or cannot be run.
 */
export function renderDot(dotPath, outPath, { binary, format = "svg", args = [] }) {
    const result = spawnSync(binary, [`-T${format}`, ...args, dotPath, "-o", outPath], {
        encoding: "utf8",
    });
    if (result.error) {
        throw new Error(`${binary} could not be run over ${dotPath}: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(
            `${binary} failed over ${dotPath} (exit ${result.status}): ` +
                `${String(result.stderr ?? "").trim()}`,
        );
    }
    return { warnings: String(result.stderr ?? "").trim() };
}
