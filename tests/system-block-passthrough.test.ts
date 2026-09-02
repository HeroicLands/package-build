/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `<system>.system` reaching the compiled document (#58).
 *
 * Nothing read a note-level `sohl.system` block before: an item's `system` was
 * assembled field by field and an actor's by hand, so a key the format's own
 * rule says belongs there had nowhere to land. It lands now, verbatim — the
 * DataModel's own paths, with no renaming layer between the note and the
 * document.
 *
 * The corpus does not use it yet (that is #126, in other repositories), which
 * is why every existing tree still compiles byte-identically. These cases
 * describe what happens when it does.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Items } from "../sohl/items.mjs";
import { Actors } from "../sohl/actors.mjs";
import { checkAuthoredSystemData } from "../engine/schema-check.mjs";

const SKILL = `---
name:
  full: Passthrough Skill
id: PPPPPPPPPPPPPPPP
shortcode: passthroughskill
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
  system:
    masteryLevelBase: 42
---

A skill authoring one of its own DataModel fields directly.
`;

const BEING = `---
name:
  full: Passthrough Being
id: QQQQQQQQQQQQQQQQ
shortcode: passthroughbeing
type: being
sohl:
  archetype: null
  system:
    currentMoveMedium: swim
    body:
      weight: 180
---

# Appearance {#appearance}

A being whose movement medium is authored under \`sohl.system\`.
`;

const PLAIN_BEING = `---
name:
  full: Plain Being
id: RRRRRRRRRRRRRRRR
shortcode: plainbeing
type: being
sohl:
  archetype: null
---

# Appearance

A being carrying no \`sohl.system\` block at all.
`;

/** A note carrying no system block whatsoever — still a document. */
const NEUTRAL_DOC = `---
name:
  full: Neutral Guide
id: SSSSSSSSSSSSSSSS
shortcode: neutralguide
type: doc
---

# Overview

Prose belonging to no system.
`;

let tmp: string;
let content: string;
const dirs: Record<string, string> = {};
const compilers: Record<string, any> = {};

/** One compiled document, by its `_id`. */
function doc(dir: string, id: string): any {
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".json")) continue;
        const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
        if (parsed._id === id) return parsed;
    }
    throw new Error(`no document ${id} in ${dir}`);
}

function dest(name: string): string {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir, { recursive: true });
    dirs[name] = dir;
    return dir;
}

beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sohl-passthrough-"));
    content = path.join(tmp, "content");
    fs.mkdirSync(content, { recursive: true });
    fs.writeFileSync(path.join(content, "Skill.md"), SKILL);
    fs.writeFileSync(path.join(content, "Being.md"), BEING);
    fs.writeFileSync(path.join(content, "PlainBeing.md"), PLAIN_BEING);
    fs.writeFileSync(path.join(content, "Neutral.md"), NEUTRAL_DOC);

    compilers.items = new Items({ contentBase: content, dest: dest("items") });
    await compilers.items.compile();
    compilers.actors = new Actors({
        contentBase: content,
        dest: dest("actors"),
        itemsSourceDirs: [dirs.items],
    });
    await compilers.actors.compile();
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("an item's `sohl.system`", () => {
    it("compiles without error", () => {
        expect(compilers.items.errorCount).toBe(0);
    });

    it("wins over the value the field declaration would have produced", () => {
        expect(doc(dirs.items, "PPPPPPPPPPPPPPPP").system.masteryLevelBase).toBe(42);
    });

    it("leaves every other field exactly as the declaration built it", () => {
        const system = doc(dirs.items, "PPPPPPPPPPPPPPPP").system;
        expect(system.subType).toBe("physical");
        expect(system.shortcode).toBe("passthroughskill");
    });
});

