/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Compile order is derived from what each pass reads, not from the order
 * `packs:` happens to declare (#73).
 *
 * The actors pass resolves each being's embedded items against the *output* of
 * the item passes, so a package declaring its Actor pack first used to compile
 * only when `build/packs-json` already held a previous run's items — green on a
 * warm tree, exit 1 on a cold one, and `build/` is gitignored so every fresh
 * checkout and every CI runner is cold. `sohl-kethira-basic` shipped exactly
 * that list, which is the scenario below.
 *
 * The same list is also the manifest's `packs` array, so a consumer has
 * presentation reasons to order it however it likes; the two must therefore be
 * allowed to disagree.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import log from "loglevel";

import { defineConfig } from "../content-config.mjs";
import { generatePacksJson, orderPassesByDependency } from "../engine/generate.mjs";
import { contentPackage } from "../engine/content-package.mjs";

/* ---------------------------------------------------------------------- */
/*  Fixtures                                                               */
/* ---------------------------------------------------------------------- */

/** A complete configuration with the given packs, rooted at `rootDir`. */
function baseConfig({ packs, rootDir = os.tmpdir() }: any) {
    return defineConfig({
        compatibility: { minimum: "14.359", verified: "14.359" },
        rootDir,
        contentPackage: contentPackage(),
        foundryPackage: "sohl",
        packageKind: "systems",
        stats: {
            lastModifiedBy: "sohltestbuild0000",
        },
        packs,
    } as any);
}

/**
 * The pack list `sohl-kethira-basic` shipped: the Actor pack **first**, then
 * the two Item packs its beings resolve against.
 */
const ACTOR_FIRST = [
    { name: "characters", type: "Actor" },
    { name: "characteristics", type: "Item", default: true },
    { name: "mysteries", type: "Item" },
    { name: "journals", type: "JournalEntry" },
];

/** One skill note, in the tree's shape. */
function skillNote(
    name: string,
    id: string,
    shortcode: string,
    extra: Record<string, unknown> = {},
): string {
    const head = Object.entries(extra)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
    return `---
name:
  full: ${name}
id: ${id}
shortcode: ${shortcode}
type: skill
${head}
sohl:
  archetype: null
  subType: physical
  skillBaseFormula: "sb(attr.str)"
  combatCategory: none
  parentSkillCode: ""
  initSkillMult: 0
  masteryLevelBase: null
  improveFlag: false
---

Prose for ${name}.
`;
}

/** One being note, naming an embedded item by `(type, shortcode)`. */
const BEING = `---
name:
  full: Hill Bandit
id: DDDDDDDDDDDDDDDD
shortcode: hillbandit
type: being
sohl:
  archetype: null
  items:
    - { type: skill, shortcode: climbing }
---

# Appearance

A bandit.
`;

/** A throwaway repository root: a content tree plus a manifest template. */
function repo(notes: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pkgbuild-passorder-"));
    fs.mkdirSync(path.join(root, "assets", "content"), { recursive: true });
    fs.mkdirSync(path.join(root, "assets", "templates"), { recursive: true });
    fs.writeFileSync(
        path.join(root, "assets", "templates", "system.template.json"),
        JSON.stringify({ id: "sohl", compatibility: { minimum: "14" } }),
    );
    for (const [file, text] of Object.entries(notes)) {
        fs.writeFileSync(path.join(root, "assets", "content", file), text);
    }
    return root;
}

/** Every compiled document in a pack's JSON directory, by name. */
function packDocs(root: string, pack: string): Record<string, any> {
    const dir = path.join(root, "build", "packs-json", pack);
    const out: Record<string, any> = {};
    if (!fs.existsSync(dir)) return out;
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".json") || file.startsWith("folder_")) continue;
        const doc = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
        out[doc.name] = doc;
    }
    return out;
}

/** The tree every end-to-end case below compiles. */
const NOTES = {
    "Climbing.md": skillNote("Climbing", "AAAAAAAAAAAAAAAA", "climbing"),
    "SecondSight.md": skillNote("Second Sight", "BBBBBBBBBBBBBBBB", "secondsight", {
        pack: "mysteries",
    }),
    "HillBandit.md": BEING,
};

const roots: string[] = [];
beforeAll(() => log.setLevel("silent"));
afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    log.setLevel("warn");
});

/* ---------------------------------------------------------------------- */
/*  The ordering, on its own                                               */
/* ---------------------------------------------------------------------- */

