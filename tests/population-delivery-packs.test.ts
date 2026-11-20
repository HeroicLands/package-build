/* SPDX-License-Identifier: GPL-3.0-or-later */

import { expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { configFromData } from "../engine/pack-config.mjs";
import { createPackRouter } from "../engine/pack-router.mjs";
import { createContentSession } from "../engine/content-session.mjs";
import { buildCompileCorpus } from "../engine/compile-corpus.mjs";
import { Journals } from "../engine/journals.mjs";
import { generatePacksJson } from "../engine/generate.mjs";
import { emitContentIndex } from "../engine/content-index.mjs";
import { populationJournalPlan } from "../engine/population-journals.mjs";
import { fixture, note, write } from "./content-session-fixture.js";

const packs = [
    { name: "journals", type: "JournalEntry", default: true },
    { name: "private", type: "JournalEntry", private: true },
];

function input(packList = packs) {
    const tree = fixture(0, "populationproof");
    const data = {
        contentPackage: "populationproof",
        packageKind: "modules",
        compatibility: { minimum: "14", verified: "14.367" },
        stats: { lastModifiedBy: "populationtest01" },
        skipDirectories: ["Templates"],
        packs: packList,
    };
    write(tree.configFile, YAML.stringify(data));
    const config = configFromData(data, tree.configFile);
    const saved = process.env.PACKAGE_BUILD_CONFIG;
    process.env.PACKAGE_BUILD_CONFIG = tree.configFile;
    const sources = new Map<string, string>();
    return {
        ...tree,
        config,
        sources,
        add(shortcode: string, data: object, body = "An account.", extra = {}) {
            const file = path.join(config.paths.content, `${shortcode}.md`);
            const text = note(
                {
                    type: "place",
                    subType: "region",
                    shortcode,
                    name: { full: shortcode },
                    data,
                    ...extra,
                },
                body,
            );
            sources.set(file, text);
            write(file, text);
        },
        close() {
            if (saved === undefined) delete process.env.PACKAGE_BUILD_CONFIG;
            else process.env.PACKAGE_BUILD_CONFIG = saved;
            fs.rmSync(tree.root, { recursive: true, force: true });
        },
    };
}

function documents(directory: string): any[] {
    if (!fs.existsSync(directory)) return [];
    return fs
        .readdirSync(directory)
        .filter((name) => name.endsWith(".json") && !name.startsWith("folder_"))
        .map((name) => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")));
}

async function compile(tree, corpus, name: string) {
    const dest = path.join(tree.config.paths.packJson, name);
    fs.mkdirSync(dest, { recursive: true });
    const pass = new Journals({
        contentBase: tree.config.paths.content,
        skipDirectories: tree.config.skipDirectories,
        dest,
        packName: name,
        docType: "JournalEntry",
        router: createPackRouter(tree.config.packs),
        corpus,
    });
    await pass.compile();
    expect(pass.errorCount).toBe(0);
    return documents(dest);
}

it.each(["session", "standalone"])(
    "emits expression-dependent private IDs consistently in the %s compiler",
    async (mode) => {
        const tree = input();
        tree.add(
            "privateplain",
            { pack: "private", population: { actual: 2300, apparent: 800 } },
            "# Population {{data.population.actual}}\n\n[Account]{#safe}.",
            { tags: ["gm"] },
        );
        const privateCountQuery =
            "SELECT data.population.actual FROM notes WHERE shortcode = 'privateinline'";
        const privateTextQuery =
            "SELECT 'Hidden residents ' || data.population.actual FROM notes WHERE shortcode = 'privateinline'";
        tree.add(
            "privateinline",
            { pack: "private", population: { actual: 4700, apparent: 900 } },
            `# Population {{sql "${privateCountQuery}"}}\n\n[Account]{#safe}.\n\nResidents: {{sql "${privateCountQuery}"}}.\n\n[Account {{sql "${privateTextQuery}"}}]{#paragraph}.\n\n- Grouped residents: {{digits (sql "${privateCountQuery}")}}.\n\n| Detail | Residents |\n| --- | --- |\n| Account | {{sql "${privateCountQuery}"}} |`,
            { tags: ["gm"] },
        );
        tree.add(
            "privateanchor",
            { pack: "private", population: { actual: 6500, apparent: 1000 } },
            "# Population {{data.population.actual}} {#count}\n\n[Account]{#safe}.",
            { tags: ["gm"] },
        );
        tree.add(
            "reader",
            {},
            "[[place-privateplain#safe|Plain]] and [[place-privateinline#safe|Inline]], [[place-privateinline#paragraph|Paragraph]] and [[place-privateanchor#safe|Anchored]].",
        );
        const session = await createContentSession({ config: tree.config });
        try {
            const before = structuredClone({
                records: session.records,
                parsed: [...session.parsed],
            });
            const corpus =
                mode === "session" ?
                    await session.compileCorpus()
                :   await buildCompileCorpus({
                        config: tree.config,
                        contentBase: tree.config.paths.content,
                        skipDirectories: tree.config.skipDirectories,
                        router: createPackRouter(tree.config.packs),
                    });
            const privateDocs = await compile(tree, corpus, "private");
            const publicDocs = await compile(tree, corpus, "journals");
            const reader = JSON.stringify(publicDocs.find((entry) => entry.name === "reader"));
            const publication = await session.publication();
            const result = emitContentIndex({ config: tree.config, publication });
            const jsonl = fs.readFileSync(result.file, "utf8");
            const records = jsonl
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line));
            for (const [name, actual] of [
                ["privateplain", 2300],
                ["privateinline", 4700],
                ["privateanchor", 6500],
            ] as const) {
                const document = privateDocs.find((entry) => entry.name === name);
                const page = document.pages.find((one) => one.text?.content?.includes('id="safe"'));
                expect(page.name).toBe(`Population ${actual}`);
                const target = `Compendium.populationproof.private.JournalEntry.${document._id}.JournalEntryPage.${page._id}`;
                expect(reader).toContain(target);
                const published = records.find(
                    (entry) => entry.type === "place" && entry.shortcode === name,
                );
                expect(published.foundry.note.anchors.safe).toBe(target);
                if (name === "privateinline") {
                    expect(page.text.content).toContain("Residents: 4700.");
                    expect(page.text.content).toContain("Hidden residents 4700");
                    expect(page.text.content).toContain("Grouped residents: 4,700.");
                    expect(page.text.content).toContain("<td>4700</td>");
                    expect(published.foundry.note.anchors.paragraph).toBe(target);
                    expect(published.anchors).toEqual(
                        expect.arrayContaining([
                            expect.objectContaining({ slug: "paragraph", name: "Account " }),
                        ]),
                    );
                    expect(jsonl).not.toContain("Hidden residents");
                    expect(jsonl).not.toContain("SELECT 'Hidden residents '");
                    const projected = publication.expandedBodies.get(
                        path.join(tree.config.paths.content, "privateinline.md"),
                    ).markdown;
                    expect(projected).not.toContain("4700");
                    expect(projected).not.toContain("Hidden residents");
                    expect(projected).not.toContain("{{");
                    expect(projected).not.toContain("SELECT");
                    const publicLinks = JSON.stringify([
                        ...corpus.audiences.public.linkIndex.byShortcode.values(),
                    ]);
                    expect(publicLinks).not.toContain("4700");
                    expect(publicLinks).not.toContain("Hidden residents");
                    expect(publicLinks).not.toContain("SELECT");
                }
                if (name === "privateanchor") {
                    expect(published.foundry.note.anchors.count).toBe(target);
                    expect(published.anchors).toEqual(
                        expect.arrayContaining([
                            expect.objectContaining({ slug: "count", name: "count" }),
                        ]),
                    );
                }
                expect(jsonl).not.toContain("SELECT data.population.actual");
                expect(published.data.population.actual).toBeNull();
                expect(jsonl).not.toContain(`Population ${actual}`);
                expect(jsonl).not.toMatch(new RegExp(`\\b${actual}\\b`));
                expect(
                    JSON.stringify([...corpus.audiences.public.linkIndex.byShortcode.values()]),
                ).not.toContain(`Population ${actual}`);
                expect(reader).not.toContain(`Population ${actual}`);
            }
            expect({ records: session.records, parsed: [...session.parsed] }).toEqual(before);
            for (const [file, text] of tree.sources)
                expect(fs.readFileSync(file, "utf8")).toBe(text);
        } finally {
            await session.dispose();
            tree.close();
        }
    },
);

