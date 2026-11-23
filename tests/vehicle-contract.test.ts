/*
 * Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { expect, it } from "vitest";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { VEHICLE_FIELDS } from "../engine/vehicle-terms.mjs";

it("declares every vehicle fact in the note vocabulary", () => {
    const declared = new Set(NOTE_VOCABULARY.vehicle.data.map((field) => field.name));
    for (const field of VEHICLE_FIELDS) expect(declared.has(field.name)).toBe(true);
    expect(declared.has("movementProperties")).toBe(true);
});

const fixtures: any[] = [
    {
        family: "Ship",
        size: 40,
        locomotion: ["floating"],
        role: ["merchant", "military"],
        length: 40,
        width: 33,
        height: 9,
        hullDepth: 5,
        draft: 3,
        capacity: 176,
        cargoCapacity: 40,
        occupantCapacity: 20,
        occupants: [{ address: "being-horse", role: "crew" }],
        crew: 6,
        passengers: 4,
        movementProperties: [
            {
                medium: "floating",
                label: "oar",
                crew: 12,
                rates: [{ prob: 1, distance: 0, distUnit: "feet", timeUnit: "hour" }],
            },
        ],
        construction: { methods: ["clinker"], complexity: 5 },
        buildTime: 1333,
        cost: 8000,
        rules: "lore-rules",
        culture: "lore-culture",
    },
];

it("covers every declared generic field and nested key with valid authored fixtures", async () => {
    const { checkVehicleData } = await import("../engine/vehicle-data.mjs");
    const missing: string[] = [];
    function walk(spec: any, values: any[], at: string) {
        const present = values.filter((value) => value !== undefined);
        if (!present.length) {
            missing.push(at);
            return;
        }
        if (spec.fields)
            for (const child of spec.fields)
                walk(
                    child,
                    present.map((v) => v?.[child.name]),
                    `${at}.${child.name}`,
                );
        if (spec.entries)
            walk(
                spec.entries,
                present.flatMap((v) => (Array.isArray(v) ? v : [])),
                `${at}[]`,
            );
    }
    for (const field of VEHICLE_FIELDS)
        walk(
            field,
            fixtures.map((f) => f[field.name]),
            field.name,
        );
    expect(missing).toEqual([]);
    for (const data of fixtures)
        expect(checkVehicleData({ file: "vehicle.md", fm: { type: "vehicle", data } })).toEqual([]);
});
