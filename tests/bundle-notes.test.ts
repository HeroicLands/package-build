/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `type: bundle` → Foundry's `Adventure`.
 *
 * The specification declares the type and leaves it uncompiled, recording the
 * two decisions that had to come first. Both are evidenced here.
 *
 * **Which pack.** Not the `adventures` companion the scenes pass writes — a
 * companion is written by another pack's pass, and the router refuses a note
 * that addresses one. A bundle lands in an ordinary Adventure pack, routed and
 * defaulted like any other note, and a repository that configures none is told
 * so by name.
 *
 * **What a `contents` address names.** The note's *own* document, which is
 * already the router's rule for `pack:`. A note that compiles into two — an
 * item and the JournalEntry its prose became — puts the second in a bundle only
 * when the bundle names it by its own `doc…` address.
 *
 * And the property that makes either answer usable: an Adventure carries
 * **copies**, so `contents` resolves against compiled output, which means this
 * pass runs after the passes producing what it bundles. That ordering is
 * *stated* — `Bundles.readsPackOutputOf` — rather than left to the order a
 * consumer happened to write its pack list in.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

import { describe, it, expect, afterAll } from "vitest";

import {
    ADVENTURE_CONTENT_FIELD,
    BUNDLE_TYPE,
    bareAddress,
    buildAdventure,
    bundleContents,
    missingMemberVerdict,
    stripAdventureKeys,
} from "../engine/bundle-notes.mjs";
import { Bundles } from "../engine/bundles.mjs";
import { BasePackCompiler } from "../engine/base-compiler.mjs";
import { orderPassesByDependency } from "../engine/generate.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { packForType } from "../engine/ids.mjs";

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* ---------------------------------------------------------------------- */
/*  What a bundle note says                                                */
/* ---------------------------------------------------------------------- */

describe("bundleContents — the addresses a bundle names", () => {
    it("reads the `data:` list the specification puts it in", () => {
        expect(bundleContents({ data: { contents: ["scene-vale", "miscgear-bowl"] } })).toEqual([
            "scene-vale",
            "miscgear-bowl",
        ]);
    });

    it("reads a top-level list too, as a folder note's `parent` is read", () => {
        // The shipped example writes `contents:` under `data:`, and an author
        // following the issue rather than the specification should still get a
        // bundle rather than a silently empty one.
        expect(bundleContents({ contents: ["doc-combat"] })).toEqual(["doc-combat"]);
    });

    it("prefers the `data:` list where a note writes both", () => {
        expect(bundleContents({ data: { contents: ["a-one"] }, contents: ["b-two"] })).toEqual([
            "a-one",
        ]);
    });

    it("reports nothing for a note that names none", () => {
        expect(bundleContents({})).toEqual([]);
        expect(bundleContents({ data: {} })).toEqual([]);
    });

    it("refuses a scalar rather than reading it as a bundle of one", () => {
        expect(() => bundleContents({ data: { contents: "scene-vale" } })).toThrow(
            /list of addresses/,
        );
    });

    it("accepts the bracketed spelling, and drops a label", () => {
        expect(bareAddress("[[miscgear-bowl|A Bowl]]")).toBe("miscgear-bowl");
        expect(bareAddress("  scene-vale  ")).toBe("scene-vale");
        expect(bareAddress("")).toBeNull();
        expect(bareAddress(null)).toBeNull();
    });

    it("keeps the author's order, so one tree compiles to the same bytes", () => {
        const addresses = ["scene-c", "miscgear-a", "doc-b"];
        expect(bundleContents({ data: { contents: addresses } })).toEqual(addresses);
    });
});

/* ---------------------------------------------------------------------- */
/*  What an Adventure is                                                   */
/* ---------------------------------------------------------------------- */

