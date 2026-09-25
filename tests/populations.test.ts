/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A world's population figures agree from the region down.
 *
 * Four rules, and the cases are **derived from the rule list itself**: the
 * module declares `POPULATION_RULES`, this file declares a fixture per rule
 * name, and the two sets are compared. A rule added without a case fails here
 * before it can ship unproven, and every declared rule is run against a tree
 * that must provoke it and a tree that must not.
 *
 * Each fixture is minimal and provokes exactly one rule, so "this rule fires"
 * and "this rule does not fire on sound data" are both stated on the same
 * tree.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    POPULATION_RULES,
    POPULATION_TOLERANCE,
    checkCitedPopulations,
    checkPopulation,
    foreignNode,
} from "../engine/populations.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { NOTE_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";

/* ---------------------------------------------------------------------- */
/*  Fixtures                                                              */
/* ---------------------------------------------------------------------- */

type Finding = { file: string; line?: number; column?: number; severity: string; message: string };

/** A place note, stating what it sits within and how many people it holds. */
function place(
    shortcode: string,
    name: string,
    subType: string,
    { parents = [], population }: { parents?: string[]; population?: number } = {},
): string {
    return [
        "---",
        "type: place",
        `subType: ${subType}`,
        `shortcode: ${shortcode}`,
        "name:",
        `    full: ${name}`,
        "data:",
        `    parents: [${parents.join(", ")}]`,
        ...(population === undefined ? [] : [`    population: ${population}`]),
        "---",
        "",
        "Prose.",
        "",
    ].join("\n");
}

/** An affiliation note, holding what its `domains` name. */
function affiliation(
    shortcode: string,
    name: string,
    subType: string,
    {
        domains = [],
        parents = [],
        population,
    }: { domains?: string[]; parents?: string[]; population?: number } = {},
): string {
    return [
        "---",
        "type: affiliation",
        `subType: ${subType}`,
        `shortcode: ${shortcode}`,
        "name:",
        `    full: ${name}`,
        "data:",
        `    parents: [${parents.join(", ")}]`,
        `    domains: [${domains.join(", ")}]`,
        ...(population === undefined ? [] : [`    population: ${population}`]),
        "---",
        "",
        "Prose.",
        "",
    ].join("\n");
}

/** A `doc` note, whose body is what the citation rule reads. */
function doc(shortcode: string, name: string, body: string): string {
    return [
        "---",
        "type: doc",
        "subType: reference",
        `shortcode: ${shortcode}`,
        "name:",
        `    full: ${name}`,
        "---",
        "",
        body,
        "",
    ].join("\n");
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

/** Lint a tree and keep the population findings, by rule name. */
function lintPopulation(
    files: Record<string, string>,
    rule?: string,
): { findings: Finding[]; root: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-populations-"));
    const base = writeTree(root, files);
    const index = buildLinkIndex(base, { skipDirectories: [] });
    const { findings } = lintFrontmatter(index, {
        schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS } as never,
        vocabulary: NOTE_VOCABULARY,
    });
    const names = POPULATION_RULES.map((r) => r.name);
    const mine = (findings as Finding[]).filter((f) =>
        names.some((n) => f.message.startsWith(`${n}:`)),
    );
    return { root, findings: rule ? mine.filter((f) => f.message.startsWith(`${rule}:`)) : mine };
}

/**
 * One rule's evidence: a tree that must provoke it, the note the finding lands
 * on, and a tree that must not provoke it.
 */
type Case = {
    /** The tree that breaks the rule. */
    broken: Record<string, string>;
    /** The note the finding is reported on, relative to the content root. */
    on: string;
    /** A phrase the message must carry, so the finding says what it found. */
    says: string;
    /** A tree the rule must stay silent on. */
    sound: Record<string, string>;
};

