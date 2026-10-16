/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A note's event views are generated sections appended to its body**, each a
 * `sql` fence over `events` under a heading with a fixed anchor. A view with no
 * rows is not generated, and a note whose own body declares the view's anchor
 * keeps its own section and gets no generated one.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectContentIndex } from "../engine/content-index.mjs";
import { expandContentTables } from "../engine/content-tables.mjs";
import { EVENT_VIEWS, selfForms } from "../engine/event-views.mjs";
import { parseMarkdownFile } from "../engine/helpers.mjs";
import { findSqlBlocks, openNotesDatabase, prepareTreeSqlTables } from "../engine/sql-tables.mjs";

const PACKAGE = "demo";

/** The notes of the fixture, by file. */
const NOTES: Record<string, { fm: object; body?: string }> = {
    "North.md": { fm: { type: "place", subType: "region", shortcode: "north" } },
    "South.md": { fm: { type: "place", subType: "region", shortcode: "south" } },
    "Rha.md": {
        fm: { type: "place", subType: "region", shortcode: "rha", data: { parents: ["north"] } },
    },
    "Rhb.md": {
        fm: { type: "place", subType: "region", shortcode: "rhb", data: { parents: ["south"] } },
    },
    "Ta.md": {
        fm: { type: "place", subType: "settlement", shortcode: "ta", data: { parents: ["rha"] } },
    },
    "Tb.md": {
        fm: { type: "place", subType: "settlement", shortcode: "tb", data: { parents: ["rhb"] } },
    },
    "Quiet.md": {
        fm: { type: "place", subType: "region", shortcode: "quiet", data: { parents: ["north"] } },
    },
    "Own.md": {
        fm: {
            type: "place",
            subType: "region",
            shortcode: "own",
            data: {
                events: [{ when: 300, summary: "Own is walled.", where: { locus: ["own"] } }],
            },
        },
        body: "Own's prose.\n\n# Chronology {#chronology}\n\nThe walls rise in 300.\n",
    },
    "Plague.md": {
        fm: {
            type: "lore",
            subType: "history",
            shortcode: "plague",
            data: {
                events: [
                    {
                        when: 200,
                        kind: "plague",
                        summary: "A plague crosses the sea.",
                        where: {
                            reach: [
                                { place: "ta", how: "the wells fail", knowledge: "named" },
                                { place: "tb", how: "the grain rots", knowledge: "unlinked" },
                            ],
                        },
                        who: [{ ref: "being-aran", role: "witness" }],
                        accounts: [
                            {
                                by: "affiliation-crown",
                                says: "A judgement on the south.",
                                agrees: "partly",
                            },
                        ],
                    },
                ],
            },
        },
    },
    "Sundering.md": {
        fm: {
            type: "lore",
            subType: "history",
            shortcode: "sundering",
            data: {
                events: [{ when: 10, depth: "world", summary: "The world is sundered." }],
            },
        },
    },
    "Famine.md": {
        fm: {
            type: "lore",
            subType: "history",
            shortcode: "famine",
            data: {
                events: [
                    {
                        when: 210,
                        summary: "Famine follows the plague.",
                        follows: [{ event: "lore-plague", how: "caused" }],
                    },
                ],
            },
        },
    },
    "Aran.md": { fm: { type: "being", subType: "npc", shortcode: "aran" } },
    "Bryn.md": { fm: { type: "being", subType: "npc", shortcode: "bryn" } },
    "Crown.md": { fm: { type: "affiliation", subType: "polity", shortcode: "crown" } },
};

let dir: string;
let prepared: any;
const stubComparisons: string[] = [];

/** A note's authored body, as the builds read it. */
const bodyOf = (file: string) => parseMarkdownFile(path.join(dir, file)).body;

/** A note's body after its tables are expanded, as every surface receives it. */
function expanded(file: string): string {
    const absPath = path.join(dir, file);
    const { markdown, errors } = expandContentTables(bodyOf(file), {
        source: file,
        sqlTables: prepared?.get(absPath),
    });
    expect(errors, file).toEqual([]);
    return markdown;
}

/** The headings of the sections generated for a note. */
const generated = (file: string) =>
    String(prepared?.get(path.join(dir, file))?.generated ?? "")
        .split("\n")
        .filter((line) => line.startsWith("# "));

beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "event-views-"));
    for (const [file, { fm, body }] of Object.entries(NOTES)) {
        const name = { full: (fm as any).shortcode };
        fs.writeFileSync(
            path.join(dir, file),
            `---\n${YAML.stringify({ name, ...fm })}---\n\n${body ?? `Prose about ${(fm as any).shortcode}.\n`}`,
        );
    }
    const records = collectContentIndex(dir, { contentPackage: PACKAGE, skipDirectories: [] });
    const db = await openNotesDatabase(records);
    try {
        prepared = await prepareTreeSqlTables(dir, {
            records,
            config: { contentPackage: PACKAGE } as any,
            database: {
                ...db,
                stubsExcluded: async (sql: string) => {
                    stubComparisons.push(sql);
                    return 0;
                },
            },
        });
    } finally {
        await db.close();
    }
}, 60_000);

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("the views", () => {
    it("answers every generated view without a stub-inclusion comparison", () => {
        const sections = [...prepared.values()]
            .map((tables: any) => tables.generated ?? "")
            .join("\n");
        for (const view of EVENT_VIEWS) expect(sections).toContain(`{#${view.slug}}`);
        for (const block of findSqlBlocks(sections)) {
            expect(block.query).not.toMatch(/\b(?:FROM|JOIN)\s+"?notes"?\b/i);
        }
        expect(stubComparisons).toEqual([]);
    });
    it("are four sections, each with its own anchor, in a fixed order", () => {
        expect(EVENT_VIEWS.map((view: any) => view.slug)).toEqual([
            "chronology",
            "events",
            "accounts",
            "followed",
        ]);
    });
});

