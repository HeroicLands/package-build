/*
 * Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { buildLinkIndex, auditLinks } from "../engine/content-links.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { indexRecordsFor, serializeContentIndex } from "../engine/content-index.mjs";
import { openNotesDatabase, runSqlQuery, prepareTreeSqlTables } from "../engine/sql-tables.mjs";
import { expandContentTables } from "../engine/content-tables.mjs";
import { decodeIndexAddresses } from "../engine/note-addresses.mjs";
import { renderAddress, readCanonicalKey } from "../engine/address.mjs";
import { createRenderer } from "../engine/content-render.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";
import { derivedSections } from "../engine/derived-sections.mjs";
import { HOLDING_MODELS, SETTLEMENT_TABLE_RULES } from "../engine/settlement-tables.mjs";

const tail = "Some four hundred further villages lie in the vale, none of them named here.";
const rows = () => [
    {
        place: "ashford",
        market: 4,
        population: 3400,
        heldBy: "affiliation-crown",
        for: "the ford on the drove road",
    },
    {
        name: "Weyshott",
        market: 2,
        population: 420,
        heldBy: "being-aldwyn",
        for: "the manor's mill",
    },
    {
        name: "Cold Hatch",
        market: 1,
        population: 60,
        holder: "Sir Aldwyn of Brynwold",
        for: "the sheepwalk",
    },
];
const note = (fm: object, body = "The vale is farmed from end to end.") =>
    `---\n${YAML.stringify(fm)}---\n\n${body}\n`;
function region(change: (fm: any) => void = () => {}, body?: string) {
    const fm = {
        type: "place",
        subType: "region",
        shortcode: "vale",
        name: { full: "The Vale" },
        tags: ["region", "held"],
        data: { population: 100000, government: "crown", settlements: { rows: rows(), tail } },
    };
    change(fm);
    return note(fm, body);
}
function tree(regionText = region(), extras: Record<string, string> = {}) {
    return {
        "Vale.md": regionText,
        "Ashford.md": note(
            {
                type: "place",
                subType: "settlement",
                shortcode: "ashford",
                name: { full: "Ashford", aliases: ["Old Ford"] },
                data: { parents: ["vale"], population: 3400, market: 4, government: "crown" },
            },
            "Ashford stands at the ford.",
        ),
        "Crown.md": note(
            {
                type: "affiliation",
                subType: "polity",
                shortcode: "crown",
                name: { full: "The Crown" },
            },
            "The Crown governs the vale.",
        ),
        "Aldwyn.md": note(
            {
                type: "being",
                subType: "npc",
                shortcode: "aldwyn",
                name: { full: "Sir Aldwyn of Brynwold" },
            },
            "A knight of the vale.",
        ),
        ...extras,
    };
}
function fixture(files: Record<string, string>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-settlements-"));
    for (const [file, raw] of Object.entries(files)) fs.writeFileSync(path.join(root, file), raw);
    const index = buildLinkIndex(root, { skipDirectories: [] });
    const { findings } = lintFrontmatter(index, {
        schemas: ENGINE_NOTE_SCHEMAS as never,
        vocabulary: NOTE_VOCABULARY,
    });
    const names = SETTLEMENT_TABLE_RULES.map((r) => r.name);
    return {
        root,
        index,
        all: findings,
        findings: findings.filter((f) => names.some((n) => f.message.startsWith(n + ":"))),
        dispose: () => fs.rmSync(root, { recursive: true, force: true }),
    };
}
function checked(files: Record<string, string>, run: (f: ReturnType<typeof fixture>) => void) {
    const f = fixture(files);
    try {
        run(f);
    } finally {
        f.dispose();
    }
}
const cases: Record<string, { change: (fm: any) => void; says: string; at: string }> = {
    "no holding model": { change: (fm) => (fm.tags = ["region"]), says: "held", at: "tags:" },
    "market class": {
        change: (fm) => (fm.data.settlements.rows[1].market = 7),
        says: "7",
        at: "market: 7",
    },
    "people figure": {
        change: (fm) => (fm.data.settlements.rows[1].population = 0),
        says: "positive",
        at: "population: 0",
    },
    "no holder": {
        change: (fm) => delete fm.data.settlements.rows[2].holder,
        says: "Cold Hatch",
        at: "name: Cold Hatch",
    },
    "not a holder": {
        change: (fm) => (fm.data.settlements.rows[1].heldBy = "place-ashford"),
        says: "place",
        at: "heldBy: place-ashford",
    },
    "holder out of model": {
        change: (fm) => (fm.tags = ["endowed"]),
        says: "endowed",
        at: "heldBy: being-aldwyn",
    },
    "not a settlement": {
        change: (fm) =>
            (fm.data.settlements.rows[2] = {
                ...fm.data.settlements.rows[2],
                name: undefined,
                place: "affiliation-crown",
            }),
        says: "affiliation",
        at: "place: affiliation-crown",
    },
    "figure disagrees": {
        change: (fm) => (fm.data.settlements.rows[0].population = 3000),
        says: "3,400",
        at: "population: 3000",
    },
    "market disagrees": {
        change: (fm) => (fm.data.settlements.rows[0].market = 3),
        says: "4 market town",
        at: "market: 3",
    },
    "unlinked settlement": {
        change: (fm) => {
            delete fm.data.settlements.rows[0].place;
            fm.data.settlements.rows[0].name = "Old Ford";
        },
        says: "ashford",
        at: "name: Old Ford",
    },
    "missing row": {
        change: (fm) => fm.data.settlements.rows.shift(),
        says: "Ashford",
        at: "rows:",
    },
    "duplicate settlement": {
        change: (fm) => fm.data.settlements.rows.push({ ...fm.data.settlements.rows[1] }),
        says: "Weyshott",
        at: "name: Weyshott",
    },
    "no tail": {
        change: (fm) => delete fm.data.settlements.tail,
        says: "tail",
        at: "settlements:",
    },
};

describe("indexed settlement rows", () => {
    it("accepts the declared rows and their native Address links", () =>
        checked(tree(), (f) => {
            expect(f.findings).toEqual([]);
            expect(f.all.filter((x) => x.message.includes("settlements"))).toEqual([]);
            expect(auditLinks(f.index).deadAddresses).toEqual([]);
        }));
    for (const [rule, c] of Object.entries(cases))
        it(`${rule} is located in the authored YAML`, () => {
            const raw = region(c.change);
            checked(tree(raw), (f) => {
                const hits = f.findings.filter((x) => x.message.startsWith(rule + ":"));
                expect(hits).toHaveLength(1);
                expect(hits[0].message).toContain(c.says);
                expect(hits[0].severity).toBe("error");
                const lines = raw.split("\n");
                const expected =
                    rule === "duplicate settlement" ?
                        lines.findLastIndex((l) => l.includes(c.at))
                    :   lines.findIndex((l) => l.includes(c.at));
                expect(hits[0].line).toBe(expected + 1);
            });
        });
    it("uses indexed facts without mining a contradictory body table", () => {
        const body =
            "## Settlements\n\n| Name | Market | People | Held by |\n| --- | --- | --- | --- |\n| Ashford | 1 hamlet | 9 | Nobody |";
        const raw = region(() => {}, body);
        checked(tree(raw), (f) => {
            expect(f.findings).toHaveLength(1);
            expect(f.findings[0].message).toMatch(/body settlements table:.*data.settlements/);
            expect(f.findings[0].line).toBe(
                raw.split("\n").findIndex((l) => l.startsWith("| Name")) + 1,
            );
        });
    });
    it("refuses a legacy body table without declaring rows or checking its figures", () => {
        const raw = region(
            (fm) => delete fm.data.settlements,
            "## Settlements\n\n| Name | Market | People | Held by |\n| --- | --- | --- | --- |\n| Ashford | wrong | wrong | Nobody |\n",
        );
        checked(tree(raw), (f) => {
            expect(f.findings).toHaveLength(1);
            expect(f.findings[0].message).toContain("body settlements table:");
        });
    });
    it("does not treat arbitrary body tables or fenced examples as settlement declarations", () =>
        checked(
            tree(
                region(
                    (fm) => delete fm.data.settlements,
                    "## Trade\n\n| Name | People |\n| --- | --- |\n| Wool | 4 |\n\n```markdown\n## Settlements\n| Name | People |\n| --- | --- |\n```",
                ),
            ),
            (f) => expect(f.findings).toEqual([]),
        ));
    it("keeps holder and government distinct", () =>
        checked(tree(region((fm) => delete fm.data.settlements.rows[0].heldBy)), (f) =>
            expect(f.findings.some((x) => x.message.startsWith("no holder:"))).toBe(true),
        ));
    it.each(HOLDING_MODELS.filter((m) => !m.person).map((m) => m.tag))(
        "accepts an affiliation holder in %s",
        (tag) =>
            checked(
                tree(
                    region((fm) => {
                        fm.tags = [tag];
                        fm.data.settlements.rows.forEach((r: any) => {
                            delete r.holder;
                            r.heldBy = "affiliation-crown";
                        });
                    }),
                ),
                (f) => expect(f.findings).toEqual([]),
            ),
    );
    it("accepts held alongside another holding model", () =>
        checked(tree(region((fm) => (fm.tags = ["held", "endowed"]))), (f) =>
            expect(f.findings).toEqual([]),
        ));
    it("leaves unresolved links as errors in the native Address check", () =>
        checked(
            tree(region((fm) => (fm.data.settlements.rows[0].heldBy = "affiliation-nobody"))),
            (f) => expect(f.all.some((x) => x.message.includes("nobody"))).toBe(true),
        ));
    it("keeps nested Address identity through published JSON and SQL", () =>
        checked(tree(), (f) => {
            const records = indexRecordsFor({ contentBase: f.root, skipDirectories: [] });
            const record = JSON.parse(
                serializeContentIndex(records)
                    .trim()
                    .split("\n")
                    .find((s) => JSON.parse(s).shortcode === "vale")!,
            );
            expect(record.data.settlements.rows[0].place.address).toMatch(/-place-ashford$/);
            expect(record.data.settlements.rows[1].heldBy.address).toMatch(/-being-aldwyn$/);
        }));
    it("renders exactly once even when the author owns a settlements anchor", () =>
        checked(
            tree(
                region(
                    () => {},
                    "# Settlements {#settlements}\n\nThe villages stand along the water.",
                ),
            ),
            (f) => {
                const records = indexRecordsFor({ contentBase: f.root, skipDirectories: [] });
                const sections = derivedSections(records, {
                    fileOf: (r) => path.join(f.root, r.file.path),
                });
                const rendered =
                    sections.get(path.join(f.root, "Vale.md"))?.get("settlements") ?? "";
                expect(rendered.match(/\| Name \| Market \| People \| Held by/g)).toHaveLength(1);
                expect(rendered).toContain("Weyshott");
                expect(rendered).toContain(tail);
            },
        ));
});

describe("settlement publication bridges", () => {
    it("round-trips nested Addresses into a dependency and SQL without losing identity", async () => {
        const f = fixture(tree());
        let db;
        try {
            const records = indexRecordsFor({ contentBase: f.root, skipDirectories: [] });
            const published = serializeContentIndex(records)
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line));
            const reopened = published.map((record) =>
                decodeIndexAddresses(record, { package: record.package }),
            );
            const region = reopened.find((record) => record.shortcode === "vale");
            expect(renderAddress(region.data.settlements.rows[0].place)).toMatch(/-place-ashford$/);
            expect(renderAddress(region.data.settlements.rows[1].heldBy)).toMatch(/-being-aldwyn$/);
            db = await openNotesDatabase(records);
            const result = await runSqlQuery(
                db,
                "SELECT data.settlements.rows[1].place AS place, data.settlements.rows[1].population AS population FROM notes WHERE shortcode = 'vale'",
            );
            expect(result.rows).toEqual([{ place: "sohl-note-place-ashford", population: 3400n }]);
        } finally {
            db?.close();
            f.dispose();
        }
    });
    it("shares one generated table across HTML, Foundry and Typst, with optional For", async () => {
        const f = fixture(
            tree(
                region(
                    (fm) => fm.data.settlements.rows.forEach((r: any) => delete r.for),
                    "# Settlements {#settlements}\n\nThe villages stand by the water.",
                ),
            ),
        );
        try {
            const records = indexRecordsFor({ contentBase: f.root, skipDirectories: [] });
            const prepared = await prepareTreeSqlTables(f.root, { records, skipDirectories: [] });
            const raw = fs.readFileSync(path.join(f.root, "Vale.md"), "utf8");
            const body = raw.slice(raw.indexOf("---", 4) + 3);
            const expanded = expandContentTables(body, {
                source: path.join(f.root, "Vale.md"),
                sqlTables: prepared?.get(path.join(f.root, "Vale.md")),
            });
            expect(
                expanded.markdown.match(/^#+ Settlements(?: \{#settlements\})?$/gm),
            ).toHaveLength(1);
            expect(
                expanded.markdown.match(/\| Name \| Market \| People \| Held by \|/g),
            ).toHaveLength(1);
            expect(expanded.markdown).not.toContain("| For |");
            for (const target of ["web", "foundry"] as const) {
                const html = createRenderer(target).render(expanded.markdown);
                expect(html.match(/<table>/g)).toHaveLength(1);
                expect(html).toContain("3,400");
                expect(html).toContain("4 market town");
                expect(html).toContain("Weyshott");
            }
            const typst = markdownToTypst(expanded.markdown);
            expect(typst.match(/#table\(/g)).toHaveLength(1);
            expect(typst).toContain("3,400");
            expect(typst).toContain("Weyshott");
        } finally {
            f.dispose();
        }
    });
    for (const [title, raw, needle] of [
        [
            "wrong linked population",
            region((fm) => (fm.data.settlements.rows[0].population = 3000)),
            "figure disagrees",
        ],
        ["missing row", region((fm) => fm.data.settlements.rows.shift()), "missing row"],
        [
            "legacy table",
            region(
                (fm) => delete fm.data.settlements,
                "## Settlements\n\nName | People\n--- | ---\nAshford | 9",
            ),
            "body settlements table",
        ],
    ])
        it(`refuses ${title} before any publication writes`, async () => {
            const f = fixture(tree(raw));
            try {
                const records = indexRecordsFor({ contentBase: f.root, skipDirectories: [] });
                await expect(
                    prepareTreeSqlTables(f.root, { records, skipDirectories: [] }),
                ).rejects.toMatchObject({
                    located: true,
                    message: expect.stringMatching(new RegExp("Vale\\.md:[0-9]+.*" + needle)),
                });
            } finally {
                f.dispose();
            }
        });
});

describe("closed settlement declarations", () => {
    for (const [title, change] of [
        ["both settlement identities", (fm: any) => (fm.data.settlements.rows[0].name = "Ashford")],
        ["both holder identities", (fm: any) => (fm.data.settlements.rows[0].holder = "The Crown")],
        ["unknown row key", (fm: any) => (fm.data.settlements.rows[0].unread = "discarded")],
        ["unknown declaration key", (fm: any) => (fm.data.settlements.unread = "discarded")],
        ["non-region declaration", (fm: any) => (fm.subType = "settlement")],
        ["non-list rows", (fm: any) => (fm.data.settlements.rows = {})],
        ["nontext For", (fm: any) => (fm.data.settlements.rows[0].for = 42)],
    ] as const)
        it(`refuses ${title}`, () =>
            checked(tree(region(change)), (f) =>
                expect(
                    f.findings.some((x) => x.message.startsWith("settlements shape:") && x.line),
                ).toBe(true),
            ));
    it("keeps the source-map position of prose after inserted rows", async () => {
        const f = fixture(
            tree(
                region(
                    () => {},
                    "## Settlements\n\nThe villages stand along the water.\n\n## Economy\n\nWool and grain.",
                ),
            ),
        );
        try {
            const records = indexRecordsFor({ contentBase: f.root, skipDirectories: [] });
            const prepared = await prepareTreeSqlTables(f.root, { records, skipDirectories: [] });
            const raw = fs.readFileSync(path.join(f.root, "Vale.md"), "utf8");
            const body = raw.slice(raw.indexOf("---", 4) + 3);
            const expanded = expandContentTables(body, {
                source: path.join(f.root, "Vale.md"),
                sqlTables: prepared?.get(path.join(f.root, "Vale.md")),
            });
            const at = expanded.markdown.split("\n").findIndex((l) => l === "Wool and grain.");
            expect(expanded.lineMap[at]).toEqual({
                line: body.split("\n").findIndex((l) => l === "Wool and grain."),
                generated: false,
            });
            expect(expanded.markdown.match(/^#+ Settlements \{#settlements\}$/gm)).toHaveLength(1);
            const html = createRenderer("foundry").render(expanded.markdown);
            const first = html.match(/<tbody>\s*<tr>([\s\S]*?)<\/tr>/)?.[1] ?? "";
            expect([...first.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1])[1]).toBe(
                "4 market town",
            );
            expect(prepared?.get(path.join(f.root, "Vale.md"))?.anchors).toEqual(
                expect.arrayContaining([expect.objectContaining({ slug: "settlements" })]),
            );
        } finally {
            f.dispose();
        }
    });
    it("rejects duplicate authored settlement anchors instead of omitting the declaration", () =>
        checked(
            tree(
                region(
                    () => {},
                    "# Settlements {#settlements}\n\nProse.\n\n# Settlements {#settlements}\n\nMore prose.",
                ),
            ),
            (f) =>
                expect(f.findings.some((x) => x.message.startsWith("settlements shape:"))).toBe(
                    true,
                ),
        ));
});

describe("reviewed settlement boundaries", () => {
    it("refuses an attributed legacy heading at the actual table line", () => {
        const raw = region(
            (fm) => delete fm.data.settlements,
            "## Settlements {#settlements}\n\nName | People\n--- | ---\nAshford | 9",
        );
        checked(tree(raw), (f) => {
            expect(f.findings).toHaveLength(1);
            expect(f.findings[0]).toMatchObject({
                line: raw.split("\n").findIndex((l) => l === "Name | People") + 1,
                message: expect.stringContaining("body settlements table:"),
            });
        });
    });
    it("retains authored heading classes and values beside the canonical anchor", async () => {
        const { insertDeclaredSections } = await import("../engine/declared-sections.mjs");
        const { scanHeadingAttributes } = await import("../engine/heading-attributes.mjs");
        const output = insertDeclaredSections(
            '## Settlements {.wide title="The villages"}\n\nProse.',
            [{ slug: "settlements", heading: "Settlements", markdown: "Rows." }],
        );
        expect(scanHeadingAttributes(output.markdown).headings[0]).toMatchObject({
            text: "Settlements",
            id: "settlements",
            classes: ["wide"],
            values: { title: "The villages" },
        });
    });
    it.each(["ashford", "place-ashford", "sohl-note-place-ashford"])(
        "keeps equivalent local identity %s",
        async (form) => {
            const { checkSettlementTables } = await import("../engine/settlement-tables.mjs");
            checked(tree(region((fm) => (fm.data.settlements.rows = []))), (f) => {
                const town = f.index.notes.find((n) => n.fm.shortcode === "ashford")!;
                const parent = form.replace("ashford", "vale");
                town.fm.data.parents = [parent];
                const regionNote = f.index.notes.find((n) => n.fm.shortcode === "vale")!;
                expect(
                    checkSettlementTables(regionNote, { index: f.index }).some((x) =>
                        x.message.startsWith("missing row:"),
                    ),
                ).toBe(true);
                town.fm.data.parents = [readCanonicalKey("sohl-note-place-vale")];
                expect(
                    checkSettlementTables(regionNote, { index: f.index }).some((x) =>
                        x.message.startsWith("missing row:"),
                    ),
                ).toBe(true);
                town.fm.data.parents = [readCanonicalKey("other-note-place-vale")];
                expect(checkSettlementTables(regionNote, { index: f.index })).toEqual([]);
            });
        },
    );
    it("checks population and market on raw dependency records", async () => {
        const { checkSettlementTables } = await import("../engine/settlement-tables.mjs");
        const regionNote = {
            file: "Vale.md",
            raw: region((fm) => {
                fm.data.settlements.rows = [
                    {
                        place: "other-note-place-town",
                        population: 1,
                        market: 1,
                        holder: "The Crown",
                    },
                ];
            }),
            fm: {
                package: "sohl",
                type: "place",
                subType: "region",
                shortcode: "vale",
                tags: ["held"],
                data: {
                    settlements: {
                        rows: [
                            {
                                place: "other-note-place-town",
                                population: 1,
                                market: 1,
                                holder: "The Crown",
                            },
                        ],
                        tail,
                    },
                },
            },
        };
        const foreign = {
            package: "other",
            type: "place",
            subType: "settlement",
            shortcode: "town",
            name: { full: "Foreign Town" },
            data: { population: 3400, market: 4 },
        };
        const index = {
            contentPackage: "sohl",
            notes: [regionNote],
            resolve: (value: string) => (value === "other-note-place-town" ? foreign : undefined),
        };
        expect(
            checkSettlementTables(regionNote, { index }).map((x) => x.message.split(":")[0]),
        ).toEqual(["figure disagrees", "market disagrees"]);
    });
});
