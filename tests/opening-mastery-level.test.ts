/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// Build-time pack helpers (plain ESM, no Foundry). Imported by relative path
// because the pack-build scripts live outside the `@src` alias tree.
import {
    sb,
    evaluateSkillBase,
    openingMasteryLevel,
    // eslint-disable-next-line
} from "../sohl/skill-base.mjs";
// eslint-disable-next-line
import { Actors } from "../sohl/actors.mjs";

/*
 * The rounding rule is copied from SoHL's `ExpressionHelperRegistry.sb`, not
 * imported from it — these cases are the contract between the two. If SoHL
 * changes how a Skill Base rounds, this suite is what notices.
 */
describe("sb() — the HârnMaster Skill Base reduction", () => {
    it("returns a lone value unchanged", () => {
        expect(sb(13)).toBe(13);
    });

    it("rounds a pair up only when the primary attribute is the greater", () => {
        // 13/10 averages 11.5. Primary first → up; primary second → down.
        expect(sb(13, 10)).toBe(12);
        expect(sb(10, 13)).toBe(11);
    });

    it("rounds an equal pair down, matching the strict-greater tiebreak", () => {
        expect(sb(11, 11)).toBe(11);
    });

    it("rounds three or more to nearest", () => {
        expect(sb(10, 11, 13)).toBe(11);
        expect(sb(10, 11, 12, 14)).toBe(12);
    });

    it("refuses to reduce nothing", () => {
        expect(() => sb()).toThrow(/at least one attribute value/);
    });
});

describe("evaluateSkillBase — the skill.base scope, reproduced", () => {
    const attrs = { str: 13, agl: 10, wil: 12, rea: 15 };

    it("evaluates the shape every skill in content actually uses", () => {
        expect(evaluateSkillBase("sb(attr.str, attr.agl)", attrs)).toEqual({
            value: 12,
        });
    });

    it("reads an attribute the actor lacks as 0 rather than failing", () => {
        // SoHL proxies its `attr` context to 0 for the same reason: a missing
        // attribute is an intentional non-error, not a broken formula.
        expect(evaluateSkillBase("sb(attr.nope, attr.str)", attrs)).toEqual({
            value: 6,
        });
    });

    it("is case-insensitive about shortcodes, and takes a computed read", () => {
        expect(evaluateSkillBase("attr.STR", attrs).value).toBe(13);
        expect(evaluateSkillBase('attr["str"]', attrs).value).toBe(13);
    });

    it("treats an absent or blank formula as skill base 0, not an error", () => {
        // A skill may legitimately carry no formula; the client returns 0 too.
        expect(evaluateSkillBase(null, attrs)).toEqual({ value: 0 });
        expect(evaluateSkillBase("   ", attrs)).toEqual({ value: 0 });
    });

    it("clamps a negative result to 0, as computeSkillBase does", () => {
        expect(evaluateSkillBase("attr.agl - attr.str", attrs)).toEqual({
            value: 0,
        });
    });

    it("does arithmetic around the helper", () => {
        expect(evaluateSkillBase("sb(attr.str, attr.agl) + 2", attrs).value).toBe(14);
    });

    it("reports an unknown helper instead of evaluating around it", () => {
        const out = evaluateSkillBase("bogus(attr.str)", attrs);
        expect(out.value).toBe(0);
        expect(out.error).toMatch(/unknown helper "bogus\(\)"/);
    });

    it("reports a binding the scope does not declare", () => {
        // `skill.base` binds `attr` and nothing else.
        expect(evaluateSkillBase("sb(item.str)", attrs).error).toMatch(/unknown binding "item"/);
    });

    it("reports a formula it cannot parse", () => {
        expect(evaluateSkillBase("sb(attr.str,", attrs).error).toMatch(/could not be parsed/);
    });

    it("refuses constructs outside the supported subset", () => {
        expect(evaluateSkillBase("attr.str ? 1 : 2", attrs).error).toMatch(
            /unsupported expression node/,
        );
    });
});

describe("openingMasteryLevel — Skill Base × initSkillMult", () => {
    const attrs = { str: 13, agl: 10 };
    const formula = "sb(attr.str, attr.agl)"; // → 12

    it("opens a skill at the product", () => {
        expect(openingMasteryLevel({ skillBaseFormula: formula, initSkillMult: 3 }, attrs)).toEqual(
            { value: 36 },
        );
    });

    it("leaves a skill with no multiplier unopened rather than opening it at 0", () => {
        // `initSkillMult` is the switch for whether a skill opens at all, so
        // writing the 0 the arithmetic yields would claim it opened at zero.
        for (const initSkillMult of [0, undefined, null]) {
            expect(
                openingMasteryLevel({ skillBaseFormula: formula, initSkillMult }, attrs),
            ).toEqual({ value: null });
        }
    });

    it("opens at 0 when the multiplier is real but the skill has no formula", () => {
        // Distinct from the case above: this skill does open, from a base of 0.
        expect(openingMasteryLevel({ initSkillMult: 2 }, attrs)).toEqual({
            value: 0,
        });
    });

    it("reports a fractional product rather than rounding it", () => {
        // masteryLevelBase is an integer field, so there is no honest value to
        // write. Same stance as resolveSkillAptitudes takes on a fractional
        // modifier.
        const out = openingMasteryLevel(
            { skillBaseFormula: "attr.str", initSkillMult: 0.5 },
            attrs,
        );
        expect(out.value).toBeNull();
        expect(out.error).toMatch(/whole number/);
    });

    it("passes a broken formula's error up instead of opening the skill", () => {
        const out = openingMasteryLevel({ skillBaseFormula: "bogus()", initSkillMult: 2 }, attrs);
        expect(out.value).toBeNull();
        expect(out.error).toMatch(/unknown helper/);
    });
});

