/* SPDX-License-Identifier: GPL-3.0-or-later */

import { expect, it } from "vitest";
import path from "node:path";
import { createPackRouter } from "../engine/pack-router.mjs";
import {
    populationJournalPlan,
    populationJournalMarkdown,
    privatePopulationFacts,
} from "../engine/population-journals.mjs";
import { buildJournalEntry, Journals } from "../engine/journals.mjs";

const packs = [
    { name: "journals", type: "JournalEntry", default: true },
    { name: "private", type: "JournalEntry", private: true },
];
const config = { contentPackage: "demo", packs };
const record = {
    package: "demo",
    type: "affiliation",
    subType: "polity",
    shortcode: "hidden",
    name: { full: "Hidden Realm" },
    file: { path: "hidden.md" },
    address: { canonical: "demo-note-affiliation-hidden", slug: "affiliation-hidden" },
    data: {
        population: { actual: 230, apparent: 0 },
        territorial_population: { actual: 47000, apparent: null },
        settlements: [{ settlement: "East Farm", population: { actual: 2300, apparent: 800 } }],
    },
};
function plan(records = [record], packList = packs, extra = {}) {
    return populationJournalPlan(records, {
        config: { ...config, packs: packList },
        router: createPackRouter(packList),
        ...extra,
    });
}

it("gives a public subject one stable private entry with membership, territory and inline truth", () => {
    const before = structuredClone(record);
    const output = plan();
    expect(output.pack).toBe("private");
    expect(output.subjects).toHaveLength(1);
    expect(output.subjects[0].facts).toEqual([
        { label: "Membership", actual: 230, apparent: 0 },
        { label: "Territorial population", actual: 47000, apparent: null },
        { label: "East Farm", actual: 2300, apparent: 800 },
    ]);
    const markdown = populationJournalMarkdown(output.subjects[0], () => ({
        uuid: "Compendium.demo.journals.JournalEntry.abcdef1234567890",
    }));
    expect(markdown).toContain("@UUID[Compendium.demo.journals.JournalEntry.abcdef1234567890]");
    expect(markdown).toContain("| Membership | 230 | 0 |");
    expect(markdown).toContain("| Territorial population | 47,000 | Unknown |");
    expect(markdown).toContain("| East Farm | 2,300 | 800 |");
    const document = buildJournalEntry({
        id: output.subjects[0].id,
        name: "Hidden Realm — Population",
        markdown,
        stats: {},
    });
    expect(document.ownership).toEqual({ default: 0 });
    expect(document.pages).toHaveLength(1);
    expect(document.pages[0].text.content).toContain("47,000");
    expect(plan().subjects[0].id).toBe(output.subjects[0].id);
    expect(record).toEqual(before);
});

it("does not make a broken subject link for a stub, and writes its supplement through the private pass", async () => {
    const output = plan();
    expect(populationJournalMarkdown(output.subjects[0])).not.toContain("@UUID");
    const written: any[] = [];
    const stats = { compiled: 0 };
    await Journals.prototype.finish.call(
        {
            populationPlan: output,
            packName: "private",
            stats: {},
            linkIndex: undefined,
            writeEntry: (doc) => written.push(doc),
        },
        stats,
    );
    expect(written).toHaveLength(1);
    expect(stats.compiled).toBe(1);
    const publicWritten: any[] = [];
    await Journals.prototype.finish.call(
        {
            populationPlan: output,
            packName: "journals",
            writeEntry: (doc) => publicWritten.push(doc),
        },
        { compiled: 0 },
    );
    expect(publicWritten).toEqual([]);
});

it("requires an unambiguous system-neutral private destination only for differing facts", () => {
    expect(() => plan([record], packs.slice(0, 1))).toThrow(
        /package-build.config.yaml: error:.*private JournalEntry/,
    );
    expect(() =>
        plan([record], [{ name: "private", type: "JournalEntry", private: true, prebuilt: true }]),
    ).toThrow(/private JournalEntry/);
    const ambiguous = [...packs, { name: "other", type: "JournalEntry", private: true }];
    expect(() => plan([record], ambiguous)).toThrow(/unique/);
    expect(() =>
        plan(
            [record],
            [{ name: "systemprivate", type: "JournalEntry", system: "sohl", private: true }],
        ),
    ).toThrow(/system-neutral/);
    const defaults = [
        { name: "private", type: "JournalEntry", private: true, default: true },
        { name: "other", type: "JournalEntry", private: true },
    ];
    expect(plan([record], defaults).pack).toBe("private");
    expect(
        privatePopulationFacts({
            data: {
                population: { actual: 230 },
                territorial_population: { actual: 470, apparent: 470 },
            },
        }),
    ).toEqual([]);
    expect(
        plan([{ ...record, data: { population: { actual: 230 } } } as typeof record], []).subjects,
    ).toEqual([]);
});

it("uses an existing private page's population panel but retains empty-body delivery", () => {
    const privateRecord = {
        ...record,
        tags: ["gm"],
        data: { pack: "private", population: { actual: 230, apparent: 0 } },
    };
    const contentBase = path.resolve("population-fixture");
    const parsed = new Map([[path.join(contentBase, "hidden.md"), { body: "A private account." }]]);
    expect(plan([privateRecord as typeof record], packs, { contentBase, parsed }).subjects).toEqual(
        [],
    );
    parsed.set(path.join(contentBase, "hidden.md"), { body: "" });
    expect(
        plan([privateRecord as typeof record], packs, { contentBase, parsed }).subjects,
    ).toHaveLength(1);
});

it("normalizes accepted numeric representations before deciding whether a supplement is needed", () => {
    expect(
        privatePopulationFacts({ data: { population: { actual: "1200", apparent: 1200 } } }),
    ).toEqual([]);
    expect(
        privatePopulationFacts({ data: { population: { actual: "1200", apparent: "0" } } }),
    ).toEqual([{ label: "Population", actual: 1200, apparent: 0 }]);
});
