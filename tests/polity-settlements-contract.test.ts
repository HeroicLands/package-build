/*
 * Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from "vitest";
import {
    SETTLEMENT_COLUMNS,
    SETTLEMENT_ROW_FIELDS,
    SETTLEMENTS_FIELD,
} from "../engine/settlement-terms.mjs";
import { checkSettlementTables } from "../engine/settlement-tables.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";

describe("polity settlement contract", () => {
    it("declares the complete table and row vocabulary", () => {
        expect(SETTLEMENT_COLUMNS.map((column) => column.name)).toEqual([
            "Settlement",
            "Polity",
            "Location",
            "Type",
            "Fortification",
            "Stronghold",
            "Holder",
            "Population",
            "Market",
            "Notes",
        ]);
        expect(SETTLEMENT_ROW_FIELDS.map((field) => field.name)).toEqual([
            "settlement",
            "polity",
            "location",
            "type",
            "fortification",
            "stronghold",
            "holder",
            "population",
            "market",
            "notes",
        ]);
        expect(SETTLEMENTS_FIELD.kind).toBe("list");
    });
    it("places the settlement list and territorial population on affiliations", () => {
        const affiliation = NOTE_VOCABULARY.affiliation.data.map((field) => field.name);
        const place = NOTE_VOCABULARY.place.data.map((field) => field.name);
        expect(affiliation).toContain("settlements");
        expect(affiliation).toContain("territorial_population");
        expect(place).not.toContain("settlements");
        expect(place).toEqual(
            expect.arrayContaining([
                "type",
                "fortification",
                "stronghold",
                "holder",
                "market",
                "notes",
            ]),
        );
    });
});

describe("settlement population and hierarchy", () => {
    const row = {
        settlement: "East Farm",
        polity: "affiliation-crown",
        location: "place-vale",
        type: "homestead",
        fortification: null,
        stronghold: null,
        holder: "The Crown",
        population: 100,
        market: "subsistence",
        notes: "A farm by the road.",
    };
    function corpus(rows: object[], total = 100) {
        const polity = {
            file: "Crown.md",
            raw: "---\ndata:\n  settlements: []\n---\n",
            fm: {
                type: "affiliation",
                subType: "polity",
                shortcode: "crown",
                data: { settlements: rows, territorial_population: total },
            },
        };
        const place = {
            file: "Vale.md",
            fm: { type: "place", subType: "region", shortcode: "vale" },
        };
        const hits: Record<string, object> = { "affiliation-crown": polity, "place-vale": place };
        return {
            polity,
            index: {
                notes: [polity, place],
                contentPackage: "test",
                resolve: (key: string) => hits[key],
            },
        };
    }
    it("locates a finding at the authored field", () => {
        const { polity, index } = corpus([{ ...row, market: "weekly" }]);
        polity.raw = "---\ndata:\n  settlements:\n    - market: weekly\n---\n";
        const finding = checkSettlementTables(polity, { index }).find((item) =>
            item.message.includes("market"),
        );
        expect(finding).toBeDefined();
        expect(finding).toMatchObject({ line: 4, column: 7 });
    });
    it("rejects an invalid market and a complete-table total outside tolerance", () => {
        const { polity, index } = corpus([{ ...row, market: "weekly" }], 200);
        const findings = checkSettlementTables(polity, {
            index,
            settlementPopulation: { mode: "complete" },
        });
        expect(findings.some((finding) => finding.message.includes("market"))).toBe(true);
        expect(findings.some((finding) => finding.message.includes("territorial population"))).toBe(
            true,
        );
    });
});
