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
 * The maps a site build draws for its place pages.
 *
 * A place that states, or is named in, a border or a route is given a
 * **From here** section — see {@link module:engine/derived-sections} — naming
 * the drawing `package-build map --from` makes. The site build draws that map
 * for every such place and sets it inline in the section, so its place names
 * are links to their pages: every drawing is made with the site's base, and
 * every `href` in it composes `<base><slug>/` the way every other href the
 * build renders does.
 *
 * The npm Graphviz runtime draws each map. `site.maps: false` gives no place
 * the section, and nothing is drawn.
 *
 * The drawings land under `build/map/site/` — beside the author's own
 * drawings under `build/map/`, and apart from them, because the site's
 * carry links and the author's may not. A build never mutates its inputs.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { placesWithMaps } from "./derived-sections.mjs";
import { fromHereFile } from "./generated-sections.mjs";
import { buildMaps } from "./map-build.mjs";
import { mapWorld } from "./map-places.mjs";

/**
 * Where the site build draws, below the package root.
 *
 * @type {string}
 */
export const SITE_MAP_DIR = "build/map/site";

/**
 * A drawing as the page writer receives it.
 *
 * @typedef {object} SiteMap
 * @property {string} name - The file's name: `from-<shortcode>.svg`.
 * @property {string} file - Where the drawing is, absolute.
 */

/**
 * A GraphViz SVG rewritten for inlining in an HTML page.
 *
 * GraphViz writes a standalone document: an XML declaration, a DOCTYPE naming
 * the SVG 1.1 DTD by URL, generator comments, a root sized in points beside
 * its `viewBox`, and links through the `xlink` namespace. Inline in HTML the
 * prologue is invalid, the DTD reference is the one external reference the
 * drawing would carry, the fixed size fights the column it sits in, and
 * `xlink:` is the pre-SVG-2 spelling. So the prologue and the comments go,
 * the root keeps its `viewBox` and loses `width` and `height`, and
 * `xlink:href` and `xlink:title` become `href` and `title`, with the
 * namespace declaration they needed.
 *
 * @param {string} svg - The SVG as GraphViz wrote it.
 * @returns {string} The SVG to inline, starting at `<svg`.
 */
export function inlineSvg(svg) {
    const start = svg.indexOf("<svg");
    let out = start < 0 ? svg : svg.slice(start);
    out = out.replace(/<!--[\s\S]*?-->\n?/g, "");
    out = out.replace(/^<svg[^>]*>/, (root) =>
        root
            .replace(/\s+(width|height)="[^"]*"/g, "")
            .replace(/\s+xmlns:xlink="[^"]*"/, "")
            .replace(/^<svg\s+/, "<svg "),
    );
    return out.replace(/\bxlink:(href|title)=/g, "$1=");
}

/**
 * Draw the map from every place of this package that is given one.
 *
 * @param {object} opts
 * @param {Array<Record<string, any>>} opts.records - The package's index
 *   records, as the site build read them.
 * @param {Map<string, object>} opts.foreignIndex - The fetched indexes the
 *   site build resolved links against.
 * @param {object} opts.config - The resolved configuration.
 * @param {string} opts.base - The site base every page is served under,
 *   ending in a slash: what every name in a drawing links through.
 * @returns {{maps: Map<string, SiteMap>, findings: Array<{file: string,
 *   line?: number, column?: number, severity: "error"|"warning",
 *   message: string}>}} The drawings, keyed by the file name a **From here**
 *   section names, and warnings for relations that name no place.
 */
export function drawSiteMaps({ records, foreignIndex, config, base }) {
    /** @type {Map<string, SiteMap>} */
    const maps = new Map();
    const outDir = path.join(config.rootDir, ...SITE_MAP_DIR.split("/"));
    // Every run draws afresh: a place that lost its relations must not keep
    // the map an earlier run drew.
    fs.rmSync(outDir, { recursive: true, force: true });

    const centres = placesWithMaps(records, { foreignIndex, config });
    if (centres.length === 0) return { maps, findings: [] };
    const world = mapWorld({
        records,
        foreignIndex,
        contentBase: config.paths.content,
        base,
        config,
    });
    const { findings } = buildMaps({ world, outDir, from: centres });
    for (const centre of centres) {
        const name = fromHereFile(centre);
        const file = path.join(outDir, name);
        fs.writeFileSync(file, inlineSvg(fs.readFileSync(file, "utf8")));
        maps.set(name, { name, file });
    }
    return { maps, findings };
}

/**
 * The figure the website sets a drawing in: the SVG inline, so its place names
 * stay links, with no blank line inside it — a blank line would end the HTML
 * block and hand the rest of the drawing to the Markdown renderer.
 *
 * @param {string} svg - The drawing, as {@link inlineSvg} wrote it.
 * @param {string} alt - What the drawing shows, for a screen reader.
 * @returns {string} One HTML block.
 */
export function inlineDrawingFigure(svg, alt) {
    const label = String(alt ?? "").replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    const body = String(svg)
        .split("\n")
        .filter((line) => line.trim() !== "")
        .join("\n");
    return (
        `<figure class="note-image note-image-full-width" role="img" ` +
        `aria-label="${label}">\n${body}\n</figure>`
    );
}
