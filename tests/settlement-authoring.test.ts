/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
    authoringGraphWork,
    prepareNamedSettlements,
    preflightNamedSettlements,
    DEFAULT_AUTHORING_WORK_LIMIT,
} from "../engine/settlement-authoring.mjs";
import { serializeContentIndex } from "../engine/content-index.mjs";
import { readCanonicalKey } from "../engine/address.mjs";
import { commitSettlementEdit } from "../engine/settlement-source.mjs";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "settlement-authoring-")));
    roots.push(root);
    const file = path.join(root, "Crown.md");
    const raw =
        "---\ntype: affiliation\nsubType: polity\nshortcode: crown\nname: {full: Crown}\ndata:\n  territorial_population: 1000\n  settlements: [] # retain\n---\n\nKeep this prose.\n";
    fs.writeFileSync(file, raw);
    const polity = {
        package: "example",
        type: "affiliation",
        subType: "polity",
        shortcode: "crown",
        name: { full: "Crown" },
        address: { canonical: "example-note-affiliation-crown" },
        file: { path: "Crown.md" },
        data: { territorial_population: 1000, settlements: [] },
    };
    const culture = {
        package: "example",
        type: "lore",
        subType: "culture",
        shortcode: "folk",
        name: { full: "Folk" },
        lang: "test",
        file: { path: "Folk.md" },
        data: {},
    };
    const language = {
        package: "example",
        type: "skill",
        subType: "language",
        shortcode: "tongue",
        name: { full: "Tongue" },
        languageCode: "test",
        file: { path: "Tongue.md" },
        data: {
            elements: [
                { form: "lake", position: "opening", kind: "place", sense: "a lake" },
                { form: "ford", position: "closing", kind: "place", sense: "a crossing" },
            ],
            naming: { draws: [{ kind: "place", elements: ["place"] }] },
        },
    };
    const records = [polity, culture, language];
    const frontmatter = {
        type: "affiliation",
        subType: "polity",
        shortcode: "crown",
        name: { full: "Crown" },
        data: { territorial_population: 1000, settlements: [] },
    };
    const sources = new Map([[file, { raw, frontmatter }]]);
    sources.set(path.join(root, "Folk.md"), { raw: "", frontmatter: {} });
    sources.set(path.join(root, "Tongue.md"), { raw: "", frontmatter: {} });
    const session = {
        contentBase: root,
        config: { contentPackage: "example" },
        records,
        sources,
        problems: [],
        foreign: { index: new Map() },
    };
    const selection = {
        polity,
        missing: [{ field: "naming", message: "needed" }],
        ruralInput: {},
        existingRows: [],
        sourceCapture: sources,
        selection: {
            result: {
                proposals: [
                    {
                        cellId: 7,
                        cultureAddress: "example-note-lore-folk",
                        source: { mapId: "map", kind: "cell", id: 7, slot: 0 },
                        calculation: {
                            estimatedPopulation: 25,
                            households: 5,
                            economicFocus: "agrarian",
                        },
                    },
                ],
            },
        },
    };
    const resources = {
        index: { records: serializeContentIndex(records).trim().split("\n").map(JSON.parse) },
        alphabet: /^[a-z]+$/,
        blockedWords: new Set(["unwanted"]),
        blockedNames: new Set(["reserved"]),
        blockedPlaces: new Set(["existing"]),
    };
    const factory = (data: any, { selected }: any) => ({
        validators: {
            spelling: (value: string) => ({
                available: !!data.alphabet,
                valid: data.alphabet.test(value),
            }),
            language: (value: string, context: any) => ({
                available: !!context.language.data.elements,
                valid: value === context.elements.map((item: any) => item.form).join(""),
            }),
            earthWords: (value: string) => ({
                available: !!data.blockedWords,
                valid: !data.blockedWords.has(value),
            }),
            earthNames: (value: string) => ({
                available: !!data.blockedNames,
                valid: !data.blockedNames.has(value),
            }),
            indexedNames: (value: string) => ({
                available: !!data.blockedPlaces,
                valid: !data.blockedPlaces.has(value) && !selected.includes(value),
            }),
        },
    });
    return {
        file,
        raw,
        session,
        selection,
        resources,
        factory,
        polityAddress: "example-note-affiliation-crown",
        seed: "seed",
        maxCandidates: 4,
        maxWork: 1000000,
    };
}

it("prepares checked rows without writing and commits through the source editor", () => {
    const f = fixture();
    const result = prepareNamedSettlements(f);
    expect(result.missing).toEqual([]);
    expect(result.rows[0]).toMatchObject({
        settlement: "lakeford",
        type: "hamlet",
        population: 25,
        households: 5,
        generatorSource: { id: 7, slot: 0 },
    });
    expect(fs.readFileSync(f.file, "utf8")).toBe(f.raw);
    expect(commitSettlementEdit(result.edit).written).toBe(true);
    const after = fs.readFileSync(f.file, "utf8");
    expect(after).toContain("lakeford");
    expect(after).toContain("# retain");
    expect(after).toContain("Keep this prose.");
});

