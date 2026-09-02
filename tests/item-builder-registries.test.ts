/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `itemBuilders` as a **set** of registries rather than one (#58).
 *
 * The type vocabulary is derived from the registry's keys, which is what makes
 * a type impossible to accept without a builder behind it (#1504). With one
 * registry that is also a ceiling: a repository shipping content for two
 * systems has types only one of them knows — `spell` and `invocation` are HM3's,
 * `mysticalability` is SoHL's — and a single registry can accept only one
 * system's list.
 *
 * So a consumer may declare several, the vocabulary is their **union**, and a
 * type both declare keeps a builder per system rather than one of them winning
 * silently.
 *
 * The scalar form is unchanged: every existing configuration names one registry
 * and must keep meaning exactly what it meant.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "../content-config.mjs";
import { CONFIG_BASENAME, configFromData } from "../engine/pack-config.mjs";
import { ITEM_BUILDERS } from "../sohl/item-builders.mjs";

const BASE = {
    rootDir: "/tmp/registries",
    contentPackage: "demo",
    foundryPackage: "demo",
    packageKind: "modules" as const,
    stats: { lastModifiedBy: "demobuild000000x" },
    packs: [{ name: "items", type: "Item" }],
};

const sohlSkill = () => ({ from: "sohl" });
const sohlMystical = () => ({ from: "sohl" });
const hm3Skill = () => ({ from: "hm3" });
const hm3Spell = () => ({ from: "hm3" });

const SOHL_REGISTRY = {
    skill: { system: sohlSkill, img: "icons/skill-sohl.svg", fields: [{ to: "a" }] },
    mysticalability: sohlMystical,
};
const HM3_REGISTRY = {
    skill: { system: hm3Skill, img: "icons/skill-hm3.svg" },
    spell: hm3Spell,
};

describe("one registry — the shape every existing configuration has", () => {
    const config = defineConfig({ ...BASE, itemBuilders: SOHL_REGISTRY } as never);

    it("derives the vocabulary from its keys", () => {
        expect([...config.itemTypes].sort()).toEqual(["mysticalability", "skill"]);
    });

    it("keeps the flat builder, art and field tables it always had", () => {
        expect(config.itemBuilders.skill).toBe(sohlSkill);
        expect(config.itemArt.skill).toBe("icons/skill-sohl.svg");
        expect(config.itemFields.skill).toEqual([{ to: "a" }]);
    });

    it("declares no system for it — an object registry names none", () => {
        expect(config.itemBuildersBySystem).toEqual({});
    });
});

describe("a set of registries", () => {
    const config = defineConfig({
        ...BASE,
        itemBuilders: [
            { system: "sohl", builders: SOHL_REGISTRY },
            { system: "hm3", builders: HM3_REGISTRY },
        ],
    } as never);

    it("unions the type vocabulary across every declared registry", () => {
        expect([...config.itemTypes].sort()).toEqual(["mysticalability", "skill", "spell"]);
    });

    it("keeps a builder per system for a type both declare", () => {
        expect(config.itemBuildersBySystem.sohl.skill).toBe(sohlSkill);
        expect(config.itemBuildersBySystem.hm3.skill).toBe(hm3Skill);
    });

    it("keeps art and fields per system too", () => {
        expect(config.itemArtBySystem.sohl.skill).toBe("icons/skill-sohl.svg");
        expect(config.itemArtBySystem.hm3.skill).toBe("icons/skill-hm3.svg");
        expect(config.itemFieldsBySystem.sohl.skill).toEqual([{ to: "a" }]);
        expect(config.itemFieldsBySystem.hm3.skill).toBeUndefined();
    });

    it("leaves the flat table to the first registry that declares a type", () => {
        // The flat table answers a single-system build, where there is nothing
        // to choose between. A build that has two systems asks by system.
        expect(config.itemBuilders.skill).toBe(sohlSkill);
        expect(config.itemBuilders.spell).toBe(hm3Spell);
    });

    it("records which types more than one registry declares", () => {
        expect([...config.itemTypesBySeveralSystems]).toEqual(["skill"]);
    });

    it("refuses a registry that names no system", () => {
        expect(() =>
            defineConfig({ ...BASE, itemBuilders: [{ builders: SOHL_REGISTRY }] } as never),
        ).toThrow(/itemBuilders\[0\]\.system/);
    });

    it("refuses two registries for the same system", () => {
        expect(() =>
            defineConfig({
                ...BASE,
                itemBuilders: [
                    { system: "sohl", builders: SOHL_REGISTRY },
                    { system: "sohl", builders: HM3_REGISTRY },
                ],
            } as never),
        ).toThrow(/sohl/);
    });

    it("refuses an entry that is not a registry declaration", () => {
        expect(() => defineConfig({ ...BASE, itemBuilders: ["sohl"] } as never)).toThrow(
            /itemBuilders\[0\]/,
        );
    });
});

/* --------------------------------------------------------------------- */
/*  Naming registries from a data configuration                           */
/* --------------------------------------------------------------------- */

/** A throwaway repository root carrying the `package.json` a config derives from. */
function repoDir(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-reg-"));
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "sohl", version: "1.2.3" }),
        "utf8",
    );
    return root;
}

function resolveIn(root: string, data: Record<string, unknown>) {
    return configFromData(data, path.join(root, `${CONFIG_BASENAME}.yaml`));
}

const MINIMAL = {
    contentPackage: "sohl",
    packageKind: "systems",
    compatibility: { minimum: "14.359" },
    stats: { lastModifiedBy: "sohlbuilder00000" },
    packs: [{ name: "items", type: "Item" }],
};

describe("naming registries from YAML", () => {
    // The loader `require`s the registry while the test `import`s it, so the two
    // are different module instances and the builders are not identical
    // *objects*. What is asserted is the vocabulary and that a builder arrived,
    // which is what the resolution is for.
    const SOHL_TYPES = Object.keys(ITEM_BUILDERS).sort();

    it("resolves the scalar form to the flat registry it always did", () => {
        const config = resolveIn(repoDir(), { ...MINIMAL, itemBuilders: "sohl" });
        expect(Object.keys(config.itemBuilders).sort()).toEqual(SOHL_TYPES);
        expect(typeof config.itemBuilders.skill).toBe("function");
        // Deliberately *not* wrapped as a one-entry set: an existing
        // configuration would otherwise gain a per-system table it never
        // declared.
        expect(config.itemBuildersBySystem).toEqual({});
    });

    it("resolves a list of names, keyed by the system each registry is named for", () => {
        const config = resolveIn(repoDir(), { ...MINIMAL, itemBuilders: ["sohl"] });
        expect(Object.keys(config.itemBuildersBySystem)).toEqual(["sohl"]);
        expect(typeof config.itemBuildersBySystem.sohl.skill).toBe("function");
        expect([...config.itemTypes].sort()).toEqual(SOHL_TYPES);
    });

    it("names the offending element when a listed registry does not exist", () => {
        expect(() => resolveIn(repoDir(), { ...MINIMAL, itemBuilders: ["sohl", "nope"] })).toThrow(
            /itemBuilders\[1\][\s\S]*"nope"/,
        );
    });
});
