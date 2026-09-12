/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
// The single source of truth for per-type default item art — shared by the
// build-time pack builder (`packages/content-build/sohl/items.mjs`) and the runtime
// `SohlItem.getDefaultArtwork` override. Plain ESM, living in the build package
// and imported here through the same leaf entry point both of them use, so this
// suite exercises the map they actually read. See issues #890, #932, #1510.
import { DEFAULT_ITEM_ART, defaultItemArt } from "../sohl/default-item-art.mjs";
// The item-type registry — the one place a type is declared. Deriving
// the expectation from it is what stops this map becoming a third list that
// disagrees with the whitelist and the builder table.
import { itemTypes } from "../engine/item-docs.mjs";
// …translated through SoHL's own note-type → subtype map, because since #78 the
// two vocabularies are no longer the same string: the registry is keyed by the
// note type (`armor`) and this map by the document subtype (`armorgear`), which
// is what the runtime reads off a Foundry Item.
import { documentSubtype } from "../engine/document-subtypes.mjs";
import { SOHL_DOCUMENT_SUBTYPES } from "../sohl/document-subtypes.mjs";

// The `.mjs` map has a precise inferred type (no index signature); view it as a
// loose record for the string-keyed lookups the tests exercise.
const ART = DEFAULT_ITEM_ART as Record<string, string | undefined>;

// Every item type the system can create ad-hoc must have a default so it never
// falls through to Foundry's white `icons/svg/item-bag.svg`.
const EXPECTED_TYPES = [...itemTypes()].map(
    (type) => documentSubtype(SOHL_DOCUMENT_SUBTYPES as never, type, {}) ?? type,
);

describe("default-item-art (single source of truth, #932)", () => {
    it("maps every known item document subtype to a themed SoHL asset", () => {
        for (const type of EXPECTED_TYPES) {
            expect(ART[type]).toMatch(/^systems\/sohl\/assets\/icons\/.+\.svg$/);
        }
    });

    it("has an entry for each expected type and no stray keys", () => {
        expect(Object.keys(DEFAULT_ITEM_ART).sort()).toEqual([...EXPECTED_TYPES].sort());
    });

    it("gives trauma and affliction the wound/sick icons (the regression)", () => {
        expect(defaultItemArt("trauma")).toBe("systems/sohl/assets/icons/other/injury.svg");
        expect(defaultItemArt("affliction")).toBe("systems/sohl/assets/icons/other/sick.svg");
    });

    it("returns the per-type default for a known type", () => {
        expect(defaultItemArt("weapongear")).toBe("systems/sohl/assets/icons/other/sword.svg");
        expect(defaultItemArt("miscgear")).toBe(
            "systems/sohl/assets/icons/other/question-mark.svg",
        );
    });

    it("is keyed by the document subtype, not the renamed note type", () => {
        // The three types #78 renamed. The map stays on the document side —
        // `SohlItem.getDefaultArtwork` reads it with a Foundry Item's own
        // `type` — and `sohl/item-builders.mjs` translates before asking.
        expect(defaultItemArt("armorgear")).toBe(
            "systems/sohl/assets/icons/game-icons/lorc/breastplate.svg",
        );
        expect(ART["armor"]).toBeUndefined();
        expect(ART["concoction"]).toBeUndefined();
        expect(ART["projectile"]).toBeUndefined();
    });

    it("throws (build fail-fast) for a type the map doesn't know", () => {
        expect(() => defaultItemArt("somegear")).toThrow(/default art/i);
        expect(() => defaultItemArt("being")).toThrow(/default art/i);
        expect(() => defaultItemArt("")).toThrow(/default art/i);
    });

    it("does not carry the retired `trait` type", () => {
        expect(ART["trait"]).toBeUndefined();
        expect(() => defaultItemArt("trait")).toThrow(/default art/i);
    });

    it("exposes a plain map so runtime callers can guard without throwing", () => {
        // The runtime `getDefaultArtwork` reads the map directly and falls back
        // to Foundry's default for unknown/`base` types rather than throwing.
        expect(ART["base"]).toBeUndefined();
        expect(ART["trauma"]).toBeDefined();
    });
});
