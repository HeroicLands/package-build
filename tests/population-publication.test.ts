/* SPDX-License-Identifier: GPL-3.0-or-later */

import { expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { noteInfobox, buildInfoboxes, systemRowsSection } from "../engine/infobox.mjs";
import { renderMarkdownExpressions } from "../engine/markdown-expressions.mjs";
import {
    pageFrontmatter,
    renderSitePage,
    sitePageDecorator,
    siteBodyRenderer,
} from "../engine/site-page.mjs";
import {
    serializeContentIndex,
    prepareContentIndex,
    emitContentIndex,
} from "../engine/content-index.mjs";
import { isNoteRecord } from "../engine/index-records.mjs";
import { createNotesDatabaseScope, prepareTreeSqlTables } from "../engine/sql-tables.mjs";
import { createContentSession } from "../engine/content-session.mjs";
import { buildCompileCorpus } from "../engine/compile-corpus.mjs";
import { splitPages, journalPageId, Journals } from "../engine/journals.mjs";
import { anchorPageId } from "../engine/wikilinks.mjs";
import { renderFoundryMarkdown, convertNoteWikilinks } from "../engine/helpers.mjs";
import { buildSiteIndex } from "../engine/site-index.mjs";
import { createPackRouter } from "../engine/pack-router.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import { fixture, note, write } from "./content-session-fixture.js";

const fm = {
    type: "place",
    subType: "region",
    shortcode: "hidden",
    name: { full: "Hidden Vale" },
    data: { population: { actual: 2300, apparent: 800 } },
};
const expression = "Actual: {{data.population.actual}}; apparent: {{data.population.apparent}}";
function record(value = fm) {
    return {
        ...value,
        package: "demo",
        address: {
            canonical: `demo-note-${value.type}-${value.shortcode}`,
            slug: `${value.type}-${value.shortcode}`,
        },
    };
}

it("publishes apparent infobox and expression values without mutating the source", () => {
    const before = structuredClone(fm);
    expect(JSON.stringify(noteInfobox(fm))).toContain("800");
    expect(JSON.stringify(noteInfobox(fm))).not.toContain("2,300");
    const privateBox = JSON.stringify(noteInfobox(fm, { audience: "all" }));
    expect(privateBox).toContain("2,300");
    expect(privateBox).toContain("Apparent Population");
    expect(renderMarkdownExpressions(expression, { fm })).toMatchObject({
        markdown: "Actual: ; apparent: 800",
        findings: [],
    });
    expect(renderMarkdownExpressions(expression, { fm, audience: "all" })).toMatchObject({
        markdown: "Actual: 2300; apparent: 800",
        findings: [],
    });
    expect(fm).toEqual(before);
});

it.each([0, null])(
    "preserves the explicit apparent override %s across public interfaces",
    (apparent) => {
        const subject = { ...fm, data: { population: { actual: 2300, apparent } } };
        const projected = JSON.parse(serializeContentIndex([record(subject as typeof fm)]));
        expect(projected.data.population).toEqual({ actual: null, apparent });
        expect(renderMarkdownExpressions(expression, { fm: subject }).markdown).toBe(
            `Actual: ; apparent: ${apparent === null ? "" : "0"}`,
        );
        const box = JSON.stringify(noteInfobox(subject));
        expect(box).not.toContain("2,300");
        if (apparent === 0) expect(box).toContain('"value":"0"');
    },
);

it("projects private records, inline rows and page decorator input", () => {
    const subject = {
        ...fm,
        tags: ["gm"],
        data: {
            population: { actual: 2300, apparent: null },
            territorial_population: { actual: 47000, apparent: 12000 },
            settlements: [{ settlement: "Farm", population: { actual: 230, apparent: 0 } }],
        },
    };
    const bytes = serializeContentIndex([subject]);
    const published = JSON.parse(bytes);
    expect(published.tags).toEqual(["gm"]);
    expect(published.data.population).toEqual({ actual: null, apparent: null });
    expect(published.data.territorial_population).toEqual({ actual: null, apparent: 12000 });
    expect(published.data.settlements[0].population).toEqual({ actual: null, apparent: 0 });
    expect(bytes).not.toContain("47000");
    let decorated;
    const data = pageFrontmatter(
        { fm: subject, slug: "place-hidden", pkg: "demo" },
        {
            decorate: (_data, page) => {
                decorated = page.fm;
            },
        },
    );
    expect(data.data).toEqual(published.data);
    expect((decorated as typeof subject).data).toEqual(published.data);
    expect(subject.data.territorial_population.actual).toBe(47000);
});

it.each([true, false])(
    "isolates public and GM SQL backing records (private first: %s)",
    async (privateFirst) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "population-sql-"));
        const dependency = path.join(root, "dependency.jsonl");
        fs.writeFileSync(dependency, JSON.stringify(record()));
        const ordinary = record({
            ...fm,
            shortcode: "ordinary",
            data: { population: { actual: 1200 } },
        });
        const records = [record(), ordinary];
        const before = structuredClone(records);
        const scope = createNotesDatabaseScope(records, {
            dependencies: [{ id: "source", file: dependency }],
        });
        try {
            for (const audience of privateFirst ?
                (["all", "public"] as const)
            :   (["public", "all"] as const)) {
                const db = await scope.database(audience);
                for (const relation of ["notes", "entries", "source.notes", "source.entries"]) {
                    const { rows } = await db.query(
                        `SELECT data.population.actual AS actual, data.population.apparent AS apparent FROM ${relation} WHERE shortcode = 'hidden'`,
                    );
                    expect(rows[0].actual === null ? null : String(rows[0].actual)).toBe(
                        audience === "all" ? "2300" : null,
                    );
                    expect(String(rows[0].apparent)).toBe("800");
                }
                const ordinaryRows = await db.query(
                    "SELECT data.population.actual AS actual, data.population.apparent AS apparent, data.population.actual + 1 AS total FROM entries WHERE shortcode = 'ordinary'",
                );
                expect(String(ordinaryRows.rows[0].actual)).toBe("1200");
                expect(String(ordinaryRows.rows[0].apparent)).toBe("1200");
                expect(String(ordinaryRows.rows[0].total)).toBe("1201");
                const backing = await db.query(
                    "SELECT record.data.population.actual AS actual FROM memory.__sql_base.source0",
                );
                expect(
                    backing.rows[0].actual === null ? null : String(backing.rows[0].actual),
                ).toBe(audience === "all" ? "2300" : null);
                if (audience === "public")
                    await expect(
                        db.query("SELECT * FROM __sql_all.main.entries"),
                    ).rejects.toThrow();
            }
            expect(records).toEqual(before);
        } finally {
            scope.dispose();
            await new Promise<void>((resolve) => setImmediate(resolve));
            fs.rmSync(root, { recursive: true, force: true });
        }
    },
);

