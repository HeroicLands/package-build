/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A region's settlements table agrees with its declared shape, its holding
 * model and the notes it links.
 *
 * The cases are **derived from the rule list itself**: the module declares
 * `SETTLEMENT_TABLE_RULES`, this file declares a fixture per rule name, and the
 * two sets are compared. A rule added without a case fails here before it can
 * ship unproven. Every broken tree differs from one sound tree by a single
 * edit and must raise exactly one finding from the whole module, so a rule
 * that fires on a neighbour's fault is caught as surely as one that never
 * fires.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    HOLDING_MODELS,
    SETTLEMENT_COLUMNS,
    SETTLEMENT_TABLE_RULES,
    SETTLEMENTS_HEADING,
} from "../engine/settlement-tables.mjs";
import { MARKET_CLASSES } from "../engine/market-class.mjs";
import { auditLinks, buildLinkIndex } from "../engine/content-links.mjs";
import { loadContentFormat, parseContentFormat } from "../engine/content-format.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { DECLARED_TAGS, NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";

type Finding = { file: string; line?: number; column?: number; severity: string; message: string };

/* ---------------------------------------------------------------------- */
/*  Fixtures                                                              */
/* ---------------------------------------------------------------------- */

/** The market cell the scale writes for a class value. */
function market(value: number): string {
    const entry = MARKET_CLASSES.find((c) => c.value === value);
    if (!entry) throw new Error(`no market class ${value}`);
    return `${entry.value} ${entry.name}`;
}

/** The header row and delimiter the declared columns produce. */
function header(columns = SETTLEMENT_COLUMNS.map((c) => c.name)): string[] {
    return [`| ${columns.join(" | ")} |`, `| ${columns.map(() => "---").join(" | ")} |`];
}

/** A table row from its cells. */
function row(...cells: string[]): string {
    return `| ${cells.join(" | ")} |`;
}

const ASHFORD = row(
    "[[place-ashford\\|Ashford]]",
    market(4),
    "3,400",
    "[[affiliation-crown\\|the Crown]]",
    "the ford on the drove road",
);
const WEYSHOTT = row(
    "Weyshott",
    market(2),
    "420",
    "[[being-aldwyn\\|Sir Aldwyn of Brynwold]]",
    "the manor's mill",
);
const COLD_HATCH = row("Cold Hatch", market(1), "60", "Sir Aldwyn of Brynwold", "the sheepwalk");
const TAIL = "Some four hundred further villages lie in the vale, none of them named here.";

/** A region note carrying a settlements table. */
function region({
    tags = ["region", "held"],
    lines = [...header(), ASHFORD, WEYSHOTT, COLD_HATCH, "", TAIL],
}: { tags?: string[]; lines?: string[] } = {}): string {
    return [
        "---",
        "type: place",
        "subType: region",
        "shortcode: vale",
        "name:",
        "    full: The Vale",
        `tags: [${tags.join(", ")}]`,
        "data:",
        "    population: 100000",
        "    government: crown",
        "---",
        "",
        "The vale is farmed from end to end.",
        "",
        `## ${SETTLEMENTS_HEADING}`,
        "",
        ...lines,
        "",
        "## Economy",
        "",
        "Wool and grain.",
        "",
    ].join("\n");
}

/** A settlement note inside the vale. */
function settlement(
    shortcode: string,
    name: string,
    { population, marketClass }: { population?: number; marketClass?: number } = {},
): string {
    return [
        "---",
        "type: place",
        "subType: settlement",
        `shortcode: ${shortcode}`,
        "name:",
        `    full: ${name}`,
        "data:",
        "    parents: [vale]",
        ...(population === undefined ? [] : [`    population: ${population}`]),
        ...(marketClass === undefined ? [] : [`    market: ${marketClass}`]),
        "    government: crown",
        "---",
        "",
        `${name} stands at the ford.`,
        "",
    ].join("\n");
}

const CROWN = [
    "---",
    "type: affiliation",
    "subType: polity",
    "shortcode: crown",
    "name:",
    "    full: The Crown",
    "---",
    "",
    "The Crown holds the vale.",
    "",
].join("\n");

const ALDWYN = [
    "---",
    "type: being",
    "subType: npc",
    "shortcode: aldwyn",
    "name:",
    "    full: Sir Aldwyn of Brynwold",
    "---",
    "",
    "A knight of the vale.",
    "",
].join("\n");

/** The sound tree, with any file replaced. */
function tree(overrides: Record<string, string> = {}): Record<string, string> {
    return {
        "Vale.md": region(),
        "Ashford.md": settlement("ashford", "Ashford", { population: 3400, marketClass: 4 }),
        "Crown.md": CROWN,
        "Aldwyn.md": ALDWYN,
        ...overrides,
    };
}

