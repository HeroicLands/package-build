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
            const crown = session.records.find((record: any) => record.shortcode === "crown")!;
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
    const session = await createContentSession({ config: input.config });
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
    const map = { mapId: "map", cells: subordinate ? [cell, { ...cell, id: 8 }] : [cell] };
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
        notes: [{ address: noteAddress, source: source(1) }],
        ...(subordinate ?
            { subpolities: [{ address: "sessionproof-note-affiliation-child", cellIds: [8] }] }
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
                system: "note",
                type: "affiliation",
                shortcode: "crown",
            });
            expect(result.existingRows[0].households).toBe(0);
            expect(result.sourceCapture.get(f.crownFile).raw).toBe(f.original);
            expect(result.sourceCapture.get(f.crownFile).frontmatter.data.settlements).toEqual(
                result.existingRows,
            );
            expect(result.sourceCapture.get(f.capitalFile).raw).toBe(f.capitalRaw);
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