it("retains null column access when every public population is unknown", async () => {
    const scope = createNotesDatabaseScope([
        { ...record(), data: { population: { actual: 2300, apparent: null } } },
    ]);
    try {
        const db = await scope.database("public");
        expect(
            (
                await db.query(
                    "SELECT data.population.actual AS actual, data.population.apparent AS apparent FROM entries",
                )
            ).rows,
        ).toEqual([{ actual: null, apparent: null }]);
    } finally {
        scope.dispose();
    }
});

it("prepares destination-specific compile bodies while public index metadata keeps counts private", async () => {
    const input = fixture(0);
    const config = configFromData(
        {
            contentPackage: "demo",
            packageKind: "modules",
            skipDirectories: [],
            compatibility: { minimum: "14", verified: "14.367" },
            stats: { lastModifiedBy: "sessionproof0000" },
            packs: [
                { name: "journals", type: "JournalEntry", default: true },
                { name: "private", type: "JournalEntry", private: true },
            ],
        },
        input.configFile,
    );
    const file = path.join(config.paths.content, "hidden.md");
    write(
        file,
        note(
            fm,
            `${expression}\n\n\`\`\`sql\nSELECT data.population.actual AS Actual, data.population.apparent AS Apparent FROM notes WHERE shortcode = 'hidden'\n\`\`\``,
        ),
    );
    const session = await createContentSession({ config });
    try {
        const before = JSON.stringify(session.records);
        const corpus = await session.compileCorpus();
        for (const [audience, secret] of [
            ["public", false],
            ["all", true],
        ] as const) {
            const markdown = corpus.audiences[audience].sqlTables.get(file)[0].markdown;
            expect(markdown.includes("2300") || markdown.includes("2,300")).toBe(secret);
            expect(markdown).toContain("800");
        }
        const authoredBody = session.parsed.get(file).body;
        for (const packName of ["journals", "private"]) {
            const compiler = new Journals({
                contentBase: config.paths.content,
                dest: path.join(input.root, "packs", packName),
                skipDirectories: [],
                packName,
                docType: "JournalEntry",
                router: createPackRouter(config.packs),
                corpus,
            });
            await compiler.prepare();
            compiler.currentNote = { absPath: file, bodyLine: 1 };
            const converted = compiler.convertBody(fm, authoredBody);
            expect(converted.includes("2300")).toBe(packName === "private");
            expect(converted).toContain("800");
            Object.defineProperty(compiler, "stats", { value: {} });
            const document = compiler.buildEntry({ ...fm, id: "populationnote01" }, converted);
            const bytes = JSON.stringify(document);
            expect(bytes.includes("2,300")).toBe(packName === "private");
            expect(bytes.includes("Apparent Population")).toBe(packName === "private");
        }
        const standalone = await buildCompileCorpus({
            config,
            contentBase: config.paths.content,
            skipDirectories: [],
            router: createPackRouter(config.packs),
        });
        expect(standalone.audiences.public.sqlTables.get(file)[0].markdown).toEqual(
            corpus.audiences.public.sqlTables.get(file)[0].markdown,
        );
        const siteIndex = buildSiteIndex([], { config, package: "demo", records: session.records });
        let hookPopulation;
        const site = renderSitePage(
            {
                fm,
                file,
                slug: "place-hidden",
                pkg: "demo",
                body: authoredBody,
                bodyLine: 1,
                name: "Hidden Vale",
            },
            {
                config,
                index: siteIndex,
                foreign: session.foreign,
                sqlTables: corpus.audiences.public.sqlTables,
                decorate: sitePageDecorator(config, siteIndex),
                pass: {
                    beforeLinks: (text, page) => {
                        hookPopulation = page.fm.data.population;
                        return text;
                    },
                },
            },
        );
        expect(hookPopulation).toEqual({ actual: null, apparent: 800 });
        expect(site.expressionErrors).toEqual([]);
        const publishedSite = JSON.stringify(site.data) + siteBodyRenderer(config)(site.markdown);
        expect(publishedSite).toContain("800");
        expect(publishedSite).not.toMatch(/2300|2,300/);
        const publication = await prepareContentIndex({ config, session });
        for (const bodies of [publication.expandedBodies, publication.foundryBodies]) {
            const text = bodies.get(file).markdown;
            expect(text).not.toContain("2300");
            expect(text).not.toContain("2,300");
            expect(text).toContain("800");
        }
        expect(JSON.stringify(session.records)).toBe(before);
    } finally {
        session.dispose();
        fs.rmSync(input.root, { recursive: true, force: true });
    }
});

