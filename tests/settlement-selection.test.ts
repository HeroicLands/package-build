/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import {
    measurePlacementFootprints,
    selectSettlementPlacements,
} from "../engine/settlement-selection.mjs";
import {
    assertSettlementRecords,
    createSettlementMembership,
} from "../engine/settlement-tables.mjs";
import { note } from "./content-session-fixture.js";

function selectionFixture() {
    const polityAddress = "example-note-affiliation-crown";
    const cultureAddress = "example-note-lore-folk";
    const polity = {
        package: "example",
        type: "affiliation",
        subType: "polity",
        shortcode: "crown",
        name: { full: "Crown" },
        address: { canonical: polityAddress },
        file: { path: "Crown.md" },
        data: { territorial_population: { actual: 320 }, settlements: [] },
    };
    const culture = {
        package: "example",
        type: "lore",
        subType: "culture",
        shortcode: "folk",
        name: { full: "Folk" },
        address: { canonical: cultureAddress },
        file: { path: "Folk.md" },
        data: { householdSize: 5.6 },
    };
    const records: any[] = [polity, culture];
    return {
        polityAddress,
        session: {
            config: { contentPackage: "example" },
            contentBase: "/selection-fixture",
            records,
            parsed: new Map(records.map((r) => [r.file.path, { frontmatter: r }])),
            sources: new Map(records.map((r) => [r.file.path, { raw: note(r) }])),
            foreign: { index: new Map<string, any>() },
            problems: [],
        },
        map: {
            mapId: "map",
            mapHash: "map-hash",
            jsonHash: "json-hash",
            units: { distanceUnit: "km", distanceScale: 1, areaUnit: "square km" },
            cells: [
                {
                    id: 7,
                    boundary: [
                        [0, 0],
                        [2, 0],
                        [2, 2],
                        [0, 2],
                    ],
                    rawArea: 4,
                    area: 4,
                    biome: { i: 1 },
                    cultureAddress,
                    polityAddress,
                },
            ],
        },
        settings: {
            urbanShares: { [polityAddress]: 0 },
            placements: [],
            landRules: [
                {
                    when: { biome: 1 },
                    profile: {
                        land: [5, 5, 5, 5],
                        development: 1,
                        holdingAcres: 1,
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
    };
}

const selectionLimits = (spacingMeters: number) => ({
    cellIds: [7],
    existingSites: [],
    spacingMeters,
    candidateLimit: 100,
    workLimit: 1_000_000_000,
});

it.each([500, 5556])(
    "keeps displayed totals and exact households within 320 at spacing %s",
    (spacing) => {
        const options = selectionFixture();
        const result = selectSettlementPlacements(options, selectionLimits(spacing));
        expect(result.selection, JSON.stringify(result.missing)).toBeDefined();
        const proposals = result.selection.result.proposals;
        expect(proposals.length).toBeGreaterThan(0);
        const households = proposals.reduce(
            (sum: number, p: any) => sum + p.calculation.households,
            0,
        );
        const population = proposals.reduce(
            (sum: number, p: any) => sum + p.calculation.estimatedPopulation,
            0,
        );
        expect(population).toBeLessThanOrEqual(320);
        expect(result.selection.result.unallocatedPopulation).toBe(
            result.selection.allocation.unallocatedPopulation,
        );
        expect(
            result.selection.result.proposedPopulation +
                result.selection.result.unallocatedPopulation,
        ).toBe(320);
        if (spacing === 5556) {
            expect(proposals).toHaveLength(1);
            expect(households).toBe(57);
            expect(result.selection.result.unallocatedPopulation).toBeCloseTo(0.8);
        }
        const rows = proposals.map((p: any, i: number) => ({
            settlement: `Settlement ${i}`,
            polity: options.polityAddress,
            type:
                p.calculation.estimatedPopulation < 10 ? "homestead"
                : p.calculation.estimatedPopulation < 100 ? "hamlet"
                : "village",
            population: p.calculation.estimatedPopulation,
            market: p.calculation.estimatedPopulation <= 80 ? "subsistence" : "local",
            households: p.calculation.households,
            economicFocus: p.calculation.economicFocus,
            generatorSource: p.source,
        }));
        const records = options.session.records.map((record) =>
            record === result.polity ?
                { ...record, data: { ...record.data, settlements: rows } }
            :   record,
        );
        expect(() =>
            assertSettlementRecords(records, {
                fileOf: (r: any) => r.file.path,
                rawOf: (file: string) => options.session.sources.get(file)?.raw ?? "",
                config: options.session.config,
                foreignIndex: options.session.foreign.index,
            }),
        ).not.toThrow();
        expect(selectSettlementPlacements(options, selectionLimits(spacing))).toEqual(result);
    },
);

it("selects from a captured local and dependency corpus with a finite linear work allowance", () => {
    const options = selectionFixture();
    for (let i = 0; i < 20_000; i++) {
        const pkg = i < 12_000 ? "example" : "dependency";
        const record = {
            package: pkg,
            type: "lore",
            subType: "history",
            shortcode: `record${i}`,
            name: { full: `Record ${i}` },
            address: { canonical: `${pkg}-note-lore-record${i}` },
            file: { path: `Record${i}.md` },
            data: {
                entries: Array.from({ length: 24 }, (_, n) => ({
                    value: `Entry ${n}`,
                    description: "captured text ".repeat(16),
                })),
            },
        };
        if (pkg === "example") {
            options.session.records.push(record);
            options.session.parsed.set(record.file.path, { frontmatter: record });
            options.session.sources.set(record.file.path, {
                raw: "Captured source.\n".repeat(128),
            });
        } else
            options.session.foreign.index.set(record.address.canonical, {
                settlementRecord: record,
            });
    }
    const result = selectSettlementPlacements(options, selectionLimits(5556));
    expect(result.selection, JSON.stringify(result.missing)).toBeDefined();
    expect(result.selection.result.proposals).toHaveLength(1);
    expect(result.selection.result.proposals[0].calculation.households).toBe(57);
    expect(
        selectSettlementPlacements(options, { ...selectionLimits(5556), workLimit: 100 }).missing[0]
            .message,
    ).toContain("work limit");
}, 60_000);

it("charges repeated array references and refuses cyclic capture graphs", () => {
    const shared = Array.from({ length: 200 }, () => "captured text ".repeat(10));
    const options = selectionFixture();
    options.session.records.push({ data: { repeated: Array(100).fill(shared) } });
    expect(
        selectSettlementPlacements(options, { ...selectionLimits(5556), workLimit: 1_000_000 })
            .missing[0].message,
    ).toContain("work limit");
    const cyclic: any = {};
    cyclic.self = cyclic;
    options.session.records.pop();
    options.session.records.push(cyclic);
    expect(selectSettlementPlacements(options, selectionLimits(5556)).missing[0].message).toContain(
        "cycle",
    );
});

describe("settlement footprint weights", () => {
    it("clips irregular cells and leaves uncovered area unused", () => {
        const input = {
            map: {
                mapId: "m",
                mapHash: "a",
                jsonHash: "b",
                units: { distanceUnit: "nmi", distanceScale: 1 },
                cells: [
                    {
                        id: 1,
                        boundary: [
                            [0, 0],
                            [6, 0],
                            [0, 6],
                        ],
                    },
                ],
            },
            existingSites: [],
            spacingMeters: 5556,
            candidateLimit: 20,
            workLimit: 10000,
        };
        const result = measurePlacementFootprints(input);
        expect(result.missing).toEqual([]);
        expect(
            result.candidates.reduce((sum: number, c: any) => sum + c.weight, 0),
        ).toBeLessThanOrEqual(1 + 1e-12);
        expect(
            result.candidates.find((c: any) => c.point[0] === 0 && c.point[1] === 0).weight,
        ).toBeCloseTo(0.125);
        expect(
            measurePlacementFootprints({
                ...input,
                map: { ...input.map, units: { distanceUnit: "km", distanceScale: 1.852 } },
            }).candidates,
        ).toEqual(result.candidates);
        expect(
            measurePlacementFootprints({ ...input, existingSites: [{ point: null }] }).missing[0]
                .code,
        ).toBe("unknown-location");
    });
});

it("owns shared boundary sites once and leaves every cell within its area", () => {
    const cells = [
        {
            id: 8,
            boundary: [
                [3, 0],
                [9, 0],
                [9, 3],
                [3, 3],
            ],
        },
        {
            id: 2,
            boundary: [
                [0, 0],
                [3, 0],
                [3, 3],
                [0, 3],
            ],
        },
    ];
    const input = {
        map: {
            mapId: "m",
            mapHash: "a",
            jsonHash: "b",
            units: { distanceUnit: "nmi", distanceScale: 1 },
            cells,
        },
        existingSites: [],
        spacingMeters: 5556,
        candidateLimit: 30,
        workLimit: 10000,
    };
    const first = measurePlacementFootprints(input);
    expect(first.missing).toEqual([]);
    expect(
        first.candidates.filter((p: any) => p.point[0] === 3).every((p: any) => p.cellId === 2),
    ).toBe(true);
    for (const id of [2, 8])
        expect(
            first.candidates
                .filter((p: any) => p.cellId === id)
                .reduce((sum: number, p: any) => sum + p.weight, 0),
        ).toBeLessThanOrEqual(1 + 1e-12);
    expect(
        measurePlacementFootprints({
            ...input,
            map: { ...input.map, cells: [...cells].reverse() },
        }),
    ).toEqual(first);
});

it("rejects oversized initial rules and IDs without inspecting their entries", async () => {
    const { selectSettlementPlacements } = await import("../engine/settlement-selection.mjs");
    const guarded = new Proxy(new Array(10000), {
        get(target, key, receiver) {
            if (typeof key === "string" && /^\d+$/.test(key)) throw new Error("inspected entry");
            return Reflect.get(target, key, receiver);
        },
    });
    const options = {
        session: { records: [] },
        map: { cells: [] },
        settings: { placements: [{ cellId: 1, areaAcres: 0 }], landRules: guarded },
    };
    const result = selectSettlementPlacements(options, {
        cellIds: [],
        existingSites: [],
        workLimit: 100,
    });
    expect(result.missing[0].message).toContain("work limit");
    const ids = selectSettlementPlacements(
        { ...options, settings: { ...options.settings, landRules: [] } },
        { cellIds: guarded, existingSites: [], workLimit: 100 },
    );
    expect(ids.missing[0].message).toContain("work limit");
});

it("bounds captured and dependency maps before opening their iterators", async () => {
    const { selectSettlementPlacements } = await import("../engine/settlement-selection.mjs");
    class GuardedMap extends Map {
        override [Symbol.iterator](): MapIterator<[any, any]> {
            throw new Error("opened oversized map");
        }
        override values(): MapIterator<any> {
            throw new Error("opened oversized map");
        }
    }
    const large = new GuardedMap();
    for (let i = 0; i < 10000; i++) large.set(i, {});
    for (const session of [
        { records: [], foreign: { index: large } },
        { records: [], parsed: large },
        { records: [], sources: large },
    ]) {
        const result = selectSettlementPlacements(
            { session, map: { cells: [] }, settings: { placements: [], landRules: [] } },
            { cellIds: [], existingSites: [], workLimit: 100 },
        );
        expect(result.missing[0].message).toContain("work limit");
    }
});

it("charges nested dependency and captured arrays before visiting their entries", async () => {
    const { selectSettlementPlacements } = await import("../engine/settlement-selection.mjs");
    const large = new Proxy(new Array(10000), {
        get(target, key, receiver) {
            if (typeof key === "string" && /^\d+$/.test(key)) throw new Error("visited entry");
            return Reflect.get(target, key, receiver);
        },
    });
    for (const field of ["settlements", "parents"]) {
        const record = { data: { [field]: large } };
        for (const session of [
            {
                records: [],
                foreign: { index: new Map([["dependency", { settlementRecord: record }]]) },
            },
            { records: [], parsed: new Map([["source.md", { frontmatter: record }]]) },
        ]) {
            const result = selectSettlementPlacements(
                { session, map: { cells: [] }, settings: { placements: [], landRules: [] } },
                { cellIds: [], existingSites: [], workLimit: 10000 },
            );
            expect(result.missing[0].message).toContain("work limit");
        }
    }
});

it("reuses one corpus across many subpolities in a captured setting", () => {
    const options = selectionFixture();
    const subpolities: { address: string; cellIds: number[] }[] = [];
    let bindingReads = 0;
    for (let i = 0; i < 2176; i++) {
        const child = i < 128;
        const type = child ? "affiliation" : "lore";
        const record = {
            package: "example",
            type,
            subType: child ? "polity" : "history",
            shortcode: `record${i}`,
            name: { full: `Record ${i}` },
            address: { canonical: `example-note-${type}-record${i}` },
            file: { path: `Record${i}.md` },
            data:
                child ?
                    {
                        parents: [options.polityAddress],
                        territorial_population: { actual: 0 },
                        settlements: [],
                    }
                :   {},
        };
        options.session.records.push(record);
        options.session.parsed.set(record.file.path, { frontmatter: record });
        options.session.sources.set(record.file.path, { raw: note(record) });
        if (child)
            subpolities.push({
                get address() {
                    bindingReads++;
                    return record.address.canonical;
                },
                cellIds: [],
            });
    }
    let scans = 0;
    const records = new Proxy(options.session.records, {
        get(target, property, receiver) {
            if (property === Symbol.iterator) {
                scans++;
                return target[Symbol.iterator].bind(target);
            }
            return Reflect.get(target, property, receiver);
        },
    });
    const input = {
        ...options,
        session: { ...options.session, records },
        bindings: { subpolities },
    };
    const result = selectSettlementPlacements(input, {
        ...selectionLimits(5556),
        workLimit: 50_000_000,
    });
    expect(result.selection, JSON.stringify(result.missing)).toBeDefined();
    expect(result.selection.result.proposals).toHaveLength(1);
    expect(result.subpolities).toHaveLength(128);
    // Each operation may scan the capture; each subordinate must not rebuild it.
    expect(scans).toBeLessThan(24);
    // Binding address reads include capture and both assembly passes.
    expect(bindingReads).toBeGreaterThanOrEqual(subpolities.length);
    expect(bindingReads).toBeLessThan(subpolities.length * 16);
    expect(
        selectSettlementPlacements(input, { ...selectionLimits(5556), workLimit: 1000 }).missing[0]
            .message,
    ).toContain("work limit");
});

it("charges ancestor expansion once and refuses an insufficient hierarchy budget", () => {
    const records = Array.from({ length: 256 }, (_, i) => ({
        package: "example",
        type: "affiliation",
        subType: "polity",
        shortcode: `part${i}`,
        data: { parents: i ? [`example-note-affiliation-part${i - 1}`] : [] },
    }));
    let charged = 0;
    const membership = createSettlementMembership(
        records,
        new Map(),
        "example",
        (units: number) => {
            charged += units;
            if (charged > 1_000_000) throw new RangeError("hierarchy exceeds the work limit");
        },
    );
    expect(membership(records[0]).polities).toHaveLength(1);
    expect(charged).toBeGreaterThan(10000);
    const built = charged;
    for (const record of records) membership(record);
    expect(charged - built).toBeLessThan(1024);
    let limited = 0;
    const refused = createSettlementMembership(records, new Map(), "example", (units: number) => {
        limited += units;
        if (limited > 10000) throw new RangeError("hierarchy exceeds the work limit");
    });
    expect(() => refused(records[0])).toThrow("hierarchy exceeds the work limit");
});
