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
 * `content-build map`: the drawings, written under `build/map/`.
 *
 * Three modes, each a function of the world the content index describes:
 *
 * - **`tree`** — the containment tree from `parents`, the author's check.
 *   `tree.svg` for the whole world and `tree-<continent>.svg` per continent,
 *   or `tree-<root>.svg` for the subtree beneath one place. The anomalies
 *   are returned as findings.
 * - **`from`** — the map from a place, `from-<shortcode>.svg`, for each
 *   place named, or for every place that takes part in a border or a route
 *   with `all`.
 * - **`travel`** — the whole route graph, `travel.svg`.
 *
 * Every rendering is written beside the `.dot` it was drawn from, and the
 * `.dot` is written first: with GraphViz absent the command either stops with
 * an error naming what to install, or — where the caller asked it to — writes
 * the `.dot` files, returns one warning, and skips the rendering, which is
 * what a site build asking for maps does rather than fail.
 *
 * A build never mutates its inputs: nothing here reads a note except to
 * locate a finding, and everything lands under the output directory.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { fromDot, travelDot, treeDot } from "./map-dot.mjs";
import { findGraphviz, graphvizMissingMessage, renderDot } from "./map-graphviz.mjs";
import { layoutFrom, travelGraph } from "./map-layout.mjs";
import { analyzeContainment, containmentFindings } from "./map-places.mjs";

/**
 * The directory the maps land in, below a package's root.
 *
 * @type {string}
 */
export const MAP_DIR = "build/map";

/**
 * The value of `--from` that means every place with a relation.
 *
 * @type {string}
 */
export const FROM_ALL = "all";

/**
 * Every place that states, or is named in, a border or a route — the places
 * `--from all` draws.
 *
 * @param {Map<string, import("./map-places.mjs").MapPlace>} places - Every place.
 * @returns {string[]} Shortcodes, sorted.
 */
export function relatedPlaces(places) {
    const related = new Set();
    for (const place of places.values()) {
        for (const entry of [...place.borders, ...place.routes]) {
            if (!places.has(entry.to)) continue;
            related.add(place.shortcode);
            related.add(entry.to);
        }
    }
    return [...related].sort();
}

/**
 * Build the maps.
 *
 * @param {object} opts
 * @param {import("./map-places.mjs").MapWorld} opts.world - The places, as
 *   {@link module:engine/map-places.loadMapWorld} returns them.
 * @param {string} opts.outDir - Where to write; created if absent.
 * @param {boolean} [opts.tree] - Draw the containment tree.
 * @param {string} [opts.root] - With `tree`, the subtree beneath this place.
 * @param {string[]} [opts.from] - Draw the map from each of these places, or
 *   from every related place for {@link FROM_ALL}.
 * @param {boolean} [opts.travel] - Draw the whole route graph.
 * @param {string} [opts.engine="dot"] - The tree's engine: `dot`, `twopi` or
 *   `neato`. The map from a place is always `neato` with every node pinned,
 *   and the route graph always `neato`.
 * @param {string} [opts.rankdir="TB"] - The tree's rank direction, `dot` only.
 * @param {number} [opts.nodesep] - The tree's `nodesep`, inches.
 * @param {number} [opts.ranksep] - The tree's `ranksep`, inches.
 * @param {number} [opts.scale=1] - Multiplies every node's size and font.
 * @param {boolean} [opts.polities=true] - Whether the tree draws polities.
 * @param {(engine: string) => string|undefined} [opts.locate] - How a GraphViz
 *   engine's binary is found; the real lookup by default.
 * @param {boolean} [opts.requireGraphviz=true] - Whether a missing engine is
 *   an error. False, the `.dot` files are written, the renderings skipped,
 *   and one warning returned.
 * @returns {{written: string[], findings: Array<{file: string, line?: number,
 *   column?: number, severity: "error"|"warning", message: string}>,
 *   skipped: boolean}} What was written, what was found, and whether the
 *   rendering was skipped for want of GraphViz.
 * @throws {Error} When no mode is asked for, a named place is not one, or
 *   GraphViz is required and absent.
 */
