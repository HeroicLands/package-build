/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **A field sourced from `data:` is read from `data:`, its destination and its
 * default, and from nowhere else.**
 *
 * `data.<key>` — what the specification's mapping tables name — reaches the
 * document. The note's top-level `<key>:` and a `<block>.<key>` entry are not
 * positions of that field: the first is refused by the closed top-level
 * region and the second by the block's own vocabulary.
 */

import { describe, it, expect } from "vitest";

import { resolveFieldValue } from "../engine/system-block.mjs";
import { STRING } from "../engine/field-spec.mjs";

/** A `data:`-sourced field, as HM3 declares one. */
const SPECIES = Object.freeze({
    name: "data.species",
    to: "species",
    ...STRING,
    default: "",
    describe: "The being's species, as a lore note.",
});

describe("resolving a `data:`-sourced field", () => {
    it("reads the declared `data:` source — the position the specification names", () => {
        expect(
            resolveFieldValue(SPECIES, { data: { species: "lore-a" } }, { block: "sohl" }),
        ).toEqual({ value: "lore-a", from: "shared" });
    });

    it("reads neither the top-level key nor the block key of the same name", () => {
        expect(resolveFieldValue(SPECIES, { species: "lore-b" }, { block: "sohl" })).toEqual({
            value: "",
            from: "default",
        });
        expect(
            resolveFieldValue(SPECIES, { sohl: { species: "lore-c" } }, { block: "sohl" }),
        ).toEqual({ value: "", from: "default" });
    });

    it("reads `data:` where the other two are also written", () => {
        expect(
            resolveFieldValue(
                SPECIES,
                { data: { species: "lore-a" }, species: "lore-b", sohl: { species: "lore-c" } },
                { block: "sohl" },
            ),
        ).toEqual({ value: "lore-a", from: "shared" });
    });

    it("lets the destination path win over everything", () => {
        expect(
            resolveFieldValue(
                SPECIES,
                {
                    data: { species: "lore-a" },
                    species: "lore-b",
                    sohl: { species: "lore-c", system: { species: "lore-d" } },
                },
                { block: "sohl" },
            ),
        ).toEqual({ value: "lore-d", from: "system" });
    });

    it("falls to the default when no position carries it", () => {
        expect(resolveFieldValue(SPECIES, { name: { full: "x" } }, { block: "sohl" })).toEqual({
            value: "",
            from: "default",
        });
    });

    it("reads no top-level key at all for a field that declares `topLevelMeans`", () => {
        // The opt-out removes the shared level: the note's top level means
        // something else here.
        const exempt = { ...SPECIES, topLevelMeans: "the note's own heading" };
        expect(
            resolveFieldValue(
                exempt,
                { species: "lore-b", data: { species: "lore-a" } },
                { block: "sohl" },
            ),
        ).toEqual({ value: "", from: "default" });
    });

    it("reads a field named for a non-`data:` path from the block under that name", () => {
        const blunt = { name: "protection.blunt", to: "protection.blunt", ...STRING, default: "" };
        expect(resolveFieldValue(blunt, { blunt: "5" }, { block: "sohl" })).toEqual({
            value: "",
            from: "default",
        });
        expect(
            resolveFieldValue(blunt, { sohl: { protection: { blunt: "5" } } }, { block: "sohl" }),
        ).toEqual({ value: "5", from: "block" });
    });
});
