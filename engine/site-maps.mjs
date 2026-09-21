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
 * The maps a site build writes into its place pages.
 *
 * A place that states, or is named in, a border or a route has a map from it
 * — the drawing `content-build map --from` makes — and the site build draws
 * that map for every such place of this package and hands each one to the
 * page writer, which lays it beside the page as `from-<shortcode>.svg` and
 * names it in the front matter as `map`. The theme inlines it, so its place
 * names are links to their pages: every drawing is made with the site's base,
 * and every `href` in it composes `<base><slug>/` the way every other href
 * the build renders does.
 *
 * GraphViz draws, and a site never fails for want of a map: when the engine is
 * absent the build says so once, as a warning, and writes every page as it
 * would without maps. `site.maps: false` says the site carries none and asks
 * nothing of GraphViz.
 *
 * The drawings land under `build/map/site/` — beside the author's own
 * drawings under `build/map/`, and apart from them, because the site's
 * carry links and the author's may not — and are copied from there into the
 * content mount. A build never mutates its inputs.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { buildMaps, relatedPlaces } from "./map-build.mjs";
import { GRAPHVIZ_INSTALL, findGraphviz } from "./map-graphviz.mjs";
import { mapWorld } from "./map-places.mjs";

/**
 * Where the site build draws, below the package root.
 *
 * @type {string}
 */
export const SITE_MAP_DIR = "build/map/site";

/**
 * The engine the map from a place is drawn with.
 *
 * @type {string}
 */
const ENGINE = "neato";

/**
 * A drawing as the page writer receives it.
 *
 * @typedef {object} SiteMap
 * @property {string} name - The file's name in the page's bundle, and the
 *   value of the page's `map` key: `from-<shortcode>.svg`.
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
 * Draw the map from every related place of this package.
 *
 * @param {object} opts
 * @param {Array<Record<string, any>>} opts.records - The package's index
 *   records, as the site build read them.
 * @param {Map<string, object>} opts.foreignIndex - The fetched indexes the
 *   site build resolved links against.
 * @param {object} opts.config - The resolved configuration.
 * @param {string} opts.base - The site base every page is served under,
 *   ending in a slash: what every name in a drawing links through.
 * @param {(engine: string) => string|undefined} [opts.locate] - How the
 *   engine's binary is found; the real lookup by default.
 * @returns {{maps: Map<string, SiteMap>, findings: Array<{file: string,
 *   line?: number, column?: number, severity: "error"|"warning",
 *   message: string}>}} The drawings, keyed by the URL of the page each
 *   belongs to, and what the drawing found — one warning naming what to
 *   install when GraphViz is absent, and a warning for each relation that
 *   names no place.
 */
export function drawSiteMaps({ records, foreignIndex, config, base, locate = findGraphviz }) {
    /** @type {Map<string, SiteMap>} */
    const maps = new Map();
    const outDir = path.join(config.rootDir, ...SITE_MAP_DIR.split("/"));
    // Every run draws afresh: a place that lost its relations must not keep
    // the map an earlier run drew.
    fs.rmSync(outDir, { recursive: true, force: true });

    if (!locate(ENGINE)) {
        return {
            maps,
            findings: [
                {
                    file: config.rootDir,
                    severity: "warning",
                    message:
                        `GraphViz's \`${ENGINE}\` is not installed, so no place page carries ` +
                        `the map from that place; ${GRAPHVIZ_INSTALL} to draw them, or set ` +
                        "`site.maps: false` to say the site carries none",
                },
            ],
        };
    }

    const world = mapWorld({
        records,
        foreignIndex,
        contentBase: config.paths.content,
        base,
        config,
    });
    // This package's related places, which are the ones with a page here to
    // carry a map. A dependency's place is drawn on those maps and gets none
    // of its own from this build.
    const centres = relatedPlaces(world.places).filter((s) => world.places.get(s)?.local);
    if (centres.length === 0) return { maps, findings: [] };

    const { findings } = buildMaps({ world, outDir, from: centres, locate });
    for (const centre of centres) {
        const place = world.places.get(centre);
        if (!place?.url) continue;
        const name = `from-${centre}.svg`;
        const file = path.join(outDir, name);
        fs.writeFileSync(file, inlineSvg(fs.readFileSync(file, "utf8")));
        maps.set(place.url, { name, file });
    }
    return { maps, findings };
}
