/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `content-build map` draws what the place notes state, reading the content
 * index rather than the notes: the containment tree from `parents`, the map
 * from each place from `borders` and `routes`, and the whole route graph.
 *
 * The fixture is one content tree with everything the tree mode has to
 * notice — a place with no parent, an unresolved parent, a cycle, a place with
 * two parents, a region with no `packFolder`, a polity beside no region — and
 * a centre with borders and routes at every hop the from-mode draws. GraphViz
 * is required for the rendering cases and stubbed away for the case that
 * proves its absence is reported plainly.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { indexRecordsFor } from "../engine/content-index.mjs";
import { findGraphviz, GRAPHVIZ_ENGINES } from "../engine/map-graphviz.mjs";
import {
    analyzeContainment,
    containmentFindings,
    loadMapWorld,
    placesFromRecords,
} from "../engine/map-places.mjs";
import { fromDot, travelDot, treeDot } from "../engine/map-dot.mjs";
import { buildMaps } from "../engine/map-build.mjs";
import { layoutFrom, travelGraph } from "../engine/map-layout.mjs";

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(PKG_ROOT, "bin", "content-build.mjs");

/** Whether GraphViz is reachable, which the rendering cases need. */
const DOT = findGraphviz("dot");

/* ---------------------------------------------------------------------- */
/*  Fixture                                                               */
/* ---------------------------------------------------------------------- */

type Relation = Record<string, unknown>;

function flow(entry: Relation): string {
    return `{ ${Object.entries(entry)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ")} }`;
}

function note(
    type: string,
    subType: string,
    shortcode: string,
    name: string,
    {
        parents,
        borders,
        routes,
        packFolder,
    }: { parents?: string[]; borders?: Relation[]; routes?: Relation[]; packFolder?: string } = {},
): string {
    const lines = [
        "---",
        `type: ${type}`,
        `subType: ${subType}`,
        `shortcode: ${shortcode}`,
        "name:",
        `  full: ${name}`,
    ];
    if (packFolder) lines.push(`packFolder: ${packFolder}`);
    if (type === "place") {
        lines.push("data:");
        if (parents) lines.push(`  parents: [${parents.join(", ")}]`);
        if (borders) {
            lines.push("  borders:");
            for (const b of borders) lines.push(`    - ${flow(b)}`);
        }
        if (routes) {
            lines.push("  routes:");
            for (const r of routes) lines.push(`    - ${flow(r)}`);
        }
    }
    lines.push("---", "", `${name}.`, "");
    return lines.join("\n");
}

/**
 * The fixture tree. Shortcodes are the names in lower case, so an assertion
 * can name a place once.
 */
