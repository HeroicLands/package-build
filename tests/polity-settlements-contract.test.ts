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

describe("population declarations", () => {
    it.each([
        ["population: null", 15, "`data.population` must be a population map"],
        [
            "population: 12",
            15,
            "`data.population` should be a population with actual and optional apparent figures, but reads 12",
        ],
        ["population: []", 15, "`data.population` must be a population map"],
        [
            "population: {actual: nope}",
            24,
            '`data.population.actual` should be a number or null, but reads "nope"',
        ],
        [
            "population: {actual: 100, apparent: nope}",
            39,
            '`data.population.apparent` should be a number or null, but reads "nope"',
        ],
    ])("locates malformed declaration %s", (line, column, message) => {
        const raw = `---\ntype: place\nsubType: region\nshortcode: valley\ndata:\n  ${line}\n---\n`;
        const note = { file: "valley.md", raw, fm: YAML.parse(raw.split("---\n")[1]) };
        const findings = lintNote(note, { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY });
        expect(findings).toContainEqual(
            expect.objectContaining({
                file: "valley.md",
                line: 6,
                column,
                severity: "error",
                message,
            }),
        );
    });
    it("reports inline null once at the population value", () => {
        const raw =
            "---\ntype: affiliation\nsubType: polity\nshortcode: example\ndata:\n  settlements:\n    - population: null\n---\n";
        const note = { file: "example.md", raw, fm: YAML.parse(raw.split("---\n")[1]) };
        const findings = lintNote(note, { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY });
        const population = findings.filter((finding) => finding.message.includes("population"));
        expect(population).toHaveLength(1);
        expect(population[0]).toMatchObject({
            line: 7,
            message: expect.stringContaining("must be a population map"),
        });
    });
    it("requires a closed actual and apparent map", () => {
        const fields = NOTE_VOCABULARY.affiliation.data;
        const note = (population: unknown) => ({
            file: "note.md",
            raw: "---\ndata:\n  population: 9\n---\n",
            fm: { data: { population } },
        });
        expect(checkDataKeys(note({ actual: 12, apparent: 0 }), fields)).toEqual([]);
        expect(checkDataKeys(note({ actual: "12", apparent: "0" }), fields)).toEqual([]);
        expect(checkDataKeys(note({ actual: null, apparent: null }), fields)).toEqual([]);
        expect(checkDataKeys(note({ apparent: 12 }), fields).length).toBeGreaterThan(0);
        expect(checkDataKeys(note({ actual: 12, extra: 1 }), fields).length).toBeGreaterThan(0);
    });
});

