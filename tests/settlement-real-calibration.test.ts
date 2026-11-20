/* SPDX-License-Identifier: GPL-3.0-or-later */
import { expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createContentSession } from "../engine/content-session.mjs";
import { fixture, note, write } from "./content-session-fixture.js";
import {
    formatFailure,
    inspectSession,
    parseTrial,
    retainEvidence,
    sourceHashes,
    writeReceipt,
} from "../ci/settlement-real-calibration.mjs";

it("accepts explicit trial inputs and refuses malformed or unexpected inputs", () => {
    expect(
        parseTrial('{"bindings":{"notes":[]},"selection":{"cellIds":[7],"existingSites":[]}}'),
    ).toEqual({ bindings: { notes: [] }, selection: { cellIds: [7], existingSites: [] } });
    expect(parseTrial("")).toEqual({});
    for (const value of ["{", "[]", '{"settings":null}', '{"profile":{}}'])
        expect(() => parseTrial(value)).toThrow();
});

it("captures indexed settlement facts, reports missing bindings and detects source changes", async () => {
    const f = fixture(8, "thalorna");
    const polity = path.join(f.config.paths.content, "Crown.md");
    const settlement = path.join(f.config.paths.content, "Town.md");
    write(
        polity,
        note({
            type: "affiliation",
            subType: "polity",
            shortcode: "kngdmmrdd",
            name: { full: "Crown" },
            data: { territorial_population: 1000 },
        }),
    );
    write(
        settlement,
        note({
            type: "place",
            subType: "settlement",
            shortcode: "town",
            name: { full: "Town" },
            data: { government: "affiliation-kngdmmrdd", type: "village", population: 100 },
        }),
    );
    const session = await createContentSession({ config: f.config, trackChanges: true });
    try {
        const observed = inspectSession(session, { mapId: "map", cells: [] });
        expect(observed.existing).toHaveLength(1);
        expect(observed.existing[0].fact.population).toBe(100);
        expect(observed.missing.some((item: any) => item.field === "binding")).toBe(true);
        expect(observed.calculation.ruralInput).toBeNull();
        expect(observed.calculation.modelSource).toBe("defaults");
        expect(observed.calculation.model).toBeTruthy();
        const model = { urbanShare: 0.05 };
        expect(
            inspectSession(session, { mapId: "map", cells: [] }, { settings: { model } })
                .calculation,
        ).toMatchObject({ modelSource: "trial", model });
        expect(
            inspectSession(session, { mapId: "map", cells: [] }, { settings: { model: null } })
                .calculation,
        ).toMatchObject({ modelSource: "trial", model: null });
        expect(observed.selection.missing.map((item: any) => item.field)).toEqual(
            expect.arrayContaining([
                "cellIds",
                "spacingMeters",
                "candidateLimit",
                "workLimit",
                "existingSites",
            ]),
        );
        expect(
            observed.selection.missing.find((item: any) => item.field === "existingSites"),
        ).toMatchObject({
            identity: observed.existing[0].fact.identity,
            file: "Town.md",
        });
        const trial = { selection: { cellIds: [], existingSites: [] } };
        const first = inspectSession(session, { mapId: "map", cells: [] }, trial);
        const otherRoot = path.join(f.root, "other-checkout");
        const relocate = (file: string) =>
            path.join(otherRoot, path.relative(session.contentBase, file));
        const relocated = {
            ...session,
            contentBase: otherRoot,
            parsed: new Map([...session.parsed].map(([file, value]) => [relocate(file), value])),
            sources: new Map([...session.sources].map(([file, value]) => [relocate(file), value])),
        };
        const second = inspectSession(relocated, { mapId: "map", cells: [] }, trial);
        expect(first.selection.missing.length).toBeGreaterThan(0);
        expect(first.selection.missing.some((item: any) => item.file === "Town.md")).toBe(true);
        expect(second.selection.missing).toEqual(first.selection.missing);
        const hashes = await sourceHashes(session);
        expect(hashes.every((entry: any) => entry.before === entry.after)).toBe(true);
        fs.appendFileSync(settlement, "Changed.\n");
        const changed = await sourceHashes(session);
        expect(changed.find((entry: any) => entry.file === "Town.md").after).not.toBe(
            hashes.find((entry: any) => entry.file === "Town.md").before,
        );
        expect(() => session.assertUnchanged()).toThrow();
    } finally {
        await session.dispose();
        fs.rmSync(f.root, { recursive: true, force: true });
    }
});

