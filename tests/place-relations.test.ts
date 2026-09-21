/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A place states what it is next to (`data.borders`) and what it is reachable
 * from (`data.routes`), and `content-build lint` checks both: every target is
 * a place, every value is from its closed set, and the relation is stated the
 * same way from both ends. Each fixture below is one check, and every finding
 * is located at the entry that states the fault.
 */

import { describe, it, expect } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    BEARINGS,
    ROUTE_MODES,
    TERRAINS,
    TERRAIN_MODES,
    TRAVEL_DAYS,
    oppositeBearing,
} from "../engine/place-relations.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { buildIndexRecord } from "../engine/content-index.mjs";
import { loadForeignIndexes } from "../engine/metadata-index.mjs";
import { loadContentFormat } from "../engine/content-format.mjs";

/* ---------------------------------------------------------------------- */
/*  Fixtures                                                              */
/* ---------------------------------------------------------------------- */

/** A throwaway content tree, described as `{ relPath: contents }`. */
function tree(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "place-relations-"));
    for (const [rel, body] of Object.entries(files)) {
        const abs = path.join(root, ...rel.split("/"));
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, body, "utf8");
    }
    return root;
}

/** One entry as a YAML flow mapping, the way the notes write them. */
function flow(entry: Record<string, unknown>): string {
    const parts = Object.entries(entry).map(([k, v]) =>
        Array.isArray(v) ? `${k}: [${v.join(", ")}]` : `${k}: ${v}`,
    );
    return `{ ${parts.join(", ")} }`;
}

/** One entry, or the raw text of one that is not an entry at all. */
type Entry = Record<string, unknown> | string;

/**
 * A place note. The layout is fixed so a finding's line is knowable: `data:`
 * is line 7, `parents:` line 8, `borders:` line 9 with its first entry on
 * line 10, and `routes:` follows the border entries.
 */
function place(
    shortcode: string,
    { parents = [], borders, routes }: { parents?: string[]; borders?: Entry[]; routes?: Entry[] },
): string {
    const lines = [
        "---",
        "type: place",
        "subType: region",
        `shortcode: ${shortcode}`,
        "name:",
        `  full: ${shortcode.toUpperCase()}`,
        "data:",
        `  parents: [${parents.join(", ")}]`,
    ];
    if (borders) {
        lines.push("  borders:");
        for (const b of borders) lines.push(`    - ${typeof b === "string" ? b : flow(b)}`);
    }
    if (routes) {
        lines.push("  routes:");
        for (const r of routes) lines.push(`    - ${typeof r === "string" ? r : flow(r)}`);
    }
    lines.push("---", "", "Prose.", "");
    return lines.join("\n");
}

/** A note of another type, to prove a border must name a *place*. */
const lore = (shortcode: string) =>
    [
        "---",
        "type: lore",
        "subType: folk",
        `shortcode: ${shortcode}`,
        "name:",
        `  full: ${shortcode}`,
        "---",
        "",
        "Prose.",
        "",
    ].join("\n");

type Finding = { file: string; line?: number; column?: number; severity: string; message: string };

/**
 * Lint a tree and keep the findings about borders and routes. The fixture
 * places carry no art, and that is reported by other checks; those are not
 * under test here.
 */
function lint(
    files: Record<string, string>,
    config?: Record<string, unknown>,
): { findings: Finding[]; root: string } {
    const root = tree(files);
    const index = buildLinkIndex(root, { skipDirectories: [], ...(config ? { config } : {}) });
    const { findings } = lintFrontmatter(index, {
        schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS } as any,
        vocabulary: NOTE_VOCABULARY,
    });
    return {
        root,
        findings: (findings as Finding[]).filter((f) => /border|route/.test(f.message)),
    };
}

const messages = (findings: Finding[]) => findings.map((f) => f.message).join("\n");
const errors = (findings: Finding[]) => findings.filter((f) => f.severity === "error");
const warnings = (findings: Finding[]) => findings.filter((f) => f.severity === "warning");