describe("orderPassesByDependency — a pass runs after the output it reads", () => {
    const names = (packs: any[]) => packs.map((pack) => pack.name);

    it("moves an Actor pack declared first after every Item pack", () => {
        // And no further: `journals` waits on nothing, so it keeps its place
        // behind the pass that had to move ahead of it.
        const packs = baseConfig({ packs: ACTOR_FIRST }).packs;
        expect(names(orderPassesByDependency(packs))).toEqual([
            "characteristics",
            "mysteries",
            "characters",
            "journals",
        ]);
    });

    it("leaves a list already in dependency order exactly as declared", () => {
        // SoHL's own shape, and the point of the smallest-reordering rule: the
        // Actor pass is neither pulled forward nor pushed to the end, because
        // where it sits already works.
        const packs = baseConfig({
            packs: [
                { name: "items", type: "Item" },
                { name: "journals", type: "JournalEntry" },
                { name: "actors", type: "Actor" },
                { name: "macros", type: "Macro" },
            ],
        }).packs;
        expect(names(orderPassesByDependency(packs))).toEqual([
            "items",
            "journals",
            "actors",
            "macros",
        ]);
    });

    it("waits for every Item pack, not merely the first", () => {
        // A being names an item by `(type, shortcode)` and never by the pack it
        // ships in, so an actors pass scheduled after only some of them would
        // resolve some beings and fail others.
        const packs = baseConfig({
            packs: [
                { name: "characteristics", type: "Item", default: true },
                { name: "characters", type: "Actor" },
                { name: "mysteries", type: "Item" },
            ],
        }).packs;
        expect(names(orderPassesByDependency(packs))).toEqual([
            "characteristics",
            "mysteries",
            "characters",
        ]);
    });

    it("keeps the declared order among packs that wait on nothing", () => {
        const packs = baseConfig({
            packs: [
                { name: "journals", type: "JournalEntry" },
                { name: "mysteries", type: "Item" },
                { name: "characteristics", type: "Item", default: true },
                { name: "macros", type: "Macro" },
            ],
        }).packs;
        expect(names(orderPassesByDependency(packs))).toEqual([
            "journals",
            "mysteries",
            "characteristics",
            "macros",
        ]);
    });

    it("does not reorder the declared list itself — the manifest reads that one", () => {
        const config = baseConfig({ packs: ACTOR_FIRST });
        orderPassesByDependency(config.packs);
        expect(names(config.packs)).toEqual([
            "characters",
            "characteristics",
            "mysteries",
            "journals",
        ]);
        expect([...config.packDirectories]).toEqual([
            "characters",
            "characteristics",
            "mysteries",
            "journals",
        ]);
    });

    it("orders a single pack, and a list with nothing to wait for", () => {
        const one = baseConfig({ packs: [{ name: "actors", type: "Actor" }] });
        expect(names(orderPassesByDependency(one.packs))).toEqual(["actors"]);
    });
});

/* ---------------------------------------------------------------------- */
/*  The pipeline, on a cold tree                                           */
/* ---------------------------------------------------------------------- */

describe("generatePacksJson — Actor pack declared first, cold build/", () => {
    let root: string;
    let errors: number;

    beforeAll(async () => {
        root = repo(NOTES);
        roots.push(root);
        // No prior run: `build/packs-json` does not exist, which is the state
        // of every fresh checkout and every CI runner.
        expect(fs.existsSync(path.join(root, "build"))).toBe(false);
        errors = await generatePacksJson({
            config: baseConfig({ rootDir: root, packs: ACTOR_FIRST }),
        });
    });

    it("compiles without error", () => {
        expect(errors).toBe(0);
    });

    it("resolves the being's embedded item against the items pass's output", () => {
        const bandit = packDocs(root, "characters")["Hill Bandit"];
        expect(bandit).toBeTruthy();
        expect(bandit.items).toHaveLength(1);
        expect(bandit.items[0].name).toBe("Climbing");
        expect(bandit.items[0].system.shortcode).toBe("climbing");
    });

    it("still routes each item note to the pack it belongs in", () => {
        expect(Object.keys(packDocs(root, "characteristics"))).toEqual(["Climbing"]);
        expect(Object.keys(packDocs(root, "mysteries"))).toEqual(["Second Sight"]);
    });
});

describe("generatePacksJson — the same tree, packs declared in dependency order", () => {
    it("compiles the identical documents", async () => {
        const declared = repo(NOTES);
        const derived = repo(NOTES);
        roots.push(declared, derived);
        const [a, b] = [
            await generatePacksJson({
                config: baseConfig({ rootDir: declared, packs: ACTOR_FIRST }),
            }),
            await generatePacksJson({
                config: baseConfig({
                    rootDir: derived,
                    packs: [
                        {
                            name: "characteristics",
                            type: "Item",
                            default: true,
                        },
                        { name: "mysteries", type: "Item" },
                        { name: "journals", type: "JournalEntry" },
                        { name: "characters", type: "Actor" },
                    ],
                }),
            }),
        ];
        expect([a, b]).toEqual([0, 0]);
        for (const pack of ["characters", "characteristics", "mysteries", "journals"]) {
            expect(packDocs(declared, pack)).toEqual(packDocs(derived, pack));
        }
    });
});

/* ---------------------------------------------------------------------- */
/*  What ordering cannot fix: one pass, named on its own                   */
/* ---------------------------------------------------------------------- */

describe("generatePacksJson — one Actor pack named on its own, cold build/", () => {
    it("names the pack it waits on rather than a missing directory", async () => {
        const root = repo(NOTES);
        roots.push(root);
        const messages: string[] = [];
        const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
            messages.push(args.join(" "));
        });
        let errors: number;
        try {
            errors = await generatePacksJson({
                only: "characters",
                config: baseConfig({ rootDir: root, packs: ACTOR_FIRST }),
            });
        } finally {
            spy.mockRestore();
        }
        expect(errors).toBeGreaterThan(0);
        const reported = messages.filter((m) => m.includes('"characters"'));
        // One per Item pack that is missing, not just the first: naming only
        // one would send the reader round the loop twice.
        expect(reported).toHaveLength(2);
        // A build diagnostic, in this project's parseable form. No locator:
        // there is no source file to point at, and a guessed one is worse than
        // none.
        for (const line of reported) expect(line).toMatch(/^error: /);
        // It names the pack that waits, the pack it waits on, and the fix.
        expect(reported[0]).toContain('"characteristics"');
        expect(reported[1]).toContain('"mysteries"');
        expect(reported.join("\n")).not.toContain("actors must be generated after");
    });

    it("compiles one Item pack on its own without complaint", async () => {
        const root = repo(NOTES);
        roots.push(root);
        const errors = await generatePacksJson({
            only: "characteristics",
            config: baseConfig({ rootDir: root, packs: ACTOR_FIRST }),
        });
        expect(errors).toBe(0);
        expect(Object.keys(packDocs(root, "characteristics"))).toEqual(["Climbing"]);
    });
});