describe("population publication preflight", () => {
    const run = (data: object, subType = "guild") => {
        const fm = { type: "affiliation", subType, shortcode: "example", package: "test", data };
        const raw = `---\n${YAML.stringify(fm)}---\n`;
        return () =>
            assertSettlementRecords([fm], { fileOf: () => "Example.md", rawOf: () => raw });
    };
    it.each([
        null,
        [],
        [1],
        4,
        "4",
        {},
        { apparent: 4 },
        { actual: 4, extra: 1 },
        { actual: "bad", apparent: 4 },
    ])("refuses malformed membership values before publication: %j", (population) => {
        expect(run({ population })).toThrow(/^Example\.md:\d+:\d+: error:/);
    });
    it.each([
        null,
        [],
        4,
        { apparent: 4 },
        { actual: 4, extra: 1 },
        { actual: "bad", apparent: 4 },
    ])("refuses malformed territorial values before publication: %j", (territorial_population) => {
        expect(run({ territorial_population }, "polity")).toThrow(/^Example\.md:\d+:\d+: error:/);
    });
    it.each([
        null,
        [],
        4,
        { apparent: 4 },
        { actual: 0, extra: 1 },
        { actual: "bad", apparent: 4 },
    ])("refuses malformed inline values before publication: %j", (population) => {
        expect(
            run(
                { settlements: [{ population }], territorial_population: { actual: 100 } },
                "polity",
            ),
        ).toThrow(/^Example\.md:\d+:\d+: error:/);
    });
    it("rejects an invalid actual settlement figure even with a valid apparent figure", () => {
        const fm = {
            type: "place",
            subType: "settlement",
            shortcode: "village",
            package: "test",
            data: { population: { actual: 101, apparent: 100 }, notes: "A village." },
        };
        const raw = `---\n${YAML.stringify(fm)}---\n`;
        expect(() =>
            assertSettlementRecords([fm], { fileOf: () => "Village.md", rawOf: () => raw }),
        ).toThrow(/^Village\.md:\d+:\d+: error:/);
    });
    it("accepts numeric string membership without changing its value", () => {
        expect(run({ population: { actual: "1200", apparent: "1200" } })).not.toThrow();
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
        population: { actual: 100 },
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
                data: { settlements: rows, territorial_population: { actual: total } },
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
    it("validates actual counts and renders the selected audience", () => {
        const { polity, index } = corpus(
            [{ ...row, population: { actual: 200, apparent: 0 } }],
            100,
        );
        expect(
            checkSettlementTables(polity, { index }).some((finding) =>
                finding.message.includes("territorial"),
            ),
        ).toBe(true);
        expect(settlementMarkdown(polity.fm, [polity.fm], { audience: "public" })).toContain(
            "| 0 |",
        );
        expect(settlementMarkdown(polity.fm, [polity.fm], { audience: "all" })).toContain(
            "| 200 |",
        );
        const unknown = corpus([{ ...row, population: { actual: 100, apparent: null } }]);
        expect(checkSettlementTables(unknown.polity, { index: unknown.index })).toEqual([]);
        expect(settlementMarkdown(unknown.polity.fm)).not.toContain("| 100 |");
    });
    it("uses actual rather than apparent for population validation", () => {
        const invalid = corpus([{ ...row, population: { actual: 101, apparent: 100 } }]);
        expect(
            checkSettlementTables(invalid.polity, { index: invalid.index }).some((finding) =>
                finding.message.startsWith("people figure:"),
            ),
        ).toBe(true);
        for (const apparent of [0, null]) {
            const valid = corpus([{ ...row, population: { actual: 100, apparent } }]);
            expect(checkSettlementTables(valid.polity, { index: valid.index })).toEqual([]);
        }
    });
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
        expect(result.filter((finding) => finding.message.includes("households"))).toHaveLength(1);
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
                data: { population: { actual: null }, notes: "A place.", households },
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
                population: { actual: null },
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
        const sourceFindings = findings.filter((finding) =>
            finding.message.includes("generatorSource"),
        );
        if (generatorSource.id === -1) expect(sourceFindings).toHaveLength(1);
        expect(sourceFindings[0]).toMatchObject({
            line: expect.any(Number),
            column: expect.any(Number),
        });
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
        { mapId: "map", kind: "cell", id: -1 },
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
    it.each([-1, 1.5, "bad"])("locates invalid households during publication: %s", (households) => {
        const { polity, index } = corpus([{ ...row, households }]);
        polity.raw = `---\n${YAML.stringify(polity.fm)}---\n`;
        const records = index.notes.map((note) => ({ ...note.fm, package: "test" }));
        try {
            assertSettlementRecords(records, {
                fileOf: (fm: any) => (fm.shortcode === "crown" ? polity.file : "Vale.md"),
                rawOf: (file: string) => (file === polity.file ? polity.raw : ""),
            });
            throw new Error("expected publication to reject households");
        } catch (error: any) {
            const findings = error.findings?.filter((finding: any) =>
                finding.message.includes("households"),
            );
            expect(findings).toHaveLength(1);
            expect(findings[0]).toMatchObject({
                file: "Crown.md",
                line: expect.any(Number),
                column: expect.any(Number),
            });
        }
    });
    it.each(["", "   "])(
        "rejects an empty livelihood during lint and publication",
        (economicFocus) => {
            const { polity, index } = corpus([{ ...row, economicFocus }]);
            polity.raw = `---\n${YAML.stringify(polity.fm)}---\n`;
            expect(
                lintNote(polity, {
                    schemas: NOTE_SCHEMAS,
                    vocabulary: NOTE_VOCABULARY,
                    index,
                }).filter((finding) => finding.message.includes("economicFocus")),
            ).toHaveLength(1);
            const records = index.notes.map((note) => ({ ...note.fm, package: "test" }));
            expect(() =>
                assertSettlementRecords(records, {
                    fileOf: (fm: any) => (fm.shortcode === "crown" ? polity.file : "Vale.md"),
                    rawOf: (file: string) => (file === polity.file ? polity.raw : ""),
                }),
            ).toThrow(/economicFocus/);
        },
    );
    it.each([7, false, null, "", "   "])(
        "rejects settlement-note livelihood %s in lint and publication",
        (economicFocus) => {
            const { index } = corpus([]);
            const fm = {
                type: "place",
                subType: "settlement",
                shortcode: "village",
                data: { population: { actual: null }, notes: "A village.", economicFocus },
            };
            const note = { file: "Village.md", fm, raw: `---\n${YAML.stringify(fm)}---\n` };
            const findings = lintNote(note, {
                schemas: NOTE_SCHEMAS,
                vocabulary: NOTE_VOCABULARY,
                index: { ...index, notes: [...index.notes, note] },
            });
            expect(findings.filter((finding) => finding.message.includes("economicFocus"))).toEqual(
                [
                    expect.objectContaining({
                        file: "Village.md",
                        line: expect.any(Number),
                        column: expect.any(Number),
                    }),
                ],
            );
            const records = [{ ...fm, package: "test" }];
            try {
                assertSettlementRecords(records, {
                    fileOf: () => note.file,
                    rawOf: () => note.raw,
                });
                throw new Error("expected publication to reject livelihood");
            } catch (error: any) {
                expect(
                    error.findings?.filter((finding: any) =>
                        finding.message.includes("economicFocus"),
                    ),
                ).toEqual([
                    expect.objectContaining({
                        file: "Village.md",
                        line: expect.any(Number),
                        column: expect.any(Number),
                    }),
                ]);
            }
        },
    );
    it("accepts open-text settlement-note livelihood in lint and publication", () => {
        const { index } = corpus([]);
        const fm = {
            type: "place",
            subType: "settlement",
            shortcode: "village",
            data: {
                population: { actual: null },
                notes: "A village.",
                economicFocus: "custom livelihood",
            },
        };
        const note = { file: "Village.md", fm, raw: `---\n${YAML.stringify(fm)}---\n` };
        expect(
            lintNote(note, {
                schemas: NOTE_SCHEMAS,
                vocabulary: NOTE_VOCABULARY,
                index: { ...index, notes: [...index.notes, note] },
            }).filter((finding) => finding.message.includes("economicFocus")),
        ).toEqual([]);
        expect(() =>
            assertSettlementRecords([{ ...fm, package: "test" }], {
                fileOf: () => note.file,
                rawOf: () => note.raw,
            }),
        ).not.toThrow();
    });
    it.each([null, ""])(
        "reports one located invalid required map id in lint and publication: %s",
        (id) => {
            const { polity, index } = corpus([
                { ...row, generatorSource: { mapId: "map", kind: "cell", id } },
            ]);
            polity.raw = `---\n${YAML.stringify(polity.fm)}---\n`;
            const ordinary = lintNote(polity, {
                schemas: NOTE_SCHEMAS,
                vocabulary: NOTE_VOCABULARY,
                index,
            }).filter((finding) => finding.message.includes("generatorSource"));
            expect(ordinary).toEqual([
                expect.objectContaining({
                    file: "Crown.md",
                    line: expect.any(Number),
                    column: expect.any(Number),
                }),
            ]);
            const records = index.notes.map((note) => ({ ...note.fm, package: "test" }));
            try {
                assertSettlementRecords(records, {
                    fileOf: (fm: any) => (fm.shortcode === "crown" ? polity.file : "Vale.md"),
                    rawOf: (file: string) => (file === polity.file ? polity.raw : ""),
                });
                throw new Error("expected publication to reject id");
            } catch (error: any) {
                expect(
                    error.findings?.filter((finding: any) =>
                        finding.message.includes("generatorSource"),
                    ),
                ).toEqual([
                    expect.objectContaining({
                        file: "Crown.md",
                        line: expect.any(Number),
                        column: expect.any(Number),
                    }),
                ]);
            }
        },
    );
    it.each([
        ["culture", 0],
        ["culture", -3],
        ["legend", 4],
    ])("rejects invalid household size for %s", (subType, householdSize) => {
        const fm = { type: "lore", subType, shortcode: "example", data: { householdSize } };
        const note = { file: "Culture.md", fm, raw: `---\n${YAML.stringify(fm)}---\n` };
        const findings = lintNote(note, { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY });
        expect(findings.filter((finding) => finding.message.includes("householdSize"))).toEqual([
            expect.objectContaining({ line: expect.any(Number), column: expect.any(Number) }),
        ]);
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