describe("buildAdventure — compiled documents becoming an installer", () => {
    const stats = { systemId: "sohl" };

    it("files each member under the content field its document class maps to", () => {
        const adventure = buildAdventure({
            id: "bundle0000000001",
            name: "The Vale",
            stats,
            contents: [
                { docType: "Item", document: { _id: "i1", name: "Bowl" } },
                { docType: "Scene", document: { _id: "s1", name: "Vale" } },
                { docType: "JournalEntry", document: { _id: "j1", name: "Notes" } },
            ],
        });

        expect(adventure.items).toEqual([{ _id: "i1", name: "Bowl" }]);
        expect(adventure.scenes).toEqual([{ _id: "s1", name: "Vale" }]);
        // Foundry calls the JournalEntry field `journal`, singular, which is
        // the one name in `contentFields` that is not the plural collection.
        expect(adventure.journal).toEqual([{ _id: "j1", name: "Notes" }]);
    });

    it("writes every content field, so two Adventures are diffable", () => {
        const adventure = buildAdventure({ id: "x", name: "Empty", stats });
        for (const field of Object.values(ADVENTURE_CONTENT_FIELD)) {
            expect(adventure[field], field).toEqual([]);
        }
    });

    it("keys the record by the Foundry collection, not by the pack", () => {
        // A pack directory may be called anything; the LevelDB key
        // names the collection the record belongs to inside it.
        expect(buildAdventure({ id: "abc", name: "A", stats })._key).toBe("!adventures!abc");
    });

    it("refuses a document class an Adventure cannot hold", () => {
        expect(() =>
            buildAdventure({
                id: "x",
                name: "A",
                stats,
                contents: [{ docType: "ChatMessage", document: {} }],
            }),
        ).toThrow(/cannot hold ChatMessage/);
    });

    it("strips the LevelDB key from every member, at every depth", () => {
        // An Adventure's members are inline source data in a `SetField`, not
        // sublevel documents, so Foundry's schema has no field to hold a key.
        const adventure = buildAdventure({
            id: "x",
            name: "A",
            stats,
            contents: [
                {
                    docType: "JournalEntry",
                    document: {
                        _id: "j1",
                        _key: "!journal!j1",
                        pages: [{ _id: "p1", _key: "!journal.pages!j1.p1" }],
                    },
                },
            ],
        });

        expect(JSON.stringify(adventure)).not.toContain('_key":"!journal');
        expect(adventure.journal[0].pages[0]._key).toBeUndefined();
    });

    it("leaves a scalar alone when stripping", () => {
        expect(stripAdventureKeys("text")).toBe("text");
        expect(stripAdventureKeys(3)).toBe(3);
        expect(stripAdventureKeys(null)).toBeNull();
    });
});

/* ---------------------------------------------------------------------- */
/*  Which system's documents an Adventure may hold                         */
/* ---------------------------------------------------------------------- */

describe("missingMemberVerdict — the pack's system constrains the contents", () => {
    it("leaves a member out where the pack declares a system", () => {
        // A pack declaring a system reads that system's packs and the neutral
        // ones, so a member it cannot see is one the note publishes for another
        // system — which is a fact about the tree, not an error in it.
        expect(missingMemberVerdict("sohl")).toBe("omit");
        expect(missingMemberVerdict("hm3")).toBe("omit");
    });

    it("fails where it declares none, since nothing was scoped away", () => {
        // Every single-system build. There is no other system for the member to
        // have gone to, so its absence is a dead address and nothing else.
        expect(missingMemberVerdict(null)).toBe("fail");
        expect(missingMemberVerdict(undefined)).toBe("fail");
        expect(missingMemberVerdict("")).toBe("fail");
    });
});

/* ---------------------------------------------------------------------- */
/*  The pass, and where it sits                                            */
/* ---------------------------------------------------------------------- */