export function buildMaps({
    world,
    outDir,
    tree = false,
    root,
    from = [],
    travel = false,
    engine = "dot",
    rankdir = "TB",
    nodesep,
    ranksep,
    scale = 1,
    polities = true,
    locate = findGraphviz,
    requireGraphviz = true,
}) {
    if (!tree && from.length === 0 && !travel) {
        throw new Error("name a drawing: --tree, --from <shortcode> or --travel");
    }
    const { places } = world;

    // Every binary this run needs, found once and before anything is drawn,
    // so a missing one is reported before a directory is touched.
    const engines = new Set();
    if (tree) engines.add(engine);
    if (from.length || travel) engines.add("neato");
    /** @type {Map<string, string>} */
    const binaries = new Map();
    const findings = [];
    let skipped = false;
    for (const name of engines) {
        const binary = locate(name);
        if (binary) binaries.set(name, binary);
        else if (requireGraphviz) throw new Error(graphvizMissingMessage(name));
        else if (!skipped) {
            skipped = true;
            findings.push({
                file: outDir,
                severity: "warning",
                message: `${graphvizMissingMessage(name)}; the .dot files are written and the renderings skipped`,
            });
        }
    }

    fs.mkdirSync(outDir, { recursive: true });
    const written = [];
    const emit = (name, dot, engineName, args = []) => {
        const dotPath = path.join(outDir, `${name}.dot`);
        fs.writeFileSync(dotPath, dot);
        written.push(dotPath);
        const binary = binaries.get(engineName);
        if (!binary) return;
        const svgPath = path.join(outDir, `${name}.svg`);
        const { warnings } = renderDot(dotPath, svgPath, { binary, args });
        written.push(svgPath);
        if (warnings) {
            findings.push({ file: dotPath, severity: "warning", message: warnings });
        }
    };

    if (tree) {
        const analysis = analyzeContainment(places, world.polities);
        const common = {
            places,
            polities: world.polities,
            analysis,
            engine,
            rankdir,
            nodesep,
            ranksep,
            scale,
            drawPolities: polities,
        };
        if (root !== undefined) {
            emit(`tree-${root}`, treeDot({ ...common, root }), engine);
        } else {
            emit("tree", treeDot(common), engine);
            for (const continent of analysis.continents) {
                emit(`tree-${continent}`, treeDot({ ...common, root: continent }), engine);
            }
            findings.push(
                ...containmentFindings(analysis, places, {
                    contentBase: world.contentBase,
                    config: world.config,
                }),
            );
        }
    }

    const centres = from.includes(FROM_ALL) ? relatedPlaces(places) : from;
    for (const centre of centres) {
        const layout = layoutFrom(places, centre);
        for (const { from: place, to } of layout.unresolved) {
            findings.push({
                file: unresolvedFile(world, place),
                severity: "warning",
                message: `place "${place}" names "${to}" in a border or a route, and no place declares that shortcode; the map centred on "${centre}" leaves it out`,
            });
        }
        emit(`from-${centre}`, fromDot(layout, places, { scale }), "neato", ["-n2"]);
    }

    if (travel) {
        const graph = travelGraph(places);
        for (const { from: place, to } of graph.unresolved) {
            findings.push({
                file: unresolvedFile(world, place),
                severity: "warning",
                message: `place "${place}" names "${to}" in a border or a route, and no place declares that shortcode; the route graph leaves it out`,
            });
        }
        emit("travel", travelDot(graph, places, { scale }), "neato");
    }

    return { written, findings, skipped };
}

/**
 * The file a finding about a place's relation is reported against.
 *
 * @param {import("./map-places.mjs").MapWorld} world - The world.
 * @param {string} shortcode - The place.
 * @returns {string} The note, or the content root for a place with no file.
 */
function unresolvedFile(world, shortcode) {
    const place = world.places.get(shortcode);
    return place?.file ? path.join(world.contentBase, ...place.file.split("/")) : world.contentBase;
}