it.each([
    {
        name: "publishes shared safe anchors without publishing private headings",
        splitTargets: false,
    },
    {
        name: "refuses public anchors with different private generated destinations",
        splitTargets: true,
    },
])("$name", async ({ splitTargets }) => {
    const input = fixture(0);
    const config = configFromData(
        {
            contentPackage: "demo",
            packageKind: "modules",
            skipDirectories: [],
            compatibility: { minimum: "14", verified: "14.367" },
            stats: { lastModifiedBy: "sessionproof0000" },
            packs: [
                { name: "journals", type: "JournalEntry", default: true },
                { name: "private", type: "JournalEntry", private: true },
            ],
        },
        input.configFile,
    );
    const file = path.join(config.paths.content, "hidden.md");
    const privateAnchor = splitTargets ? "hidden-count" : "estimate";
    const query = `SELECT CASE WHEN data.population.actual IS NULL THEN 'Public estimate {#estimate}' ELSE 'Actual 2300 residents {#${privateAnchor}}' END AS "_section", 'An account.' AS Entry FROM notes WHERE shortcode = 'hidden'`;
    const body = `# Introduction {#intro}\n\n\`\`\`sql\n${query}\n\`\`\`\n\nRead [the shared account]{#safe}.`;
    write(file, note({ ...fm, tags: ["gm"], data: { ...fm.data, pack: "private" } }, body));
    const session = await createContentSession({ config });
    try {
        const publication = await prepareContentIndex({ config, session });
        const safe = publication.expandedBodies.get(file).markdown;
        const privateBody = publication.foundryBodies.get(file).markdown;
        expect(safe).toContain("Public estimate");
        expect(safe).not.toContain("2300");
        expect(privateBody).toContain("Actual 2300 residents");
        if (splitTargets) {
            const refusal =
                /hidden\.md:\d+:1: error: public anchor "safe" resolves to different public and private pages/;
            expect(() => emitContentIndex({ config, publication })).toThrow(refusal);
            await expect(session.compileCorpus()).rejects.toThrow(refusal);
            await expect(
                buildCompileCorpus({
                    config,
                    contentBase: config.paths.content,
                    skipDirectories: [],
                    router: createPackRouter(config.packs),
                }),
            ).rejects.toThrow(refusal);
            expect(fs.existsSync(config.paths.contentIndex)).toBe(false);
            expect(fs.readFileSync(file, "utf8")).toBe(
                note({ ...fm, tags: ["gm"], data: { ...fm.data, pack: "private" } }, body),
            );
            return;
        }
        const result = emitContentIndex({ config, publication });
        const bytes = fs.readFileSync(result.file, "utf8");
        const published = bytes
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
            .find((one) => one.type === "place" && one.shortcode === "hidden");
        expect(published.data.population).toEqual({ actual: null, apparent: 800 });
        expect(bytes).not.toContain("Actual 2300 residents");
        expect(bytes).not.toContain("hidden-count");
        const native = published.foundry.note;
        const containing = splitPages(
            privateBody,
            undefined,
            undefined,
            undefined,
            publication.foundryBodies.get(file),
        ).find((page) => renderFoundryMarkdown(page.markdown).includes('id="safe"'));
        expect(containing).toBeTruthy();
        const expected = journalPageId(native.uuid.split(".").at(-1), containing);
        const publicContaining = splitPages(safe).find((page) =>
            renderFoundryMarkdown(page.markdown).includes('id="safe"'),
        );
        expect(expected).toBe(anchorPageId(native.uuid.split(".").at(-1), "estimate"));
        expect(expected).toBe(journalPageId(native.uuid.split(".").at(-1), publicContaining));
        expect(native.anchors.safe).toBe(`${native.uuid}.JournalEntryPage.${expected}`);
        expect(native.anchors.estimate).toBe(`${native.uuid}.JournalEntryPage.${expected}`);
        const corpus = await session.compileCorpus();
        const linkIndex = corpus.audiences.public.linkIndex;
        const converted = convertNoteWikilinks("[[demo-note-place-hidden#safe|Account]]", {
            index: linkIndex,
            config,
            type: "doc",
            id: "publicreader0001",
            name: "Reader",
        });
        expect(converted.markdown).toContain(`${native.uuid}.JournalEntryPage.${expected}`);
        expect(JSON.stringify([...linkIndex.byShortcode.values()])).not.toContain(
            "Actual 2300 residents",
        );
    } finally {
        session.dispose();
        fs.rmSync(input.root, { recursive: true, force: true });
    }
});