describe("the bundles pass", () => {
    it("is a BasePackCompiler that claims bundle notes and nothing else", () => {
        expect(Object.create(Bundles.prototype)).toBeInstanceOf(BasePackCompiler);
        const pass = Object.create(Bundles.prototype);
        expect(pass.selects({ type: BUNDLE_TYPE })).toBe(true);
        expect(pass.selects({ type: "miscgear" })).toBe(false);
    });

    it("routes a bundle to an Adventure pack, conventionally `adventures`", () => {
        expect(packForType(BUNDLE_TYPE)).toEqual({ pack: "adventures", docType: "Adventure" });
    });

    it("is still the type the published format declares", () => {
        expect(Object.hasOwn(NOTE_VOCABULARY, BUNDLE_TYPE)).toBe(true);
    });

    it("states that it reads every pass producing what it can hold", () => {
        // The acceptance criterion in as many words: the ordering is *stated*,
        // not assumed. Everything an Adventure can hold and this build compiles.
        expect([...Bundles.readsPackOutputOf].sort()).toEqual([
            "Actor",
            "Item",
            "JournalEntry",
            "Macro",
            "Scene",
        ]);
        for (const docType of Bundles.readsPackOutputOf) {
            expect(ADVENTURE_CONTENT_FIELD[docType], docType).toBeTruthy();
        }
    });

    it("compiles last, whatever order the pack list declares it in", () => {
        const declared = [
            { name: "bundles", type: "Adventure" },
            { name: "actors", type: "Actor" },
            { name: "items", type: "Item" },
            { name: "journals", type: "JournalEntry" },
        ];
        const ordered = orderPassesByDependency(declared).map((pack) => pack.name);

        expect(ordered[ordered.length - 1]).toBe("bundles");
        // The reordering is the smallest one that works: an Actor pack still
        // follows the Item packs it resolves embedded items against.
        expect(ordered.indexOf("items")).toBeLessThan(ordered.indexOf("actors"));
    });
});

/* ---------------------------------------------------------------------- */
/*  Through a real compile                                                 */
/* ---------------------------------------------------------------------- */

/** A `miscgear` item note — the everyday member of a bundle. */
const gear = (name: string, code: string) => `---
name:
  full: ${name}
description: A ${name.toLowerCase()}.
shortcode: ${code}
type: miscgear
sohl:
  archetype: 0
  quality: 0
  durability: 2
  kbcat: cooking
  value: 6
  weight: 3
---

Prose for ${name}.
`;

/** A `doc` note, whose whole document is a JournalEntry. */
const doc = (name: string, code: string) => `---
name:
  full: ${name}
shortcode: ${code}
type: doc
subType: rules
---

Prose for ${name}.
`;

/** A bundle note listing addresses. */
const bundle = (name: string, code: string, contents: string[], body = "") => `---
name:
  full: ${name}
shortcode: ${code}
type: bundle
data:
  contents:
${contents.map((c) => `      - ${c}`).join("\n")}
---
${body}
`;

/**
 * A throwaway repository with an items pack, a journals pack and a **bundles**
 * pack — an ordinary Adventure pack, not the scenes pass's companion.
 */
function bundleRepo(notes: Record<string, string>, extraPacks = ""): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-bundle-tree-"));
    fs.mkdirSync(path.join(root, "assets", "content"), { recursive: true });
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sohl", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(root, "package-build.config.yaml"),
        `contentPackage: sohl
packageKind: systems
compatibility:
    minimum: "14"
    verified: "14.367"
stats:
    lastModifiedBy: bundlebuild0000000
systems:
    sohl:
        compatibility: { verified: "0.9.0" }
itemBuilders: [sohl]
packs:
    - name: items
      label: Items
      type: Item
      system: sohl
      default: true
    - name: journals
      label: Journals
      type: JournalEntry
    - name: bundles
      label: Bundles
      type: Adventure
${extraPacks}`,
    );
    for (const [file, text] of Object.entries(notes)) {
        const full = path.join(root, "assets", "content", file);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, text);
    }
    return root;
}

/**
 * A two-system repository — an Item pack and an Adventure pack per system, as
 * `harn-ensemble` declares them, plus the one system-neutral journals pack.
 *
 * A bundle reaches both Adventure packs through the shared routing field:
 * `<system>.pack` names one per system, exactly as it does for an item.
 */
