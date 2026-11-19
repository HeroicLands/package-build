/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { prepareNamedSettlements } from "../engine/settlement-authoring.mjs";
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
        index: { records },
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