/*
 * The wiring, not the module. The fill has to happen inside the actors pass,
 * after the note's frontmatter has been merged onto the catalogue skill and
 * after the attribute items exist — a correct evaluator called at the wrong
 * point in the pass looks exactly like one that was never called.
 */
describe("the actors pass bakes an unopened skill's mastery level (#46)", () => {
    const catalogue = () =>
        new Map<string, any>([
            [
                "attribute:str",
                {
                    type: "attribute",
                    name: "Strength",
                    system: { shortcode: "str", scoreBase: 0 },
                },
            ],
            [
                "attribute:agl",
                {
                    type: "attribute",
                    name: "Agility",
                    system: { shortcode: "agl", scoreBase: 0 },
                },
            ],
            [
                "skill:clmb",
                {
                    type: "skill",
                    name: "Climbing",
                    system: {
                        shortcode: "clmb",
                        masteryLevelBase: null,
                        initSkillMult: 3,
                        skillBaseFormula: "sb(attr.str, attr.agl)",
                    },
                },
            ],
            [
                "skill:peoni",
                {
                    type: "skill",
                    name: "Peoni",
                    system: {
                        shortcode: "peoni",
                        masteryLevelBase: null,
                        initSkillMult: 0,
                        skillBaseFormula: "sb(attr.str, attr.agl)",
                    },
                },
            ],
        ]);

    // The compiler insists on a real content tree at construction, so give it
    // an empty one — the pass is driven here through buildEmbeddedItems, not
    // through a walk.
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-open-ml-"));
        fs.mkdirSync(path.join(dir, "content"));
        fs.mkdirSync(path.join(dir, "items"));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const compiler = () =>
        new Actors({
            contentBase: path.join(dir, "content"),
            dest: path.join(dir, "out"),
            itemsSourceDirs: [path.join(dir, "items")],
        });

    const build = (fm: any) => {
        const c = compiler();
        const items = c.buildEmbeddedItems(catalogue(), "actor0000000000", fm, "test");
        const skill = (code: string) => items.find((i: any) => i.system?.shortcode === code);
        return { items, skill, errors: c.errorCount };
    };

    it("fills the null from the being's own attribute scores", () => {
        // sb(13, 10) = 12, × 3 = 36.
        const { skill, errors } = build({
            sohl: {
                attributes: { str: 13, agl: 10 },
                items: [{ shortcode: "clmb", type: "skill" }],
            },
        });
        expect(skill("clmb").system.masteryLevelBase).toBe(36);
        expect(errors).toBe(0);
    });

    it("is driven by the actor's scores, so two beings open the same skill differently", () => {
        const weaker = build({
            sohl: {
                attributes: { str: 8, agl: 8 },
                items: [{ shortcode: "clmb", type: "skill" }],
            },
        });
        expect(weaker.skill("clmb").system.masteryLevelBase).toBe(24);
    });

    it("leaves a mastery level the note states alone", () => {
        const { skill } = build({
            sohl: {
                attributes: { str: 13, agl: 10 },
                items: [
                    {
                        shortcode: "clmb",
                        type: "skill",
                        system: { masteryLevelBase: 55 },
                    },
                ],
            },
        });
        expect(skill("clmb").system.masteryLevelBase).toBe(55);
    });

    it("leaves a skill the catalogue never opens unset", () => {
        const { skill, errors } = build({
            sohl: {
                attributes: { str: 13, agl: 10 },
                items: [{ shortcode: "peoni", type: "skill" }],
            },
        });
        expect(skill("peoni").system.masteryLevelBase).toBeNull();
        expect(errors).toBe(0);
    });

    it("opens from 0 when the being declares no attributes at all", () => {
        // Every `attr.*` reads as 0, so the skill base is 0 — the same answer
        // the client reaches off an actor.
        const { skill } = build({
            sohl: { items: [{ shortcode: "clmb", type: "skill" }] },
        });
        expect(skill("clmb").system.masteryLevelBase).toBe(0);
    });

    it("does not touch a non-skill item", () => {
        const { items } = build({
            sohl: {
                attributes: { str: 13, agl: 10 },
                items: [{ shortcode: "clmb", type: "skill" }],
            },
        });
        const str = items.find((i: any) => i.type === "attribute");
        expect(str.system).not.toHaveProperty("masteryLevelBase");
    });
});
