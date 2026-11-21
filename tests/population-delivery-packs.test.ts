/* SPDX-License-Identifier: GPL-3.0-or-later */

import { expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { configFromData } from "../engine/pack-config.mjs";
import { createPackRouter } from "../engine/pack-router.mjs";
import { createContentSession } from "../engine/content-session.mjs";
import { buildCompileCorpus } from "../engine/compile-corpus.mjs";
import { Journals, splitPages, journalPageId } from "../engine/journals.mjs";
import { collectFoundryEntries, foundryIdentities } from "../engine/foundry-entries.mjs";
import { parseMarkdownFile, buildContentLinkIndex } from "../engine/helpers.mjs";
import { itemDescription } from "../engine/item-compiler.mjs";
import { Items } from "../sohl/items.mjs";
import { Scenes } from "../engine/scenes.mjs";
import { makeId } from "../engine/ids.mjs";
import { anchorPageId } from "../engine/wikilinks.mjs";
import { generatePacksJson } from "../engine/generate.mjs";
import { emitContentIndex, prepareContentIndex } from "../engine/content-index.mjs";
import { populationJournalPlan } from "../engine/population-journals.mjs";
import { fixture, note, write } from "./content-session-fixture.js";

const packs = [
    { name: "journals", type: "JournalEntry", default: true },
    { name: "private", type: "JournalEntry", private: true },
];

function input(packList: object[] = packs, extraConfig: object = {}) {
    const tree = fixture(0, "populationproof");
    const data = {
        contentPackage: "populationproof",
        packageKind: "modules",
        compatibility: { minimum: "14", verified: "14.367" },
        stats: { lastModifiedBy: "populationtest01" },
        skipDirectories: ["Templates"],
        packs: packList,
        ...extraConfig,
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
    "prepares GM metadata without a private journal destination in %s mode",
    async (mode) => {
        const tree = input([{ name: "journals", type: "JournalEntry", default: true }]);
        tree.add(
            "hidden",
            { population: { actual: 2300, apparent: 800 } },
            "# Account {#account}\n\nPopulation {{data.population.apparent}}.",
            { tags: ["gm"] },
        );
        const session = await createContentSession({ config: tree.config });
        try {
            const before = structuredClone({
                records: session.records,
                parsed: [...session.parsed],
            });
            const publication =
                mode === "session" ?
                    await session.publication()
                :   await prepareContentIndex({ config: tree.config });
            const file = path.join(tree.config.paths.content, "hidden.md");
            expect(publication.foundryBodies.get(file).markdown).toContain("Population 800.");
            expect(publication.foundryBodies.get(file).markdown).not.toContain("2300");
            const result = emitContentIndex({ config: tree.config, publication });
            const bytes = fs.readFileSync(result.file, "utf8");
            const hidden = bytes
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line))
                .find((record) => record.shortcode === "hidden" && record.type === "place");
            expect(hidden.data.population).toEqual({ actual: null, apparent: 800 });
            expect(hidden.anchors).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ slug: "account", name: "Account" }),
                ]),
            );
            expect(hidden.foundry).toBeNull();
            expect(bytes).not.toContain("2300");
            await expect(compile(tree, await session.compileCorpus(), "journals")).rejects.toThrow(
                "Differing actual and apparent populations require one private JournalEntry destination",
            );
            expect(documents(path.join(tree.config.paths.packJson, "journals"))).toEqual([]);
            expect({ records: session.records, parsed: [...session.parsed] }).toEqual(before);
            for (const [source, text] of tree.sources)
                expect(fs.readFileSync(source, "utf8")).toBe(text);
        } finally {
            await session.dispose();
            tree.close();
        }
    },
);

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
            `# Population {{sql "${privateCountQuery}"}}\n\n[Account]{#safe}.\n\nResidents: {{sql "${privateCountQuery}"}}.\n\n[Account {{sql "${privateTextQuery}"}}]{#paragraph}.\n\n- Grouped residents: {{digits (sql "${privateCountQuery}")}}.\n\n| Detail | Residents |\n| --- | --- |\n| Account | {{sql "${privateCountQuery}"}} |\n\nZero {{sql "SELECT 0"}}; flag {{sql "SELECT false"}}.`,
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
            '[[place-privateplain#safe|Plain]] and [[place-privateinline#safe|Inline]], [[place-privateinline#paragraph|Paragraph]] and [[place-privateanchor#safe|Anchored]]. Zero {{sql "SELECT 0"}}; flag {{sql "SELECT false"}}.',
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
                    expect(projected).toContain("Zero 0; flag false.");
                    expect(reader).toContain("Zero 0; flag false.");
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

