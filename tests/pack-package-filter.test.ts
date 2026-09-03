/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The whole point of these tests: a note's package is the *configured* one, so
// a repository that ships another package's notes compiles them. Mocking the
// configuration to a package that is not "sohl" is what tells a configured read
// apart from a hard-coded literal.
//
// Since #56 there is no frontmatter field at all: a note declares nothing and
// compiles, and one that still declares `package:` is an error naming the file
// — never the silent skip that let a whole tree be filtered out at exit 0.
vi.mock("../engine/content-package.mjs", () => ({
    contentPackage: () => "thalorna",
    foundryPackageId: () => "sohl-thalorna",
}));

// Build-time pack compilers (plain ESM, no Foundry). Imported by relative path
// because the pack-build scripts live outside the `@src` alias tree.
import { Items } from "../sohl/items.mjs";
import { Actors } from "../sohl/actors.mjs";
import { Journals } from "../engine/journals.mjs";
import { Macros } from "../engine/macros.mjs";
import { Scenes } from "../engine/scenes.mjs";

/** A note of the package this repository is configured to compile. */
const OWN_SKILL = `---
name:
  full: Foreign Skill
id: AAAAAAAAAAAAAAAA
shortcode: foreignskill
type: skill
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

A skill belonging to the configured content package.
`;

/**
 * A second note, likewise declaring no package. Every note in every tree has
 * this shape now: the package a note belongs to is the repository's, not the
 * note's (#56).
 */
const UNDECLARED_SKILL = `---
name:
  full: Undeclared Skill
id: YYYYYYYYYYYYYYYY
shortcode: undeclaredskill
type: skill
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

A skill that leaves its package to the configuration.
`;

/**
 * The control: a note still declaring the retired field. It must be **refused**
 * — a compiler that let everything through would pass the tests above for the
 * wrong reason, and one that skipped it quietly is the defect #56 removes. The
 * value is beside the point; the field is.
 */
const OTHER_SKILL = `---
name:
  full: Other Package Skill
id: ZZZZZZZZZZZZZZZZ
shortcode: otherskill
type: skill
package: sohl
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

A skill belonging to some other package.
`;

const OWN_CREATURE = `---
name:
  full: Foreign Creature
id: BBBBBBBBBBBBBBBB
shortcode: foreigncreature
type: being
sohl:
  archetype: null
---

# Appearance

A creature belonging to the configured content package.
`;

const OWN_DOC = `---
name:
  full: Foreign Guide
id: CCCCCCCCCCCCCCCC
shortcode: foreignguide
type: doc
sohl:
  archetype: null
---

# Overview

A journal belonging to the configured content package.
`;

const OWN_MACRO = `---
name:
  full: Foreign Macro
id: DDDDDDDDDDDDDDDD
shortcode: foreignmacro
type: macro
sohl:
  archetype: null
---

A macro belonging to the configured content package.

# Script {#script}

\`\`\`js
console.log("hello");
\`\`\`
`;

const OWN_MAP = `---
name:
  full: Foreign Map
id: EEEEEEEEEEEEEEEE
shortcode: foreignmap
type: map
subType: battlemap
sohl:
  archetype: null
  place: foreignplace
  placeName: Foreign Place
  image: systems/sohl/assets/ui/parchment.jpg
  dimensions: [512, 512]
  pxPerGrid: 64
---

A map belonging to the configured content package.
`;

let tmp: string;
let content: string;
const dirs: Record<string, string> = {};
const compilers: Record<string, any> = {};

/** Every compiled document in a pack directory, by name. */
function names(dir: string): string[] {
    return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).name);
}

/** A destination directory for one pack. */
function dest(name: string): string {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir, { recursive: true });
    dirs[name] = dir;
    return dir;
}

beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sohl-pkg-filter-"));
    content = path.join(tmp, "content");
    fs.mkdirSync(content, { recursive: true });
    fs.writeFileSync(path.join(content, "OwnSkill.md"), OWN_SKILL);
    fs.writeFileSync(path.join(content, "UndeclaredSkill.md"), UNDECLARED_SKILL);
    fs.writeFileSync(path.join(content, "OwnCreature.md"), OWN_CREATURE);
    fs.writeFileSync(path.join(content, "OwnDoc.md"), OWN_DOC);
    fs.writeFileSync(path.join(content, "OwnMacro.md"), OWN_MACRO);
    fs.writeFileSync(path.join(content, "OwnMap.md"), OWN_MAP);

    // Items first: the actors pass reads the compiled items as its sibling.
    compilers.items = new Items({ contentBase: content, dest: dest("items") });
    await compilers.items.compile();

    compilers.actors = new Actors({
        contentBase: content,
        dest: dest("actors"),
        // Stated, not inferred from the destination's siblings: where the items
        // passes wrote their JSON is configuration (#1508), and there may be
        // more than one Item pack (#1566).
        itemsSourceDirs: [dirs.items],
    });
    await compilers.actors.compile();

    compilers.journals = new Journals({
        contentBase: content,
        dest: dest("journals"),
    });
    await compilers.journals.compile();

    compilers.macros = new Macros({
        contentBase: content,
        dest: dest("macros"),
    });
    await compilers.macros.compile();

    compilers.scenes = new Scenes({
        contentBase: content,
        dest: dest("scenes"),
        companionDests: { adventures: dest("adventures") },
    });
    await compilers.scenes.compile();
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("every pack compiler compiles the configured package's notes", () => {
    it("compiles the items of the configured package", () => {
        expect(compilers.items.errorCount).toBe(0);
        expect(names(dirs.items)).toContain("Foreign Skill");
    });

    it("compiles the actors of the configured package", () => {
        expect(compilers.actors.errorCount).toBe(0);
        expect(names(dirs.actors)).toContain("Foreign Creature");
    });

    it("compiles the journals of the configured package", () => {
        expect(compilers.journals.errorCount).toBe(0);
        expect(names(dirs.journals)).toContain("Foreign Guide");
    });

    it("compiles the macros of the configured package", () => {
        expect(compilers.macros.errorCount).toBe(0);
        expect(names(dirs.macros)).toContain("Foreign Macro");
    });

    it("compiles the scenes of the configured package", () => {
        expect(compilers.scenes.errorCount).toBe(0);
        expect(names(dirs.scenes)).toContain("Foreign Map");
    });

    it("compiles a note that declares no package at all", () => {
        // The shape a swept tree's notes have. Nothing about it is special:
        // the package is the repository's, so there is nothing to match.
        expect(names(dirs.items)).toContain("Undeclared Skill");
    });
});

describe("a note still declaring `package:` is refused, not skipped", () => {
    let tmp2: string;

    beforeAll(() => {
        tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "sohl-pkg-foreign-"));
    });

    afterAll(() => fs.rmSync(tmp2, { recursive: true, force: true }));

    it("counts an error and writes nothing, naming the file", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const tree = path.join(tmp2, "content");
            const out = path.join(tmp2, "items");
            fs.mkdirSync(tree, { recursive: true });
            fs.mkdirSync(out, { recursive: true });
            fs.writeFileSync(path.join(tree, "OtherSkill.md"), OTHER_SKILL);

            const items = new Items({ contentBase: tree, dest: out });
            await items.compile();

            // Loud: the build fails, rather than shipping an empty pack from a
            // tree whose every note named a package nothing answered to.
            expect(items.errorCount).toBe(1);
            expect(names(out)).not.toContain("Other Package Skill");
            const lines = spy.mock.calls.map((c) => String(c[0]));
            expect(lines.some((l) => l.includes("OtherSkill.md"))).toBe(true);
            expect(lines.some((l) => l.includes("retired"))).toBe(true);
            expect(lines.some((l) => l.includes("thalorna"))).toBe(true);
        } finally {
            spy.mockRestore();
        }
    });
});

describe("every pack compiler reports how many entries it wrote", () => {
    // `generatePacksJson` fails a pass that produced nothing, which it can only
    // do if each compiler says how much it wrote.
    it.each(["items", "actors", "journals", "macros", "scenes"])(
        "%s reports a compiled count matching the documents it emitted",
        (name) => {
            expect(compilers[name].compiledCount).toBe(names(dirs[name]).length);
            expect(compilers[name].compiledCount).toBeGreaterThan(0);
        },
    );
});
