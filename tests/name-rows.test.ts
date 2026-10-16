/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";

import { readCanonicalKey } from "../engine/address.mjs";
import { NAME_COLUMNS, namesRows } from "../engine/name-rows.mjs";

describe("authored name rows", () => {
    it("preserves every captured occurrence and scalar column in record/source order", () => {
        const records = [
            {
                address: { canonical: "demo-note-lore-border" },
                names: [
                    { name: "Ravenmoor", type: "place", subType: "settlement", line: 7, column: 3 },
                    { name: "Aldric Venn", type: "being", subType: null, line: 11, column: 8 },
                    { name: "Ravenmoor", type: null, subType: null, line: 19, column: 1 },
                ],
            },
            {
                address: { canonical: "demo-note-place-elsewhere" },
                names: [{ name: "Élan & the Moon", type: null, subType: null, line: 4, column: 6 }],
            },
        ];
        const rows = namesRows(records);
        expect(NAME_COLUMNS).toEqual(["owner", "name", "type", "subType", "line", "column"]);
        expect(rows).toEqual([
            { owner: "demo-note-lore-border", ...records[0].names[0] },
            { owner: "demo-note-lore-border", ...records[0].names[1] },
            { owner: "demo-note-lore-border", ...records[0].names[2] },
            { owner: "demo-note-place-elsewhere", ...records[1].names[0] },
        ]);
        for (const row of rows) expect(Object.keys(row)).toEqual(NAME_COLUMNS);
    });

    it("uses the canonical NOTE page for typed and encoded native Item records", () => {
        const occurrence = { name: "Aldric", type: "being", subType: null, line: 8, column: 5 };
        expect(
            namesRows([
                {
                    package: "ignored",
                    type: "lore",
                    shortcode: "ignored",
                    address: { canonical: readCanonicalKey("demo-sohl-miscgear-token") },
                    names: [occurrence],
                },
                { address: { canonical: "demo-hm3-skill-climbing" }, names: [occurrence] },
            ]).map(({ owner }) => owner),
        ).toEqual(["demo-note-miscgear-token", "demo-note-skill-climbing"]);
    });

    it("keeps unaddressable occurrences without manufacturing an owner", () => {
        const occurrence = { name: "Ravenmoor", type: null, subType: null, line: 2, column: 1 };
        const records = [
            {
                address: null,
                package: "demo",
                type: "lore",
                shortcode: "stub",
                names: [occurrence],
            },
            { address: { canonical: "not-an-address" }, names: [occurrence] },
            { names: [occurrence] },
        ];
        expect(namesRows(records)).toEqual(records.map(() => ({ owner: null, ...occurrence })));
    });

    it("excludes documentation mirrors, assets and records without occurrences", () => {
        const record = {
            address: { canonical: "demo-sohl-miscgear-token" },
            names: [{ name: "Ravenmoor", type: null, subType: null, line: 2, column: 1 }],
        };
        expect(
            namesRows([
                { ...record, documents: readCanonicalKey("demo-sohl-miscgear-token") },
                { ...record, asset: { path: "images/Ravenmoor.webp" } },
                { ...record, names: [] },
                { address: record.address },
            ]),
        ).toEqual([]);
    });

    it("accepts frozen iterable inputs and returns independent row objects", () => {
        const occurrence = Object.freeze({
            name: "Ravenmoor",
            type: null,
            subType: null,
            line: 6,
            column: 2,
        });
        const record = Object.freeze({
            address: Object.freeze({ canonical: "demo-note-lore-border" }),
            names: Object.freeze([occurrence]),
        });
        const rows = namesRows(new Set([record]));
        rows[0].name = "Changed output";
        expect(record.names[0]).toBe(occurrence);
        expect(record.names[0].name).toBe("Ravenmoor");
        expect(namesRows([record])[0].name).toBe("Ravenmoor");
    });
});