it.each(
    ["session", "standalone"].flatMap((mode) =>
        [false, true].flatMap((privateNote) =>
            ["# Population", "Residents:"].flatMap((prefix) =>
                [
                    ["SELECT NULL", "scalar SQL result is empty"],
                    ["SELECT ''", "scalar SQL result is empty"],
                    ["SELECT missing_population FROM notes", "missing_population"],
                    ["SELECT 1, 2", "scalar SQL needs exactly one column and one row"],
                    ["SELECT 1 WHERE false", "scalar SQL needs exactly one column and one row"],
                ].map(([query, message]) => ({ mode, privateNote, prefix, query, message })),
            ),
        ),
    ),
)(
    "refuses $query in $prefix prose (compiler: $mode, private: $privateNote)",
    async ({ mode, privateNote, prefix, query, message }) => {
        const tree = input();
        tree.add(
            "invalid",
            privateNote ? { pack: "private" } : {},
            `${prefix} {{sql "${query}"}}`,
            privateNote ? { tags: ["gm"] } : {},
        );
        const session = await createContentSession({ config: tree.config });
        try {
            const preparation =
                mode === "session" ?
                    session.compileCorpus()
                :   buildCompileCorpus({
                        config: tree.config,
                        contentBase: tree.config.paths.content,
                        skipDirectories: tree.config.skipDirectories,
                        router: createPackRouter(tree.config.packs),
                    });
            await expect(preparation).rejects.toThrow(message);
        } finally {
            await session.dispose();
            tree.close();
        }
    },
);

