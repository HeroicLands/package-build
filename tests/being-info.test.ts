/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A being's info-block fields — the translation between the flat `sohl.items[]`
 * a note authors and the resolved shapes the theme's sidebar reads.
 *
 * The cases about {@link isBeing} are the ones that matter most: this
 * derivation lived in two repositories, each with its own idea of what a being
 * *is*, and one of them still said `character`/`creature` long after #1580
 * merged them (SoHL#1696).
 */

import { describe, it, expect } from "vitest";

import {
    BEING_TYPE,
    GEAR_TYPE_TO_KEY,
    deriveBeingInfo,
    isBeing,
} from "../sohl/being-info.mjs";

/** The content index, `"<type>:<shortcode>"` → the item's page. */
function index(entries: Record<string, { name?: string; url?: string }> = {}) {
    return new Map(Object.entries(entries));
}

describe("what a being is", () => {
    it("is one type, not the two that were merged into it", () => {
        expect(BEING_TYPE).toBe("being");
        expect(isBeing({ type: "being" })).toBe(true);
    });

    it("does not accept the retired names as aliases", () => {
        // They throw elsewhere in the system. Tolerating them here would hide
        // the next drift of this kind instead of surfacing it.
        expect(isBeing({ type: "character" })).toBe(false);
        expect(isBeing({ type: "creature" })).toBe(false);
    });

    it("says no to anything else, including nothing", () => {
        expect(isBeing({ type: "weapongear" })).toBe(false);
        expect(isBeing({})).toBe(false);
        expect(isBeing(null)).toBe(false);
        expect(isBeing(undefined)).toBe(false);
    });
});

describe("skills", () => {
    it("flattens skill items into a shortcode → mastery map", () => {
        const out = deriveBeingInfo(
            {
                items: [
                    {
                        type: "skill",
                        shortcode: "melee",
                        system: { masteryLevelBase: 59 },
                    },
                    {
                        type: "skill",
                        shortcode: "awar",
                        system: { masteryLevelBase: 42 },
                    },
                ],
            },
            index(),
        );

        expect(out.skills).toEqual({ melee: 59, awar: 42 });
    });

    it("skips a skill with no mastery level rather than inventing one", () => {
        const out = deriveBeingInfo(
            {
                items: [
                    {
                        type: "skill",
                        shortcode: "melee",
                        system: { masteryLevelBase: 59 },
                    },
                    { type: "skill", shortcode: "swim" },
                ],
            },
            index(),
        );

        expect(out.skills).toEqual({ melee: 59 });
    });
});

describe("gear", () => {
    it("groups gear under its sidebar heading and links what it can resolve", () => {
        const out = deriveBeingInfo(
            {
                items: [
                    { type: "weapongear", shortcode: "sword" },
                    { type: "armorgear", shortcode: "mail" },
                ],
            },
            index({
                "weapongear:sword": {
                    name: "Arming Sword",
                    url: "/kb/weapongear/sword/",
                },
                "armorgear:mail": { name: "Mail Hauberk" },
            }),
        );

        expect(out.gear).toEqual({
            weapons: [
                {
                    name: "Arming Sword",
                    shortcode: "sword",
                    url: "/kb/weapongear/sword/",
                },
            ],
            // No url: the index knew the name but not a page.
            armor: [{ name: "Mail Hauberk", shortcode: "mail" }],
        });
    });

    it("falls back to the shortcode rather than dropping an unknown item", () => {
        // A row naming something the index has not heard of beats a page that
        // silently lacks the row.
        const out = deriveBeingInfo(
            { items: [{ type: "weapongear", shortcode: "mysteryblade" }] },
            index(),
        );

        expect(out.gear).toEqual({
            weapons: [{ name: "mysteryblade", shortcode: "mysteryblade" }],
        });
    });

    it("prefers an item's inline name over the index's", () => {
        const out = deriveBeingInfo(
            {
                items: [
                    {
                        type: "weapongear",
                        shortcode: "sword",
                        name: "Her Father's Sword",
                    },
                ],
            },
            index({ "weapongear:sword": { name: "Arming Sword" } }),
        );

        expect(out.gear.weapons[0].name).toBe("Her Father's Sword");
    });

    it("ignores an item type that is not gear", () => {
        const out = deriveBeingInfo(
            { items: [{ type: "trauma", shortcode: "scar" }] },
            index(),
        );

        expect(out.gear).toBeUndefined();
    });

    it("covers every gear type the registry declares", () => {
        // A new gear type added to the model without a heading here would
        // simply vanish from the sidebar, silently.
        expect(Object.keys(GEAR_TYPE_TO_KEY).sort()).toEqual([
            "armorgear",
            "concoctiongear",
            "containergear",
            "miscgear",
            "projectilegear",
            "weapongear",
        ]);
    });
});

describe("mystical abilities", () => {
    it("splits them into spells and talents by subType", () => {
        const out = deriveBeingInfo(
            {
                items: [
                    {
                        type: "mysticalability",
                        shortcode: "fb",
                        subType: "arcaneincantation",
                    },
                    {
                        type: "mysticalability",
                        shortcode: "ss",
                        subType: "arcanetalent",
                    },
                ],
            },
            index({
                "mysticalability:fb": { name: "Fireball", url: "/kb/ma/fb/" },
                "mysticalability:ss": { name: "Second Sight" },
            }),
        );

        expect(out.spells).toEqual([{ name: "Fireball", url: "/kb/ma/fb/" }]);
        expect(out.talents).toEqual([{ name: "Second Sight" }]);
    });

    it("drops an ability it can name only by shortcode", () => {
        // Unlike gear: a sidebar row reading like a shortcode is worse here
        // than no row, because these are displayed as prose names.
        const out = deriveBeingInfo(
            {
                items: [
                    {
                        type: "mysticalability",
                        shortcode: "xyz",
                        subType: "arcanetalent",
                    },
                ],
            },
            index(),
        );

        expect(out.talents).toBeUndefined();
    });

    it("ignores an unrecognised subType", () => {
        const out = deriveBeingInfo(
            {
                items: [
                    {
                        type: "mysticalability",
                        shortcode: "q",
                        subType: "somethingelse",
                    },
                ],
            },
            index({ "mysticalability:q": { name: "Quiddity" } }),
        );

        expect(out.spells).toBeUndefined();
        expect(out.talents).toBeUndefined();
    });
});

describe("authored values win", () => {
    it.each([
        ["skills", { skills: { handwritten: 1 } }],
        ["gear", { gear: { weapons: [{ name: "Authored" }] } }],
        ["spells", { spells: [{ name: "Authored" }] }],
        ["talents", { talents: [{ name: "Authored" }] }],
    ])("keeps an authored %s exactly as written", (key, authored) => {
        const out = deriveBeingInfo(
            {
                ...authored,
                items: [
                    {
                        type: "skill",
                        shortcode: "melee",
                        system: { masteryLevelBase: 59 },
                    },
                    { type: "weapongear", shortcode: "sword", name: "Derived" },
                    {
                        type: "mysticalability",
                        shortcode: "fb",
                        subType: "arcaneincantation",
                        name: "Derived",
                    },
                    {
                        type: "mysticalability",
                        shortcode: "ss",
                        subType: "arcanetalent",
                        name: "Derived",
                    },
                ],
            },
            index(),
        );

        expect(out[key]).toEqual(authored[key as keyof typeof authored]);
    });

    it("derives over an empty authored map, which says nothing", () => {
        const out = deriveBeingInfo(
            {
                skills: {},
                items: [
                    {
                        type: "skill",
                        shortcode: "melee",
                        system: { masteryLevelBase: 59 },
                    },
                ],
            },
            index(),
        );

        expect(out.skills).toEqual({ melee: 59 });
    });
});

describe("what it leaves alone", () => {
    it("does not mutate the input", () => {
        const input = {
            items: [
                {
                    type: "skill",
                    shortcode: "melee",
                    system: { masteryLevelBase: 59 },
                },
            ],
        };
        const out = deriveBeingInfo(input, index());

        expect(out).not.toBe(input);
        expect(input).not.toHaveProperty("skills");
    });

    it("passes attributes through untouched — they already match the sidebar", () => {
        const attributes = { str: 15, agl: 14 };
        const out = deriveBeingInfo({ attributes, items: [] }, index());

        expect(out.attributes).toEqual(attributes);
    });

    it("returns a block with no items unchanged", () => {
        expect(deriveBeingInfo({ attributes: { str: 1 } }, index())).toEqual({
            attributes: { str: 1 },
        });
    });

    it.each([
        ["null", null],
        ["undefined", undefined],
        ["a list", []],
        ["a string", "nope"],
    ])("returns %s as-is rather than throwing", (_name, value) => {
        expect(deriveBeingInfo(value as never, index())).toBe(value);
    });
});