const CASES: Record<string, Case> = {
    "over-held land": {
        broken: {
            "Rgn.md": place("rgn", "The Region", "region", { population: 1000 }),
            "Crown.md": affiliation("crown", "The Crown", "polity", {
                domains: ["rgn"],
                population: 1500,
            }),
        },
        on: "Rgn.md",
        says: "1,500",
        sound: {
            "Rgn.md": place("rgn", "The Region", "region", { population: 1000 }),
            "Crown.md": affiliation("crown", "The Crown", "polity", {
                domains: ["rgn"],
                population: 900,
            }),
        },
    },
    "over-full region": {
        broken: {
            "Rgn.md": place("rgn", "The Region", "region", { population: 1000 }),
            "North.md": place("north", "North", "region", { parents: ["rgn"], population: 700 }),
            "South.md": place("south", "South", "region", { parents: ["rgn"], population: 600 }),
        },
        on: "Rgn.md",
        says: "1,300",
        sound: {
            "Rgn.md": place("rgn", "The Region", "region", { population: 1000 }),
            "North.md": place("north", "North", "region", { parents: ["rgn"], population: 400 }),
            "South.md": place("south", "South", "region", { parents: ["rgn"], population: 500 }),
        },
    },
    "oversized settlement": {
        broken: {
            "Rgn.md": place("rgn", "The Region", "region", { population: 1000 }),
            "Big.md": place("big", "Big", "settlement", { parents: ["rgn"], population: 2000 }),
        },
        on: "Big.md",
        says: "2,000",
        sound: {
            "Rgn.md": place("rgn", "The Region", "region", { population: 1000 }),
            "Big.md": place("big", "Big", "settlement", { parents: ["rgn"], population: 400 }),
        },
    },
    "disputed figure": {
        broken: {
            "Rgn.md": place("rgn", "The Region", "region", { population: 1000 }),
            "Census.md": doc(
                "census",
                "The Census",
                [
                    "| Region | People |",
                    "| --- | --- |",
                    "| [[place-rgn\\|The Region]] | ~2,000 |",
                ].join("\n"),
            ),
        },
        on: "Census.md",
        says: "2,000",
        sound: {
            "Rgn.md": place("rgn", "The Region", "region", { population: 1000 }),
            "Census.md": doc(
                "census",
                "The Census",
                [
                    "| Region | People |",
                    "| --- | --- |",
                    "| [[place-rgn\\|The Region]] | ~1,000 |",
                ].join("\n"),
            ),
        },
    },
};

/* ---------------------------------------------------------------------- */
/*  The guard: a case per rule, derived from the rule list                */
/* ---------------------------------------------------------------------- */

describe("every population rule is proven", () => {
    it("declares a case for every rule, and no case for a rule that does not exist", () => {
        expect(Object.keys(CASES).sort()).toEqual(POPULATION_RULES.map((r) => r.name).sort());
    });

    it("gives every rule a name and a description", () => {
        expect(POPULATION_RULES.length).toBeGreaterThan(0);
        for (const rule of POPULATION_RULES) {
            expect(typeof rule.name).toBe("string");
            expect(rule.name.length).toBeGreaterThan(0);
            expect(typeof rule.describe).toBe("string");
            expect(rule.describe.length).toBeGreaterThan(0);
        }
    });

    for (const rule of POPULATION_RULES) {
        describe(rule.name, () => {
            it("has a case", () => {
                expect(CASES[rule.name]).toBeDefined();
            });

            it("fires on the tree that breaks it, at the note that states the figure", () => {
                const testCase = CASES[rule.name];
                const { findings, root } = lintPopulation(testCase.broken, rule.name);
                try {
                    expect(findings).toHaveLength(1);
                    const [f] = findings;
                    expect(f.file).toBe(path.join(root, "assets/content", testCase.on));
                    expect(f.severity).toBe("warning");
                    expect(f.line).toBeGreaterThan(0);
                    expect(f.column).toBeGreaterThan(0);
                    expect(f.message).toContain(testCase.says);
                } finally {
                    fs.rmSync(root, { recursive: true, force: true });
                }
            });

            it("stays silent on the tree that keeps it", () => {
                const { findings, root } = lintPopulation(CASES[rule.name].sound, rule.name);
                try {
                    expect(findings).toEqual([]);
                } finally {
                    fs.rmSync(root, { recursive: true, force: true });
                }
            });
        });
    }
});

