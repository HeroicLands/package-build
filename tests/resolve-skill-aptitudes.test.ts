/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
// Build-time pack helper (plain ESM, no Foundry). Imported by relative path
// because the pack-build scripts live outside the `@src` alias tree.
import {
    resolveSkillAptitudes,
    // eslint-disable-next-line
} from "../engine/helpers.mjs";

describe("resolveSkillAptitudes (pack builder — selector → mastery modifier)", () => {
    it("returns an empty map when the item authors no aptitudes", () => {
        expect(resolveSkillAptitudes({})).toEqual({});
        expect(resolveSkillAptitudes({ sohl: {} })).toEqual({});
    });

    it("reads an empty list as an empty map — that is what Obsidian writes", () => {
        // Same editor behaviour as `relation` (#8): an emptied property is
        // serialized as `[]`, and means the item authors no aptitudes.
        expect(resolveSkillAptitudes({ skillAptitudes: [] })).toEqual({});
        expect(resolveSkillAptitudes({ sohl: { skillAptitudes: [] } })).toEqual({});
    });

    it("passes an authored map through, from the sohl block or the top level", () => {
        expect(resolveSkillAptitudes({ sohl: { skillAptitudes: { awa: 2 } } })).toEqual({ awa: 2 });
        expect(
            resolveSkillAptitudes({
                skillAptitudes: { "subType:combat": -1 },
            }),
        ).toEqual({ "subType:combat": -1 });
    });

    it("keeps a zero — it still beats an aptitude another sign hinders", () => {
        expect(resolveSkillAptitudes({ skillAptitudes: { awa: 0 } })).toEqual({
            awa: 0,
        });
    });

    it("throws on a fractional or non-numeric modifier rather than rounding it", () => {
        expect(() => resolveSkillAptitudes({ skillAptitudes: { awa: 1.5 } }, "Sindarin")).toThrow(
            /Sindarin: skillAptitudes\["awa"\]/,
        );
        expect(() => resolveSkillAptitudes({ skillAptitudes: { awa: "up" } }, "Sindarin")).toThrow(
            /whole number/,
        );
    });

    it("throws when the map is not a map", () => {
        // A *populated* list is still an error — see the empty-list case above.
        expect(() => resolveSkillAptitudes({ skillAptitudes: ["awa"] }, "Sindarin")).toThrow(
            /map of selector/,
        );
        expect(() => resolveSkillAptitudes({ skillAptitudes: "awa" }, "Sindarin")).toThrow(
            /map of selector/,
        );
    });
});
