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

/** Render DOT maps with the Graphviz runtime installed by npm. */

import fs from "node:fs";
import { instance } from "@viz-js/viz";

/** The layout engines accepted by the map command. */
export const GRAPHVIZ_ENGINES = Object.freeze(["dot", "twopi", "neato"]);

const graphviz = await instance();

/**
 * Render a DOT source file to SVG.
 *
 * @param {string} dotPath - The saved DOT source.
 * @param {string} outPath - The output file.
 * @param {object} opts
 * @param {"dot"|"twopi"|"neato"} opts.engine - Layout engine.
 * @param {2} [opts.nop] - Preserve positioned nodes as `neato -n2` does.
 * @returns {{warnings: string}} Renderer warnings.
 */
export function renderDot(dotPath, outPath, { engine, nop }) {
    if (!GRAPHVIZ_ENGINES.includes(engine)) {
        throw new Error(`Unsupported Graphviz engine "${engine}" for ${dotPath}`);
    }
    const dot = fs.readFileSync(dotPath, "utf8");
    try {
        const result = graphviz.render(dot, {
            engine: nop === 2 ? "nop2" : engine,
            format: "svg",
        });
        if (result.status !== "success" || !result.output) {
            throw new Error(result.errors.map((error) => error.message).join("; ") || "no output");
        }
        fs.writeFileSync(outPath, result.output);
        // The embedded renderer uses Times metrics for the generated bold
        // headings; its warning repeats for every map and needs no action.
        return {
            warnings: result.errors
                .filter(
                    (error) =>
                        error.level === "warning" &&
                        !error.message.includes("no hard-coded metrics for 'Helvetica-Bold'") &&
                        !/^Warning: no value for width of non-ASCII character \d+\. Falling back to width of space character$/.test(
                            error.message,
                        ),
                )
                .map((error) => error.message)
                .join("; "),
        };
    } catch (error) {
        throw new Error(`Graphviz failed over ${dotPath}: ${error.message}`, { cause: error });
    }
}
