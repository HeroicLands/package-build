/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **The `hm3/` half of the toolchain** (#139).
 *
 * `sohl/` was the only system half this package had, so no note could compile
 * an HM3 document however its frontmatter was written. These tests hold the
 * second half: its note-type → document-subtype map, its item vocabulary and
 * builders, its two compilers, and — the point of the exercise — the fact that
 * one note carrying both blocks becomes two documents, each shaped and stamped
 * for its own system.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import log from "loglevel";

import { defineConfig } from "../content-config.mjs";
import { configFromData } from "../engine/pack-config.mjs";
import { documentSubtype, mapsNoteType, noteTypesFor } from "../engine/document-subtypes.mjs";
import { KNOWN_DOCUMENT_SUBTYPE_MAPS } from "../engine/note-claims.mjs";
import { compilerFor } from "../engine/generate.mjs";
import { HM3_DOCUMENT_SUBTYPES } from "../hm3/document-subtypes.mjs";
import { HM3_ITEM_BUILDERS } from "../hm3/item-builders.mjs";
import { HM3_ITEM_FIELDS } from "../hm3/item-fields.mjs";
import { Hm3Items } from "../hm3/items.mjs";
import { Hm3Actors } from "../hm3/actors.mjs";
import { SOHL_DOCUMENT_SUBTYPES } from "../sohl/document-subtypes.mjs";
import { ITEM_BUILDERS } from "../sohl/item-builders.mjs";
import { Items } from "../sohl/items.mjs";
import { Actors } from "../sohl/actors.mjs";
import { resolveSchemaArtifact } from "../engine/schema-check.mjs";
import { contentPackage } from "../engine/content-package.mjs";

/* ---------------------------------------------------------------------- */
/*  The map                                                                */
/* ---------------------------------------------------------------------- */

describe("HM3_DOCUMENT_SUBTYPES — the second declaration", () => {
    it("is declared for the `hm3` system and reads the `hm3:` block", () => {
        expect(HM3_DOCUMENT_SUBTYPES.system).toBe("hm3");
        expect(HM3_DOCUMENT_SUBTYPES.block).toBe("hm3");
    });

    it("joins the maps this toolchain ships, beside SoHL's", () => {
        expect(KNOWN_DOCUMENT_SUBTYPE_MAPS).toContain(HM3_DOCUMENT_SUBTYPES);
        expect(KNOWN_DOCUMENT_SUBTYPE_MAPS).toContain(SOHL_DOCUMENT_SUBTYPES);
    });

    it("declares `being` as its one Actor row", () => {
        expect(noteTypesFor(HM3_DOCUMENT_SUBTYPES, "Actor")).toEqual(["being"]);
    });

    it("maps a note type SoHL sends nowhere — `armorlocation` is HM3-only", () => {
        expect(mapsNoteType(HM3_DOCUMENT_SUBTYPES, "armorlocation", "Item")).toBe(true);
        expect(mapsNoteType(SOHL_DOCUMENT_SUBTYPES, "armorlocation")).toBe(false);
    });

    it("maps nothing for the types HM3 has no form of", () => {
        for (const type of [
            "affiliation",
            "affliction",
            "attribute",
            "concoctiongear",
            "mystery",
        ]) {
            expect(mapsNoteType(HM3_DOCUMENT_SUBTYPES, type)).toBe(false);
            expect(mapsNoteType(SOHL_DOCUMENT_SUBTYPES, type, "Item")).toBe(true);
        }
    });

    it("declares one row per item type it builds, plus the Actor row", () => {
        expect(Object.keys(HM3_DOCUMENT_SUBTYPES.types).sort()).toEqual(
            [...Object.keys(HM3_ITEM_BUILDERS), "being"].sort(),
        );
    });

    it("renames `projectilegear` to HM3's `missilegear` — a non-identity row", () => {
        expect(documentSubtype(HM3_DOCUMENT_SUBTYPES, "projectilegear", {})).toBe("missilegear");
    });
});

/* ---------------------------------------------------------------------- */
/*  The four one-to-many rows                                              */
/* ---------------------------------------------------------------------- */

describe("the four one-to-many rows are authored, never inferred", () => {
    const ROWS: Record<string, string[]> = {
        mysticalability: ["psionic", "spell", "invocation"],
        trauma: ["injury", "trait"],
        weapongear: ["weapongear", "missilegear"],
        being: ["character", "creature"],
    };

    it("declares exactly these four, and no more", () => {
        const oneToMany = Object.entries(HM3_DOCUMENT_SUBTYPES.types)
            .filter(([, row]) => (row as any).discriminator)
            .map(([type]) => type);
        expect(oneToMany.sort()).toEqual(Object.keys(ROWS).sort());
    });

    for (const [noteType, subTypes] of Object.entries(ROWS)) {
        it(`\`${noteType}\` permits exactly ${subTypes.join("/")}`, () => {
            const row = HM3_DOCUMENT_SUBTYPES.types[noteType] as any;
            expect(row.discriminator).toBe("type");
            expect([...row.subTypes]).toEqual(subTypes);
        });

        it(`\`${noteType}\` reads its discriminator from the note's hm3: block`, () => {
            for (const subType of subTypes) {
                expect(
                    documentSubtype(HM3_DOCUMENT_SUBTYPES, noteType, { hm3: { type: subType } }),
                ).toBe(subType);
            }
        });

        it(`\`${noteType}\` is an error when the note says nothing — never a default`, () => {
            expect(() => documentSubtype(HM3_DOCUMENT_SUBTYPES, noteType, {})).toThrow(/hm3\.type/);
        });

        it(`\`${noteType}\` refuses a value the row does not permit`, () => {
            expect(() =>
                documentSubtype(HM3_DOCUMENT_SUBTYPES, noteType, { hm3: { type: "nonsense" } }),
            ).toThrow(/nonsense/);
        });

        it(`\`${noteType}\` never takes the answer from another system's block`, () => {
            expect(() =>
                documentSubtype(HM3_DOCUMENT_SUBTYPES, noteType, {
                    sohl: { type: subTypes[0] },
                    type: subTypes[0],
                }),
            ).toThrow(/hm3\.type/);
        });
    }
});

/* ---------------------------------------------------------------------- */
/*  The five shared names                                                  */
/* ---------------------------------------------------------------------- */

/** The type names both systems declare, with different data models behind them. */
const SHARED_NAMES = ["skill", "weapongear", "armorgear", "containergear", "miscgear"] as const;

describe("the five shared type names resolve through each system's own half", () => {
    it("both registries declare all five", () => {
        for (const type of SHARED_NAMES) {
            expect(Object.keys(ITEM_BUILDERS)).toContain(type);
            expect(Object.keys(HM3_ITEM_BUILDERS)).toContain(type);
        }
    });

    it("each system's builder emits its own system's field paths", () => {
        // One authored fact, two documents: both halves draw `weight` from the
        // same shared source and send it somewhere different.
        const fm = { weight: 7, value: 300, quality: 2, durability: 5 };
        for (const type of ["armorgear", "containergear", "miscgear"] as const) {
            const sohl = ITEM_BUILDERS[type].system(fm);
            const hm3 = HM3_ITEM_BUILDERS[type].system(fm);
            // SoHL stores a base value that modifiers act on; HM3 stores the
            // number itself. Same authored fact, two different field names.
            expect(sohl).toHaveProperty("weightBase", 7);
            expect(hm3).toHaveProperty("weight", 7);
            expect(hm3).not.toHaveProperty("weightBase");
            expect(sohl).not.toHaveProperty("weight");
        }
    });

    it("a skill's mastery level lands at each system's own path", () => {
        const fm = { subType: "physical", masteryLevelBase: 42, masteryLevel: 42 };
        expect(ITEM_BUILDERS.skill.system(fm)).toHaveProperty("masteryLevelBase", 42);
        expect(HM3_ITEM_BUILDERS.skill.system(fm)).toHaveProperty("masteryLevel", 42);
    });

    it("emits no field the receiving system's schema does not declare", () => {
        // The whole point of the criterion: a coincidence of names must not
        // produce a document shaped for the other system. Read against each
        // system's *own* published field paths.
        for (const type of SHARED_NAMES) {
            const hm3Paths = new Set(HM3_ITEM_FIELDS[type].map((f: any) => f.to).filter(Boolean));
            const sohlPaths = new Set(
                (ITEM_BUILDERS[type].fields ?? []).map((f: any) => f.to).filter(Boolean),
            );
            // `weight`/`value`/`quantity` are HM3's spellings and are not SoHL's;
            // `weightBase` and friends are SoHL's and are not HM3's.
            for (const p of hm3Paths) {
                if (p === "quantity") continue; // the one path both declare
                expect(sohlPaths.has(p)).toBe(false);
            }
        }
    });
});

/* ---------------------------------------------------------------------- */
/*  The registry and the compilers are reachable by name                   */
/* ---------------------------------------------------------------------- */

describe("a data configuration can name the hm3 registry", () => {
    function configWith(itemBuilders: unknown) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-hm3-cfg-"));
        fs.writeFileSync(
            path.join(root, "package.json"),
            JSON.stringify({ name: "harnensemble", version: "1.2.3" }),
        );
        const cfg = configFromData(
            {
                contentPackage: "harnensemble",
                packageKind: "modules",
                compatibility: { minimum: "14", verified: "14.367" },
                stats: { lastModifiedBy: "hm3testbuild00000" },
                itemBuilders,
                packs: [{ name: "items", type: "Item" }],
            },
            path.join(root, "package-build.config.yaml"),
        );
        fs.rmSync(root, { recursive: true, force: true });
        return cfg;
    }

    it("resolves `hm3` on its own", () => {
        const config = configWith("hm3") as any;
        expect(Object.keys(config.itemBuilders)).toContain("armorlocation");
    });

    it("resolves both halves, keeping each system's table apart", () => {
        const config = configWith(["sohl", "hm3"]) as any;
        expect(Object.keys(config.itemBuildersBySystem).sort()).toEqual(["hm3", "sohl"]);
        for (const type of SHARED_NAMES) {
            expect(config.itemTypesBySeveralSystems.has(type)).toBe(true);
            expect(config.itemBuildersBySystem.sohl[type]).not.toBe(
                config.itemBuildersBySystem.hm3[type],
            );
        }
    });
});