describe("a region's chronology", () => {
    it("lists an event felt in places under two continents in each region's chronology", () => {
        const rha = expanded("Rha.md");
        const rhb = expanded("Rhb.md");
        expect(rha).toContain("# Chronology {#chronology}");
        expect(rha).toContain("A plague crosses the sea.");
        expect(rha).toContain("the wells fail");
        expect(rha).not.toContain("the grain rots");
        expect(rhb).toContain("A plague crosses the sea.");
        expect(rhb).toContain("the grain rots");
        expect(rhb).not.toContain("the wells fail");
        for (const continent of ["North.md", "South.md"])
            expect(expanded(continent), continent).toContain("A plague crosses the sea.");
    });

    it("sets a world event beside the region's own as context, in date order", () => {
        const rha = expanded("Rha.md");
        expect(rha).toContain("The world is sundered.");
        expect(rha.indexOf("The world is sundered.")).toBeLessThan(
            rha.indexOf("A plague crosses the sea."),
        );
    });

    it("is generated after everything the author wrote, as an SQL fence", () => {
        const views = String(prepared.get(path.join(dir, "Rha.md")).generated);
        expect(views).toMatch(/^# Chronology \{#chronology\}\n\n```sql\n/m);
        expect(views).toContain("FROM events");
        expect(views).toContain("WITH RECURSIVE");
        const rha = expanded("Rha.md");
        expect(rha.indexOf("Prose about rha.")).toBeLessThan(rha.indexOf("# Chronology"));
    });
});

describe("the batched existence check", () => {
    it.each(EVENT_VIEWS.filter((view: any) => view.owners).map((view: any) => view.slug))(
        "names the same notes as counting each note's %s rows one at a time",
        async (slug) => {
            const records = collectContentIndex(dir, {
                contentPackage: PACKAGE,
                skipDirectories: [],
            });
            const db = await openNotesDatabase(records, { audience: "public" });
            try {
                const view: any = EVENT_VIEWS.find((one: any) => one.slug === slug);
                const shape = {
                    parents: true,
                    locus: true,
                    reach: true,
                    who: true,
                    accounts: true,
                    follows: true,
                    depth: true,
                } as any;
                const selves = records
                    .filter((record: any) => !record.documents && view.applies(record))
                    .map((record: any) => selfForms(record));
                const batched: Set<string> = await view.owners(db, selves, shape);
                const counted = new Set<string>();
                for (const self of selves) {
                    const query = view.query(self, shape);
                    const { rows } = await db.query(
                        `SELECT count(*) AS n FROM (${query.own ?? query.fence})`,
                    );
                    if (Number(rows[0].n) > 0) counted.add(self[0]);
                }
                expect(counted.size).toBeGreaterThan(0);
                expect(counted.size).toBeLessThan(selves.length);
                expect([...batched].sort()).toEqual([...counted].sort());
            } finally {
                await db.close();
            }
        },
    );
});

describe("a shared database and parse", () => {
    it("give the same results as a preparation that opens and parses its own, and leave the database open", async () => {
        const parsed = new Map();
        const records = collectContentIndex(dir, {
            contentPackage: PACKAGE,
            skipDirectories: [],
            parsed,
        });
        expect(parsed.size).toBe(Object.keys(NOTES).length);
        const db = await openNotesDatabase(records, { audience: "public" });
        try {
            const options = { records, config: { contentPackage: PACKAGE } as any };
            const own: any = await prepareTreeSqlTables(dir, options);
            const shared: any = await prepareTreeSqlTables(dir, {
                ...options,
                parsed,
                database: db,
            });
            expect([...shared.keys()].sort()).toEqual([...own.keys()].sort());
            for (const [file, results] of own) {
                expect(JSON.stringify(shared.get(file)), file).toBe(JSON.stringify(results));
                expect(shared.get(file).generated, file).toBe(results.generated);
            }
            const { rows } = await db.query("SELECT count(*) AS n FROM notes");
            expect(Number(rows[0].n)).toBeGreaterThan(0);
        } finally {
            await db.close();
        }
    });
});

describe("an author's own section", () => {
    it("replaces the generated one, and stands byte for byte", () => {
        expect(generated("Own.md")).toEqual([]);
        expect(expanded("Own.md")).toBe(bodyOf("Own.md"));
    });
});

describe("a view with no rows", () => {
    it("is not generated", () => {
        expect(generated("Quiet.md")).toEqual([]);
        expect(generated("Bryn.md")).toEqual([]);
        expect(generated("Sundering.md")).toEqual([]);
        expect(expanded("Quiet.md")).toBe(bodyOf("Quiet.md"));
    });
});

describe("the other views", () => {
    it("lists the events a being took part in, with its role", () => {
        expect(generated("Aran.md")).toEqual(["# Events {#events}"]);
        const aran = expanded("Aran.md");
        expect(aran).toContain("A plague crosses the sea.");
        expect(aran).toContain("witness");
    });

    it("lists the accounts an affiliation gives", () => {
        expect(generated("Crown.md")).toEqual(["# Accounts {#accounts}"]);
        expect(expanded("Crown.md")).toContain("A judgement on the south.");
    });

    it("lists what followed a note's events", () => {
        expect(generated("Plague.md")).toEqual(["# What followed {#followed}"]);
        const plague = expanded("Plague.md");
        expect(plague).toContain("Famine follows the plague.");
        expect(plague).toContain("caused");
    });
});
