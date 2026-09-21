/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The layout maths behind `content-build map --from`, tested without
 * GraphViz: a bearing is an angle with north up and east right, a days marker
 * is a ring, the rings are log-spaced, and two hops compose into one bearing
 * only where they agree.
 */

import { describe, it, expect } from "vitest";

import { BEARINGS, TRAVEL_DAYS } from "../engine/place-relations.mjs";
import {
    HORIZON_DAYS,
    RING_DAYS,
    bearingAngle,
    bearingSteps,
    bearingVector,
    composeHops,
    daysMarker,
    edgeLength,
    layoutFrom,
    rimRadius,
    ringRadius,
    rings,
    travelGraph,
} from "../engine/map-layout.mjs";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe("a bearing is an angle, north up and east right", () => {
    it("puts north at 90°, east at 0°, south at -90° and west at 180°", () => {
        expect(bearingAngle("N")).toBe(90);
        expect(bearingAngle("E")).toBe(0);
        expect(bearingAngle("S")).toBe(-90);
        expect(bearingAngle("W")).toBe(180);
        expect(bearingAngle("NE")).toBe(45);
        expect(bearingAngle("SE")).toBe(-45);
        expect(bearingAngle("SW")).toBe(-135);
        expect(bearingAngle("NW")).toBe(135);
    });

    it("refuses a value that is not a bearing", () => {
        expect(bearingAngle("up")).toBeUndefined();
        expect(bearingAngle(undefined)).toBeUndefined();
    });

    it("gives every bearing a unit vector with the sign convention of the page", () => {
        const n = bearingVector("N")!;
        expect(close(n.x, 0) && close(n.y, 1)).toBe(true);
        const e = bearingVector("E")!;
        expect(close(e.x, 1) && close(e.y, 0)).toBe(true);
        const sw = bearingVector("SW")!;
        expect(sw.x).toBeLessThan(0);
        expect(sw.y).toBeLessThan(0);
        for (const b of BEARINGS) {
            const v = bearingVector(b)!;
            expect(close(Math.hypot(v.x, v.y), 1), b).toBe(true);
        }
    });

    it("counts the steps between two bearings around the shorter way", () => {
        expect(bearingSteps("N", "N")).toBe(0);
        expect(bearingSteps("N", "NE")).toBe(1);
        expect(bearingSteps("N", "NW")).toBe(1);
        expect(bearingSteps("N", "E")).toBe(2);
        expect(bearingSteps("N", "S")).toBe(4);
        expect(bearingSteps("NW", "NE")).toBe(2);
        expect(bearingSteps("N", "up")).toBeUndefined();
    });
});

describe("a days marker is a ring", () => {
    it("draws one ring per marker up to the horizon, and the horizon is 90 days", () => {
        expect(HORIZON_DAYS).toBe(90);
        expect([...RING_DAYS]).toEqual(TRAVEL_DAYS.filter((d) => d <= HORIZON_DAYS));
        expect(rings().map((r) => r.days)).toEqual([...RING_DAYS]);
    });

    it("spaces the rings logarithmically, so a day and a month both fit", () => {
        const radii = RING_DAYS.map((d) => ringRadius(d));
        for (let i = 1; i < radii.length; i++) {
            expect(radii[i], `${RING_DAYS[i]} days`).toBeGreaterThan(radii[i - 1]);
        }
        // Equal ratios of days are equal steps of radius.
        const step = (a: number, b: number) => ringRadius(b) - ringRadius(a);
        expect(close(step(1, 2), step(5, 10))).toBe(true);
        expect(close(step(1, 3), step(10, 30))).toBe(true);
        expect(close(step(2, 20), step(3, 30))).toBe(true);
    });

    it("puts the rim beyond the last ring, and a marker past the horizon on the rim", () => {
        expect(rimRadius()).toBeGreaterThan(ringRadius(HORIZON_DAYS));
        expect(ringRadius(180)).toBe(rimRadius());
        expect(ringRadius(360)).toBe(rimRadius());
        expect(ringRadius(undefined)).toBe(rimRadius());
    });

    it("snaps a total to the smallest marker that covers it", () => {
        expect(daysMarker(1)).toBe(1);
        expect(daysMarker(4)).toBe(5);
        expect(daysMarker(6)).toBe(10);
        expect(daysMarker(15)).toBe(20);
        expect(daysMarker(90)).toBe(90);
        expect(daysMarker(91)).toBe(180);
        expect(daysMarker(400)).toBeUndefined();
        expect(daysMarker(undefined)).toBeUndefined();
    });

    it("gives the travel graph an edge length that grows with days", () => {
        const lengths = TRAVEL_DAYS.map((d) => edgeLength(d));
        for (let i = 1; i < lengths.length; i++) {
            expect(lengths[i], `${TRAVEL_DAYS[i]} days`).toBeGreaterThan(lengths[i - 1]);
        }
        expect(edgeLength(undefined)).toBeLessThanOrEqual(edgeLength(1));
    });
});