describe("compilerFor — the pass a pack of one system gets", () => {
    it("gives a SoHL pack SoHL's compilers", () => {
        expect(compilerFor("Item", "sohl")).toBe(Items);
        expect(compilerFor("Actor", "sohl")).toBe(Actors);
    });

    it("gives an HM3 pack HM3's compilers", () => {
        expect(compilerFor("Item", "hm3")).toBe(Hm3Items);
        expect(compilerFor("Actor", "hm3")).toBe(Hm3Actors);
    });

    it("keeps SoHL's compilers as the answer for a system-neutral pack", () => {
        expect(compilerFor("Item", null)).toBe(Items);
        expect(compilerFor("JournalEntry", "hm3")).toBe(compilerFor("JournalEntry", null));
    });

    it("has no compiler for a document type nothing compiles", () => {
        expect(compilerFor("Adventure", "hm3")).toBeUndefined();
    });
});

/* ---------------------------------------------------------------------- */
/*  Per-system schema resolution                                           */
/* ---------------------------------------------------------------------- */

describe("resolveSchemaArtifact — whose schema a pack is checked against", () => {
    function repoWithSchemas() {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-hm3-schema-"));
        for (const [system, version, sub, field] of [
            ["sohl", "0.9.0", "skill", "masteryLevelBase"],
            ["hm3", "1.6.3", "skill", "masteryLevel"],
        ] as const) {
            const dir = path.join(root, "build", "deps", `${system}@${version}`);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(
                path.join(dir, "schema.json"),
                JSON.stringify({
                    version: 1,
                    system,
                    systemVersion: version,
                    documents: { Item: { [sub]: { own: [field], inherited: [] } } },
                }),
            );
        }
        return root;
    }

    it("reads each declared system's own artifact", () => {
        const root = repoWithSchemas();
        const config = {
            rootDir: root,
            packageKind: "modules",
            foundryPackage: "harnensemble",
            paths: { foreignCache: path.join(root, "build", "deps") },
            stats: { systemId: null, systemVersion: null },
            systems: {
                sohl: { compatibility: { verified: "0.9.0" } },
                hm3: { compatibility: { verified: "1.6.3" } },
            },
        } as never;

        expect(resolveSchemaArtifact(config, "sohl")?.artifact.system).toBe("sohl");
        expect(resolveSchemaArtifact(config, "hm3")?.artifact.system).toBe("hm3");
        // And the fields really are different, which is the point.
        expect(resolveSchemaArtifact(config, "hm3")?.artifact.documents.Item.skill.own).toEqual([
            "masteryLevel",
        ]);
        fs.rmSync(root, { recursive: true, force: true });
    });
});

