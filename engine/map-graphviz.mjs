// SPDX-License-Identifier: GPL-3.0-or-later

/** Render DOT maps with the Graphviz runtime installed by npm. */

import fs from "node:fs";
import { instance } from "@viz-js/viz";
import { Resvg } from "@resvg/resvg-js";

/** The layout engines accepted by the map command. */
export const GRAPHVIZ_ENGINES = Object.freeze(["dot", "twopi", "neato"]);

const graphviz = await instance();

/**
 * Render a DOT source file to SVG, plain positions, or a PNG background.
 *
 * A PNG uses the same Graphviz SVG layout as the vector map. SVG dimensions
 * are in points; resvg starts at 96 pixels per inch, so the zoom converts
 * the requested DPI to the same physical size as Graphviz's PNG output.
 *
 * @param {string} dotPath - The saved DOT source.
 * @param {string} outPath - The output file.
 * @param {object} opts
 * @param {"dot"|"twopi"|"neato"} opts.engine - Layout engine.
 * @param {"svg"|"plain"|"png"} [opts.format="svg"] - Output format.
 * @param {2} [opts.nop] - Preserve positioned nodes as `neato -n2` does.
 * @param {number} [opts.dpi=96] - PNG resolution.
 * @returns {{warnings: string}} Renderer warnings.
 */
export function renderDot(dotPath, outPath, { engine, format = "svg", nop, dpi = 96 }) {
    if (!GRAPHVIZ_ENGINES.includes(engine)) {
        throw new Error(`Unsupported Graphviz engine "${engine}" for ${dotPath}`);
    }
    const dot = fs.readFileSync(dotPath, "utf8");
    try {
        const result = graphviz.render(dot, {
            engine: nop === 2 ? "nop2" : engine,
            format: format === "png" ? "svg" : format,
        });
        if (result.status !== "success" || !result.output) {
            throw new Error(result.errors.map((error) => error.message).join("; ") || "no output");
        }
        if (format === "png") {
            const image = new Resvg(result.output, {
                fitTo: { mode: "zoom", value: dpi / 96 },
            }).render();
            fs.writeFileSync(outPath, image.asPng());
        } else {
            fs.writeFileSync(outPath, result.output);
        }
        // The embedded renderer uses Times metrics for the generated bold
        // headings; its warning repeats for every map and needs no action.
        return {
            warnings: result.errors
                .filter(
                    (error) =>
                        error.level === "warning" &&
                        !error.message.includes("no hard-coded metrics for 'Helvetica-Bold'"),
                )
                .map((error) => error.message)
                .join("; "),
        };
    } catch (error) {
        throw new Error(`Graphviz failed over ${dotPath}: ${error.message}`, { cause: error });
    }
}
