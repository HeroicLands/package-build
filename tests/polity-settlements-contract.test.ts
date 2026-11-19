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
import {
    assertSettlementRecords,
    checkSettlementTables,
    settlementMarkdown,
} from "../engine/settlement-tables.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { checkDataKeys } from "../engine/data-keys.mjs";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import YAML from "yaml";

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
            "households",
            "economicFocus",
            "generatorSource",
        ]);
        expect(SETTLEMENTS_FIELD.kind).toBe("list");
    });
    it("places the settlement list and territorial population on affiliations", () => {
        const affiliation = NOTE_VOCABULARY.affiliation.data.map((field) => field.name);
        const place = NOTE_VOCABULARY.place.data.map((field) => field.name);
        expect(affiliation).toContain("settlements");
        expect(affiliation).toContain("territorial_population");
        expect(place).not.toContain("settlements");
        expect(NOTE_VOCABULARY.lore.data.map((field) => field.name)).toContain("householdSize");
        expect(place).toEqual(
            expect.arrayContaining([
                "type",
                "fortification",
                "stronghold",
                "holder",
                "market",
                "notes",
                "households",
                "economicFocus",
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
    it("allows unknown location, holder and notes while checking supplied values", () => {
        const unknown: Partial<typeof row> = { ...row };
        delete unknown.location;
        delete unknown.holder;
        delete unknown.notes;
        const { polity, index } = corpus([unknown]);
        expect(checkSettlementTables(polity, { index })).toEqual([]);
        expect(settlementMarkdown(polity.fm)).toContain(
            "|  | Homestead | None | None |  | 100 | Subsistence |  |",
        );
        for (const [key, value] of [
            ["location", "place-missing"],
            ["holder", ""],
            ["notes", ""],
        ]) {
            const invalid = corpus([{ ...unknown, [key]: value }]);
            expect(
                checkSettlementTables(invalid.polity, { index: invalid.index }).some((finding) =>
                    finding.message.includes(key),
                ),
            ).toBe(true);
        }
    });
    it("accepts authoring facts without applying economic or map rules", () => {
        const { polity, index } = corpus([
            {
                ...row,
                households: 0,
                economicFocus: "mining",
                generatorSource: { mapId: "map-1", kind: "cell", id: 123, slot: 0 },
            },
        ]);
        expect(checkSettlementTables(polity, { index })).toEqual([]);
        expect(checkDataKeys(polity, [SETTLEMENTS_FIELD])).toEqual([]);
        const unknown = corpus([{ ...row, households: null, economicFocus: "custom livelihood" }]);
        expect(checkSettlementTables(unknown.polity, { index: unknown.index })).toEqual([]);
        expect(checkDataKeys(unknown.polity, [SETTLEMENTS_FIELD])).toEqual([]);
    });
    it.each([-1, 1.5])("rejects household count %s on rows and notes", (households) => {
        const { polity, index } = corpus([{ ...row, households }]);
        polity.raw = `---\n${YAML.stringify(polity.fm)}---\n`;
        const result = lintNote(polity, {
            schemas: NOTE_SCHEMAS,
            vocabulary: NOTE_VOCABULARY,
            index,
        });
        expect(result.find((finding) => finding.message.includes("households"))).toMatchObject({
            line: expect.any(Number),
            column: expect.any(Number),
        });
        const place = {
            file: "settlement.md",
            fm: {
                type: "place",
                subType: "settlement",
                shortcode: "settlement",
                data: { population: null, notes: "A place.", households },
            },
            raw: "",
        };
        place.raw = `---\n${YAML.stringify(place.fm)}---\n`;
        const placeIndex = { ...index, notes: [...index.notes, place] };
        const findings = lintNote(place, {
            schemas: NOTE_SCHEMAS,
            vocabulary: NOTE_VOCABULARY,
            index: placeIndex,
        });
        expect(findings.find((finding) => finding.message.includes("households"))).toMatchObject({
            line: expect.any(Number),
            column: expect.any(Number),
        });
    });
    it.each([undefined, null, 0, 4])(
        "accepts household count %s on a settlement note",
        (households) => {
            const { index } = corpus([]);
            const data = {
                population: null,
                notes: "A place.",
                ...(households === undefined ? {} : { households }),
            };
            const place = {
                file: "settlement.md",
                fm: { type: "place", subType: "settlement", shortcode: "settlement", data },
                raw: "",
            };
            place.raw = `---\n${YAML.stringify(place.fm)}---\n`;
            const findings = lintNote(place, {
                schemas: NOTE_SCHEMAS,
                vocabulary: NOTE_VOCABULARY,
                index: { ...index, notes: [...index.notes, place] },
            });
            expect(findings.filter((finding) => finding.message.includes("households"))).toEqual(
                [],
            );
        },
    );
    it.each([
        {},
        { mapId: "", kind: "cell", id: 0 },
        { mapId: "map", kind: "other", id: 0 },
        { mapId: "map", kind: "cell", id: -1 },
        { mapId: "map", kind: "cell", id: 0, slot: -1 },
        { mapId: "map", kind: "cell", id: 0, slot: null },
        { mapId: "map", kind: "burg", id: 0, slot: 0 },
        { mapId: "map", kind: "cell", id: 0, extra: 1 },
    ])("rejects invalid source identity %#", (generatorSource) => {
        const { polity, index } = corpus([{ ...row, generatorSource }]);
        polity.raw = `---\n${YAML.stringify(polity.fm)}---\n`;
        const findings = lintNote(polity, {
            schemas: NOTE_SCHEMAS,
            vocabulary: NOTE_VOCABULARY,
            index,
        });
        expect(
            findings.find((finding) => finding.message.includes("generatorSource")),
        ).toMatchObject({ line: expect.any(Number), column: expect.any(Number) });
    });
    it.each([
        { mapId: "map", kind: "cell", id: 0, slot: 0 },
        { mapId: "map", kind: "cell", id: 0 },
        { mapId: "map", kind: "burg", id: 0 },
    ])("accepts a valid source identity %#", (generatorSource) => {
        const { polity, index } = corpus([{ ...row, households: 1, generatorSource }]);
        const findings = lintNote(polity, {
            schemas: NOTE_SCHEMAS,
            vocabulary: NOTE_VOCABULARY,
            index,
        });
        expect(
            findings.filter((finding) => /generatorSource|households/.test(finding.message)),
        ).toEqual([]);
    });
    it.each([
        {},
        { mapId: "map", kind: "wrong", id: 0 },
        { mapId: "map", kind: "cell", id: 0, extra: 1 },
        { mapId: "map", kind: "cell", id: 0, slot: null },
    ])("rejects an invalid source identity during publication %#", (generatorSource) => {
        const { index } = corpus([{ ...row, generatorSource }]);
        const records = index.notes.map((note) => ({ ...note.fm, package: "test" }));
        expect(() =>
            assertSettlementRecords(records, {
                fileOf: (fm: any) => `${fm.shortcode}.md`,
                rawOf: () => "",
            }),
        ).toThrow(/generatorSource/);
    });
    it.each([
        { mapId: "map", kind: "cell", id: 0 },
        { mapId: "map", kind: "cell", id: 0, slot: 0 },
    ])("accepts a valid source identity during publication %#", (generatorSource) => {
        const { index } = corpus([{ ...row, generatorSource }]);
        const records = index.notes.map((note) => ({ ...note.fm, package: "test" }));
        expect(() =>
            assertSettlementRecords(records, {
                fileOf: (fm: any) => `${fm.shortcode}.md`,
                rawOf: () => "",
            }),
        ).not.toThrow();
    });
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