const FILES: Record<string, string> = {
    "Lore/World.md": note("place", "world", "world", "The World"),
    "Regions/North/North.md": note("place", "region", "northc", "North Continent", {
        parents: ["world"],
        packFolder: "north",
    }),
    "Regions/South/South.md": note("place", "region", "southc", "South Continent", {
        parents: ["world"],
        packFolder: "south",
    }),
    "Regions/North/Alpha/Alpha.md": note("place", "region", "alpha", "Alpha", {
        parents: ["northc"],
        packFolder: "alpha",
        borders: [
            { to: "beta", bearing: "E" },
            { to: "gamma", bearing: "N" },
            { to: "delta", bearing: "S" },
        ],
        routes: [
            { to: "porta", bearing: "NE", mode: "land", days: 1 },
            { to: "portb", bearing: "E", mode: "land", days: 5 },
            { to: "farx", bearing: "S", mode: "ship", days: 30 },
        ],
    }),
    "Regions/North/Alpha/Kingdom_of_Alpha.md": note(
        "affiliation",
        "polity",
        "kingalpha",
        "Kingdom of Alpha",
    ),
    "Regions/North/Beta/Beta.md": note("place", "region", "beta", "Beta", {
        parents: ["northc"],
        packFolder: "beta",
        borders: [
            { to: "alpha", bearing: "W" },
            { to: "theta", bearing: "SE" },
        ],
    }),
    "Regions/North/Gamma/Gamma.md": note("place", "region", "gamma", "Gamma", {
        parents: ["northc"],
        borders: [{ to: "alpha", bearing: "S" }],
        routes: [{ to: "alpha", bearing: "S", mode: "land", days: 2 }],
    }),
    "Regions/South/Delta/Delta.md": note("place", "region", "delta", "Delta", {
        parents: ["southc", "northc"],
        packFolder: "delta",
    }),
    "Regions/South/Theta/Theta.md": note("place", "region", "theta", "Theta", {
        parents: ["southc"],
        packFolder: "theta",
        borders: [{ to: "beta", bearing: "NW" }],
    }),
    "Regions/North/Alpha/Porta.md": note("place", "settlement", "porta", "Porta", {
        parents: ["alpha"],
        routes: [{ to: "alpha", bearing: "SW", mode: "land", days: 1 }],
    }),
    "Regions/North/Beta/Portb.md": note("place", "settlement", "portb", "Portb", {
        parents: ["beta"],
        routes: [
            { to: "alpha", bearing: "W", mode: "land", days: 5 },
            { to: "omega", bearing: "E", mode: "land", days: 10 },
            { to: "eta", bearing: "NE", mode: "land", days: 5 },
            { to: "zeta", bearing: "W", mode: "land", days: 3 },
        ],
    }),
    "Regions/South/Delta/Farx.md": note("place", "settlement", "farx", "Farx", {
        parents: ["delta"],
        routes: [{ to: "alpha", bearing: "N", mode: "ship", days: 30 }],
    }),
    "Regions/North/Beta/Omega.md": note("place", "settlement", "omega", "Omega", {
        parents: ["beta"],
    }),
    "Regions/North/Beta/Eta.md": note("place", "settlement", "eta", "Eta", {
        parents: ["beta"],
    }),
    "Regions/North/Beta/Zeta.md": note("place", "settlement", "zeta", "Zeta", {
        parents: ["beta"],
    }),
    "Regions/Lost.md": note("place", "site", "lost", "Lost", { parents: ["nowhere"] }),
    "Regions/Orphan.md": note("place", "site", "orphan", "Orphan"),
    "Regions/Loop_A.md": note("place", "feature", "loopa", "Loop A", { parents: ["loopb"] }),
    "Regions/Loop_B.md": note("place", "feature", "loopb", "Loop B", { parents: ["loopa"] }),
    "Peoples/Kingdom_of_Nowhere.md": note(
        "affiliation",
        "polity",
        "kingnone",
        "Kingdom of Nowhere",
    ),
};

/** Every place shortcode the fixture declares. */
const PLACES = Object.values(FILES)
    .filter((text) => /^type: place$/m.test(text))
    .map((text) => /^shortcode: (\S+)$/m.exec(text)![1])
    .sort();

/** Every child → parent edge the fixture states, resolved or not. */
const PARENT_EDGES = Object.values(FILES)
    .filter((text) => /^type: place$/m.test(text))
    .flatMap((text) => {
        const child = /^shortcode: (\S+)$/m.exec(text)![1];
        const parents = /^  parents: \[([^\]]*)\]$/m.exec(text)?.[1] ?? "";
        return parents
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean)
            .map((parent) => `${child}->${parent}`);
    })
    .sort();

let repo: string;
let contentBase: string;

beforeAll(() => {
    // The real path, so a finding's locator relative to the command's working
    // directory reads as the note's path rather than a climb out of `/var`.
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "map-")));
    contentBase = path.join(repo, "assets", "content");
    for (const [rel, text] of Object.entries(FILES)) {
        const abs = path.join(contentBase, ...rel.split("/"));
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, text, "utf8");
    }
    fs.writeFileSync(
        path.join(repo, "package.json"),
        JSON.stringify({ name: "sohl-demo", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(repo, "package-build.config.yaml"),
        `contentPackage: demo
packageKind: modules
compatibility:
    minimum: "14"
    verified: "14.367"
relationships:
    systems:
        - id: sohl
          type: system
          manifest: https://example.org/system.json
          compatibility: { verified: "1.0.0" }
          contentIndex: false
stats:
    lastModifiedBy: maptestbuild0000
itemBuilders: sohl
skipDirectories: []
packs:
    - { name: journals, label: Journals, type: JournalEntry }
`,
    );
});
afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