function twoSystemRepo(notes: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-bundle-two-"));
    fs.mkdirSync(path.join(root, "assets", "content"), { recursive: true });
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sohl", version: "1.0.0" }),
    );
    fs.writeFileSync(
        path.join(root, "package-build.config.yaml"),
        `contentPackage: sohl
packageKind: systems
compatibility:
    minimum: "14"
    verified: "14.367"
stats:
    lastModifiedBy: bundlebuild0000000
systems:
    sohl:
        compatibility: { verified: "0.9.0" }
    hm3:
        compatibility: { verified: "0.9.0" }
itemBuilders: [sohl, hm3]
packs:
    - name: items-sohl
      label: SoHL Items
      type: Item
      system: sohl
      default: true
    - name: items-hm3
      label: HM3 Items
      type: Item
      system: hm3
      mayBeEmpty: true
    - name: journals
      label: Journals
      type: JournalEntry
    - name: bundles-sohl
      label: SoHL Bundles
      type: Adventure
      system: sohl
      default: true
    - name: bundles-hm3
      label: HM3 Bundles
      type: Adventure
      system: hm3
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
        const log = (await import(${JSON.stringify(
            pathToFileURL(path.join(PKG_ROOT, "node_modules/loglevel/lib/loglevel.js")).href,
        )})).default;
        log.setLevel("warn");
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
        const document = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
        out[document.name] = document;
    }
    return out;
}

describe("compiling a bundle note", () => {
    const roots: string[] = [];
    afterAll(() => {
        for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
    });

    it("emits an Adventure holding copies of the documents it names", () => {
        const root = bundleRepo({
            "Bowl.md": gear("Bowl", "bowl"),
            "Combat.md": doc("Combat", "combat"),
            "Vale.md": bundle(
                "The Vale",
                "vale",
                ["miscgear-bowl", "doc-combat"],
                "\nWhat it is.\n",
            ),
        });
        roots.push(root);
        const result = compile(root);
        const bundles = packDocs(root, "bundles");
        const items = packDocs(root, "items");
        const journals = packDocs(root, "journals");

        expect(result.errors).toBe(0);
        const adventure = bundles["The Vale"];
        expect(adventure).toBeTruthy();
        // Copies, not references: the member *is* the compiled document.
        expect(adventure.items).toHaveLength(1);
        expect(adventure.items[0]._id).toBe(items["Bowl"]._id);
        expect(adventure.journal.map((entry: any) => entry._id)).toContain(journals["Combat"]._id);
        // An Adventure member carries no LevelDB key.
        expect(adventure.items[0]._key).toBeUndefined();
        // The Adventure itself does, keyed by the Foundry collection.
        expect(adventure._key).toBe(`!adventures!${adventure._id}`);
    });

    it("puts the note's prose on the Adventure rather than in a second journal", () => {
        // A bundle is something you hand someone, and `Adventure.description`
        // is an `HTMLField` Foundry renders on the import card — so a bundle
        // needs no documentation journal the way an item does.
        const root = bundleRepo({
            "Bowl.md": gear("Bowl", "bowl"),
            "Vale.md": bundle("The Vale", "vale", ["miscgear-bowl"], "\nWhat it is for.\n"),
        });
        roots.push(root);
        compile(root);

        expect(packDocs(root, "bundles")["The Vale"].description).toContain("What it is for.");
        expect(packDocs(root, "journals")["The Vale"]).toBeUndefined();
    });

    it("bundles a documentation journal only when the note names its own address", () => {
        // One note, two documents, two addresses. `miscgear-bowl` is
        // the item; `docmiscgear-bowl` is the JournalEntry its prose became.
        const root = bundleRepo({
            "Bowl.md": gear("Bowl", "bowl"),
            "Item.md": bundle("Item Only", "itemonly", ["miscgear-bowl"]),
            "Both.md": bundle("Both", "both", ["miscgear-bowl", "docmiscgear-bowl"]),
        });
        roots.push(root);
        const result = compile(root);
        const bundles = packDocs(root, "bundles");

        expect(result.errors).toBe(0);
        expect(bundles["Item Only"].items).toHaveLength(1);
        expect(bundles["Item Only"].journal).toHaveLength(0);
        expect(bundles["Both"].items).toHaveLength(1);
        expect(bundles["Both"].journal).toHaveLength(1);
    });

    it("compiles an empty bundle, which is a legitimate installer of nothing yet", () => {
        // The other packs are given a note apiece so the empty-pass rule is not
        // what this case ends up asserting.
        const root = bundleRepo({
            "Bowl.md": gear("Bowl", "bowl"),
            "Combat.md": doc("Combat", "combat"),
            "Empty.md": bundle("Empty", "empty", []),
        });
        roots.push(root);
        const result = compile(root);

        expect(result.errors).toBe(0);
        expect(packDocs(root, "bundles")["Empty"].items).toEqual([]);
    });

    it("fails the build on an address that resolves to nothing", () => {
        const root = bundleRepo({
            "Bowl.md": gear("Bowl", "bowl"),
            "Vale.md": bundle("The Vale", "vale", ["miscgear-nosuchthing"]),
        });
        roots.push(root);
        const result = compile(root);

        expect(result.errors).toBeGreaterThan(0);
        expect(result.output).toMatch(/no note in this tree publishes/);
    });

    it("fails the build on a target that is not an address at all", () => {
        const root = bundleRepo({
            "Bowl.md": gear("Bowl", "bowl"),
            "Vale.md": bundle("The Vale", "vale", ["A Bowl"]),
        });
        roots.push(root);
        const result = compile(root);

        expect(result.errors).toBeGreaterThan(0);
        expect(result.output).toMatch(/which is not an address/);
    });

    it("refuses a folder, which belongs to no one pack and has no copy to take", () => {
        const root = bundleRepo({
            "folders/Gear.md": `---\nname:\n  full: Gear\nshortcode: gear\ntype: folder\n---\n`,
            "Vale.md": bundle("The Vale", "vale", ["folder-gear"]),
        });
        roots.push(root);
        const result = compile(root);

        expect(result.errors).toBeGreaterThan(0);
        expect(result.output).toMatch(/A folder is not a member/);
    });

    it("leaves another system's document out rather than failing, and says so", () => {
        // A two-system tree, as `harn-ensemble` ships one. The `Bowl` carries
        // only a `sohl:` block, so it publishes a SoHL Item and no HM3 one —
        // and the JournalEntry is Foundry's document, so both Adventures hold
        // it. One bundle note, reaching both packs through `<system>.pack`.
        const root = twoSystemRepo({
            "Bowl.md": gear("Bowl", "bowl"),
            "Combat.md": doc("Combat", "combat"),
            "Kit.md":
                `---\nname:\n  full: Kit\nshortcode: kit\ntype: bundle\n` +
                `sohl:\n  pack: bundles-sohl\nhm3:\n  pack: bundles-hm3\n` +
                `data:\n  contents:\n      - miscgear-bowl\n      - doc-combat\n---\n\nA kit.\n`,
        });
        roots.push(root);
        const result = compile(root);
        const sohlBundles = packDocs(root, "bundles-sohl");
        const hm3Bundles = packDocs(root, "bundles-hm3");

        // Left *out*, not failed: the build is green.
        expect(result.errors).toBe(0);
        expect(sohlBundles["Kit"].items).toHaveLength(1);
        expect(hm3Bundles["Kit"].items).toHaveLength(0);
        // Both hold the system-neutral journal.
        expect(sohlBundles["Kit"].journal).toHaveLength(1);
        expect(hm3Bundles["Kit"].journal).toHaveLength(1);
        // And the omission is named, because an installer that quietly ships
        // half its contents is worse than one that fails.
        expect(result.output).toMatch(/leaves out "miscgear-bowl"/);
    });

    it("tells a repository that configures no Adventure pack, by name", () => {
        // The `adventures` **companion** the scenes pass writes cannot be it:
        // a companion is written by another pack's pass, so the router refuses
        // a note that addresses one. Such a repository has to declare a pack.
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-bundle-nopack-"));
        roots.push(root);
        fs.mkdirSync(path.join(root, "assets", "content"), { recursive: true });
        fs.writeFileSync(
            path.join(root, "package.json"),
            JSON.stringify({ name: "sohl", version: "1.0.0" }),
        );
        fs.writeFileSync(
            path.join(root, "package-build.config.yaml"),
            `contentPackage: sohl
packageKind: systems
compatibility:
    minimum: "14"
    verified: "14.367"
stats:
    lastModifiedBy: bundlebuild0000000
systems:
    sohl:
        compatibility: { verified: "0.9.0" }
itemBuilders: [sohl]
packs:
    - name: journals
      label: Journals
      type: JournalEntry
`,
        );
        fs.writeFileSync(
            path.join(root, "assets", "content", "Vale.md"),
            bundle("The Vale", "vale", []),
        );
        const result = compile(root);

        expect(result.errors).toBeGreaterThan(0);
        expect(result.output).toMatch(/declares no Adventure pack/);
    });
});