it("emits a mixed corpus with exact private facts and one supplement only where delivery needs it", async () => {
    const tree = input([
        ...packs,
        { name: "items", type: "Item", default: true },
        { name: "privateitems", type: "Item", private: true },
    ]);
    tree.add("ordinary", { population: { actual: 1100 } });
    tree.add("equal", { population: { actual: "1200", apparent: 1200 } });
    tree.add("different", { population: { actual: 2300, apparent: 800 } });
    tree.add("zero", { population: { actual: 4700, apparent: 0 } });
    tree.add("unknown", { population: { actual: 6100, apparent: null } });
    tree.add("unknownactual", { population: { actual: null } });
    tree.add("stub", { population: { actual: 7200, apparent: 600 } }, "");
    tree.add("nopack", { pack: "none", population: { actual: 9400, apparent: 700 } });
    const row = (settlement, polity, actual, apparent) => ({
        settlement,
        polity,
        type: "homestead",
        population: { actual, apparent },
        fortification: null,
        stronghold: null,
        holder: polity,
        market: "subsistence",
        notes: "A farm.",
    });
    const polity = { type: "affiliation", subType: "polity" };
    tree.add(
        "realm",
        {
            territorial_population: { actual: 99000, apparent: 88000 },
            settlements: [row("Fieldstead", "affiliation-realm", 230, 80)],
        },
        "An account of the realm.",
        polity,
    );
    tree.add(
        "seated",
        {
            parents: ["affiliation-realm"],
            seat: "place-seat",
            territorial_population: { actual: 12000, apparent: 9000 },
        },
        "A seated polity.",
        polity,
    );
    tree.add(
        "seat",
        {
            government: "affiliation-seated",
            type: "homestead",
            market: "subsistence",
            notes: "The seat.",
            population: { actual: 340, apparent: 120 },
        },
        "The settlement.",
        { subType: "settlement" },
    );
    tree.add(
        "seatless",
        {
            parents: ["affiliation-realm"],
            territorial_population: { actual: 5600, apparent: 2100 },
        },
        "A polity without a seat.",
        polity,
    );
    tree.add(
        "privatepolity",
        {
            pack: "privateitems",
            population: { actual: 670, apparent: 220 },
            territorial_population: { actual: 8300, apparent: 4100 },
            settlements: [row("Private Farm", "affiliation-privatepolity", 94, 12)],
        },
        "A private account.",
        { ...polity, tags: ["gm"] },
    );
    const session = await createContentSession({ config: tree.config });
    try {
        const before = structuredClone({ records: session.records, parsed: [...session.parsed] });
        const corpus = await session.compileCorpus();
        const publicDocs = await compile(tree, corpus, "journals");
        const privateDocs = await compile(tree, corpus, "private");
        const publicBytes = JSON.stringify(publicDocs);
        for (const count of [
            2300, 4700, 6100, 7200, 9400, 99000, 230, 12000, 340, 5600, 670, 8300, 94,
        ]) {
            expect(publicBytes).not.toMatch(new RegExp(`\\b${count.toLocaleString("en-US")}\\b`));
            expect(publicBytes).not.toMatch(new RegExp(`\\b${count}\\b`));
        }
        expect(publicDocs.some((entry) => entry.name === "privatepolity")).toBe(false);
        expect(publicDocs.some((entry) => ["stub", "nopack"].includes(entry.name))).toBe(false);
        expect(privateDocs.filter((entry) => entry.name === "privatepolity")).toHaveLength(1);
        expect(privateDocs.some((entry) => entry.name === "privatepolity — Population")).toBe(
            false,
        );
        const privatePage = JSON.stringify(
            privateDocs.find((entry) => entry.name === "privatepolity"),
        );
        for (const value of ["670", "220", "8,300", "4,100", "94", "Private Farm"])
            expect(privatePage).toContain(value);
        const realm = JSON.stringify(publicDocs.find((entry) => entry.name === "realm"));
        for (const value of ["80", "120", "2,100"]) expect(realm).toContain(value);
        const plan = populationJournalPlan(corpus.records, {
            config: tree.config,
            router: createPackRouter(tree.config.packs),
            parsed: corpus.parsed,
            contentBase: tree.config.paths.content,
            privateTables: corpus.audiences.all.sqlTables,
        });
        const supplements = privateDocs.filter((entry) => entry.name.endsWith(" — Population"));
        expect(supplements.map((entry) => entry.name).sort()).toEqual(
            [
                "different",
                "zero",
                "unknown",
                "stub",
                "nopack",
                "realm",
                "seated",
                "seat",
                "seatless",
            ]
                .map((name) => `${name} — Population`)
                .sort(),
        );
        expect(supplements.map((entry) => entry._id).sort()).toEqual(
            plan.subjects.map((subject) => subject.id).sort(),
        );
        for (const subject of plan.subjects) {
            const document = supplements.find((entry) => entry._id === subject.id);
            expect(document.ownership).toEqual({ default: 0 });
            const html = document.pages.map((page) => page.text.content).join("\n");
            for (const fact of subject.facts) {
                expect(html).toContain(
                    fact.actual === null ? "Unknown" : fact.actual.toLocaleString("en-US"),
                );
                expect(html).toContain(
                    fact.apparent === null ? "Unknown" : fact.apparent.toLocaleString("en-US"),
                );
            }
            if (["stub", "nopack"].includes(subject.name)) expect(html).not.toContain("@UUID[");
        }
        const different = publicDocs.find((entry) => entry.name === "different");
        const supplement = supplements.find((entry) => entry.name === "different — Population");
        expect(JSON.stringify(supplement)).toContain(
            `@UUID[Compendium.populationproof.journals.JournalEntry.${different._id}]`,
        );
        const result = emitContentIndex({
            config: tree.config,
            publication: await session.publication(),
        });
        const jsonl = fs.readFileSync(result.file, "utf8");
        for (const subject of plan.subjects) expect(jsonl).not.toContain(subject.id);
        expect({ records: session.records, parsed: [...session.parsed] }).toEqual(before);
        for (const [file, text] of tree.sources) expect(fs.readFileSync(file, "utf8")).toBe(text);
    } finally {
        await session.dispose();
        tree.close();
    }
});

it.each(["missing", "ambiguous"])(
    "refuses the %s private destination before any pack writes",
    async (kind) => {
        const list =
            kind === "missing" ?
                packs.slice(0, 1)
            :   [...packs, { name: "otherprivate", type: "JournalEntry", private: true }];
        const tree = input(list);
        tree.add("different", { population: { actual: 2300, apparent: 800 } });
        const marker = path.join(tree.config.paths.packJson, "journals", "keep.txt");
        write(marker, "Existing output.");
        try {
            await expect(generatePacksJson({ config: tree.config })).rejects.toThrow(
                /private JournalEntry destination/,
            );
            expect(fs.readFileSync(marker, "utf8")).toBe("Existing output.");
            expect(fs.readdirSync(tree.config.paths.packJson)).toEqual(["journals"]);
            expect(fs.readdirSync(path.dirname(marker))).toEqual(["keep.txt"]);
        } finally {
            tree.close();
        }
    },
);
