/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createContentSession } from "../engine/content-session.mjs";
import { isNoteRecord } from "../engine/index-records.mjs";
import { checkSettlementTables, settlementMembership } from "../engine/settlement-tables.mjs";
import { prepareSettlementInputs } from "../engine/settlement-inputs.mjs";
import { proposeSettlements } from "../engine/settlement-generate.mjs";
import { proposeUrbanSupply } from "../engine/settlement-urban.mjs";
import { SETTLEMENT_MODEL_DEFAULTS } from "../engine/settlement-model.mjs";
import { prepareSettlementEdit } from "../engine/settlement-source.mjs";
import { markComplete, metadataFileName } from "../engine/metadata-index.mjs";
import { fixture, note, write } from "./content-session-fixture.js";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("settlement membership from a content session", () => {
    it("resolves direct subordinates, a seat and a governed settlement by address", async () => {
        const input = fixture();
        roots.push(input.root);
        const content = input.config.paths.content;
        const add = (filename: string, fm: object) => write(path.join(content, filename), note(fm));
        add("Crown.md", {
            type: "affiliation",
            subType: "polity",
            shortcode: "crown",
            name: { full: "Crown" },
            data: { seat: "place-capital", territorial_population: { actual: 1000 } },
        });
        add("Council.md", {
            type: "affiliation",
            subType: "polity",
            shortcode: "council",
            name: { full: "Council" },
            data: { parents: ["affiliation-crown"] },
        });
        add("Capital.md", {
            type: "place",
            subType: "settlement",
            shortcode: "capital",
            name: { full: "Capital" },
            data: { government: "affiliation-crown", population: { actual: 0 } },
        });
        const session = await createContentSession({ config: input.config });
        try {
            const crown = session.records.find(
                (record: any) => record.shortcode === "crown" && !record.documents,
            )!;
            const membership = settlementMembership(crown, session.records);
            expect(membership.polities.map((entry: any) => entry.address)).toEqual([
                "sessionproof-note-affiliation-council",
            ]);
            expect(membership.settlements.map((entry: any) => entry.address)).toEqual([
                "sessionproof-note-place-capital",
            ]);
            expect(membership.settlements[0].record.data.population).toBe(0);
        } finally {
            session.dispose();
        }
    });
});

async function assemblyFixture(
    unknown = false,
    urban = false,
    subordinate = false,
    badGovernment = false,
    otherCulture = false,
    dependency = false,
    missingCulture = false,
) {
    const input = fixture();
    roots.push(input.root);
    const content = input.config.paths.content;
    const polityAddress = "sessionproof-note-affiliation-crown";
    const noteAddress = "sessionproof-note-place-capital";
    const cultureAddress = "sessionproof-note-lore-folk";
    const source = (slot: number) => ({ mapId: "map", kind: "cell", id: 7, slot });
    const crownFile = path.join(content, "Crown.md");
    const capitalFile = path.join(content, "Capital.md");
    const original = note(
        {
            type: "affiliation",
            subType: "polity",
            shortcode: "crown",
            name: { full: "Crown" },
            data: {
                territorial_population: { actual: 500 },
                ...(dependency ? { seat: "other-note-place-port" } : {}),
                settlements: [
                    {
                        settlement: "Farm",
                        polity: "affiliation-crown",
                        type: "village",
                        population: { actual: 0 },
                        households: unknown ? null : 0,
                        market: "subsistence",
                        generatorSource: source(0),
                    },
                ],
            },
        },
        "Unrelated text stays intact.",
    );
    write(crownFile, original);
    const capitalRaw = note({
        type: "place",
        subType: "settlement",
        shortcode: "capital",
        name: { full: "Capital" },
        data: {
            government: badGovernment ? "affiliation-missing" : "affiliation-crown",
            type: urban ? "city" : "village",
            households: 5,
            population: { actual: 300 },
            ...(otherCulture ? { culture: "lore-otherfolk" } : {}),
        },
    });
    write(capitalFile, capitalRaw);
    if (subordinate)
        write(
            path.join(content, "Child.md"),
            note({
                type: "affiliation",
                subType: "polity",
                shortcode: "child",
                name: { full: "Child" },
                data: { parents: ["affiliation-crown"], territorial_population: { actual: 50 } },
            }),
        );
    write(
        path.join(content, "Note3.md"),
        note({
            type: "lore",
            subType: "culture",
            shortcode: "folk",
            name: { full: "Folk" },
            data: { householdSize: 5 },
        }),
    );
    if (otherCulture)
        write(
            path.join(content, "OtherCulture.md"),
            note({
                type: "lore",
                subType: "culture",
                shortcode: "otherfolk",
                name: { full: "Other Folk" },
                data: missingCulture ? { lang: "en" } : { lang: "en", householdSize: 10 },
            }),
        );
    const cache = path.join(input.root, "dependency-cache");
    const config =
        dependency ?
            {
                ...input.config,
                paths: { ...input.config.paths, metadataCache: cache },
                relationships: {
                    ...input.config.relationships,
                    requires: [{ id: "other", manifest: "https://example.invalid/other.json" }],
                },
            }
        :   input.config;
    if (dependency) {
        const dir = path.join(cache, "other@1.0.0");
        const reference = (address: string) => ({ address, anchor: null, anchorKind: null });
        const record = (type: string, subType: string, shortcode: string, data: object) => ({
            package: "other",
            type,
            subType,
            shortcode,
            name: { full: shortcode },
            address: {
                slug: `${type}-${shortcode}`,
                canonical: `other-${type === "affiliation" ? "sohl" : "note"}-${type}-${shortcode}`,
            },
            anchors: [],
            foundry: null,
            documentation: null,
            data,
        });
        const entries = [
            record("place", "settlement", "port", {
                government: reference(polityAddress),
                type: "village",
                population: { actual: 20 },
            }),
            record("affiliation", "polity", "child", {
                parents: [reference(polityAddress)],
                territorial_population: { actual: 50 },
            }),
        ];
        write(
            path.join(dir, metadataFileName("other")),
            entries.map((item) => JSON.stringify(item)).join("\n") + "\n",
        );
        markComplete(dir, metadataFileName("other"));
    }
    const session = await createContentSession({ config });
    const cell = {
        id: 7,
        biome: { i: 3 },
        elevationScale: 30,
        coast: 0,
        routeLinks: [],
        cultureAddress,
        polityAddress,
        ruralPopulation: 500,
    };
    const map = {
        mapId: "map",
        cells: subordinate || dependency ? [cell, { ...cell, id: 8 }] : [cell],
    };
    const profile = {
        land: [5, 5, 5, 5],
        development: 1,
        holdingAcres: 25,
        foodApproach: "agrarian",
        economicFocus: "agrarian",
        governance: "appointed",
        obligation: 0.3,
        upwardShare: 0.3,
    };
    const settings = {
        urbanShares: {
            [polityAddress]: 0,
            ...(subordinate ? { "sessionproof-note-affiliation-child": 0 } : {}),
            ...(dependency ? { "other-note-affiliation-child": 0 } : {}),
        },
        placements: [0, 1, 2].map((slot) => ({
            cellId: 7,
            source: source(slot),
            areaAcres: 1000,
            cellAreaAcres: 3000,
        })),
        landRules: [{ when: { biome: 3 }, profile }],
        urban: { sources: [], routes: [], cities: [] },
    };
    const bindings = {
        notes: [
            { address: noteAddress, source: source(1) },
            ...(dependency ? [{ address: "other-note-place-port", source: source(2) }] : []),
        ],
        ...(subordinate ?
            { subpolities: [{ address: "sessionproof-note-affiliation-child", cellIds: [8] }] }
        :   {}),
        ...(dependency ?
            { subpolities: [{ address: "other-note-affiliation-child", cellIds: [8] }] }
        :   {}),
    };
    return {
        session,
        polityAddress,
        noteAddress,
        cultureAddress,
        source,
        map,
        bindings,
        settings,
        crownFile,
        capitalFile,
        original,
        capitalRaw,
    };
}