/** Write the fixture as a content tree under `root/assets/content`. */
function writeTree(root: string, files: Record<string, string>): string {
    const base = path.join(root, "assets/content");
    for (const [rel, body] of Object.entries(files)) {
        const abs = path.join(base, ...rel.split("/"));
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, body, "utf8");
    }
    return base;
}

/** Build and lint a tree; keep this module's findings and the link audit. */
function lint(files: Record<string, string>): {
    findings: Finding[];
    all: Finding[];
    root: string;
    audit: ReturnType<typeof auditLinks>;
} {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-settlement-tables-"));
    const base = writeTree(root, files);
    const index = buildLinkIndex(base, { skipDirectories: [] });
    const { findings } = lintFrontmatter(index, {
        schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS } as never,
        vocabulary: NOTE_VOCABULARY,
    });
    const names = SETTLEMENT_TABLE_RULES.map((r) => r.name);
    const mine = (findings as Finding[]).filter((f) =>
        names.some((n) => f.message.startsWith(`${n}:`)),
    );
    return { root, findings: mine, all: findings as Finding[], audit: auditLinks(index) };
}

/** The 1-based line of the first line in `text` containing `needle`. */
function lineOf(text: string, needle: string): number {
    return text.split("\n").findIndex((line) => line.includes(needle)) + 1;
}

/* ---------------------------------------------------------------------- */
/*  One broken tree per rule                                              */
/* ---------------------------------------------------------------------- */

type Case = {
    /** The tree that breaks the rule, one edit from the sound tree. */
    broken: Record<string, string>;
    /** The note the finding lands on, relative to the content root. */
    on: string;
    /** Text on the line the finding is located at. */
    at: string;
    /** Whether the finding names a column. */
    column: boolean;
    /** A phrase the message must carry, so the finding says what it found. */
    says: string;
};

const LINES = [...header(), ASHFORD, WEYSHOTT, COLD_HATCH, "", TAIL];

const CASES: Record<string, Case> = {
    "settlements columns": {
        broken: tree({
            "Vale.md": region({
                lines: [
                    ...header(["Name", "Market", "People", "For"]),
                    row("[[place-ashford\\|Ashford]]", market(4), "3,400", "the ford"),
                    "",
                    TAIL,
                ],
            }),
        }),
        on: "Vale.md",
        at: "| Name | Market | People | For |",
        column: false,
        says: "Held by",
    },
    "no holding model": {
        broken: tree({ "Vale.md": region({ tags: ["region"] }) }),
        on: "Vale.md",
        at: "tags:",
        column: true,
        says: HOLDING_MODELS.map((m) => m.tag).join(", "),
    },
    "market class": {
        broken: tree({
            "Vale.md": region({
                lines: LINES.map((l) => (l === WEYSHOTT ? l.replace(market(2), "2 town") : l)),
            }),
        }),
        on: "Vale.md",
        at: "Weyshott",
        column: true,
        says: market(2),
    },
    "people figure": {
        broken: tree({
            "Vale.md": region({
                lines: LINES.map((l) => (l === WEYSHOTT ? l.replace("420", "about 420") : l)),
            }),
        }),
        on: "Vale.md",
        at: "Weyshott",
        column: true,
        says: "about 420",
    },
    "no holder": {
        broken: tree({
            "Vale.md": region({
                lines: LINES.map((l) =>
                    l === COLD_HATCH ? l.replace("Sir Aldwyn of Brynwold", " ") : l,
                ),
            }),
        }),
        on: "Vale.md",
        at: "Cold Hatch",
        column: true,
        says: "Cold Hatch",
    },
    "not a holder": {
        broken: tree({
            "Vale.md": region({
                lines: LINES.map((l) =>
                    l === WEYSHOTT ?
                        l.replace(
                            "[[being-aldwyn\\|Sir Aldwyn of Brynwold]]",
                            "[[place-ashford\\|Ashford]]",
                        )
                    :   l,
                ),
            }),
        }),
        on: "Vale.md",
        at: "Weyshott",
        column: true,
        says: "place",
    },
    "holder out of model": {
        broken: tree({ "Vale.md": region({ tags: ["region", "endowed"] }) }),
        on: "Vale.md",
        at: "Weyshott",
        column: true,
        says: "endowed",
    },
    "not a settlement": {
        broken: tree({
            "Vale.md": region({
                lines: LINES.map((l) =>
                    l === COLD_HATCH ? l.replace("Cold Hatch", "[[affiliation-crown\\|Crown]]") : l,
                ),
            }),
        }),
        on: "Vale.md",
        at: "[[affiliation-crown\\|Crown]] | 1",
        column: true,
        says: "affiliation",
    },
    "figure disagrees": {
        broken: tree({
            "Vale.md": region({
                lines: LINES.map((l) => (l === ASHFORD ? l.replace("3,400", "3,000") : l)),
            }),
        }),
        on: "Vale.md",
        at: "Ashford",
        column: true,
        says: "3,400",
    },
    "market disagrees": {
        broken: tree({
            "Vale.md": region({
                lines: LINES.map((l) => (l === ASHFORD ? l.replace(market(4), market(3)) : l)),
            }),
        }),
        on: "Vale.md",
        at: "Ashford",
        column: true,
        says: market(4),
    },
    "unlinked settlement": {
        broken: tree({
            "Vale.md": region({
                lines: LINES.map((l) =>
                    l === ASHFORD ? l.replace("[[place-ashford\\|Ashford]]", "Ashford") : l,
                ),
            }),
        }),
        on: "Vale.md",
        at: "| Ashford |",
        column: true,
        says: "place-ashford",
    },
    "missing row": {
        broken: tree({
            "Vale.md": region({ lines: LINES.filter((l) => l !== ASHFORD) }),
        }),
        on: "Vale.md",
        at: "| Name |",
        column: false,
        says: "Ashford",
    },
    "duplicate settlement": {
        broken: tree({
            "Vale.md": region({
                lines: [...header(), ASHFORD, WEYSHOTT, COLD_HATCH, WEYSHOTT, "", TAIL],
            }),
        }),
        on: "Vale.md",
        at: "Weyshott",
        column: true,
        says: "Weyshott",
    },
    "no tail": {
        broken: tree({
            "Vale.md": region({ lines: [...header(), ASHFORD, WEYSHOTT, COLD_HATCH] }),
        }),
        on: "Vale.md",
        at: "Cold Hatch",
        column: false,
        says: "sentence",
    },
};