describe("an actor's `sohl.system`", () => {
    it("compiles without error", () => {
        expect(compilers.actors.errorCount).toBe(0);
    });

    it("writes each authored path onto the document's `system`", () => {
        const system = doc(dirs.actors, "QQQQQQQQQQQQQQQQ").system;
        expect(system.currentMoveMedium).toBe("swim");
        expect(system.body.weight).toBe(180);
    });

    it("leaves what the pass computes alone", () => {
        const system = doc(dirs.actors, "QQQQQQQQQQQQQQQQ").system;
        expect(system.shortcode).toBe("passthroughbeing");
        expect(system.appearance).toContain("movement medium");
    });

    it("changes nothing for a being that authors no block", () => {
        const system = doc(dirs.actors, "RRRRRRRRRRRRRRRR").system;
        expect(system.currentMoveMedium).toBeUndefined();
        expect(system.shortcode).toBe("plainbeing");
    });
});

describe("a note carrying no system block", () => {
    it("compiles its system-neutral documents all the same", () => {
        // The `doc` note is claimed by neither pass, and neither pass minds:
        // it is not a system's document, and never was.
        expect(compilers.items.errorCount).toBe(0);
        expect(compilers.actors.errorCount).toBe(0);
        expect(fs.readdirSync(dirs.actors).filter((f) => f.endsWith(".json"))).toHaveLength(2);
    });
});

/* --------------------------------------------------------------------- */
/*  An undeclared key is an error, not a silent drop                      */
/* --------------------------------------------------------------------- */

/** A system repository whose own `schema.json` is the one to check against. */
function systemRepo(): Record<string, unknown> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sohl-schema-"));
    fs.writeFileSync(
        path.join(root, "schema.json"),
        JSON.stringify({
            version: 1,
            system: "sohl",
            systemVersion: "0.9.0",
            documents: {
                Actor: {
                    being: {
                        own: ["body", "body.weight", "currentMoveMedium"],
                        inherited: ["shortcode"],
                    },
                },
            },
        }),
        "utf8",
    );
    return {
        rootDir: root,
        packageKind: "systems",
        foundryPackage: "sohl",
        stats: { systemId: "sohl", systemVersion: "0.9.0" },
    };
}

describe("a key the system's schema does not declare", () => {
    const config = systemRepo();

    it("is silent when every authored path is declared", () => {
        const fm = { sohl: { system: { body: { weight: 12 }, currentMoveMedium: "walk" } } };
        expect(
            checkAuthoredSystemData(fm, {
                block: "sohl",
                documentType: "Actor",
                subType: "being",
                config,
            }),
        ).toEqual([]);
    });

    it("names the path, the subtype and the version it was checked at", () => {
        const fm = { sohl: { system: { currentMoveMedum: "walk" } } };
        const [finding] = checkAuthoredSystemData(fm, {
            block: "sohl",
            documentType: "Actor",
            subType: "being",
            config,
        });
        expect(finding.path).toBe("currentMoveMedum");
        expect(finding.message).toMatch(/sohl\.system\.currentMoveMedum/);
        expect(finding.message).toMatch(/"being"/);
        expect(finding.message).toMatch(/0\.9\.0/);
    });

    it("counts an inherited field as declared", () => {
        const fm = { sohl: { system: { shortcode: "kal" } } };
        expect(
            checkAuthoredSystemData(fm, {
                block: "sohl",
                documentType: "Actor",
                subType: "being",
                config,
            }),
        ).toEqual([]);
    });

    it("says nothing about a subtype the artifact does not name", () => {
        // Which subtypes exist is a routing question (#79), not a field one —
        // the same stance `compareFields` takes on a builder for a type the
        // system does not define.
        const fm = { sohl: { system: { anything: 1 } } };
        expect(
            checkAuthoredSystemData(fm, {
                block: "sohl",
                documentType: "Actor",
                subType: "vehicle",
                config,
            }),
        ).toEqual([]);
    });

    it("says nothing where no schema is published", () => {
        const fm = { sohl: { system: { anything: 1 } } };
        expect(
            checkAuthoredSystemData(fm, {
                block: "sohl",
                documentType: "Actor",
                subType: "being",
                config: { ...config, rootDir: os.tmpdir() },
            }),
        ).toEqual([]);
    });
});