describe("settlement input assembly", () => {
    it("derives missing cell acreage from the already-scaled map area", async () => {
        const f = await assemblyFixture();
        try {
            const map = {
                ...f.map,
                units: { distanceUnit: "mi", distanceScale: 2, areaUnit: "square" },
                cells: [{ ...f.map.cells[0], rawArea: 1, area: 4 }],
            };
            const settings = {
                ...f.settings,
                placements: f.settings.placements.map(
                    ({ cellAreaAcres: _ignored, ...placement }) => ({
                        ...placement,
                        areaAcres: 500,
                    }),
                ),
            };
            const result = prepareSettlementInputs({ ...f, map, settings });
            expect(
                result.resolvedPlacements.map((placement: any) => placement.cellAreaAcres),
            ).toEqual([2560, 2560, 2560]);
            expect(result.ruralInput.placements).toEqual(result.resolvedPlacements);
            expect(result.cellAreaConversions[7]).toMatchObject({
                distanceUnit: "mi",
                distanceScale: 2,
                rawArea: 1,
                scaledArea: 4,
                acres: 2560,
            });
            expect(settings.placements[0]).not.toHaveProperty("cellAreaAcres");
        } finally {
            f.session.dispose();
        }
    });
    it.each([
        ["km", 1000000 / 4046.8564224],
        ["mi", 640],
        ["nmi", 1852 ** 2 / 4046.8564224],
        ["lg", 5760],
        ["nlg", 5556 ** 2 / 4046.8564224],
        ["vr", 1066.8 ** 2 / 4046.8564224],
    ])("uses standard square-%s conversion", async (distanceUnit, expected) => {
        const f = await assemblyFixture();
        try {
            const map = {
                ...f.map,
                units: { distanceUnit, distanceScale: 1, areaUnit: "square" },
                cells: [{ ...f.map.cells[0], rawArea: 1, area: 1 }],
            };
            const settings = {
                ...f.settings,
                placements: f.settings.placements.map(
                    ({ cellAreaAcres: _ignored, ...placement }) => ({ ...placement, areaAcres: 0 }),
                ),
            };
            const result = prepareSettlementInputs({ ...f, map, settings });
            expect(result.resolvedPlacements[0].cellAreaAcres).toBeCloseTo(expected, 9);
            expect(result.cellAreaConversions[7].acres).toBeCloseTo(expected, 9);
        } finally {
            f.session.dispose();
        }
    });
    it("retains explicit zero and null acreage instead of replacing them", async () => {
        const f = await assemblyFixture();
        try {
            const map = {
                ...f.map,
                units: { distanceUnit: "mi", distanceScale: 1, areaUnit: "square" },
                cells: [{ ...f.map.cells[0], rawArea: 1, area: 1 }],
            };
            for (const value of [0, null]) {
                const settings = {
                    ...f.settings,
                    placements: f.settings.placements.map((placement) => ({
                        ...placement,
                        cellAreaAcres: value,
                    })),
                };
                const result = prepareSettlementInputs({ ...f, map, settings });
                expect(result.resolvedPlacements[0].cellAreaAcres).toBe(value);
                expect(result.cellAreaConversions[7]).toBeUndefined();
                expect(result.ruralInput).toBeUndefined();
            }
            const supplied = prepareSettlementInputs({
                ...f,
                map: { ...f.map, units: { distanceUnit: "custom" } },
            });
            expect(supplied.ruralInput.placements[0].cellAreaAcres).toBe(3000);
            expect(supplied.cellAreaConversions[7]).toBeUndefined();
        } finally {
            f.session.dispose();
        }
    });
    it("reports unsupported units, unverified area and mismatched source cells", async () => {
        const f = await assemblyFixture();
        try {
            const settings = {
                ...f.settings,
                placements: f.settings.placements.map(
                    ({ cellAreaAcres: _ignored, ...placement }) => placement,
                ),
            };
            for (const map of [
                {
                    ...f.map,
                    units: { distanceUnit: "custom", distanceScale: 1, areaUnit: "square" },
                    cells: [{ ...f.map.cells[0], rawArea: 1, area: 1 }],
                },
                {
                    ...f.map,
                    units: { distanceUnit: "mi", areaUnit: "square" },
                    cells: [{ ...f.map.cells[0], rawArea: 1, area: 1 }],
                },
                {
                    ...f.map,
                    units: { distanceUnit: "mi", distanceScale: 0, areaUnit: "square" },
                    cells: [{ ...f.map.cells[0], rawArea: 1, area: 0 }],
                },
                {
                    ...f.map,
                    units: { distanceUnit: "mi", distanceScale: 2, areaUnit: "square" },
                    cells: [{ ...f.map.cells[0], rawArea: 1, area: 1 }],
                },
            ]) {
                const result = prepareSettlementInputs({ ...f, map, settings });
                expect(result.ruralInput).toBeUndefined();
                expect(result.missing).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ field: "settings.placements.0.cellAreaAcres" }),
                    ]),
                );
            }
            const map = {
                ...f.map,
                units: { distanceUnit: "mi", distanceScale: 1, areaUnit: "square" },
                cells: [{ ...f.map.cells[0], rawArea: 1, area: 1 }],
            };
            const wrong = {
                ...settings,
                placements: [
                    { ...settings.placements[0], source: { mapId: "map", kind: "cell", id: 8 } },
                ],
            };
            const result = prepareSettlementInputs({ ...f, map, settings: wrong });
            expect(result.ruralInput).toBeUndefined();
            expect(result.missing).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ field: "settings.placements.0.source" }),
                ]),
            );
            expect(result.cellAreaConversions[7]).toBeUndefined();
        } finally {
            f.session.dispose();
        }
    });
    it("retains a verified zero cell area", async () => {
        const f = await assemblyFixture();
        try {
            const map = {
                ...f.map,
                units: { distanceUnit: "mi", distanceScale: 1, areaUnit: "square" },
                cells: [{ ...f.map.cells[0], rawArea: 0, area: 0 }],
            };
            const settings = {
                ...f.settings,
                placements: f.settings.placements.map(
                    ({ cellAreaAcres: _ignored, ...placement }) => ({ ...placement, areaAcres: 0 }),
                ),
            };
            const result = prepareSettlementInputs({ ...f, map, settings });
            expect(result.resolvedPlacements[0].cellAreaAcres).toBe(0);
            expect(result.cellAreaConversions[7].acres).toBe(0);
        } finally {
            f.session.dispose();
        }
    });
    it("adjusts a child's soft default to fit a zero parent share", async () => {
        const f = await assemblyFixture(false, false, true);
        try {
            const result = prepareSettlementInputs({
                ...f,
                settings: { ...f.settings, urbanShares: { [f.polityAddress]: 0 } },
            });
            expect(result.urbanTargets["sessionproof-note-affiliation-child"]).toMatchObject({
                original: 3.75,
                effective: 0,
                adjustment: -3.75,
            });
            expect(result.subpolities[0]).toMatchObject({
                urbanPopulation: 0,
                ruralPopulation: 50,
            });
            expect(result.urbanInput.urbanPopulation).toBe(0);
        } finally {
            f.session.dispose();
        }
    });
    it("raises a child's soft default to fit a high parent share", async () => {
        const f = await assemblyFixture(false, false, true);
        try {
            write(
                path.join(f.session.contentBase, "Child.md"),
                note({
                    type: "affiliation",
                    subType: "polity",
                    shortcode: "child",
                    name: { full: "Child" },
                    data: {
                        parents: ["affiliation-crown"],
                        territorial_population: { actual: 450 },
                    },
                }),
            );
            const session = await createContentSession({ config: f.session.config });
            try {
                const result = prepareSettlementInputs({
                    ...f,
                    session,
                    settings: { ...f.settings, urbanShares: { [f.polityAddress]: 0.9 } },
                });
                expect(result.urbanTargets["sessionproof-note-affiliation-child"]).toMatchObject({
                    original: 33.75,
                    effective: 425,
                });
                expect(result.subpolities[0]).toMatchObject({
                    urbanPopulation: 425,
                    ruralPopulation: 25,
                });
                expect(result.urbanInput.urbanPopulation).toBe(450);
                const impossible = prepareSettlementInputs({
                    ...f,
                    session,
                    settings: {
                        ...f.settings,
                        urbanShares: {
                            [f.polityAddress]: 0.9,
                            "sessionproof-note-affiliation-child": 0,
                        },
                    },
                });
                expect(impossible.urbanInput).toBeUndefined();
                expect(impossible.missing).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            field: `settings.urbanShares.${f.polityAddress}`,
                        }),
                    ]),
                );
            } finally {
                session.dispose();
            }
        } finally {
            f.session.dispose();
        }
    });
    it("honors an explicit child share while adjusting its sibling", async () => {
        const f = await assemblyFixture(false, false, true);
        try {
            for (const [shortcode, filename] of [
                ["child", "Child.md"],
                ["sibling", "Sibling.md"],
            ])
                write(
                    path.join(f.session.contentBase, filename),
                    note({
                        type: "affiliation",
                        subType: "polity",
                        shortcode,
                        name: { full: shortcode },
                        data: {
                            parents: ["affiliation-crown"],
                            territorial_population: { actual: 200 },
                        },
                    }),
                );
            const session = await createContentSession({ config: f.session.config });
            try {
                const sibling = "sessionproof-note-affiliation-sibling";
                const child = "sessionproof-note-affiliation-child";
                const map = { ...f.map, cells: [...f.map.cells, { ...f.map.cells[1], id: 9 }] };
                const bindings = {
                    ...f.bindings,
                    subpolities: [
                        { address: child, cellIds: [8] },
                        { address: sibling, cellIds: [9] },
                    ],
                };
                const result = prepareSettlementInputs({
                    ...f,
                    session,
                    map,
                    bindings,
                    settings: {
                        ...f.settings,
                        urbanShares: { [f.polityAddress]: 0.4, [child]: 0 },
                    },
                });
                expect(result.urbanTargets[child]).toMatchObject({
                    effective: 0,
                    source: "explicit",
                });
                expect(result.urbanTargets[sibling]).toMatchObject({
                    original: 15,
                    effective: 125,
                    adjustment: 110,
                });
                expect(result.urbanInput.urbanPopulation).toBe(200);
                expect(result.ruralInput.ruralPopulation).toBe(300);
            } finally {
                session.dispose();
            }
        } finally {
            f.session.dispose();
        }
    });
    it("raises only the default urban target to reserve an authored city", async () => {
        const f = await assemblyFixture(false, true);
        try {
            const capital = structuredClone(f.session.parsed.get(f.capitalFile).frontmatter);
            capital.data.households = 20;
            write(f.capitalFile, note(capital));
            const session = await createContentSession({ config: f.session.config });
            try {
                const { urbanShares: _ignored, ...base } = f.settings;
                const settings = {
                    ...base,
                    urban: {
                        sources: [],
                        routes: [],
                        cities: [{ identity: f.noteAddress, localFood: 130 }],
                    },
                };
                const result = prepareSettlementInputs({ ...f, session, settings });
                expect(result.urbanTargets[f.polityAddress]).toMatchObject({
                    original: 37.5,
                    effective: 100,
                    adjustment: 62.5,
                });
                expect(result.urbanInput.urbanPopulation).toBe(100);
                expect(result.ruralInput.ruralPopulation).toBe(400);
                expect(result.urbanInput.cities[0].fact.households).toBe(20);
                const explicit = prepareSettlementInputs({
                    ...f,
                    session,
                    settings: { ...settings, urbanShares: { [f.polityAddress]: 0 } },
                });
                expect(explicit.urbanInput).toBeUndefined();
                expect(explicit.missing).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            field: `settings.urbanShares.${f.polityAddress}`,
                        }),
                    ]),
                );
            } finally {
                session.dispose();
            }
        } finally {
            f.session.dispose();
        }
    });
    it("reserves nested cities once when a parent and child share a seat", async () => {
        const f = await assemblyFixture(false, false, true);
        try {
            const childAddress = "sessionproof-note-affiliation-child";
            const grandAddress = "sessionproof-note-affiliation-grand";
            write(
                path.join(f.session.contentBase, "Child.md"),
                note({
                    type: "affiliation",
                    subType: "polity",
                    shortcode: "child",
                    name: { full: "Child" },
                    data: {
                        parents: ["affiliation-crown"],
                        seat: "place-sharedcity",
                        territorial_population: { actual: 200 },
                    },
                }),
            );
            write(
                path.join(f.session.contentBase, "Grand.md"),
                note({
                    type: "affiliation",
                    subType: "polity",
                    shortcode: "grand",
                    name: { full: "Grand" },
                    data: {
                        parents: ["affiliation-child"],
                        seat: "place-sharedcity",
                        territorial_population: { actual: 100 },
                    },
                }),
            );
            write(
                path.join(f.session.contentBase, "ChildCity.md"),
                note({
                    type: "place",
                    subType: "settlement",
                    shortcode: "childcity",
                    name: { full: "Child City" },
                    data: {
                        government: "affiliation-child",
                        type: "town",
                        population: { actual: 80 },
                    },
                }),
            );
            write(
                path.join(f.session.contentBase, "SharedCity.md"),
                note({
                    type: "place",
                    subType: "settlement",
                    shortcode: "sharedcity",
                    name: { full: "Shared City" },
                    data: {
                        government: "affiliation-grand",
                        type: "city",
                        population: { actual: 30 },
                    },
                }),
            );
            const session = await createContentSession({ config: f.session.config });
            try {
                const { urbanShares: _ignored, ...settings } = f.settings;
                const result = prepareSettlementInputs({ ...f, session, settings });
                expect(result.urbanTargets[grandAddress]).toMatchObject({
                    original: 7.5,
                    effective: 30,
                });
                expect(result.urbanTargets[childAddress]).toMatchObject({
                    original: 15,
                    effective: 110,
                });
                expect(result.urbanTargets[f.polityAddress]).toMatchObject({
                    original: 37.5,
                    effective: 110,
                });
                expect(result.subpolities[0]).toMatchObject({
                    urbanPopulation: 110,
                    ruralPopulation: 90,
                });
                expect(result.urbanInput.urbanPopulation).toBe(110);
                expect(fs.readFileSync(f.crownFile, "utf8")).toBe(f.original);
                const explicit = prepareSettlementInputs({
                    ...f,
                    session,
                    settings: { ...settings, urbanShares: { [childAddress]: 0 } },
                });
                expect(explicit.urbanInput).toBeUndefined();
                expect(explicit.missing).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ field: `settings.urbanShares.${childAddress}` }),
                    ]),
                );
            } finally {
                session.dispose();
            }
        } finally {
            f.session.dispose();
        }
    });
    it("reports unknown child households, missing cultures and over-allocation", async () => {
        const f = await assemblyFixture(false, false, true);
        try {
            const cityFile = path.join(f.session.contentBase, "ChildCity.md");
            for (const data of [
                { households: null, population: 10 },
                { households: 2, population: 10 },
                { population: null },
                { population: 1000 },
            ]) {
                write(
                    cityFile,
                    note({
                        type: "place",
                        subType: "settlement",
                        shortcode: "childcity",
                        name: { full: "Child City" },
                        data: {
                            government: "affiliation-child",
                            type: "town",
                            ...data,
                            population: { actual: data.population },
                        },
                    }),
                );
                const session = await createContentSession({ config: f.session.config });
                try {
                    const { urbanShares: _ignored, ...settings } = f.settings;
                    const result = prepareSettlementInputs({ ...f, session, settings });
                    expect(result.ruralInput).toBeUndefined();
                    expect(result.urbanInput).toBeUndefined();
                    const field =
                        data.households === null ? "households"
                        : data.households === 2 ? "householdSize"
                        : data.population === null ? "population"
                        : "data.territorial_population";
                    expect(result.missing).toEqual(
                        expect.arrayContaining([expect.objectContaining({ field })]),
                    );
                } finally {
                    session.dispose();
                }
            }
        } finally {
            f.session.dispose();
        }
    });
    it("reports ambiguous superiors and cycles in the indexed polity tree", async () => {
        const f = await assemblyFixture(false, false, true);
        try {
            const childFile = path.join(f.session.contentBase, "Child.md");
            write(
                path.join(f.session.contentBase, "Other.md"),
                note({
                    type: "affiliation",
                    subType: "polity",
                    shortcode: "other",
                    name: { full: "Other" },
                    data: {
                        parents: ["affiliation-crown"],
                        territorial_population: { actual: 50 },
                    },
                }),
            );
            write(
                childFile,
                note({
                    type: "affiliation",
                    subType: "polity",
                    shortcode: "child",
                    name: { full: "Child" },
                    data: {
                        parents: ["affiliation-crown", "affiliation-other"],
                        territorial_population: { actual: 50 },
                    },
                }),
            );
            let session = await createContentSession({ config: f.session.config });
            try {
                const result = prepareSettlementInputs({ ...f, session });
                expect(result.urbanInput).toBeUndefined();
                expect(result.missing).toEqual(
                    expect.arrayContaining([expect.objectContaining({ field: "data.parents" })]),
                );
            } finally {
                session.dispose();
            }
            const crown = structuredClone(f.session.parsed.get(f.crownFile).frontmatter);
            crown.data.parents = ["affiliation-child"];
            write(f.crownFile, note(crown));
            write(
                childFile,
                note({
                    type: "affiliation",
                    subType: "polity",
                    shortcode: "child",
                    name: { full: "Child" },
                    data: {
                        parents: ["affiliation-crown"],
                        territorial_population: { actual: 50 },
                    },
                }),
            );
            session = await createContentSession({ config: f.session.config });
            try {
                const result = prepareSettlementInputs({ ...f, session });
                expect(result.urbanInput).toBeUndefined();
                expect(result.missing).toEqual(
                    expect.arrayContaining([expect.objectContaining({ field: "data.parents" })]),
                );
            } finally {
                session.dispose();
            }
        } finally {
            f.session.dispose();
        }
    });
    it("reports a shared source between a selected row and subordinate row", async () => {
        const f = await assemblyFixture(false, false, true);
        try {
            write(
                path.join(f.session.contentBase, "Child.md"),
                note({
                    type: "affiliation",
                    subType: "polity",
                    shortcode: "child",
                    name: { full: "Child" },
                    data: {
                        parents: ["affiliation-crown"],
                        territorial_population: { actual: 50 },
                        settlements: [
                            {
                                settlement: "Other Farm",
                                type: "village",
                                population: { actual: 10 },
                                generatorSource: f.source(0),
                            },
                        ],
                    },
                }),
            );
            const session = await createContentSession({ config: f.session.config });
            try {
                const result = prepareSettlementInputs({ ...f, session });
                expect(result.ruralInput).toBeUndefined();
                expect(result.missing).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            field: "generatorSource",
                            message: expect.stringContaining("also bound"),
                        }),
                    ]),
                );
            } finally {
                session.dispose();
            }
        } finally {
            f.session.dispose();
        }
    });
    it("reserves subordinate row identities and reports conflicting cell ownership", async () => {
        const f = await assemblyFixture(false, false, true);
        try {
            write(
                path.join(f.session.contentBase, "Child.md"),
                note({
                    type: "affiliation",
                    subType: "polity",
                    shortcode: "child",
                    name: { full: "Child" },
                    data: {
                        parents: ["affiliation-crown"],
                        territorial_population: { actual: 50 },
                        settlements: [
                            {
                                settlement: "Child Farm",
                                type: "village",
                                population: { actual: 10 },
                                generatorSource: f.source(2),
                            },
                        ],
                    },
                }),
            );
            const session = await createContentSession({ config: f.session.config });
            try {
                const settings = {
                    ...f.settings,
                    placements: [
                        ...f.settings.placements.slice(0, 2),
                        { cellId: 7, areaAcres: 1000, cellAreaAcres: 3000 },
                    ],
                };
                const result = prepareSettlementInputs({ ...f, session, settings });
                expect(result.resolvedPlacements[2].source.slot).toBe(3);
                expect(result.ruralInput).toBeUndefined();
                expect(result.missing).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            field: "generatorSource",
                            message: expect.stringContaining("subordinate"),
                        }),
                    ]),
                );
                const explicit = prepareSettlementInputs({
                    ...f,
                    session,
                    settings: {
                        ...settings,
                        placements: [
                            ...settings.placements.slice(0, 2),
                            {
                                cellId: 7,
                                source: f.source(2),
                                areaAcres: 1000,
                                cellAreaAcres: 3000,
                            },
                        ],
                    },
                });
                expect(explicit.ruralInput).toBeUndefined();
                expect(explicit.missing).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ field: "settings.placements.2.source" }),
                    ]),
                );
            } finally {
                session.dispose();
            }
        } finally {
            f.session.dispose();
        }
    });
    it("retains a bound subordinate note source and rejects a parent claim", async () => {
        const f = await assemblyFixture(false, false, true);
        try {
            const address = "sessionproof-note-place-childfarm";
            const source = { mapId: "map", kind: "cell", id: 8, slot: 2 };
            write(
                path.join(f.session.contentBase, "ChildFarm.md"),
                note({
                    type: "place",
                    subType: "settlement",
                    shortcode: "childfarm",
                    name: { full: "Child Farm" },
                    data: {
                        government: "affiliation-child",
                        type: "village",
                        population: { actual: 10 },
                    },
                }),
            );
            const session = await createContentSession({ config: f.session.config });
            try {
                const bindings = {
                    ...f.bindings,
                    notes: [...f.bindings.notes, { address, source }],
                };
                const result = prepareSettlementInputs({ ...f, session, bindings });
                expect(result.ruralInput).toBeDefined();
                expect(result.subpolities[0]).toMatchObject({
                    urbanPopulation: 0,
                    ruralPopulation: 50,
                });
                const settings = {
                    ...f.settings,
                    placements: [
                        ...f.settings.placements.slice(0, 2),
                        { cellId: 8, source, areaAcres: 1000, cellAreaAcres: 3000 },
                    ],
                };
                const conflicting = prepareSettlementInputs({ ...f, session, bindings, settings });
                expect(conflicting.ruralInput).toBeUndefined();
                expect(conflicting.missing).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ field: "settings.placements.2.source" }),
                    ]),
                );
            } finally {
                session.dispose();
            }
        } finally {
            f.session.dispose();
        }
    });
    it("uses the editable urban share for indexed parent and subordinate totals", async () => {
        const f = await assemblyFixture(false, false, true);
        try {
            const { urbanShares: _ignored, ...settings } = f.settings;
            const result = prepareSettlementInputs({ ...f, settings });
            expect(result.ruralInput.ruralPopulation).toBeCloseTo(462.5);
            expect(result.urbanInput.urbanPopulation).toBeCloseTo(37.5);
            expect(result.subpolities[0]).toMatchObject({
                ruralPopulation: 46.25,
                urbanPopulation: 3.75,
            });
            expect(proposeSettlements(result.ruralInput).reservedPopulation).toBe(71.25);
            const custom = prepareSettlementInputs({
                ...f,
                settings: { ...settings, model: { ...SETTLEMENT_MODEL_DEFAULTS, urbanShare: 0.2 } },
            });
            expect(custom.ruralInput.ruralPopulation).toBe(400);
            expect(custom.urbanInput.urbanPopulation).toBe(100);
            expect(custom.subpolities[0]).toMatchObject({
                ruralPopulation: 40,
                urbanPopulation: 10,
            });
        } finally {
            f.session.dispose();
        }
    });
    it("preserves a stated zero share and reports an invalid or unknown share", async () => {
        const f = await assemblyFixture();
        try {
            const zero = prepareSettlementInputs({
                ...f,
                settings: {
                    ...f.settings,
                    model: { ...SETTLEMENT_MODEL_DEFAULTS, urbanShare: 0.2 },
                },
            });
            expect(zero.ruralInput.ruralPopulation).toBe(500);
            expect(zero.urbanInput.urbanPopulation).toBe(0);
            for (const share of [null, -0.1, 1.1]) {
                const result = prepareSettlementInputs({
                    ...f,
                    settings: { ...f.settings, urbanShares: { [f.polityAddress]: share } },
                });
                expect(result.ruralInput).toBeUndefined();
                expect(result.urbanInput).toBeUndefined();
                expect(result.missing).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            field: `settings.urbanShares.${f.polityAddress}`,
                        }),
                    ]),
                );
            }
            const { urbanShares: _ignored, ...settings } = f.settings;
            const badModel = prepareSettlementInputs({
                ...f,
                settings: {
                    ...settings,
                    model: { ...SETTLEMENT_MODEL_DEFAULTS, urbanShare: null },
                },
            });
            expect(badModel.ruralInput).toBeUndefined();
            expect(badModel.missing).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ field: "settings.model.urbanShare" }),
                ]),
            );
        } finally {
            f.session.dispose();
        }
    });
    it("does not use the default share to replace an unknown territorial population", async () => {
        const f = await assemblyFixture();
        try {
            const initial = prepareSettlementInputs(f);
            const frontmatter = structuredClone(initial.sourceCapture.get(f.crownFile).frontmatter);
            frontmatter.data.territorial_population = { actual: null };
            write(f.crownFile, note(frontmatter, "Unrelated text stays intact."));
            const nextSession = await createContentSession({ config: f.session.config });
            try {
                const { urbanShares: _ignored, ...settings } = f.settings;
                const result = prepareSettlementInputs({ ...f, session: nextSession, settings });
                expect(result.ruralInput).toBeUndefined();
                expect(result.urbanInput).toBeUndefined();
                expect(result.missing).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            file: f.crownFile,
                            field: "data.territorial_population",
                        }),
                    ]),
                );
            } finally {
                nextSession.dispose();
            }
        } finally {
            f.session.dispose();
        }
    });
    it("joins real source captures and indexed facts before running both calculators", async () => {
        const f = await assemblyFixture();
        try {
            const result = prepareSettlementInputs(f);
            expect(result.polity.address.canonical).toMatchObject({
                package: "sessionproof",
                system: "sohl",
                type: "affiliation",
                shortcode: "crown",
            });
            expect(result.existingRows[0].households).toBe(0);
            expect(result.sourceCapture.get(f.crownFile).raw).toBe(f.original);
            expect(result.sourceCapture.get(f.crownFile).frontmatter.data.settlements).toEqual(
                result.existingRows,
            );
            expect(result.sourceCapture.get(f.capitalFile).raw).toBe(f.capitalRaw);
            const edit = prepareSettlementEdit({
                contentRoot: f.session.contentBase,
                contentPackage: f.session.config.contentPackage,
                polityAddress: f.polityAddress,
                records: f.session.records,
                sources: result.sourceCapture,
                rows: result.existingRows,
            });
            expect(edit.changed).toBe(false);
            expect(result.cultureSizes[f.cultureAddress]).toBe(5);
            expect(result.ruralInput.existing).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ identity: "row:0", households: 0, householdSize: 5 }),
                    expect.objectContaining({
                        identity: f.noteAddress,
                        households: 5,
                        population: 300,
                        householdSize: 5,
                    }),
                ]),
            );
            expect(proposeSettlements(result.ruralInput)).toMatchObject({
                reservedPopulation: 25,
                proposedPopulation: 200,
                unallocatedPopulation: 275,
            });
            expect(proposeUrbanSupply(result.urbanInput)).toMatchObject({
                cities: [],
                unallocatedUrbanPopulation: 0,
            });
            expect(result.missing.map((item: any) => item.field)).toEqual(["placement", "naming"]);
            expect(fs.readFileSync(f.crownFile, "utf8")).toBe(f.original);
            expect(fs.readFileSync(f.capitalFile, "utf8")).toBe(f.capitalRaw);
            const duplicate = prepareSettlementInputs({
                ...f,
                settings: { ...f.settings, existing: [{ identity: "row:0", households: 20 }] },
            });
            expect(duplicate.existingFacts[0].fact.households).toBe(0);
            expect(duplicate.ruralInput).toBeUndefined();
            expect(duplicate.missing).toEqual(
                expect.arrayContaining([expect.objectContaining({ field: "settings.existing" })]),
            );
        } finally {
            f.session.dispose();
        }
    });
    it("calculates urban need from authored households and reports unmet food", async () => {
        const f = await assemblyFixture(false, true);
        try {
            const settings = {
                ...f.settings,
                urbanShares: { [f.polityAddress]: 0.2 },
                urban: {
                    cities: [{ identity: f.noteAddress, localFood: 0 }],
                    sources: [{ id: "farm", foodSurplus: 10 }],
                    routes: [
                        {
                            id: "road",
                            city: f.noteAddress,
                            source: "farm",
                            mode: "river",
                            leagues: 0,
                            maxCargo: 10,
                            access: true,
                        },
                    ],
                },
            };
            const result = prepareSettlementInputs({ ...f, settings });
            expect(result.urbanInput.cities[0].fact.households).toBe(5);
            expect(proposeUrbanSupply(result.urbanInput)).toMatchObject({
                cities: [{ populationExact: 25, need: 32.5, unmet: 22.5 }],
                unallocatedUrbanPopulation: 75,
            });
        } finally {
            f.session.dispose();
        }
    });
    it("keeps an authored unknown ahead of supplied copies and reports a location", async () => {
        const f = await assemblyFixture(true);
        try {
            const result = prepareSettlementInputs({
                ...f,
                settings: { ...f.settings, existing: [{ identity: "row:0", households: 20 }] },
            });
            expect(result.existingRows[0].households).toBeNull();
            expect(result.ruralInput).toBeUndefined();
            expect(result.missing).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        file: f.crownFile,
                        field: "households",
                        line: expect.any(Number),
                    }),
                ]),
            );
            const mismatched = prepareSettlementInputs({
                ...f,
                map: {
                    ...f.map,
                    cells: [
                        { ...f.map.cells[0], polityAddress: "sessionproof-note-affiliation-other" },
                    ],
                },
            });
            expect(mismatched.ruralInput).toBeUndefined();
            expect(mismatched.missing).toEqual(
                expect.arrayContaining([expect.objectContaining({ field: "map.polityAddress" })]),
            );
        } finally {
            f.session.dispose();
        }
    });
    it("reports undiscovered placements and naming without producing rows", async () => {
        const f = await assemblyFixture();
        try {
            const result = prepareSettlementInputs({
                ...f,
                settings: { urbanShares: f.settings.urbanShares },
            });
            expect(result.ruralInput).toBeUndefined();
            expect(result.missing.map((item: any) => item.field)).toEqual(
                expect.arrayContaining(["placement", "naming"]),
            );
            expect(result.existingRows).toHaveLength(1);
        } finally {
            f.session.dispose();
        }
    });
    it("reserves directly subordinate totals and requires their explicit cell binding", async () => {
        const f = await assemblyFixture(false, false, true);
        try {
            const result = prepareSettlementInputs(f);
            expect(result.subpolities).toEqual([
                expect.objectContaining({
                    address: "sessionproof-note-affiliation-child",
                    cellIds: [8],
                    ruralPopulation: 50,
                    urbanPopulation: 0,
                }),
            ]);
            expect(proposeSettlements(result.ruralInput)).toMatchObject({
                reservedPopulation: 75,
                unallocatedPopulation: 225,
            });
            const unbound = prepareSettlementInputs({
                ...f,
                bindings: { notes: f.bindings.notes },
            });
            expect(unbound.ruralInput).toBeUndefined();
            expect(unbound.missing).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        field: "bindings.subpolities.sessionproof-note-affiliation-child",
                    }),
                ]),
            );
        } finally {
            f.session.dispose();
        }
    });
    it("refuses duplicate and unrelated subordinate bindings", async () => {
        const f = await assemblyFixture(false, false, true);
        try {
            const child = { address: "sessionproof-note-affiliation-child", cellIds: [8] };
            const duplicate = prepareSettlementInputs({
                ...f,
                bindings: { ...f.bindings, subpolities: [child, { ...child }] },
            });
            expect(duplicate.ruralInput).toBeUndefined();
            expect(duplicate.missing).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        field: "bindings.subpolities.sessionproof-note-affiliation-child",
                        message: "bind the subordinate polity's cells exactly once",
                    }),
                ]),
            );
            const outside = "sessionproof-note-affiliation-outsider";
            const unrelated = prepareSettlementInputs({
                ...f,
                bindings: {
                    ...f.bindings,
                    subpolities: [child, { address: outside, cellIds: [] }],
                },
            });
            expect(unrelated.ruralInput).toBeUndefined();
            expect(unrelated.missing).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        field: "bindings.subpolities",
                        message: `binding ${outside} is not a direct subordinate polity`,
                    }),
                ]),
            );
        } finally {
            f.session.dispose();
        }
    });
    it("locates an unresolved government instead of omitting a possible member", async () => {
        const f = await assemblyFixture(false, false, false, true);
        try {
            const result = prepareSettlementInputs({ ...f, bindings: {} });
            expect(result.ruralInput).toBeUndefined();
            expect(result.missing).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        file: f.capitalFile,
                        field: "data.government",
                        line: expect.any(Number),
                    }),
                ]),
            );
        } finally {
            f.session.dispose();
        }
    });
});