it("refuses stale names and a candidate rejected by setting data without changing source", () => {
    const f = fixture();
    const stale = { ...f.resources, index: { records: f.resources.index.records.slice(1) } };
    expect(prepareNamedSettlements({ ...f, resources: stale }).missing[0].field).toBe(
        "naming.index",
    );
    f.resources.blockedWords.add("lakeford");
    expect(prepareNamedSettlements(f).missing[0].field).toBe("naming.exhausted");
    expect(fs.readFileSync(f.file, "utf8")).toBe(f.raw);
});

it("refuses a changed source after preparing an edit", () => {
    const f = fixture();
    const result = prepareNamedSettlements(f);
    fs.appendFileSync(f.file, "Concurrent edit.\n");
    expect(() => commitSettlementEdit(result.edit)).toThrow(/stale|changed/i);
    expect(fs.readFileSync(f.file, "utf8")).toBe(f.raw + "Concurrent edit.\n");
});

it("rejects an index with a stale subtype before constructing checks", () => {
    const f = fixture();
    let calls = 0;
    const session = {
        ...f.session,
        records: f.session.records.map((r: any) =>
            r.shortcode === "tongue" ? { ...r, subType: "other" } : r,
        ),
    };
    const result = prepareNamedSettlements({
        ...f,
        session,
        factory: (...args: any[]) => {
            calls++;
            return (f.factory as any)(...args);
        },
    });
    expect(result.missing[0].field).toBe("naming.index");
    expect(calls).toBe(0);
    expect(fs.readFileSync(f.file, "utf8")).toBe(f.raw);
});

it("charges oversized resources before iterating or constructing checks", () => {
    const f = fixture();
    let calls = 0;
    const records = new Proxy(new Array(1000000), {
        get(target, key, receiver) {
            if (typeof key === "string" && /^\d+$/.test(key)) throw new Error("visited resource");
            return Reflect.get(target, key, receiver);
        },
    });
    const result = prepareNamedSettlements({
        ...f,
        maxWork: 10000,
        resources: { index: { records } },
        factory: () => {
            calls++;
            throw new Error("factory called");
        },
    });
    expect(result.missing[0].message).toContain("work limit");
    expect(calls).toBe(0);
});

it("uses editable type and market thresholds while preserving existing rows", () => {
    const f = fixture();
    const result = prepareNamedSettlements({
        ...f,
        bands: { homesteadBelow: 30, hamletBelow: 100, townAt: 1000, localAbove: 20 },
    });
    expect(result.missing).toEqual([]);
    expect(result.rows[0]).toMatchObject({ type: "homestead", market: "local", households: 5 });
    expect(f.selection.existingRows).toEqual([]);
});

it("charges raw source text and foreign records before calling the factory", () => {
    const f = fixture();
    let calls = 0;
    const factory = () => {
        calls++;
        throw new Error("factory must not run");
    };
    const sources = new Map(f.session.sources);
    sources.set(path.join(f.session.contentBase, "Folk.md"), {
        raw: "x".repeat(50000),
        frontmatter: {},
    });
    const largeSource = prepareNamedSettlements({
        ...f,
        session: { ...f.session, sources },
        maxWork: 10000,
        factory,
    });
    expect(largeSource.missing[0].message).toContain("work limit");
    const guarded = new Proxy(new Array(1000000), {
        get(target, key, receiver) {
            if (typeof key === "string" && /^\d+$/.test(key))
                throw new Error("visited foreign data");
            return Reflect.get(target, key, receiver);
        },
    });
    const foreign = new Map([["foreign", { records: guarded }]]);
    const largeForeign = prepareNamedSettlements({
        ...f,
        session: { ...f.session, foreign: { index: foreign } },
        maxWork: 10000,
        factory,
    });
    expect(largeForeign.missing[0].message).toContain("work limit");
    expect(calls).toBe(0);
});

it("reserves repeated descendant row validation before constructing checks", () => {
    const f = fixture();
    const rows = Array.from({ length: 1000 }, (_, i) => ({
        settlement: `Settlement ${i}`,
        type: "hamlet",
        population: 25,
    }));
    const sources = new Map(f.session.sources);
    const chain = Array.from({ length: 24 }, (_, i) => {
        const file = `Chain${i}.md`;
        sources.set(path.join(f.session.contentBase, file), { raw: "", frontmatter: {} });
        return {
            package: "example",
            type: "affiliation",
            subType: "polity",
            shortcode: `chain${i}`,
            name: { full: `Chain ${i}` },
            file: { path: file },
            data: {
                territorial_population: 100000,
                parents: i ? [`example-note-affiliation-chain${i - 1}`] : [],
                settlements: i === 23 ? rows : [],
            },
        };
    });
    const session = { ...f.session, records: [...f.session.records, ...chain], sources };
    const extent = session.records.length + f.selection.selection.result.proposals.length + 1;
    const oldAllowance =
        2 * extent * extent +
        f.selection.selection.result.proposals.length * (extent + f.maxCandidates + 1);
    const onePass = authoringGraphWork(
        [
            session.records,
            session.sources,
            session.foreign.index,
            (session.config as any).packageBuild,
            f.selection.existingRows,
            f.selection.selection.result.proposals,
        ],
        Number.MAX_SAFE_INTEGER,
    );
    const maxWork = onePass + oldAllowance + 1000;
    expect(onePass + oldAllowance).toBeLessThan(maxWork);
    let calls = 0;
    const result = prepareNamedSettlements({
        ...f,
        session,
        maxWork,
        factory: () => {
            calls++;
            throw new Error("factory called");
        },
    });
    expect(result.missing[0].message).toContain("work limit");
    expect(calls).toBe(0);
});

