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
 * The drawings of `content-build map`, as DOT.
 *
 * Every drawing is emitted as DOT text and kept beside its rendering, so a
 * picture can be re-rendered, diffed or read without the content index.
 * The drawings share one style table: **shape, colour and size are by
 * `subType`**, in one place, so the containment tree, the map from a place,
 * the chart from one, the route graph and the legend all follow an edit to a
 * row. An anomaly
 * overrides fill and border colour only, so what kind of place a node is and
 * whether something is wrong with it read as two separate questions.
 *
 * Every node's label is the place's `name.full`, its tooltip the canonical
 * address, and — where the place carries a URL — its `URL`, which GraphViz
 * renders as an `<a href>` around the name so a page can inline the SVG and
 * every name is a link.
 *
 * @module
 */

import { subtreeOf } from "./map-places.mjs";

/* --------------------------------------------------------------------- */
/*  Style                                                                 */
/* --------------------------------------------------------------------- */

/** The fill of a place with no parent, or of a placeholder for a parent that resolves to nothing. */
const RED_FILL = "#EF5350";
/** The border of a place on a cycle. */
const RED_BORDER = "#B71C1C";
const DEFAULT_BORDER = "#37474F";
const POLITY_BORDER = "#616161";
/** The colour of a ring, and of anything two hops out. */
const FAINT = "#B0BEC5";
const DIM = "#78909C";
/** The fill of a place two or more hops out. */
const DIM_FILL = "#ECEFF1";

/**
 * How much of the second hop's dimness a further hop keeps: each hop beyond
 * the second steps down by this much.
 */
const HOP_FADE_STEP = 0.25;

/** The least a place may fade to, so the farthest hop still reads. */
const HOP_FADE_FLOOR = 0.5;

/**
 * The opacity of a place by its hop count: the neighbours and the second hop
 * are drawn full — the second in the dim palette — and each hop beyond
 * steps down, never below the floor.
 *
 * @param {number} hop - 1 for a neighbour, 2 and up beyond.
 * @returns {number} 0 to 1.
 */
export function hopOpacity(hop) {
    return Math.max(HOP_FADE_FLOOR, 1 - HOP_FADE_STEP * Math.max(0, hop - 2));
}

/**
 * A colour at an opacity, as DOT reads it: `#RRGGBB` at full, `#RRGGBBAA`
 * otherwise.
 *
 * @param {string} colour - `#RRGGBB`.
 * @param {number} opacity - 0 to 1.
 * @returns {string} The colour.
 */
function faded(colour, opacity) {
    if (opacity >= 1) return colour;
    const alpha = Math.round(Math.max(0, opacity) * 255)
        .toString(16)
        .padStart(2, "0")
        .toUpperCase();
    return `${colour}${alpha}`;
}

/**
 * One row of the style table.
 *
 * @typedef {object} NodeStyle
 * @property {string} shape
 * @property {string} fill
 * @property {string} border
 * @property {number} fontsize
 * @property {number} width - Inches, a minimum: a long label still grows the node.
 * @property {number} height - Inches.
 * @property {number} penwidth
 * @property {string} extraStyle - `rounded`, `dashed`, or none.
 */

/**
 * Shape, colour and size by `subType`, plus the synthetic `polity` row for
 * the affiliation notes drawn beside their regions. The world is largest;
 * regions large with a bold label; settlements small with a thin border;
 * site, feature and structure between.
 *
 * @type {Readonly<Record<string, NodeStyle>>}
 */