it("derives public and private settlement rows from the same complete validation input", async () => {
    const input = fixture(0);
    const file = path.join(input.config.paths.content, "crown.md");
    write(
        file,
        note({
            type: "affiliation",
            subType: "polity",
            shortcode: "crown",
            name: { full: "Crown" },
            data: {
                territorial_population: { actual: 470, apparent: null },
                settlements: [
                    {
                        settlement: "East Farm",
                        polity: "affiliation-crown",
                        type: "homestead",
                        population: { actual: 230, apparent: 0 },
                        market: "subsistence",
                        notes: "A farm.",
                    },
                ],
            },
        }),
    );
    const session = await createContentSession({ config: input.config });
    try {
        const publicTables = await prepareTreeSqlTables(input.config.paths.content, {
            config: input.config,
            records: session.records,
            parsed: session.parsed,
            audience: "public",
        });
        const privateTables = await session.sqlTables("all");
        const publicText = JSON.stringify(publicTables.get(file).declared);
        const privateText = JSON.stringify(privateTables.get(file).declared);
        expect(publicText).toContain("East Farm");
        expect(publicText).not.toContain("230");
        expect(privateText).toContain("230");
        expect(
            session.records.find((entry) => isNoteRecord(entry) && entry.shortcode === "crown").data
                .territorial_population.actual,
        ).toBe(470);
    } finally {
        session.dispose();
        fs.rmSync(input.root, { recursive: true, force: true });
    }
});