it("charges repeated row contents before serializing or constructing checks", () => {
    const f = fixture();
    let calls = 0;
    const row = {
        settlement: "x".repeat(10000),
        toJSON() {
            throw new Error("serialization reached");
        },
    };
    const extra = {
        package: "example",
        type: "affiliation",
        subType: "polity",
        shortcode: "other",
        file: { path: "Other.md" },
        data: { settlements: Array(200).fill(row) },
    };
    const records = [...f.session.records, extra];
    const sources = new Map(f.session.sources);
    sources.set(path.join(f.session.contentBase, "Other.md"), { raw: "", frontmatter: {} });
    const result = prepareNamedSettlements({
        ...f,
        session: { ...f.session, records, sources },
        resources: { ...f.resources, index: { records } },
        maxWork: 200000,
        factory: () => {
            calls++;
            throw new Error("factory called");
        },
    });
    expect(result.missing[0].message).toContain("work limit");
    expect(calls).toBe(0);
});

it("refuses cyclic records before serialization or factory construction", () => {
    const f = fixture();
    const cycle: any = {};
    cycle.self = cycle;
    const records = [...f.session.records, { data: cycle }];
    let calls = 0;
    const result = prepareNamedSettlements({
        ...f,
        session: { ...f.session, records },
        resources: { ...f.resources, index: { records } },
        factory: () => {
            calls++;
            throw new Error("factory called");
        },
    });
    expect(result.missing[0].message).toContain("cycle");
    expect(calls).toBe(0);
});

it("refuses missing captured note text before building checks", () => {
    const f = fixture();
    const sources = new Map(f.session.sources);
    sources.delete(path.join(f.session.contentBase, "Folk.md"));
    let calls = 0;
    const result = prepareNamedSettlements({
        ...f,
        session: { ...f.session, sources },
        factory: () => {
            calls++;
            throw new Error("factory called");
        },
    });
    expect(result.missing[0].message).toContain("captured source");
    expect(calls).toBe(0);
});

it("compares decoded and published Addresses, including nested references, without accepting stale data", () => {
    const f = fixture();
    for (const record of f.session.records as any[])
        record.address = {
            canonical: readCanonicalKey(`example-note-${record.type}-${record.shortcode}`),
        };
    const language = f.session.records.find((record) => record.shortcode === "tongue") as any;
    language.data.culture = readCanonicalKey("example-note-lore-folk");
    const records = serializeContentIndex(f.session.records).trim().split("\n").map(JSON.parse);
    expect(records[0].address.canonical).toEqual({
        address: "example-note-affiliation-crown",
        anchor: null,
        anchorKind: null,
    });
    const publishedLanguage = records.find((record: any) => record.shortcode === "tongue");
    expect(publishedLanguage.data.culture).toEqual({
        address: "example-note-lore-folk",
        anchor: null,
        anchorKind: null,
    });
    const resources = { ...f.resources, index: { records } };
    expect(prepareNamedSettlements({ ...f, resources }).missing).toEqual([]);
    publishedLanguage.data.culture.address = "example-note-lore-other";
    expect(prepareNamedSettlements({ ...f, resources }).missing[0].field).toBe("naming.index");
    expect(fs.readFileSync(f.file, "utf8")).toBe(f.raw);
});

it("admits a bounded setting-sized capture at the default and refuses a smaller allowance", () => {
    const f = fixture();
    const sources = new Map(f.session.sources);
    const raw = "x".repeat(10000);
    const records = Array.from({ length: 11909 }, (_, i) => {
        const file = `Note${i}.md`;
        sources.set(path.join(f.session.contentBase, file), { raw, frontmatter: {} });
        return { type: "doc", file: { path: file } };
    });
    const session = { ...f.session, records: [...f.session.records, ...records], sources };
    expect(() => preflightNamedSettlements({ ...f, session, maxWork: 1_000_000_000_000 })).toThrow(
        "authoring inputs exceed the work limit",
    );
    const used = preflightNamedSettlements({
        ...f,
        session,
        maxWork: DEFAULT_AUTHORING_WORK_LIMIT,
    });
    expect(used).toBeGreaterThan(1_000_000_000_000);
    expect(used).toBeLessThan(DEFAULT_AUTHORING_WORK_LIMIT);
});
