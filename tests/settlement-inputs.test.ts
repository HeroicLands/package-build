/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createContentSession } from "../engine/content-session.mjs";
import { settlementMembership } from "../engine/settlement-tables.mjs";
import { prepareSettlementInputs } from "../engine/settlement-inputs.mjs";
import { proposeSettlements } from "../engine/settlement-generate.mjs";
import { proposeUrbanSupply } from "../engine/settlement-urban.mjs";
import { prepareSettlementEdit } from "../engine/settlement-source.mjs";
import { metadataFileName } from "../engine/metadata-index.mjs";
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
            data: { seat: "place-capital", territorial_population: 1000 },
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
            data: { government: "affiliation-crown", population: 0 },
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
                territorial_population: 500,
                ...(dependency ? { seat: "other-note-place-port" } : {}),
                settlements: [
                    {
                        settlement: "Farm",
                        polity: "affiliation-crown",
                        type: "village",
                        population: 0,
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
            population: 300,
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
                data: { parents: ["affiliation-crown"], territorial_population: 50 },
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
                population: 20,
            }),
            record("affiliation", "polity", "child", {
                parents: [reference(polityAddress)],
                territorial_population: 50,
            }),
        ];
        write(
            path.join(dir, metadataFileName("other")),
            entries.map((item) => JSON.stringify(item)).join("\n") + "\n",
        );
        write(path.join(dir, ".complete"), "");
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
