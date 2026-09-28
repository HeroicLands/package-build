/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";

import { BEING_TYPE, GEAR_TYPE_TO_KEY, isBeing } from "../sohl/being-info.mjs";

describe("being type", () => {
    it("recognizes being notes", () => {
        expect(BEING_TYPE).toBe("being");
        expect(isBeing({ type: "being" })).toBe(true);
    });

    it("rejects other and absent types", () => {
        expect(isBeing({ type: "character" })).toBe(false);
        expect(isBeing({ type: "creature" })).toBe(false);
        expect(isBeing({ type: "weapongear" })).toBe(false);
        expect(isBeing({})).toBe(false);
        expect(isBeing(null)).toBe(false);
        expect(isBeing(undefined)).toBe(false);
    });
});

describe("gear infobox groups", () => {
    it("maps each gear note type to its display group", () => {
        expect(GEAR_TYPE_TO_KEY).toEqual({
            weapongear: "weapons",
            armorgear: "armor",
            projectilegear: "projectiles",
            miscgear: "misc",
            containergear: "containers",
            concoctiongear: "concoctions",
        });
    });
});