/* ---------------------------------------------------------------------- */
/*  One note, two documents                                                */
/* ---------------------------------------------------------------------- */

/**
 * The dual-system cases run the compile in a **child process**, against a
 * configuration on disk.
 *
 * Not for isolation: the item registry, the pack router and the `_stats` stamp
 * are read through `loadPackConfig()`, which resolves the *one* configuration a
 * process was started with. Handing `generatePacksJson` a constructed config
 * moves the paths and nothing else — the builders and the `systems:` block
 * still come from the ambient one — so a two-registry build compiled in this
 * process would silently use the fixture repository's single `sohl` registry,
 * which is exactly the wrong-system emission these cases exist to disprove.
 * `PACKAGE_BUILD_CONFIG` names the configuration, so a child process is how a
 * second one is posed.
 */

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * The two systems' published field sets, as `content-build deps fetch` caches
 * them — the artifact the schema check reads (#60).
 *
 * Deliberately small and deliberately *different*: each declares only what its
 * own compiler emits for a `containergear`, so a path belonging to the other
 * system is undeclared here exactly as it is undeclared in the real thing.
 */
const SCHEMAS: Record<string, { version: string; own: string[] }> = {
    sohl: {
        version: "0.9.0",
        own: [
            "shortcode",
            "archetype",
            "actionDefs",
            "notes",
            "docHtml",
            "quantity",
            "weightBase",
            "valueBase",
            "qualityBase",
            "durabilityBase",
            "sharedWithCohortIds",
            "containerId",
            "isCarried",
            "maxCapacityBase",
        ],
    },
    hm3: {
        version: "1.6.3",
        own: ["description", "notes", "quantity", "value", "weight", "capacity", "capacity.max"],
    },
};

/** A throwaway repository: a dual-system configuration and a content tree. */
function dualRepo(notes: Record<string, string>, { schemas = false } = {}): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-hm3-tree-"));
    fs.mkdirSync(path.join(root, "assets", "content"), { recursive: true });
    if (schemas) {
        for (const [system, { version, own }] of Object.entries(SCHEMAS)) {
            const dir = path.join(root, "build", "cache", "foreign", `${system}@${version}`);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(
                path.join(dir, "schema.json"),
                JSON.stringify({
                    version: 1,
                    system,
                    systemVersion: version,
                    documents: { Item: { containergear: { own, inherited: [] } } },
                }),
            );
        }
    }
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "harnensemble", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(root, "package-build.config.yaml"),
        `contentPackage: harnensemble
packageKind: modules
compatibility:
    minimum: "14"
    verified: "14.367"
stats:
    lastModifiedBy: hm3testbuild00000
systems:
    sohl:
        compatibility: { verified: "0.9.0" }
    hm3:
        compatibility: { verified: "1.6.3" }
itemBuilders: [sohl, hm3]
packs:
    - { name: items-sohl, label: SoHL Items, type: Item, system: sohl, default: true }
    - { name: items-hm3, label: HM3 Items, type: Item, system: hm3 }
    - { name: actors-sohl, label: SoHL Actors, type: Actor, system: sohl, default: true }
    - { name: actors-hm3, label: HM3 Actors, type: Actor, system: hm3 }
    - { name: journals, label: Journals, type: JournalEntry }
`,
    );
    for (const [file, text] of Object.entries(notes)) {
        const full = path.join(root, "assets", "content", file);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, text);
    }
    return root;
}