it.each(["session", "standalone"].flatMap((mode) => [false, true].map((gm) => ({ mode, gm }))))(
    "keeps private page targets independent of actual figures (compiler: $mode, GM: $gm)",
    async ({ mode, gm }) => {
        let previous;
        for (const actual of [4700, 6800]) {
            const tree = input();
            const query =
                "SELECT CASE WHEN data.population.actual IS NULL THEN 'Public estimate {#generated}' ELSE 'Generated ' || data.population.actual || ' {#generated}' END AS \"_section\", 'An account.' AS Entry FROM notes WHERE shortcode = 'stable'";
            const body = [
                "# Population {{data.population.actual}}",
                "",
                "[Account]{#safe}.",
                "",
                ": Example {#example}",
                "",
                "```text",
                "An example.",
                "```",
                "",
                "[After the example]{#after}.",
                "",
                ...(gm ?
                    [
                        "{{sql \"SELECT 'Extra ' || data.population.actual || chr(10) || 'second line' FROM notes WHERE shortcode = 'stable'\"}}",
                        "",
                    ]
                :   []),
                "## Details {{data.population.actual}} {#details}",
                "",
                "Details.",
                "",
                ...(gm ?
                    [
                        "# Scalar {{sql \"SELECT data.population.actual FROM notes WHERE shortcode = 'stable'\"}}",
                        "",
                        "[Scalar account]{#scalar}.",
                        "",
                    ]
                :   []),
                "```sql",
                query,
                "```",
                "",
                "[Generated account]{#generated-safe}.",
            ].join("\n");
            tree.add(
                "stable",
                { pack: "private", population: { actual, apparent: 900 } },
                body,
                gm ? { tags: ["gm"] } : {},
            );
            tree.add(
                "reader",
                {},
                "[[place-stable#safe|Account]], [[place-stable#after|After]], [[place-stable#details|Details]] and [[place-stable#generated-safe|Generated]].",
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
                const document = privateDocs.find((entry) => entry.name === "stable");
                const first = document.pages.find((page) =>
                    page.text?.content?.includes('id="safe"'),
                );
                expect(first.name).toBe(`Population ${actual}`);
                expect(first._id).not.toBe(
                    makeId("journal-page", `${document._id}:Population ${actual}`),
                );
                expect(document.pages.find((page) => page.name === `Details ${actual}`)._id).toBe(
                    anchorPageId(document._id, "details"),
                );
                expect(document.pages.some((page) => page.name === `Generated ${actual}`)).toBe(
                    true,
                );
                if (gm)
                    expect(document.pages.some((page) => page.name === `Scalar ${actual}`)).toBe(
                        true,
                    );
                const publication = await session.publication();
                const result = emitContentIndex({ config: tree.config, publication });
                const jsonl = fs.readFileSync(result.file, "utf8");
                const published = jsonl
                    .trim()
                    .split("\n")
                    .map((line) => JSON.parse(line))
                    .find((record) => record.type === "place" && record.shortcode === "stable");
                const reader = JSON.stringify(publicDocs.find((entry) => entry.name === "reader"));
                for (const slug of ["safe", "after", "details", "generated-safe"]) {
                    const target = published.foundry.note.anchors[slug];
                    expect(target).toBeTruthy();
                    const pageId = target.split(".").at(-1);
                    expect(document.pages.some((page) => page._id === pageId)).toBe(true);
                    expect(reader).toContain(target);
                }
                expect(published.foundry.note.anchors.$lead).toBe(
                    `${published.foundry.note.uuid}.JournalEntryPage.${first._id}`,
                );
                const state = {
                    ids: document.pages.map((page) => page._id),
                    anchors: published.foundry.note.anchors,
                };
                if (previous) expect(state).toEqual(previous);
                previous = state;
                const metadata =
                    jsonl +
                    JSON.stringify([...corpus.audiences.public.linkIndex.byShortcode.values()]);
                expect(metadata).not.toMatch(new RegExp(`\\b${actual}\\b`));
                for (const hidden of [
                    "SELECT",
                    `Population ${actual}`,
                    `Generated ${actual}`,
                    "sourceIdentity",
                    "lineMap",
                    "journal-private-page",
                ])
                    expect(metadata).not.toContain(hidden);
                expect({ records: session.records, parsed: [...session.parsed] }).toEqual(before);
                for (const [file, text] of tree.sources)
                    expect(fs.readFileSync(file, "utf8")).toBe(text);
            } finally {
                await session.dispose();
                tree.close();
            }
        }
    },
);

it.each(["session", "standalone"])(
    "uses private documentation page identities from public item and scene passes in %s mode",
    async (mode) => {
        const tree = input(
            [
                { name: "private", type: "JournalEntry", private: true, default: true },
                { name: "journals", type: "JournalEntry" },
                { name: "items", type: "Item", system: "sohl", default: true },
                {
                    name: "scenes",
                    type: "Scene",
                    default: true,
                    companions: [{ name: "adventures", type: "Adventure" }],
                },
            ],
            { itemBuilders: ["sohl"], systems: { sohl: { compatibility: { verified: "0.9.0" } } } },
        );
        const body =
            "# Population {{data.population.actual}}\n\n[Account]{#safe}.\n\n## Details {{data.population.actual}} {#details}\n\nAn account.";
        tree.add("item", { population: { actual: 4700, apparent: 900 } }, body, {
            type: "skill",
            subType: "physical",
            sohl: { subType: "physical", templatePriority: null },
        });
        tree.add(
            "map",
            {
                population: { actual: 4700, apparent: 900 },
                scene: {
                    name: "Map",
                    width: 512,
                    height: 512,
                    grid: { type: 1, size: 64, distance: 5, units: "ft" },
                    initialLevel: "defaultLevel0000",
                    levels: [
                        { _id: "defaultLevel0000", background: { src: "maps/parchment.webp" } },
                    ],
                    notes: [
                        { _id: "NNNNNNNNNNNNNNNN", text: "#details", x: 256, y: 256 },
                        { _id: "GGGGGGGGGGGGGGGG", text: "#generated", x: 128, y: 128 },
                    ],
                },
            },
            [
                body,
                "",
                "```sql",
                "SELECT (CASE WHEN data.population.actual IS NULL THEN 'Public estimate' ELSE 'Generated ' || data.population.actual END) || ' {#' || 'generated' || '}' AS \"_section\", 'An account.' AS Entry FROM notes WHERE type = 'map' AND shortcode = 'map' AND documents IS NULL",
                "```",
            ].join("\n"),
            { type: "map", subType: "battlemap" },
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
            const directories = Object.fromEntries(
                ["items", "scenes", "adventures"].map((name) => {
                    const directory = path.join(tree.config.paths.packJson, name);
                    fs.mkdirSync(directory, { recursive: true });
                    return [name, directory];
                }),
            );
            const items = new Items({
                contentBase: tree.config.paths.content,
                skipDirectories: tree.config.skipDirectories,
                dest: directories.items,
                packName: "items",
                corpus,
            });
            await items.compile();
            expect(items.errorCount).toBe(0);
            const scenes = new Scenes({
                contentBase: tree.config.paths.content,
                skipDirectories: tree.config.skipDirectories,
                dest: directories.scenes,
                packName: "scenes",
                corpus,
                companionDests: { adventures: directories.adventures },
            });
            await scenes.compile();
            expect(scenes.errorCount).toBe(0);
            const item = documents(directories.items).find((entry) => entry.name === "item");
            const itemDoc = privateDocs.find((entry) => entry.name === "item");
            const itemPage = itemDoc.pages.find((page) => page.name === "Population 4700");
            expect(item.system.docHtml).toContain(
                `Compendium.populationproof.private.JournalEntry.${itemDoc._id}.JournalEntryPage.${itemPage._id}`,
            );
            const scene = documents(directories.scenes)[0];
            const mapDoc = privateDocs.find((entry) => entry.name === "map");
            const mapPage = mapDoc.pages.find((page) => page.name === "Details 4700");
            expect(scene.notes[0].entryId).toBe(mapDoc._id);
            expect(scene.notes[0].pageId).toBe(mapPage._id);
            const adventure = documents(directories.adventures)[0];
            const bundled = adventure.journal[0];
            const generatedPage = mapDoc.pages.find((page) => page.name === "Generated 4700");
            const generatedCompanion = bundled.pages.find(
                (page) => page.name === "Public estimate",
            );
            expect(scene.notes[1].entryId).toBe(mapDoc._id);
            expect(scene.notes[1].pageId).toBe(generatedPage._id);
            expect(scene.notes[1].pageId).toBe(generatedCompanion._id);
            expect(scene.notes[1].pageId).toBe(anchorPageId(mapDoc._id, "generated"));
            expect(scene.notes[1].text).toBe("Public estimate");
            expect(mapDoc.pages.some((page) => page.name === "Population 4700")).toBe(true);
            expect(
                bundled.pages.every((page) =>
                    mapDoc.pages.some((native) => native._id === page._id),
                ),
            ).toBe(true);
            const publicPayload = JSON.stringify({ item, scene, adventure });
            expect(publicPayload).not.toMatch(/\b4700\b/);
            for (const secret of [
                "4,700",
                "Population 4700",
                "Details 4700",
                "Generated 4700",
                "SELECT CASE",
                "sourceIdentity",
            ])
                expect(publicPayload).not.toContain(secret);
            expect({ records: session.records, parsed: [...session.parsed] }).toEqual(before);
        } finally {
            await session.dispose();
            tree.close();
        }
    },
);