/** The fixture read the way the command reads it: through the index. */
function world() {
    const records = indexRecordsFor({ contentBase, skipDirectories: [] });
    return placesFromRecords(records, { contentBase });
}

/* ---------------------------------------------------------------------- */
/*  Reading the index                                                     */
/* ---------------------------------------------------------------------- */

describe("the places are read from the content index", () => {
    it("finds every place and every polity, and nothing else", () => {
        const { places, polities } = world();
        expect([...places.keys()].sort()).toEqual(PLACES);
        expect(polities.map((p) => p.shortcode).sort()).toEqual(["kingalpha", "kingnone"]);
    });

    it("carries each place's name, subType, parents, borders, routes and file", () => {
        const { places } = world();
        const alpha = places.get("alpha")!;
        expect(alpha.name).toBe("Alpha");
        expect(alpha.subType).toBe("region");
        expect(alpha.parents).toEqual(["northc"]);
        expect(alpha.borders).toHaveLength(3);
        expect(alpha.routes).toHaveLength(3);
        expect(alpha.file).toBe("Regions/North/Alpha/Alpha.md");
        expect(alpha.hasPackFolder).toBe(true);
        expect(places.get("gamma")!.hasPackFolder).toBe(false);
        // The suite's ambient configuration names the package.
        expect(alpha.address).toBe("sohl-none-place-alpha");
    });

    it("hyperlinks a place to its page only when a base is given", () => {
        const unlinked = placesFromRecords(indexRecordsFor({ contentBase, skipDirectories: [] }), {
            contentBase,
        });
        expect(unlinked.places.get("alpha")!.url).toBeUndefined();
        const linked = placesFromRecords(indexRecordsFor({ contentBase, skipDirectories: [] }), {
            contentBase,
            base: "https://example.org/demo/",
        });
        expect(linked.places.get("alpha")!.url).toBe("https://example.org/demo/place-alpha/");
    });

    it("loads a dependency's places beside the package's own", () => {
        const cache = fs.mkdtempSync(path.join(os.tmpdir(), "map-cache-"));
        const dir = path.join(cache, "thalorna@0.1.0");
        fs.mkdirSync(dir, { recursive: true });
        const abroad = {
            package: "thalorna",
            type: "place",
            subType: "region",
            shortcode: "abroad",
            name: { full: "Abroad" },
            data: { parents: ["world"], borders: [{ to: "theta", bearing: "S" }] },
            address: { slug: "place-abroad", canonical: "thalorna-none-place-abroad" },
            anchors: [],
            foundry: {},
            documentation: null,
        };
        fs.writeFileSync(path.join(dir, "thalorna-metadata.jsonl"), JSON.stringify(abroad) + "\n");
        fs.writeFileSync(path.join(dir, ".complete"), "");
        const config = {
            contentPackage: "demo",
            skipDirectories: [],
            paths: {
                content: contentBase,
                assets: path.join(repo, "assets"),
                metadataCache: cache,
            },
            relationships: { requires: [{ id: "thalorna", manifest: "https://x/y.json" }] },
        };
        const loaded = loadMapWorld({ config: config as any, contentBase });
        const abroadPlace = loaded.places.get("abroad")!;
        expect(abroadPlace).toBeDefined();
        expect(abroadPlace.package).toBe("thalorna");
        expect(abroadPlace.local).toBe(false);
        expect(abroadPlace.parents).toEqual(["world"]);
        expect(abroadPlace.url).toBe("/thalorna/place-abroad/");
        expect(loaded.places.size).toBe(PLACES.length + 1);
    });
});