describe("settlement assembly authority and identities", () => {
    it("reserves existing and explicit cell slots before assigning new placements", async () => {
        const f = await assemblyFixture();
        try {
            const placement = (source?: object) => ({
                cellId: 7,
                ...(source ? { source } : {}),
                areaAcres: 1000,
                cellAreaAcres: 5000,
            });
            const settings = {
                ...f.settings,
                placements: [
                    placement(f.source(0)),
                    placement(f.source(1)),
                    placement(),
                    placement(f.source(4)),
                    placement(),
                ],
            };
            const first = prepareSettlementInputs({ ...f, settings });
            expect(first.resolvedPlacements.map((item: any) => item.source.slot)).toEqual([
                0, 1, 2, 4, 3,
            ]);
            expect(first.ruralInput.placements).toEqual(first.resolvedPlacements);
            expect(prepareSettlementInputs({ ...f, settings }).resolvedPlacements).toEqual(
                first.resolvedPlacements,
            );
            const saved = {
                ...settings,
                placements: [
                    placement(f.source(0)),
                    placement(f.source(1)),
                    placement(f.source(2)),
                    placement(f.source(4)),
                    placement(),
                ],
            };
            const frontmatter = structuredClone(first.sourceCapture.get(f.crownFile).frontmatter);
            frontmatter.data.settlements.push({
                ...frontmatter.data.settlements[0],
                settlement: "New Farm",
                generatorSource: f.source(2),
            });
            write(f.crownFile, note(frontmatter, "Unrelated text stays intact."));
            const nextSession = await createContentSession({ config: f.session.config });
            try {
                const next = prepareSettlementInputs({
                    ...f,
                    session: nextSession,
                    settings: saved,
                });
                expect(next.existingRows[1].generatorSource).toEqual(f.source(2));
                expect(next.resolvedPlacements.map((item: any) => item.source.slot)).toEqual([
                    0, 1, 2, 4, 3,
                ]);
                expect(next.ruralInput.placements).toEqual(next.resolvedPlacements);
            } finally {
                nextSession.dispose();
            }
            expect(f.settings.placements[0].source).toEqual(f.source(0));
        } finally {
            f.session.dispose();
        }
    });
    it("rejects duplicate explicit source tuples before assigning new slots", async () => {
        const f = await assemblyFixture();
        try {
            const settings = {
                ...f.settings,
                placements: [
                    {
                        cellId: 7,
                        source: { mapId: "map", kind: "cell", id: 7 },
                        areaAcres: 1,
                        cellAreaAcres: 3,
                    },
                    { cellId: 7, source: f.source(0), areaAcres: 1, cellAreaAcres: 3 },
                    { cellId: 7, areaAcres: 1, cellAreaAcres: 3 },
                ],
            };
            const result = prepareSettlementInputs({ ...f, settings });
            expect(result.ruralInput).toBeUndefined();
            expect(result.missing).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ field: "settings.placements.1.source" }),
                ]),
            );
        } finally {
            f.session.dispose();
        }
    });
    it("uses an explicitly bound note's existing source for its placement", async () => {
        const f = await assemblyFixture();
        try {
            const settings = {
                ...f.settings,
                placements: [
                    { cellId: 7, source: f.source(0), areaAcres: 1000, cellAreaAcres: 3000 },
                    { cellId: 7, noteAddress: f.noteAddress, areaAcres: 1000, cellAreaAcres: 3000 },
                    { cellId: 7, areaAcres: 1000, cellAreaAcres: 3000 },
                ],
            };
            const result = prepareSettlementInputs({ ...f, settings });
            expect(result.resolvedPlacements.map((item: any) => item.source.slot)).toEqual([
                0, 1, 2,
            ]);
            expect(proposeSettlements(result.ruralInput)).toMatchObject({ reservedPopulation: 25 });
            const missingNote = {
                ...settings,
                placements: [
                    { ...settings.placements[1], noteAddress: "sessionproof-note-place-unknown" },
                ],
            };
            const invalid = prepareSettlementInputs({ ...f, settings: missingNote });
            expect(invalid.ruralInput).toBeUndefined();
            expect(invalid.missing).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ field: "settings.placements.0.source" }),
                ]),
            );
        } finally {
            f.session.dispose();
        }
    });
    it("retains an unknown authored count when assigning an independent slot", async () => {
        const f = await assemblyFixture(true);
        try {
            const settings = {
                ...f.settings,
                placements: [
                    ...f.settings.placements.slice(0, 2),
                    { cellId: 7, areaAcres: 1000, cellAreaAcres: 3000 },
                ],
            };
            const result = prepareSettlementInputs({ ...f, settings });
            expect(result.existingRows[0].households).toBeNull();
            expect(result.resolvedPlacements[2].source).toEqual(f.source(2));
            expect(result.ruralInput).toBeUndefined();
            expect(result.missing).toEqual(
                expect.arrayContaining([expect.objectContaining({ field: "households" })]),
            );
        } finally {
            f.session.dispose();
        }
    });
    it("uses an indexed settlement culture for rural reservations ahead of the map", async () => {
        const f = await assemblyFixture(false, false, false, false, true);
        try {
            const result = prepareSettlementInputs(f);
            const culture = "sessionproof-note-lore-otherfolk";
            expect(result.cultureSizes[culture]).toBe(10);
            expect(
                result.missing.filter((item: any) => !["placement", "naming"].includes(item.field)),
            ).toEqual([]);
            expect(result.ruralInput.existing).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        identity: f.noteAddress,
                        households: 5,
                        householdSize: 10,
                    }),
                ]),
            );
            expect(proposeSettlements(result.ruralInput)).toMatchObject({ reservedPopulation: 50 });
        } finally {
            f.session.dispose();
        }
    });
    it("uses the indexed culture for urban food need rather than the mapped culture", async () => {
        const f = await assemblyFixture(false, true, false, false, true);
        try {
            const settings = {
                ...f.settings,
                urbanShares: { [f.polityAddress]: 0.2 },
                urban: {
                    cities: [{ identity: f.noteAddress, localFood: 0 }],
                    sources: [{ id: "farm", foodSurplus: 20 }],
                    routes: [
                        {
                            id: "route",
                            city: f.noteAddress,
                            source: "farm",
                            mode: "river",
                            leagues: 0,
                            maxCargo: 20,
                            access: true,
                        },
                    ],
                },
            };
            const result = prepareSettlementInputs({ ...f, settings });
            expect(
                result.missing.filter((item: any) => !["placement", "naming"].includes(item.field)),
            ).toEqual([]);
            expect(result.urbanInput.cities[0].cultureAddress).toBe(
                "sessionproof-note-lore-otherfolk",
            );
            expect(proposeUrbanSupply(result.urbanInput)).toMatchObject({
                cities: [{ populationExact: 50, need: 65, unmet: 45 }],
            });
        } finally {
            f.session.dispose();
        }
    });
    it("reports an undeclared authored culture size instead of substituting the map size", async () => {
        const f = await assemblyFixture(false, false, false, false, true, false, true);
        try {
            const result = prepareSettlementInputs(f);
            expect(result.ruralInput).toBeUndefined();
            expect(result.missing).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        file: f.capitalFile,
                        field: "culture sessionproof-note-lore-otherfolk",
                    }),
                ]),
            );
        } finally {
            f.session.dispose();
        }
    });
    it("includes a dependency seat and direct subordinate in the same session", async () => {
        const f = await assemblyFixture(false, false, false, false, false, true);
        try {
            expect(f.session.foreign.index.has("other-note-place-port")).toBe(true);
            const result = prepareSettlementInputs(f);
            expect(result.existingFacts).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        fact: expect.objectContaining({
                            identity: "other-note-place-port",
                            population: 20,
                        }),
                    }),
                ]),
            );
            expect(result.subpolities).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        address: "other-note-affiliation-child",
                        ruralPopulation: 50,
                        cellIds: [8],
                    }),
                ]),
            );
            expect(proposeSettlements(result.ruralInput)).toMatchObject({ reservedPopulation: 95 });
        } finally {
            f.session.dispose();
        }
    });
    it("reports shared rural and urban sources before either calculation, even without placements", async () => {
        const f = await assemblyFixture(false, true);
        try {
            const bindings = {
                notes: [{ address: f.noteAddress, source: { mapId: "map", kind: "cell", id: 7 } }],
            };
            const settings = {
                ...f.settings,
                urbanShares: { [f.polityAddress]: 0.2 },
                urban: {
                    cities: [{ identity: f.noteAddress, localFood: 0 }],
                    sources: [],
                    routes: [],
                },
            };
            for (const current of [
                settings,
                { ...settings, placements: undefined, landRules: undefined },
            ]) {
                const result = prepareSettlementInputs({ ...f, bindings, settings: current });
                expect(result.ruralInput).toBeUndefined();
                expect(result.urbanInput).toBeUndefined();
                expect(result.missing).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            field: "generatorSource",
                            message: expect.stringContaining("also bound"),
                        }),
                    ]),
                );
            }
            const distinct = prepareSettlementInputs({ ...f, settings });
            expect(distinct.missing.some((item: any) => item.message.includes("also bound"))).toBe(
                false,
            );
            const invalidBurg = prepareSettlementInputs({
                ...f,
                map: {
                    ...f.map,
                    cells: [
                        {
                            ...f.map.cells[0],
                            burg: { i: 11 },
                            burgCultureAddress: f.cultureAddress,
                        },
                    ],
                },
                bindings: {
                    notes: [
                        {
                            address: f.noteAddress,
                            source: { mapId: "map", kind: "burg", id: 11, slot: 0 },
                        },
                    ],
                },
                settings,
            });
            expect(invalidBurg.urbanInput).toBeUndefined();
            expect(invalidBurg.missing).toEqual(
                expect.arrayContaining([expect.objectContaining({ field: "generatorSource" })]),
            );
        } finally {
            f.session.dispose();
        }
    });
});