/** The line a case's finding must land on. "duplicate" is the second occurrence. */
function expectedLine(text: string, rule: string, needle: string): number {
    const lines = text.split("\n");
    const hits = lines.flatMap((line, i) => (line.includes(needle) ? [i + 1] : []));
    return rule === "duplicate settlement" ? hits[1] : hits[0];
}

/* ---------------------------------------------------------------------- */
/*  The guard                                                             */
/* ---------------------------------------------------------------------- */

describe("a sound settlements table", () => {
    it("raises nothing, from this module or the link audit", () => {
        const { findings, root, audit } = lint(tree());
        try {
            expect(findings).toEqual([]);
            expect(audit.deadAddresses).toEqual([]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("accepts a person in a region carrying held beside another model", () => {
        const { findings, root } = lint(
            tree({ "Vale.md": region({ tags: ["region", "endowed", "held"] }) }),
        );
        try {
            expect(findings).toEqual([]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("leaves a table under any other heading alone", () => {
        const text = region({
            tags: ["region"],
            lines: [...header(["Name", "People"]), row("Ashford", "3,400")],
        }).replace(`## ${SETTLEMENTS_HEADING}`, "## Realms");
        const { findings, root } = lint(tree({ "Vale.md": text }));
        try {
            expect(findings).toEqual([]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("leaves a query-generated settlements section alone", () => {
        const text = region({
            tags: ["region"],
            lines: ["```sql", "SELECT 1 AS x", "```", "", TAIL],
        });
        const { findings, root } = lint(tree({ "Vale.md": text }));
        try {
            expect(findings).toEqual([]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe("every settlements-table rule is proven", () => {
    it("declares a case for every rule, and no case for a rule that does not exist", () => {
        expect(Object.keys(CASES).sort()).toEqual(SETTLEMENT_TABLE_RULES.map((r) => r.name).sort());
    });

    for (const rule of SETTLEMENT_TABLE_RULES) {
        it(`${rule.name}: fires once, located where the fix goes`, () => {
            const testCase = CASES[rule.name];
            const { findings, root } = lint(testCase.broken);
            try {
                expect(findings).toHaveLength(1);
                const [f] = findings;
                expect(f.message.startsWith(`${rule.name}: `)).toBe(true);
                expect(f.file).toBe(path.join(root, "assets/content", testCase.on));
                expect(f.severity).toBe("error");
                expect(f.line).toBe(
                    expectedLine(testCase.broken[testCase.on], rule.name, testCase.at),
                );
                if (testCase.column) expect(f.column).toBeGreaterThan(0);
                else expect(f.column).toBeUndefined();
                expect(f.message).toContain(testCase.says);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        });
    }
});

describe("what the rules read", () => {
    it("reports a cell at the column it starts on", () => {
        const { findings, root } = lint(CASES["people figure"].broken);
        try {
            const text = CASES["people figure"].broken["Vale.md"];
            const line = text.split("\n")[lineOf(text, "Weyshott") - 1];
            expect(findings[0].column).toBe(line.indexOf("about 420") + 1);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("leaves a dead holder link to the link audit rather than reporting it twice", () => {
        const { findings, root, audit } = lint(
            tree({
                "Vale.md": region({
                    lines: LINES.map((l) =>
                        l === COLD_HATCH ?
                            l.replace("Sir Aldwyn of Brynwold", "[[affiliation-nobody\\|Nobody]]")
                        :   l,
                    ),
                }),
            }),
        );
        try {
            expect(findings).toEqual([]);
            expect(audit.deadAddresses.map((d: { target?: string }) => d.target)).toContain(
                "affiliation-nobody",
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("reports a settlement linked from two regions' tables on the second", () => {
        const other = region()
            .replace("shortcode: vale", "shortcode: fen")
            .replace("full: The Vale", "full: The Fen")
            .replace(WEYSHOTT + "\n", "")
            .replace(COLD_HATCH + "\n", "");
        const { findings, root } = lint(tree({ "Zfen.md": other }));
        try {
            expect(findings).toHaveLength(1);
            expect(findings[0].message).toContain("duplicate settlement: ");
            expect(findings[0].file).toBe(path.join(root, "assets/content", "Zfen.md"));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("holds a settlement to the nearest region with a table", () => {
        const outer = region()
            .replace("shortcode: vale", "shortcode: realm")
            .replace("full: The Vale", "full: The Realm")
            .replace(ASHFORD + "\n", "");
        const inner = region().replace(
            "    population: 100000",
            "    parents: [realm]\n    population: 50000",
        );
        const { findings, root } = lint(tree({ "Realm.md": outer, "Vale.md": inner }));
        try {
            expect(findings.filter((f) => f.message.startsWith("missing row:"))).toEqual([]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("requires the note to state what a linked row states", () => {
        const { findings, root } = lint(
            tree({ "Ashford.md": settlement("ashford", "Ashford", { population: 3400 }) }),
        );
        try {
            expect(findings).toHaveLength(1);
            expect(findings[0].message).toContain("market disagrees: ");
            expect(findings[0].message).toContain("states none");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

/* ---------------------------------------------------------------------- */
/*  One statement of the models, the columns and the rules                */
/* ---------------------------------------------------------------------- */

const REFERENCE = fs.readFileSync(
    path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../docs/reference/format-details.md",
    ),
    "utf8",
);

describe("the holding models are declared once", () => {
    it("stay open tags, so a tag near a model's spelling is the author's own", () => {
        expect(Object.values(DECLARED_TAGS).flatMap((group) => group.tags)).not.toContain(
            HOLDING_MODELS[0].tag,
        );
        const { findings, all, root } = lint(
            tree({ "Vale.md": region({ tags: ["region", "hellad", "held"] }) }),
        );
        try {
            expect(findings).toEqual([]);
            expect(all.filter((f) => f.message.includes("hellad"))).toEqual([]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("are the format contract's holdingModel vocabulary", () => {
        expect(loadContentFormat().vocabularies.get("holdingModel")?.values).toEqual(
            HOLDING_MODELS.map((m) => m.tag),
        );
    });

    it("let exactly the models that name people hold a person", () => {
        expect(HOLDING_MODELS.filter((m) => m.person).map((m) => m.tag)).toEqual(["held"]);
    });
});

describe("the format reference states the table", () => {
    it("tabulates every holding model, in order, with its holder", () => {
        const reference = parseContentFormat(REFERENCE, { file: "format-details.md" });
        expect(reference.vocabularies.get("holdingModel")?.values).toEqual(
            HOLDING_MODELS.map((m) => m.tag),
        );
        for (const model of HOLDING_MODELS) {
            expect(REFERENCE).toMatch(
                new RegExp(`^\\| \`${model.tag}\` +\\| ${model.holder} +\\|$`, "m"),
            );
        }
    });

    it("names every column in order", () => {
        const names = SETTLEMENT_COLUMNS.map((c) => c.name).join(" | ");
        expect(REFERENCE).toContain(`| ${names} |`);
    });

    it("describes every rule by the name its findings carry", () => {
        for (const rule of SETTLEMENT_TABLE_RULES) {
            expect(REFERENCE).toContain(`- **\`${rule.name}\`** — `);
        }
    });
});