export const STYLE = Object.freeze({
    world: {
        shape: "doublecircle",
        fill: "#FFE082",
        border: DEFAULT_BORDER,
        fontsize: 16,
        width: 1.3,
        height: 1.3,
        penwidth: 2.5,
        extraStyle: "",
    },
    region: {
        shape: "box",
        fill: "#90CAF9",
        border: DEFAULT_BORDER,
        fontsize: 14,
        width: 1.3,
        height: 0.55,
        penwidth: 2.0,
        extraStyle: "rounded",
    },
    settlement: {
        shape: "ellipse",
        fill: "#A5D6A7",
        border: DEFAULT_BORDER,
        fontsize: 8,
        width: 0.55,
        height: 0.3,
        penwidth: 1.0,
        extraStyle: "",
    },
    site: {
        shape: "diamond",
        fill: "#CE93D8",
        border: DEFAULT_BORDER,
        fontsize: 10,
        width: 0.9,
        height: 0.55,
        penwidth: 1.2,
        extraStyle: "",
    },
    feature: {
        shape: "hexagon",
        fill: "#80CBC4",
        border: DEFAULT_BORDER,
        fontsize: 10,
        width: 0.9,
        height: 0.45,
        penwidth: 1.2,
        extraStyle: "",
    },
    structure: {
        shape: "house",
        fill: "#FFAB91",
        border: DEFAULT_BORDER,
        fontsize: 10,
        width: 0.9,
        height: 0.55,
        penwidth: 1.2,
        extraStyle: "",
    },
    polity: {
        shape: "cylinder",
        fill: "#E0E0E0",
        border: POLITY_BORDER,
        fontsize: 9,
        width: 0.8,
        height: 0.45,
        penwidth: 1.0,
        extraStyle: "dashed",
    },
});

/** What each style row means, for the legend. */
const LEGEND = Object.freeze([
    ["world", "the root note"],
    ["region", "continent, region, sub-region"],
    ["settlement", "city, town, village"],
    ["site", "ruin, landmark, dungeon, wonder"],
    ["feature", "river, mountain range, sea"],
    ["structure", "a single building"],
    ["polity", "affiliation, dashed edge to its region"],
]);

/**
 * A DOT double-quoted string.
 *
 * @param {unknown} value - The text.
 * @returns {string} Quoted and escaped, newlines folded to spaces.
 */
export function dotString(value) {
    return (
        '"' +
        String(value ?? "")
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\n/g, " ") +
        '"'
    );
}

/**
 * A DOT string whose `\n` line breaks are kept as GraphViz line breaks.
 *
 * @param {string[]} lines - The label's lines.
 * @returns {string} Quoted.
 */
function dotLines(lines) {
    return '"' + lines.map((l) => dotString(l).slice(1, -1)).join("\\n") + '"';
}

/**
 * A node id safe for DOT: a prefix and the shortcode, which is an address
 * segment and so already a safe identifier.
 *
 * @param {string} prefix - `p` for a place, `a` for a polity.
 * @param {string} shortcode - The note's shortcode.
 * @returns {string} The id.
 */
function nodeId(prefix, shortcode) {
    return `${prefix}_${shortcode}`;
}

/**
 * A place's or a polity's `[...]` attribute block from its style row.
 *
 * @param {string} key - A row of {@link STYLE}.
 * @param {object} opts
 * @param {number} opts.scale - Multiplies every size.
 * @param {string} opts.label
 * @param {string} opts.tooltip
 * @param {string} [opts.url]
 * @param {string} [opts.fill] - Overrides the row's fill.
 * @param {string} [opts.border] - Overrides the row's border.
 * @param {number} [opts.extraPenwidth]
 * @param {string} [opts.fontcolor]
 * @param {string} [opts.extra] - Further attributes, verbatim.
 * @returns {string} The block.
 */
function styleAttrs(
    key,
    { scale, label, tooltip, url, fill, border, extraPenwidth = 0, fontcolor, extra },
) {
    const row = STYLE[key] ?? STYLE.settlement;
    const fontsize = Math.max(6, Math.round(row.fontsize * scale));
    const width = Math.max(0.1, row.width * scale);
    const height = Math.max(0.1, row.height * scale);
    const penwidth = Math.max(0.5, row.penwidth * scale + extraPenwidth);
    const style = [row.extraStyle, "filled"].filter(Boolean).join(",");
    return (
        `[label=${dotString(label)}, shape=${row.shape}, style=${dotString(style)}, ` +
        `fillcolor=${dotString(fill ?? row.fill)}, color=${dotString(border ?? row.border)}, ` +
        `fontsize=${fontsize}, width=${width.toFixed(2)}, height=${height.toFixed(2)}, ` +
        `penwidth=${penwidth.toFixed(2)}, tooltip=${dotString(tooltip)}` +
        (fontcolor ? `, fontcolor=${dotString(fontcolor)}` : "") +
        (url ? `, URL=${dotString(url)}` : "") +
        (extra ? `, ${extra}` : "") +
        "]"
    );
}