describe("automatic rural placement", () => {
    it("selects whole households and preserves the assembler's identities and remainder", async () => {
        const f = await assemblyFixture();
        try {
            const { selectSettlementPlacements } =
                await import("../engine/settlement-selection.mjs");
            const cell = {
                ...f.map.cells[0],
                boundary: [
                    [0, 0],
                    [6, 0],
                    [6, 6],
                    [0, 6],
                ],
                rawArea: 36,
                area: 36,
            };
            const map = {
                ...f.map,
                mapHash: "map-hash",
                jsonHash: "json-hash",
                units: { distanceUnit: "nmi", distanceScale: 1, areaUnit: "square nmi" },
                cells: [cell],
            };
            const settings = {
                ...f.settings,
                placements: f.settings.placements
                    .slice(0, 2)
                    .map((p: any) => ({ ...p, areaAcres: 0, cellAreaAcres: undefined })),
            };
            for (const p of settings.placements) delete p.cellAreaAcres;
            const before = fs.readFileSync(f.crownFile, "utf8");
            const baseline = prepareSettlementInputs({ ...f, map, settings });
            const existingSites = baseline.existingFacts.map((entry: any, i: number) => ({
                identity: entry.fact.identity,
                point: [0, i],
            }));
            const selection = {
                cellIds: [7],
                existingSites,
                spacingMeters: 5556,
                candidateLimit: 100,
                workLimit: 1000000000,
            };
            const result = selectSettlementPlacements({ ...f, map, settings }, selection);
            expect(result.selection.result.reservedPopulation).toBe(25);
            expect(result.selection.result.unallocatedPopulation).toBe(
                result.selection.allocation.unallocatedPopulation,
            );
            expect(
                result.selection.candidates
                    .filter((c: any) => c.households)
                    .every(
                        (c: any) =>
                            c.areaAcres <= c.ceilingAcres &&
                            c.areaAcres === c.households * c.holdingAcres,
                    ),
            ).toBe(true);
            expect(selectSettlementPlacements({ ...f, map, settings }, selection)).toEqual(result);
            expect(fs.readFileSync(f.crownFile, "utf8")).toBe(before);
            const sevenSession = {
                ...f.session,
                records: f.session.records.map((record: any) =>
                    record.shortcode === "folk" && record.type === "lore" ?
                        { ...record, data: { ...record.data, householdSize: 7 } }
                    :   record,
                ),
            };
            const seven = selectSettlementPlacements(
                { ...f, session: sevenSession, map, settings },
                selection,
            );
            expect(seven.selection.result.reservedPopulation).toBe(35);
            expect(seven.selection.result.unallocatedPopulation).toBe(276);
            expect(seven.existingFacts.map((entry: any) => entry.fact.population)).toEqual([
                0, 300,
            ]);
            expect(seven.existingRows).toEqual(baseline.existingRows);
            const checkGeneratedRows = (session: any, selected: any) => {
                const rows = [
                    ...selected.existingRows,
                    ...selected.selection.result.proposals.map((proposal: any, i: number) => {
                        const population = proposal.calculation.estimatedPopulation;
                        return {
                            settlement: `Generated settlement ${i}`,
                            polity: f.polityAddress,
                            population: { actual: population },
                            households: proposal.calculation.households,
                            type:
                                population < 10 ? "homestead"
                                : population < 100 ? "hamlet"
                                : "village",
                            market: population <= 80 ? "subsistence" : "local",
                            economicFocus: proposal.calculation.economicFocus,
                            generatorSource: proposal.source,
                        };
                    }),
                ];
                const records = session.records
                    .filter(isNoteRecord)
                    .map((record: any) =>
                        record.shortcode === "crown" && record.type === "affiliation" ?
                            { ...record, data: { ...record.data, settlements: rows } }
                        :   record,
                    );
                const polity = records.find(
                    (record: any) => record.shortcode === "crown" && record.type === "affiliation",
                );
                expect(polity).toMatchObject({ type: "affiliation", subType: "polity" });
                expect(Array.isArray(polity.data.settlements)).toBe(true);
                return checkSettlementTables(
                    { fm: polity, file: f.crownFile, raw: before },
                    {
                        index: {
                            notes: records.map((fm: any) => ({ fm, file: fm.file?.path, raw: "" })),
                            contentPackage: session.config.contentPackage,
                            foreign: session.foreign,
                        },
                    },
                );
            };
            expect(checkGeneratedRows(sevenSession, seven)).toEqual([]);
            const consistentSession = {
                ...sevenSession,
                records: sevenSession.records.map((record: any) =>
                    record.shortcode === "capital" && record.type === "place" ?
                        { ...record, data: { ...record.data, population: { actual: 35 } } }
                    :   record,
                ),
            };
            const consistent = selectSettlementPlacements(
                { ...f, session: consistentSession, map, settings },
                selection,
            );
            // The first site's 105 people display as 110; 66 households display as 467.
            // The 465-person displayed budget trims the final site by one household.
            expect(
                consistent.selection.result.proposals.map((proposal: any) => ({
                    households: proposal.calculation.households,
                    population: proposal.calculation.estimatedPopulation,
                })),
            ).toEqual([
                { households: 15, population: 110 },
                { households: 6, population: 42 },
                { households: 11, population: 77 },
                { households: 11, population: 77 },
                { households: 6, population: 42 },
                { households: 11, population: 77 },
                { households: 5, population: 35 },
            ]);
            expect(consistent.selection.allocation).toMatchObject({
                allocatedPopulation: 455,
                unallocatedPopulation: 10,
            });
            expect(consistent.selection.result).toMatchObject({
                reservedPopulation: 35,
                proposedPopulation: 455,
                unallocatedPopulation: 10,
            });
            expect(checkGeneratedRows(consistentSession, consistent)).toEqual([]);
            expect(
                checkGeneratedRows(sevenSession, consistent).some((finding: any) =>
                    finding.message.includes("exceed the territorial ceiling of 500"),
                ),
            ).toBe(true);
            expect(
                sevenSession.records.find(
                    (record: any) => record.shortcode === "capital" && record.type === "place",
                )?.data.population,
            ).toBe(300);
            expect(fs.readFileSync(f.crownFile, "utf8")).toBe(before);
            expect(
                seven.selection.result.proposals.every(
                    (p: any) => p.calculation.explanation.householdSize === 7,
                ),
            ).toBe(true);
            const zeroSession = {
                ...f.session,
                records: f.session.records.map((record: any) => {
                    if (record.shortcode === "crown" && record.type === "affiliation")
                        return {
                            ...record,
                            data: { ...record.data, territorial_population: { actual: 0 } },
                        };
                    if (record.shortcode === "capital" && record.type === "place")
                        return {
                            ...record,
                            data: { ...record.data, households: 0, population: { actual: 0 } },
                        };
                    return record;
                }),
            };
            const zero = selectSettlementPlacements(
                { ...f, session: zeroSession, map, settings },
                selection,
            );
            expect(zero.selection.result.reservedPopulation).toBe(0);
            expect(zero.selection.result.proposals).toEqual([]);
            expect(zero.selection.result.unallocatedPopulation).toBe(0);
            const unknownSession = {
                ...f.session,
                records: f.session.records.map((record: any) =>
                    record.shortcode === "capital" && record.type === "place" ?
                        { ...record, data: { ...record.data, households: null } }
                    :   record,
                ),
            };
            const unknownCount = selectSettlementPlacements(
                { ...f, session: unknownSession, map, settings },
                selection,
            );
            expect(unknownCount.ruralInput).toBeUndefined();
            expect(
                unknownCount.missing.some((item: any) => item.field.includes("households")),
            ).toBe(true);
            const highSession = {
                ...f.session,
                records: f.session.records.map((record: any) =>
                    record.shortcode === "crown" && record.type === "affiliation" ?
                        {
                            ...record,
                            data: { ...record.data, territorial_population: { actual: 100000 } },
                        }
                    :   record,
                ),
            };
            const high = selectSettlementPlacements(
                { ...f, session: highSession, map, settings },
                selection,
            );
            expect(high.selection.result.proposals.length).toBeGreaterThan(0);
            expect(
                high.selection.result.proposals.every(
                    (p: any) => p.calculation.estimatedPopulation < 1000,
                ),
            ).toBe(true);
            expect(high.selection.result.unallocatedPopulation).toBeGreaterThan(0);
            const noLand = {
                ...settings,
                landRules: [
                    {
                        ...settings.landRules[0],
                        profile: { ...settings.landRules[0].profile, holdingAcres: 1e12 },
                    },
                ],
            };
            const empty = selectSettlementPlacements({ ...f, map, settings: noLand }, selection);
            expect(empty.selection.result.proposals).toEqual([]);
            expect(empty.selection.result.unallocatedPopulation).toBe(475);

            const explicitSettings = {
                ...settings,
                placements: settings.placements.map((p: any, i: number) => ({
                    ...p,
                    areaAcres: i === 0 ? 100 : 200,
                    cellAreaAcres: 1000,
                })),
            };
            const explicit = selectSettlementPlacements(
                { ...f, map, settings: explicitSettings },
                selection,
            );
            const ledger = explicit.selection.cellLedgers[0];
            expect(ledger.physicalAcres).toBe(1000);
            expect(ledger.reservedAcres).toBe(300);
            expect(ledger.assignedAcres + ledger.unassignedAcres).toBeCloseTo(700);
            expect(
                explicit.selection.candidates.every(
                    (candidate: any) => candidate.ceilingAcres === 700 * candidate.weight,
                ),
            ).toBe(true);
            const mixedSettings = {
                ...explicitSettings,
                placements: explicitSettings.placements.map((p: any, i: number) => {
                    if (i === 0) return p;
                    const { cellAreaAcres, ...rest } = p;
                    return rest;
                }),
            };
            const mixed = selectSettlementPlacements(
                { ...f, map, settings: mixedSettings },
                selection,
            );
            expect(mixed.selection.cellLedgers[0].physicalAcres).toBe(1000);
            const zeroArea = {
                ...settings,
                placements: settings.placements.map((p: any) => ({ ...p, cellAreaAcres: 0 })),
            };
            const zeroPhysical = selectSettlementPlacements(
                { ...f, map, settings: zeroArea },
                selection,
            );
            expect(zeroPhysical.selection.cellLedgers[0]).toMatchObject({
                physicalAcres: 0,
                reservedAcres: 0,
                assignedAcres: 0,
                unassignedAcres: 0,
            });
            const conflict = {
                ...explicitSettings,
                placements: explicitSettings.placements.map((p: any, i: number) => ({
                    ...p,
                    cellAreaAcres: 1000 + i,
                })),
            };
            expect(
                selectSettlementPlacements({ ...f, map, settings: conflict }, selection).ruralInput,
            ).toBeUndefined();
            const manyRules = {
                ...settings,
                landRules: Array.from({ length: 100 }, () => settings.landRules[0]),
            };
            const limited = selectSettlementPlacements(
                { ...f, map, settings: manyRules },
                { ...selection, workLimit: 1000 },
            );
            expect(limited.missing.some((item: any) => item.message.includes("work limit"))).toBe(
                true,
            );
            const uncovered = selectSettlementPlacements(
                { ...f, map, settings },
                { ...selection, spacingMeters: 185200 },
            );
            expect(uncovered.selection.candidates).toEqual([]);
            expect(uncovered.selection.cellLedgers[0].physicalAcres).toBeGreaterThan(0);
            expect(uncovered.selection.cellLedgers[0].unassignedAcres).toBe(
                uncovered.selection.cellLedgers[0].physicalAcres,
            );
            const unknown = selectSettlementPlacements(
                { ...f, map, settings },
                { ...selection, existingSites: existingSites.slice(1) },
            );
            expect(unknown.missing[0].message).toContain("explicit position");
            const missingAcres = selectSettlementPlacements(
                {
                    ...f,
                    map,
                    settings: { ...settings, placements: settings.placements.slice(0, 1) },
                },
                selection,
            );
            expect(missingAcres.ruralInput).toBeUndefined();
            expect(
                missingAcres.missing.some((item: any) => item.message.includes("placement")),
            ).toBe(true);
        } finally {
            f.session.dispose();
        }
    });
});