describe("two hops compose into one bearing only where they agree", () => {
    it("keeps the bearing when both hops share it", () => {
        const c = composeHops({ bearing: "E", days: 5 }, { bearing: "E", days: 10 });
        expect(c).toBeDefined();
        expect(close(c!.angle, 0)).toBe(true);
        expect(c!.days).toBe(15);
    });

    it("lands between two adjacent bearings, weighted by their days", () => {
        const even = composeHops({ bearing: "E", days: 5 }, { bearing: "NE", days: 5 });
        expect(close(even!.angle, 22.5)).toBe(true);
        const mostlyEast = composeHops({ bearing: "E", days: 20 }, { bearing: "NE", days: 1 });
        expect(mostlyEast!.angle).toBeGreaterThan(0);
        expect(mostlyEast!.angle).toBeLessThan(10);
    });

    it("refuses hops two or more steps apart", () => {
        expect(composeHops({ bearing: "E", days: 5 }, { bearing: "N", days: 5 })).toBeUndefined();
        expect(composeHops({ bearing: "E", days: 5 }, { bearing: "W", days: 5 })).toBeUndefined();
    });

    it("carries unknown days through as unknown, weighting the hops evenly", () => {
        const c = composeHops({ bearing: "E" }, { bearing: "SE", days: 3 });
        expect(c).toBeDefined();
        expect(c!.days).toBeUndefined();
        expect(close(c!.angle, -22.5)).toBe(true);
    });
});

/* ---------------------------------------------------------------------- */
/*  The map from a place                                                  */
/* ---------------------------------------------------------------------- */

type Place = {
    shortcode: string;
    name: string;
    subType: string;
    parents: string[];
    borders: Array<{ to: string; bearing: string }>;
    routes: Array<{ to: string; bearing: string; mode: string; days: number }>;
};

function place(shortcode: string, overrides: Partial<Place> = {}): Place {
    return {
        shortcode,
        name: shortcode.toUpperCase(),
        subType: "region",
        parents: [],
        borders: [],
        routes: [],
        ...overrides,
    };
}

/**
 * Alpha at the centre. Beta borders it to the east and states it back; delta
 * is stated by alpha alone; gamma borders it to the north and also states a
 * route alpha does not. Porta, portb and farx are routes at one, five and
 * thirty days. Beyond portb: omega straight on, eta a step off, zeta the
 * opposite way. Beyond beta, a border only: theta.
 */