/**
 * The legend, drawn from real styled nodes — same table, same scale — so
 * shape and relative size are shown rather than described.
 *
 * @param {string[]} lines - The DOT being assembled.
 * @param {number} scale - The drawing's scale.
 * @returns {void}
 */
function emitLegend(lines, scale) {
    lines.push("  subgraph cluster_legend {");
    lines.push(
        '    label="Legend"; style="rounded"; color="#B0BEC5"; fontsize=12; fontname="Helvetica-Bold";',
    );
    const ids = [];
    for (const [key, meaning] of LEGEND) {
        const id = `legend_${key}`;
        ids.push(id);
        lines.push(`    ${id} ${styleAttrs(key, { scale, label: key, tooltip: meaning })};`);
    }
    ids.push("legend_noparent");
    lines.push(
        `    legend_noparent ${styleAttrs("site", {
            scale,
            label: "no parent / unresolved",
            tooltip:
                "a place with no parent, or a placeholder for a parent shortcode that does not resolve",
            fill: RED_FILL,
            border: RED_BORDER,
        })};`,
    );
    ids.push("legend_cycle");
    lines.push(
        `    legend_cycle ${styleAttrs("site", {
            scale,
            label: "cycle",
            tooltip: "this place sits on a cycle in the parents graph",
            border: RED_BORDER,
            extraPenwidth: 2.0 * scale,
        })};`,
    );
    lines.push(`    ${ids.join(" -> ")} [style=invis];`);
    lines.push("  }");
}

/* --------------------------------------------------------------------- */
/*  The containment tree                                                  */
/* --------------------------------------------------------------------- */

/**
 * A place node of the tree, styled by `subType` and highlighted by anomaly.
 *
 * @param {import("./map-places.mjs").MapPlace} place - The place.
 * @param {import("./map-places.mjs").Containment} analysis - For the cycles.
 * @param {number} scale - The drawing's scale.
 * @returns {string} The attribute block.
 */
function placeAttrs(place, analysis, scale) {
    const onCycle = analysis.cycleNodes.has(place.shortcode);
    const noParent = place.parents.length === 0 && place.shortcode !== analysis.world;
    return styleAttrs(place.subType ?? "settlement", {
        scale,
        label: place.name,
        tooltip: place.address ?? place.shortcode,
        url: place.url,
        fill: noParent ? RED_FILL : undefined,
        border: onCycle ? RED_BORDER : undefined,
        extraPenwidth: onCycle ? 2.0 * scale : 0,
    });
}

/**
 * The placeholder standing in for a parent shortcode no place declares.
 *
 * @param {string} shortcode - The unresolved shortcode.
 * @param {Set<string>} referrers - The places naming it.
 * @param {number} scale - The drawing's scale.
 * @returns {string} The attribute block.
 */
function placeholderAttrs(shortcode, referrers, scale) {
    const tooltip = `unresolved shortcode "${shortcode}", named by: ${[...referrers].sort().join(", ")}`;
    return (
        `[label=${dotString(shortcode)}, shape=octagon, style=filled, fillcolor=${dotString(RED_FILL)}, ` +
        `color=${dotString(RED_BORDER)}, fontsize=${Math.max(6, Math.round(9 * scale))}, ` +
        `width=${Math.max(0.1, 0.8 * scale).toFixed(2)}, height=${Math.max(0.1, 0.4 * scale).toFixed(2)}, ` +
        `penwidth=${Math.max(0.5, 1.2 * scale).toFixed(2)}, tooltip=${dotString(tooltip)}]`
    );
}

