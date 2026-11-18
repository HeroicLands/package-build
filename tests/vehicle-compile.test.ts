/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it, vi } from "vitest";
import { Actors } from "../sohl/actors.mjs";
import { packForType } from "../engine/ids.mjs";
import { completeAddress } from "../engine/address.mjs";

function compiler() {
    const c = new Actors({ contentBase: ".", dest: ".", skipDirectories: [] });
    c.itemsMap = new Map();
    c.linkIndex = { contentPackage: "demo", packages: new Set(["demo", "other"]) };
    return c;
}
function note(type: string, data: any = {}, sohl: any = {}) {
    return {
        type,
        id: "actor00000000000",
        shortcode: "cart",
        name: { full: "Cart" },
        data,
        sohl: { templatePriority: null, ...sohl },
    };
}

describe("vehicle actor compilation", () => {
    it("routes and compiles the envelope and generic fields", () => {
        expect(packForType("vehicle")).toEqual({ pack: "actors", docType: "Actor" });
        const c = compiler();
        const actor = c.buildEntry(
            note("vehicle", {
                occupantCapacity: 0,
                movementProfiles: [
                    { medium: "terrestrial" },
                    { medium: "terrestrial", feetPerRound: 0 },
                ],
            }),
            "",
        );
        expect(actor.type).toBe("vehicle");
        expect(actor.img).toBe("systems/sohl/icons/oldwagon.svg");
        expect(actor.system.occupantCapacity).toBe(0);
        expect(actor.system.movementProfiles).toEqual([
            { medium: "terrestrial" },
            { medium: "terrestrial", feetPerRound: 0 },
        ]);
        expect(actor.system).not.toHaveProperty("vehicle");
        expect(actor.system).not.toHaveProperty("carryingCapacity");
    });
    it("retains anchored prose and the normal Actor envelope", () => {
        const c = compiler();
        const actor = c.buildEntry(
            note("vehicle", {}, { effects: [{ name: "Effect" }], flags: { sample: true } }),
            "# Appearance {#appearance}\n\nWooden.\n\n# Dossier {#dossier}\n\nA cart.",
        );
        expect(actor.system.appearance).toContain("Wooden.");
        expect(actor.system.dossier).toContain("A cart.");
        expect(actor.effects).toEqual([{ name: "Effect" }]);
        expect(actor.flags).toEqual({ sample: true });
        expect(actor.ownership).toEqual({ default: 0 });
        expect(actor.prototypeToken.texture.src).toBe(actor.img);
        expect(actor.system).not.toHaveProperty("occupants");
        expect(actor.system).not.toHaveProperty("occupantCapacity");
        expect(actor.system).not.toHaveProperty("movementProfiles");
    });
    it("requires a system block and retains only projected facts", () => {
        const c = compiler();
        const noBlock = note("vehicle");
        delete noBlock.sohl;
        expect(c.eligibleFor(noBlock)).toBe(false);
        expect(c.eligibleFor(note("vehicle", {}, {}))).toBe(true);
        const actor = c.buildEntry(
            note("vehicle", { family: "cart", capacity: 4, appearance: { material: "wood" } }),
            "",
        );
        expect(actor.system).not.toHaveProperty("family");
        expect(actor.system).not.toHaveProperty("capacity");
        expect(actor.system).not.toHaveProperty("travel");
        expect(actor.flags).toEqual({});
    });
    it("reports colliding occupant handles", () => {
        const c = compiler();
        const error = vi.spyOn(c, "noteError").mockImplementation(() => {});
        const address = (pkg: string) =>
            completeAddress({ package: pkg, system: "sohl", type: "being", shortcode: "horse" });
        c.buildEntry(
            note("vehicle", {
                occupants: [{ address: address("demo") }, { address: address("other") }],
            }),
            "",
        );
        expect(error).toHaveBeenCalledWith(
            expect.stringContaining("share the shortcode"),
            undefined,
        );
        expect(c.errorCount).toBe(1);
    });
    it("reduces neutral occupant addresses and maps native roles and default quantities", () => {
        const c = compiler();
        const horse = completeAddress({
            package: "demo",
            system: "note",
            type: "being",
            shortcode: "horse",
        });
        const actor = c.buildEntry(
            note("vehicle", {
                occupants: [
                    { address: horse, role: "draft_animal" },
                    { address: horse, role: "crew" },
                ],
            }),
            "",
        );
        expect(actor.system.occupants).toEqual([
            { actorCodeOrUuid: "horse", role: "draftCreature", quantity: 1 },
            { actorCodeOrUuid: "horse", role: "crew", quantity: 1 },
        ]);
    });
    it("overlays native arrays and projects being movement", () => {
        const c = compiler();
        const rows = [{ medium: "terrestrial" }, { medium: "terrestrial", leaguesPerWatch: 1.5 }];
        expect(
            c.buildEntry(note("being", { movementProfiles: rows }), "").system.movementProfiles,
        ).toEqual(rows);
        const actor = c.buildEntry(
            note(
                "vehicle",
                { movementProfiles: rows, occupantCapacity: 2 },
                { system: { movementProfiles: [], carryingCapacity: 4, occupantCapacity: 0 } },
            ),
            "",
        );
        expect(actor.system).toMatchObject({
            movementProfiles: [],
            carryingCapacity: 4,
            occupantCapacity: 0,
        });
    });
    it("uses an explicit native roster without reducing generic addresses", () => {
        const c = compiler();
        const reduce = vi.spyOn(c, "reduceEmittedAddresses");
        const native = [{ actorCodeOrUuid: "crew", role: "crew", quantity: 4, title: "Pilot" }];
        const actor = c.buildEntry(
            note(
                "vehicle",
                {
                    occupants: [
                        {
                            address: completeAddress({
                                package: "demo",
                                system: "note",
                                type: "being",
                                shortcode: "horse",
                            }),
                            role: "draft_animal",
                        },
                        {
                            address: completeAddress({
                                package: "other",
                                system: "note",
                                type: "being",
                                shortcode: "horse",
                            }),
                            role: "crew",
                        },
                    ],
                },
                { system: { occupants: native } },
            ),
            "",
        );
        expect(actor.system.occupants).toEqual(native);
        expect(reduce).not.toHaveBeenCalled();
        expect(c.errorCount).toBe(0);
    });
    it("keeps movement probabilities and descriptive capacity in note data", () => {
        const c = compiler();
        const actor = c.buildEntry(
            note("vehicle", {
                capacity: 20,
                cargoCapacity: 10,
                movementProperties: [
                    {
                        medium: "floating",
                        rates: [{ prob: 1, distance: 12, distUnit: "leagues", timeUnit: "day" }],
                    },
                ],
            }),
            "",
        );
        expect(actor.system).not.toHaveProperty("capacity");
        expect(actor.system).not.toHaveProperty("cargoCapacity");
        expect(actor.system).not.toHaveProperty("movementProperties");
        expect(actor.system).not.toHaveProperty("movementProfiles");
        expect(actor.system).not.toHaveProperty("carryingCapacity");
    });
    it("embeds neutral items and explicit system items", () => {
        const c = compiler();
        const actor = c.buildEntry(
            note(
                "vehicle",
                {
                    items: [
                        { key: "a", name: "Cargo", kind: "weapon", system: { shortcode: "cargo" } },
                    ],
                },
                {
                    items: [
                        { key: "a", type: "weapongear" },
                        { type: "weapongear", name: "Spare", system: { shortcode: "spare" } },
                    ],
                },
            ),
            "",
        );
        expect(actor.items.map((item: any) => item.name)).toEqual(["Cargo", "Spare"]);
        expect(c.errorCount).toBe(0);
    });
    it("does not apply being-only item processing", () => {
        const c = compiler();
        const membership = vi.spyOn(c, "buildMemberships");
        const skills = vi.spyOn(c, "openUnopenedSkills");
        const actor = c.buildEntry(note("vehicle", {}, { defaultCombatGroup: "x" }), "");
        expect(actor.system).not.toHaveProperty("defaultCombatGroup");
        expect(membership).not.toHaveBeenCalled();
        expect(skills).not.toHaveBeenCalled();
    });
});