/** Compile a fixture repository, and report the error count and what it said. */
function compile(root: string): { errors: number; output: string } {
    const script = `
        const log = (await import(${JSON.stringify(pathToFileURL(path.join(PKG_ROOT, "node_modules/loglevel/lib/loglevel.js")).href)})).default;
        log.setLevel("error");
        const { generatePacksJson } = await import(${JSON.stringify(
            pathToFileURL(path.join(PKG_ROOT, "engine/generate.mjs")).href,
        )});
        process.exitCode = 0;
        console.log("ERRORS=" + (await generatePacksJson()));
    `;
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        cwd: root,
        env: { ...process.env, PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml") },
        encoding: "utf8",
    });
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    const matched = output.match(/ERRORS=(\d+)/);
    return { errors: matched ? Number(matched[1]) : Number.NaN, output };
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

const SWORD = `---
name:
  full: Broadsword
id: AAAAAAAAAAAAAAAA
shortcode: broadsword
type: weapongear
weight: 5
value: 400
sohl:
  pack: items-sohl
  archetype: null
hm3:
  pack: items-hm3
  type: weapongear
---

A soldier's blade.
`;

const KNIGHT = `---
name:
  full: Sir Aldric
id: BBBBBBBBBBBBBBBB
shortcode: aldric
type: being
species: human
gender: male
occupation: Knight
sohl:
  pack: actors-sohl
  archetype: null
hm3:
  pack: actors-hm3
  type: character
  system:
    sunsign: ulandus
---

# Appearance {#appearance}

Tall and scarred.
`;