it("reports synthetic numerical budgets, household capacity and reserved acreage without changing sources", async () => {
    const f = fixture(8, "thalorna");
    const polity = "thalorna-note-affiliation-kngdmmrdd";
    const culture = "thalorna-note-lore-dunhariclt";
    const settlement = "thalorna-note-place-synthetic";
    const source = (slot: number) => ({ mapId: "map", kind: "cell", id: 7, slot });
    write(
        path.join(f.config.paths.content, "SyntheticPolity.md"),
        note({
            type: "affiliation",
            subType: "polity",
            shortcode: "kngdmmrdd",
            name: { full: "Synthetic polity" },
            data: {
                territorial_population: 500,
                settlements: [
                    {
                        settlement: "Synthetic row",
                        polity,
                        type: "village",
                        population: 0,
                        households: 0,
                        market: "subsistence",
                        generatorSource: source(0),
                    },
                ],
            },
        }),
    );
    write(
        path.join(f.config.paths.content, "SyntheticPlace.md"),
        note({
            type: "place",
            subType: "settlement",
            shortcode: "synthetic",
            name: { full: "Synthetic place" },
            data: {
                government: "affiliation-kngdmmrdd",
                type: "village",
                households: 5,
                population: 300,
            },
        }),
    );
    write(
        path.join(f.config.paths.content, "SyntheticCulture.md"),
        note({
            type: "lore",
            subType: "culture",
            shortcode: "dunhariclt",
            name: { full: "Synthetic culture" },
            data: { householdSize: 5 },
        }),
    );
    const map = {
        mapId: "map",
        mapHash: "map-hash",
        jsonHash: "json-hash",
        units: { distanceUnit: "nmi", distanceScale: 1, areaUnit: "square nmi" },
        cells: [
            {
                id: 7,
                biome: { i: 3 },
                elevationScale: 30,
                coast: 0,
                routeLinks: [],
                cultureAddress: culture,
                polityAddress: polity,
                ruralPopulation: 500,
                boundary: [
                    [0, 0],
                    [6, 0],
                    [6, 6],
                    [0, 6],
                ],
                rawArea: 36,
                area: 36,
            },
        ],
    };
    const trial = {
        bindings: { notes: [{ address: settlement, source: source(1) }] },
        settings: {
            urbanShares: { [polity]: 0 },
            placements: [
                { cellId: 7, source: source(0), areaAcres: 100, cellAreaAcres: 1000 },
                { cellId: 7, source: source(1), areaAcres: 200, cellAreaAcres: 1000 },
            ],
            landRules: [
                {
                    when: { biome: 3 },
                    profile: {
                        land: [5, 5, 5, 5],
                        development: 1,
                        holdingAcres: 25,
                        foodApproach: "agrarian",
                        economicFocus: "agrarian",
                        governance: "appointed",
                        obligation: 0.3,
                        upwardShare: 0.3,
                    },
                },
            ],
            urban: { sources: [], routes: [], cities: [] },
        },
        selection: {
            cellIds: [7],
            existingSites: [
                { identity: "row:0", point: [0, 0] },
                { identity: settlement, point: [0, 1] },
            ],
            spacingMeters: 5556,
            candidateLimit: 100,
            workLimit: 1000000000,
        },
    };
    const session = await createContentSession({ config: f.config, trackChanges: true });
    try {
        const before = await sourceHashes(session);
        const receipt = inspectSession(session, map, trial);
        expect(receipt.existing.map((entry: any) => entry.fact.population)).toEqual([0, 300]);
        const numerical = receipt.selection.result;
        expect(numerical, JSON.stringify(receipt.selection.missing)).toBeDefined();
        expect(receipt.calculation.ruralResult.reservedPopulation).toBe(25);
        expect(receipt.calculation.urbanResult).toMatchObject({
            reservedPopulation: 0,
            unallocatedUrbanPopulation: 0,
            cities: [],
            remainingFood: {},
            remainingCargo: {},
            missing: [],
        });
        expect(numerical.result.reservedPopulation).toBe(25);
        expect(numerical.result.proposedPopulation + numerical.result.unallocatedPopulation).toBe(
            475,
        );
        expect(numerical.result.unallocatedPopulation).toBe(
            numerical.allocation.unallocatedPopulation,
        );
        expect(numerical.cellLedgers[0]).toMatchObject({ physicalAcres: 1000, reservedAcres: 300 });
        expect(
            numerical.cellLedgers[0].assignedAcres + numerical.cellLedgers[0].unassignedAcres,
        ).toBeCloseTo(700);
        expect(numerical.candidates.length).toBeGreaterThan(0);
        expect(numerical.result.proposals.length).toBeGreaterThan(0);
        expect(
            numerical.result.proposals.reduce(
                (sum: number, proposal: any) => sum + proposal.calculation.households,
                0,
            ),
        ).toBeGreaterThan(0);
        for (const candidate of numerical.candidates) {
            expect(candidate.households).toBeLessThanOrEqual(candidate.capacity);
            expect(candidate.areaAcres).toBe(candidate.households * candidate.holdingAcres);
            expect(candidate.areaAcres).toBeLessThanOrEqual(candidate.ceilingAcres);
        }
        expect(inspectSession(session, map, trial)).toEqual(receipt);
        expect(await sourceHashes(session)).toEqual(before);
        session.assertUnchanged();
    } finally {
        await session.dispose();
        fs.rmSync(f.root, { recursive: true, force: true });
    }
});

