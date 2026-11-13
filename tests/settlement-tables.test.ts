/*
 * Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { buildLinkIndex } from "../engine/content-links.mjs";
import {
    checkSettlementTables,
    assertSettlementRecords,
    settlementMarkdown,
    settlementExemptionTracker,
    SETTLEMENT_ROW_FIELDS,
} from "../engine/settlement-tables.mjs";
import { indexRecordsFor, serializeContentIndex } from "../engine/content-index.mjs";
import { decodeIndexAddresses } from "../engine/note-addresses.mjs";
import { renderAddress } from "../engine/address.mjs";
import { prepareTreeSqlTables, openNotesDatabase, runSqlQuery } from "../engine/sql-tables.mjs";
import { expandContentTables } from "../engine/content-tables.mjs";
import { createRenderer } from "../engine/content-render.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";
import { lintFrontmatter, lintNote } from "../engine/frontmatter-lint.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { derivedSections } from "../engine/derived-sections.mjs";

const row = (settlement = "East Farm", population = 100) => ({
    settlement,
    polity: "The Council",
    location: "place-vale",
    type: "homestead",
    fortification: null,
    stronghold: null,
    holder: "The Council",
    population,
    market: "subsistence",
    notes: "A farm by the road.",
});
function subjects() {
    return [
        { type: "place", subType: "region", shortcode: "vale", name: { full: "The Vale" } },
        {
            type: "affiliation",
            subType: "polity",
            shortcode: "crown",
            name: { full: "The Crown" },
            data: {
                population: 10,
                territorial_population: 1000,
                seat: "place-capital",
                settlements: [row()],
            },
        },
        {
            type: "affiliation",
            subType: "polity",
            shortcode: "council",
            name: { full: "The Council" },
            data: {
                parents: ["affiliation-crown"],
                territorial_population: 700,
                seat: "place-town",
                settlements: [row("West Farm", 300)],
            },
        },
        {
            type: "place",
            subType: "settlement",
            shortcode: "capital",
            name: { full: "Capital" },
            data: {
                parents: ["place-vale"],
                government: "affiliation-crown",
                type: "village",
                population: 200,
                market: "local",
                notes: "A bridge village.",
            },
        },
        {
            type: "place",
            subType: "settlement",
            shortcode: "town",
            name: { full: "Town" },
            data: {
                parents: ["place-vale"],
                government: "affiliation-council",
                type: "town",
                population: 400,
                market: "regional",
                notes: "A market town.",
            },
        },
    ] as any[];
}
function fixture(change: (notes: any[]) => void = () => {}, body = "") {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polity-settlements-"));
    const notes = subjects();
    change(notes);
    for (const fm of notes)
        fs.writeFileSync(
            path.join(root, `${fm.shortcode}.md`),
            `---\n${YAML.stringify(fm)}---\n${fm.shortcode === "crown" ? body || "A described polity." : "A described subject."}\n`,
        );
    const index = buildLinkIndex(root, { skipDirectories: [] });
    const findings = index.notes.flatMap((note) =>
        checkSettlementTables(note, { index, settlementPopulation: { mode: "complete" } }),
    );
    return {
        root,
        index,
        findings,
        records: () => indexRecordsFor({ contentBase: root, skipDirectories: [] }),
        dispose: () => fs.rmSync(root, { recursive: true, force: true }),
    };
}
function checked(
    change: (notes: any[]) => void,
    check: (f: ReturnType<typeof fixture>) => void,
    body = "",
) {
    const f = fixture(change, body);
    try {
        check(f);
    } finally {
        f.dispose();
    }
}
describe("settlement population declarations", () => {
    it.each([null, 0])("accepts %s in notes and listed rows", (value) =>
        checked(
            (n) => {
                n[3].data.population = value;
                n[1].data.settlements[0].population = value;
            },
            (f) =>
                expect(
                    f.findings.filter((x: any) => x.message.startsWith("people figure:")),
                ).toEqual([]),
        ),
    );
    it("warns for omitted population in notes and listed rows", () =>
        checked(
            (n) => {
                delete n[3].data.population;
                delete n[1].data.settlements[0].population;
            },
            (f) =>
                expect(
                    f.findings.filter(
                        (x: any) => x.severity === "warning" && x.message.includes("population"),
                    ),
                ).toHaveLength(2),
        ));
    it("leaves unknown figures blank in publication and skips complete totals", () =>
        checked(
            (n) => {
                delete n[1].data.settlements[0].population;
                n[3].data.population = null;
            },
            (f) => {
                expect(
                    f.findings.some((x: any) => x.message.startsWith("territorial population:")),
                ).toBe(false);
                const records = f.records();
                expect(() =>
                    assertSettlementRecords(records, {
                        fileOf: (fm: any) => path.join(f.root, `${fm.shortcode}.md`),
                        config: { packageBuild: { settlementPopulation: { mode: "complete" } } },
                    }),
                ).not.toThrow();
                const authored = f.index.notes.map((note: any) => note.fm);
                const markdown = settlementMarkdown(
                    authored.find((r: any) => r.shortcode === "crown"),
                    authored,
                );
                expect(markdown).toMatch(/East Farm[^\n]*\|\s*\|/);
            },
        ));
    it.each([-1, 1.5, 101, "100"])("rejects invalid population %s", (value) =>
        checked(
            (n) => {
                n[3].data.population = value;
                n[1].data.settlements[0].population = value;
            },
            (f) =>
                expect(
                    f.findings.filter((x: any) => x.message.startsWith("people figure:")).length,
                ).toBe(2),
        ),
    );
});
describe("polity settlement guards", () => {
    it("counts mixed rows and notes once, including seats, without membership or subordinate totals", () =>
        checked(
            () => {},
            (f) => expect(f.findings).toEqual([]),
        ));
    it.each([950, 1000, 1050])("allows a five percent difference for total %s", (total) =>
        checked(
            (n) => {
                n[1].data.territorial_population = total;
            },
            (f) => {
                // The difference is measured against the stated territorial total.
                expect(
                    f.findings.filter((x) => x.message.startsWith("territorial population:")),
                ).toHaveLength(total === 1000 ? 0 : 1);
            },
        ),
    );
    it("rejects populations with more than two significant digits", () =>
        checked(
            (n) => {
                n[1].data.settlements[0].population = 101;
                n[3].data.population = 201;
            },
            (f) =>
                expect(
                    f.findings.filter((x) => x.message.startsWith("people figure:")),
                ).toHaveLength(2),
        ));
    for (const field of SETTLEMENT_ROW_FIELDS.filter((field) => field.required))
        it(`requires row ${field.name}`, () =>
            checked(
                (n) => {
                    delete n[1].data.settlements[0][field.name];
                },
                (f) => expect(f.findings.some((x) => x.message.includes(field.name))).toBe(true),
            ));
    for (const field of SETTLEMENT_ROW_FIELDS.filter((field: any) => field.allowed))
        it(`enforces ${field.name} from the runtime vocabulary`, () =>
            checked(
                (n) => {
                    n[1].data.settlements[0][field.name] = "invalid";
                },
                (f) => expect(f.findings.some((x) => x.message.includes(field.name))).toBe(true),
            ));
    it.each(["type", "market", "notes", "government"])(
        "requires a populated settlement's %s",
        (key) =>
            checked(
                (n) => {
                    delete n[3].data[key];
                },
                (f) => expect(f.findings.some((x) => x.message.includes(key))).toBe(true),
            ),
    );
    it("reports the remedies when a declared total has no inventoried settlements", () => {
        const fm = {
            type: "affiliation",
            subType: "polity",
            shortcode: "empty",
            data: { territorial_population: 100 },
        };
        const note = {
            fm,
            file: "empty.md",
            raw: "---\ndata:\n  territorial_population: 100\n---\n",
        };
        const findings = checkSettlementTables(note, {
            index: { notes: [note], contentPackage: "sohl" },
            settlementPopulation: { mode: "complete" },
        });
        expect(
            findings.some((finding) =>
                finding.message.includes(
                    "list the settlements or declare a reasoned packageBuild.settlementExemptions entry for that polity",
                ),
            ),
        ).toBe(true);
    });
    it.each(["Capital", "place-capital"])("rejects a listed and noted identity %s", (name) =>
        checked(
            (n) => {
                n[1].data.settlements[0].settlement = name;
            },
            (f) =>
                expect(f.findings.some((x) => x.message.startsWith("duplicate settlement:"))).toBe(
                    true,
                ),
        ),
    );
    it("rejects duplicate rows across polities", () =>
        checked(
            (n) => {
                n[2].data.settlements[0].settlement = "East Farm";
            },
            (f) =>
                expect(f.findings.some((x) => x.message.startsWith("duplicate settlement:"))).toBe(
                    true,
                ),
        ));
    it.each(["Old-place-road", "Inn/Ferry", "North/South Ford", "Place-Capital", "Being-Gate"])(
        "accepts the plain settlement and holder name %s",
        (name) =>
            checked(
                (n) => {
                    n[1].data.settlements[0].settlement = name;
                    n[1].data.settlements[0].holder = name;
                },
                (f) => expect(f.findings).toEqual([]),
            ),
    );
    it("rejects an anchored holder address whose note is missing", () =>
        checked(
            (n) => {
                n[1].data.settlements[0].holder = "being-keeper#profile";
            },
            (f) =>
                expect(f.findings.some((x) => x.message.includes("holder must resolve"))).toBe(
                    true,
                ),
        ));
    it("resolves a polity address carrying a section anchor", () =>
        checked(
            (n) => {
                n[1].data.settlements[0].polity = "affiliation/crown#section";
            },
            (f) => expect(f.findings).toEqual([]),
            "## Section\n\nA described polity.",
        ));
    it("reports completeness remedies for a polity with a seat and a subordinate", () =>
        checked(
            (n) => {
                n[1].data.territorial_population = 2000;
            },
            (f) =>
                expect(
                    f.findings.some((x) =>
                        x.message.includes(
                            "list the settlements or declare a reasoned packageBuild.settlementExemptions entry for that polity",
                        ),
                    ),
                ).toBe(true),
        ));
    it.each(["affiliation/crown", "note-affiliation-crown", "sohl-note-affiliation-crown"])(
        "accepts the explicit polity address %s",
        (address) =>
            checked(
                (n) => {
                    n[1].data.settlements[0].polity = address;
                },
                (f) =>
                    expect(f.findings.some((x) => x.message.includes("polity must resolve"))).toBe(
                        false,
                    ),
            ),
    );
    it.each(["place/vale", "note-place-vale", "sohl-note-place-vale"])(
        "rejects the wrong holder address %s",
        (address) =>
            checked(
                (n) => {
                    n[1].data.settlements[0].holder = address;
                },
                (f) =>
                    expect(f.findings.some((x) => x.message.includes("holder must resolve"))).toBe(
                        true,
                    ),
            ),
    );
    it.each([
        "affiliation/missing",
        "note-affiliation-missing",
        "sohl-note-affiliation-missing",
        "affiliation/missing#section",
    ])("rejects an unresolved explicit polity address %s", (address) =>
        checked(
            (n) => {
                n[1].data.settlements[0].polity = address;
            },
            (f) =>
                expect(f.findings.some((x) => x.message.includes("polity must resolve"))).toBe(
                    true,
                ),
        ),
    );
    it.each([
        ["location", "affiliation-crown"],
        ["location", "place-missing"],
        ["polity", "place-vale"],
        ["holder", "place-vale"],
        ["holder", "affiliation-Crown"],
        ["polity", "skill-missing"],
        ["stronghold", "place-town"],
    ])("rejects wrong references or enums in %s", (key, value) =>
        checked(
            (n) => {
                n[1].data.settlements[0][key] = value;
            },
            (f) => expect(f.findings.some((x) => x.message.includes(key))).toBe(true),
        ),
    );
    it("rejects cycles", () => {
        const notes = subjects();
        notes[1].data.parents = ["affiliation-council"];
        const index = {
            notes: notes.map((fm) => ({ fm, file: `${fm.shortcode}.md` })),
            contentPackage: "sohl",
        };
        expect(
            checkSettlementTables(index.notes[1], { index }).some((x) =>
                x.message.startsWith("polity cycle:"),
            ),
        ).toBe(true);
    });
    it("rejects a parent and its ancestor as declared superiors", () =>
        checked(
            (n) => {
                n.push({
                    type: "affiliation",
                    subType: "polity",
                    shortcode: "local",
                    data: { parents: ["affiliation-council", "affiliation-crown"] },
                });
            },
            (f) =>
                expect(f.findings.some((x) => x.message.startsWith("polity superior:"))).toBe(true),
        ));
    it.each(["settlements", "seat", "subordinate"])(
        "requires a territorial total for %s",
        (reason) =>
            checked(
                (n) => {
                    delete n[1].data.territorial_population;
                    if (reason !== "settlements") delete n[1].data.settlements;
                    if (reason !== "seat") delete n[1].data.seat;
                    if (reason !== "subordinate") delete n[2].data.parents;
                },
                (f) =>
                    expect(
                        f.findings.some(
                            (x) =>
                                x.file.endsWith("crown.md") &&
                                x.message.includes("requires a territorial population"),
                        ),
                    ).toBe(true),
            ),
    );
    it("allows a polity without territorial declarations to omit the total", () =>
        checked(
            (n) => {
                delete n[2].data.territorial_population;
                delete n[2].data.settlements;
                delete n[2].data.seat;
            },
            (f) =>
                expect(
                    f.findings.some(
                        (x) =>
                            x.file.endsWith("council.md") &&
                            x.message.includes("requires a territorial population"),
                    ),
                ).toBe(false),
        ));
    it("rejects unrelated immediate superiors", () =>
        checked(
            (n) => {
                n.push({ type: "affiliation", subType: "polity", shortcode: "other" });
                n[2].data.parents.push("affiliation-other");
            },
            (f) =>
                expect(f.findings.some((x) => x.message.startsWith("polity superior:"))).toBe(true),
        ));
    it("rejects region declarations, object lists and unknown row keys", () =>
        checked(
            (n) => {
                n[0].data = { settlements: [] };
                n[2].data.settlements = { rows: [], tail: "A sentence." };
                n[1].data.settlements[0].extra = "unknown";
            },
            (f) =>
                expect(
                    f.findings.filter((x) => x.message.startsWith("settlements shape:")),
                ).toHaveLength(3),
        ));
});
describe("settlement boundary cases", () => {
    it("accepts typed and named holders through the complete frontmatter guard", () =>
        checked(
            (n) => {
                n[1].data.settlements[0].holder = "affiliation-crown";
                n[1].data.settlements[0].polity = "affiliation-crown";
                n[3].data.holder = "affiliation-crown";
            },
            (f) => {
                const { findings } = lintFrontmatter(f.index, {
                    schemas: ENGINE_NOTE_SCHEMAS as never,
                    vocabulary: NOTE_VOCABULARY,
                });
                expect(
                    findings.filter((x) =>
                        /settlements|holder|market|territorial population/.test(x.message),
                    ),
                ).toEqual([]);
            },
        ));
    it("requires notes even without a population", () =>
        checked(
            (n) => {
                delete n[3].data.population;
                delete n[3].data.notes;
            },
            (f) => expect(f.findings.some((x) => x.message.includes("notes"))).toBe(true),
        ));
    it("refuses a populated settlement governed by a non-polity", () =>
        checked(
            (n) => {
                n[2].subType = "guild";
            },
            (f) =>
                expect(
                    f.findings.some((x) =>
                        x.message.includes("government must resolve to a polity"),
                    ),
                ).toBe(true),
        ));
    it("enforces the exact tolerance boundary without rounding totals first", () =>
        checked(
            (n) => {
                n[1].data.settlements[0].population = 50;
            },
            (f) => expect(f.findings).toEqual([]),
        ));
    it("rejects a total just outside tolerance", () =>
        checked(
            (n) => {
                n[1].data.settlements[0].population = 49;
            },
            (f) =>
                expect(
                    f.findings.some((x) => x.message.startsWith("territorial population:")),
                ).toBe(true),
        ));
    it("walks all descendant levels and displays immediate polities without a seat", () =>
        checked(
            (n) => {
                delete n[2].data.seat;
                n.push({
                    type: "affiliation",
                    subType: "polity",
                    shortcode: "local",
                    name: { full: "Local Council" },
                    data: {
                        parents: ["affiliation-council"],
                        territorial_population: 20,
                        settlements: [row("Hill Farm", 20)],
                    },
                });
            },
            (f) => {
                const records = f.records();
                const crown = records.find((r) => r.shortcode === "crown" && !r.documents)!;
                const direct = settlementMarkdown(crown, records);
                const recursive = settlementMarkdown(crown, records, { recursive: true });
                expect(direct).toContain("affiliation-council");
                expect(direct).not.toContain("Hill Farm");
                expect(direct).not.toContain("affiliation-local");
                expect(recursive).toContain("Hill Farm");
            },
        ));
    it("refuses authored body tables without extracting their cells", () => {
        const f = fixture(
            () => {},
            "# Settlements {#settlements}\n\nName | People\n--- | ---\nAn invented number | 999",
        );
        try {
            expect(
                f.findings.filter((x) => x.message.startsWith("body settlements table:")),
            ).toHaveLength(1);
            expect(f.findings.some((x) => x.message.startsWith("territorial population:"))).toBe(
                false,
            );
        } finally {
            f.dispose();
        }
    });
});
describe("indexed settlement output", () => {
    it("separates direct subjects from recursive settlements and preserves audience boundaries", () =>
        checked(
            (n) => {
                n.push({
                    type: "place",
                    subType: "settlement",
                    shortcode: "secret",
                    name: { full: "Secret Camp" },
                    tags: ["gm"],
                    data: {
                        government: "affiliation-crown",
                        parents: ["place-vale"],
                        type: "encampment",
                        population: 10,
                        market: "subsistence",
                        notes: "Hidden.",
                    },
                });
            },
            (f) => {
                const records = f.records();
                const crown = records.find(
                    (r) => r.shortcode === "crown" && r.type === "affiliation" && !r.documents,
                )!;
                const direct = settlementMarkdown(crown, records);
                const recursive = settlementMarkdown(crown, records, { recursive: true });
                expect(direct).toContain("East Farm");
                expect(direct).toContain("place-capital");
                expect(direct).toContain("place-town");
                expect(direct).not.toContain("West Farm");
                expect(recursive).toContain("West Farm");
                expect(recursive.match(/place-town\\\|/g)).toHaveLength(1);
                expect(recursive).not.toContain("Secret Camp");
                expect(recursive).not.toContain("place-secret");
            },
        ));
    it("round-trips mixed Address and text columns through published indexes and SQL", async () => {
        const f = fixture((n) => {
            n[1].data.settlements[0].polity = "affiliation-crown";
            n[1].data.settlements[0].holder = "affiliation-crown";
        });
        let db;
        try {
            const records = f.records();
            const reopened = serializeContentIndex(records)
                .trim()
                .split("\n")
                .map((line) => {
                    const r = JSON.parse(line);
                    return decodeIndexAddresses(r, { package: r.package });
                });
            const crown = reopened.find(
                (r) => r.shortcode === "crown" && r.type === "affiliation" && !r.documents,
            );
            expect(renderAddress(crown.data.settlements[0].location)).toMatch(/-place-vale$/);
            expect(renderAddress(crown.data.settlements[0].holder)).toMatch(/-affiliation-crown$/);
            db = await openNotesDatabase(records);
            const result = await runSqlQuery(
                db,
                "SELECT data.settlements[1].location AS location FROM notes WHERE shortcode = 'crown' AND subType = 'polity'",
            );
            expect(result.rows[0].location).toMatch(/-place-vale$/);
            const markets = await runSqlQuery(db, "SELECT value FROM market ORDER BY value");
            expect(markets.rows.map((r) => r.value)).toEqual([
                "international",
                "local",
                "regional",
                "subsistence",
            ]);
        } finally {
            db?.close();
            f.dispose();
        }
    });
    it("renders one direct table and one recursive index in shared web, journal and book markup", async () => {
        const f = fixture(
            () => {},
            "# Settlements {#settlements}\n\nHeld lands.\n\n# Settlement index {#settlementindex}\n\nAll subjects.",
        );
        try {
            const records = f.records();
            const sections = derivedSections(records, {
                fileOf: (r) => path.join(f.root, `${r.shortcode}.md`),
                config: { packageBuild: { settlementPopulation: { mode: "complete" } } },
            });
            expect(sections.get(path.join(f.root, "crown.md"))?.get("settlementindex")).toContain(
                "West Farm",
            );
            const prepared = await prepareTreeSqlTables(f.root, {
                records,
                skipDirectories: [],
                config: { packageBuild: { settlementPopulation: { mode: "complete" } } },
            });
            const expanded = expandContentTables(
                "# Settlements {#settlements}\n\nHeld lands.\n\n# Settlement index {#settlementindex}\n\nAll subjects.",
                {
                    source: path.join(f.root, "crown.md"),
                    sqlTables: prepared?.get(path.join(f.root, "crown.md")),
                },
            );
            expect(expanded.markdown.match(/^# Settlements \{#settlements\}/gm)).toHaveLength(1);
            expect(
                expanded.markdown.match(/^# Settlement index \{#settlementindex\}/gm),
            ).toHaveLength(1);
            for (const target of ["web", "foundry"] as const) {
                const html = createRenderer(target).render(expanded.markdown);
                expect(html.match(/<table>/g)).toHaveLength(2);
                expect(html).toContain('class="name"');
                expect(html).toContain("West Farm");
            }
            const typst = markdownToTypst(expanded.markdown);
            expect(typst.match(/#table\(/g)).toHaveLength(2);
            expect(typst).toContain("West Farm");
        } finally {
            f.dispose();
        }
    });
});

describe("settlement graph reuse", () => {
    it("builds each graph once for a representative corpus", () => {
        const polities = Array.from({ length: 211 }, (_, i) => ({
            package: "sample",
            type: "affiliation",
            subType: "polity",
            shortcode: `p${i}`,
            data: {},
        }));
        const settlements = Array.from({ length: 500 }, (_, i) => ({
            package: "sample",
            type: "place",
            subType: "settlement",
            shortcode: `s${i}`,
            data: {
                government: `affiliation-p${i % polities.length}`,
                type: "village",
                population: 100,
                market: "local",
                notes: "A settlement.",
            },
        }));
        const places = Array.from({ length: 2289 }, (_, i) => ({
            package: "sample",
            type: "place",
            subType: "region",
            shortcode: `r${i}`,
        }));
        const records = [...polities, ...settlements, ...places];
        let indexReads = 0;
        const index = {
            get notes() {
                indexReads++;
                return records;
            },
            contentPackage: "sample",
        };
        for (const fm of [...polities, ...settlements])
            checkSettlementTables({ fm, file: "sample.md", raw: "" }, { index });
        expect(indexReads).toBe(1);
        let filters = 0;
        const rendered = new Proxy(records, {
            get(target, key, receiver) {
                if (key === "filter") filters++;
                return Reflect.get(target, key, receiver);
            },
        });
        for (const polity of polities) {
            settlementMarkdown(polity, rendered);
            settlementMarkdown(polity, rendered, { recursive: true });
        }
        expect(filters).toBe(1);
    });
});

describe("settlement exemptions", () => {
    it("locates each unused selector in its authored YAML and falls back for unavailable sources", () =>
        checked(
            (notes) => {
                delete notes[3].data.notes;
            },
            ({ index, root }) => {
                const configFile = path.join(root, "package-build.config.yaml");
                fs.writeFileSync(
                    configFile,
                    `packageBuild:
  settlementExemptions:
    - address: place-capital
      reason: pending
    - address: place-town
      reason: pending
    - prefix: place-other
      reason: pending
`,
                );
                const entries = [
                    { address: "place-capital", reason: "pending" },
                    { address: "place-town", reason: "pending" },
                    { prefix: "place-other", reason: "pending" },
                ];
                const lint = (file: string) =>
                    lintFrontmatter(index, {
                        schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
                        vocabulary: NOTE_VOCABULARY,
                        settlementExemptions: entries,
                        configFile: file,
                    }).findings.filter((f: any) =>
                        f.message.includes("matches no settlement violation"),
                    );
                expect(lint(configFile).map((f: any) => [f.file, f.line, f.column])).toEqual([
                    [configFile, 5, 7],
                    [configFile, 7, 7],
                ]);
                expect(
                    lint(path.join(root, "missing.yaml")).map((f: any) => [f.line, f.column]),
                ).toEqual([
                    [undefined, undefined],
                    [undefined, undefined],
                ]);
                fs.writeFileSync(
                    configFile,
                    `packageBuild:
  settlementExemptions:
    - address: place-capital
    - address: place-different
    - prefix: place-other
`,
                );
                expect(lint(configFile).map((f: any) => [f.line, f.column])).toEqual([
                    [undefined, undefined],
                    [5, 7],
                ]);
                fs.writeFileSync(configFile, "packageBuild: {}\n");
                expect(lint(configFile).map((f: any) => [f.line, f.column])).toEqual([
                    [undefined, undefined],
                    [undefined, undefined],
                ]);
            },
        ));
    it("counts affected notes once and credits overlapping entries", () =>
        checked(
            (notes) => {
                delete notes[3].data.notes;
            },
            ({ index }) => {
                const report = lintFrontmatter(index, {
                    schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
                    vocabulary: NOTE_VOCABULARY,
                    settlementExemptions: [
                        { address: "place-capital", reason: "Tables pending" },
                        { prefix: "place-cap", reason: "Tables pending" },
                        { address: "place-town", reason: "Tables pending" },
                    ],
                    configFile: "package-build.config.yaml",
                });
                expect(report.settlementExemptNotes).toBe(1);
                expect(
                    report.findings.filter((f: any) => f.message.includes("settlement exemption")),
                ).toHaveLength(1);
                expect(
                    report.findings.some((f: any) => f.message.includes("notes is nonempty")),
                ).toBe(false);
            },
        ));
});

describe("exempt settlement publication", () => {
    it("keeps non-settlement findings and applies the exception to publication", () =>
        checked(
            (notes) => {
                delete notes[3].data.notes;
                notes[3].data.unrecognized = "bad";
            },
            ({ index, root, records }) => {
                const exemption = [{ address: "place-capital", reason: "Tables pending" }];
                const result = lintFrontmatter(index, {
                    schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
                    vocabulary: NOTE_VOCABULARY,
                    settlementExemptions: exemption,
                });
                expect(result.settlementExemptNotes).toBe(1);
                expect(
                    result.findings.some(
                        (f: any) =>
                            f.file.endsWith("capital.md") && f.message.includes("unrecognized"),
                    ),
                ).toBe(true);
                const localRecords = records();
                expect(() =>
                    derivedSections(localRecords, {
                        fileOf: (r: any) => path.join(root, `${r.shortcode}.md`),
                        config: {
                            packageBuild: {
                                settlementExemptions: exemption,
                                settlementPopulation: { mode: "complete" },
                            },
                        },
                    }),
                ).not.toThrow();
            },
        ));
    it("rejects a stale selector and preserves other notes' settlement findings", () =>
        checked(
            (notes) => {
                delete notes[3].data.notes;
                delete notes[4].data.notes;
            },
            ({ index }) => {
                const result = lintFrontmatter(index, {
                    schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
                    vocabulary: NOTE_VOCABULARY,
                    settlementExemptions: [
                        { address: "place-capital", reason: "pending" },
                        { prefix: "place-unknown", reason: "pending" },
                    ],
                });
                expect(result.settlementExemptNotes).toBe(1);
                expect(
                    result.findings.some(
                        (f: any) =>
                            f.file.endsWith("town.md") && f.message.includes("settlement field"),
                    ),
                ).toBe(true);
                expect(
                    result.findings.some((f: any) =>
                        f.message.includes("matches no settlement violation"),
                    ),
                ).toBe(true);
            },
        ));
});

describe("settlement exemption scope", () => {
    it("matches hyphenated shortcodes by typed, full and prefix selectors", () => {
        const note = { fm: { type: "place", shortcode: "north-harbor" } };
        for (const entry of [
            { address: "place-north-harbor", reason: "pending" },
            { address: "thalorna-note-place-north-harbor", reason: "pending" },
            { prefix: "place-north-", reason: "pending" },
        ]) {
            const tracker = settlementExemptionTracker([entry], "thalorna");
            expect(tracker.filter(note, [{ settlementExemptible: true }])).toEqual([]);
            expect(tracker.count).toBe(1);
            expect(tracker.stale("config.yaml")).toEqual([]);
        }
    });
    it("retains precision and government findings without crediting a selector", () =>
        checked(
            (notes) => {
                notes[3].data.population = 123;
                notes[3].data.government = "affiliation-missing";
            },
            ({ index }) => {
                const result = lintFrontmatter(index, {
                    schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
                    vocabulary: NOTE_VOCABULARY,
                    settlementExemptions: [{ address: "place-capital", reason: "pending" }],
                    configFile: "config.yaml",
                });
                expect(result.settlementExemptNotes).toBe(0);
                expect(
                    result.findings.some((f: any) => f.message.startsWith("people figure")),
                ).toBe(true);
                expect(
                    result.findings.some((f: any) =>
                        f.message.startsWith("unresolved settlement reference"),
                    ),
                ).toBe(true);
                expect(
                    result.findings.some(
                        (f: any) =>
                            f.message.includes("matches no settlement violation") &&
                            f.line === undefined &&
                            f.column === undefined,
                    ),
                ).toBe(true);
            },
        ));

    it("preserves polity superior findings alongside eligible findings", () =>
        checked(
            (notes) => {
                notes[2].data.parents = ["affiliation-crown", "affiliation-crown"];
                delete notes[2].data.territorial_population;
            },
            ({ index }) => {
                const result = lintFrontmatter(index, {
                    schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
                    vocabulary: NOTE_VOCABULARY,
                    settlementExemptions: [{ address: "affiliation-council", reason: "pending" }],
                });
                expect(result.settlementExemptNotes).toBe(1);
                expect(
                    result.findings.some((f: any) => f.message.startsWith("polity superior")),
                ).toBe(true);
                expect(
                    result.findings.some((f: any) =>
                        f.message.includes("requires a territorial population"),
                    ),
                ).toBe(false);
            },
        ));
    it("does not exempt publication for a nonmatching selector", () =>
        checked(
            (notes) => {
                delete notes[3].data.notes;
            },
            ({ root, records }) => {
                expect(() =>
                    derivedSections(records(), {
                        fileOf: (r: any) => path.join(root, `${r.shortcode}.md`),
                        config: {
                            packageBuild: {
                                settlementExemptions: [
                                    { prefix: "place-other", reason: "pending" },
                                ],
                            },
                        },
                    }),
                ).toThrow();
            },
        ));
});

describe("settlement exemptions on actual violations", () => {
    it.each([
        [
            "settlement field",
            (n: any[]) => {
                delete n[3].data.notes;
            },
        ],
        [
            "settlement field",
            (n: any[]) => {
                n[3].data.type = "wrong";
                n[3].data.market = "wrong";
            },
        ],
    ])("suppresses %s while retaining its corpus", (code, change) =>
        checked(change, ({ index }) => {
            const note = index.notes.find((n: any) => n.fm.shortcode === "capital");
            expect(
                checkSettlementTables(note, { index }).some((f: any) => f.message.startsWith(code)),
            ).toBe(true);
            const result = lintFrontmatter(index, {
                schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
                vocabulary: NOTE_VOCABULARY,
                settlementExemptions: [{ prefix: "place-cap", reason: "pending" }],
            });
            expect(result.settlementExemptNotes).toBe(1);
            expect(
                result.findings.some(
                    (f: any) => f.file.endsWith("capital.md") && f.message.startsWith(code),
                ),
            ).toBe(false);
        }),
    );
    it("supports a territorial-sum owner exception", () =>
        checked(
            (notes) => {
                notes[1].data.territorial_population = 2000;
            },
            ({ index }) => {
                const note = index.notes.find((n: any) => n.fm.shortcode === "crown");
                expect(
                    checkSettlementTables(note, { index }).some((f: any) =>
                        f.message.startsWith("territorial population"),
                    ),
                ).toBe(true);
                const result = lintFrontmatter(index, {
                    schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
                    vocabulary: NOTE_VOCABULARY,
                    settlementExemptions: [
                        { address: "affiliation-crown", reason: "Dispersed population" },
                    ],
                });
                expect(result.settlementExemptNotes).toBe(1);
                expect(
                    result.findings.some(
                        (f: any) =>
                            f.file.endsWith("crown.md") &&
                            f.message.startsWith("territorial population"),
                    ),
                ).toBe(false);
            },
        ));
});

describe("settlement population policy", () => {
    it("uses the listed ceiling and urban share by default, including subordinate settlements", () => {
        checked(
            () => {},
            (f) => {
                const crown = f.index.notes.find((n: any) => n.fm.shortcode === "crown");
                const findings = checkSettlementTables(crown, { index: f.index });
                expect(findings.some((x: any) => x.message.includes("urban"))).toBe(true);
                expect(
                    checkSettlementTables(crown, {
                        index: f.index,
                        settlementPopulation: { mode: "ceiling", urbanShare: 0.4 },
                    }).filter((x: any) => x.message.startsWith("territorial population:")),
                ).toHaveLength(0);
                expect(
                    checkSettlementTables(crown, {
                        index: f.index,
                        settlementPopulation: { mode: "complete" },
                    }).filter((x: any) => x.message.startsWith("territorial population:")),
                ).toHaveLength(0);
            },
        );
    });
});

describe("settlement population boundaries", () => {
    it.each([
        [1000, 0.4, 0],
        [1000, 0.399, 1],
        [990, 1, 1],
        [1100, 1, 0],
    ])("checks territorial total %s and urban fraction %s", (total, urbanShare, expected) => {
        checked(
            (n) => {
                n[1].data.territorial_population = total;
            },
            (f) => {
                const crown = f.index.notes.find((n: any) => n.fm.shortcode === "crown");
                const findings = checkSettlementTables(crown, {
                    index: f.index,
                    settlementPopulation: { mode: "ceiling", urbanShare },
                });
                expect(
                    findings.filter((x: any) => x.message.startsWith("territorial population:")),
                ).toHaveLength(expected);
            },
        );
    });
    it("exempts aggregate findings without suppressing precision findings", () => {
        checked(
            (n) => {
                n[1].data.territorial_population = 900;
                n[1].data.settlements[0].population = 101;
            },
            (f) => {
                const crown = f.index.notes.find((n: any) => n.fm.shortcode === "crown");
                const tracker = settlementExemptionTracker(
                    [{ address: "affiliation-crown", reason: "Pending" }],
                    f.index.contentPackage,
                );
                const findings = checkSettlementTables(crown, {
                    index: f.index,
                    settlementExemptions: tracker,
                });
                expect(
                    findings.some((x: any) => x.message.startsWith("territorial population:")),
                ).toBe(false);
                expect(findings.some((x: any) => x.message.startsWith("people figure:"))).toBe(
                    true,
                );
            },
        );
    });
});

describe("settlement policy entry points", () => {
    it("uses the configured policy in lint and publication", () => {
        checked(
            () => {},
            ({ index, root, records }) => {
                const policy = { mode: "ceiling" as const, urbanShare: 0.5 };
                const lint = lintFrontmatter(index, {
                    schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
                    vocabulary: NOTE_VOCABULARY,
                    settlementPopulation: policy,
                });
                expect(
                    lint.findings.filter((f: any) =>
                        f.message.startsWith("territorial population:"),
                    ),
                ).toHaveLength(1);
                const complete = lintFrontmatter(index, {
                    schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
                    vocabulary: NOTE_VOCABULARY,
                    settlementPopulation: { mode: "complete" },
                });
                expect(
                    complete.findings.filter((f: any) =>
                        f.message.startsWith("territorial population:"),
                    ),
                ).toHaveLength(0);
                expect(() =>
                    derivedSections(records(), {
                        fileOf: (r: any) => path.join(root, `${r.shortcode}.md`),
                        config: { packageBuild: { settlementPopulation: policy } },
                    }),
                ).toThrow(/urban settlements/);
                expect(() =>
                    derivedSections(records(), {
                        fileOf: (r: any) => path.join(root, `${r.shortcode}.md`),
                        config: { packageBuild: { settlementPopulation: { mode: "complete" } } },
                    }),
                ).not.toThrow();
            },
        );
    });
});

describe("public settlement policy validation", () => {
    const invalid = [
        { urbanShare: NaN },
        { urbanShare: Infinity },
        { urbanShare: 2 },
        { extra: true },
        { mode: "other" },
        { mode: "complete", urbanShare: 0.1 },
    ];
    it.each(invalid)("rejects invalid policy %s before shortcuts", (policy) => {
        const settlementPopulation = policy as any;
        expect(() => checkSettlementTables({ fm: {} }, { settlementPopulation })).toThrow(
            /packageBuild.settlementPopulation/,
        );
        expect(() => lintNote({ fm: {} }, { settlementPopulation })).toThrow(
            /packageBuild.settlementPopulation/,
        );
        expect(() => lintFrontmatter({ notes: [] }, { settlementPopulation })).toThrow(
            /packageBuild.settlementPopulation/,
        );
        expect(() =>
            assertSettlementRecords([], { config: { packageBuild: { settlementPopulation } } }),
        ).toThrow(/packageBuild.settlementPopulation/);
    });
    it.each([29, 57, 58])(
        "accepts an exact %s percent urban limit and rejects the next percent",
        (percent) => {
            const polity = {
                type: "affiliation",
                subType: "polity",
                shortcode: "territory",
                name: "Territory",
                package: "local",
                data: { territorial_population: 100 },
            };
            const town = {
                type: "place",
                subType: "settlement",
                shortcode: "town",
                name: "Town",
                package: "local",
                data: {
                    population: percent,
                    type: "town",
                    market: "local",
                    notes: "Market town.",
                    government: "affiliation-territory",
                },
            };
            const records = [polity, town];
            const notes = records.map((fm) => ({ fm, file: fm.shortcode + ".md", raw: "" }));
            const index = { contentPackage: "local", notes };
            const settlementPopulation = { mode: "ceiling" as const, urbanShare: percent / 100 };
            const check = () =>
                checkSettlementTables(notes[0], { index, settlementPopulation }).filter((f) =>
                    f.message.startsWith("territorial population:"),
                );
            const publish = () =>
                assertSettlementRecords(records, {
                    fileOf: (r: any) => r.shortcode + ".md",
                    rawOf: () => "",
                    config: { packageBuild: { settlementPopulation } },
                });
            expect(check()).toHaveLength(0);
            expect(publish).not.toThrow();
            town.data.population++;
            expect(check()).toHaveLength(1);
            expect(check()[0].message).toContain(`allowed share of ${percent} percent`);
            expect(publish).toThrow(/exceed the allowed share/);
        },
    );
});

describe("metropolis population policy", () => {
    it("counts a metropolis in direct checks, lint and publication", () => {
        const polity = {
            type: "affiliation",
            subType: "polity",
            shortcode: "territory",
            name: "Territory",
            package: "local",
            data: { territorial_population: 100 },
        };
        const city = {
            type: "place",
            subType: "settlement",
            shortcode: "metro",
            name: "Metro",
            package: "local",
            data: {
                population: 100,
                type: "metropolis",
                market: "local",
                notes: "Market center.",
                government: "affiliation-territory",
            },
        };
        const records = [polity, city];
        const notes = records.map((fm) => ({ fm, file: fm.shortcode + ".md", raw: "" }));
        const index = { contentPackage: "local", notes };
        const check = (settlementPopulation?: any) =>
            checkSettlementTables(notes[0], { index, settlementPopulation }).filter((f) =>
                f.message.startsWith("territorial population:"),
            );
        const publish = (settlementPopulation?: any) =>
            assertSettlementRecords(records, {
                fileOf: (r: any) => r.shortcode + ".md",
                rawOf: () => "",
                config: { packageBuild: { settlementPopulation } },
            });
        expect(check()).toHaveLength(1);
        expect(
            lintFrontmatter(index, {
                schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
                vocabulary: NOTE_VOCABULARY,
            }).findings.some((f: any) => f.message.includes("exceed the allowed share")),
        ).toBe(true);
        expect(() => publish()).toThrow(/exceed the allowed share/);
        for (const policy of [{ urbanShare: 1 }, { mode: "complete" }]) {
            expect(check(policy)).toHaveLength(0);
            expect(() => publish(policy)).not.toThrow();
        }
    });
    it("credits ceiling exemptions and identifies unused selectors", () =>
        checked(
            (notes) => {
                notes[1].data.territorial_population = 900;
            },
            ({ index }) => {
                const note = index.notes.find((n: any) => n.fm.shortcode === "crown");
                expect(
                    checkSettlementTables(note, { index }).some((f: any) =>
                        f.message.includes("exceed the territorial ceiling"),
                    ),
                ).toBe(true);
                const result = lintFrontmatter(index, {
                    schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
                    vocabulary: NOTE_VOCABULARY,
                    settlementExemptions: [
                        { address: "affiliation-crown", reason: "pending" },
                        { prefix: "affiliation-unknown", reason: "pending" },
                    ],
                });
                expect(result.settlementExemptNotes).toBe(1);
                expect(
                    result.findings.filter((f: any) =>
                        f.message.includes("matches no settlement violation"),
                    ),
                ).toHaveLength(1);
                expect(
                    result.findings.some((f: any) =>
                        f.message.includes("exceed the territorial ceiling"),
                    ),
                ).toBe(false);
            },
        ));
});