/* ---------------------------------------------------------------------- */
/*  What the rules read, beyond firing at all                             */
/* ---------------------------------------------------------------------- */

describe("the rules read the corpus the way the notes are authored", () => {
    it("counts a polity subordinate to another holding the same place only once", () => {
        const { findings, root } = lintPopulation({
            "Rgn.md": place("rgn", "The Region", "region", { population: 1000 }),
            "Crown.md": affiliation("crown", "The Crown", "polity", {
                domains: ["rgn"],
                population: 900,
            }),
            "Duchy.md": affiliation("duchy", "The Duchy", "polity", {
                domains: ["rgn"],
                parents: ["crown"],
                population: 900,
            }),
        });
        try {
            expect(findings).toEqual([]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("counts a region naming both its parent and its grandparent under the nearer", () => {
        const { findings, root } = lintPopulation({
            "World.md": place("wld", "The World", "world", { population: 1000 }),
            "Rgn.md": place("rgn", "The Region", "region", { parents: ["wld"], population: 900 }),
            "Shire.md": place("shire", "The Shire", "region", {
                parents: ["rgn", "wld"],
                population: 800,
            }),
        });
        try {
            expect(findings).toEqual([]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("holds a settlement to every place above it, not only its own parent", () => {
        const { findings, root } = lintPopulation(
            {
                "World.md": place("wld", "The World", "world", { population: 1000 }),
                "Rgn.md": place("rgn", "The Region", "region", {
                    parents: ["wld"],
                    population: 5000,
                }),
                "Big.md": place("big", "Big", "settlement", { parents: ["rgn"], population: 4000 }),
            },
            "oversized settlement",
        );
        try {
            expect(findings).toHaveLength(1);
            expect(findings[0].file).toBe(path.join(root, "assets/content", "Big.md"));
            expect(findings[0].message).toContain("The World");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("leaves a figure written as prose alone, rather than reading its leading digits", () => {
        const asides = [
            "[[place-rgn|The Region]] at ~1M is a tenth of the coast.",
            "[[place-rgn|The Region]] at ~1.5M after the famine.",
            "[[place-rgn|The Region]] is ~5% of the province.",
            "Compare [[place-rgn|The Region]] (~12–14M) atop the plain.",
        ];
        for (const aside of asides) {
            const { findings, root } = lintPopulation(
                {
                    "Rgn.md": place("rgn", "The Region", "region", { population: 900000 }),
                    "Census.md": doc("census", "The Census", aside),
                },
                "disputed figure",
            );
            try {
                expect({ aside, findings }).toEqual({ aside, findings: [] });
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
    });

    it("reads a figure that ends a sentence", () => {
        const { findings, root } = lintPopulation(
            {
                "Rgn.md": place("rgn", "The Region", "region", { population: 1000 }),
                "Census.md": doc("census", "The Census", "[[place-rgn|The Region]] holds ~4,000."),
            },
            "disputed figure",
        );
        try {
            expect(findings).toHaveLength(1);
            expect(findings[0].message).toContain("4,000");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("allows a parent rounded below the sum of its children, within the tolerance", () => {
        const stated = 1000;
        const children = Math.floor(stated * POPULATION_TOLERANCE);
        const { findings, root } = lintPopulation({
            "Rgn.md": place("rgn", "The Region", "region", { population: stated }),
            "North.md": place("north", "North", "region", {
                parents: ["rgn"],
                population: children,
            }),
        });
        try {
            expect(findings).toEqual([]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("exempts a settlement from the polities holding it, which count its hinterland", () => {
        const { findings, root } = lintPopulation({
            "Rgn.md": place("rgn", "The Region", "region", { population: 9000 }),
            "City.md": place("city", "The City", "settlement", {
                parents: ["rgn"],
                population: 1000,
            }),
            "State.md": affiliation("state", "The City-State", "polity", {
                domains: ["city"],
                population: 8000,
            }),
        });
        try {
            expect(findings).toEqual([]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("reads a figure cited inline, and locates each repeat on its own line", () => {
        const { findings, root } = lintPopulation(
            {
                "Rgn.md": place("rgn", "The Region", "region", { population: 1000 }),
                "Census.md": doc(
                    "census",
                    "The Census",
                    [
                        "[[place-rgn|The Region]] ~4,000 souls.",
                        "",
                        "Again: [[place-rgn|The Region]] ~4,000.",
                    ].join("\n"),
                ),
            },
            "disputed figure",
        );
        try {
            expect(findings).toHaveLength(2);
            expect(new Set(findings.map((f) => f.line)).size).toBe(2);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("says nothing about a figure with no approximation marker, which is not a claim", () => {
        const { findings, root } = lintPopulation({
            "Rgn.md": place("rgn", "The Region", "region", { population: 1000 }),
            "Routes.md": doc(
                "routes",
                "The Routes",
                ["| To | Days |", "| --- | --- |", "| [[place-rgn\\|The Region]] | 3 |"].join("\n"),
            ),
        });
        try {
            expect(findings).toEqual([]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("says nothing about a place that states no population", () => {
        const { findings, root } = lintPopulation({
            "Rgn.md": place("rgn", "The Region", "region"),
            "Crown.md": affiliation("crown", "The Crown", "polity", {
                domains: ["rgn"],
                population: 1500,
            }),
        });
        try {
            expect(findings).toEqual([]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

/* ---------------------------------------------------------------------- */
/*  A fetched dependency's places and affiliations                        */
/* ---------------------------------------------------------------------- */

describe("foreignNode", () => {
    it("reads the shortcode from the entry's canonical address", () => {
        expect(
            foreignNode("kethira-none-place-vylar", {
                type: "place",
                name: "Vylar",
                parents: ["north"],
            }),
        ).toEqual({
            shortcode: "vylar",
            type: "place",
            subType: "",
            title: "Vylar",
            parents: ["north"],
            domains: [],
        });
    });

    it("reads an affiliation's domains, and lower-cases a mixed-case shortcode", () => {
        expect(
            foreignNode("kethira-sohl-affiliation-Empire", {
                type: "affiliation",
                subType: "polity",
                domains: ["north", "south"],
            }),
        ).toMatchObject({ shortcode: "empire", type: "affiliation", domains: ["north", "south"] });
    });

    it("takes no part where the entry names neither a place nor an affiliation", () => {
        expect(foreignNode("kethira-none-doc-vylar", { type: "doc" })).toBeNull();
    });

    it("takes no part where the address is not a canonical key", () => {
        // A shortcode this module could not derive is not a node this module
        // silently mislabels — `readCanonicalKey` reports the malformed key as
        // unreadable, and the entry is dropped rather than keyed on a guess.
        expect(foreignNode("not-an-address", { type: "place" })).toBeNull();
    });
});

/* ---------------------------------------------------------------------- */
/*  Wiring                                                                */
/* ---------------------------------------------------------------------- */

describe("the checks are the ones the vocabulary declares", () => {
    it("checks `data.population` on a place", () => {
        const field = dataFields("place", NOTE_VOCABULARY)?.find((f) => f.name === "population");
        expect(field?.check).toBe(checkPopulation);
    });

    it("checks a `doc` note's cited figures", () => {
        expect(NOTE_VOCABULARY.doc.check).toBe(checkCitedPopulations);
    });

    it("declares no rule about a region's urban share", () => {
        const text = POPULATION_RULES.map((r) => `${r.name} ${r.describe}`)
            .join(" ")
            .toLowerCase();
        expect(text).not.toContain("urban");
    });
});
