/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **The five declarations that re-read the note must see the destination**.
 *
 * Most fields take the value {@link resolveFieldValue} hands them, so they
 * resolve at `<system>.system.<to>` for free. Five do not: `subType`,
 * `charges`, a mystery's `skillAptitudes`, an affiliation's `relations` and a
 * projectile's impact die each validate a *shape spread over several keys*, so
 * their `read` re-reads the frontmatter rather than coercing one raw value.
 *
 * Each re-read went through `sohlField`, which sees `sohl.<key>` and the note's
 * top level — and **not** `sohl.system.<key>`. That was equivalent while every
 * note authored in the block. Once a note authors at the destination instead
 * (the corpus move) those five read as unset and ship their empty value: no
 * `subType` is a thrown build error, and `charges`, `skillAptitudes` and
 * `relations` silently ship empty.
 *
 * The impact die is the one whose two positions are spelled differently —
 * authored `impact.die`, stored `impactBase.die` — so the reader takes both,
 * the same shape `FieldSpec.name`/`legacyKey` takes.
 */

import { describe, it, expect } from "vitest";

import { sohlSystemField, resolveCharges, requireSubType } from "../engine/frontmatter.mjs";
import { buildFromFields } from "../engine/field-spec.mjs";
import { ITEM_FIELDS } from "../sohl/item-fields.mjs";

/** Build one item type's `system` block, as the compiler does. */
const build = (type: string, fm: object) =>
    buildFromFields(ITEM_FIELDS[type] as never)(fm as never);

/* --------------------------------------------------------------------- */
/*  The reader                                                            */
/* --------------------------------------------------------------------- */

describe("sohlSystemField — the destination first, then the legacy position", () => {
    it("prefers `sohl.system.<to>`", () => {
        const fm = { sohl: { subType: "legacy", system: { subType: "own" } } };
        expect(sohlSystemField(fm, "subType")).toBe("own");
    });

    it("falls back to the legacy in-block key, then the top level", () => {
        expect(sohlSystemField({ sohl: { subType: "legacy" } }, "subType")).toBe("legacy");
        expect(sohlSystemField({ subType: "shared" }, "subType")).toBe("shared");
    });

    it("reads a dotted path into the destination", () => {
        const fm = { sohl: { system: { charges: { max: 3 } } } };
        expect(sohlSystemField(fm, "charges.max", null)).toBe(3);
    });

    it("takes a legacy key spelled differently from the destination", () => {
        // `impact.die` is authored; `impactBase.die` is stored. Both are read
        // while the corpus moves, and the destination wins.
        const authored = { sohl: { impact: { die: 6 } } };
        const moved = { sohl: { system: { impactBase: { die: 8 } } } };
        expect(sohlSystemField(authored, "impactBase.die", 0, { legacyKey: "impact.die" })).toBe(6);
        expect(sohlSystemField(moved, "impactBase.die", 0, { legacyKey: "impact.die" })).toBe(8);
    });

    it("returns the default when neither position carries the key", () => {
        expect(sohlSystemField({ sohl: {} }, "subType", "fallback")).toBe("fallback");
    });
});

/* --------------------------------------------------------------------- */
/*  The five declarations, through the real builders                      */
/* --------------------------------------------------------------------- */

describe("a note that authors at the destination still compiles", () => {
    it("reads `subType` — which is a thrown build error when unset", () => {
        expect(requireSubType({ sohl: { system: { subType: "physical" } } })).toBe("physical");
        expect(build("skill", { sohl: { system: { subType: "physical" } } }).subType).toBe(
            "physical",
        );
    });

    it("reads `charges`, which would otherwise ship empty", () => {
        const fm = { sohl: { system: { subType: "grimoire", charges: { max: 5, value: 2 } } } };
        expect(resolveCharges(fm)).toEqual({ max: 5, value: 2 });
        expect(build("mystery", fm).charges).toEqual({ max: 5, value: 2 });
    });

    it("reads a mystery's `skillAptitudes`", () => {
        const fm = {
            sohl: { system: { subType: "grimoire", skillAptitudes: { swordcraft: 2 } } },
        };
        expect(build("mystery", fm).skillAptitudes).toEqual({ swordcraft: 2 });
    });

    it("reads an affiliation's `relations`", () => {
        const fm = { sohl: { system: { subType: "polity", relations: { guild: "rival" } } } };
        expect(build("affiliation", fm).relations).toEqual({ guild: "rival" });
    });

    it("reads a projectile's impact die, whose destination is renamed", () => {
        const fm = {
            sohl: { system: { subType: "arrow", impactBase: { die: 6, modifier: 1 } } },
        };
        // `numDice` is *derived* from the die, so a die the reader cannot see
        // ships a projectile that rolls nothing.
        expect(build("projectilegear", fm).impactBase.numDice).toBe(1);
        expect(
            build("projectilegear", { sohl: { system: { subType: "arrow" } } }).impactBase.numDice,
        ).toBe(0);
    });
});

/* --------------------------------------------------------------------- */
/*  The legacy position keeps working while the corpus moves              */
/* --------------------------------------------------------------------- */

describe("the corpus's current spelling is unchanged", () => {
    it("still reads every one of the five from the block", () => {
        expect(build("skill", { sohl: { subType: "physical" } }).subType).toBe("physical");
        expect(
            build("mystery", { sohl: { subType: "grimoire", charges: { max: 5, value: 2 } } })
                .charges,
        ).toEqual({ max: 5, value: 2 });
        expect(
            build("mystery", { sohl: { subType: "grimoire", skillAptitudes: { swordcraft: 2 } } })
                .skillAptitudes,
        ).toEqual({ swordcraft: 2 });
        expect(
            build("affiliation", { sohl: { subType: "polity", relations: { guild: "rival" } } })
                .relations,
        ).toEqual({ guild: "rival" });
        expect(
            build("projectilegear", { sohl: { subType: "arrow", impact: { die: 6 } } }).impactBase
                .numDice,
        ).toBe(1);
    });
});