it("retains each pinned evidence body byte for byte", async () => {
    const f = fixture();
    try {
        for (const name of ["manifest", "records", "verification", "boundaries", "diagnosis"]) {
            const bytes = Buffer.from([0, 255, name.length, ...Buffer.from(name)]);
            const file = await retainEvidence(f.root, name, bytes);
            expect(file).toBe(`${name}.evidence`);
            expect(fs.readFileSync(path.join(f.root, file))).toEqual(bytes);
        }
        await expect(retainEvidence(f.root, "../other", Buffer.from("x"))).rejects.toThrow();
    } finally {
        fs.rmSync(f.root, { recursive: true, force: true });
    }
});

it("writes matching machine and readable refusal receipts", async () => {
    const f = fixture();
    try {
        const report = {
            status: "refused",
            candidate: "candidate",
            consumer: "consumer",
            findings: ["file: error: refused"],
        };
        await writeReceipt(f.root, report);
        expect(JSON.parse(fs.readFileSync(path.join(f.root, "receipt.json"), "utf8"))).toEqual(
            report,
        );
        expect(fs.readFileSync(path.join(f.root, "receipt.md"), "utf8")).toContain(
            "# Settlement preflight: refused",
        );
        expect(fs.readFileSync(path.join(f.root, "receipt.md"), "utf8")).toContain(
            report.findings[0],
        );
    } finally {
        fs.rmSync(f.root, { recursive: true, force: true });
    }
});

it("formats failures with relative known paths and a located diagnostic", () => {
    const finding = formatFailure(
        new Error(
            "failed /work/project/.setting-checkout/file and /work/project/file\n/tmp/run/evidence",
        ),
        [
            ["/work/project", "."],
            ["/work/project/.setting-checkout", ".setting-checkout"],
            ["/tmp/run", ".runner-temp"],
        ],
    );
    expect(finding).toBe(
        "ci/settlement-real-calibration.mjs:1:1: error: failed .setting-checkout/file and ./file .runner-temp/evidence",
    );
});