function world(): Map<string, Place> {
    const list: Place[] = [
        place("alpha", {
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
        place("beta", {
            borders: [
                { to: "alpha", bearing: "W" },
                { to: "theta", bearing: "SE" },
            ],
        }),
        place("gamma", {
            borders: [{ to: "alpha", bearing: "S" }],
            routes: [{ to: "alpha", bearing: "S", mode: "land", days: 2 }],
        }),
        place("delta"),
        place("porta", {
            subType: "settlement",
            routes: [{ to: "alpha", bearing: "SW", mode: "land", days: 1 }],
        }),
        place("portb", {
            subType: "settlement",
            routes: [
                { to: "alpha", bearing: "W", mode: "land", days: 5 },
                { to: "omega", bearing: "E", mode: "land", days: 10 },
                { to: "eta", bearing: "NE", mode: "land", days: 5 },
                { to: "zeta", bearing: "W", mode: "land", days: 3 },
            ],
        }),
        place("farx", {
            subType: "settlement",
            routes: [{ to: "alpha", bearing: "N", mode: "ship", days: 30 }],
        }),
        place("omega", { subType: "settlement" }),
        place("eta", { subType: "settlement" }),
        place("zeta", { subType: "settlement" }),
        place("theta", { borders: [{ to: "beta", bearing: "NW" }] }),
    ];
    return new Map(list.map((p) => [p.shortcode, p]));
}

describe("the map from a place", () => {
    const layout = layoutFrom(world(), "alpha");
    const node = (sc: string) => {
        const n = layout.nodes.find((n) => n.shortcode === sc);
        if (!n) throw new Error(`${sc} is not on the map`);
        return n;
    };
    const angle = (sc: string) => (Math.atan2(node(sc).y, node(sc).x) * 180) / Math.PI;
    const radius = (sc: string) => Math.hypot(node(sc).x, node(sc).y);

    it("pins the centre at the origin", () => {
        expect(layout.centre).toBe("alpha");
        expect(node("alpha").x).toBe(0);
        expect(node("alpha").y).toBe(0);
        expect(node("alpha").hop).toBe(0);
    });

    it("pins each neighbour at the angle its bearing implies, north up and east right", () => {
        expect(close(angle("porta"), 45)).toBe(true);
        expect(node("porta").x).toBeGreaterThan(0);
        expect(node("porta").y).toBeGreaterThan(0);
        expect(close(angle("gamma"), 90)).toBe(true);
        expect(close(node("gamma").x, 0)).toBe(true);
        expect(close(angle("farx"), -90)).toBe(true);
        expect(node("farx").y).toBeLessThan(0);
        expect(close(angle("delta"), -90)).toBe(true);
    });

    it("puts each neighbour on the ring its days imply", () => {
        expect(node("porta").days).toBe(1);
        expect(node("portb").days).toBe(5);
        expect(node("farx").days).toBe(30);
        expect(radius("porta")).toBeLessThan(radius("portb"));
        expect(radius("portb")).toBeLessThan(radius("farx"));
        expect(close(radius("porta"), ringRadius(1))).toBe(true);
        expect(close(radius("farx"), ringRadius(30))).toBe(true);
    });

    it("puts a border with no route on the innermost ring, dashed", () => {
        expect(node("beta").days).toBeUndefined();
        expect(node("beta").border).toBe(true);
        expect(close(radius("beta"), ringRadius(1))).toBe(true);
        expect(close(radius("delta"), ringRadius(1))).toBe(true);
        const edge = layout.edges.find((e) => e.from === "alpha" && e.to === "beta");
        expect(edge?.kind).toBe("border");
    });

    it("reads a relation the other end states, so a one-sided entry still draws", () => {
        // Alpha states delta; delta states nothing back.
        expect(node("delta").hop).toBe(1);
        // Gamma states a route alpha does not, so gamma sits on the 2-day ring.
        expect(node("gamma").days).toBe(2);
        expect(close(radius("gamma"), ringRadius(2))).toBe(true);
        const edge = layout.edges.find((e) => e.from === "alpha" && e.to === "gamma");
        expect(edge?.kind).toBe("route");
        expect(edge?.days).toBe(2);
    });

    it("places a second hop by composed bearing where the hops agree, dimmer", () => {
        // portb E 5 + omega E 10: straight on, 15 days → the 20-day ring.
        expect(node("omega").hop).toBe(2);
        expect(node("omega").via).toBe("portb");
        expect(close(angle("omega"), 0)).toBe(true);
        expect(node("omega").days).toBe(15);
        expect(close(radius("omega"), ringRadius(20))).toBe(true);
        // portb E 5 + eta NE 5: a step off, so between the two, 10 days.
        expect(node("eta").hop).toBe(2);
        expect(close(angle("eta"), 22.5)).toBe(true);
        expect(close(radius("eta"), ringRadius(10))).toBe(true);
        const edge = layout.edges.find((e) => e.from === "portb" && e.to === "omega");
        expect(edge?.hop).toBe(2);
    });

    it("omits a second hop whose bearing disagrees with the first", () => {
        expect(layout.nodes.find((n) => n.shortcode === "zeta")).toBeUndefined();
    });

    it("puts a second hop with unknown days on the rim, marked unknown", () => {
        expect(node("theta").hop).toBe(2);
        expect(node("theta").days).toBeUndefined();
        expect(node("theta").unknown).toBe(true);
        expect(close(radius("theta"), rimRadius())).toBe(true);
        expect(close(angle("theta"), -22.5)).toBe(true);
    });

    it("orders the rings inside out and ends at the rim", () => {
        expect(radius("beta")).toBeLessThan(radius("gamma"));
        expect(radius("gamma")).toBeLessThan(radius("portb"));
        expect(radius("portb")).toBeLessThan(radius("eta"));
        expect(radius("eta")).toBeLessThan(radius("omega"));
        expect(radius("omega")).toBeLessThan(radius("farx"));
        expect(radius("farx")).toBeLessThan(radius("theta"));
        expect(layout.rings.map((r) => r.days)).toEqual([...RING_DAYS]);
        expect(layout.rim).toBe(rimRadius());
    });

    it("fans neighbours that share a ring and a bearing apart rather than stacking them", () => {
        const places = world();
        places.get("alpha")!.routes.push({ to: "portc", bearing: "E", mode: "land", days: 5 });
        places.set(
            "portc",
            place("portc", {
                subType: "settlement",
                routes: [{ to: "alpha", bearing: "W", mode: "land", days: 5 }],
            }),
        );
        const spread = layoutFrom(places, "alpha");
        const b = spread.nodes.find((n) => n.shortcode === "portb")!;
        const c = spread.nodes.find((n) => n.shortcode === "portc")!;
        expect(Math.hypot(b.x - c.x, b.y - c.y)).toBeGreaterThan(10);
        // Both stay on their ring, and their mean bearing stays east.
        expect(close(Math.hypot(b.x, b.y), ringRadius(5))).toBe(true);
        expect(close(Math.hypot(c.x, c.y), ringRadius(5))).toBe(true);
        expect(close(b.y + c.y, 0)).toBe(true);
    });

    it("names a target no place declares rather than drawing it", () => {
        const places = world();
        places.get("alpha")!.borders.push({ to: "nowhere", bearing: "W" });
        const broken = layoutFrom(places, "alpha");
        expect(broken.unresolved).toEqual([{ from: "alpha", to: "nowhere" }]);
        expect(broken.nodes.find((n) => n.shortcode === "nowhere")).toBeUndefined();
    });

    it("refuses a centre that is not a place", () => {
        expect(() => layoutFrom(world(), "nowhere")).toThrow(/nowhere/);
    });
});

describe("the whole route graph", () => {
    const graph = travelGraph(world());
    const edge = (a: string, b: string) =>
        graph.edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));

    it("has one edge per pair, however many ends state it", () => {
        const pairs = graph.edges.map((e) => [e.from, e.to].sort().join("-"));
        expect(new Set(pairs).size).toBe(pairs.length);
        expect(edge("alpha", "portb")?.days).toBe(5);
        expect(edge("alpha", "porta")?.days).toBe(1);
        expect(edge("gamma", "alpha")?.days).toBe(2);
        expect(edge("portb", "zeta")?.days).toBe(3);
    });

    it("draws a border as a dashed edge with no days", () => {
        expect(edge("alpha", "beta")?.kind).toBe("border");
        expect(edge("alpha", "beta")?.days).toBeUndefined();
        expect(edge("beta", "theta")?.kind).toBe("border");
    });

    it("gives every route a length monotone in its days", () => {
        const byDays = graph.edges
            .filter((e) => e.kind === "route")
            .sort((a, b) => a.days! - b.days!);
        for (let i = 1; i < byDays.length; i++) {
            if (byDays[i].days === byDays[i - 1].days) {
                expect(byDays[i].len).toBe(byDays[i - 1].len);
            } else {
                expect(byDays[i].len).toBeGreaterThan(byDays[i - 1].len);
            }
        }
    });
});