it("rejects malformed membership maps at raw compile and index boundaries before projection", async () => {
    const input = fixture(0);
    const file = path.join(input.config.paths.content, "guild.md");
    write(
        file,
        note({
            type: "affiliation",
            subType: "guild",
            shortcode: "guild",
            name: { full: "Guild" },
            data: { population: { actual: 230, apparent: 0, hidden: 12 } },
        }),
    );
    const session = await createContentSession({ config: input.config });
    try {
        await expect(session.compileCorpus()).rejects.toMatchObject({ located: true });
        await expect(prepareContentIndex({ config: input.config, session })).rejects.toMatchObject({
            located: true,
        });
        await expect(
            buildCompileCorpus({
                config: input.config,
                contentBase: input.config.paths.content,
                skipDirectories: [],
                router: createPackRouter(input.config.packs),
            }),
        ).rejects.toMatchObject({ located: true });
        expect(() => emitContentIndex({ config: input.config })).toThrow(/population/);
        expect(
            session.records.find((entry) => isNoteRecord(entry) && entry.shortcode === "guild").data
                .population.hidden,
        ).toBe(12);
    } finally {
        session.dispose();
        fs.rmSync(input.root, { recursive: true, force: true });
    }
});

it("projects frontmatter before customizable public infobox fields and callbacks", () => {
    const before = structuredClone(fm);
    const vocabulary = { place: { data: [{ name: "population.actual", kind: "number" }] } };
    expect(JSON.stringify(noteInfobox(fm, { vocabulary }))).not.toContain("2,300");
    expect(JSON.stringify(noteInfobox(fm, { vocabulary, audience: "all" }))).toContain("2,300");
    for (const audience of ["public", "all"] as const) {
        const seen = [];
        const boxes = buildInfoboxes(fm, {
            audience,
            vocabulary,
            maps: [{ system: "example", block: "data", types: { place: {} } }],
            compilesDocument: (value) => {
                seen.push(value.data.population.actual);
                return true;
            },
            providers: [
                {
                    system: "example",
                    sections: {
                        place: (value) => {
                            seen.push(value.data.population.actual);
                            return [
                                {
                                    layout: "rows",
                                    rows: [
                                        {
                                            label: "Observed",
                                            kind: "text",
                                            value: String(value.data.population.actual),
                                        },
                                    ],
                                },
                            ];
                        },
                    },
                },
            ],
        });
        const directSeen = [];
        systemRowsSection(fm, [{ name: "observed", kind: "number" }], {
            block: "data",
            audience,
            resolveField: (_field, value) => {
                directSeen.push(value.data.population.actual);
                return { value: value.data.population.actual, from: "system" };
            },
        });
        expect(directSeen).toEqual(audience === "public" ? [null] : [2300]);
        expect(seen).toEqual(audience === "public" ? [null, null] : [2300, 2300]);
        expect(JSON.stringify(boxes).includes("2300")).toBe(audience === "all");
    }
    expect(fm).toEqual(before);
});
