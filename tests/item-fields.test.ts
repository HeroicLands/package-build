/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";

import { ITEM_FIELDS } from "../sohl/item-fields.mjs";
import { ITEM_BUILDERS } from "../sohl/item-builders.mjs";
import { DEFAULT_ITEM_ART } from "../sohl/default-item-art.mjs";
import { authoredFields } from "../engine/field-spec.mjs";

/** Build one type's `system` block from a bare `sohl:` block. */
const build = (type: string, sohl: object = {}, fm: object = {}) =>
    (ITEM_BUILDERS as any)[type].system({ sohl, ...fm });

describe("ITEM_FIELDS is the one list (#22, #1504)", () => {
    it("declares exactly the types the registry and the art map cover", () => {
        const declared = Object.keys(ITEM_FIELDS).sort();
        expect(Object.keys(ITEM_BUILDERS).sort()).toEqual(declared);
        expect(Object.keys(DEFAULT_ITEM_ART).sort()).toEqual(declared);
    });

    it("hands each registry entry the declaration that built it", () => {
        for (const [type, entry] of Object.entries(ITEM_BUILDERS as any)) {
            expect((entry as any).fields).toBe((ITEM_FIELDS as any)[type]);
            expect(typeof (entry as any).system).toBe("function");
            expect(typeof (entry as any).img).toBe("string");
        }
    });

    // A declaration nobody can read is worth no more than the function body it
    // replaced, so the documentable parts are mandatory rather than optional.
    it("gives every field a target, and every authored field a shape and a description", () => {
        for (const [type, fields] of Object.entries(ITEM_FIELDS as any)) {
            for (const field of fields as any[]) {
                expect(typeof field.to, `${type}.to`).toBe("string");
                expect(field.describe, `${type}.${field.to}`).toBeTruthy();
            }
            for (const field of authoredFields(fields as any)) {
                expect(
                    (field as any).shape,
                    `${type}.${(field as any).name}`,
                ).toBeTruthy();
            }
        }
    });
});

describe("the declarations preserve the vocabulary they replaced", () => {
    it("keeps a skill's unset mastery level distinct from zero", () => {
        expect(
            build("skill", { subType: "craft" }).masteryLevelBase,
        ).toBeNull();
        expect(
            build("skill", { subType: "craft", masteryLevelBase: "" })
                .masteryLevelBase,
        ).toBeNull();
        expect(
            build("skill", { subType: "craft", masteryLevelBase: 0 })
                .masteryLevelBase,
        ).toBe(0);
    });

    it("requires a strike mode on a combat technique and sets none otherwise", () => {
        expect(build("skill", { subType: "craft" })).not.toHaveProperty(
            "strikeMode",
        );
        expect(() => build("skill", { subType: "combattechnique" })).toThrow(
            /requires sohl\.strikeMode/,
        );
        expect(
            build("skill", {
                subType: "combattechnique",
                strikeMode: { type: "melee", name: "Swing" },
            }).strikeMode,
        ).toEqual({ type: "melee", name: "Swing" });
    });

    it("refuses a subType-bearing type with no subType", () => {
        expect(() => build("affliction")).toThrow(/missing required 'subType'/);
    });

    it("renames contagionIndex onto its Base field", () => {
        expect(
            build("affliction", { subType: "disease", contagionIndex: 7 })
                .contagionIndexBase,
        ).toBe(7);
    });

    it("keeps a descriptive trauma's injury fields unset", () => {
        const out = build("trauma", { subType: "physcond" });
        expect(out.levelBase).toBeNull();
        expect(out.aspect).toBeNull();
        expect(out.bodyLocationCode).toBeNull();
        expect(out.healingRateBase).toBe(0);
    });

    it("nests armour protection and locations under their blocks", () => {
        const out = build("armorgear", {
            flexloc: ["torso"],
            protection: { blunt: 3, edged: 5 },
            facing: [{ location: "skull", side: "front" }],
        });
        expect(out.locations).toEqual({
            flexible: ["torso"],
            rigid: [],
            facing: [{ location: "skull", side: "front" }],
        });
        expect(out.protectionBase).toEqual({
            blunt: 3,
            edged: 5,
            piercing: 0,
            fire: 0,
        });
    });

    it("derives a projectile's dice from its declared die", () => {
        const withDie = build("projectilegear", {
            subType: "arrow",
            impact: { die: 6 },
        });
        expect(withDie.impactBase).toEqual({
            overrideDice: true,
            overrideModifier: false,
            numDice: 1,
            die: 6,
            modifier: 0,
            aspect: "piercing",
        });
        const withoutDie = build("projectilegear", { subType: "arrow" });
        expect(withoutDie.impactBase.numDice).toBe(0);
        expect(withoutDie.impactBase.overrideDice).toBe(false);
    });

    it("layers the gear constants onto every gear type", () => {
        for (const type of [
            "miscgear",
            "weapongear",
            "armorgear",
            "containergear",
        ]) {
            const out = build(type, { subType: "x" });
            expect(out.quantity).toBe(1);
            expect(out.isCarried).toBe(true);
            expect(out.isEquipped).toBe(false);
            expect(out.containerId).toBeNull();
            expect(out.sharedWithCohortIds).toEqual([]);
        }
    });

    it("rejects a weapon whose strike modes collide", () => {
        expect(() =>
            build("weapongear", {
                strikeModes: [{ shortcode: "s" }, { shortcode: "s" }],
            }),
        ).toThrow(/duplicate strike-mode shortcode/);
        expect(() =>
            build("weapongear", { strikeModes: [{ name: "no code" }] }),
        ).toThrow(/requires a 'shortcode'/);
    });

    it("validates an affiliation's standings against the closed list", () => {
        expect(() =>
            build("affiliation", {
                subType: "temporal",
                relation: { abc: "friendly" },
            }),
        ).toThrow(/must be one of/);
    });
});