/**
 * The containment tree as DOT.
 *
 * With no `root`, every place, clustered by continent — a region parented
 * directly on the world — and the places reaching no continent floating
 * outside every cluster. With a `root`, the subtree beneath that place, in
 * one cluster, the world drawn beside it only when the root is the world or
 * a continent. Edges run child → parent, as `parents` states them. A polity
 * is drawn dashed beside every region note in its directory, unless
 * `polities` is false.
 *
 * @param {object} opts
 * @param {Map<string, import("./map-places.mjs").MapPlace>} opts.places
 * @param {import("./map-places.mjs").MapPolity[]} [opts.polities]
 * @param {import("./map-places.mjs").Containment} opts.analysis
 * @param {string} [opts.root] - Draw the subtree beneath this place.
 * @param {string} [opts.title] - The drawing's title, defaulting to the
 *   world's or the root's name.
 * @param {string} [opts.engine="dot"] - `dot`, `twopi` or `neato`.
 * @param {string} [opts.rankdir="TB"] - `dot` only.
 * @param {number} [opts.nodesep] - Inches; defaults by scale.
 * @param {number} [opts.ranksep] - Inches; defaults by engine and scale.
 * @param {number} [opts.scale=1] - Multiplies every size.
 * @param {boolean} [opts.drawPolities=true] - Whether to draw the polities.
 * @returns {string} The DOT text.
 */