it("publishes a static private index synchronously with compatible native page IDs", async () => {
    const tree = input();
    tree.add(
        "static",
        { pack: "private" },
        "# Account\n\n[Account]{#safe}.\n\n## Details {#details}\n\nDetails.",
    );
    try {
        const result = emitContentIndex({ config: tree.config });
        const published = fs
            .readFileSync(result.file, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
            .find((record) => record.type === "place" && record.shortcode === "static");
        const expected = makeId("journal-page", `${published.id}:Account`);
        const target = `${published.foundry.note.uuid}.JournalEntryPage.${expected}`;
        expect(published.foundry.note.anchors.safe).toBe(target);
        expect(published.foundry.note.anchors.$lead).toBe(target);
        expect(published.foundry.note.anchors.details).toBe(
            `${published.foundry.note.uuid}.JournalEntryPage.${anchorPageId(published.id, "details")}`,
        );
        const session = await createContentSession({ config: tree.config });
        try {
            const corpus = await session.compileCorpus();
            const [document] = await compile(tree, corpus, "private");
            expect(document.pages.find((page) => page.name === "Account")._id).toBe(expected);
            for (const [file, text] of tree.sources)
                expect(fs.readFileSync(file, "utf8")).toBe(text);
        } finally {
            await session.dispose();
        }
    } finally {
        tree.close();
    }
});

it.each(
    ["session", "standalone"].flatMap((mode) => ["Town", ""].map((label) => ({ mode, label }))),
)(
    "preserves raw manifest, index and native static link targets ($mode, label $label)",
    async ({ mode, label }) => {
        let previous;
        for (const prefix of ["", "An introductory paragraph.\n\n"]) {
            const tree = input();
            tree.add("town", {}, "The town.", { name: { full: "Town" } });
            tree.add(
                "account",
                { pack: "private" },
                `${prefix}# [[place-town|${label}]]\n\n[Account]{#safe}.`,
            );
            const session = await createContentSession({ config: tree.config });
            try {
                const before = structuredClone({
                    records: session.records,
                    parsed: [...session.parsed],
                });
                const manifest = collectFoundryEntries(tree.config.paths.content, {
                    ...foundryIdentities(tree.config),
                    skipDirectories: tree.config.skipDirectories,
                });
                const raw = manifest.entries.find((entry) => entry.fm.shortcode === "account");
                const result = emitContentIndex({ config: tree.config });
                const jsonl = fs.readFileSync(result.file, "utf8");
                const published = jsonl
                    .trim()
                    .split("\n")
                    .map((line) => JSON.parse(line))
                    .find((record) => record.type === "place" && record.shortcode === "account");
                const expected = makeId("journal-page", `${published.id}:Town`);
                const target = `${published.foundry.note.uuid}.JournalEntryPage.${expected}`;
                expect(raw.anchors.safe).toBe(target);
                expect(published.foundry.note.anchors.safe).toBe(target);
                if (previous) expect(target).toBe(previous);
                previous = target;
                const corpus =
                    mode === "session" ?
                        await session.compileCorpus()
                    :   await buildCompileCorpus({
                            config: tree.config,
                            contentBase: tree.config.paths.content,
                            skipDirectories: tree.config.skipDirectories,
                            router: createPackRouter(tree.config.packs),
                        });
                const [document] = await compile(tree, corpus, "private");
                expect(document.pages.find((page) => page.name === "Town")._id).toBe(expected);
                const lead = `${published.foundry.note.uuid}.JournalEntryPage.${document.pages[0]._id}`;
                expect(raw.anchors.$lead).toBe(lead);
                expect(published.foundry.note.anchors.$lead).toBe(lead);
                expect(
                    corpus.audiences.public.linkIndex.byShortcode.get("place/account").anchorUuids
                        .safe,
                ).toBe(target);
                expect(
                    jsonl +
                        JSON.stringify([...corpus.audiences.public.linkIndex.byShortcode.values()]),
                ).not.toContain("referenceName");
                expect({ records: session.records, parsed: [...session.parsed] }).toEqual(before);
                for (const [file, text] of tree.sources)
                    expect(fs.readFileSync(file, "utf8")).toBe(text);
            } finally {
                await session.dispose();
                tree.close();
            }
        }
    },
);

it("locates a private item description's missing provenance at its authored body", () => {
    const tree = input([{ name: "private", type: "JournalEntry", default: true, private: true }]);
    try {
        tree.add("account", {}, "An account.", { type: "skill", subType: "physical" });
        const file = path.join(tree.config.paths.content, "account.md");
        const { bodyLine } = parseMarkdownFile(file);
        expect(() =>
            itemDescription(
                "An account.",
                { type: "skill", shortcode: "account" },
                "Account",
                undefined,
                { file, bodyLine, config: tree.config },
            ),
        ).toThrow(
            `${file}:${bodyLine}:1: error: private item documentation has no captured source provenance`,
        );
    } finally {
        tree.close();
    }
});

it.each(["session", "standalone"])(
    "keeps SQL-bearing reference failures fatal in %s preparation",
    async (mode) => {
        const tree = input();
        tree.add("broken", {}, '{{and (ref "#missing") (sql "SELECT NULL")}}');
        const session = await createContentSession({ config: tree.config });
        try {
            const build = () =>
                mode === "session" ?
                    session.compileCorpus()
                :   buildCompileCorpus({
                        config: tree.config,
                        contentBase: tree.config.paths.content,
                        skipDirectories: tree.config.skipDirectories,
                    });
            await expect(build()).rejects.toThrow(/names no figure for anchor "#missing"/);
            expect(documents(path.join(tree.config.paths.packJson, "journals"))).toEqual([]);
        } finally {
            await session.dispose();
            tree.close();
        }
    },
);

it.each(["session", "standalone"])(
    "refuses scalar fences that change authored public anchor owners in %s mode",
    async (mode) => {
        for (const kind of ["static", "blanked", "generated-caption"])
            for (const actual of [700, 1700]) {
                const tree = input();
                const generated =
                    kind === "generated-caption" ?
                        "': Example {#example}' || chr(10) || chr(10) || '```text' || chr(10) || 'An example.' || chr(10) || '```'"
                    :   "'~~~'";
                const query = `SELECT CASE WHEN data.population.actual > 1000 THEN ${generated} ELSE ' ' END FROM notes WHERE shortcode = 'fenced'`;
                const scalar = `{{sql "${query}"}}`;
                const heading =
                    kind === "static" ? "# Alpha" : "# Population {{data.population.actual}}";
                tree.add(
                    "fenced",
                    { pack: "private", population: { actual, apparent: 900 } },
                    kind === "generated-caption" ?
                        `${heading}\n\n[Own]{#own}.\n\n${scalar}\n\n[Foo]{#foo}.`
                    :   `${heading}\n\n[Own]{#own}.\n\n${scalar}\n\n# Beta\n\n${scalar}\n\n[Foo]{#foo}.`,
                    { tags: ["gm"] },
                );
                const session = await createContentSession({ config: tree.config });
                try {
                    const before = structuredClone({
                        records: session.records,
                        parsed: [...session.parsed],
                    });
                    const build = () =>
                        mode === "session" ?
                            session.compileCorpus()
                        :   buildCompileCorpus({
                                config: tree.config,
                                contentBase: tree.config.paths.content,
                                skipDirectories: tree.config.skipDirectories,
                                router: createPackRouter(tree.config.packs),
                            });
                    const publication = await session.publication();
                    if (actual === 1700) {
                        const message =
                            /fenced\.md:\d+:1: error: public anchor "foo" resolves to different public and private pages/;
                        await expect(build()).rejects.toThrow(message);
                        expect(() =>
                            emitContentIndex({ config: tree.config, publication }),
                        ).toThrow(message);
                        expect(documents(path.join(tree.config.paths.packJson, "private"))).toEqual(
                            [],
                        );
                    } else {
                        const corpus = await build();
                        const [document] = await compile(tree, corpus, "private");
                        const page = document.pages.find(
                            (page) =>
                                page.name ===
                                (kind === "generated-caption" ? "Population 700" : "Beta"),
                        );
                        const indexed =
                            corpus.audiences.public.linkIndex.byShortcode.get("place/fenced");
                        expect(indexed.anchorUuids.foo).toBe(
                            `Compendium.populationproof.private.JournalEntry.${document._id}.JournalEntryPage.${page._id}`,
                        );
                        const result = emitContentIndex({ config: tree.config, publication });
                        const bytes = fs.readFileSync(result.file, "utf8");
                        for (const hidden of [
                            query,
                            "Population 700",
                            "sourceHeading",
                            "sourceFigure",
                            "sourceAfterFigure",
                            "blankedHeadingAnchors",
                        ])
                            expect(bytes).not.toContain(hidden);
                    }
                    expect({ records: session.records, parsed: [...session.parsed] }).toEqual(
                        before,
                    );
                    for (const [file, text] of tree.sources)
                        expect(fs.readFileSync(file, "utf8")).toBe(text);
                } finally {
                    await session.dispose();
                    tree.close();
                }
            }
    },
);

it.each(["session", "standalone"])(
    "resolves only a blanked dynamic heading's own safe anchors in %s mode",
    async (mode) => {
        let previous;
        for (const actual of [700, 1700]) {
            const tree = input();
            tree.add(
                "blanked",
                { pack: "private", population: { actual, apparent: 900 } },
                "# Population {{data.population.actual}}\n\n[Own]{#safe}.\n\n: Example {#example}\n\n```text\nAn example.\n```\n\n[After]{#after}.",
                { tags: ["gm"] },
            );
            const session = await createContentSession({ config: tree.config });
            try {
                const corpus =
                    mode === "session" ?
                        await session.compileCorpus()
                    :   await buildCompileCorpus({
                            config: tree.config,
                            contentBase: tree.config.paths.content,
                            skipDirectories: tree.config.skipDirectories,
                            router: createPackRouter(tree.config.packs),
                        });
                const [document] = await compile(tree, corpus, "private");
                const page = document.pages.find((page) => page.name === `Population ${actual}`);
                const target = `Compendium.populationproof.private.JournalEntry.${document._id}.JournalEntryPage.${page._id}`;
                const indexed = corpus.audiences.public.linkIndex.byShortcode.get("place/blanked");
                expect(indexed.anchorUuids.safe).toBe(target);
                expect(indexed.anchorUuids.$lead).toBe(target);
                const continuation = document.pages.find((page) =>
                    page.text?.content?.includes('id="after"'),
                );
                expect(indexed.anchorUuids.after).toBe(
                    `Compendium.populationproof.private.JournalEntry.${document._id}.JournalEntryPage.${continuation._id}`,
                );
                const targets = { lead: target, after: indexed.anchorUuids.after };
                if (previous) expect(targets).toEqual(previous);
                previous = targets;
                const publication = await session.publication();
                const result = emitContentIndex({ config: tree.config, publication });
                const metadata = JSON.stringify(indexed) + fs.readFileSync(result.file, "utf8");
                for (const hidden of [
                    `Population ${actual}`,
                    "sourceHeading",
                    "sourceFigure",
                    "sourceAfterFigure",
                    "blankedHeadingAnchors",
                ])
                    expect(metadata).not.toContain(hidden);
            } finally {
                await session.dispose();
                tree.close();
            }
        }
    },
);

it.each(["session", "standalone"])(
    "compares authored and generated public owners for spans and leads in %s mode",
    async (mode) => {
        for (const kind of ["span", "lead", "item"])
            for (const actual of [700, 1700]) {
                const tree = input(
                    [
                        { name: "private", type: "JournalEntry", private: true, default: true },
                        { name: "journals", type: "JournalEntry" },
                        { name: "items", type: "Item", system: "sohl", default: true },
                    ],
                    {
                        itemBuilders: ["sohl"],
                        systems: { sohl: { compatibility: { verified: "0.9.0" } } },
                    },
                );
                const ownRecord = kind === "item" ? " AND documents IS NULL" : "";
                const query =
                    "SELECT 'Generated account' AS \"_section\", 'Account.' AS Entry FROM notes WHERE shortcode = 'owner'" +
                    ownRecord +
                    " AND (data.population.actual IS NULL OR data.population.actual < 1000)";
                const fence = `\`\`\`sql {section-level=1 allow-empty=true}\n${query}\n\`\`\``;
                const body =
                    kind === "span" ?
                        `# Authored {#authored}\n\nAccount.\n\n${fence}\n\n[Safe account]{#safe}.`
                    :   `${fence}\n\n# Authored {#authored}\n\nAccount.`;
                tree.add(
                    "owner",
                    { population: { actual, apparent: 900 } },
                    body,
                    kind === "item" ?
                        {
                            type: "skill",
                            subType: "physical",
                            sohl: { subType: "physical", templatePriority: null },
                        }
                    :   {},
                );
                const session = await createContentSession({ config: tree.config });
                try {
                    const before = structuredClone({
                        records: session.records,
                        parsed: [...session.parsed],
                    });
                    const build = () =>
                        mode === "session" ?
                            session.compileCorpus()
                        :   buildCompileCorpus({
                                config: tree.config,
                                contentBase: tree.config.paths.content,
                                skipDirectories: tree.config.skipDirectories,
                                router: createPackRouter(tree.config.packs),
                            });
                    const publication = await session.publication();
                    if (actual === 1700) {
                        const slug = kind === "span" ? "safe" : "$lead";
                        const message = `public anchor "${slug}" resolves to different public and private pages`;
                        await expect(build()).rejects.toThrow(message);
                        expect(() =>
                            emitContentIndex({ config: tree.config, publication }),
                        ).toThrow(message);
                        expect(documents(path.join(tree.config.paths.packJson, "items"))).toEqual(
                            [],
                        );
                        expect(documents(path.join(tree.config.paths.packJson, "private"))).toEqual(
                            [],
                        );
                    } else {
                        const corpus = await build();
                        const [document] = await compile(tree, corpus, "private");
                        const page = document.pages.find(
                            (page) => page.name === "Generated account",
                        );
                        const indexed = corpus.audiences.public.linkIndex.byShortcode.get(
                            `${kind === "item" ? "skill" : "place"}/owner`,
                        );
                        const target = (
                            kind === "item" ?
                                indexed.docAnchorUuids
                            :   indexed.anchorUuids)[kind === "span" ? "safe" : "$lead"];
                        expect(target).toBe(
                            `Compendium.populationproof.private.JournalEntry.${document._id}.JournalEntryPage.${page._id}`,
                        );
                    }
                    expect({ records: session.records, parsed: [...session.parsed] }).toEqual(
                        before,
                    );
                    for (const [file, text] of tree.sources)
                        expect(fs.readFileSync(file, "utf8")).toBe(text);
                } finally {
                    await session.dispose();
                    tree.close();
                }
            }
    },
);

it.each(["session", "standalone"])(
    "publishes identical positional generated pages and item leads in %s mode",
    async (mode) => {
        const tree = input(
            [
                { name: "private", type: "JournalEntry", private: true, default: true },
                { name: "journals", type: "JournalEntry" },
                { name: "items", type: "Item", system: "sohl", default: true },
            ],
            { itemBuilders: ["sohl"], systems: { sohl: { compatibility: { verified: "0.9.0" } } } },
        );
        const body =
            "\`\`\`sql {section-level=1}\nSELECT 'Generated account' AS \"_section\", 'Account.' AS Entry\n\`\`\`\n\n[Safe account]{#safe}.";
        tree.add("plain", {}, body);
        tree.add("item", {}, body, {
            type: "skill",
            subType: "physical",
            sohl: { subType: "physical", templatePriority: null },
        });
        const session = await createContentSession({ config: tree.config });
        try {
            const corpus =
                mode === "session" ?
                    await session.compileCorpus()
                :   await buildCompileCorpus({
                        config: tree.config,
                        contentBase: tree.config.paths.content,
                        skipDirectories: tree.config.skipDirectories,
                        router: createPackRouter(tree.config.packs),
                    });
            const native = await compile(tree, corpus, "private");
            const publication = await session.publication();
            const output = emitContentIndex({ config: tree.config, publication });
            const bytes = fs.readFileSync(output.file, "utf8");
            for (const [name, type] of [
                ["plain", "place"],
                ["item", "skill"],
            ]) {
                const document = native.find((entry) => entry.name === name);
                const page = document.pages.find((entry) => entry.name === "Generated account");
                const captured = corpus.pageSources.get(
                    path.join(tree.config.paths.content, `${name}.md`),
                );
                const [rawPage] = splitPages(
                    captured.markdown,
                    undefined,
                    undefined,
                    undefined,
                    captured,
                );
                expect(rawPage.sourceAuthored).toBe(false);
                expect(rawPage.sourceIdentity.privateOnly).toBe(true);
                expect(page._id).toBe(journalPageId(document._id, rawPage));
                const record = corpus.audiences.public.linkIndex.byShortcode.get(`${type}/${name}`);
                const anchors = type === "skill" ? record.docAnchorUuids : record.anchorUuids;
                const target = `Compendium.populationproof.private.JournalEntry.${document._id}.JournalEntryPage.${page._id}`;
                expect(anchors.safe).toBe(target);
                expect(anchors.$lead).toBe(target);
                expect(bytes).toContain(target);
            }
            const dest = path.join(tree.config.paths.packJson, "items");
            fs.mkdirSync(dest, { recursive: true });
            const items = new Items({
                contentBase: tree.config.paths.content,
                skipDirectories: tree.config.skipDirectories,
                dest,
                packName: "items",
                corpus,
            });
            await items.compile();
            expect(items.errorCount).toBe(0);
            const lead =
                corpus.audiences.public.linkIndex.byShortcode.get("skill/item").docAnchorUuids
                    .$lead;
            expect(documents(dest).find((entry) => entry.name === "item").system.docHtml).toContain(
                lead,
            );
            expect(bytes).not.toContain("sourceAuthored");
        } finally {
            await session.dispose();
            tree.close();
        }
    },
);

it.each(["session", "standalone"])(
    "keeps public data-assembled page targets stable across private rows in %s mode",
    async (mode) => {
        let previous;
        for (const actual of [700, 1700]) {
            const tree = input();
            const query = [
                "WITH subject AS (SELECT data.population.actual AS actual FROM notes WHERE type = 'place' AND shortcode = 'assembled')",
                "SELECT (CASE WHEN actual IS NULL THEN 'Public ' ELSE 'Residents ' || actual || ' ' END) || code || ' {#' || code || '}' AS \"_section\", 'An account.' AS Entry FROM (",
                "SELECT actual, 'alpha' AS code, CASE WHEN actual = 700 THEN 2 ELSE 0 END AS sort_order FROM subject",
                "UNION ALL SELECT actual, 'beta', CASE WHEN actual = 700 THEN 0 ELSE 2 END FROM subject",
                "UNION ALL SELECT actual, 'extra', 1 FROM subject WHERE actual = 1700",
                "UNION ALL SELECT actual, 'end', 3 FROM subject) ORDER BY sort_order",
            ].join("\n");
            tree.add(
                "assembled",
                { pack: "private", population: { actual, apparent: 900 } },
                `# Account {#account}\n\nAn account.\n\n\`\`\`sql\n${query}\n\`\`\`\n\n[Safe account]{#safe}.`,
            );
            tree.add(
                "reader",
                {},
                "[[place-assembled#alpha|Alpha]] and [[place-assembled#safe|Safe]].",
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
                const [document] = await compile(tree, corpus, "private");
                const targets =
                    corpus.audiences.public.linkIndex.byShortcode.get(
                        "place/assembled",
                    ).anchorUuids;
                for (const slug of ["alpha", "beta", "end"]) {
                    const page = document.pages.find(
                        (page) => page.name === `Residents ${actual} ${slug}`,
                    );
                    expect(page._id).toBe(anchorPageId(document._id, slug));
                    expect(targets[slug]).toBe(
                        `Compendium.populationproof.private.JournalEntry.${document._id}.JournalEntryPage.${page._id}`,
                    );
                }
                expect(targets.safe).toBe(targets.end);
                expect(targets.extra).toBeUndefined();
                expect(
                    document.pages.some((page) => page.name === `Residents ${actual} extra`),
                ).toBe(actual === 1700);
                if (previous) expect(targets).toEqual(previous);
                previous = targets;
                const rawTables = await session.sqlTables("all");
                const linkOptions = {
                    config: tree.config,
                    records: session.records,
                    foreign: session.foreign,
                };
                expect(() =>
                    buildContentLinkIndex(
                        tree.config.paths.content,
                        createPackRouter(tree.config.packs),
                        {
                            ...linkOptions,
                            sqlTables: rawTables,
                        },
                    ),
                ).toThrow("private generated journal targets require paired public preparation");
                const complete = buildContentLinkIndex(
                    tree.config.paths.content,
                    createPackRouter(tree.config.packs),
                    {
                        ...linkOptions,
                        sqlTables: corpus.audiences.all.sqlTables,
                    },
                );
                expect(complete.byShortcode.get("place/assembled").anchorUuids.end).toBe(
                    targets.end,
                );
                const publicDocs = await compile(tree, corpus, "journals");
                expect(JSON.stringify(publicDocs)).toContain(targets.safe);
                const publication = await session.publication();
                const output = emitContentIndex({ config: tree.config, publication });
                const metadata =
                    fs.readFileSync(output.file, "utf8") +
                    JSON.stringify([...corpus.audiences.public.linkIndex.byShortcode.values()]);
                for (const hidden of [
                    String(actual),
                    "SELECT",
                    "Residents",
                    "publicAnchors",
                    "privateOnly",
                    "privatePageSourcePending",
                ])
                    expect(metadata).not.toContain(hidden);
                expect({ records: session.records, parsed: [...session.parsed] }).toEqual(before);
                for (const [file, text] of tree.sources)
                    expect(fs.readFileSync(file, "utf8")).toBe(text);
            } finally {
                await session.dispose();
                tree.close();
            }
        }
    },
);

it.each(["session", "standalone"])(
    "refuses a missing private target without changing public anchor presence in %s mode",
    async (mode) => {
        let projected;
        for (const actual of [700, 1700]) {
            const tree = input();
            const query = [
                "SELECT 'Baseline {#baseline}' AS \"_section\", 'An account.' AS Entry",
                "UNION ALL SELECT 'Conditional {#' || shortcode || '}', 'An account.' FROM notes",
                "WHERE type = 'place' AND shortcode = 'threshold' AND (data.population.actual IS NULL OR data.population.actual < 1000)",
            ].join("\n");
            tree.add(
                "threshold",
                { pack: "private", population: { actual, apparent: 900 } },
                `# Account {#account}\n\nAn account.\n\n\`\`\`sql\n${query}\n\`\`\``,
                { tags: ["gm"] },
            );
            const session = await createContentSession({ config: tree.config });
            try {
                const file = path.join(tree.config.paths.content, "threshold.md");
                const publication = await session.publication();
                const current = publication.expandedBodies.get(file).markdown;
                expect(current).toContain("Conditional {#threshold}");
                if (projected) expect(current).toBe(projected);
                projected = current;
                const build = () =>
                    mode === "session" ?
                        session.compileCorpus()
                    :   buildCompileCorpus({
                            config: tree.config,
                            contentBase: tree.config.paths.content,
                            skipDirectories: tree.config.skipDirectories,
                            router: createPackRouter(tree.config.packs),
                        });
                if (actual === 1700) {
                    await expect(build()).rejects.toThrow(
                        /threshold\.md:\d+:1: error: public anchor "threshold" has no private journal target/,
                    );
                    expect(() => emitContentIndex({ config: tree.config, publication })).toThrow(
                        /public anchor "threshold" has no private journal target/,
                    );
                    expect(documents(path.join(tree.config.paths.packJson, "private"))).toEqual([]);
                } else {
                    const corpus = await build();
                    const [document] = await compile(tree, corpus, "private");
                    const target =
                        corpus.audiences.public.linkIndex.byShortcode.get("place/threshold")
                            .anchorUuids.threshold;
                    expect(target).toBe(
                        `Compendium.populationproof.private.JournalEntry.${document._id}.JournalEntryPage.${anchorPageId(document._id, "threshold")}`,
                    );
                    expect(
                        document.pages.some(
                            (page) => page._id === anchorPageId(document._id, "threshold"),
                        ),
                    ).toBe(true);
                    const output = emitContentIndex({ config: tree.config, publication });
                    expect(fs.readFileSync(output.file, "utf8")).toContain(target);
                }
                for (const [source, text] of tree.sources)
                    expect(fs.readFileSync(source, "utf8")).toBe(text);
            } finally {
                await session.dispose();
                tree.close();
            }
        }
    },
);

it.each(["session", "standalone"])(
    "refuses a public span on a private positional generated page in %s mode",
    async (mode) => {
        let privateTarget;
        for (const actual of [700, 1700]) {
            const tree = input();
            const query = [
                "WITH subject AS (SELECT data.population.actual AS actual FROM notes WHERE type = 'place' AND shortcode = 'trailing')",
                "SELECT title AS \"_section\", 'An account.' AS Entry FROM (",
                "SELECT 'Baseline {#baseline}' AS title, 0 AS sort_order",
                "UNION ALL SELECT 'Private earlier', 1 FROM subject WHERE actual = 1700",
                "UNION ALL SELECT 'Private final', 2 FROM subject WHERE actual IS NOT NULL) ORDER BY sort_order",
            ].join("\n");
            tree.add(
                "trailing",
                { pack: "private", population: { actual, apparent: 900 } },
                `# Account {#account}\n\nAn account.\n\n\`\`\`sql {section-level=1}\n${query}\n\`\`\`\n\n[Safe account]{#safe}.`,
            );
            const session = await createContentSession({ config: tree.config });
            try {
                const publication = await session.publication();
                const native = publication.foundryBodies.get(
                    path.join(tree.config.paths.content, "trailing.md"),
                );
                const page = splitPages(
                    native.markdown,
                    undefined,
                    undefined,
                    undefined,
                    native,
                ).find((page) => page.name === "Private final");
                expect(page.sourceIdentity.privateOnly).toBe(true);
                const id = journalPageId(
                    session.records.find((record) => record.shortcode === "trailing").id,
                    page,
                );
                if (privateTarget) expect(id).not.toBe(privateTarget);
                privateTarget = id;
                const build = () =>
                    mode === "session" ?
                        session.compileCorpus()
                    :   buildCompileCorpus({
                            config: tree.config,
                            contentBase: tree.config.paths.content,
                            skipDirectories: tree.config.skipDirectories,
                            router: createPackRouter(tree.config.packs),
                        });
                await expect(build()).rejects.toThrow(
                    /trailing\.md:\d+:1: error: public anchor "safe" resolves to different public and private pages/,
                );
                expect(() => emitContentIndex({ config: tree.config, publication })).toThrow(
                    /public anchor "safe" resolves to different public and private pages/,
                );
                expect(documents(path.join(tree.config.paths.packJson, "private"))).toEqual([]);
            } finally {
                await session.dispose();
                tree.close();
            }
        }
    },
);

it.each(["session", "standalone"])(
    "keeps declared generated targets stable through private SQL ordering and filtering in %s mode",
    async (mode) => {
        let previous;
        for (const actual of [4700, 6800]) {
            const tree = input();
            const query = [
                "WITH subject AS (SELECT data.population.actual AS actual FROM notes WHERE type = 'place' AND shortcode = 'ordered')",
                "SELECT title AS \"_section\", 'An account.' AS Entry FROM (",
                "SELECT 'Earlier {#earlier}' AS title, CASE WHEN actual = 4700 THEN 1 ELSE 0 END AS sort_order FROM subject",
                "UNION ALL SELECT 'Another {#another}', CASE WHEN actual = 4700 THEN 0 ELSE 1 END FROM subject",
                "UNION ALL SELECT 'Extra {#extra}', 2 FROM subject WHERE actual = 6800",
                "UNION ALL SELECT CASE WHEN actual IS NULL THEN 'Public estimate {#generated}' ELSE 'Generated ' || actual || ' {#generated}' END, 3 FROM subject",
                ") ORDER BY sort_order",
            ].join("\n");
            const source = [
                "# Population {{data.population.actual}}",
                "",
                "An account.",
                "",
                "```sql",
                query,
                "```",
                "",
                "[Safe account]{#safe}.",
            ].join("\n");
            tree.add("ordered", { pack: "private", population: { actual, apparent: 900 } }, source);
            tree.add(
                "reader",
                {},
                "[[place-ordered#safe|Safe]] and [[place-ordered#generated|Generated]].",
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
                const [document] = await compile(tree, corpus, "private");
                const page = document.pages.find((page) => page.name === `Generated ${actual}`);
                expect(page._id).toBe(anchorPageId(document._id, "generated"));
                expect(page.text.content).toContain('id="safe"');
                expect(document.pages.some((page) => page.name === "Extra")).toBe(actual === 6800);
                const record = corpus.audiences.public.linkIndex.byShortcode.get("place/ordered");
                const anchors = record.anchorUuids;
                const target = `Compendium.populationproof.private.JournalEntry.${document._id}.JournalEntryPage.${page._id}`;
                expect(anchors.safe).toBe(target);
                expect(anchors.generated).toBe(target);
                for (const slug of ["earlier", "another"]) {
                    const id = anchorPageId(document._id, slug);
                    expect(anchors[slug]).toBe(
                        `Compendium.populationproof.private.JournalEntry.${document._id}.JournalEntryPage.${id}`,
                    );
                    expect(document.pages.some((page) => page._id === id)).toBe(true);
                }
                const lead = document.pages.find((page) => page.name === `Population ${actual}`);
                expect(anchors.$lead).toBe(
                    `Compendium.populationproof.private.JournalEntry.${document._id}.JournalEntryPage.${lead._id}`,
                );
                expect(lead._id).not.toBe(
                    makeId("journal-page", `${document._id}:Population ${actual}`),
                );
                const publicDocs = await compile(tree, corpus, "journals");
                expect(
                    JSON.stringify(publicDocs.find((entry) => entry.name === "reader")),
                ).toContain(target);
                const targets = {
                    safe: anchors.safe,
                    generated: anchors.generated,
                    earlier: anchors.earlier,
                    another: anchors.another,
                    lead: anchors.$lead,
                };
                if (previous) expect(targets).toEqual(previous);
                previous = targets;
                const publication = await session.publication();
                const result = emitContentIndex({ config: tree.config, publication });
                const jsonl = fs.readFileSync(result.file, "utf8");
                const published = jsonl
                    .trim()
                    .split("\n")
                    .map((line) => JSON.parse(line))
                    .find((record) => record.type === "place" && record.shortcode === "ordered");
                expect(published.foundry.note.anchors.safe).toBe(target);
                expect(published.foundry.note.anchors.generated).toBe(target);
                const publicMetadata =
                    jsonl +
                    JSON.stringify([...corpus.audiences.public.linkIndex.byShortcode.values()]);
                expect(publicMetadata).not.toMatch(new RegExp(`\\b${actual}\\b`));
                for (const hidden of [`Generated ${actual}`, query, "sourceIdentity"])
                    expect(publicMetadata).not.toContain(hidden);
                expect({ records: session.records, parsed: [...session.parsed] }).toEqual(before);
                for (const [file, text] of tree.sources)
                    expect(fs.readFileSync(file, "utf8")).toBe(text);
            } finally {
                await session.dispose();
                tree.close();
            }
        }
    },
);

it.each(["session", "standalone"])(
    "keeps public scalar SQL strict for a non-GM private destination in %s mode",
    async (mode) => {
        const tree = input();
        tree.add(
            "privatepublic",
            { pack: "private", population: { actual: 4700, apparent: 900 } },
            "# Population {{sql \"SELECT data.population.actual FROM notes WHERE shortcode = 'privatepublic'\"}}\n\n[Account]{#safe}.",
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
            await expect(preparation).rejects.toThrow("scalar SQL result is empty");
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
    const tree = input(
        [
            ...packs,
            { name: "items", type: "Item", system: "sohl", default: true },
            { name: "privateitems", type: "Item", system: "sohl", private: true },
        ],
        { itemBuilders: ["sohl"], systems: { sohl: { compatibility: { verified: "0.9.0" } } } },
    );
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
        const differentSubject = plan.subjects.find((subject) => subject.name === "different");
        expect(differentSubject.address).toBe("populationproof-note-place-different");
        expect(differentSubject.id).toBe(
            makeId("population-supplement", "populationproof-note-place-different"),
        );
        expect(supplements.find((entry) => entry.name === "different — Population")._id).toBe(
            makeId("population-supplement", "populationproof-note-place-different"),
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