// The builders are an allow-list: a `sohl:` key no declaration names is
// discarded at compile with no warning and no effect on the exit code. That is
// how 204 kethira mystical abilities shipped with no link to the affiliation
// granting them (#3). These assert the emitted document rather than the
// declaration, because the declaration is exactly what was wrong.
describe("association codes reach the emitted document (#3)", () => {
    it("carries a mystical ability's granting affiliation", () => {
        expect(
            build("mysticalability", {
                subType: "arcane",
                assocAffiliationCode: "lyahvi",
            }).assocAffiliationCode,
        ).toBe("lyahvi");
    });

    it("carries a mystery's skill and granting affiliation", () => {
        const system = build("mystery", {
            subType: "divine",
            assocSkillCode: "ritual",
            assocAffiliationCode: "peoni",
        });
        expect(system.assocSkillCode).toBe("ritual");
        expect(system.assocAffiliationCode).toBe("peoni");
    });

    // Both DataModels declare these `nullable: true, blank: false, initial:
    // null`, so "unset" is one value rather than two — a cleared field must
    // not ship as `""`.
    it("ships an unset or cleared code as null on both types", () => {
        for (const type of ["mysticalability", "mystery"]) {
            expect(
                build(type, { subType: "arcane" }).assocAffiliationCode,
                type,
            ).toBeNull();
            expect(
                build(type, { subType: "arcane", assocAffiliationCode: "" })
                    .assocAffiliationCode,
                type,
            ).toBeNull();
        }
    });
});

// The inverse of #3, from the same root cause: an emitted key no DataModel
// declares. `MysticalAbilityDataModel` dropped `assocMysteryCode` in
// HeroicLands/Song-of-Heroic-Lands-FoundryVTT#973 — nothing read the mystery it
// resolved to — and `assocAffiliationCode` arrived later and separately (#1012)
// as the granting faction, so the two are unrelated rather than a rename.
// Foundry discards an undeclared key when the document is constructed, so every
// compiled ability shipped a value that was thrown away at load.
describe("a compiled mystical ability carries no assocMysteryCode (#35)", () => {
    it("omits the key when no note authors it", () => {
        expect(
            build("mysticalability", { subType: "arcane" }),
        ).not.toHaveProperty("assocMysteryCode");
    });

    it("omits the key even when a note still authors one", () => {
        expect(
            build("mysticalability", {
                subType: "arcane",
                assocMysteryCode: "pmagic",
            }),
        ).not.toHaveProperty("assocMysteryCode");
    });

    it("declares no mysteryCode field on any type", () => {
        for (const [type, fields] of Object.entries(ITEM_FIELDS as any)) {
            expect(
                (fields as any[]).map((f) => f.to),
                type,
            ).not.toContain("assocMysteryCode");
        }
    });
});