/* ---------------------------------------------------------------------- */
/*  The containment tree                                                  */
/* ---------------------------------------------------------------------- */

describe("the containment tree", () => {
    it("finds the world, the continents and each place's continent", () => {
        const { places, polities } = world();
        const analysis = analyzeContainment(places, polities);
        expect(analysis.world).toBe("world");
        expect(analysis.continents).toEqual(["northc", "southc"]);
        expect(analysis.continentOf.get("porta")).toBe("northc");
        expect(analysis.continentOf.get("farx")).toBe("southc");
        expect(analysis.continentOf.get("orphan")).toBeUndefined();
        expect(analysis.continentOf.get("loopa")).toBeUndefined();
    });

    it("reports every anomaly, located at the entry that states it", () => {
        const { places, polities } = world();
        const analysis = analyzeContainment(places, polities);
        const findings = containmentFindings(analysis, places, { contentBase });
        const lines = findings.map(
            (f) => `${f.severity} ${path.relative(contentBase, f.file)} ${f.message}`,
        );
        expect(lines.filter((l) => /no parent/.test(l))).toEqual([
            expect.stringMatching(/^error Regions\/Orphan\.md .*orphan.* no parent/),
        ]);
        expect(lines.filter((l) => /does not resolve/.test(l))).toEqual([
            expect.stringMatching(/^error Regions\/Lost\.md .*nowhere.*does not resolve/),
        ]);
        expect(lines.filter((l) => /cycle/.test(l))).toEqual([
            expect.stringMatching(/^error Regions\/Loop_A\.md .*loopa → loopb → loopa/),
        ]);
        expect(lines.filter((l) => /more than one parent/.test(l))).toEqual([
            expect.stringMatching(/^warning Regions\/South\/Delta\/Delta\.md .*southc, northc/),
        ]);
        expect(lines.filter((l) => /packFolder/.test(l))).toEqual([
            expect.stringMatching(/^warning Regions\/North\/Gamma\/Gamma\.md .*gamma/),
        ]);
        expect(lines.filter((l) => /polity/.test(l))).toEqual([
            expect.stringMatching(/^warning Peoples\/Kingdom_of_Nowhere\.md .*kingnone/),
        ]);
        expect(findings).toHaveLength(6);
        // The world has no parent by nature, and is not a finding.
        expect(lines.some((l) => /world/.test(l))).toBe(false);
        // Every finding about a `parents` entry is located inside it.
        for (const f of findings.filter((f) => /parent|resolve|cycle/.test(f.message))) {
            expect(f.line, f.message).toBeGreaterThan(1);
            expect(f.column, f.message).toBeGreaterThan(1);
        }
    });

    it("emits a DOT whose nodes are the places and whose edges are the parents", () => {
        const { places, polities } = world();
        const analysis = analyzeContainment(places, polities);
        const dot = treeDot({ places, polities, analysis });
        const nodes = [...dot.matchAll(/^\s*p_(\w+) \[/gm)].map((m) => m[1]).sort();
        expect(nodes).toEqual(PLACES);
        const edges = [...dot.matchAll(/^\s*p_(\w+) -> (?:p|missing)_(\w+);/gm)]
            .map((m) => `${m[1]}->${m[2]}`)
            .sort();
        expect(edges).toEqual(PARENT_EDGES);
        // One cluster per continent, labelled with its name.
        expect(dot).toMatch(/subgraph "cluster_northc" \{\s*label="North Continent"/);
        expect(dot).toMatch(/subgraph "cluster_southc" \{\s*label="South Continent"/);
        // The unresolved parent is a placeholder, and the polity sits beside
        // its region on a dashed edge.
        expect(dot).toMatch(/missing_nowhere \[label="nowhere", shape=octagon/);
        expect(dot).toMatch(/a_kingalpha -> p_alpha \[style=dashed/);
        expect(dot).not.toMatch(/a_kingnone/);
        // Labels are names, tooltips are addresses.
        expect(dot).toMatch(/p_alpha \[label="Alpha".*tooltip="sohl-none-place-alpha"/);
    });

    it("flags the anomalies in red and nothing else", () => {
        const { places, polities } = world();
        const analysis = analyzeContainment(places, polities);
        const dot = treeDot({ places, polities, analysis });
        const attrs = (id: string) => new RegExp(`^\\s*${id} \\[([^\\n]*)\\];`, "m").exec(dot)![1];
        expect(attrs("p_orphan")).toMatch(/fillcolor="#EF5350"/);
        expect(attrs("p_loopa")).toMatch(/color="#B71C1C"/);
        expect(attrs("p_loopb")).toMatch(/color="#B71C1C"/);
        expect(attrs("p_alpha")).not.toMatch(/#EF5350|#B71C1C/);
        expect(attrs("p_delta")).not.toMatch(/#EF5350|#B71C1C/);
    });

    it("draws a subtree beneath any place with --root, and drops polities on request", () => {
        const { places, polities } = world();
        const analysis = analyzeContainment(places, polities);
        const dot = treeDot({ places, polities, analysis, root: "beta" });
        const nodes = [...dot.matchAll(/^\s*p_(\w+) \[/gm)].map((m) => m[1]).sort();
        expect(nodes).toEqual(["beta", "eta", "omega", "portb", "zeta"]);
        const bare = treeDot({ places, polities, analysis, drawPolities: false });
        expect(bare).not.toMatch(/a_kingalpha/);
    });

    it("links a node to its page when the places carry a URL", () => {
        const { places, polities } = placesFromRecords(
            indexRecordsFor({ contentBase, skipDirectories: [] }),
            { contentBase, base: "/demo/" },
        );
        const dot = treeDot({ places, polities, analysis: analyzeContainment(places, polities) });
        expect(dot).toMatch(/p_alpha \[.*URL="\/demo\/place-alpha\/"/);
    });
});

/* ---------------------------------------------------------------------- */
/*  The map from a place, and the route graph, as DOT                     */
/* ---------------------------------------------------------------------- */

describe("the map from a place, as DOT", () => {
    it("pins every node, labels every edge with bearing and days, and draws the rings", () => {
        const { places } = world();
        const layout = layoutFrom(places, "alpha");
        const dot = fromDot(layout, places, {});
        for (const node of layout.nodes) {
            const pinned = new RegExp(
                `p_${node.shortcode} \\[[^\\n]*pos="${node.x.toFixed(1)},${node.y.toFixed(1)}!"`,
            );
            expect(dot, node.shortcode).toMatch(pinned);
        }
        expect(dot).toMatch(/p_alpha -> p_portb \[[^\n]*label="E · 5 d"/);
        expect(dot).toMatch(/p_alpha -> p_beta \[[^\n]*style=dashed/);
        expect(dot).toMatch(/p_alpha -> p_beta \[[^\n]*label="E"/);
        expect(dot).toMatch(/p_portb -> p_omega \[[^\n]*label="E · 10 d"/);
        // Ten rings and the rim, each a circle pinned at the origin with its
        // marker as a label; the unknown place is named as such.
        expect(dot.match(/ring_\d+ \[/g)).toHaveLength(10);
        expect(dot).toMatch(/ringlabel_10 \[[^\n]*label="10 d"/);
        expect(dot).toMatch(/rim \[[^\n]*pos="0,0!"/);
        expect(dot).toMatch(/p_theta \[[^\n]*label="Theta\\n\?"/);
        expect(dot).not.toMatch(/p_zeta/);
        expect(dot).not.toMatch(/URL=/);
    });

    it("hyperlinks the names when the places carry a URL", () => {
        const { places } = placesFromRecords(
            indexRecordsFor({ contentBase, skipDirectories: [] }),
            {
                contentBase,
                base: "/demo/",
            },
        );
        const dot = fromDot(layoutFrom(places, "alpha"), places, {});
        expect(dot).toMatch(/p_portb \[[^\n]*URL="\/demo\/place-portb\/"/);
    });
});

describe("the route graph, as DOT", () => {
    it("has one edge per pair with a length from its days", () => {
        const { places } = world();
        const graph = travelGraph(places);
        const dot = travelDot(graph, places, {});
        const edges = [...dot.matchAll(/^\s*p_(\w+) -- p_(\w+) \[([^\n]*)\];/gm)];
        expect(edges).toHaveLength(graph.edges.length);
        const portb = edges.find((m) => m[1] === "alpha" && m[2] === "portb")!;
        expect(portb[3]).toMatch(/len=/);
        expect(portb[3]).toMatch(/label="E · 5 d"/);
        const beta = edges.find((m) => m[1] === "alpha" && m[2] === "beta")!;
        expect(beta[3]).toMatch(/style=dashed/);
        expect(dot).toMatch(/^graph travel \{/m);
    });
});

/* ---------------------------------------------------------------------- */
/*  Building under build/map                                              */
/* ---------------------------------------------------------------------- */

describe("building the maps", () => {
    it("names a missing GraphViz plainly, with what to install", () => {
        expect(GRAPHVIZ_ENGINES).toEqual(["dot", "twopi", "neato"]);
        const out = fs.mkdtempSync(path.join(os.tmpdir(), "map-out-"));
        expect(() =>
            buildMaps({
                world: world(),
                outDir: out,
                tree: true,
                locate: () => undefined,
            }),
        ).toThrow(/GraphViz.*dot.*install/i);
    });

    it("skips the rendering with one warning when told to, and still writes the .dot", () => {
        const out = fs.mkdtempSync(path.join(os.tmpdir(), "map-out-"));
        const result = buildMaps({
            world: world(),
            outDir: out,
            from: ["alpha"],
            locate: () => undefined,
            requireGraphviz: false,
        });
        expect(fs.existsSync(path.join(out, "from-alpha.dot"))).toBe(true);
        expect(fs.existsSync(path.join(out, "from-alpha.svg"))).toBe(false);
        const warnings = result.findings.filter((f) => /GraphViz/.test(f.message));
        expect(warnings).toHaveLength(1);
        expect(warnings[0].severity).toBe("warning");
    });

    it("finds GraphViz where it is installed, or nowhere", () => {
        for (const engine of GRAPHVIZ_ENGINES) {
            const found = findGraphviz(engine);
            if (found) expect(path.basename(found)).toBe(engine);
        }
        expect(findGraphviz("dot", { env: { PATH: "" }, fallbacks: [] })).toBeUndefined();
        expect(() => findGraphviz("gnuplot")).toThrow(/gnuplot/);
    });

    describe.runIf(DOT)("with GraphViz installed", () => {
        it("renders the tree, one file per continent, beside its .dot", () => {
            const out = fs.mkdtempSync(path.join(os.tmpdir(), "map-out-"));
            const result = buildMaps({ world: world(), outDir: out, tree: true });
            for (const name of ["tree", "tree-northc", "tree-southc"]) {
                expect(fs.existsSync(path.join(out, `${name}.dot`)), name).toBe(true);
                const svg = fs.readFileSync(path.join(out, `${name}.svg`), "utf8");
                expect(svg, name).toMatch(/<svg/);
            }
            expect(fs.readFileSync(path.join(out, "tree.svg"), "utf8")).toMatch(/Alpha/);
            expect(result.findings).toHaveLength(6);
            expect(result.written.map((f) => path.basename(f)).sort()).toEqual([
                "tree-northc.dot",
                "tree-northc.svg",
                "tree-southc.dot",
                "tree-southc.svg",
                "tree.dot",
                "tree.svg",
            ]);
        });

        it("renders the map from a place, with the names as links when a base is known", () => {
            const out = fs.mkdtempSync(path.join(os.tmpdir(), "map-out-"));
            const linked = placesFromRecords(
                indexRecordsFor({ contentBase, skipDirectories: [] }),
                {
                    contentBase,
                    base: "/demo/",
                },
            );
            buildMaps({ world: linked, outDir: out, from: ["alpha"] });
            const svg = fs.readFileSync(path.join(out, "from-alpha.svg"), "utf8");
            expect(svg).toMatch(/<svg/);
            expect(svg).toMatch(/href="\/demo\/place-portb\/"/);
            expect(svg).toMatch(/Theta/);
            expect(svg).not.toMatch(/Zeta/);
        });

        it("renders the map from every place that states a relation with `all`", () => {
            const out = fs.mkdtempSync(path.join(os.tmpdir(), "map-out-"));
            const result = buildMaps({ world: world(), outDir: out, from: ["all"] });
            const drawn = result.written
                .map((f) => path.basename(f))
                .filter((f) => f.startsWith("from-") && f.endsWith(".svg"))
                .sort();
            // Every place that states, or is stated in, a border or a route.
            expect(drawn).toEqual(
                [
                    "alpha",
                    "beta",
                    "delta",
                    "eta",
                    "farx",
                    "gamma",
                    "omega",
                    "porta",
                    "portb",
                    "theta",
                    "zeta",
                ].map((sc) => `from-${sc}.svg`),
            );
        }, 30_000);

        it("renders the whole route graph", () => {
            const out = fs.mkdtempSync(path.join(os.tmpdir(), "map-out-"));
            buildMaps({ world: world(), outDir: out, travel: true });
            const svg = fs.readFileSync(path.join(out, "travel.svg"), "utf8");
            expect(svg).toMatch(/<svg/);
            expect(svg).toMatch(/Omega/);
        });

        it("refuses a --from or --root that names no place", () => {
            const out = fs.mkdtempSync(path.join(os.tmpdir(), "map-out-"));
            expect(() => buildMaps({ world: world(), outDir: out, from: ["nowhere"] })).toThrow(
                /nowhere/,
            );
            expect(() =>
                buildMaps({ world: world(), outDir: out, tree: true, root: "nowhere" }),
            ).toThrow(/nowhere/);
        });
    });
});

/* ---------------------------------------------------------------------- */
/*  The command                                                           */
/* ---------------------------------------------------------------------- */

describe.runIf(DOT)("`content-build map`", () => {
    function run(...args: string[]) {
        return spawnSync(process.execPath, [CLI, "map", ...args], {
            cwd: repo,
            env: {
                ...process.env,
                PACKAGE_BUILD_CONFIG: path.join(repo, "package-build.config.yaml"),
            },
            encoding: "utf8",
        });
    }

    it("writes under build/map and reports the anomalies as findings", () => {
        const r = run("--tree");
        expect(fs.existsSync(path.join(repo, "build", "map", "tree.svg"))).toBe(true);
        expect(fs.existsSync(path.join(repo, "build", "map", "tree.dot"))).toBe(true);
        expect(r.stderr).toMatch(
            /^assets\/content\/Regions\/Orphan\.md(:\d+)*: error: .*no parent/m,
        );
        expect(r.stderr).toMatch(/^assets\/content\/Regions\/Loop_A\.md:\d+:\d+: error: .*cycle/m);
        // Errors among the findings fail the command, as `lint` does.
        expect(r.status).toBe(1);
    });

    it("draws the map from a place, and from every place", () => {
        expect(run("--from", "alpha").status).toBe(0);
        expect(fs.existsSync(path.join(repo, "build", "map", "from-alpha.svg"))).toBe(true);
        expect(run("--from", "all").status).toBe(0);
        expect(fs.existsSync(path.join(repo, "build", "map", "from-theta.svg"))).toBe(true);
    });

    it("draws the route graph", () => {
        expect(run("--travel").status).toBe(0);
        expect(fs.existsSync(path.join(repo, "build", "map", "travel.svg"))).toBe(true);
    });

    it("asks for a mode when given none", () => {
        const r = run();
        expect(r.status).not.toBe(0);
        expect(`${r.stdout}${r.stderr}`).toMatch(/--tree|--from|--travel/);
    });
});
