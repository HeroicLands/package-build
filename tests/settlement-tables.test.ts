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
    settlementMarkdown,
    SETTLEMENT_ROW_FIELDS,
} from "../engine/settlement-tables.mjs";
import { indexRecordsFor, serializeContentIndex } from "../engine/content-index.mjs";
import { decodeIndexAddresses } from "../engine/note-addresses.mjs";
import { renderAddress } from "../engine/address.mjs";
import { prepareTreeSqlTables, openNotesDatabase, runSqlQuery } from "../engine/sql-tables.mjs";
import { expandContentTables } from "../engine/content-tables.mjs";
import { createRenderer } from "../engine/content-render.mjs";
import { markdownToTypst } from "../engine/pdf-render.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
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
    const findings = index.notes.flatMap((note) => checkSettlementTables(note, { index }));
    return {
        root,
        index,
        findings,
        records: () => indexRecordsFor({ contentBase: root, skipDirectories: [] }),
        dispose: () => fs.rmSync(root, { recursive: true, force: true }),
    };
}
function checked(change: (notes: any[]) => void, check: (f: ReturnType<typeof fixture>) => void) {
    const f = fixture(change);
    try {
        check(f);
    } finally {
        f.dispose();
    }
}
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
    it("accepts a plain holder name containing an address-like fragment", () =>
        checked(
            (n) => {
                n[1].data.settlements[0].holder = "Old-place-road";
            },
            (f) => expect(f.findings.some((x) => x.message.includes("holder"))).toBe(false),
        ));
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
            });
            expect(sections.get(path.join(f.root, "crown.md"))?.get("settlementindex")).toContain(
                "West Farm",
            );
            const prepared = await prepareTreeSqlTables(f.root, { records, skipDirectories: [] });
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
