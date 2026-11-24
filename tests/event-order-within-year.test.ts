/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **Events no day separates are ordered by their `follows` links**, then by
 * address. A link to another date, to nothing, or around a cycle orders nothing.
 */

import { describe, expect, it } from "vitest";

import { eventRows } from "../engine/event-rows.mjs";
import { reckoningContext } from "../engine/reckoning-markers.mjs";

type Spec = { id: string; year: number | null; follows?: string[] };

/** One note per spec, holding one event of that year. */
function records(specs: Spec[]) {
    return specs.map((spec) => ({
        address: { canonical: `demo-note-lore-${spec.id}` },
        type: "lore",
        data: {
            events: [
                {
                    id: spec.id,
                    when: spec.year,
                    summary: spec.id,
                    follows: (spec.follows ?? []).map((event) => ({ event, how: "caused" })),
                },
            ],
        },
        resolvedDates: {
            events: [
                {
                    when:
                        spec.year === null ?
                            { known: false }
                        :   { known: true, canonicalYear: spec.year, year: spec.year },
                },
            ],
        },
    }));
}

/** The addresses of the rows, sorted as the event views sort them. */
function listed(specs: Spec[]) {
    const all = records(specs);
    const rows = eventRows(all, reckoningContext({ notes: all }), []);
    const key = (value: number | null) => (value === null ? Infinity : value);
    return rows
        .sort(
            (a: any, b: any) =>
                key(a.whenSort) - key(b.whenSort) ||
                a.whenOrder - b.whenOrder ||
                (a.address < b.address ? -1 : 1),
        )
        .map((row: any) => row.address.replace("demo-note-lore-", "").replace(/#.*/, ""));
}

const at = (id: string) => `demo-note-lore-${id}#${id}`;

describe("the order of events within a year", () => {
    it("lists an event after the one it follows", () => {
        expect(
            listed([
                { id: "enthroned", year: 712, follows: [at("abdication")] },
                { id: "abdication", year: 712, follows: [at("peace")] },
                { id: "peace", year: 712 },
            ]),
        ).toEqual(["peace", "abdication", "enthroned"]);
    });

    it("orders the events no link orders by address", () => {
        expect(
            listed([
                { id: "peace", year: 712 },
                { id: "battle", year: 712 },
                { id: "abdication", year: 712, follows: [at("peace")] },
            ]),
        ).toEqual(["battle", "peace", "abdication"]);
    });

    it("keeps the years in date order whatever the links say", () => {
        expect(
            listed([
                { id: "later", year: 713 },
                { id: "earlier", year: 711, follows: [at("later")] },
            ]),
        ).toEqual(["earlier", "later"]);
    });

    it("ignores a link to an event outside the group or the corpus", () => {
        expect(
            listed([
                { id: "b", year: 712, follows: [at("a"), "demo-note-lore-absent#absent"] },
                { id: "a", year: 713 },
            ]),
        ).toEqual(["b", "a"]);
    });

    it("lists the members of a cycle by address", () => {
        expect(
            listed([
                { id: "x", year: 5, follows: [at("y")] },
                { id: "y", year: 5, follows: [at("z")] },
                { id: "z", year: 5, follows: [at("x")] },
            ]),
        ).toEqual(["x", "y", "z"]);
    });

    it("places a follower of a cycle member after it whatever its address", () => {
        expect(
            listed([
                { id: "c", year: 5, follows: [at("d")] },
                { id: "d", year: 5, follows: [at("c")] },
                { id: "a", year: 5, follows: [at("c")] },
            ]),
        ).toEqual(["c", "a", "d"]);
    });

    it("resolves a link naming only a note that holds one event", () => {
        expect(
            listed([
                { id: "abdication", year: 712, follows: ["demo-note-lore-peace"] },
                { id: "peace", year: 712 },
            ]),
        ).toEqual(["peace", "abdication"]);
    });

    it("gives the same order on every run", () => {
        const specs: Spec[] = [
            { id: "z", year: 5 },
            { id: "y", year: 5, follows: [at("z")] },
            { id: "x", year: 5, follows: [at("z")] },
        ];
        expect(listed(specs)).toEqual(["z", "x", "y"]);
        expect(listed([...specs].reverse())).toEqual(["z", "x", "y"]);
    });

    it("leaves undated events in address order", () => {
        expect(
            listed([
                { id: "b", year: null, follows: [at("a")] },
                { id: "a", year: null },
            ]),
        ).toEqual(["a", "b"]);
    });
});