export function treeDot({
    places,
    polities = [],
    analysis,
    root,
    title,
    engine = "dot",
    rankdir = "TB",
    nodesep,
    ranksep,
    scale = 1,
    drawPolities = true,
}) {
    const world = analysis.world;
    let included;
    let scopeLabel;
    let worldIsContext = false;
    if (root !== undefined) {
        if (!places.has(root)) {
            throw new Error(`"${root}" is not a place in this package or a fetched index`);
        }
        included = subtreeOf(analysis, root);
        worldIsContext = Boolean(
            world && (root === world || places.get(root)?.parents.includes(world)),
        );
        if (worldIsContext && world) included.add(world);
        scopeLabel = places.get(root)?.name ?? root;
    } else {
        included = new Set(places.keys());
    }
    const byName = (a, b) =>
        String(places.get(a)?.name ?? a).localeCompare(String(places.get(b)?.name ?? b));

    const lines = [];
    lines.push("digraph tree {");
    if (engine === "dot") {
        lines.push(`  rankdir=${rankdir};`);
        lines.push("  splines=ortho;");
    } else {
        lines.push("  overlap=false;");
    }
    const defaultRanksep = engine === "twopi" ? 1.0 : 0.5;
    lines.push(`  nodesep=${(nodesep ?? 0.25 * scale).toFixed(2)};`);
    lines.push(`  ranksep=${(ranksep ?? defaultRanksep * scale).toFixed(2)};`);
    if (engine === "twopi") {
        const centre = root ?? world;
        if (centre && places.has(centre)) lines.push(`  root=${dotString(nodeId("p", centre))};`);
    }
    lines.push('  graph [fontname="Helvetica"];');
    lines.push('  node [fontname="Helvetica"];');
    lines.push('  edge [fontname="Helvetica", fontsize=8];');
    const heading =
        title ??
        `${scopeLabel ?? (world ? places.get(world)?.name : "The world")} — containment tree`;
    lines.push(`  label=${dotString(heading)};`);
    lines.push('  labelloc=t; fontsize=18; fontname="Helvetica-Bold";');
    lines.push("");
    emitLegend(lines, scale);
    lines.push("");

    const cluster = (id, label) => {
        lines.push(`  subgraph ${dotString(`cluster_${id}`)} {`);
        lines.push(`    label=${dotString(label)};`);
        lines.push('    style="rounded"; color="#B0BEC5"; fontsize=12; fontname="Helvetica-Bold";');
    };

    if (root === undefined) {
        /** @type {Map<string, string[]>} */
        const byContinent = new Map();
        const unclustered = [];
        for (const sc of [...included].sort()) {
            const c = analysis.continentOf.get(sc);
            if (c === undefined) unclustered.push(sc);
            else byContinent.set(c, [...(byContinent.get(c) ?? []), sc]);
        }
        for (const c of [...byContinent.keys()].sort(byName)) {
            cluster(c, places.get(c)?.name ?? c);
            for (const sc of /** @type {string[]} */ (byContinent.get(c)).sort(byName)) {
                lines.push(
                    `    ${nodeId("p", sc)} ${placeAttrs(/** @type {any} */ (places.get(sc)), analysis, scale)};`,
                );
            }
            lines.push("  }");
        }
        lines.push("");
        for (const sc of unclustered.sort(byName)) {
            lines.push(
                `  ${nodeId("p", sc)} ${placeAttrs(/** @type {any} */ (places.get(sc)), analysis, scale)};`,
            );
        }
    } else {
        cluster(root, /** @type {string} */ (scopeLabel));
        for (const sc of [...included].sort(byName)) {
            if (sc === world && world !== root) continue;
            lines.push(
                `    ${nodeId("p", sc)} ${placeAttrs(/** @type {any} */ (places.get(sc)), analysis, scale)};`,
            );
        }
        lines.push("  }");
        if (worldIsContext && world && world !== root) {
            lines.push(
                `  ${nodeId("p", world)} ${placeAttrs(/** @type {any} */ (places.get(world)), analysis, scale)};`,
            );
        }
    }
    lines.push("");

    /** @type {Map<string, Set<string>>} */
    const placeholders = new Map();
    const edges = [];
    for (const sc of [...included].sort()) {
        const place = places.get(sc);
        if (!place) continue;
        for (const parent of place.parents) {
            if (places.has(parent)) {
                if (root !== undefined && !included.has(parent)) continue;
                edges.push(`${nodeId("p", sc)} -> ${nodeId("p", parent)}`);
            } else {
                const set = placeholders.get(parent) ?? new Set();
                set.add(sc);
                placeholders.set(parent, set);
                edges.push(`${nodeId("p", sc)} -> ${nodeId("missing", parent)}`);
            }
        }
    }
    for (const [parent, referrers] of [...placeholders].sort()) {
        lines.push(`  ${nodeId("missing", parent)} ${placeholderAttrs(parent, referrers, scale)};`);
    }
    lines.push("");
    for (const edge of edges) lines.push(`  ${edge};`);
    lines.push("");

    if (drawPolities) {
        /** @type {Map<string, string[]>} */
        const includedRegionsByFolder = new Map();
        for (const sc of included) {
            const place = places.get(sc);
            if (!place?.local || place.subType !== "region") continue;
            const folder = place.folder ?? "";
            includedRegionsByFolder.set(folder, [
                ...(includedRegionsByFolder.get(folder) ?? []),
                sc,
            ]);
        }
        for (const polity of polities) {
            const regions = includedRegionsByFolder.get(polity.folder) ?? [];
            if (regions.length === 0) continue;
            const id = nodeId("a", polity.shortcode);
            lines.push(
                `  ${id} ${styleAttrs("polity", {
                    scale,
                    label: polity.name,
                    tooltip: polity.address ?? polity.shortcode,
                    url: polity.url,
                })};`,
            );
            for (const region of regions) {
                lines.push(
                    `  ${id} -> ${nodeId("p", region)} [style=dashed, arrowhead=none, color=${dotString(POLITY_BORDER)}];`,
                );
            }
        }
    }
    lines.push("}");
    return lines.join("\n") + "\n";
}

/* --------------------------------------------------------------------- */
/*  The map from a place, and the chart                                   */
/* --------------------------------------------------------------------- */

/**
 * An edge's label: the bearing, and the days of every route that reaches
 * the far end.
 *
 * @param {import("./map-layout.mjs").FromEdge|import("./map-layout.mjs").TravelEdge} edge
 * @returns {string} `E · 5 d`, `E · 5 d land, 3 d ship`, or `E` for a border.
 */
function edgeLabel(edge) {
    const routes = "routes" in edge ? edge.routes : [];
    const days = (d) => (d === undefined ? "?" : `${d} d`);
    if (routes.length > 1) {
        return `${edge.bearing} · ${routes.map((r) => `${days(r.days)} ${r.mode}`).join(", ")}`;
    }
    if (edge.kind === "route") return `${edge.bearing} · ${days(edge.days)}`;
    return edge.bearing;
}