/** Two regions bordering each other, stated from both ends. */
const RECIPROCAL = {
    "A.md": place("aaa", { borders: [{ to: "bbb", bearing: "NE" }] }),
    "B.md": place("bbb", { borders: [{ to: "aaa", bearing: "SW" }] }),
};

/* ---------------------------------------------------------------------- */
/*  The closed sets                                                       */
/* ---------------------------------------------------------------------- */

describe("the closed sets a place relation draws from", () => {
    it("are the eight compass bearings, the three modes, the days markers and the terrains", () => {
        expect([...BEARINGS]).toEqual(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
        expect([...ROUTE_MODES]).toEqual(["land", "boat", "ship"]);
        expect([...TRAVEL_DAYS]).toEqual([1, 2, 3, 5, 10, 20, 30, 45, 60, 90, 180, 360]);
        expect([...TERRAINS]).toEqual([
            "road",
            "track",
            "plain",
            "steppe",
            "hills",
            "mountains",
            "forest",
            "jungle",
            "marsh",
            "dunes",
            "desert",
            "ice",
            "coast",
            "open-sea",
            "river",
            "lake",
        ]);
    });

    it("say which modes cross each terrain, so water and land cannot be confused", () => {
        expect(Object.keys(TERRAIN_MODES)).toEqual([...TERRAINS]);
        for (const modes of Object.values(TERRAIN_MODES)) {
            expect(modes.length).toBeGreaterThan(0);
            for (const mode of modes) expect(ROUTE_MODES).toContain(mode);
        }
        expect(TERRAIN_MODES["open-sea"]).toEqual(["ship"]);
        expect(TERRAIN_MODES.river).toEqual(["boat"]);
        expect(TERRAIN_MODES.road).toEqual(["land"]);
    });

    it("invert a bearing to the one the other end states", () => {
        expect(oppositeBearing("N")).toBe("S");
        expect(oppositeBearing("NE")).toBe("SW");
        expect(oppositeBearing("E")).toBe("W");
        expect(oppositeBearing("SE")).toBe("NW");
        for (const b of BEARINGS) expect(oppositeBearing(oppositeBearing(b))).toBe(b);
        expect(oppositeBearing("up")).toBeUndefined();
    });
});

/* ---------------------------------------------------------------------- */
/*  The declaration                                                       */
/* ---------------------------------------------------------------------- */

describe("a place declares `borders` and `routes` in its closed `data:` container", () => {
    it("names both as list-shaped properties of `place`, and of no other type", () => {
        const names = (type: string) => (dataFields(type) ?? []).map((f) => f.name);
        expect(names("place")).toEqual(expect.arrayContaining(["borders", "routes"]));
        for (const field of (dataFields("place") ?? []).filter((f) =>
            ["borders", "routes"].includes(f.name),
        )) {
            expect(field.kind, field.name).toBe("list");
        }
        for (const type of Object.keys(NOTE_VOCABULARY).filter((t) => t !== "place")) {
            expect(names(type), type).not.toContain("borders");
            expect(names(type), type).not.toContain("routes");
        }
    });

    it("accepts a note stating both, well-formed and reciprocal", () => {
        const { findings } = lint({
            "A.md": place("aaa", {
                borders: [{ to: "bbb", bearing: "NE" }],
                routes: [
                    { to: "bbb", bearing: "NE", mode: "land", days: 3, terrain: ["road", "hills"] },
                    {
                        to: "bbb",
                        bearing: "N",
                        mode: "ship",
                        days: 5,
                        terrain: ["coast", "open-sea"],
                    },
                    {
                        to: "ccc",
                        bearing: "W",
                        mode: "land",
                        days: 30,
                        terrain: ["dunes"],
                        leagues: 90,
                    },
                ],
            }),
            "B.md": place("bbb", {
                borders: [{ to: "aaa", bearing: "SW" }],
                routes: [
                    { to: "aaa", bearing: "SW", mode: "land", days: 3, terrain: ["hills", "road"] },
                    { to: "aaa", bearing: "S", mode: "ship", days: 5 },
                ],
            }),
            "C.md": place("ccc", {
                routes: [{ to: "aaa", bearing: "E", mode: "land", days: 30 }],
            }),
        });
        expect(messages(findings)).toBe("");
    });
});

/* ---------------------------------------------------------------------- */
/*  Check 1: every `to` is a place                                        */
/* ---------------------------------------------------------------------- */

describe("check 1 — every `to` resolves to a place", () => {
    it("reports a shortcode no place declares, at the entry", () => {
        const { findings, root } = lint({
            "A.md": place("aaa", { borders: [{ to: "nowhere", bearing: "N" }] }),
        });
        expect(errors(findings)).toHaveLength(1);
        const [f] = errors(findings);
        expect(f.file).toBe(path.join(root, "A.md"));
        expect(f.line).toBe(10);
        expect(f.column).toBeGreaterThan(1);
        expect(f.message).toMatch(/"nowhere"/);
        expect(f.message).toMatch(/place/);
    });

    it("reports a target that is a note of another type, naming that type", () => {
        const { findings } = lint({
            "A.md": place("aaa", {
                routes: [{ to: "humanflk", bearing: "N", mode: "land", days: 1 }],
            }),
            "Folk.md": lore("humanflk"),
        });
        expect(errors(findings)).toHaveLength(1);
        expect(errors(findings)[0].message).toMatch(/lore/);
        expect(errors(findings)[0].message).toMatch(/"humanflk"/);
    });

    it("refuses a `to` that is an address rather than a shortcode", () => {
        const { findings } = lint({
            "A.md": place("aaa", { borders: [{ to: "place-bbb", bearing: "N" }] }),
            "B.md": place("bbb", { borders: [{ to: "aaa", bearing: "S" }] }),
        });
        expect(
            errors(findings)
                .map((f) => f.message)
                .join("\n"),
        ).toMatch(/shortcode/);
    });
});

/* ---------------------------------------------------------------------- */
/*  Check 4: the closed sets                                              */
/* ---------------------------------------------------------------------- */

describe("check 4 — every value is from its closed set, and the message names the set", () => {
    it("refuses a bearing outside the eight, naming them", () => {
        const { findings } = lint({
            "A.md": place("aaa", { borders: [{ to: "bbb", bearing: "NNE" }] }),
            "B.md": place("bbb", { borders: [{ to: "aaa", bearing: "SSW" }] }),
        });
        expect(errors(findings)).toHaveLength(2);
        for (const f of errors(findings)) {
            expect(f.message).toMatch(/bearing/);
            for (const b of BEARINGS) expect(f.message).toContain(b);
            expect(f.line).toBe(10);
        }
    });

    it("refuses a mode outside `land | boat | ship`", () => {
        const { findings } = lint({
            "A.md": place("aaa", { routes: [{ to: "bbb", bearing: "N", mode: "camel", days: 3 }] }),
            "B.md": place("bbb", { routes: [{ to: "aaa", bearing: "S", mode: "land", days: 3 }] }),
        });
        const mine = errors(findings).filter((f) => /mode/.test(f.message));
        expect(mine).toHaveLength(1);
        expect(mine[0].message).toContain("land, boat or ship");
        expect(mine[0].message).toContain("camel");
    });

    it("refuses a days value off the marker scale, naming the scale", () => {
        const { findings } = lint({
            "A.md": place("aaa", { routes: [{ to: "bbb", bearing: "N", mode: "land", days: 4 }] }),
            "B.md": place("bbb", { routes: [{ to: "aaa", bearing: "S", mode: "land", days: 4 }] }),
        });
        const mine = errors(findings).filter((f) => /days/.test(f.message));
        expect(mine).toHaveLength(2);
        expect(mine[0].message).toContain("1, 2, 3, 5, 10, 20, 30, 45, 60, 90, 180 or 360");
        expect(mine[0].message).toMatch(/reads 4\b/);
    });

    it("refuses a terrain outside the registry, naming the registry", () => {
        const { findings } = lint({
            "A.md": place("aaa", {
                routes: [
                    { to: "bbb", bearing: "N", mode: "land", days: 3, terrain: ["road", "swamp"] },
                ],
            }),
            "B.md": place("bbb", {
                routes: [{ to: "aaa", bearing: "S", mode: "land", days: 3 }],
            }),
        });
        const mine = errors(findings).filter((f) => /terrain/.test(f.message));
        expect(mine).toHaveLength(1);
        expect(mine[0].message).toContain('"swamp"');
        for (const t of TERRAINS) expect(mine[0].message).toContain(t);
    });

    it("refuses a route missing `mode` or `days`, and a border or route missing `bearing`", () => {
        const { findings } = lint({
            "A.md": place("aaa", {
                borders: [{ to: "bbb" }],
                routes: [{ to: "bbb", bearing: "N" }],
            }),
            "B.md": place("bbb", {
                borders: [{ to: "aaa", bearing: "S" }],
                routes: [{ to: "aaa", bearing: "S", mode: "land", days: 1 }],
            }),
        });
        const text = messages(errors(findings));
        expect(text).toMatch(/`bearing`/);
        expect(text).toMatch(/`mode`/);
        expect(text).toMatch(/`days`/);
    });

    it("refuses a key no entry declares, and an entry that is not a map", () => {
        const { findings } = lint({
            "A.md": place("aaa", {
                borders: [{ to: "bbb", bearing: "N", direction: "up" }],
                routes: ["bbb"],
            }),
            "B.md": place("bbb", { borders: [{ to: "aaa", bearing: "S" }] }),
        });
        const text = messages(errors(findings));
        expect(text).toMatch(/"direction"/);
        expect(text).toMatch(/map/);
    });
});

/* ---------------------------------------------------------------------- */
/*  Check 2: borders are reciprocal                                       */
/* ---------------------------------------------------------------------- */

describe("check 2 — borders are reciprocal", () => {
    it("passes a pair stated from both ends with opposite bearings", () => {
        expect(messages(lint(RECIPROCAL).findings)).toBe("");
    });

    it("warns when the other end states nothing, naming both notes", () => {
        const { findings, root } = lint({
            "A.md": place("aaa", { borders: [{ to: "bbb", bearing: "NE" }] }),
            "B.md": place("bbb", {}),
        });
        expect(errors(findings)).toEqual([]);
        expect(warnings(findings)).toHaveLength(1);
        const [w] = warnings(findings);
        expect(w.file).toBe(path.join(root, "A.md"));
        expect(w.line).toBe(10);
        expect(w.message).toContain("aaa");
        expect(w.message).toContain("bbb");
        expect(w.message).toContain("SW");
    });

    it("errors when the other end states the wrong bearing", () => {
        const { findings } = lint({
            "A.md": place("aaa", { borders: [{ to: "bbb", bearing: "NE" }] }),
            "B.md": place("bbb", { borders: [{ to: "aaa", bearing: "W" }] }),
        });
        expect(warnings(findings)).toEqual([]);
        expect(errors(findings).length).toBeGreaterThanOrEqual(1);
        const fromA = errors(findings).find((f) => f.file.endsWith("A.md"));
        expect(fromA?.line).toBe(10);
        expect(fromA?.message).toContain("SW");
        expect(fromA?.message).toContain("W");
    });
});

/* ---------------------------------------------------------------------- */
/*  Check 3: routes are reciprocal                                        */
/* ---------------------------------------------------------------------- */

describe("check 3 — routes are reciprocal in bearing, days and mode", () => {
    const route = (to: string, bearing: string, mode: string, days: number) => ({
        to,
        bearing,
        mode,
        days,
    });

    it("warns when the other end states no route back", () => {
        const { findings } = lint({
            "A.md": place("aaa", { routes: [route("bbb", "N", "land", 3)] }),
            "B.md": place("bbb", {}),
        });
        expect(errors(findings)).toEqual([]);
        expect(warnings(findings)).toHaveLength(1);
        expect(warnings(findings)[0].message).toContain("bbb");
    });

    it("errors when the days differ", () => {
        const { findings } = lint({
            "A.md": place("aaa", { routes: [route("bbb", "N", "land", 3)] }),
            "B.md": place("bbb", { routes: [route("aaa", "S", "land", 5)] }),
        });
        const mine = errors(findings).filter((f) => /days/.test(f.message));
        expect(mine.length).toBeGreaterThanOrEqual(1);
        expect(mine[0].message).toMatch(/3/);
        expect(mine[0].message).toMatch(/5/);
    });

    it("errors when the bearing back is wrong", () => {
        const { findings } = lint({
            "A.md": place("aaa", { routes: [route("bbb", "N", "land", 3)] }),
            "B.md": place("bbb", { routes: [route("aaa", "E", "land", 3)] }),
        });
        const mine = errors(findings).filter((f) => /bearing/.test(f.message));
        expect(mine.length).toBeGreaterThanOrEqual(1);
    });

    it("errors when the other end states the pair by another mode only", () => {
        const { findings } = lint({
            "A.md": place("aaa", { routes: [route("bbb", "N", "ship", 3)] }),
            "B.md": place("bbb", { routes: [route("aaa", "S", "land", 3)] }),
        });
        expect(warnings(findings)).toEqual([]);
        const mine = errors(findings).filter((f) => /mode/.test(f.message));
        expect(mine.length).toBeGreaterThanOrEqual(1);
        expect(mine[0].message).toContain("ship");
        expect(mine[0].message).toContain("land");
    });

    it("errors when a pair is listed twice with one mode", () => {
        const { findings } = lint({
            "A.md": place("aaa", {
                routes: [route("bbb", "N", "land", 3), route("bbb", "N", "land", 5)],
            }),
            "B.md": place("bbb", { routes: [route("aaa", "S", "land", 3)] }),
        });
        const mine = errors(findings).filter((f) => /twice|once per/.test(f.message));
        expect(mine).toHaveLength(1);
        expect(mine[0].line).toBe(11);
    });

    it("errors when a border pair is listed twice", () => {
        const { findings } = lint({
            "A.md": place("aaa", {
                borders: [
                    { to: "bbb", bearing: "N" },
                    { to: "bbb", bearing: "N" },
                ],
            }),
            "B.md": place("bbb", { borders: [{ to: "aaa", bearing: "S" }] }),
        });
        const mine = errors(findings).filter((f) => /twice|once/.test(f.message));
        expect(mine).toHaveLength(1);
        expect(mine[0].line).toBe(11);
    });
});

/* ---------------------------------------------------------------------- */
/*  Terrain and mode agree                                                */
/* ---------------------------------------------------------------------- */

describe("a water terrain needs a water mode, and the reverse", () => {
    it("errors on open sea by land", () => {
        const { findings } = lint({
            "A.md": place("aaa", {
                routes: [{ to: "bbb", bearing: "N", mode: "land", days: 3, terrain: ["open-sea"] }],
            }),
            "B.md": place("bbb", {
                routes: [{ to: "aaa", bearing: "S", mode: "land", days: 3 }],
            }),
        });
        const mine = errors(findings).filter((f) => /open-sea/.test(f.message));
        expect(mine).toHaveLength(1);
        expect(mine[0].message).toContain("land");
        expect(mine[0].message).toContain("ship");
    });

    it("errors on a road by ship, and on a river by ship", () => {
        const { findings } = lint({
            "A.md": place("aaa", {
                routes: [
                    { to: "bbb", bearing: "N", mode: "ship", days: 3, terrain: ["road", "river"] },
                ],
            }),
            "B.md": place("bbb", {
                routes: [{ to: "aaa", bearing: "S", mode: "ship", days: 3 }],
            }),
        });
        const mine = errors(findings).filter((f) => /road|river/.test(f.message));
        expect(mine).toHaveLength(2);
    });

    it("accepts a coast by any mode", () => {
        const { findings } = lint({
            "A.md": place("aaa", {
                routes: [
                    { to: "bbb", bearing: "N", mode: "ship", days: 3, terrain: ["coast"] },
                    { to: "bbb", bearing: "N", mode: "land", days: 5, terrain: ["coast"] },
                    { to: "bbb", bearing: "N", mode: "boat", days: 5, terrain: ["coast"] },
                ],
            }),
            "B.md": place("bbb", {
                routes: [
                    { to: "aaa", bearing: "S", mode: "ship", days: 3 },
                    { to: "aaa", bearing: "S", mode: "land", days: 5 },
                    { to: "aaa", bearing: "S", mode: "boat", days: 5 },
                ],
            }),
        });
        expect(messages(findings)).toBe("");
    });
});

/* ---------------------------------------------------------------------- */
/*  Check 5: a place never borders its parent or child                    */
/* ---------------------------------------------------------------------- */

describe("check 5 — a border to the note's own parent or child is an error", () => {
    it("errors when the target is a parent", () => {
        const { findings } = lint({
            "A.md": place("aaa", { parents: ["bbb"], borders: [{ to: "bbb", bearing: "N" }] }),
            "B.md": place("bbb", { borders: [{ to: "aaa", bearing: "S" }] }),
        });
        const mine = errors(findings).filter((f) => /parent/.test(f.message));
        expect(mine.length).toBeGreaterThanOrEqual(1);
        expect(mine[0].line).toBe(10);
    });

    it("errors when the target is a child", () => {
        const { findings } = lint({
            "A.md": place("aaa", { borders: [{ to: "bbb", bearing: "N" }] }),
            "B.md": place("bbb", { parents: ["aaa"], borders: [{ to: "aaa", bearing: "S" }] }),
        });
        const fromA = errors(findings).filter(
            (f) => f.file.endsWith("A.md") && /child/.test(f.message),
        );
        expect(fromA).toHaveLength(1);
    });
});

/* ---------------------------------------------------------------------- */
/*  Every finding is located                                              */
/* ---------------------------------------------------------------------- */

describe("every finding is `file:line:column: severity: message`, at the entry", () => {
    it("carries a file, a line and a column on each", () => {
        const { findings } = lint({
            "A.md": place("aaa", {
                parents: ["ccc"],
                borders: [
                    { to: "nowhere", bearing: "N" },
                    { to: "bbb", bearing: "NNE" },
                    { to: "ccc", bearing: "E" },
                ],
                routes: [
                    { to: "bbb", bearing: "N", mode: "swim", days: 4, terrain: ["swamp"] },
                    { to: "bbb", bearing: "N", mode: "land", days: 3 },
                ],
            }),
            "B.md": place("bbb", { routes: [{ to: "aaa", bearing: "S", mode: "land", days: 5 }] }),
            "C.md": place("ccc", { borders: [{ to: "aaa", bearing: "W" }] }),
        });
        expect(findings.length).toBeGreaterThan(5);
        for (const f of findings) {
            expect(typeof f.file, f.message).toBe("string");
            expect(f.line, f.message).toBeGreaterThan(7);
            expect(f.column, f.message).toBeGreaterThan(1);
            expect(["error", "warning"]).toContain(f.severity);
        }
    });
});

/* ---------------------------------------------------------------------- */
/*  The index carries the relation                                        */
/* ---------------------------------------------------------------------- */

describe("the content index carries a place's borders and routes", () => {
    const frontmatter = {
        type: "place",
        subType: "region",
        shortcode: "aaa",
        name: { full: "Aaa" },
        data: {
            parents: ["www"],
            borders: [{ to: "bbb", bearing: "NE" }],
            routes: [{ to: "ccc", bearing: "S", mode: "land", days: 3, terrain: ["road"] }],
        },
    };

    it("writes them verbatim into the place's record", () => {
        const record = buildIndexRecord({
            frontmatter,
            relPath: "Regions/A.md",
            absPath: "/tree/Regions/A.md",
            contentPackage: "thalorna",
            body: "",
            bodyLine: 1,
            manifest: {},
        });
        expect(record.data.borders).toEqual(frontmatter.data.borders);
        expect(record.data.routes).toEqual(frontmatter.data.routes);
    });

    it("hands them to a consumer through the fetched index, so a dependency's places take part", () => {
        const cache = fs.mkdtempSync(path.join(os.tmpdir(), "place-relations-cache-"));
        const dir = path.join(cache, "thalorna@0.1.0");
        fs.mkdirSync(dir, { recursive: true });
        const record = {
            package: "thalorna",
            ...frontmatter,
            address: { slug: "place-aaa", canonical: "thalorna-none-place-aaa" },
            anchors: [],
            foundry: {},
            documentation: null,
        };
        fs.writeFileSync(path.join(dir, "thalorna-metadata.jsonl"), JSON.stringify(record) + "\n");
        fs.writeFileSync(path.join(dir, ".complete"), "");
        const config = {
            paths: { metadataCache: cache },
            relationships: { requires: [{ id: "thalorna", manifest: "https://x/y.json" }] },
        };
        const { index } = loadForeignIndexes(config as any, new Set(["mine"]));
        const entry = index.get("thalorna-none-place-aaa");
        expect(entry?.borders).toEqual(frontmatter.data.borders);
        expect(entry?.routes).toEqual(frontmatter.data.routes);
        expect(entry?.parents).toEqual(frontmatter.data.parents);
    });

    it("checks reciprocity against a dependency's place", () => {
        const cache = fs.mkdtempSync(path.join(os.tmpdir(), "place-relations-cache-"));
        const dir = path.join(cache, "thalorna@0.1.0");
        fs.mkdirSync(dir, { recursive: true });
        const abroad = {
            package: "thalorna",
            type: "place",
            subType: "region",
            shortcode: "far",
            name: { full: "Far" },
            data: { borders: [{ to: "near", bearing: "E" }] },
            address: { slug: "place-far", canonical: "thalorna-none-place-far" },
            anchors: [],
            foundry: {},
            documentation: null,
        };
        fs.writeFileSync(path.join(dir, "thalorna-metadata.jsonl"), JSON.stringify(abroad) + "\n");
        fs.writeFileSync(path.join(dir, ".complete"), "");
        const config = {
            contentPackage: "mine",
            paths: { metadataCache: cache },
            relationships: { requires: [{ id: "thalorna", manifest: "https://x/y.json" }] },
        };
        const good = lint(
            { "Near.md": place("near", { borders: [{ to: "far", bearing: "W" }] }) },
            config,
        );
        expect(messages(good.findings)).toBe("");
        const bad = lint(
            { "Near.md": place("near", { borders: [{ to: "far", bearing: "N" }] }) },
            config,
        );
        expect(errors(bad.findings)).toHaveLength(1);
        expect(errors(bad.findings)[0].message).toContain("far");
    });
});

/* ---------------------------------------------------------------------- */
/*  The specification states the same sets                                */
/* ---------------------------------------------------------------------- */

describe("docs/content-format.md states the sets the lint enforces", () => {
    const FORMAT = loadContentFormat();

    it("documents `borders` and `routes` on `place`", () => {
        const spec = FORMAT.types.get("place");
        expect(spec?.dataKeys.has("borders")).toBe(true);
        expect(spec?.dataKeys.has("routes")).toBe(true);
    });

    it("lists the bearings, modes, days and terrains as vocabulary tables, in order", () => {
        expect(FORMAT.vocabularies.get("bearing")?.values).toEqual([...BEARINGS]);
        expect(FORMAT.vocabularies.get("mode")?.values).toEqual([...ROUTE_MODES]);
        expect(FORMAT.vocabularies.get("days")?.values).toEqual(TRAVEL_DAYS.map(String));
        expect(FORMAT.vocabularies.get("terrain")?.values).toEqual([...TERRAINS]);
    });
});