const roots: string[] = [];
beforeAll(() => log.setLevel("silent"));
afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    log.setLevel("warn");
});

describe("one note carrying both blocks compiles a document in each system", () => {
    let root: string;
    let result: { errors: number; output: string };

    beforeAll(() => {
        root = dualRepo({ "Broadsword.md": SWORD, "Aldric.md": KNIGHT });
        roots.push(root);
        result = compile(root);
    });

    it("compiles without error", () => {
        expect(result.output.replace(/ERRORS=\d+/, "")).not.toMatch(/error/i);
        expect(result.errors).toBe(0);
    });

    it("puts a SoHL weapongear in the SoHL pack and an HM3 one in HM3's", () => {
        expect(packDocs(root, "items-sohl").Broadsword.type).toBe("weapongear");
        expect(packDocs(root, "items-hm3").Broadsword.type).toBe("weapongear");
    });

    it("shapes each item for its own system's data model", () => {
        const sohl = packDocs(root, "items-sohl").Broadsword.system;
        const hm3 = packDocs(root, "items-hm3").Broadsword.system;
        expect(sohl.weightBase).toBe(5);
        expect(hm3.weight).toBe(5);
        expect(hm3.weightBase).toBeUndefined();
        expect(sohl.weight).toBeUndefined();
        // And the keys only one system's compiler writes stay on its side.
        expect(sohl.docHtml).toContain("@UUID[");
        expect(hm3.docHtml).toBeUndefined();
        expect(hm3.strikeModes).toBeUndefined();
    });

    it("gives each item its own system's default art", () => {
        expect(packDocs(root, "items-sohl").Broadsword.img).toMatch(/^systems\/sohl\//);
        expect(packDocs(root, "items-hm3").Broadsword.img).toMatch(/^systems\/hm3\//);
    });

    it("stamps each document for its own system", () => {
        expect(packDocs(root, "items-sohl").Broadsword._stats).toMatchObject({
            systemId: "sohl",
            systemVersion: "0.9.0",
        });
        expect(packDocs(root, "items-hm3").Broadsword._stats).toMatchObject({
            systemId: "hm3",
            systemVersion: "1.6.3",
        });
    });

    it("compiles the being into a SoHL `being` and an HM3 `character`", () => {
        expect(packDocs(root, "actors-sohl")["Sir Aldric"].type).toBe("being");
        expect(packDocs(root, "actors-hm3")["Sir Aldric"].type).toBe("character");
    });

    it("writes each actor's shared facts at its own system's paths", () => {
        const hm3 = packDocs(root, "actors-hm3")["Sir Aldric"].system;
        expect(hm3.species).toBe("human");
        expect(hm3.gender).toBe("male");
        expect(hm3.occupation).toBe("Knight");
        // `{#appearance}` is HM3's `description`, and SoHL's `appearance`.
        expect(hm3.description).toContain("Tall and scarred");
        expect(packDocs(root, "actors-sohl")["Sir Aldric"].system.appearance).toContain(
            "Tall and scarred",
        );
        // And what the note authored under `hm3.system` passes straight through.
        expect(hm3.sunsign).toBe("ulandus");
    });

    it("still compiles the item note's prose into the one JournalEntry pack", () => {
        // A being's prose is rendered into the actor itself — `{#appearance}`
        // and `{#dossier}` are actor fields — so a `being` carries no item doc
        // and the journals pass claims only the item note.
        expect(Object.keys(packDocs(root, "journals"))).toEqual(["Broadsword"]);
    });
});

describe("a note carrying only one block compiles only that system's document", () => {
    it("is passed over by the other system's pass rather than failed", () => {
        const root = dualRepo({
            "Bag.md": `---
name:
  full: Belt Pouch
id: CCCCCCCCCCCCCCCC
shortcode: beltpouch
type: containergear
weight: 1
capacity: 10
hm3:
  pack: items-hm3
---

A small pouch.
`,
            // Each pack must compile something, so the dual notes come along.
            "Sword.md": SWORD,
            "Aldric.md": KNIGHT,
        });
        roots.push(root);
        const result = compile(root);
        expect(result.output.replace(/ERRORS=\d+/, "")).not.toMatch(/error/i);
        expect(result.errors).toBe(0);
        expect(Object.keys(packDocs(root, "items-hm3")).sort()).toEqual([
            "Belt Pouch",
            "Broadsword",
        ]);
        expect(Object.keys(packDocs(root, "items-sohl"))).toEqual(["Broadsword"]);
        expect(packDocs(root, "items-hm3")["Belt Pouch"].system.capacity.max).toBe(10);
    });
});

describe("a one-to-many note that says nothing fails, naming the note", () => {
    it("reports `hm3.type` rather than guessing a subtype", () => {
        const root = dualRepo({
            "Sword.md": SWORD,
            "Aldric.md": KNIGHT,
            "Mystery.md": `---
name:
  full: Second Sight
id: DDDDDDDDDDDDDDDD
shortcode: secondsight
type: mysticalability
sohl:
  pack: items-sohl
  archetype: null
  subType: arcanetalent
hm3:
  pack: items-hm3
---

Seeing what is not there.
`,
        });
        roots.push(root);
        const result = compile(root);
        expect(result.errors).toBeGreaterThan(0);
        expect(result.output).toMatch(/hm3\.type/);
        expect(result.output).toMatch(/psionic/);
        // And the SoHL half of the same note still compiled.
        expect(Object.keys(packDocs(root, "items-sohl")).sort()).toEqual([
            "Broadsword",
            "Second Sight",
        ]);
    });
});

describe("each system's documents are field-checked against its own schema", () => {
    /**
     * The fourth acceptance criterion of #139, and the one a coincidence of
     * names hides in: `containergear` exists in both systems with different
     * data models, so the only thing that can tell a right emission from a
     * wrong one is *whose* schema it is read against.
     */
    function pouch(sohlSystem: string, hm3System: string): string {
        return `---
name:
  full: Belt Pouch
id: EEEEEEEEEEEEEEEE
shortcode: beltpouch
type: containergear
weight: 1
capacity: 10
maxCapacity: 10
sohl:
  pack: items-sohl
  archetype: null
${sohlSystem}
hm3:
  pack: items-hm3
${hm3System}
---

A small pouch.
`;
    }

    it("passes when each block authors its own system's paths", () => {
        const root = dualRepo({ "Bag.md": pouch("", ""), "Aldric.md": KNIGHT }, { schemas: true });
        roots.push(root);
        const result = compile(root);
        expect(result.output.replace(/ERRORS=\d+/, "")).not.toMatch(/error/i);
        expect(result.errors).toBe(0);
    });

    it("reports a SoHL path authored in the `hm3:` block", () => {
        const root = dualRepo(
            { "Bag.md": pouch("", "  system:\n    weightBase: 1"), "Aldric.md": KNIGHT },
            { schemas: true },
        );
        roots.push(root);
        const result = compile(root);
        expect(result.errors).toBeGreaterThan(0);
        expect(result.output).toMatch(/hm3\.system\.weightBase/);
        expect(result.output).toMatch(/1\.6\.3/);
    });

    it("reports an HM3 path authored in the `sohl:` block", () => {
        const root = dualRepo(
            { "Bag.md": pouch("  system:\n    weight: 1", ""), "Aldric.md": KNIGHT },
            { schemas: true },
        );
        roots.push(root);
        const result = compile(root);
        expect(result.errors).toBeGreaterThan(0);
        expect(result.output).toMatch(/sohl\.system\.weight/);
        expect(result.output).toMatch(/0\.9\.0/);
    });
});

/* ---------------------------------------------------------------------- */
/*  Content-package hygiene                                                */
/* ---------------------------------------------------------------------- */

describe("the hm3 half stays a half", () => {
    it("never imports out of `sohl/`", () => {
        const dir = path.join(path.dirname(path.dirname(new URL(import.meta.url).pathname)), "hm3");
        for (const file of fs.readdirSync(dir)) {
            if (!file.endsWith(".mjs")) continue;
            const text = fs.readFileSync(path.join(dir, file), "utf8");
            expect(text, `${file} imports from sohl/`).not.toMatch(/from\s+["']\.\.\/sohl\//);
        }
    });

    it("is exported under its own subpath, as `sohl/` is", () => {
        const pkg = JSON.parse(
            fs.readFileSync(
                path.join(
                    path.dirname(path.dirname(new URL(import.meta.url).pathname)),
                    "package.json",
                ),
                "utf8",
            ),
        );
        expect(pkg.exports["./hm3"]).toBeTruthy();
        expect(pkg.exports["./hm3/*"]).toBeTruthy();
        expect(pkg.files).toContain("hm3");
    });

    it("keeps `contentPackage()` untouched", () => {
        expect(typeof contentPackage()).toBe("string");
    });
});