/**
 * The map from a place, or the chart from one, as DOT for `neato -n2`.
 *
 * Every node is pinned at the position the layout computed, so the engine
 * only draws. The rings are circles pinned at the origin, drawn faintly,
 * each labelled with its days marker at the top; the rim is one more,
 * labelled `beyond` where the layout names what lies past the horizon there
 * and `unknown` where it holds only the places whose days nobody stated.
 * The centre is drawn in its `subType` style at full size, a neighbour at
 * the layout's scale, a second hop dimmer, and each hop beyond fainter
 * still, down to a floor. A place at the rim is a name, its label carrying
 * its days or `?`. A border edge is dashed; every edge is labelled with its
 * bearing and days, and dimmed with its far end.
 *
 * @param {import("./map-layout.mjs").FromLayout} layout - The layout.
 * @param {Map<string, import("./map-places.mjs").MapPlace>} places - Every place.
 * @param {object} [opts]
 * @param {number} [opts.scale=1] - Multiplies every size.
 * @param {string} [opts.title] - Defaults to `From <name>`, or to
 *   `Chart from <name>` for a layout with no rim beyond the horizon.
 * @returns {string} The DOT text.
 */
export function fromDot(layout, places, { scale = 1, title } = {}) {
    const centre = places.get(layout.centre);
    const name = centre?.name ?? layout.centre;
    const lines = [];
    lines.push("digraph from {");
    lines.push("  splines=false; overlap=true; outputorder=nodesfirst;");
    lines.push('  graph [fontname="Helvetica"];');
    lines.push('  node [fontname="Helvetica"];');
    lines.push(`  edge [fontname="Helvetica", fontsize=${Math.max(6, Math.round(8 * scale))}];`);
    lines.push(
        `  label=${dotString(title ?? (layout.beyond ? `From ${name}` : `Chart from ${name}`))};`,
    );
    lines.push('  labelloc=t; fontsize=18; fontname="Helvetica-Bold";');
    lines.push("");

    // The rings, innermost first so a larger one never hides a smaller.
    const ringNode = (id, radius, label) => {
        const inches = ((2 * radius) / 72).toFixed(3);
        lines.push(
            `  ${id} [label="", shape=circle, fixedsize=true, width=${inches}, height=${inches}, ` +
                `pos="0,0!", color=${dotString(FAINT)}, penwidth=0.6, style=dashed, ` +
                `tooltip=${dotString(label)}];`,
        );
    };
    for (const ring of layout.rings) {
        ringNode(`ring_${ring.days}`, ring.radius, `${ring.days} days`);
        lines.push(
            `  ringlabel_${ring.days} [label=${dotString(`${ring.days} d`)}, shape=plaintext, ` +
                `fontsize=${Math.max(6, Math.round(7 * scale))}, fontcolor=${dotString(DIM)}, ` +
                `pos="0,${(ring.radius + 6).toFixed(1)}!", width=0, height=0, margin=0];`,
        );
    }
    ringNode(
        "rim",
        layout.rim,
        layout.beyond ? "beyond the horizon, or days unknown" : "days unknown",
    );
    lines.push(
        `  rimlabel [label=${dotString(layout.beyond ? "beyond" : "unknown")}, shape=plaintext, ` +
            `fontsize=${Math.max(6, Math.round(7 * scale))}, fontcolor=${dotString(DIM)}, ` +
            `pos="0,${(layout.rim + 6).toFixed(1)}!", width=0, height=0, margin=0];`,
    );
    lines.push("");

    for (const node of layout.nodes) {
        const place = places.get(node.shortcode);
        if (!place) continue;
        const pos = `pos="${node.x.toFixed(1)},${node.y.toFixed(1)}!"`;
        const id = nodeId("p", node.shortcode);
        const opacity = hopOpacity(node.hop);
        const atRim = node.unknown || node.radius >= layout.rim;
        if (atRim) {
            const label = dotLines([place.name, node.days === undefined ? "?" : `${node.days} d`]);
            lines.push(
                `  ${id} [label=${label}, shape=plaintext, fontsize=${Math.max(6, Math.round(9 * scale))}, ` +
                    `fontcolor=${dotString(faded(DIM, opacity))}, tooltip=${dotString(place.address ?? place.shortcode)}` +
                    (place.url ? `, URL=${dotString(place.url)}` : "") +
                    `, ${pos}];`,
            );
            continue;
        }
        const nodeScale = node.hop === 0 ? scale : scale * 0.8;
        const dim = node.hop >= 2;
        lines.push(
            `  ${id} ${styleAttrs(place.subType ?? "settlement", {
                scale: nodeScale,
                label: place.name,
                tooltip: place.address ?? place.shortcode,
                url: place.url,
                border: dim ? faded(DIM, opacity) : undefined,
                fontcolor: dim ? faded(DIM, opacity) : undefined,
                extra: pos + (dim ? `, fillcolor=${dotString(faded(DIM_FILL, opacity))}` : ""),
            })};`,
        );
    }
    lines.push("");

    for (const edge of layout.edges) {
        const attrs = [`label=${dotString(edgeLabel(edge))}`, "arrowhead=none"];
        if (edge.kind === "border") attrs.push("style=dashed");
        if (edge.hop >= 2) {
            const opacity = hopOpacity(edge.hop);
            attrs.push(
                `color=${dotString(faded(FAINT, opacity))}`,
                `fontcolor=${dotString(faded(DIM, opacity))}`,
            );
        } else attrs.push(`color=${dotString(DEFAULT_BORDER)}`);
        lines.push(`  ${nodeId("p", edge.from)} -> ${nodeId("p", edge.to)} [${attrs.join(", ")}];`);
    }
    lines.push("}");
    return lines.join("\n") + "\n";
}

/* --------------------------------------------------------------------- */
/*  The whole route graph                                                 */
/* --------------------------------------------------------------------- */

/**
 * The whole route graph as DOT, for `neato`.
 *
 * Undirected, one edge per pair, each asking the engine for a length from
 * its days; the engine solves the positions. A border is dashed. Every node
 * that takes part in a relation is drawn in its `subType` style.
 *
 * @param {ReturnType<typeof import("./map-layout.mjs").travelGraph>} graph - The graph.
 * @param {Map<string, import("./map-places.mjs").MapPlace>} places - Every place.
 * @param {object} [opts]
 * @param {number} [opts.scale=1] - Multiplies every size.
 * @param {string} [opts.title] - Defaults to `Routes`.
 * @returns {string} The DOT text.
 */
export function travelDot(graph, places, { scale = 1, title } = {}) {
    const lines = [];
    lines.push("graph travel {");
    lines.push("  overlap=false; splines=true;");
    lines.push('  graph [fontname="Helvetica"];');
    lines.push('  node [fontname="Helvetica"];');
    lines.push(`  edge [fontname="Helvetica", fontsize=${Math.max(6, Math.round(8 * scale))}];`);
    lines.push(`  label=${dotString(title ?? "Routes")};`);
    lines.push('  labelloc=t; fontsize=18; fontname="Helvetica-Bold";');
    lines.push("");

    const involved = new Set();
    for (const edge of graph.edges) {
        involved.add(edge.from);
        involved.add(edge.to);
    }
    for (const sc of [...involved].sort()) {
        const place = places.get(sc);
        if (!place) continue;
        lines.push(
            `  ${nodeId("p", sc)} ${styleAttrs(place.subType ?? "settlement", {
                scale: scale * 0.8,
                label: place.name,
                tooltip: place.address ?? place.shortcode,
                url: place.url,
            })};`,
        );
    }
    lines.push("");
    for (const edge of graph.edges) {
        const attrs = [`len=${edge.len.toFixed(3)}`, `label=${dotString(edgeLabel(edge))}`];
        if (edge.kind === "border") attrs.push("style=dashed");
        attrs.push(`color=${dotString(DEFAULT_BORDER)}`);
        lines.push(`  ${nodeId("p", edge.from)} -- ${nodeId("p", edge.to)} [${attrs.join(", ")}];`);
    }
    lines.push("}");
    return lines.join("\n") + "\n";
}
